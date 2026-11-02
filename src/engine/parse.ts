import { parseForESLint, version as parserVersion } from '@typescript-eslint/parser';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SeloFile } from '../contract/index.js';

export type ParserBackend = 'typescript' | 'oxc';

export function parseSource(source: string, isJsx: boolean): ReturnType<typeof parseForESLint> {
  return parseForESLint(source, {
    loc: true, range: true, comment: true, jsx: isJsx,
    ecmaVersion: 'latest', sourceType: 'module',
  });
}

export function fileFromParsed(
  source: string, absolutePath: string, projectRoot: string,
  parsed: ReturnType<typeof parseForESLint>, retainParserData: boolean,
): SeloFile {
  const ast = parsed.ast;
  setParents(ast, null);
  const jsx = absolutePath.endsWith('.tsx') || absolutePath.endsWith('.jsx');
  return {
    path: path.relative(projectRoot, absolutePath).replaceAll(path.sep, '/'), source, ast,
    ...(retainParserData ? { parserData: { name: '@typescript-eslint/parser', version: parserVersion, source, jsx, result: parsed } } : {}),
  };
}

export async function parseFile(
  absolutePath: string, projectRoot: string, retainParserData = false, backend: ParserBackend = 'typescript',
): Promise<SeloFile | null> {
  const source = await fs.readFile(absolutePath, 'utf8');
  if (backend === 'oxc') {
    const { parseNativeSource } = await import('./nativeParse.js');
    return parseNativeSource(source, absolutePath, projectRoot, retainParserData);
  }
  let parsed: ReturnType<typeof parseForESLint>;
  try { parsed = parseSource(source, /\.[jt]sx$/.test(absolutePath)); }
  catch { return null; }
  return fileFromParsed(source, absolutePath, projectRoot, parsed, retainParserData);
}

/**
 * @typescript-eslint/parser does not attach `parent` references by default.
 * Rule authors very often need them (to find a function's enclosing class,
 * etc.), so we walk the AST once after parsing and set them.
 *
 * The walker skips `parent`, `loc`, and `range` keys to avoid cycles and
 * irrelevant traversal.
 */
export function setParents(node: unknown, parent: unknown): void {
  if (Array.isArray(node)) {
    for (const c of node) setParents(c, parent);
    return;
  }
  if (!node || typeof node !== 'object') return;
  (node as { parent?: unknown }).parent = parent;
  const obj = node as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (k === 'parent' || k === 'loc' || k === 'range') continue;
    setParents(obj[k], node);
  }
}
