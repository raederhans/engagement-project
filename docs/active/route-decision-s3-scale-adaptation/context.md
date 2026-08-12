# Context

## Current truth

- S3 starts from released local/remote
  `main@70f9727cd5003ad8524447b795701337d04ade1d`; exact-main core, release,
  coverage, and Pages deploy gates passed before this branch was created.
- The primary owner created coordination branch
  `codex/route-decision-s3-scale-adaptation` from that exact revision.
- S0/S1/S2 are integrated and released, but remain a synthetic,
  production-isolated route-decision foundation. There is no public route UI or
  admitted production route graph.
- The current repository contains protected, pre-existing untracked
  `.playwright-mcp/`, `logs/s3_i1_i2_*`, and `output/**` artifacts. They are not
  S3 inputs and must remain unstaged and undeleted.
- Retained S0-S2 and unrelated worktrees are audit/recovery state. S3 tasks use
  new worktrees and may not clean or repurpose any existing path.
- User authorization covers starting two to three S3 tasks and making the
  current primary task their supervisor. It does not authorize public data
  publication, production data admission, credentials, external routing, or
  stronger route-product claims.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-12 | Initial decomposition selected protocol/preregistration, candidate graph/data lifecycle, and independent scale/Golden. | The responsibilities remain separate even though the dispatch topology was later adjusted. |
| 2026-08-12 | Freeze the initial scale as 1,000 unique synthetic OD pairs x five configuration groups = 5,000 scenario-config evaluations. | Counts remain mechanically distinct; no claim of 5,000 users, trips, routes, or safety tests. |
| 2026-08-12 | Permit S3-0 and S3-1 to proceed in parallel; keep S3-2 read-only until exact handoffs. | Avoids an oracle encoding provisional protocol or graph semantics while allowing source/license work to progress. |
| 2026-08-12 | Keep all acquired route graph material candidate-only and out of runtime/public manifests. | Network access can advance evidence without silently publishing or production-admitting a dataset. |
| 2026-08-12 | Keep historical WRT configurations/profiles/results explicitly unknown. | S3 configurations are researcher-defined synthetic tests, not a reconstruction or user-validation claim. |
| 2026-08-12 | Replace the unavailable controlled-label research follow-up with independent read-only task `019ff4f2-28e4-7783-90fa-0195838ea077`. | S3-0 may continue owned-path implementation, but controlled-label, profile, and denominator semantics cannot be accepted until the replacement handoff is reviewed. |
| 2026-08-12 | Keep candidate graph implementation unassigned until the existing route/data research handoff is accepted. | The current three new tasks are S3-0, S3-R, and S3-2; this avoids creating a fourth task or acquiring data before source/license/topology review. |
| 2026-08-12 | Accept S3-R's current-code semantic handoff and the original route/data research handoff. | S3-R requires closed vocabulary, policy-content binding, explicit non-known states, honest product primitives, and separate denominators; S3-1 may now implement candidate-only source/receipt/topology seams. |
| 2026-08-12 | Initial S3-0 independent review returned code `REQUEST CHANGES` and architecture `BLOCK` despite fresh 15/15 focused, 107/107 foundation, 92/92 S2, ESLint, and diff-check passes. | S3-0 must bind admitted execution/oracle/run records, K/search bounds and constraints, honest G0-G4 semantics, profile role, graph/source handoff, partial/stopped truth, denominator units, and evidence-gated claims before S3-2 opens. |
| 2026-08-12 | Freeze repair defaults at requested K=5, maxExpandedStates=100000, maxRouteEdgeCount=1024, while preserving existing S2 distinctness/tie-break/constraint/capacity versions. | Prevents post-hoc tuning; exhaustion or incompleteness must be reported rather than raising bounds to obtain a desired result. |
| 2026-08-12 | Treat Profile A/B as non-behavioral synthetic cohort strata for this S3 run. | Avoids pretending profile labels affect product execution; behavior is defined only by the exact configuration policy and search request. |

## Lane ownership

| Lane | Exclusive candidate paths | Shared or forbidden without handoff |
| --- | --- | --- |
| S3-0 Protocol / Preregistration | `src/route_decision/contracts/scenario_cohort_v1.js`; optional private `src/route_decision/contracts/s3_validation/**` split; `scripts/tests/route_decision_s3_protocol.mjs`; protocol-specific synthetic fixtures if needed | existing S0-S2 contract files, public barrel, search/evaluator/enrichment, package scripts, workflows, task records |
| S3-R Controlled Labels / Constraint Semantics | read-only current-code and official/upstream evidence review; no owned write paths | all repository files, Git state, task records, servers, long tests, and data publication |
| S3-1 Candidate Graph / Data Lifecycle | `scripts/lib/route_graph_candidate/**`; `scripts/tests/route_graph_candidate_*.mjs`; `scripts/tests/fixtures/route_graph_candidate/**`; worktree-local ignored/temp acquisition output | `public/data`, Source Health, Evidence Bundle, runtime loaders, product GraphArtifact admission, bundle policy, package scripts, workflows, task records |
| S3-2 Independent Scale / Golden | after handoff: `scripts/lib/route_s3_*.mjs`; `scripts/tests/route_decision_s3_scale.mjs`; `scripts/tests/fixtures/route_decision_s3/**` | production contracts/search/evaluator/enrichment, S3-1 acquisition code, package scripts, workflows, task records |
| Primary integration owner | package scripts, shared adapters, task records, registry, integration tests, full/live validation, Git refs/index/remotes | all lane-owned paths are read-only until a delivery is under review |

## Dependency gates

```text
revised S3-0 protocol/preregistration ───────────────┐
accepted S3-R semantics ────────────────────────────┼──► S3-2 independent scale/Golden
accepted S3-1 candidate graph/data handoff ─────────┘
```

- S3-R is an accepted read-only semantic input. S3-0 must close both independent
  review lanes before integration; S3-1 must remain candidate-only and may not
  model external data as the existing synthetic-only product GraphArtifact.
- S3-2 may perform read-only repository mapping and produce a proposed test
  matrix immediately. It must not implement or generate expected results until
  the primary owner sends exact accepted protocol and graph identity shapes.
- A source endpoint, research note, or candidate download does not open the
  S3-2 gate. The
  primary owner must first review license/provenance/topology and the exact
  admitted candidate shape.

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Lane-local short unit/contract tests | Each S3 task inside its isolated worktree | No committed logs; task-local temporary output only | Allowed after owned changes |
| Source downloads/API probes | Original route/data research task during research; later exact candidate-graph owner after handoff | Worktree-local ignored or OS temp path; never `public/data` | Allowed, bounded, candidate-only |
| 1,000 x 5 cohort, large graph build, browser, full validate, release build, server, or shared cache/output | Primary integration owner | To be assigned before start | Not started; tasks must request handoff |

## Handoff

- Each execution task must begin by reporting exact HEAD/status, applicable
  guidance, ownership acceptance, and whether its implementation gate is open.
- Execution tasks do not stage, commit, merge, push, clean worktrees, change
  package/CI/registry files, or publish data. They return an uncommitted diff and
  an evidence package to the primary owner.
- Delivery packages include changed files, diff summary, contract assumptions,
  focused test counts, network/source evidence, unrun gates, overlap, risks, and
  recommended integration order.
- The primary owner will send exact revision/schema handoffs after review and
  will return narrow unresolved semantic questions to the original research
  tasks rather than inventing historical facts.

## Next step

Review the revised S3-0 and S3-1 deliveries independently. Only after both are
accepted and integrated may the primary owner send exact protocol, graph, and
S3-R semantic identities to S3-2 and open its micrograph-first implementation
gate.
