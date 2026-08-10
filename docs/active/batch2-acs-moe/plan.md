# Plan

## Goal

Deliver a tract-level ACS 2024 population estimate and 90% margin-of-error contract across live adapters, a reproducible bundled snapshot, tract properties, comparison presentation, and saved artifacts without fabricating buffer uncertainty or breaking legacy artifacts.

## Scope

- `src/config.js`, `src/api/acs.js`, ACS normalization helpers, and the bundled ACS snapshot.
- `scripts/fetch_acs_tracts.mjs` and `scripts/compute_acs_averages.mjs`.
- `src/map/tracts_view.js`, `src/utils/pop_buffer.js`, and `src/compare/card.js`.
- Minimal ACS-related i18n and Analysis History / Evidence Bundle compatibility code and tests.
- This task record only; central planning records remain read-only.

## Sources of truth

- Repository base `main @ 9f585b9e86fc3ee4f2378647cba2ef49a0308ccb` and fresh target tests.
- U.S. Census Bureau 2024 ACS 5-year dataset documentation and B01003 variable metadata.
- U.S. Census Bureau table-based Summary File `acsdt5y2024-b01003.dat` for the committed snapshot.
- Census Reporter API documentation and live 2024 response only for its adapter contract.

## Stages

- [x] Stage 1: Verify base, ownership, instructions, current ACS flow, artifact schemas, and official external contracts.
- [x] Stage 2: Add failing contracts for E/M normalization, missing-is-not-zero, snapshot manifest/hash, tract properties, comparison disclosure, and legacy/new artifact round trips.
- [x] Stage 3: Implement the smallest compatible ACS population model and snapshot generator.
- [x] Stage 4: Propagate structured population evidence to map/comparison/artifacts while keeping per-10k point-estimate-only.
- [x] Stage 5: Run targeted verification, reproducibility/hash checks, diff/bug/first-principles review, and create local Lore commits.

## Acceptance criteria

- New population values can express `estimate`, `moe90`, `vintage`, `source`, `retrievedAt`, and `status`; legacy `pop` remains read-compatible.
- Official API and Census Reporter adapters map B01003 estimate and MOE/error without coercing missing values to zero.
- The 2024 snapshot records its official URL, 2020-2024 vintage, retrieval time, row count, schema, variable contract, and stable data hash; regeneration has a verify mode.
- Tract properties expose estimate, 90% MOE, vintage, source, retrieval time, and status.
- Comparison output shows the denominator estimate and vintage, labels 90% MOE unavailable for centroid-selected circular aggregation, and makes the denominator-only uncertainty boundary explicit.
- Per-10k remains `crime count / population point estimate * 10,000`; no buffer MOE, rate interval, or significance claim is added.
- New saved artifacts write the structured population contract; legacy v1 fixtures still normalize and round-trip.
- Targeted data/ACS/tract/compare/artifact tests, relevant lint, snapshot verification, and `git diff --check` pass.

## Non-goals

- Variance replicate estimates, covariance-aware aggregation, circular-buffer MOE, crime-rate confidence intervals, or statistical-significance testing.
- Changes to forbidden UI/map entry/Diary/release/style/visual/budget/README/dependency files.
- Integration, push, deployment, main updates, worktree cleanup, browser/visual/full release gates.

## Risks and constraints

- Census API data queries require an API key as of the 2024 endpoint; no key is present in this worktree. The committed snapshot therefore uses the official keyless Summary File, while runtime configured API support retains the official E/M response shape.
- Census Reporter is a third-party adapter and must preserve its returned release metadata; it is not labeled as a Census Bureau endpoint.
- A whole-tract centroid sum is spatially approximate. Missing tract estimates invalidate the aggregate instead of contributing zero.
- Legacy Analysis History artifacts are strict schema v1 values; version admission must be explicit rather than silently widening v1.
