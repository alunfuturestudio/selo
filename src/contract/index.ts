/**
 * The selo rule contract.
 *
 * A rule pack exports a set of `SeloRule`s. The selo engine loads the pack,
 * walks the project's files, parses each one, and asks every active rule
 * `measure(file, options)` — getting back zero or more `SeloMeasurement`s.
 *
 * The engine handles everything else: aggregating measurements across files,
 * computing worst/violationsVsGoal, applying the ratchet verdict, rendering
 * the seal message from `meta.seal` plus the measurement's `data`, and
 * bucketing for the histogram.
 *
 * The rule never talks to the developer directly — the seal message is a
 * template owned by the engine.
 */

export interface SeloFile {
  /** Project-relative path, e.g. `src/foo.ts`. Forward slashes on every OS. */
  path: string;
  /** The file's source text. */
  source: string;
  /** TS-ESTree AST with locations and parent links; tokens may be lazy. */
  ast: unknown;
  /** Optional engine-prepared parse for compatible adapters. Treat ASTs and this
   * data as read-only. Optional; consumers must support fallback when unavailable.
   */
  parserData?: {
    name: string;
    version: string;
    source: string;
    jsx: boolean;
    result: unknown;
  };
}

export interface SeloMeasurement {
  /**
   * For threshold rules: the measured numeric value of this unit (lines,
   * complexity, etc.).
   *
   * For count rules: always `1` — each measurement represents one violation.
   */
  value: number;
  /** Project-relative path the measurement belongs to. */
  file: string;
  /** Optional location of the unit within the file. */
  startLine?: number;
  endLine?: number;
  /** Human-readable identifier for the unit (function name, class name, ...). */
  name?: string;
  /**
   * Optional bag of values used to fill in the rule's `meta.seal` message
   * template. Keys are interpolated with `{{key}}` placeholders.
   */
  data?: Record<string, string | number>;
}

export type SeloRuleType = 'threshold' | 'count';

export interface SeloRuleMeta<O = unknown> {
  /** Stable rule id, namespaced. e.g. `srp/max-function-lines`. */
  id: string;
  /** One-line description of what the rule checks. */
  description: string;
  /**
   * `'threshold'`: each unit has a numeric value compared to the cap.
   *   Worst is the max value; violationsVsGoal is the count above the goal.
   * `'count'`: each violation is independent (no per-unit measurement).
   *   Worst is always 1; violationsVsGoal is just the violation count.
   */
  type: SeloRuleType;
  /** Short label used in histogram output. e.g. `lines/fn`, `methods`. */
  unitLabel: string;
  /**
   * Message template rendered when a unit violates the cap. Supports
   * `{{placeholders}}` filled in from a measurement's `data`.
   */
  seal: string;
  /** Default option object — used when the user doesn't pass one. */
  defaults?: O;
}

export interface SeloRule<O = unknown> {
  meta: SeloRuleMeta<O>;
  measure(file: SeloFile, options: O): SeloMeasurement[];
}

export interface SeloRulePack {
  /** Pack name, e.g. `selo-solid`. Used in the `selo packs` listing. */
  name: string;
  /** Pack version (typically the package's own version). */
  version: string;
  /** Rules keyed by `meta.id`. */
  rules: Record<string, SeloRule>;
}

/**
 * Render a seal message by interpolating `{{key}}` placeholders from `data`.
 * Unknown placeholders are left in place so missing data is visible during
 * development.
 */
export function renderSeal(template: string, data: Record<string, string | number> | undefined): string {
  if (!data) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const v = data[key];
    return v === undefined ? match : String(v);
  });
}
