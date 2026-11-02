import type { SeloFile, SeloMeasurement, SeloRule, SeloRuleType } from '../contract/index.js';

export interface RuleAggregate {
  measurements: SeloMeasurement[];
  worst: number;
  /** count of measurements with `value > goal` for threshold rules; total count for count rules. */
  violationsVsGoal: number;
  offendersOver(threshold: number): SeloMeasurement[];
}

export interface RunRuleParams {
  rule: SeloRule;
  options: unknown;
  files: SeloFile[];
  goal: number;
}

export function runRule(params: RunRuleParams): RuleAggregate {
  const { rule, options, files, goal } = params;
  const out: SeloMeasurement[] = [];
  for (const file of files) {
    let measured: SeloMeasurement[];
    try {
      measured = rule.measure(file, options);
    } catch {
      continue;
    }
    out.push(...measured);
  }
  return aggregateMeasurements(out, rule.meta.type, goal);
}

export function aggregateMeasurements(out: SeloMeasurement[], type: SeloRuleType, goal: number): RuleAggregate {
  let worst = out.length === 0 ? 0 : -Infinity;
  let violationsVsGoal = 0;
  for (const measurement of out) {
    worst = Math.max(worst, measurement.value);
    if (type === 'count' || measurement.value > goal) violationsVsGoal++;
  }
  return {
    measurements: out,
    worst,
    violationsVsGoal,
    offendersOver(threshold: number): SeloMeasurement[] {
      return out
        .filter((m) => m.value > threshold)
        .sort((a, b) => b.value - a.value);
    },
  };
}
