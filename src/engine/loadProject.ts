import * as path from 'node:path';
import { findConfigFile, loadConfig } from '../config/load.js';
import type { SeloConfig, RuleConfig } from '../config/types.js';
import type { SeloRule } from '../contract/index.js';
import { discoverFiles } from './discover.js';
import { parseFile } from './parse.js';
import type { SeloFile } from '../contract/index.js';

export interface ProjectContext {
  cwd: string;
  config: SeloConfig;
  ruleMap: Map<string, SeloRule>;
  filesAbsolute: string[];
}

export async function loadProject(cwd: string, knownFiles?: string[]): Promise<ProjectContext> {
  const configPath = await findConfigFile(cwd);
  if (!configPath) {
    throw new Error(`selo: no selo.config.{mjs,js,ts,json} found in ${cwd}`);
  }
  const config = await loadConfig(configPath);
  const ruleMap = new Map<string, SeloRule>();
  for (const pack of config.packs) {
    for (const [id, rule] of Object.entries(pack.rules)) {
      if (id !== rule.meta.id) {
        throw new Error(
          `selo: rule registered under '${id}' but its meta.id is '${rule.meta.id}' (${pack.name})`,
        );
      }
      if (ruleMap.has(id)) {
        throw new Error(`selo: rule id '${id}' registered by more than one pack`);
      }
      ruleMap.set(id, rule);
    }
  }
  const filesAbsolute = knownFiles ?? await discoverFiles({
    cwd,
    files: config.files,
    ignore: config.ignore,
  });
  return { cwd, config, ruleMap, filesAbsolute };
}

export async function parseAllFiles(ctx: ProjectContext): Promise<SeloFile[]> {
  const out: SeloFile[] = [];
  await Promise.all(
    ctx.filesAbsolute.map(async (abs) => {
      const f = await parseFile(abs, ctx.cwd);
      if (f) out.push(f);
    }),
  );
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function filesForRule(allFiles: SeloFile[], ruleCfg: RuleConfig): SeloFile[] {
  const exempt = new Set(ruleCfg.exempt ?? []);
  if (exempt.size === 0) return allFiles;
  return allFiles.filter((f) => !exempt.has(f.path));
}

export function resolveOptions<O>(rule: SeloRule<O>, ruleCfg: RuleConfig): O {
  const explicit = ruleCfg.options as O | undefined;
  if (explicit !== undefined) return explicit;
  return (rule.meta.defaults ?? ({} as O)) as O;
}

export function projectRoot(cwd: string | undefined): string {
  return cwd ? path.resolve(cwd) : process.cwd();
}
