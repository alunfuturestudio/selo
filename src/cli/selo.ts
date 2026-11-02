#!/usr/bin/env node
import { runBlessCurrent } from './blessCurrent.js';
import { runCheck } from './check.js';
import { runGetMaxes } from './getMaxes.js';
import { runHistogram } from './histogram.js';

function printUsage(): void {
  process.stdout.write(
    'selo — usage:\n' +
      '  selo check [--cwd <dir>] [--dont-bless-baseline] [--jobs N|auto] [--parser typescript|oxc]\n' +
      '                                          verify the codebase and bless safe baseline improvements by default\n' +
      '  native parser + bounded workers by default; --jobs controls concurrency\n' +
      '  selo bless-current [--cwd <dir>]         write today\'s state to baseline (skip rules where it would worsen)\n' +
      '  selo get-maxes [--cwd <dir>]             JSON of {ruleId: current} for syncing external lint configs\n' +
      '  selo histogram <rule-id> [--cwd <dir>]   distribution of a threshold rule\n',
  );
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    printUsage();
    return;
  }
  if (cmd === 'check') return runCheck(rest);
  if (cmd === 'bless-current') return runBlessCurrent(rest);
  if (cmd === 'get-maxes') return runGetMaxes(rest);
  if (cmd === 'histogram') return runHistogram(rest);
  process.stderr.write(`selo: unknown command '${cmd}'\n\n`);
  printUsage();
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`selo: ${msg}\n`);
  process.exit(1);
});
