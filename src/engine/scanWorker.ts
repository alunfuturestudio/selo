import { parentPort, workerData } from 'node:worker_threads';
import { loadProject } from './loadProject.js';
import type { ParserBackend } from './parse.js';
import { scanFiles } from './scanProject.js';

const { cwd, files, ruleIds, fileIndices, backend } = workerData as { cwd: string; files: string[]; ruleIds: string[]; fileIndices: number[]; backend: ParserBackend };
const ctx = await loadProject(cwd, files);
const measurements = await scanFiles({ ...ctx, filesAbsolute: files }, ruleIds, fileIndices, backend);
parentPort!.postMessage(measurements);
