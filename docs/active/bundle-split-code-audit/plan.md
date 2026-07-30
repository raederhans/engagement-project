# Plan

## Goal

Reduce the initial production JavaScript cost without changing Crime or Diary behavior, then complete an evidence-backed repository review and fix only confirmed high-value issues.

## Scope

- Measure the current Vite output and map the entry/import graph.
- Establish regression checks for required lazy boundaries before changing production imports.
- Split optional Diary, charts, and other heavy feature code along existing runtime mode boundaries where safe.
- Review production code, scripts, build configuration, and CI for correctness, security, error handling, performance, and maintainability.
- Fix confirmed critical/high findings and narrow medium findings whose repair is low-risk and directly testable.
- Run local validation, browser smoke checks, independent review, GitHub integration, and Pages verification.

## Stages

- [x] Stage 1: Record bundle and runtime baselines; map heavy dependency owners.
- [x] Stage 2: Add failing boundary/regression tests and implement the smallest safe split.
- [x] Stage 3: Complete independent code and architecture reviews; reproduce findings.
- [x] Stage 4: Fix validated issues and run full local verification.
- [ ] Stage 5: Integrate, deploy, verify public behavior, and archive records.

## Acceptance criteria

- Initial production JavaScript no longer includes optional Diary-only code.
- Crime and Diary direct URLs still load and preserve their interactions.
- Existing data-source ordering, fallbacks, and truthful Diary persistence semantics remain unchanged.
- Bundle output has an explicit, explainable chunk structure and no new dependency.
- All critical/high review findings are fixed or explicitly shown to be false positives.
- Standard tests, build, dependency audit, browser checks, CI, and Pages deployment pass.
- Final report includes before/after bundle evidence and unresolved low-risk follow-ups.

## Non-goals

- No writable Diary backend.
- No framework migration, visual redesign, or broad API rewrite.
- No feature removal presented as performance work.
- No speculative caching or concurrency changes without runtime evidence.

## Risks

- Shared static and dynamic imports can prevent Vite from creating a real lazy boundary.
- Manual chunks can create dependency-order cycles or move rather than reduce startup work.
- Crime/Diary mode switching may require code that appears mode-specific at initial load.
- A smaller entry chunk can still regress total requests or interaction latency, so both modes require browser verification.
