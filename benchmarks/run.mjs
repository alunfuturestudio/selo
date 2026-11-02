import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const workload = path.resolve(process.argv[2] ?? '/Users/sergio/workspace/lumina');
const rounds = Number(process.argv[3] ?? 3);
const output = path.resolve(process.argv[4] ?? path.join(root, 'benchmarks/results/final'));
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('rounds must be a positive integer');
await mkdir(output, { recursive: true });
const baselinePath = path.join(workload, 'selo.baseline.json');
const beforeBaseline = createHash('sha256').update(await readFile(baselinePath)).digest('hex');
const variants = [
  { name: 'original', engine: 'benchmarks/original-dist', mode: 'legacy', localPack: false },
  { name: 'typescript-4', engine: 'dist', mode: '4', localPack: true },
  ...[1, 2, 4, 8].map(jobs => ({ name: `native-${jobs}`, engine: 'dist', mode: String(jobs), backend: 'oxc', localPack: true })),
];
const results = [];
const child = (args, env) => new Promise((resolve, reject) => {
  const process = spawn(globalThis.process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  process.once('error', reject);
  process.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`benchmark failed: code=${code} signal=${signal}`)));
});
// Rotate the order between rounds; never run benchmarks concurrently.
for (let round = 0; round < rounds; round++) {
  const order = [...variants.slice(round % variants.length), ...variants.slice(0, round % variants.length)];
  for (const variant of order) {
    const file = path.join(output, `${variant.name}-${round + 1}.json`);
    console.log(`round ${round + 1}/${rounds}: ${variant.name}`);
    const env = { ...process.env };
    delete env.SELO_BENCH_PACK;
    delete env.SELO_BENCH_SOLID;
    const args = [];
    if (variant.localPack) {
      env.SELO_BENCH_PACK = path.join(root, 'packs/selo-eslint-raiz/dist/index.js');
      env.SELO_BENCH_SOLID = path.join(root, 'packs/selo-solid/dist/index.js');
      args.push('--import', './benchmarks/use-local-pack.mjs');
    }
    args.push('benchmarks/measure.mjs', variant.engine, workload, variant.mode, file, variant.backend ?? 'typescript');
    await child(args, env);
    const result = JSON.parse(await readFile(file, 'utf8'));
    results.push({ variant: variant.name, round: round + 1, ...result });
    if (new Set(results.map((r) => r.inputSha256)).size !== 1) throw new Error('Workload changed between runs');
    if (new Set(results.map((r) => r.resultsSha256)).size !== 1) throw new Error('Measurements or aggregates changed');
  }
}
const afterBaseline = createHash('sha256').update(await readFile(baselinePath)).digest('hex');
if (afterBaseline !== beforeBaseline) throw new Error('Baseline changed');
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const summary = variants.map(({ name }) => {
  const runs = results.filter((r) => r.variant === name);
  return { variant: name, medianMs: median(runs.map((r) => r.totalMs)), minMs: Math.min(...runs.map((r) => r.totalMs)), maxMs: Math.max(...runs.map((r) => r.totalMs)), medianMaxRssKiB: median(runs.map((r) => r.maxRssKiB)) };
});
const original = summary[0].medianMs;
for (const entry of summary) entry.reductionPercent = 100 * (1 - entry.medianMs / original);
const report = { rounds, workload, baselineSha256: beforeBaseline, cpuModel: os.cpus()[0].model, availableParallelism: os.availableParallelism(), summary, results };
await writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
