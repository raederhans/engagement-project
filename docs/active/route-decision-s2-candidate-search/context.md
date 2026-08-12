# Context

## Current truth

- S2 starts from the accepted foundation revision
  `785e2c4835133d51ea9b545dc482454ae995a1e8`.
- The primary integration owner created coordination branch
  `codex/route-decision-s2-candidate-search`. The four S2 lanes, evaluation seam,
  and audit repairs were fast-forwarded onto local `main` through `d2e6335` and
  released on remote `main@a2b9c0c`; repository CI/Pages passed while the S2
  seam remains production-isolated and unpublished as a route capability.
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
| 2026-08-12 | All three research replies were reconciled into the S2-0 decision matrix. | K is a cap including primary; route identity is the complete ordered directed edge-ID sequence; only complete edge-local capability evidence may affect search; bounded completeness, constraint outcome, budget outcome, and termination remain separate. |
| 2026-08-12 | Route research proposed a hop-count tie-break, conflicting with accepted v1 and K=1 base-solver parity. | Rejected for S2 v1; route-generation tie-break remains objective cost then full directed edge-ID sequence. A future product change requires a new version. |
| 2026-08-12 | Primary review returned four narrow contract changes: bounded no-route naming, terminal exclusivity, canonical constraint order, and auditable expanded-state count. | S2-0 implemented all four and added regression coverage before integration. |
| 2026-08-12 | S2-0 integrated as `065d824` after 18/18 S2 and 18/18 v1 contract tests plus targeted ESLint. | S2-1 and S2-2 implementation gates opened; S2-3 received contract context but still waits for stable search shape. |
| 2026-08-12 | S2-1 implemented a deterministic bounded loopless directed-path enumerator with a machine-readable frontier-expansion unit. | K=1 matches base Dijkstra; only finalized ordered prefixes are returned; bounded no-route/no-eligible/unresolved/budget states remain distinct. |
| 2026-08-12 | S2-1 integrated as `4db3f06` after 16 focused and 110 combined tests plus targeted ESLint. | S2-3 received the exact production entrypoint/result shape and its implementation gate opened. |
| 2026-08-12 | Constrained same-endpoint search was corrected to fail closed when edge-local evidence is unresolved; unconstrained same-endpoint requests retain the zero-edge primary. | Prevents a zero-edge shortcut from silently bypassing an admitted hard constraint; correction integrated as `db62cd0`. |
| 2026-08-12 | S2-2 added a synthetic-only, source-receipted enrichment projection plus strict pre-search and post-search admission envelopes. | Search sees only admitted edge evidence; receipts, source identities, candidate audits, non-known states, getter safety, and detachment remain mechanically enforced. Integrated as `084098c` and `22e41a0`. |
| 2026-08-12 | S2-3 added an independent bounded DFS oracle, separate product adapter, 13 fixture comparisons, and seven non-combined denominators. | Product search does not define its own expected routes, and primary, terminal, alternative, constraint, budget, and completeness evidence cannot be inflated into one score. Integrated as `8e9068a`. |
| 2026-08-12 | The public v1 evaluator remains unchanged while a separate S2 search-evaluation envelope consumes either an admitted raw SearchResult or the complete admitted enrichment artifact. | Search metadata and provenance are retained end to end; evaluation remains scoped to the provided candidate set and cannot create a global infeasibility claim. Integrated as `980d8a0`. |
| 2026-08-12 | A synthetic evidence-to-search-to-enrichment-to-evaluation integration test and `test:route-decision-s2` standard entry were added. | The complete local S2 pipeline is now executable through the repository test chain without admitting external or production data. Integrated as `6b2d48d`. |
| 2026-08-12 | Independent final review found cross-edge fail-precedence drift: an unresolved prefix was pruned before a later known-false edge could dominate. | Search now carries unresolved state to route finalization, known-false dominates across the complete bounded route, and the independent oracle derives terminal truth from exhaustive route classification. Two new Golden fixtures cover cross-edge precedence and a known-false branch cut by `maxRouteEdgeCount`. |
| 2026-08-12 | Independent final review proved `candidateAudits[].inputSourceId` could be changed independently of the actual pre-enrichment observation. | Enrichment result schemas advance to v2 and retain admitted `inputCandidateFacts`; admissions bind route/provenance identity and every audit input source to that snapshot. This detects internal drift, not cryptographic artifact forgery. |
| 2026-08-12 | Expansion budget did not bound generated frontier memory on a high-outdegree graph. | Product search now has a separate fixed frontier-state/edge-reference capacity and returns `search-capacity-exhausted` with `not-proven`; it is not reported as expansion-budget exhaustion or bounded completeness. |
| 2026-08-12 | The S2 Golden oracle imported production request/observation admissions. | Oracle fixtures now use a local, clean-room admission implementation; production contract/search code remains reachable only through the thin product adapter and harness result admission. |
| 2026-08-12 | Independent final review returned `ACCEPT` after the repairs, with one low-risk test-depth watch on the second capacity counter and partial-candidate stop. | Three dedicated regressions now cover frontier edge-reference capacity plus zero- and nonzero-candidate capacity terminals; the final focused S2 suite is 90/90 and no P0/P1/P2 blocker remains. |
| 2026-08-12 | Pre-integration architecture review found that frontier capacity was still encoded as a budget outcome and omitted its active policy from the public artifact. | CandidateSet advances to v3 with independent `capacityPolicy` and `capacityOutcome`; SearchResult advances to v2, search enrichment to v3, and search evaluation to v2. Budget and capacity exhaustion are mutually exclusive and neither can claim bounded completeness. |
| 2026-08-12 | Golden lacked an independent capacity denominator, and strict admissions still performed direct property reads after descriptor inspection. | Golden advances its manifest/case/ledger/oracle contracts, adds zero- and partial-candidate capacity fixtures, and reports 17 fixtures across eight denominators. Foundation and S2 admissions now snapshot data descriptors; post-admission compiler failures remain internal failures. Repaired as `0cd7ccc`. |
| 2026-08-12 | Exact `0cd7ccc` pre-integration review and focused verification completed. | Code/spec/security review returned `ACCEPT`; architecture confirmed the code blocker closed and required central record synchronization. S2 92/92, foundation 107/107, full JavaScript lint, and diff checks pass. Full `npm run validate` at this exact revision remains unrun until main fast-forward. |
| 2026-08-12 | Central record synchronization completed as `d2e6335`, and the accepted chain was fast-forwarded onto local `main`. | Final architecture verdict is `ACCEPT/CLEAR`; integration had no conflict, merge commit, force push, or worktree cleanup. |
| 2026-08-12 | Exact local-main full validation, release/browser gates, and coverage reporting passed at `d2e6335`. | The revision is locally push-ready; exact pushed-SHA CI/Pages, public data admission, and production claims remain independent gates. |
| 2026-08-12 | Remote release `a2b9c0c` passed GitHub run `31572576490`; Pages deployment `5864814044` verified the candidate was still the main tip and completed successfully. | Repository publication is verified, but no external route data, S2 route UI, safety/recommendation claim, or scientific validation is admitted. This follow-up is record-only. |

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
| Shared/full validation, build, browser, or dev server | Primary integration owner | Primary console evidence only | At `main@d2e6335`, `validate` and `ci:release` exit 0; browser smoke and Playwright 35 passed/10 designed skips |
| Exact-candidate `npm run validate` | Primary integration owner | `%TEMP%/engagement-s2-6b2d48d-validate.log` | Completed at code candidate `6b2d48d`, exit 0; full test chain, manifest build, and bundle policy pass |
| Post-review repair validation | Primary integration owner | `%TEMP%/engagement-s2-000d85e-validate.log` | Focused S2 90/90, foundation 106/106, full JS lint and diff check pass; `npm run validate` completed at code candidate `000d85e`, exit 0 |
| Pre-integration audit repair | Primary integration owner | No persistent log; command output captured in the integration task | Exact code `0cd7ccc`: focused S2 92/92, foundation 107/107, full JS lint and diff check pass; final record `d2e6335` then passed exact local-main full/release/browser gates |

## Active execution tasks

| Lane | Task ID | Worktree | Start state |
| --- | --- | --- | --- |
| S2-0 Contract / Product Semantics | `019ff435-0c08-7323-902c-39d181428af1` | `C:/Users/raede/.codex/worktrees/d9bd/engagement_project` | Completed; lane `22d685e`, integrated `065d824`; worktree clean |
| S2-1 Search Algorithm | `019ff435-175b-7e73-b19b-da2056160929` | `C:/Users/raede/.codex/worktrees/efc3/engagement_project` | Completed; lane `beb193a` plus follow-up `362cff3`, integrated as `4db3f06` and path-equivalent primary correction `db62cd0`; worktree clean |
| S2-2 Observation / Data Admission | `019ff435-334e-7080-bbe8-fbbc3a163d02` | `C:/Users/raede/.codex/worktrees/4823/engagement_project` | Completed; lane commits `f2a9285` and `51680a1`, integrated as `084098c` and `22e41a0`; worktree retained for audit |
| S2-3 Golden / Independent Verification | `019ff435-579c-74f1-a81c-7b4ae1e44762` | `C:/Users/raede/.codex/worktrees/5c76/engagement_project` | Completed; lane commit `02de320`, integrated as `8e9068a`; worktree retained for audit |

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

Keep the four isolated worktrees for audit. External data admission, a public
S2 route product, and stronger route-product claims remain separate future work.
