import { describe, expect, it } from 'vitest';
import { parseCheckArgs } from '../src/cli/check.js';

describe('parseCheckArgs', () => {
  it('enables native streaming and respects explicit worker count', () => {
    expect(parseCheckArgs(['--parser', 'oxc']).parser).toBe('oxc');
    expect(parseCheckArgs(['--parser', 'oxc']).jobs).toBeGreaterThanOrEqual(1);
    expect(parseCheckArgs(['--parser', 'oxc', '--jobs', '2']).jobs).toBe(2);
    expect(parseCheckArgs(['--jobs', 'auto', '--parser', 'oxc']).jobs).toBeLessThanOrEqual(8);
  });
  it.each(['bad', ''])('rejects an unknown parser %s', (value) => {
    expect(() => parseCheckArgs(['--parser', value])).toThrow('--parser');
  });
  it.each(['1', '2', '4', '32'])('accepts bounded worker count %s', (value) => {
    expect(parseCheckArgs(['--jobs', value, '--dont-bless-baseline'])).toMatchObject({ jobs: Number(value), blessBaseline: false });
  });
  it('accepts automatic worker count', () => {
    const { jobs } = parseCheckArgs(['--jobs', 'auto']);
    expect(jobs).toBeGreaterThanOrEqual(1);
    expect(jobs).toBeLessThanOrEqual(8);
  });
  it.each([[], ['0'], ['-1'], ['33'], ['1.5'], ['garbage']])('rejects invalid worker arguments %j', (...values) => {
    expect(() => parseCheckArgs(['--jobs', ...values])).toThrow('--jobs');
  });
  it('blesses the baseline by default', () => {
    expect(parseCheckArgs([])).toMatchObject({
      cwd: undefined,
      blessBaseline: true,
      parser: 'oxc',
    });
  });

  it('can disable baseline blessing', () => {
    expect(parseCheckArgs(['--cwd', '/tmp/project', '--dont-bless-baseline'])).toMatchObject({
      cwd: '/tmp/project',
      blessBaseline: false,
    });
  });
});
