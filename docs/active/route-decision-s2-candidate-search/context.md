# Context

## Current truth

- S2 starts from the accepted foundation revision
  `785e2c4835133d51ea9b545dc482454ae995a1e8`.
- The primary integration owner created coordination branch
  `codex/route-decision-s2-candidate-search`; no S2 product code exists at the
  time of this record.
- Foundation CandidateSet v1 intentionally admits at most one
  `base-objective-only` candidate, requires `completeness: incomplete`, and
  requires `constraintAwareSearch: false`.
- Foundation Golden product evidence is `primary-only/v1`; alternatives remain
  machine-marked `not-evaluated`.
- User authorization covers organizing and advancing four S2 tasks and local
  evidence acquisition. It does not authorize public publication, production
  deployment, credentials, or safety/city-validity claims.
- The primary worktree contains pre-existing untracked Playwright, log, and
  output artifacts. They remain outside this task and must not be staged or
  deleted.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-12 | Use a new S2 coordination branch from accepted foundation `785e2c4`. | Preserves the reviewed S0/S1 candidate and gives S2 an auditable base. |
| 2026-08-12 | Create four user-visible worktree tasks, with S2-0 as the contract gate. | All tasks start now, but only S2-0 may implement before the frozen handoff. |
| 2026-08-12 | Keep v1 immutable and require a new versioned CandidateSet/search contract. | Prevents existing callers from interpreting multi-candidate or completeness states incorrectly. |
| 2026-08-12 | Search, enrichment, evaluation, and Golden remain separate one-way responsibilities. | Avoids circular search/ranking and prevents production code from defining its own expected results. |
| 2026-08-12 | External research/local acquisition is allowed; production admission and publication are not automatic. | Source/license evidence can advance without turning a candidate dataset into a shipped product claim. |
| 2026-08-12 | Orchestration baseline committed as `cff3e6d`; all four task worktrees are clean detached checkouts of that exact revision. | Delivery diffs and research conclusions can be compared against one auditable base. |
| 2026-08-12 | Narrow S2 follow-ups sent to all three original research tasks. | S2-0 receives evidence from prior research without making those tasks implementation owners. |

## Lane ownership

| Lane | Exclusive paths after its dependency gate | Paths reserved to primary owner |
| --- | --- | --- |
| S2-0 Contract / Product Semantics | `src/route_decision/contracts/**`; `scripts/tests/route_decision_s2_contracts.mjs` | evaluator, route search, enrichment, Golden, package scripts, workflows, central task records |
| S2-1 Search Algorithm | `src/route_generation/candidate_search/**`; `scripts/tests/route_generation_candidate_search.mjs` | S0/S2 public contracts, current `public_adapter.js`, evaluator, enrichment, Golden, package scripts, workflows, central task records |
| S2-2 Observation / Data Admission | `src/route_decision/enrichment/**`; `scripts/tests/route_decision_enrichment.mjs` | public contracts, search, evaluator, Golden, central source-health catalog, public data manifests, package scripts, workflows, central task records |
| S2-3 Golden / Independent Verification | `scripts/lib/route_golden_s2_*.mjs`; `scripts/tests/route_generation_golden_s2.mjs`; `scripts/tests/fixtures/route_generation_s2/**` | product contracts/search/evaluator/enrichment, existing v1 Golden files, package scripts, workflows, central task records |

Tasks may recommend a narrow primary-owner adapter change, but must not cross an
exclusive path or edit a shared file without an explicit handoff.

## Dependency gates

```text
S2-0 public contract
       │
       ├──────────────► S2-1 search implementation
       │                         │
       ├──────────────► S2-2 enrichment seam
       │                         │
       └─────────────────────────┴────► S2-3 Golden full-alternative validation
```

- Before S2-0 handoff: S2-1, S2-2, and S2-3 are read-only design/research tasks.
- After S2-0 integration: the primary owner sends the exact contract revision and
  allowed paths to each dependent task.
- Golden implementation starts only when both public contract and production
  search result shape are stable enough to avoid encoding a provisional API.

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Lane-local short Node tests | Each isolated task | No committed logs; lane-local temporary output only | Allowed after code changes within owned paths |
| Shared/full validation, build, browser, or dev server | Primary integration owner | To be assigned only when needed | Not started |

## Active execution tasks

| Lane | Task ID | Worktree | Start state |
| --- | --- | --- | --- |
| S2-0 Contract / Product Semantics | `019ff435-0c08-7323-902c-39d181428af1` | `C:/Users/raede/.codex/worktrees/d9bd/engagement_project` | Active; clean detached `cff3e6d`; v1 admission and S2 decision-matrix inspection underway |
| S2-1 Search Algorithm | `019ff435-175b-7e73-b19b-da2056160929` | `C:/Users/raede/.codex/worktrees/efc3/engagement_project` | Active; clean detached `cff3e6d`; read-only graph/search architecture mapping underway |
| S2-2 Observation / Data Admission | `019ff435-334e-7080-bbe8-fbbc3a163d02` | `C:/Users/raede/.codex/worktrees/4823/engagement_project` | Active; clean detached `cff3e6d`; read-only source/provenance/admission mapping underway |
| S2-3 Golden / Independent Verification | `019ff435-579c-74f1-a81c-7b4ae1e44762` | `C:/Users/raede/.codex/worktrees/5c76/engagement_project` | Active; clean detached `cff3e6d`; read-only v1 harness/denominator mapping underway |

## Handoff

- Execution tasks do not stage, commit, merge, push, clean worktrees, or modify
  shared package/CI/task-record files. They return an uncommitted diff plus exact
  evidence to the primary integration owner.
- Required delivery package: exact base/HEAD, worktree status, changed files,
  diff summary, focused-test counts, unrun gates, contract assumptions, semantic
  risks, overlap, and recommended integration order.
- The primary owner will commit each accepted lane in its own worktree or apply a
  reviewed patch, then integrate one lane at a time.

## Next step

Monitor the four tasks and original research replies. Review S2-0's decision
matrix and executable contract first; integrate it before releasing
implementation authority to S2-1, S2-2, or S2-3.
