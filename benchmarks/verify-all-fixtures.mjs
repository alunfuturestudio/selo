import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const workload = path.resolve(process.argv[2] ?? '/Users/sergio/workspace/lumina');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selo-all-equivalence-'));
const sources = {
  'blocks.ts': 'if (ready) {}\ntry { work(); } catch (e) {}\nswitch(x) {}',
  'catch.ts': 'try { work(); } catch (e) { throw e; } finally { cleanup(); }',
  'imports.ts': 'import {\n a,\n b,\n} from "x";',
  'disabled.ts': '/* eslint-disable no-empty */\nif (ready) {}\ntry { work(); } catch (e) { throw e; }',
  'inline-options.ts': '/* eslint no-empty: ["error", {"allowEmptyCatch":true}] */\ntry { work(); } catch (e) {}',
  'jsx.tsx': 'const View = () => <div onClick={() => click()}>{xs.map(x => <span>{x}</span>)}</div>;',
  'params.ts': 'const f = (x = () => 1) => x ? () => 2 : () => 3;',
  'class.ts': 'class X { @dec method(a,b,c,d,e) { if(a) { while(b) { if(c) return d; } } } #private() {} }',
  'namespace.ts': 'namespace X { export const f = (x = () => 1) => x(); }',
  'types.ts': 'interface I { a:string; b:number; f(x:number):void; } type F = (x:number)=>string;',
  'regex.ts': 'const r=/a+/gi; const n=1n; function f(){ return r.test("á"); }',
  'unicode.ts': 'const emoji="😀";\r\nfunction f(x:number) { return x; }\u2028const g=()=>f(1);',
  'shebang.ts': '#!/usr/bin/env node\nfunction f() {}',
  'switch.ts': 'function dispatch(shape) { switch(shape.kind) { case "circle": return round(); case "square": return box(); default: throw Error(); } }',
  'invalid.ts': 'const = ;',
};
try {
  const roots = [];
  for (const [name, packages] of [
    ['original', ['selo-solid', 'selo-eslint-raiz'].map(p=>path.join(workload,'node_modules',p,'dist/index.js'))],
    ['optimized', ['selo-solid', 'selo-eslint-raiz'].map(p=>path.join(root,'packs',p,'dist/index.js'))],
  ]) {
    const cwd=path.join(dir,name);roots.push(cwd);await fs.mkdir(cwd);
    for(const [file,text] of Object.entries(sources))await fs.writeFile(path.join(cwd,file),text);
    await fs.writeFile(path.join(cwd,'selo.config.mjs'),`
      import solid from ${JSON.stringify(pathToFileURL(packages[0]).href)};
      import eslint from ${JSON.stringify(pathToFileURL(packages[1]).href)};
      const packs=[solid,eslint];
      export default {files:['*.ts','*.tsx'],packs,rules:Object.fromEntries(packs.flatMap(p=>Object.keys(p.rules)).map(id=>[id,{goal:0}]))};
    `);
  }
  const original=await import('../benchmarks/original-dist/engine/loadProject.js');
  const {runRule}=await import('../benchmarks/original-dist/engine/runRule.js');
  const ctx=await original.loadProject(roots[0]);const files=await original.parseAllFiles(ctx);
  const expected=Object.fromEntries([...ctx.ruleMap].map(([id,rule])=>[id,runRule({rule,files,options:original.resolveOptions(rule,ctx.config.rules[id]),goal:0}).measurements]));
  for(const id of ['eslint/no-empty','eslint/no-useless-catch','eslint/object-curly-newline-imports'])assert.ok(expected[id].length>0,`fixture must trigger ${id}`);
  const {loadProject}=await import('../dist/engine/loadProject.js');
  const {scanProject}=await import('../dist/engine/scanProject.js');
  for(const backend of ['typescript','oxc'])for(const jobs of [1,2,4]) {
    const result=await scanProject(await loadProject(roots[1]),jobs,undefined,backend);
    assert.deepEqual(Object.fromEntries([...result].map(([id,a])=>[id,a.measurements])),expected);
  }
  console.log(`PASS: ${Object.keys(expected).length} original rules, ${Object.keys(sources).length} syntax fixtures, 2 backends, 1/2/4 workers; exact measurement order and values`);
} finally {await fs.rm(dir,{recursive:true,force:true});}
