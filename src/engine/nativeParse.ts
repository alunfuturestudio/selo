import * as path from 'node:path';
import { version as parserVersion } from '@typescript-eslint/parser';
import { parseSync } from 'oxc-parser';
import type { SeloFile } from '../contract/index.js';
import { fileFromParsed, parseSource, setParents } from './parse.js';

/** Default native backend. Preserve source positions and the legacy
 * child-property traversal order used by rule packs. Lexical tokens and ESLint
 * scopes remain available lazily through the original parser.
 */
export function parseNativeSource(
  source: string, absolutePath: string, projectRoot: string, retainParserData: boolean,
): SeloFile | null {
  const jsx = /\.[jt]sx$/.test(absolutePath);
  const parsed = parseSync(absolutePath, source, {
    lang: jsx ? 'tsx' : 'ts', sourceType: 'module', astType: 'ts', range: true, preserveParens: false,
  });
  if (parsed.errors.length > 0 || /\bimport\s*(?:\.\s*(?:source|defer)|\s+(?:source|defer)\b)/.test(source)) {
    // New/proposal syntax and native parse errors keep the original verdict.
    let fallback: ReturnType<typeof parseSource>;
    try { fallback = parseSource(source, jsx); }
    catch { return null; }
    return fileFromParsed(source, absolutePath, projectRoot, fallback, retainParserData);
  }
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 13) {
      if (source.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) starts.push(index + 1);
  }
  const position = (offset: number) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid;
    }
    return { line: low + 1, column: offset - starts[low]! };
  };
  const normalize = (value: unknown, parent: unknown): unknown => {
    if (Array.isArray(value)) return value.map((child) => normalize(child, parent));
    if (!value || typeof value !== 'object') return value;
    if (value instanceof RegExp) return value;
    const node = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // typescript-estree's child fields are alphabetical. Metadata location
    // varies by node type but never contributes structural children.
    for (const key of Object.keys(node).sort()) {
      if (key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'parent') continue;
      out[key] = normalize(node[key], out);
    }
    out.parent = parent;
    if (typeof node.start === 'number' && typeof node.end === 'number') {
      out.range = [node.start, node.end];
      out.loc = { start: position(node.start), end: position(node.end) };
    }
    return out;
  };
  const ast = normalize(parsed.program, null) as Record<string, unknown>;
  ast.comments = normalize(parsed.comments, ast);
  let legacy: ReturnType<typeof parseSource> | undefined;
  const originalParse = () => legacy ??= parseSource(source, jsx);
  let tokensAttached = false;
  Object.defineProperty(ast, 'tokens', { enumerable: true, get: () => {
    const tokens = originalParse().ast.tokens;
    if (!tokensAttached) { setParents(tokens, ast); tokensAttached = true; }
    return tokens;
  } });
  return {
    path: path.relative(projectRoot, absolutePath).replaceAll(path.sep, '/'), source, ast,
    ...(retainParserData ? {
      parserData: {
        name: '@typescript-eslint/parser', version: parserVersion, source, jsx,
        get result() { return originalParse(); },
      },
    } : {}),
  };
}
