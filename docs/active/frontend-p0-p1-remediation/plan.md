# Plan

## Goal

Implement the audited frontend Phase 0 truth/recovery repairs and Phase 1 workspace ownership/layout refactor while preserving the existing civic visual language and Crime/Diary data, URL, privacy, and IndexedDB contracts.

## Scope

- Phase 0: Crime List total/display truth, failure settlement/retry, stable localized geocoder errors, Philadelphia Diary time buckets, neutral Diary score palette, retryable Diary lazy loaders, chart data equivalents, landmarks, and language-updating accessible labels.
- Phase 1: fixed AppShell, QueryRail, PrimaryCanvas, and ContextDrawer mounts; remove runtime DOM relocation; establish one display/scroll owner per surface; cover desktop, intermediate, and mobile layout states.
- Integration, focused/full tests, real browser flows, and current-run visual review are owned only by the root task.

## Sources of truth

- Base: `main@fb64b3ee1970b233266ef56c87b9b86aff0a1e3b`.
- Audit: `docs` and current source contracts plus the 2026-09-01 current-run UI audit evidence.
- Repository guidance: `docs/AGENTS.md`, `docs/active/_worktree_registry.md`, `package.json`, and `docs/DEPLOY.md`.

## Design direction

- Visual thesis: retain the existing civic blue/slate palette, map-first atmosphere, typography, radii, and restrained elevation while replacing the continuous card stack with a calm task-first workspace.
- Content plan: compact global header, grouped query controls, primary map/list canvas, and on-demand supporting context.
- Interaction thesis: explicit query/update actions, results/details revealed only when relevant, and one responsive Sheet state owner instead of nested scrolling surfaces.

## Stages

- [x] Stage 1: Dispatch and freeze three non-overlapping delivery packages.
- [x] Stage 2: Integrate Phase 0 Crime truth/recovery.
- [x] Stage 3: Integrate Phase 0 Diary semantics/recovery.
- [x] Stage 4: Integrate Phase 1 AppShell/layout ownership.
- [x] Stage 5: Run focused tests, `npm run validate`, release-equivalent checks, browser flows, and visual review.
- [x] Stage 6: Resolve proven regressions and independent review findings, then leave a reviewable local branch.
- [ ] Stage 7: Reconcile the reviewed copy refresh, recapture final screenshots, and pass the full local release gate.
- [ ] Stage 8: Push a PR, update exact Linux visual baselines from Ubuntu diagnostics, merge only after all checks pass, and verify Pages for the merged SHA.

## Acceptance criteria

- Crime List distinguishes total and displayed rows at 199/200/201 and never implies truncated output is complete.
- Failed List initialization clears busy/loading, shows localized recovery, raises no unhandled rejection, and can retry successfully.
- Diary insight buckets use `America/New_York`; palette is neutral; failed Diary and insights imports can retry.
- Charts expose synchronized structured data; workspace has a main landmark and skip navigation; language-dependent accessible labels update.
- Static HTML owns stable shell mounts; runtime code does not relocate charts or whole panel trees.
- Exactly one display and scroll owner exists for query, primary canvas, details, and mobile Sheet surfaces.
- Crime map/list, Diary live/history/community/rating, Help, ACS, and Known Route pass real browser review at 390, 720, 901, 1024, 1280, and 1440 widths in EN/ZH where applicable.
- Focused tests, core validation, release-equivalent browser/visual gates, and artifact/bundle constraints pass without weakening thresholds or bulk-refreshing baselines.

## Non-goals

- No Phase 2 query-chip/product-flow expansion beyond the mounts needed by Phase 1.
- No redesign of the established palette, typography, map styling, data semantics, privacy model, URL contracts, or IndexedDB schema.
- No force push, dependency upgrade, cleanup of unrelated worktrees/WIP, or expansion of serving, evidence, safety, or routing authority. The user's 2026-09-02 instruction authorizes scoped commit, PR, merge, push, and resulting exact-SHA Pages delivery after required gates.

## Risks and constraints

- `phase1-main` contains uncommitted project-copy WIP overlapping `index.html` and i18n files; this task uses a separate clean integration worktree and must not modify that WIP.
- Phase 1 touches shared shell/CSS and integrates after both Phase 0 packages.
- Browser, visual, build, and other shared-output commands are serialized under the root owner.
