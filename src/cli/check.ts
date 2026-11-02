import type { ParserBackend } from '../engine/parse.js';
import { scanProject } from '../engine/scanProject.js';
import * as path from 'node:path';
import { formatOffenderLines } from '../engine/render.js';
import { loadProject, projectRoot } from '../engine/loadProject.js';
import { readBaseline, writeBaseline, type Baseline } from '../ratchet/baseline.js';
import { migrateBaseline, verdict } from '../ratchet/verdict.js';
import { parseCommonArgs } from './args.js';

export interface CheckArgs {
  cwd: string | undefined;
  blessBaseline: boolean;
  jobs: number;
  parser: ParserBackend;
}

export function parseCheckArgs(rest: string[]): CheckArgs {
  const args = parseCommonArgs(rest);
  return {
    cwd: args.cwd,
    jobs: args.jobs,
    parser: args.parser,
    blessBaseline: !args.positional.includes('--dont-bless-baseline'),
  };
}

export async function runCheck(rest: string[]): Promise<void> {
  const args = parseCheckArgs(rest);
  const cwd = projectRoot(args.cwd);
  const ctx = await loadProject(cwd);
  const baselinePath = path.join(cwd, 'selo.baseline.json');
  const baseline: Baseline = await readBaseline(baselinePath);

  const scanned = await scanProject(ctx, args.jobs, undefined, args.parser);
  let regressed = false;
  let dirty = false;
  let baselineChanged = false;

  for (const [ruleId, ruleCfg] of Object.entries(ctx.config.rules)) {
    const rule = ctx.ruleMap.get(ruleId);
    if (!rule) {
      process.stderr.write(`selo: unknown rule '${ruleId}' — no pack provides it\n`);
      continue;
    }
    if (typeof ruleCfg.goal !== 'number' && rule.meta.type === 'threshold') {
      process.stderr.write(`selo: ${ruleId} is a threshold rule but no 'goal' is configured — skipping\n`);
      continue;
    }
    const goal = ruleCfg.goal ?? 0;
    const aggregate = scanned.get(ruleId)!;

    // Persist the count-rule migration if a stale baseline is observed, so future runs
    // don't redo the migration on every check.
    const original = baseline[ruleId];
    const migrated = migrateBaseline(original, rule.meta.type);
    const stored = migrated ?? original;
    if (migrated !== original && migrated !== undefined) {
      if (args.blessBaseline) {
        baseline[ruleId] = migrated;
        dirty = true;
        baselineChanged = true;
      }
    }

    const v = verdict({
      ruleType: rule.meta.type,
      measuredWorst: aggregate.worst,
      measuredViolations: aggregate.violationsVsGoal,
      goal,
      step: ruleCfg.step,
      stored,
    });

    switch (v.kind) {
      case 'seeded': {
        if (args.blessBaseline) {
          baseline[ruleId] = v.next;
          dirty = true;
          baselineChanged = true;
        }
        const seedDesc =
          rule.meta.type === 'count'
            ? `cap=${v.next.current}, violations=${v.next.violationsVsGoal}`
            : `current=${v.next.current}, worst=${v.next.worst}, violationsVsGoal=${v.next.violationsVsGoal}`;
        const verb = args.blessBaseline ? 'seeded' : 'would seed';
        process.stdout.write(`selo: ${verb} ${ruleId} — ${seedDesc}, goal=${goal}\n`);
        break;
      }
      case 'arrived': {
        process.stdout.write(`selo: ${ruleId} clean at goal=${goal}\n`);
        break;
      }
      case 'arrivedFailed': {
        regressed = true;
        if (rule.meta.type === 'count') {
          process.stderr.write(
            `\nselo: ${ruleId} REGRESSED past goal=${goal}\n` +
              `  ${aggregate.violationsVsGoal} violation(s) — must drop to ≤ ${goal}. ` +
              `The ratchet is finished.\n`,
          );
          for (const line of formatOffenderLines(rule, aggregate.measurements)) {
            process.stderr.write(`${line}\n`);
          }
        } else {
          const offenders = aggregate.offendersOver(v.offendersThreshold);
          process.stderr.write(
            `\nselo: ${ruleId} REGRESSED past goal=${goal}\n` +
              `  ${offenders.length} unit(s) violate goal=${goal}. ` +
              `The ratchet is finished — fix back to goal, no step-tightening.\n`,
          );
          for (const line of formatOffenderLines(rule, offenders)) process.stderr.write(`${line}\n`);
        }
        break;
      }
      case 'flat': {
        const flatDesc =
          rule.meta.type === 'count'
            ? `violations ${aggregate.violationsVsGoal}, cap ${stored?.current}, goal ${goal}`
            : `worst ${aggregate.worst}, violations ${aggregate.violationsVsGoal}, current ${stored?.current}, goal ${goal}`;
        process.stdout.write(`selo: ${ruleId} flat — ${flatDesc}\n`);
        break;
      }
      case 'improved': {
        const prev = stored;
        if (args.blessBaseline) {
          baseline[ruleId] = v.next;
          dirty = true;
          baselineChanged = true;
        }
        const suffix = args.blessBaseline ? '' : ' (baseline unchanged)';
        if (rule.meta.type === 'count') {
          process.stdout.write(
            `selo: ${ruleId} improved — violations ${prev?.violationsVsGoal}→${v.next.violationsVsGoal}, cap ${prev?.current}→${v.next.current}${suffix}\n`,
          );
        } else {
          process.stdout.write(
            `selo: ${ruleId} improved — worst ${prev?.worst}→${v.next.worst}, violationsVsGoal ${prev?.violationsVsGoal}→${v.next.violationsVsGoal}, current ${prev?.current}→${v.next.current}${suffix}\n`,
          );
        }
        break;
      }
      case 'regressed': {
        regressed = true;
        if (rule.meta.type === 'count') {
          process.stderr.write(
            `\nselo: REGRESSION on ${ruleId} (goal ${goal})\n` +
              `  violations:  ${stored?.violationsVsGoal} → ${aggregate.violationsVsGoal}\n\n` +
              `  Tighten cap: ${stored?.current} → ${v.newCurrent}\n` +
              `  You must reduce violations to ≤ ${v.newCurrent}.\n`,
          );
          for (const line of formatOffenderLines(rule, aggregate.measurements)) {
            process.stderr.write(`${line}\n`);
          }
          process.stderr.write(
            `\n  When violations are ≤ ${v.newCurrent}, rerun \`selo check\` to bless the new baseline.\n`,
          );
        } else {
          const offenders = aggregate.offendersOver(v.offendersThreshold);
          process.stderr.write(
            `\nselo: REGRESSION on ${ruleId} (goal ${goal})\n` +
              `  worst:            ${stored?.worst} → ${aggregate.worst}\n` +
              `  violationsVsGoal: ${stored?.violationsVsGoal} → ${aggregate.violationsVsGoal}\n\n` +
              `  Tighten current:  ${stored?.current} → ${v.newCurrent}\n` +
              `  Units violating new current ${v.newCurrent}: ${offenders.length}\n`,
          );
          for (const line of formatOffenderLines(rule, offenders)) process.stderr.write(`${line}\n`);
          process.stderr.write(
            `\n  When everything is at or below ${v.newCurrent}, rerun \`selo check\` to bless the new baseline.\n`,
          );
        }
        break;
      }
    }
  }

  if (dirty) await writeBaseline(baselinePath, baseline);
  if (baselineChanged) {
    process.stderr.write(
      '\nselo: baseline updated. Review and commit selo.baseline.json, then rerun `selo check`.\n',
    );
  }
  if (regressed || baselineChanged) process.exit(1);
}
