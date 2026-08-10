# Plan

## Goal

Make the product-visible HIN 2025 historical Known Route context auditable through an explicit acquisition, validation, review, source-health, and evidence-contribution lifecycle without introducing a route risk or safety product.

## Scope

- Preserve a sidecar lifecycle receipt for the admitted local snapshot: official item/layer identity, exact field schema, retrieval/build/source clocks, feature and geometry counts, immutable snapshot identity, and review disposition.
- Make acquisition compare the official candidate to the committed snapshot and avoid writing a new snapshot when semantic source content has not changed.
- Fail closed on item/layer, field name/type, geometry type/count, feature-count, and crash-period semantics drift.
- Enrich the HIN text UI with the admitted network vintage, crash-data period, lifecycle clocks, snapshot identity, method/tolerance, limitations, and official handoff.
- Export feature-owned adapters for an admitted Source Health observation and aggregate-only Evidence Bundle contribution; leave central assembly and Evidence Bundle v2 core to the integration owner.

## Sources of truth

- Exact implementation baseline: `db41214ad5a428fc0cf0fe369f257f7470196cbe`.
- Official ArcGIS item `7e416319784a463fa0d8b528d7ccf511` and layer `high_injury_network_2025/FeatureServer/0`.
- Existing `phl-hin-2025-v1` local snapshot and Batch 7 Known Route HIN contracts.
- `engagement-source-health/v1` observation admission contract and the P0 `registeredSourceHealthObservations` seam.
- Evidence Bundle v2 privacy and source-adapter boundaries; the HIN contribution must exclude route geometry and snapshot rows.

## Stages

- [x] Stage 1: verify exact baseline, repository guidance, ownership boundaries, and current HIN/source-health/evidence contracts.
- [x] Stage 2: add lifecycle receipt generation, comparison, validation, and no-change acquisition behavior with drift-negative tests.
- [x] Stage 3: add runtime receipt loading plus feature-owned Source Health and Evidence contribution adapters.
- [x] Stage 4: enrich truthful bilingual/no-map HIN presentation and official handoff within the feature-owned UI module.
- [x] Stage 5: run short HIN-owned tests/static checks, inspect overlap/process state, and hand off for integration.

## Acceptance criteria

- A committed receipt separates `sourceAsOf`, `retrievedAt`, `builtAt`, and observation time; missing legacy build time is represented explicitly rather than invented.
- The receipt identifies the official item/layer and exact field schema, feature count, geometry types/counts, snapshot schema, byte identity, and review status.
- An upstream probe with unchanged admitted semantic content exits successfully without rewriting the local snapshot or receipt.
- Item/layer/schema/geometry/count/period drift fails closed and leaves existing artifacts untouched.
- Runtime Source Health observation is admitted by the central v1 contract and uses `unavailable`/`unknown`, never a fabricated zero, when receipt evidence is invalid or absent.
- HIN Evidence contribution contains only aggregate/provenance fields and no exact route geometry, coordinates, GPS trace, raw snapshot rows, or feature identifiers.
- UI continues to distinguish admitted zero from unavailable and states that Known Route is not GPS matching; near/intersects is not route membership or crash occurrence; output is not real-time, predictive, certified, risk-scored, or safer-route advice.

## Non-goals

- No risk/safety score, route recommendation, real-time danger, prediction, certification, GPS map matching, route-event attribution, or HIN map overlay.
- No central Source Health assembler/catalog wiring, no Evidence Bundle v2 core change, no `package.json`, global i18n catalog, generic route contract, CI/release, deployment, Git index/ref, or worktree topology change.
- No automatic acceptance of a changed official snapshot. Source changes require explicit review and corresponding contract updates.

## Risks and constraints

- The current v1 snapshot did not record a distinct build clock; the lifecycle receipt must keep that value null rather than infer one from retrieval time.
- ArcGIS item metadata may change without HIN feature content changing; item transport metadata alone must not manufacture a new data snapshot.
- Feature count changes can be legitimate upstream revisions, but remain schema drift until reviewed and admitted locally.
- Browser, visual, build/bundle, full validate, acquisition writes, and shared processes require a live-test slot and remain unrun unless the supervisor explicitly authorizes them.
