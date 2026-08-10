# Plan

## Goal

Deliver Execution C's first architecture seam and a single-run, exact-artifact CI/Pages release gate without changing product behavior, UI copy, data semantics, bundle budgets, or dependency major versions.

## Scope

- Add a thin Crime state port with snapshot reads and named mutations for URL, preset, history restore, and map selection wiring.
- Remove the map layer's reverse dependency on Diary form submission by injecting a submit port from the Diary composition root.
- Add focused behavior and static boundary tests for the new ports.
- Add minimal ESLint flat config, Stylelint correctness config, and report-only Node coverage scripts.
- Make `ci.yml` the only main-push Pages release controller and deploy the artifact produced and verified in that same run.
- Align maintainer documentation with package scripts and workflow truth.

## Sources of truth

- Delegated Execution C brief from task `019fe6e5-80a1-7193-b0fb-9181daa9cb48`.
- Planning tasks `019fe976-ff92-7413-ae10-4ae24ac0ec1a` and `019fe97a-156e-77c0-b6e0-7cdde2e75410` as quoted in the brief.
- Repository behavior at baseline `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`.
- Current `package.json`, `.github/workflows/`, source modules, and executable test contracts.

## Stages

- [x] Stage 1: inventory state ownership, Diary submission coupling, tests, scripts, workflows, and docs.
- [x] Stage 2: implement Crime state and Diary submit ports with focused tests.
- [x] Stage 3: add static quality and report-only coverage entrypoints.
- [x] Stage 4: implement the single-run exact-artifact Pages gate, including non-cancelling main/Pages concurrency, and workflow contract tests.
- [x] Stage 5: align documentation and task records, then perform permitted static verification and handoff.
- [x] Stage 6: resolve the cross-line neutral Diary map-palette finding, expose both palette and B-owned Diary truth contracts through standard package entrypoints, execute the C-owned palette suite when the test slot is released, and require the integrated candidate to execute B's truth suite.

## Acceptance criteria

- Crime port actions preserve existing normalization, codec, URL output, and runtime behavior.
- `segments_layer.js` has no business import from `routes_diary/form_submit.js`; injected submission has positive and missing-port behavior tests.
- Lint and coverage scripts are real entrypoints; coverage remains report-only and explicitly excludes browser completeness claims.
- Deploy only runs for `push` to `main`, needs all release gates, consumes the same-run candidate artifact, has job-scoped Pages permissions, and refuses a superseded SHA.
- PR workflows may cancel stale PR checks; main release workflows and active Pages deploy jobs do not cancel in-progress work when a newer run arrives.
- Segment and route map rating colors preserve their existing thresholds/data fields while using the same neutral low-slate, middle-blue, high-violet ordering as B's reader-facing Diary ratings; no red/yellow/green risk/safety palette remains in those expressions.
- `npm test` reaches both the C-owned Diary palette contract and B-owned Diary truth contract through readable named scripts, without modifying B's test files.
- Documentation describes `validate` as the core gate and distinguishes additional release checks.
- No browser/visual baseline updates, budget increases, product copy changes, Git mutations, remote deployment, or GitHub settings changes.

## Non-goals

- No `src/ui/panel.js` migration in this batch.
- No MapLibre 6 or Vite major upgrade.
- No broad coordinator split, production data change, UI redesign, or private Diary data movement into URL/session/network.
- No commit, push, branch/ref mutation, worktree integration/cleanup, deployment, or repository settings change.

## Risks and constraints

- The dependency/install and non-browser slot was formally handed to Execution C, completed, and released; this review repair must not reacquire it or run install/build/browser/visual/full validation.
- Execution B released the non-browser short-test slot after its authorized suites; C then ran only the authorized palette contract and related static checks, confirmed scoped node/npm count zero, and released the slot.
- Shared ownership files such as package metadata, workflows, and documentation require an explicit overlap scan before integration.
