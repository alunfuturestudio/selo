import { Worker } from 'node:worker_threads';
import type { SeloMeasurement } from '../contract/index.js';
import type { ProjectContext } from './loadProject.js';
import { resolveOptions } from './loadProject.js';
import { parseFile, type ParserBackend } from './parse.js';
import { aggregateMeasurements, runRule, type RuleAggregate } from './runRule.js';

interface FileMeasurements {
  fileIndex: number;
  measurements: SeloMeasurement[];
}
export type ScanMeasurements = Map<string, FileMeasurements[]>;

/** File-major execution is opt-in: rules must be independent across files.
 * Keep only one parsed file per worker; never transfer an AST between threads.
 */
export async function scanFiles(ctx: ProjectContext, ruleIds: string[], fileIndices = ctx.filesAbsolute.map((_, index) => index), backend: ParserBackend = 'oxc'): Promise<ScanMeasurements> {
  const active = ruleIds.map((id) => {
    const rule = ctx.ruleMap.get(id)!;
    const cfg = ctx.config.rules[id] ?? {};
    return { id, rule, goal: cfg.goal ?? 0, options: resolveOptions(rule, cfg), exempt: new Set(cfg.exempt ?? []) };
  });
  const results: ScanMeasurements = new Map(active.map(({ id }) => [id, []]));
  for (const [index, absolutePath] of ctx.filesAbsolute.entries()) {
    const file = await parseFile(absolutePath, ctx.cwd, true, backend);
    if (!file) continue;
    for (const entry of active) {
      if (entry.exempt.has(file.path)) continue;
      const aggregate = runRule({ rule: entry.rule, options: entry.options, goal: entry.goal, files: [file] });
      const out = results.get(entry.id)!;
      if (aggregate.measurements.length > 0) out.push({ fileIndex: fileIndices[index]!, measurements: aggregate.measurements });
    }
  }
  return results;
}

/** Round-robin partitions balance directory-heavy workloads. Merge by input
 * index, never measurement.file (a rule may report a different path). */
export function activeRuleIds(ctx: ProjectContext): string[] {
  return Object.keys(ctx.config.rules).filter((id) => {
    const rule = ctx.ruleMap.get(id);
    return rule && (rule.meta.type !== 'threshold' || typeof ctx.config.rules[id]!.goal === 'number');
  });
}

export async function collectProjectMeasurements(
  ctx: ProjectContext,
  jobs: number,
  ruleIds = activeRuleIds(ctx),
  backend: ParserBackend = 'oxc',
): Promise<ScanMeasurements> {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) throw new Error('selo: jobs must be an integer from 1 to 32');
  const files = [...ctx.filesAbsolute].sort((a, b) => a.localeCompare(b));
  const count = Math.min(jobs, Math.max(files.length, 1));
  const workers: Worker[] = [];
  let parts: ScanMeasurements[];
  if (count === 1) {
    parts = [await scanFiles({ ...ctx, filesAbsolute: files }, ruleIds, undefined, backend)];
  } else {
    try {
      parts = await Promise.all(Array.from({ length: count }, (_, index) => {
        const worker = new Worker(new URL('./scanWorker.js', import.meta.url), {
          workerData: {
            cwd: ctx.cwd,
            files: files.filter((_, fileIndex) => fileIndex % count === index),
            fileIndices: files.flatMap((_, fileIndex) => fileIndex % count === index ? [fileIndex] : []),
            ruleIds, backend,
          },
        });
        workers.push(worker);
        return new Promise<ScanMeasurements>((resolve, reject) => {
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', (code) => reject(new Error(`selo: scan worker exited before sending results (code ${code})`)));
        });
      }));
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
  }
  return new Map(ruleIds.map((id) => [id,
    parts.flatMap((part) => part.get(id) ?? []).sort((a, b) => a.fileIndex - b.fileIndex),
  ]));
}

export function aggregateProjectMeasurements(ctx: ProjectContext, groups: ScanMeasurements): Map<string, RuleAggregate> {
  return new Map([...groups].map(([id, files]) => {
    const measurements: SeloMeasurement[] = [];
    for (const group of files) {
      for (const measurement of group.measurements) measurements.push(measurement);
    }
    return [id, aggregateMeasurements(measurements, ctx.ruleMap.get(id)!.meta.type, ctx.config.rules[id]?.goal ?? 0)];
  }));
}

export async function scanProject(ctx: ProjectContext, jobs: number, ruleIds = activeRuleIds(ctx), backend: ParserBackend = 'oxc'): Promise<Map<string, RuleAggregate>> {
  return aggregateProjectMeasurements(ctx, await collectProjectMeasurements(ctx, jobs, ruleIds, backend));
}
