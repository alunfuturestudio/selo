import { pathToFileURL } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'selo-solid' && process.env.SELO_BENCH_SOLID) {
    return { url: pathToFileURL(process.env.SELO_BENCH_SOLID).href, shortCircuit: true };
  }
  if (specifier === 'selo-eslint-raiz' && process.env.SELO_BENCH_PACK) {
    return { url: pathToFileURL(process.env.SELO_BENCH_PACK).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
