# Task

## Current status

`in-progress / S6 first bounded implementation wave prepared; writer and review
conversations pending creation from exact baseline 9c4756f`

## Checklist

- [x] Verify local `main` and `origin/main` both equal `9c4756f` and tracked/index
  state is clean while protected untracked artifacts remain present.
- [x] Create `codex/route-decision-s6-implementation` from exact `9c4756f`.
- [x] Freeze S6-A/B/C ownership, the read-only S6-R gate, dependency order,
  acceptance criteria, and downstream HOLD gates.
- [ ] Create four project worktree conversations from the committed coordination
  baseline and record their thread, worktree, HEAD, and status identities.
- [ ] Receive each writer's explicit ownership acknowledgement before writing.
- [ ] Receive S6-A functional-needs compiler freeze and focused evidence.
- [ ] Receive S6-B compact-graph contract/compiler freeze and focused evidence.
- [ ] Receive S6-C browser atomic-acceptance freeze and focused evidence.
- [ ] Receive S6-R independent review of all stable deliveries.
- [ ] Resolve any blocking finding only in the owning writer conversation and
  require a new stable freeze plus fresh review.
- [ ] Integrate accepted lanes serially with exact source equality and central
  focused/adjacent validation.
- [ ] Decide and install the standard regression entry only after final accepted
  filenames and coverage are frozen.
- [ ] Run final central validation under a single live-test owner, update remote
  truth, and merge/push only if every bounded gate passes.

## Lane control matrix

| Lane | Conversation/worktree | Exact ownership | Start gate | Delivery gate |
| --- | --- | --- | --- | --- |
| S6-A | Pending creation | `src/route_decision/functional_needs/**`; one named focused test; `route-s6-functional-needs` fixtures | Exact committed S6 baseline; clean detached worktree; ownership acknowledged | Stable owned-path freeze, focused/adjacent/static evidence, explicit non-identity/unresolved boundary |
| S6-B | Pending creation | `src/route_generation/compact_graph/**`; `scripts/lib/route_s6_compact_graph/**`; one named focused test; `route-s6-compact-graph` fixtures | Exact committed S6 baseline; clean detached worktree; ownership acknowledged | Stable owned-path freeze, deterministic compiler evidence, browser-safe contract, synthetic-only manifest/claims |
| S6-C | Pending creation | `src/route_decision/browser_acceptance/**`; one named focused test; `route-s6-browser-acceptance` fixtures | Exact committed S6 baseline; clean detached worktree; ownership acknowledged | Stable owned-path freeze, atomic summary/boundary/limitations admission, no UI/runtime/trusted-delivery claim |
| S6-R | Pending creation | Read-only; no owned paths | Exact committed S6 baseline and review rubric | Independent per-lane and combined verdict with blockers, confidence, and unrun gates |

## Closed gates

- Future compact-graph lazy loader, Worker solver, and lifecycle writing remain
  HOLD until S6-B is reviewed and centrally integrated.
- Real data, external authority, Source Health current, formal performance,
  actual browser/runtime/UI, release, publication, and deployment remain closed.
- `1,000 OD x 5` remains synthetic algorithmic/oracle evidence only; it is not
  real journey, user, safety, accessibility, or city validation.
