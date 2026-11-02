import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ref = process.argv[2] ?? '9c82a92';
const output = path.resolve(process.argv[3] ?? path.join(root, 'benchmarks/original-dist'));
try { await fs.access(output); throw new Error(`Refusing to overwrite ${output}; choose another output path`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-reference-'));
try {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'src', 'tsconfig.json', 'package.json'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const file of files) {
    const target = path.join(tmp, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, execFileSync('git', ['show', `${ref}:${file}`], { cwd: root }));
  }
  await fs.symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(tmp, 'tsconfig.json')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Reference build failed');
  await fs.cp(path.join(tmp, 'dist'), output, { recursive: true, errorOnExist: true, force: false });
  console.log(`Built untouched ${ref} into ${output}`);
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
