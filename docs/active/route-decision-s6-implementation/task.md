# Task

## Current status

`in-progress / S6-A/B/C stable freezes independently identity-checked; S6-R
running the read-only per-lane and combined review over those exact bytes`

## Checklist

- [x] Verify local `main` and `origin/main` both equal `9c4756f` and tracked/index
  state is clean while protected untracked artifacts remain present.
- [x] Create `codex/route-decision-s6-implementation` from exact `9c4756f`.
- [x] Freeze S6-A/B/C ownership, the read-only S6-R gate, dependency order,
  acceptance criteria, and downstream HOLD gates.
- [x] Create four project worktree conversations from the committed coordination
  baseline and record every final thread/worktree mapping.
- [x] Receive every active task's exact clean detached `0ff0adc` preflight and
  ownership/read-only acknowledgement before implementation or review work.
- [x] Receive S6-A functional-needs compiler freeze and focused evidence.
- [x] Receive S6-B compact-graph contract/compiler freeze and focused evidence.
- [x] Receive S6-C browser atomic-acceptance freeze and focused evidence.
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
| S6-A | Thread `019ffe24-55d4-7590-af69-e3fe2720a30d`; `C:/Users/raede/.codex/worktrees/f226/engagement_project` | `src/route_decision/functional_needs/**`; one named focused test; `route-s6-functional-needs` fixtures | Clean detached exact `0ff0adc`; empty index/status; ownership acknowledged | Stable owned-path freeze, focused/adjacent/static evidence, explicit non-identity/unresolved boundary |
| S6-B | Thread `019ffe24-5ee5-7ad2-ad48-e37c598d162f`; `C:/Users/raede/.codex/worktrees/cb8b/engagement_project` | `src/route_generation/compact_graph/**`; `scripts/lib/route_s6_compact_graph/**`; one named focused test; `route-s6-compact-graph` fixtures | Clean detached exact `0ff0adc`; empty index/status; ownership acknowledged | Stable owned-path freeze, deterministic compiler evidence, browser-safe contract, synthetic-only manifest/claims |
| S6-C | Thread `019ffe27-f6dc-72f2-ae30-d5dadb666f5b`; `C:/Users/raede/.codex/worktrees/221b/engagement_project` | `src/route_decision/browser_acceptance/**`; one named focused test; `route-s6-browser-acceptance` fixtures | Clean detached exact `0ff0adc`; empty index/status; ownership acknowledged | Stable owned-path freeze, atomic summary/boundary/limitations admission, no UI/runtime/trusted-delivery claim |
| S6-R | Thread `019ffe27-e6e6-7851-bd13-20a5a2c54d5a`; `C:/Users/raede/.codex/worktrees/f6e7/engagement_project` | Read-only; no owned paths | Clean detached exact `0ff0adc`; empty index/status; read-only boundary acknowledged; rubric prepared | Independent per-lane and combined verdict with blockers, confidence, and unrun gates |

## Closed gates

- Future compact-graph lazy loader, Worker solver, and lifecycle writing remain
  HOLD until S6-B is reviewed and centrally integrated.
- Real data, external authority, Source Health current, formal performance,
  actual browser/runtime/UI, release, publication, and deployment remain closed.
- `1,000 OD x 5` remains synthetic algorithmic/oracle evidence only; it is not
  real journey, user, safety, accessibility, or city validation.
