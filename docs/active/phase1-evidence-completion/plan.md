# Phase 1 Evidence Completion

## Goal and truthful boundary

This is the sole active Phase 1A-D handoff record. Phase 1-0 adds **new
mechanical release/browser wiring coverage** and keeps its proof executable.
It does not newly create Source Health or lifecycle semantics: sourceAsOf,
retrievedAt, builtAt, observedAt, status separation, revision, schema, DQ, and
lineage are **recorded and re-verified existing executable contracts**. The
test:phase1-handoff contract binds that distinction to the standard test graph
and rejects a missing handoff matrix.

M0 publication means a **validated recoverable serialized multi-file
transaction / 经验证、可恢复的串行多文件事务发布**: validate temporary artifacts,
stage backups, install by serial rename, and roll back if a later installation
fails. It does not claim strict instantaneous atomic visibility across files.

## Authority, non-goals, and shared ownership

- This task owns only local Phase 1-0 code, tests, records, and live processes
  in C:/Users/raede/.codex/worktrees/e4c5/engagement_project.
- This Phase 1-0 candidate owner is the sole local writer for its explicitly
  delegated package/release/test/record changes. After handoff, **only the
  final 1D integration/release owner** may write package.json,
  scripts/run_release_gate.mjs, .github/workflows/ci.yml,
  scripts/tests/bundle_policy.mjs, src/source_health/source_health_catalog.js,
  shared public/data/** outputs, or docs/active/phase1-evidence-completion/**.
  Earlier M1-M4 owners may propose a reviewed patch, not write or promote these
  shared surfaces directly.
- Scheduled refresh, remote CI, deploy, production/online smoke, source
  acquisition authority, forecast promotion, routing authority, merge, push,
  rebase, cherry-pick, and worktree cleanup are outside this task.
- Local browser fixtures are browser wiring evidence only; they neither prove
  source liveness nor promote a source, forecast, routing, or deployment claim.

## Frozen lifecycle acceptance

- sourceAsOf is source-fact time; retrievedAt acquisition time; builtAt
  artifact-build time; observedAt observation time. A missing clock is null or
  unavailable according to the existing source contract, never invented.
- current, partial, stale, unavailable, and unknown are distinct;
  unavailable/unknown are not zero/current and partial/stale are not promotion.
- Every consumer receipt must bind producer revision/identity, schema version,
  DQ result, coverage, and lineage. HTTP transport validators are transport
  evidence, never a substitute lifecycle clock or provenance receipt.
- Future acceptance must execute the relevant focused contract plus the
  producer/consumer receipt recheck; Markdown alone is not acceptance.

## Single handoff matrix

| Milestone | Exact writable paths; forbidden/shared paths | Inputs, ignored assets, and authority boundary | Producer → consumer binding | Mandatory pre-handoff checks |
| --- | --- | --- | --- | --- |
| **M1 frozen warehouse** | Owner: M1 frozen warehouse task. Writable: scripts/acquire_crime_events.mjs, scripts/ingest_crime_events.mjs, scripts/backfill_crime_event_warehouse.mjs, scripts/lib/crime_event_warehouse.mjs, scripts/tests/crime_event_warehouse.mjs, and task-owned ignored .dfev1/crime/**. Forbidden/shared: package.json, release/CI/bundle policy, Source Health catalog, public/data/**, all M2-M4 source/UI paths, and this record. | Official input is read under the approved source/license boundary; raw events, acquisition snapshots, canonical rows, checkpoint, cache, and logs stay ignored. Retention is at least 180 days after independently reviewed 1D acceptance; the M1 owner decides only after a documented M1 receipt recheck and 1D retention approval. They are not serving, promotion, or authority evidence. | M1 publishes a validated warehouse manifest/checkpoint/lineage receipt containing source revision, schema, DQ, coverage, and four clocks. M2/M4 consume it read-only and recheck exact receipt identity before use. | npm run test:data-pipeline; warehouse-focused receipt/idempotency check; npm run verify:bundle if source reaches runtime; no browser claim unless a changed browser surface has its named suite. Exact-tip barrier: before M2 accepts any input, record M1 exact tip/topology/status/overlap and recheck the M1 receipt. |
| **M2 mart/evaluation** | Owner: M2 mart/evaluation task. Writable: scripts/build_area_intelligence_marts.mjs, scripts/evaluate_area_intelligence.mjs, scripts/lib/area_intelligence_*.mjs, scripts/tests/area_intelligence_m2.mjs, and task-owned ignored .dfev1/area-intelligence/**. Forbidden/shared: M1 raw warehouse, public/data/area_intelligence_baseline.v1.json, package/release/CI/bundle policy, Source Health catalog, M3/M4 paths, and this record. | Input is the exact M1 frozen receipt, read-only. Mart, evaluation, cache, model, report, checkpoint, and logs remain ignored. Retention is at least 180 days after independently reviewed 1D acceptance; the M2 owner decides only after a documented M2 receipt recheck and 1D retention approval. They are not a serving/promotion authority. | M2 receipt binds the M1 receipt, protocol/schema, DQ/lineage, model/evaluation revision, and four clocks. 1D alone may recheck and promote a validated serving projection; not-promoted stays unavailable. | npm run test:data-pipeline; Area-focused evaluation/receipt checks; npm run test:area-intelligence-browser; npm run verify:bundle; exact M1 receipt recheck before/after reads. Exact-tip barrier: before M3 or 1D accepts M2 output, record M2 exact tip/topology/status/overlap and recheck M1/M2 receipts. M2 is a governance/order prerequisite for M4, not an M4 producer-data receipt binding. |
| **M3 Home Compare** | Owner: M3 Home Compare task. Writable: src/home_compare/**, scripts/smoke_home_compare_sources.mjs, scripts/lib/home_compare_source_smoke.mjs, scripts/tests/home_compare_m3.mjs, scripts/tests/home_compare_browser.mjs, and task-owned ignored .dfev1/home-neighborhood-compare/m3-v1/**. Forbidden/shared: public/data/home_compare_sources.v1.json, package/release/CI/bundle policy, Source Health catalog, M1/M2/M4 paths, and this record. | Public source responses and ephemeral address/parcel inputs are not retained in serving/share artifacts. Retention: M3 task owner retains its receipt, logs, and two retained screenshots as local evidence for at least 30 days after independently reviewed 1D acceptance; deletion requires a documented M3 receipt recheck and explicit 1D retention decision. They are neither serving nor promotion/authority data. | M3 producer receipt binds source registry revision/schema, observation DQ, lineage, status and clocks; Home UI consumes only its validated projection. 1D rechecks the source receipt before any shared catalog/output change. | npm run test:home-compare; Home source receipt/smoke contract; npm run test:home-compare-browser; npm run verify:bundle; Source Health receipt recheck if catalog binding changes. Exact-tip barrier: before 1D accepts M3 output, record M3 exact tip/topology/status/overlap and recheck the M3 receipt. |
| **M4 Known Route** | Owner: M4 Known Route task. Writable: src/routes_crime/known_route_*.js, scripts/smoke_known_route_evidence.mjs, scripts/build_known_route_evidence.mjs, scripts/lib/known_route_evidence_checkpoint.mjs, scripts/tests/known_route_evidence_m4.mjs, scripts/tests/known_route_evidence_browser.mjs, and task-owned ignored .dfev1/known-route-evidence-v1/**. Forbidden/shared: package/release/CI/bundle policy, Source Health catalog, public/data/**, M1-M3 paths, and this record. | Explicit public/manual route input, route-derived bounds, raw rows, checkpoints, reports, and logs remain ignored/task-owned. Retention: M4 task owner retains them only as local evidence for at least 30 days after independently reviewed 1D acceptance; deletion requires documented M1/M4 receipt rechecks and an explicit 1D retention decision. They cannot be serving/promotion/routing authority and must not create a route recommendation. | The existing checkpoint/v1 is only preparation evidence. A future M4 owner must jointly implement and validate the final handoff/v2 receipt (schema/DQ/lineage/consent/four clocks). Its only producer-data receipt edge is exact read-only M1; M2 is governance/order only. M4 has no product dependency on M3; 1D's cumulative receipt binds M3 and M4 only after both producer receipts pass their exact-tip gates. | npm run test:known-route-evidence; known-route receipt/idempotency checks; npm run test:known-route-evidence-browser; npm run verify:bundle; M1 receipt recheck plus M2 governance recheck. Exact-tip barrier: before 1D acceptance, record producer exact tips/topology/status/overlap and recheck every required upstream receipt. |
| **1D integration/release** | Sole writable owner for the shared surfaces named above plus reviewed, path-scoped integration patches. All other paths remain owned by their producer milestone unless explicitly handed over. | Reads only validated producer receipts and ignored artifacts necessary to verify them; ignored raw/ephemeral assets remain non-serving and never become promotion/authority evidence by integration alone. | Recompute producer→consumer receipt/revision/schema/DQ/lineage binding at the candidate exact tip. Refuse missing, drifted, partial-as-current, or unavailable-as-zero evidence. | Every changed milestone focused check; all three browser suites; npm run verify:bundle; npm run ci:release; final receipt and topology/overlap/status recheck; independent review. Remote CI/deploy remain separate gates. |

## Required serial topology

M0 lifecycle baseline → M1 frozen warehouse → M2 mart/evaluation → M3/M4
preparation and final producer receipts → 1D integration/release.
M3 and M4 may run in parallel only when they share neither writable paths nor
live outputs. M4 has no product dependency on M3; the 1D cumulative receipt,
not M4, binds M3 and M4 after both producer receipts have passed their own
exact-tip gates.

Before each arrow, the receiving owner records the producer exact tip, Git
topology, worktree status, writable-path overlap, and validates the producer
receipt again. No future source, forecast, routing, or deployment is described
here as completed.

## Phase 1-0 acceptance and handoff

1. Recheck target SHA, topology, clean/owned status, and path overlap before
   integration. This local candidate is never self-approved.
2. The release runner must call Area Intelligence, Home Compare, and Known
   Route browser leaves once each. The release-workflow contract checks their
   exact package file mappings plus the repository-defined package/workflow
   composite graph, not arbitrary external invocations.
3. Integration is strict fast-forward only while this exact base remains the
   target tip; otherwise use one independently reviewed path-scoped
   cherry-pick. Keep this trio active through 1D; do not archive it early.

## Step 1 scope convergence — Phase 1-0 only

The former `543c214` → `a7271b3` → `142cd3a` chain is a historical local
execution candidate with a **REQUEST_CHANGES** review outcome. Its release
receipt remains exact-tip execution evidence only; it is not an admission,
producer-validator, review, or deletion authority.

Phase 1-0 retains and re-verifies only the release graph, the once-each Area
Intelligence/Home Compare/Known Route browser-leaf wiring, browser lifecycle
cleanup, unchanged bundle ceiling/headroom, M0 recoverable-serialized wording,
and frozen lifecycle/status/four-clock semantics. It does not install a final
producer admission validator for M1, M2, M3, M4, or 1D.

Accordingly, checked-in Phase 1 policy fixes all five validator states to
`not-installed` and their receipt modes to `future-admission`. The evaluator
must fail closed before reading a receipt or authority or invoking an injected
resolver: preparation, consumption, admission, and deletion are all false.
Only the named future phase owner, in a separately reviewed implementation,
may install that phase's executable admission validator and revise this frozen
policy. Future M1/M2 warehouse/mart details, M3 privacy fields, M4 identity
unification, and 1D path provenance remain owned work, not Phase 1-0 repairs.
