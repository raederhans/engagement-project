# Context

## Current truth

- 2026-08-12 start: primary repository was `main@1e9fecad2e42e8081a8fb3f6fee7a0ac175786c8`, synchronized with `origin/main`.
- The primary checkout already contained untracked Playwright, log, and output
  artifacts. They are outside this task and remain untouched.
- The integration owner created coordination branch
  `codex/route-decision-s0-s1-foundation`; only this task record belongs to the
  coordination baseline.
- This batch is authorized for implementation and local tests, but not public
  publication or production-data admission.
- The primary task owns Git integration, shared-file reconciliation, broad/live
  validation, pushing, deployment, and worktree cleanup. Execution lanes may make
  focused commits in their own worktrees and must stop at ready-for-integration.
- The primary task also owns continuous supervision and orchestration. It will use
  compact task waits/snapshots, route implementation questions to the appropriate
  lane, and return to the three original research tasks for targeted confirmation
  when an implementation decision is not already supported by frozen evidence.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-12 | Use four independent worktree tasks: S0 contracts, S1-A evaluator, S1-C graph/router, and Golden validation. | Parallelism is bounded by non-overlapping file ownership; the primary thread remains the only integration owner. |
| 2026-08-12 | S0 owns shared contract paths; other lanes consume documented provisional object shapes without editing those paths. | Avoids same-path conflicts while allowing all four tasks to start immediately. |
| 2026-08-12 | Start with synthetic/golden fixtures and no public data artifact. | Algorithm and contract work can proceed without ODbL, City, SEPTA, ArcGIS, credential, or publication decisions. |
| 2026-08-12 | Keep candidate generation and decision evaluation one-way: graph/router emits candidate facts; evaluator never controls graph search. | Prevents a circular architecture and keeps later scenario validation independently reproducible. |
| 2026-08-12 | Treat all new work as a production-isolated seam rather than refactoring the legacy graph demo in place. | Existing safety-weighted and mislabeled length semantics cannot leak into the new implementation. |
| 2026-08-12 | User explicitly assigned supervision, orchestration, guidance, and research-task follow-up to the primary task. | Execution lanes do not self-integrate or reinterpret research boundaries; unresolved semantic questions escalate to the primary task. |

## Provisional cross-lane contract

The S0 lane owns final naming and strict validation. Until that delivery is
integrated, S1-A, S1-C, and Golden use these minimum shapes without creating a
second shared-schema module:

```text
RouteCandidateFacts
  schemaVersion, candidateId, edgeIds[], geometry?, distanceMm,
  objectiveCostUnits, observations{}, provenance{}

DecisionPolicy
  schemaVersion, policyId, hardConstraints[], softPreferences[],
  weightBasisPointsTotal=10000, tieBreak[]

DecisionResult
  schemaVersion, status, admittedCandidateIds[], rankedCandidateIds[],
  rejected[], unresolved[], trace[]

GraphArtifact
  schemaVersion, graphId, mode, directed=true, nodes[], edges[],
  components{}, provenance{}, receipt{}

ScenarioRunManifest
  schemaVersion, seed, graphId, policyVersions[], fixtureSetVersion,
  solverVersion, expectedCaseCount
```

All quantities are integers in documented units. Unknown observations are
explicit tagged states, not missing numbers. Implementations may use local test
builders under their owned directories but may not define competing public
contracts.

## Lane ownership

| Lane | Exclusive implementation paths | Shared paths forbidden without handoff |
| --- | --- | --- |
| S0 contracts | `src/route_decision/contracts/**`, `scripts/tests/route_decision_contracts.mjs`, optional contract-specific docs under its owned directory | evaluator, route-generation, Golden fixtures, package scripts, workflows, central task record |
| S1-A evaluator | `src/route_decision/evaluator/**`, `scripts/tests/route_decision_evaluator.mjs` | S0 contract paths, graph/router paths, package scripts, workflows, central task record |
| S1-C graph/router | `src/route_generation/**`, `scripts/tests/route_generation_unit.mjs` | S0 contracts, evaluator paths, Golden-owned fixtures/oracle, package scripts, workflows, central task record |
| Golden validation | `scripts/lib/route_golden_oracle.mjs`, `scripts/lib/route_golden_harness.mjs`, `scripts/tests/route_generation_golden.mjs`, `scripts/tests/fixtures/route_generation/**` | product graph/evaluator code, S0 contracts, package scripts, workflows, central task record |

If an existing repository convention makes an owned path inappropriate, the lane
must stop before crossing ownership and request a handoff from the primary task.

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Shared browser/build/full validation | Primary integration owner | To be assigned after lane integration | Not started |
| Lane-local short Node tests | Each isolated lane | Lane-local `.tmp/` if needed; do not commit logs | Permitted when no shared port/server is used |

## Handoff

- Each execution lane must return a focused commit and delivery package, not
  integrate or push it.
- Required package: exact base/HEAD, branch, changed files, diff summary, tests
  with pass counts, unrun checks, semantic risks, same-path and shared-contract
  overlap, and recommended integration order.
- Recommended integration order is S0, then S1-C and S1-A after contract-adapter
  review, then Golden; a final integration-only patch may wire standard package
  scripts and reconcile imports.
- Original research tasks remain evidence sources rather than implementation
  owners. The supervisor may send them narrow follow-ups about unresolved
  semantics, but must not treat a research reply as landed code or passed tests.

## Next step

Create the four worktree tasks from this coordination baseline, record their task
IDs/worktree paths in the registry, and confirm each has entered implementation.
