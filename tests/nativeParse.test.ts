import { describe, expect, it } from 'vitest';
import { parseNativeSource } from '../src/engine/nativeParse.js';
import { parseSource } from '../src/engine/parse.js';

const snippets = [
  'const emoji = "😀";\r\nfunction f(x: number) { return x; }',
  'const text = "á";\u2028function f() { return 1; }',
  'const f = () => <div onClick={() => first()}>{items.map(x => <span>{x}</span>)}</div>;',
  'class X { @dec method(x: number) { return x; } #private() {} }',
  'namespace X { export const f = (x = () => 1) => x(); }',
  'interface I { x: string; f(x: number): void; } type F = (x: number) => string;',
  'const regex = /a+/gi; const n = 1n;',
  '#!/usr/bin/env node\nfunction f() {}',
  'const f = (x = () => 1) => x ? () => 2 : () => 3;',
];
function functions(ast: unknown) {
  const out: unknown[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(String(node.type))) out.push({ type: node.type, loc: node.loc, range: node.range });
    for (const key of Object.keys(node)) {
      if (['parent', 'loc', 'range', 'comments', 'tokens'].includes(key)) continue;
      visit(node[key]);
    }
  };
  visit(ast);
  return out;
}

describe('native parser adapter', () => {
  it.each(snippets)('preserves function positions and traversal order for %s', (source) => {
    const native = parseNativeSource(source, '/project/a.tsx', '/project', true)!;
    const original = parseSource(source, true);
    expect(functions(native.ast)).toEqual(functions(original.ast));
    expect(native.path).toBe('a.tsx');
    expect(native.source).toBe(source);
    const withoutParents = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item: unknown) => key === 'parent' ? undefined : item));
    expect(withoutParents((native.ast as { tokens: unknown }).tokens)).toEqual(withoutParents(original.ast.tokens));
    expect(withoutParents((native.parserData!.result as typeof original).ast.tokens)).toEqual(withoutParents(original.ast.tokens));
  });

  it('keeps malformed source skipped', () => {
    expect(parseNativeSource('const = ;', '/p/a.ts', '/p', true)).toBeNull();
  });

  it('preserves RegExp literal values', () => {
    const ast = parseNativeSource('const regex = /a+/gi;', '/p/a.ts', '/p', false)!.ast as { body: { declarations: { init: { value: unknown } }[] }[] };
    expect(ast.body[0]!.declarations[0]!.init.value).toEqual(/a+/gi);
  });
});
