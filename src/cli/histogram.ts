import { scanProject } from '../engine/scanProject.js';
import * as path from 'node:path';
import { loadProject, projectRoot } from '../engine/loadProject.js';
import { readBaseline } from '../ratchet/baseline.js';
import { parseCommonArgs } from './args.js';

interface Bucket {
  lower: number;
  upper: number;
}

export async function runHistogram(rest: string[]): Promise<void> {
  const args = parseCommonArgs(rest);
  const ruleId = args.positional[0];
  if (!ruleId) {
    process.stderr.write('usage: selo histogram <rule-id> [--cwd DIR]\n');
    process.exit(2);
  }
  const cwd = projectRoot(args.cwd);
  const ctx = await loadProject(cwd);
  const rule = ctx.ruleMap.get(ruleId);
  if (!rule) {
    process.stderr.write(`selo: unknown rule '${ruleId}'\n`);
    process.exit(2);
  }
  if (rule.meta.type !== 'threshold') {
    process.stderr.write(`selo: histogram is only meaningful for threshold rules; '${ruleId}' is a count rule\n`);
    process.exit(2);
  }
  const ruleCfg = ctx.config.rules[ruleId] ?? {};
  const goal = ruleCfg.goal ?? 0;
  const baseline = await readBaseline(path.join(cwd, 'selo.baseline.json'));
  const cap = baseline[ruleId]?.current ?? goal;

  const scanned = await scanProject(ctx, args.jobs, [ruleId], args.parser);
  const aggregate = scanned.get(rule.meta.id)!;
  renderHistogram(rule.meta.id, rule.meta.unitLabel, aggregate.measurements.map((m) => m.value), cap);
}

function bucketsForCap(cap: number): Bucket[] {
  const fractions = [0, 1 / 8, 1 / 4, 1 / 2, 1, 1.5, 2, 2.5, 3];
  const out: Bucket[] = [];
  for (let i = 0; i < fractions.length - 1; i++) {
    out.push({
      lower: Math.round(fractions[i]! * cap),
      upper: Math.round(fractions[i + 1]! * cap),
    });
  }
  out.push({ lower: Math.round(fractions[fractions.length - 1]! * cap), upper: Infinity });
  return out;
}

function bucketIndex(buckets: Bucket[], v: number): number {
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    if (v >= b.lower && v < b.upper) return i;
  }
  return buckets.length - 1;
}

function bucketLabel(b: Bucket): string {
  if (b.upper === Infinity) return `${b.lower}+`;
  return `${b.lower}-${b.upper}`;
}

function renderHistogram(ruleId: string, unitLabel: string, values: number[], cap: number): void {
  const buckets = bucketsForCap(cap);
  const counts = new Array<number>(buckets.length).fill(0);
  for (const v of values) counts[bucketIndex(buckets, v)]!++;
  const peak = Math.max(...counts, 1);
  const barWidth = 32;

  process.stdout.write(`selo histogram ${ruleId} (cap ${cap})\n\n`);
  process.stdout.write(`  ${unitLabel.padStart(12)}   count   bar\n`);
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const c = counts[i]!;
    const w = c === 0 ? 0 : Math.max(1, Math.round((c / peak) * barWidth));
    const bar = '█'.repeat(w);
    const arrow = b.upper === cap ? `   ← cap ${cap}` : '';
    process.stdout.write(
      `  ${bucketLabel(b).padStart(12)}   ${String(c).padStart(5)}   ${bar}${arrow}\n`,
    );
  }
  const violating = values.filter((v) => v > cap).length;
  const max = values.length === 0 ? 0 : Math.max(...values);
  process.stdout.write(
    `\n  total ${values.length} units, ${violating} over cap ${cap}, worst ${max}\n`,
  );
  if (violating > 0) {
    process.stdout.write(
      '  use the bars to spot the next refactor target — buckets just past the cap are usually the cheapest wins.\n',
    );
  }
}
