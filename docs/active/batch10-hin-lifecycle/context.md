# Context

## Current truth

- Worktree `p10-hin-lifecycle` is detached and started clean at exact `db41214ad5a428fc0cf0fe369f257f7470196cbe`.
- The existing snapshot is `phl-hin-2025-v1`, contains 162 features, records six `LineString` and 156 `MultiLineString` features, and has no distinct `builtAt` or snapshot identity field.
- Existing acquisition validates an exact item/layer/schema/count/geometry contract but always writes a snapshot whose `retrievedAt` changes; it has no semantic no-change comparison or review receipt.
- Existing HIN UI already distinguishes admitted zero from unavailable and discloses the 20 m local approximation, but does not show a snapshot identity, build-clock status, feature/geometry receipt, or official layer handoff.
- P0 added a `registeredSourceHealthObservations` seam; no HIN source is currently wired into the central catalog/assembler in this worktree.
- Official read-only recheck on 2026-08-10: item `7e416319784a463fa0d8b528d7ccf511`, layer 0, four admitted fields, 162 features, six `LineString`, 156 `MultiLineString`, and layer source clock `2025-12-10T17:29:32.369Z` remain unchanged. The City release still states that the updated HIN is based on 2019–2023 crash data.
- The official no-change acquisition completed without snapshot or receipt byte/mtime changes. The committed snapshot remains 270,811 bytes with identity `sha256:b518f8b370c6375f5d3188ec2ec487ed834b7b7c25cb51f5f5e554285749e250`; the lifecycle receipt is 1,554 bytes.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | Keep the v1 snapshot bytes when official semantic content is unchanged and introduce a sidecar lifecycle receipt. | Satisfies auditability without manufacturing a new data snapshot solely to add metadata. |
| 2026-08-10 | Treat the legacy snapshot `builtAt` as unknown/null. | Avoids falsely equating transport retrieval with build completion. |
| 2026-08-10 | Keep Source Health and Evidence adapters feature-owned and pure. | P0/P8 integration owners can register them without a central import cycle or Evidence Bundle core edit. |
| 2026-08-10 | Read the ArcGIS item, layer, count, GeoJSON, then City time-semantics page sequentially. | Repeated concurrent `Promise.all` probes intermittently returned ArcGIS `Invalid URL`/unknown errors; sequential reads were stable and remain fully fail-closed. |
| 2026-08-10 | Require `--accept-reviewed-change --reviewed-by` before replacing changed artifacts and stage a validated snapshot/receipt pair together. | Normal acquisition is a read-only review/no-change path; legitimate upstream drift cannot be silently accepted. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| None | Batch 10 owner | N/A | Final scoped Node/npm process count is zero. No install, acquisition write, build, browser, visual, full validation, or shared process started. |

## Handoff

The main supervisor is the only integration owner and owns staging, committing, ref changes, worktree operations, long/shared validation, remote actions, and deployment. This worker owns only HIN feature files, HIN lifecycle scripts/tests/docs, and the Batch 10 task records.

Integration must add an admitted `hin-2025` catalog entry before registering `adaptHin2025SourceHealthObservation(...)`; otherwise the central read model correctly rejects the unknown source. The feature observation uses status `partial` with reason `bundled-historical-planning-snapshot`; receipt absence/drift produces `unavailable` with `recordCount: null`.

P8 may map `createHin2025EvidenceContribution({ result, sourceHealthObservation })` into its source adapter. The contribution intentionally contains only source clocks/identity/coverage, aggregate association status/count, method/tolerance, handoff, and limitations. It omits exact route geometry, matched street names, snapshot rows, snapshot object IDs, and GPS traces.

There are no same-path changes with the active P8 or P9 worktrees. The central Source Health catalog/assembler, Evidence Bundle v2 core, package scripts, global i18n file, generic route modules, CI, and deployment files remain untouched.

## Next step

Main supervisor: review the 15-file Batch 10 diff, integrate after P8/P9 path reconciliation, add the central HIN catalog/registration wiring, then run shared build/bundle/browser/visual/full-release gates under the live-test owner.
