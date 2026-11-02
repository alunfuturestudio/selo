# Changelog

All notable changes to `@guilhermesilveira/selo` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/) — pre-1.0 the contract is allowed to break in `MINOR` bumps.

## [Unreleased]

### Changed

- Native Oxc parsing and bounded streaming workers are now the default. Preserve deterministic measurement order and baseline behavior; retain TypeScript for syntax/lexical/ESLint compatibility. Node support is now `^20.19.0 || >=22.12.0`.
- Add `--jobs N|auto` and a diagnostic `--parser typescript` backend. No persistent cache.


- **`selo check`, baseline blessing** — improvements now tighten `current` by default, not only `worst` / `violationsVsGoal`, so `selo get-maxes` sees the lower cap immediately. Any baseline write exits non-zero so the generated `selo.baseline.json` diff must be reviewed and committed.

### Added

- **`selo check --dont-bless-baseline`** — read-only check mode for CI or diagnostics that should report seeds/improvements/regressions without writing `selo.baseline.json`.

## [0.1.0] — 2026-04-29

### Changed

- **Verdict, count rules** — count rules now ratchet on `violationsVsGoal` (the violations cap) rather than on the per-unit `value`, which was always 1 and made the ratchet meaningless. `migrateBaseline()` snaps stale baselines (`current < violationsVsGoal`) up to the new format on first run, persisted. Closes [#2](https://github.com/guilhermesilveira/selo/issues/2). ([60f4614](https://github.com/guilhermesilveira/selo/commit/60f4614))
- **Verdict, arrived state** — once `current ≤ goal`, regressions return to goal immediately with no step-tightening regardless of overshoot magnitude. `current` is now clamped at `goal` from below at seed and bless time — historical lows aren't promoted to a contract. ([981dd28](https://github.com/guilhermesilveira/selo/commit/981dd28))

### Fixed

- **`selo check` improved-branch message** — `prev` was captured *after* the baseline write, so the message always read `worst N→N`. Now captured before. ([60f4614](https://github.com/guilhermesilveira/selo/commit/60f4614))

### Added

- **Parent links on parsed AST** — `parseFile` walks the AST after parsing and attaches `parent` references. Rule packs that need to walk up the tree (e.g. to find a function's enclosing class or extract a name from a `VariableDeclarator`) get them for free. ([84c70ff](https://github.com/guilhermesilveira/selo/commit/84c70ff))

## [0.0.1] — Initial release

- Linter engine: file walker (`globby` + `.gitignore`), parser (`@typescript-eslint/parser`), `runRule`, seal-message renderer, project bootstrap.
- Ratchet machinery: pure step math, `selo.baseline.json` I/O, verdict algorithm (seeded / arrived / arrivedFailed / flat / improved / regressed).
- Config loader for `selo.config.{mjs,js,ts,json}`.
- CLI commands: `selo check`, `selo bless-current`, `selo get-maxes`, `selo histogram`.
- Public exports for rule-pack authors via the `SeloRule` / `SeloMeasurement` / `SeloFile` / `SeloRulePack` contract.
