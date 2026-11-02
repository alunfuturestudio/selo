import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '@typescript-eslint/parser';
import { parseFile } from '../src/engine/parse.js';

it('offers identical ASTs plus compatible parse data only when requested', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-parse-'));
  try {
    const filePath = path.join(dir, 'a.tsx');
    const source = 'export const View = () => <div />; // comment';
    await fs.writeFile(filePath, source);
    const legacy = await parseFile(filePath, dir);
    const prepared = await parseFile(filePath, dir, true);
    expect(legacy?.parserData).toBeUndefined();
    expect(prepared?.ast).toEqual(legacy?.ast);
    expect(prepared?.parserData).toMatchObject({ name: '@typescript-eslint/parser', source, jsx: true });
    expect((prepared?.parserData?.result as { ast: unknown }).ast).toBe(prepared?.ast);
    // Compare to the original parser API while excluding engine parent cycles.
    const withoutParents = (value: unknown) => JSON.parse(JSON.stringify(value, (key, v: unknown) => key === 'parent' ? undefined : v));
    expect(withoutParents(prepared?.ast)).toEqual(withoutParents(parse(source, {
      loc: true, range: true, comment: true, jsx: true, ecmaVersion: 'latest', sourceType: 'module',
    })));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('parse failures', () => {
  it('keeps invalid syntax skipped in prepared and legacy modes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-invalid-'));
    try {
      const file = path.join(dir, 'invalid.ts');
      await fs.writeFile(file, 'const = ;');
      expect(await parseFile(file, dir)).toBeNull();
      expect(await parseFile(file, dir, true)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
