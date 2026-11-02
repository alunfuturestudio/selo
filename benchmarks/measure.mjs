import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// No baseline writes or rule/config edits. Run each measurement in a fresh process.
const [root, cwd, mode, output, backend = 'typescript'] = process.argv.slice(2);
if (!output) throw new Error('usage: node measure.mjs <engine-root> <workload> <legacy|jobs> <output.json>');
const started = performance.now();
const engine = (name) => import(pathToFileURL(path.resolve(root, `${name}.js`)).href);
const { loadProject, parseAllFiles, filesForRule, resolveOptions } = await engine('engine/loadProject');
const { runRule } = await engine('engine/runRule');
const ctx = await loadProject(cwd);
const loaded = performance.now();
const measurements = {};
const aggregates = {};
const timings = [];
let parsed;
if (mode === 'legacy') {
  const files = await parseAllFiles(ctx);
  parsed = performance.now();
  for (const [id, cfg] of Object.entries(ctx.config.rules)) {
    const rule = ctx.ruleMap.get(id);
    if (!rule || (rule.meta.type === 'threshold' && typeof cfg.goal !== 'number')) continue;
    const start = performance.now();
    const result = runRule({ rule, files: filesForRule(files, cfg), options: resolveOptions(rule, cfg), goal: cfg.goal ?? 0 });
    measurements[id] = result.measurements;
    aggregates[id] = { worst: result.worst, violationsVsGoal: result.violationsVsGoal };
    timings.push({ id, ms: performance.now() - start, count: result.measurements.length });
  }
} else {
  const { scanProject } = await engine('engine/scanProject');
  for (const [id, result] of await scanProject(ctx, Number(mode), undefined, backend)) {
    measurements[id] = result.measurements;
    aggregates[id] = { worst: result.worst, violationsVsGoal: result.violationsVsGoal };
  }
}
const finished = performance.now();
const memory = process.memoryUsage();
const resource = process.resourceUsage();
// Fingerprint actual workload after timing; the orchestrator rejects changed inputs.
const hash = createHash('sha256');
for (const abs of [...ctx.filesAbsolute, path.join(cwd, 'selo.config.mjs'), path.join(cwd, 'selo.baseline.json')].sort()) {
  hash.update(path.relative(cwd, abs));
  hash.update(await readFile(abs));
}
const json = JSON.stringify({ measurements, aggregates });
await writeFile(output.replace(/\.json$/, '.measurements.json'), json);
await writeFile(output, JSON.stringify({
  mode, backend, files: ctx.filesAbsolute.length,
  inputSha256: hash.digest('hex'),
  resultsSha256: createHash('sha256').update(json).digest('hex'),
  totalMs: finished - started, loadMs: loaded - started,
  ...(parsed ? { parseMs: parsed - loaded, timings } : {}),
  memory, maxRssKiB: resource.maxRSS, cpuUserMs: resource.userCPUTime / 1000, cpuSystemMs: resource.systemCPUTime / 1000,
  node: process.version, platform: process.platform, arch: process.arch,
}, null, 2));
