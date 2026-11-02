import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli/selo.js', import.meta.url));
function run(cwd: string, args: string[]) {
  return new Promise<{ code: number | string; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [cli, ...args, '--cwd', cwd], (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

it('preserves CLI output, exit status and baseline writes across worker counts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-cli-'));
  try {
    await fs.writeFile(path.join(cwd, 'selo.config.mjs'), `
      const rule = (id, type) => ({ meta: { id, type, description: '', unitLabel: 'units', seal: '{{file}}' },
        measure(file) { return [{ value: 1, file: file.path }]; } });
      export default { files: ['*.ts'], packs: [{ name: 'fixture', version: '1', rules: {
        threshold: rule('threshold', 'threshold'), count: rule('count', 'count'),
      }}], rules: { threshold: { goal: 0 }, count: { goal: 0 } } };
    `);
    await fs.writeFile(path.join(cwd, 'a.ts'), 'const a = 1;');
    await fs.writeFile(path.join(cwd, 'b.ts'), 'const b = 1;');
    const initial = JSON.stringify({
      threshold: { current: 4, worst: 4, violationsVsGoal: 2 },
      count: { current: 1, worst: 1, violationsVsGoal: 1 },
    });
    for (const readOnly of [true, false]) {
      let expected;
      for (const jobs of [undefined, 1, 2]) {
        await fs.writeFile(path.join(cwd, 'selo.baseline.json'), initial);
        const args = ['check', ...(readOnly ? ['--dont-bless-baseline'] : []), ...(jobs ? ['--jobs', String(jobs)] : [])];
        const result = { ...await run(cwd, args), baseline: await fs.readFile(path.join(cwd, 'selo.baseline.json'), 'utf8') };
        if (jobs === undefined) expected = result;
        else expect(result).toEqual(expected);
        if (readOnly) expect(result.baseline).toBe(initial);
        expect(result.code).toBe(1); // Real regression must remain a failure.
      }
    }
    expect(await run(cwd, ['histogram', 'threshold', '--jobs', '2'])).toEqual(await run(cwd, ['histogram', 'threshold']));
    let blessed;
    for (const jobs of [undefined, 2]) {
      await fs.writeFile(path.join(cwd, 'selo.baseline.json'), initial);
      const result = { ...await run(cwd, ['bless-current', ...(jobs ? ['--jobs', String(jobs)] : [])]), baseline: await fs.readFile(path.join(cwd, 'selo.baseline.json'), 'utf8') };
      if (jobs === undefined) blessed = result;
      else expect(result).toEqual(blessed);
    }
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}, 20_000);
