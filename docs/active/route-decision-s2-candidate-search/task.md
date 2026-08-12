# Task

## Current status

`ready-for-integration` — all four S2 lanes and the primary-owned C-to-A
evaluation seam are integrated on coordination branch
`codex/route-decision-s2-candidate-search`. Initial code candidate `6b2d48d`
passed the complete repository validation; independent final review then found
and drove repairs for cross-edge constraint precedence, provenance audit binding,
Golden common-mode admission, and frontier capacity. Repaired code candidate
`000d85e` passes focused S2 90/90, unchanged foundation 106/106, full
JavaScript lint, diff checks, and the complete repository validation. The
independent reviewer returned `ACCEPT` with no remaining P0/P1/P2 blocker; its
last low-risk capacity-coverage watch was closed by dedicated regressions.
Nothing is merged to `main`, pushed, deployed, published, or admitted as
external production data.

## Checklist

- [x] Confirm explicit user authorization for all four S2 tasks and non-public
  handling of materials/data.
- [x] Inspect current branch, exact foundation HEAD, Git status, worktree
  topology, active records, and worktree registry.
- [x] Freeze S2 goal, non-goals, acceptance criteria, dependency gates, and
  exclusive lane ownership.
- [x] Commit the S2 orchestration baseline as `cff3e6d`.
- [x] Create and start the S2-0 Contract / Product Semantics task.
- [x] Create and start the S2-1 Search Algorithm task in read-only preparation.
- [x] Create and start the S2-2 Observation / Data Admission task in read-only
  preparation.
- [x] Create and start the S2-3 Golden / Independent Verification task in
  read-only preparation.
- [x] Register task IDs, worktrees, exact bases, and initial states.
- [x] Send narrow semantic follow-ups to the three original research tasks.
- [x] Review and integrate the S2-0 contract delivery.
- [x] Release exact contract handoffs to S2-1, S2-2, and S2-3.
- [x] Review, integrate, and verify S2-1 search and S2-2 enrichment.
- [x] Review, integrate, and verify S2-3 Golden evidence.
- [x] Add a provenance-preserving CandidateSet v2/SearchResult to evaluator
  seam while keeping the public v1 evaluator behavior and barrel unchanged.
- [x] Add a complete synthetic S2 pipeline test and one standard S2 test entry.
- [x] Complete exact-candidate full validation; retain browser, large-cohort,
  release, deployment, external-data, and publication gates as explicitly unrun.
- [x] Receive and resolve the independent final code review.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` | Foundation branch clean except pre-existing user-owned untracked Playwright/log/output artifacts. |
| `git rev-parse HEAD` | Accepted foundation `785e2c4835133d51ea9b545dc482454ae995a1e8`. |
| `git worktree list --porcelain` | Foundation and unrelated worktrees inventoried; none selected for cleanup or reuse. |
| Applicable guidance | Root instructions, `docs/AGENTS.md`, task-record, worktree-integration, and lore-commit workflows read. |
| New coordination branch | `codex/route-decision-s2-candidate-search` created from exact accepted foundation. |
| Orchestration baseline | `cff3e6defe12b3be2a438d09d1f030676cb0d6ca`; task records and registry only. |
| Four task worktrees | All clean, detached at exact `cff3e6d`, with active turns and acknowledged ownership/dependency gates. |
| Original research follow-ups | Narrow S2 questions delivered to all three source tasks; all three responses reconciled into the frozen contract and implementation review. |
| Research reconciliation | All three replies incorporated. The only conflict—hop-count tie-break—was rejected to preserve v1 K=1 parity; v1 objective then full directed edge-ID order remains frozen. |
| S2-0 lane verification | Revised contract 18/18, existing v1 contract 18/18, targeted ESLint and diff check pass. |
| S2-0 integration | Lane commit `22d685e`; integrated coordination commit `065d824`. |
| S2-1 lane verification | 16 focused search tests; 110/110 combined search/S2/v1 graph/contracts/evaluator; targeted ESLint and diff check pass. |
| S2-1 integration | Lane commit `beb193a`; integrated coordination commit `4db3f06`. |
| S2-1 constrained same-endpoint correction | Search focused suite expanded to 17/17; unresolved constrained zero-edge requests return no candidate and do not expand. Integrated as `db62cd0`. |
| S2-2 enrichment verification | 19/19 focused tests; strict source receipt/identity, pre-search projection, post-search audit, getter-zero-call, detachment, and no hidden network/evaluator back-edge checks pass. |
| S2-2 integration | Lane commits `f2a9285` and `51680a1`; integrated as `084098c` and `22e41a0`. |
| S2-3 independent Golden verification | 13/13 product-versus-independent-oracle fixtures pass; seven denominators remain separate: conformance 13, primary 6, terminals 7, alternatives 6, constraints 4, budget 1, completeness 12. |
| S2-3 integration | Lane commit `02de320`; integrated as `8e9068a`. |
| S2 evaluator seam | S2 and v1 evaluator suites 42/42; complete SearchResult/enrichment artifact is retained, zero-candidate evaluation is explicit, and provided-set decisions do not alter search completeness or termination. Integrated as `980d8a0`. |
| Standard S2 entry | `npm run test:route-decision-s2`: 81/81; covers contracts, search, enrichment, evaluator seam, complete synthetic pipeline, and independent Golden. Added as `6b2d48d`. |
| Foundation regression | `npm run test:route-decision-foundation`: 106/106; v1 contracts, evaluator, base search, and v1 Golden remain unchanged. |
| Static checks | Targeted ESLint and `git diff --check` pass for the final S2 code paths. |
| Initial candidate repository validation | `npm run validate` at code candidate `6b2d48d`: exit 0; full repository test chain, Vite manifest build, public GeoJSON artifact build, and bundle policy pass. |
| Full JavaScript lint | `npm run lint:js`: exit 0, zero warnings. |
| Post-review focused S2 | `npm run test:route-decision-s2`: 90/90; includes cross-edge fail precedence, unresolved dead-branch completion, both frontier-capacity counters, partial-candidate capacity stop, enrichment v2 input-snapshot audit binding, clean-room Golden admissions, and 15 product/oracle fixtures. |
| Post-review foundation and static checks | Foundation 106/106; full JavaScript lint and `git diff --check` pass. |
| Independent final review | `ACCEPT`; no remaining P0/P1/P2 blocker. The only low-risk watch—direct edge-reference-capacity and partial-candidate-capacity coverage—was closed by three dedicated passing regressions. |
| Repaired code-candidate validation | `npm run validate` at `000d85e`: exit 0; full repository test chain, Vite manifest build, public GeoJSON artifact build, and bundle policy pass. Log: `%TEMP%/engagement-s2-000d85e-validate.log`. |

## Open risks and remaining work

- The executable seam is intentionally synthetic-only. External source license,
  coverage, revision, and provenance have not been admitted; unavailable or
  incomplete evidence must continue to fail closed rather than become zero.
- Search proves only completion within explicit graph and budget bounds. It does
  not establish global route feasibility, city validity, accessibility, safety,
  or scientific quality.
- No UI/browser journey, large-city performance cohort, public-data admission,
  push, deployment, or publication has been performed. These remain separate
  gates despite the exact-candidate repository validation passing.
- The four isolated worktrees remain for audit. Cleanup is not authorized and is
  not required for this handoff.
- `inputCandidateFacts` makes enrichment-envelope fields mutually auditable, but
  the local unsigned envelope is not cryptographic proof of historical
  authenticity. No anti-tamper or external attestation claim is made.
- The fixed frontier capacity bounds search labels after graph admission. It
  returns an explicit incomplete terminal and is separate from the expansion
  budget; no large-city performance or memory-efficiency claim is admitted.
