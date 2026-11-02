import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const root = fileURLToPath(new URL('../', import.meta.url));
const workload = path.resolve(process.argv[2] ?? '/Users/sergio/workspace/lumina');
const rounds = Number(process.argv[3] ?? 3);
const dir = path.resolve(process.argv[4] ?? path.join(root, 'benchmarks/results/cli-final'));
await mkdir(dir, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const baselineBefore = hash(await readFile(path.join(workload, 'selo.baseline.json')));
const allVariants = [
  { name: 'installed-0.1.1', cli: path.join(workload, 'node_modules/@guilhermesilveira/selo/dist/cli/selo.js'), args: [], tuned: false },
  { name: 'original', cli: 'benchmarks/original-dist/cli/selo.js', args: [], tuned: false },
  { name: 'default-fast', cli: 'dist/cli/selo.js', args: [], tuned: true },
  { name: 'typescript-4', cli: 'dist/cli/selo.js', args: ['--parser', 'typescript', '--jobs', '4'], tuned: true },
  ...[2, 4, 8].map((jobs) => ({ name: `native-${jobs}`, cli: 'dist/cli/selo.js', args: ['--parser', 'oxc', '--jobs', String(jobs)], tuned: true })),
];
const selected = process.argv[5]?.split(',');
const variants = selected ? allVariants.filter(v=>selected.includes(v.name)) : allVariants;
if (!variants.length || (selected && variants.length !== selected.length)) throw new Error('Unknown benchmark variant');
const results = [];
const execute = (variant) => new Promise((resolve, reject) => {
  const env = { ...process.env };
  delete env.SELO_BENCH_PACK;
  delete env.SELO_BENCH_SOLID;
  const args = [];
  if (variant.tuned) {
    env.SELO_BENCH_PACK = path.join(root, 'packs/selo-eslint-raiz/dist/index.js');
    env.SELO_BENCH_SOLID = path.join(root, 'packs/selo-solid/dist/index.js');
    args.push('--import', './benchmarks/use-local-pack.mjs');
  }
  args.push(variant.cli, 'check', '--cwd', workload, '--dont-bless-baseline', ...variant.args);
  const start = performance.now();
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => stdout += chunk);
  child.stderr.setEncoding('utf8').on('data', (chunk) => stderr += chunk);
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (signal) { reject(new Error(`terminated: ${signal}`)); return; }
    resolve({ totalMs: performance.now() - start, code, stdoutSha256: hash(stdout), stderrSha256: hash(stderr), stdout, stderr });
  });
});
for (let round = 0; round < rounds; round++) {
  const order = [...variants.slice(round % variants.length), ...variants.slice(0, round % variants.length)];
  for (const variant of order) {
    console.log(`CLI round ${round + 1}/${rounds}: ${variant.name}`);
    const result = await execute(variant);
    await writeFile(path.join(dir, `${variant.name}-${round + 1}.stdout`), result.stdout);
    await writeFile(path.join(dir, `${variant.name}-${round + 1}.stderr`), result.stderr);
    delete result.stdout; delete result.stderr;
    results.push({ variant: variant.name, round: round + 1, ...result });
    if (new Set(results.map((r) => `${r.code}:${r.stdoutSha256}:${r.stderrSha256}`)).size !== 1) throw new Error('CLI output or exit status changed');
  }
}
if (hash(await readFile(path.join(workload, 'selo.baseline.json'))) !== baselineBefore) throw new Error('Baseline changed');
const median = (values) => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
const summary = variants.map(({name}) => {
  const runs = results.filter(r=>r.variant===name);
  return { variant:name, medianMs:median(runs.map(r=>r.totalMs)), minMs:Math.min(...runs.map(r=>r.totalMs)), maxMs:Math.max(...runs.map(r=>r.totalMs)) };
});
for(const entry of summary) entry.reductionPercent=100*(1-entry.medianMs/summary[0].medianMs);
await writeFile(path.join(dir,'summary.json'),JSON.stringify({ rounds, cpu:os.cpus()[0].model, availableParallelism:os.availableParallelism(), node:process.version, baselineSha256:baselineBefore, summary, results },null,2));
console.log(JSON.stringify(summary,null,2));
