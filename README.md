# selo

> _selo de qualidade guilherme raiz_ — a small linter built around a goal-driven, deterministic ratchet. Rules return per-unit measurements; the engine handles ratcheting toward a goal you set.

This README is **agent-first**. Read top to bottom.

---

## Human explanation

**Continuous improvement, never regression.** You set a quality goal you don't yet meet — say, "no function over 80 lines" — and start moving toward it without breaking the build today. selo measures your codebase as it is and seeds a baseline. From then on each commit either holds the line, improves it (the baseline auto-tightens to lock the gain in), or makes things worse. Regressions fail. Baseline writes also exit non-zero so the generated `selo.baseline.json` diff is noticed, reviewed, and committed. When you do force a regression, the rule responds by tightening the active threshold one step closer to the goal. The migration is monotonic: the codebase can never get further from the goal than its committed baseline, and the build verdict is a pure function of code + baseline files — no clock, no git history, no surprise reruns.

**A small linter, not yet another ESLint plugin.** selo is its own linter. Rules implement a contract that returns per-unit measurements directly — `{value, file, startLine, name, data}` — so the engine never has to reconstruct numeric values from rendered messages. That keeps the ratchet deterministic, the histogram universal, and the seal-message rendering owned by the engine. Rules ship as **packs**, listed below.

---

## Rule packs

selo on its own does nothing — it loads rule packs. The two officially-maintained packs:

| Pack | Repo | npm | Ships |
|---|---|---|---|
| **selo-solid** | [github.com/guilhermesilveira/selo-solid](https://github.com/guilhermesilveira/selo-solid) | `selo-solid` | 8 SOLID-alike rules native to selo (`srp/max-file-lines`, `srp/max-function-lines`, `srp/max-params`, `srp/max-depth`, `srp/max-statements-per-function`, `srp/max-cyclomatic-complexity`, `srp/max-class-methods`, `ocp/no-type-discriminating-switch`). Start here. |
| **selo-eslint-raiz** | [github.com/guilhermesilveira/selo-eslint-raiz](https://github.com/guilhermesilveira/selo-eslint-raiz) | `selo-eslint-raiz` | Three core ESLint rules wrapped (`no-empty`, `no-useless-catch`, `object-curly-newline`-imports), plus a generic `shimEslintRule()` helper for porting any other ESLint rule into the contract. A demo of the shim pattern as much as a useful pack. |

Writing your own pack is straightforward — see [Rule contract](#the-rule-contract) below.

---

## Agent: help me install this

Runbook for installing selo into a user's project. Each step's outcome is verifiable.

### 1. Install the engine + rule packs

```sh
npm install --save-dev @guilhermesilveira/selo selo-solid
```

(Use `selo-eslint-raiz` too if you want shimmed ESLint built-ins.)

### 2. Write `selo.config.mjs` at the project root

```js
import solid from 'selo-solid';

export default {
  packs: [solid],
  rules: {
    'srp/max-function-lines':         { goal: 80 },
    'srp/max-cyclomatic-complexity':  { goal: 15 },
    'srp/max-class-methods':          { goal: 10 },
    'srp/max-statements-per-function':{ goal: 30 },
    'ocp/no-type-discriminating-switch': { exempt: [] },
  },
};
```

### 3. Seed the baseline

```sh
npx selo check
```

First run writes `selo.baseline.json` with today's worst per rule and exits non-zero to make the new baseline visible (`seeded ...`). Commit that file. Re-running `selo check` should print `flat` for every rule and exit 0.

### 4. Wire pre-commit + CI

Add `npx selo check` to whatever pre-commit hook the project already has. For read-only CI, use `npx selo check --dont-bless-baseline`; for CI that is allowed to fail when the baseline should be committed, use plain `npx selo check`.

### 5. (If OCP fires on legacy code) exempt those files

Add their relative paths to the `exempt` array in `selo.config.mjs`, re-run `selo check`. Refactor and remove from the list in follow-up commits.

### 6. Commit

```
selo.config.mjs
selo.baseline.json
package.json + package-lock.json
```

The codebase is now under selo.

---

## The rule contract

A rule pack exports a `SeloRulePack`. Each rule in the pack implements:

```ts
interface SeloRule<Options = unknown> {
  meta: {
    id: string;                 // 'srp/max-function-lines'
    description: string;
    type: 'threshold' | 'count';
    unitLabel: string;          // 'lines/fn', 'methods', 'todos'
    seal: string;               // message template, supports {{placeholders}}
    defaults?: Options;
  };
  measure(file: SeloFile, options: Options): SeloMeasurement[];
}

interface SeloMeasurement {
  value: number;                // threshold: the value; count: 1
  file: string;
  startLine?: number;
  endLine?: number;
  name?: string;
  data?: Record<string, string | number>;
}

interface SeloFile {
  path: string;                 // project-relative
  source: string;
  ast: unknown;                 // TS-ESTree AST; lexical tokens may be lazy
}
```

`type: 'threshold'` rules report a numeric value per unit; the engine computes `worst` and `violationsVsGoal = count(value > goal)`. Histogram is meaningful.

`type: 'count'` rules report once per violation, always with `value: 1`. `worst` is meaningless; `violationsVsGoal` is the violation count.

The `seal` string is a message template with `{{key}}` placeholders filled in from each measurement's `data` at render time. The rule never talks to the developer directly — the engine renders.

---

## CLI

All commands accept `--cwd <dir>`; default is `process.cwd()`.

### `selo check [--dont-bless-baseline]`

The verifier. Run in pre-commit and CI.

- Reads `selo.config.{mjs,js,ts,json}` and `selo.baseline.json`.
- For each ruleable rule (one with a `goal`): measure, compare, apply the verdict.
- Seeds on first run for any rule missing from baseline.
- Auto-updates baseline downward on improvement, including `current`, so `selo get-maxes` sees the tighter cap.
- **Exits 1 on regression or when it writes the baseline.** If the only issue is a baseline write, review and commit `selo.baseline.json`, then rerun.
- `--dont-bless-baseline` makes the command read-only: it reports seeds/improvements/regressions but does not write `selo.baseline.json`.

### Native parsing and bounded parallelism

`selo check` uses the native Oxc parser and bounded file-at-a-time workers by
default. There is **no persistent cache**. Every invocation scans the full
workload and applies the unchanged baseline/ratchet algorithm.

```sh
selo check --dont-bless-baseline          # native parser, automatic worker count
selo check --dont-bless-baseline --jobs 2 # useful on small CI machines
selo check --parser typescript --jobs 1   # compatibility/diagnostic backend
```

`--jobs 1` streams one file at a time; `--jobs N` uses 1–32 workers. `auto` uses
at most 8 workers with Oxc, or 4 with TypeScript, respecting available CPUs.
Measurements merge in the original file/rule order. More workers use more memory.
Rules must be deterministic and file-independent, and treat ASTs as read-only.
Config modules load once per worker. A rule must not rely on mutable state shared
between files or on another rule having processed the entire project first.

Oxc's TS-ESTree adapter preserves source positions and structural traversal
order. Lexical tokens and ESLint scopes remain available on demand through the
original parser. Native parse errors and unsupported import proposals fall back
to that parser. Lumina and syntax fixtures compare complete measurements; new
third-party packs should validate their AST assumptions. Updated `selo-solid`
skips lexical metadata in structural walks, and updated `selo-eslint-raiz` shares
ESLint work per file. These pack changes are required for the measured speedup.

Node **20.19+ or 22.12+** is required by the native binding (a runtime support
change from 0.1.1). Keep native platform packages installed; omitting optional
platform bindings prevents the native backend from loading. The TypeScript
backend is retained for diagnostics, not used by the normal execution path
unless a syntax/lexical/ESLint fallback requires it.

Worker/parser flags also apply to `bless-current` and `histogram`. See the
[performance investigation](benchmarks/REPORT.md) for reproducible measurements.

### `selo bless-current`

Records today's measurements as the new baseline `current` / `worst` / `violationsVsGoal`.

- **Never worsens.** If a rule's measurement would make the baseline worse, that rule is silently skipped — no error, no failure, no write.
- Goal is never touched.

### `selo get-maxes`

Emits a JSON object of `{ruleId: current}` from `selo.baseline.json`, filtered to rules in `selo.config`. Useful for syncing external lint configs (e.g. an ESLint rule's `max` option) against the seeded current.

### `selo histogram <rule-id>`

Distribution of a threshold rule. Buckets every measured unit relative to the cap (current or goal). Lets you see *shape* — long tail, bulk, regression direction. The bucket just past the cap is usually the cheapest set of wins.

Count rules don't have meaningful histograms, so the command refuses for them.

---

## Configuration

`selo.config.{mjs,js,ts,json}`:

```ts
interface SeloConfig {
  packs: SeloRulePack[];
  rules: Record<string, RuleConfig>;
  files?: string[];     // default ['**/*.{ts,tsx,js,jsx,mjs,cjs}']
  ignore?: string[];    // added to built-in defaults (node_modules, dist, ...)
}

interface RuleConfig {
  goal?: number;        // required for threshold rules
  step?: number;        // default 0.01
  exempt?: string[];    // project-relative paths to skip
  options?: unknown;    // rule-specific
}
```

`selo.baseline.json` (CLI-managed):

```json
{
  "srp/max-function-lines": {
    "current": 904,
    "worst": 904,
    "violationsVsGoal": 297
  }
}
```

---

## Verdict algorithm

```
measure → (nowWorst, nowViolations)

if no baseline entry → SEED: write {current: nowWorst, worst, violationsVsGoal}; exit 1 so the file is committed

if stored.current <= goal → "arrived"
    fail iff any unit > current

else (still ratcheting):
    if nowWorst > stored.worst OR nowViolations > stored.violationsVsGoal
        newCurrent = current - max(1, ceil(step * (current - goal)))   // clamped to goal
        FAIL with: "tighten current to newCurrent, fix N units, then run `selo check`"
    elif nowWorst < stored.worst OR nowViolations < stored.violationsVsGoal
        improved → update current/worst/violationsVsGoal downward; exit 1 so the file is committed
    else
        flat → exit 0
```

Pure function of (code + committed baseline). No clock, no git history. Same input → same verdict, always.

---

## Layout

```
src/
  contract/index.ts        SeloRule / SeloMeasurement / SeloFile / renderSeal
  config/load.ts           dynamic-import selo.config.{mjs,js,ts,json}
  config/types.ts
  engine/discover.ts       globby + .gitignore-aware file discovery
  engine/parse.ts          @typescript-eslint/parser wrapper
  engine/runRule.ts        runs measure() across files, aggregates worst/violations
  engine/loadProject.ts    one-shot project bootstrap for the CLI
  engine/render.ts         seal-message rendering for offender lists
  ratchet/step.ts          ratchet math (pure)
  ratchet/baseline.ts      selo.baseline.json I/O
  ratchet/verdict.ts       the algorithm
  cli/selo.ts              dispatcher
  cli/check.ts
  cli/blessCurrent.ts
  cli/getMaxes.ts
  cli/histogram.ts
  cli/args.ts              shared arg parser
  index.ts                 public exports for rule-pack authors
tests/
  step.test.ts             ratchet math
  verdict.test.ts          verdict cases
  integration.test.ts      end-to-end fixture rule
```

---

## Releasing

Manual SemVer release flow. While we're pre-1.0, `MINOR` bumps may introduce breaking changes (per the SemVer 0.x carve-out); track them in `CHANGELOG.md`.

```sh
# 1. Move the [Unreleased] block in CHANGELOG.md under a new
#    `## [<version>] — YYYY-MM-DD` heading.
# 2. Bump the version + commit + tag in one shot:
npm version patch     # 0.0.1 → 0.0.2 (fix-level)
# or  npm version minor   # 0.0.1 → 0.1.0 (feature, possible breaking pre-1.0)

# 3. Push the commit and the tag together:
git push --follow-tags

# 4. Publish (one-time `npm login` first; scoped packages need --access public):
npm publish --access public
```

The `prepublishOnly` script enforces `npm run build && npm test && npm run lint` before any publish, so a broken state can't ship.

### Engine releases first

`selo` is the upstream of the rule contract. When you change anything in `src/contract/index.ts`, in the verdict algorithm, or in the CLI's input/output shape:

1. Release the engine bump from this repo first.
2. In each rule pack ([selo-solid](https://github.com/guilhermesilveira/selo-solid), [selo-eslint-raiz](https://github.com/guilhermesilveira/selo-eslint-raiz)), update the `peerDependencies."@guilhermesilveira/selo"` range to require the new version, run the test suite against it, and release the pack.

This ordering means a pack on npm always works against at least one published engine version.

---

## Determinism contract

The verdict of `selo check` is a pure function of (a) the source code currently on disk and (b) the committed `selo.baseline.json` and `selo.config.*`. No clock, no git history, no environment variables, no random seeds.

Every counter / threshold / accepted-state advance lives inside the committed JSON files and is advanced only by an explicit action (`selo bless-current` or default `selo check` blessing). Use `selo check --dont-bless-baseline` when a CI job must be strictly read-only.

If you find yourself wanting `Date.now()`, a SHA, a merge-base diff, or anything that varies between runs at the same code state — stop. The mechanism you want should advance the JSON state instead.
