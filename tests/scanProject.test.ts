import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProject, parseAllFiles, filesForRule, resolveOptions } from '../src/engine/loadProject.js';
import { runRule, aggregateMeasurements } from '../src/engine/runRule.js';
import { scanProject } from '../dist/engine/scanProject.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-scan-'));
  await fs.writeFile(path.join(tmp, 'selo.config.mjs'), `
    const rule = (id, type) => ({
      meta: { id, type, description: id, unitLabel: 'units', seal: '{{file}}' },
      measure(file, options) {
        if (file.path === 'throws.ts') throw new Error('fixture');
        return file.ast.body.filter(n => n.type === 'VariableDeclaration').map(n => ({
          file: type === 'count' ? 'shared-report.ts' : file.path, value: type === 'count' ? 1 : options.value,
          startLine: n.loc.start.line, data: { kind: n.kind, input: file.path },
        }));
      },
    });
    const threshold = rule('test/threshold', 'threshold');
    const count = rule('test/count', 'count');
    export default {
      files: ['*.ts'], packs: [{ name: 'fixture', version: '1', rules: {
        'test/threshold': threshold, 'test/count': count,
      }}], rules: {
        'test/threshold': { goal: 2, options: { value: 4 }, exempt: ['b.ts'] },
        'test/count': {}, 'unknown/rule': {},
      },
    };
  `);
  for (const [name, text] of Object.entries({
    'z.ts': 'const z = 1;\nconst zz = 2;',
    'a.ts': 'const a = 1;', 'b.ts': 'const b = 2;',
    'throws.ts': 'const x = 1;', 'invalid.ts': 'const = ;',
  })) await fs.writeFile(path.join(tmp, name), text);
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe('streaming scan', () => {
  it.each([1, 2, 4])('preserves complete measurements, aggregates, ties and exemptions with %i workers', async (jobs) => {
    const ctx = await loadProject(tmp);
    const files = await parseAllFiles(ctx);
    const results = await scanProject(ctx, jobs);
    expect([...results.keys()]).toEqual(['test/threshold', 'test/count']);
    for (const [id, actual] of results) {
      const rule = ctx.ruleMap.get(id)!;
      const cfg = ctx.config.rules[id]!;
      const expected = runRule({ rule, files: filesForRule(files, cfg), options: resolveOptions(rule, cfg), goal: cfg.goal ?? 0 });
      expect(actual.measurements).toEqual(expected.measurements);
      expect(actual.worst).toBe(expected.worst);
      expect(actual.violationsVsGoal).toBe(expected.violationsVsGoal);
      expect(actual.offendersOver(2)).toEqual(expected.offendersOver(2));
    }
  });

  it.each([1, 2])('preserves the same measurements with the native backend and %i workers', async (jobs) => {
    const ctx = await loadProject(tmp);
    const original = await scanProject(ctx, 1);
    const native = await scanProject(ctx, jobs, undefined, 'oxc');
    expect([...native].map(([id, result]) => [id, result.measurements])).toEqual([...original].map(([id, result]) => [id, result.measurements]));
  });

  it('returns empty aggregates for an empty workload', async () => {
    const ctx = await loadProject(tmp);
    const results = await scanProject({ ...ctx, filesAbsolute: [] }, 4);
    expect(results.get('test/count')?.measurements).toEqual([]);
    expect(results.get('test/count')?.worst).toBe(0);
  });

  it.each([0, -1, 1.5, 33, NaN])('rejects invalid concurrency %s', async (jobs) => {
    await expect(scanProject(await loadProject(tmp), jobs)).rejects.toThrow('jobs');
  });

  it('rejects a worker that exits successfully without measurements', async () => {
    const ctx = await loadProject(tmp);
    await fs.writeFile(path.join(tmp, 'selo.config.mjs'), 'process.exit(0);');
    await expect(scanProject(ctx, 2)).rejects.toThrow('before sending results');
  });

  it('rejects worker startup failure rather than silently omitting files', async () => {
    const ctx = await loadProject(tmp);
    await fs.writeFile(path.join(tmp, 'selo.config.mjs'), 'throw new Error("worker config failed");');
    await expect(scanProject(ctx, 2)).rejects.toThrow('worker config failed');
  });
});

it('aggregates large measurement sets without spreading into the call stack', () => {
  const measurements = Array.from({ length: 200_000 }, (_, i) => ({ value: i, file: 'a.ts' }));
  const actual = aggregateMeasurements(measurements, 'threshold', 199_998);
  expect(actual.worst).toBe(199_999);
  expect(actual.violationsVsGoal).toBe(1);
  expect(aggregateMeasurements([{ value: -3, file: 'a' }], 'count', 0).worst).toBe(-3);
  expect(aggregateMeasurements([{ value: NaN, file: 'a' }], 'threshold', 0).worst).toBeNaN();
});
