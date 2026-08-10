# P0 Maintenance Plan

## Goal

Restore safe Route corridor bundle headroom, upgrade the two pinned `actions/upload-artifact` uses to the verified Node 24-compatible major, and leave a minimal explicit Source Health observation registration seam for B8/B9/B10 without changing current observations.

## Scope

- Reduce `src/routes_crime/route_corridor_app_loader.js` and its direct glue without changing lazy-loading or Known Route/HIN behavior.
- Update both upload-artifact workflow uses, the exact-SHA contract, and deployment documentation where required.
- Audit and, only if justified, add a pure explicit registration seam around `createSourceHealthObservations`.

## Sources of truth

- Baseline commit `92344502eaecb7436f8b7a4ef658ba29928f6368`.
- Executable contracts under `scripts/tests/`, current `.github/workflows/ci.yml`, and `docs/DEPLOY.md`.
- Official upstream `actions/upload-artifact` repository and release records.

## Stages

- [x] Stage 1: Establish baseline, inspect direct implementation and contracts, and record exact bundle metrics.
- [x] Stage 2: Implement and verify Route corridor budget recovery.
- [x] Stage 3: Verify upstream action version/SHA, update workflow/contracts/docs, and parse YAML.
- [x] Stage 4: Decide and implement or explicitly decline the Source Health seam with focused contracts.
- [x] Stage 5: Run authorized minimum-sufficient validation and prepare integration handoff.

## Acceptance criteria

- Route corridor adapter stays below 3500 raw / 1500 gzip without raising limits or entering the initial bundle; target is approximately 2975 raw / 1275 gzip or lower, otherwise document the precise safe minimum and obstacle.
- Both upload-artifact uses resolve to the same verified full commit SHA for the Node 24-compatible major; exact-artifact, main-tip and single Pages candidate contracts remain green.
- Current Crime and bundled Source Health outputs remain unchanged; future ACS/HIN observations can be explicitly registered outside the central assembler without a plugin system.
- Targeted tests, JS/CSS lint as applicable, YAML parsing, bundle policy, and `git diff --check` pass; live-process ownership and unrun gates are explicit.

## Non-goals

- No ACS or HIN runtime observation implementation.
- No Evidence Bundle product admission, new dependency, ceiling increase, initial-bundle migration, UI redesign, deployment, or Git index/ref operation.

## Risks and constraints

- This worktree is the only writable scope; the main worktree and other worktrees are out of bounds.
- The main supervisor owns integration, commits, pushes, deployment, worktree topology, and long/shared test slots.
- Route loader refactoring must preserve event ownership, keyboard/mobile layout, mapless behavior, and HIN semantics.
