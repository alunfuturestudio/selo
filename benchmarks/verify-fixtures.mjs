import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const workload = process.argv[2] ?? '/Users/sergio/workspace/lumina';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-equivalence-'));
const fixture = {
  'empty.ts': 'if (true) {}\ntry { foo(); } catch (e) {}',
  'catch.ts': 'try { foo(); } catch (e) { throw e; } finally { cleanup(); }',
  'import.ts': 'import {\n a,\n b,\n} from "x";',
  'jsx.tsx': 'export const View = () => <div />;\nif (true) {}',
  'disabled.ts': '/* eslint-disable no-empty */\nif (true) {}\ntry { f(); } catch (e) { throw e; }',
  'enabled.ts': '/* eslint-disable */\nif (true) {}\n/* eslint-enable */\nif (true) {}',
  'invalid.ts': 'const = ;',
};
try {
  const roots = [];
  for (const [name, pack] of [
    ['original', path.join(workload, 'node_modules/selo-eslint-raiz/dist/index.js')],
    ['optimized', path.join(root, 'packs/selo-eslint-raiz/dist/index.js')],
  ]) {
    const cwd = path.join(dir, name);
    roots.push(cwd);
    await fs.mkdir(cwd);
    for (const [file, source] of Object.entries(fixture)) await fs.writeFile(path.join(cwd, file), source);
    await fs.writeFile(path.join(cwd, 'selo.config.mjs'), `
      import pack from ${JSON.stringify(pathToFileURL(pack).href)};
      export default { files: ['*.ts', '*.tsx'], packs: [pack], rules: Object.fromEntries(Object.keys(pack.rules).map(id => [id, {goal:0}])) };
    `);
  }
  const original = await import('../benchmarks/original-dist/engine/loadProject.js');
  const { runRule } = await import('../benchmarks/original-dist/engine/runRule.js');
  const ctx = await original.loadProject(roots[0]);
  const files = await original.parseAllFiles(ctx);
  const expected = {};
  for (const [id, rule] of ctx.ruleMap) {
    expected[id] = runRule({ rule, files, goal:0, options: {} }).measurements;
    assert.ok(expected[id].length > 0, `${id} must have positive violations`);
  }
  const { loadProject } = await import('../dist/engine/loadProject.js');
  const { scanProject } = await import('../dist/engine/scanProject.js');
  for (const jobs of [1, 2, 4]) {
    const result = await scanProject(await loadProject(roots[1]), jobs);
    assert.deepEqual(Object.fromEntries([...result].map(([id, aggregate]) => [id, aggregate.measurements])), expected);
  }
  console.log('PASS: prepared core AST + batched ESLint matches original for all 3 rules with positive violations, JSX, directives, malformed input and 1/2/4 workers');
} finally {
  await fs.rm(dir, { recursive:true, force:true });
}
