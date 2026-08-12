# Context

## Current truth

- 2026-08-12 start: primary repository was `main@1e9fecad2e42e8081a8fb3f6fee7a0ac175786c8`, synchronized with `origin/main`.
- The primary checkout already contained untracked Playwright, log, and output
  artifacts. They are outside this task and remain untouched.
- The integration owner created coordination branch
  `codex/route-decision-s0-s1-foundation`; only this task record belongs to the
  coordination baseline.
- Coordination baseline commit is
  `5bcd229e370e6fba02a334914d70a9a9602703ec`. All four execution tasks were
  created as detached worktrees at that exact commit and confirmed active.
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
| 2026-08-12 | Four Codex worktree tasks confirmed `active` from the exact coordination baseline. | The supervisor can now monitor with compact task snapshots and preserve independent delivery boundaries. |

## Initial provisional cross-lane contract

This was the integration-start shape used to keep lane ownership separate. It is
retained as historical coordination evidence and is superseded by the admitted
S0 schemas plus the public adapters described in the final evidence section.

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
| Shared browser/build/full validation | Primary integration owner | None; no runtime/UI surface in this foundation | Not run; defer to any future main/release gate |
| Lane-local short Node tests | Each isolated lane | Lane-local `.tmp/` if needed; do not commit logs | Permitted when no shared port/server is used |

## Execution task history

| Lane | Task ID | Worktree | Final delivery state |
| --- | --- | --- | --- |
| S0 contracts | `019ff3c1-04a0-7243-82e5-8322d0d21a56` | `C:/Users/raede/.codex/worktrees/2ae5/engagement_project` | Delivered `75cfc6c`, follow-up `b127efb`; integrated as `819826e`, `f60d1ae` |
| S1-A evaluator | `019ff3c1-12cf-7901-ba2d-1fdd12b3c65c` | `C:/Users/raede/.codex/worktrees/1738/engagement_project` | Delivered `777bc20`, adapter `4a5b324`; integrated as `cc5f9c2`, `dcde68f` |
| S1-C graph/router | `019ff3c2-a544-75e1-991a-ea34d20cf7ec` | `C:/Users/raede/.codex/worktrees/061d/engagement_project` | Delivered `16cd45f`, `9bf50a8`, `9b478e6`; integrated as `202eab6`, `b2feaca`, `039867e` |
| Golden validation | `019ff3c2-98f4-74c0-97b9-71c7a8892439` | `C:/Users/raede/.codex/worktrees/81e9/engagement_project` | Delivered `8c83324`, adapter `010e6af`; integrated as `c4682cc`, `f4e13ca` |

## Completed handoff

- Each execution lane returned focused commits and a delivery package without
  changing the coordination branch, shared index, remote, or public state.
- The primary owner integrated S0, then S1-C, Golden, and S1-A, and applied only
  the narrow adapters and contract corrections needed to close reproduced
  cross-lane failures.
- Original research replies were used only to confirm scope and product
  boundaries; executable code plus integrated tests remain the acceptance
  evidence.

## Final integration and review evidence

- Coordination HEAD reviewed: `dcde68f39ed653567469b5411430aed6c856561f`.
- S0 landed first, followed by the S1-C graph/router, S1-A evaluator, Golden
  oracle/harness, and narrow integration adapters. Lane source commits remain
  separately auditable in their detached worktrees; only the primary owner
  reconciled shared public seams.
- Initial integration review correctly returned request-changes: S0 and S1-A
  could not round-trip one another's objects, S0 requests did not match S1-C,
  S1-C did not match the Golden harness, equal-cost tie-breaks disagreed, unsafe
  accessors could execute, and a single route was at risk of being described as
  an exhaustive feasibility result.
- The three original research tasks were asked narrow follow-up questions. They
  confirmed that explicit adapters are allowed, S0 remains the only public
  contract truth, a single base candidate is acceptable only when marked
  incomplete, and complete alternatives/constraint-aware search belongs to S2.
  The scenario research had not frozen a v1 tie-break; integration therefore
  froze `objectiveCostUnits`, then the full locale-independent directed edge-ID
  sequence. Raw hop count is not part of v1.
- Public evaluation now re-admits S0 policy/candidates, compiles a private
  evaluator IR, and re-admits the public result. Public route generation maps S0
  request names to the internal solver and emits an explicitly incomplete
  `base-objective-only` CandidateSet with `constraintAwareSearch: false`.
- Golden production comparison is explicitly `primary-only/v1`. It checks the
  primary route and terminal outcomes, while alternatives are machine-marked
  `not-evaluated`; it is not evidence of multi-route generation.
- Fresh integrated verification: 106/106 focused tests pass; scoped ESLint and
  diff hygiene pass. Independent code review reports APPROVE with zero findings;
  independent architecture review reports ACCEPT with no foundation blocker.
- Full repository validation, browser smoke, build, push, deployment, production
  data admission, Philadelphia validity, accessibility, safety, and user
  research remain unproven and are not claimed by this foundation.

## Next step

Keep this record active as a ready-for-integration handoff until a separately
authorized main-branch integration is selected. The next implementation batch
should be S2 candidate generation: bounded multi-candidate enumeration and/or
constraint-aware search with completeness semantics and Golden alternatives.
Production data admission should remain a later, separately reviewed step.
