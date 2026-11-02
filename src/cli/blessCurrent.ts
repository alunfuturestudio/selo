import { scanProject } from '../engine/scanProject.js';
import * as path from 'node:path';
import { loadProject, projectRoot } from '../engine/loadProject.js';
import { readBaseline, writeBaseline, type Baseline } from '../ratchet/baseline.js';
import { migrateBaseline } from '../ratchet/verdict.js';
import { parseCommonArgs } from './args.js';

export async function runBlessCurrent(rest: string[]): Promise<void> {
  const args = parseCommonArgs(rest);
  const cwd = projectRoot(args.cwd);
  const ctx = await loadProject(cwd);
  const baselinePath = path.join(cwd, 'selo.baseline.json');
  const baseline: Baseline = await readBaseline(baselinePath);
  const scanned = await scanProject(ctx, args.jobs, undefined, args.parser);
  let dirty = false;

  for (const [ruleId, ruleCfg] of Object.entries(ctx.config.rules)) {
    const rule = ctx.ruleMap.get(ruleId);
    if (!rule) continue;
    if (typeof ruleCfg.goal !== 'number' && rule.meta.type === 'threshold') continue;
    const goal = ruleCfg.goal ?? 0;
    const aggregate = scanned.get(ruleId)!;

    // Pick the metric to bless based on rule type.
    //   threshold: per-unit value cap (worst measurement)
    //   count:     violation-count cap (number of violations)
    const isCount = rule.meta.type === 'count';
    const blessMetric = isCount ? aggregate.violationsVsGoal : aggregate.worst;
    const newCurrent = Math.max(goal, blessMetric);
    const newWorst = blessMetric;

    const original = baseline[ruleId];
    const stored = migrateBaseline(original, rule.meta.type);
    if (stored !== original && stored !== undefined) {
      baseline[ruleId] = stored;
      dirty = true;
    }

    if (!stored) {
      baseline[ruleId] = {
        current: newCurrent,
        worst: newWorst,
        violationsVsGoal: aggregate.violationsVsGoal,
      };
      dirty = true;
      process.stdout.write(
        `selo: ${ruleId} seeded → current=${newCurrent}, worst=${newWorst}, violationsVsGoal=${aggregate.violationsVsGoal}\n`,
      );
      continue;
    }

    // "Would worsen" check is also type-specific. For count rules, only the
    // violation count matters; `worst` is meaningless (always 1 in raw form).
    const wouldWorsen = isCount
      ? aggregate.violationsVsGoal > stored.violationsVsGoal
      : aggregate.worst > stored.worst || aggregate.violationsVsGoal > stored.violationsVsGoal;
    if (wouldWorsen) {
      const fromTo = isCount
        ? `violations ${stored.violationsVsGoal}→${aggregate.violationsVsGoal}`
        : `worst ${stored.worst}→${aggregate.worst}, violations ${stored.violationsVsGoal}→${aggregate.violationsVsGoal}`;
      process.stdout.write(`selo: ${ruleId} skipped — would worsen baseline (${fromTo})\n`);
      continue;
    }

    if (
      newWorst === stored.worst &&
      aggregate.violationsVsGoal === stored.violationsVsGoal &&
      newCurrent === stored.current
    ) {
      process.stdout.write(
        `selo: ${ruleId} unchanged (current=${stored.current}, violations=${stored.violationsVsGoal})\n`,
      );
      continue;
    }
    baseline[ruleId] = {
      current: newCurrent,
      worst: newWorst,
      violationsVsGoal: aggregate.violationsVsGoal,
    };
    dirty = true;
    process.stdout.write(
      `selo: ${ruleId} blessed — current ${stored.current}→${newCurrent}, worst ${stored.worst}→${newWorst}, violations ${stored.violationsVsGoal}→${aggregate.violationsVsGoal}\n`,
    );
  }

  if (dirty) await writeBaseline(baselinePath, baseline);
}
