# Plan

## Goal

Resolve every confirmed P0 and P1 product issue without adding a writable backend or replacing the current Vite/MapLibre architecture.

## Scope

- Make Crime date, analysis mode, offense filters, Compare, Top-N, and coverage behavior use one truthful contract.
- Make tract choropleth data available through a versioned, validated Pages snapshot with visible provenance and failure states.
- Complete address selection, A/B comparison, share/export, and data-source status.
- Repair mobile layout, mode isolation, accessibility, and observable loading/error/demo states.
- Make Diary submission reliable and provide browser-local My Routes, history, and insights through IndexedDB.
- Remove or relabel Community and GPS affordances that cannot work without a backend or implemented map matching.
- Add behavior and browser regression gates for the repaired workflows.

## Stages

- [x] Stage 1: Validate, finish, and integrate the existing tract data-pipeline worktree.
- [x] Stage 2: Repair P0 data/state contracts with failing tests first.
- [x] Stage 3: Complete P1 Crime features and data transparency.
- [x] Stage 4: Repair responsive UI, mode ownership, error states, and accessibility.
- [x] Stage 5: Complete the local-first Diary vertical slice.
- [x] Stage 6: Run full validation, independent review, GitHub integration, and Pages verification.

## Acceptance criteria

- Diary rating success completes without an exception and reports demo/persisted state truthfully.
- Every Crime output consumes the same `start`, `end`, analysis mode, and resolved offense codes.
- Coverage failure is visibly distinct from a true zero result.
- Tract fill is either backed by matching versioned data or explicitly unavailable; it never silently renders missing data as zero.
- Address selection, real A/B comparison, URL restoration, and export work in a production build.
- At 390 CSS pixels, Crime and Diary controls remain operable with no fixed-panel overlap.
- Diary local routes and ratings survive reload in the same browser; Community remains explicitly sample-only.
- Targeted tests, full validation, dependency audit, browser smoke, CI, and Pages deployment succeed.

## Non-goals

- No account system, shared writable community backend, moderation service, or cross-device sync.
- No framework migration or visual rebrand.
- No production GPS map matching or arbitrary citywide routing.
- No history rewrite, force-push, or deletion of unrelated worktree WIP.

## Risks

- The existing tract pipeline and later panel/package changes overlap and must be integrated serially.
- Unifying state can change query timing and expose hidden assumptions in charts and map layers.
- IndexedDB schema mistakes can strand local data; version upgrades require migration tests.
- Responsive panel changes can regress desktop map interaction and keyboard focus.
- External data APIs can be unavailable during browser tests; source and fallback states must remain distinguishable.
