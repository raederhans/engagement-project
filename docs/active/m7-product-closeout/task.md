# Task

## Current status

`active-lanes`：latest guidance and live Git baseline verified; three isolated M7 implementation tasks are active from `main@dfb4bc8`; combined integration and all remote mutations remain pending.

## Checklist

- [x] Read and extract the latest project guidance.
- [x] Verify protected WIP, clean integration baseline, M0-M6 delivery state, and M7 gaps.
- [x] Dispatch ML M7 governed admission lane.
- [x] Dispatch Mainline M7 public walking product lane.
- [x] Dispatch Mainline M7 local-private and validation lane.
- [x] Record ready thread ids, worktree paths, generated branches, and first progress snapshots.
- [ ] Review each lane delivery package and changed-path overlap.
- [ ] Integrate lane commits serially in dependency order.
- [ ] Run affected focused gates and the combined local release gate.
- [ ] Reconcile portfolio documentation with exact integrated facts.
- [ ] If separately authorized, perform and verify remote CI/Pages/release/governance closeout.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Browser extraction of latest assistant guidance | Complete; two M7 lines, M7-0 gate, public/local route split, admission/fallback/validation boundaries captured. |
| `git status --short --branch` in phase1-main | `main...origin/main [ahead 12]`; tracked/index clean before this coordination record. |
| `git rev-parse` / `git log` | Exact lane base `dfb4bc8a8a02e211e4fb212db847487c9970318a`. |
| `git worktree list --porcelain` | Three new detached task worktrees created at exact `dfb4bc8`; protected RD6B and evidence worktrees unchanged. |
| Read-only code mapping | ML M7 and product-wired Mainline M7 are not already implemented; M5/M6 remain contracts/no-promotion groundwork. |
| First `wait_threads` snapshot | All three primary threads active; each independently confirmed exact `dfb4bc8` and the required fail-closed/privacy boundaries before implementation. |

## Open risks and remaining work

- ML lane worktree was still detached at the first snapshot while its task branch and active records were being established.
- Full ML benchmark may remain `unavailable` without exact registry admission; that is not an implementation failure.
- Public graph/runtime admission and real local OSRM evidence may be unavailable; lanes must emit explicit unavailable receipts rather than synthetic promotion claims.
- Remote push, CI, Pages, release, ruleset, repository description/topics, and deployment are not authorized by this coordination step.
