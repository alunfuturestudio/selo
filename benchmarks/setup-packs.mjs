import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const links = [
  [path.join(root, 'node_modules/@guilhermesilveira/selo'), '../..'],
  ...['selo-solid', 'selo-eslint-raiz'].map(name => [path.join(root, 'packs', name, 'node_modules'), '../../node_modules']),
];
for (const [link, target] of links) {
  try {
    await fs.lstat(link);
    console.log(`Preserved existing ${link}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(target, link, 'dir');
    console.log(`Linked ${link}`);
  }
}
