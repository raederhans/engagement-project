# Task

## Current status

`ready-for-integration` — all four S2 lanes and the primary-owned C-to-A
evaluation seam are integrated on coordination branch
`codex/route-decision-s2-candidate-search`. Earlier candidates `6b2d48d` and
`000d85e` passed the complete repository validation; the pre-integration audit
then found descriptor-read, internal-failure-classification, and public capacity
contract gaps. Exact repaired candidate `0cd7ccc` passes focused S2 92/92,
foundation 107/107, full JavaScript lint, and diff checks. Code/spec/security
review returned `ACCEPT`; architecture review confirmed the code blocker closed
and requested this exact-candidate record synchronization. Full repository
validation has not yet been rerun at `0cd7ccc` and remains the post-integration
main-branch gate.
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
- [x] Add a provenance-preserving CandidateSet v3/SearchResult v2 to evaluator
  seam through search-enrichment v3 and evaluation v2 while keeping the public
  foundation v1 evaluator behavior and barrel unchanged.
- [x] Add a complete synthetic S2 pipeline test and one standard S2 test entry.
- [x] Complete full validation for earlier code candidates; retain exact
  `0cd7ccc` full validation, browser, large-cohort, release, deployment,
  external-data, and publication as explicitly separate gates.
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
| S2-3 independent Golden verification | 17/17 product-versus-independent-oracle fixtures pass; eight denominators remain separate: conformance 1, primary 7, terminals 11, alternatives 7, constraints 6, budget 1, capacity 2, completeness 16. |
| S2-3 integration | Lane commit `02de320`; integrated as `8e9068a`. |
| S2 evaluator seam | S2 and v1 evaluator suites 42/42; complete SearchResult/enrichment artifact is retained, zero-candidate evaluation is explicit, and provided-set decisions do not alter search completeness or termination. Integrated as `980d8a0`. |
| Standard S2 entry | `npm run test:route-decision-s2`: 81/81; covers contracts, search, enrichment, evaluator seam, complete synthetic pipeline, and independent Golden. Added as `6b2d48d`. |
| Foundation regression | `npm run test:route-decision-foundation`: 107/107; v1 contracts, evaluator, base search, and v1 Golden remain unchanged; hostile Proxy admission adds zero-direct-get coverage. |
| Static checks | Targeted ESLint and `git diff --check` pass for the final S2 code paths. |
| Initial candidate repository validation | `npm run validate` at code candidate `6b2d48d`: exit 0; full repository test chain, Vite manifest build, public GeoJSON artifact build, and bundle policy pass. |
| Full JavaScript lint | `npm run lint:js`: exit 0, zero warnings. |
| Pre-integration focused S2 | `npm run test:route-decision-s2`: 92/92; includes orthogonal budget/capacity admissions, version cascades, descriptor snapshots, compiler-failure truth, enrichment v3 binding, clean-room Golden admission, and 17 product/oracle fixtures. |
| Pre-integration foundation and static checks | Foundation 107/107; full JavaScript lint and `git diff --check` pass. |
| Pre-integration independent reviews | Exact `0cd7ccc` code/spec/security review: `ACCEPT`, 0 P0/P1/P2. Architecture review: code blocker closed; exact task/registry synchronization required before final verdict. |
| Repaired code-candidate validation | `npm run validate` at `000d85e`: exit 0; full repository test chain, Vite manifest build, public GeoJSON artifact build, and bundle policy pass. Log: `%TEMP%/engagement-s2-000d85e-validate.log`. |
| Exact candidate full-validation gate | Not run at `0cd7ccc`; the earlier `000d85e` pass is historical evidence only. Integration owner will run `npm run validate` on the fast-forwarded exact `main` before push. |

## Open risks and remaining work

- The executable seam is intentionally synthetic-only. External source license,
  coverage, revision, and provenance have not been admitted; unavailable or
  incomplete evidence must continue to fail closed rather than become zero.
- Search proves only completion within explicit graph, budget, and versioned
  capacity-policy bounds. It does
  not establish global route feasibility, city validity, accessibility, safety,
  or scientific quality.
- No UI/browser journey, large-city performance cohort, public-data admission,
  push, deployment, or publication has been performed. Full repository
  validation for exact candidate `0cd7ccc` is also pending the main fast-forward;
  earlier candidate validation does not prove the current revision.
- The four isolated worktrees remain for audit. Cleanup is not authorized and is
  not required for this handoff.
- `inputCandidateFacts` makes enrichment-envelope fields mutually auditable, but
  the local unsigned envelope is not cryptographic proof of historical
  authenticity. No anti-tamper or external attestation claim is made.
- The fixed frontier capacity bounds search labels after graph admission. It
  returns an explicit incomplete terminal and is separate from the expansion
  budget; no large-city performance or memory-efficiency claim is admitted.
