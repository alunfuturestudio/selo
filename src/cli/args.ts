import * as path from 'node:path';
import { availableParallelism } from 'node:os';
import type { ParserBackend } from '../engine/parse.js';

export interface CommonArgs {
  cwd: string | undefined;
  positional: string[];
  jobs: number;
  parser: ParserBackend;
}

export function parseCommonArgs(rest: string[]): CommonArgs {
  const out: CommonArgs = { cwd: undefined, positional: [], parser: 'oxc', jobs: Math.min(availableParallelism(), 8) };
  let automaticJobs = true;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--cwd') {
      const v = rest[++i];
      if (v !== undefined) out.cwd = path.resolve(v);
      continue;
    }
    if (a === '--parser') {
      const value = rest[++i];
      if (value !== 'typescript' && value !== 'oxc') throw new Error('selo: --parser requires typescript or oxc');
      out.parser = value;
      continue;
    }
    if (a === '--jobs') {
      const value = rest[++i];
      const jobs = value === 'auto' ? Math.min(availableParallelism(), 4) : Number(value);
      if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) throw new Error('selo: --jobs requires an integer from 1 to 32, or auto');
      out.jobs = jobs;
      automaticJobs = value === 'auto';
      continue;
    }
    if (a !== undefined) out.positional.push(a);
  }
  if (automaticJobs) out.jobs = Math.min(availableParallelism(), out.parser === 'oxc' ? 8 : 4);
  return out;
}
