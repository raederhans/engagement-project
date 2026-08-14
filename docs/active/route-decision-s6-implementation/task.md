# Task

## Current status

`in-progress / four S6 conversations dispatched from coordination baseline
0ff0adc; S6-A and S6-B active, S6-C and S6-R queued for local execution slots`

## Checklist

- [x] Verify local `main` and `origin/main` both equal `9c4756f` and tracked/index
  state is clean while protected untracked artifacts remain present.
- [x] Create `codex/route-decision-s6-implementation` from exact `9c4756f`.
- [x] Freeze S6-A/B/C ownership, the read-only S6-R gate, dependency order,
  acceptance criteria, and downstream HOLD gates.
- [x] Create four project worktree conversations from the committed coordination
  baseline; two are active and two remain queued with stable client identities.
- [ ] Record S6-C/S6-R final thread/worktree identities when app registration
  completes; do not guess the mapping from allocated worktree paths.
- [ ] Receive each writer's explicit ownership acknowledgement before writing;
  S6-A and S6-B have acknowledged, while queued S6-C remains pending.
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
| S6-A | Thread `019ffe24-55d4-7590-af69-e3fe2720a30d`; `C:/Users/raede/.codex/worktrees/f226/engagement_project` | `src/route_decision/functional_needs/**`; one named focused test; `route-s6-functional-needs` fixtures | Clean detached exact `0ff0adc`; empty index/status; ownership acknowledged | Stable owned-path freeze, focused/adjacent/static evidence, explicit non-identity/unresolved boundary |
| S6-B | Thread `019ffe24-5ee5-7ad2-ad48-e37c598d162f`; `C:/Users/raede/.codex/worktrees/cb8b/engagement_project` | `src/route_generation/compact_graph/**`; `scripts/lib/route_s6_compact_graph/**`; one named focused test; `route-s6-compact-graph` fixtures | Clean detached exact `0ff0adc`; empty index/status; ownership acknowledged | Stable owned-path freeze, deterministic compiler evidence, browser-safe contract, synthetic-only manifest/claims |
| S6-C | Queued client `client-new-thread:d4bd642a-f184-478b-b013-b1fd5cb26e47`; worktree allocated, final mapping pending | `src/route_decision/browser_acceptance/**`; one named focused test; `route-s6-browser-acceptance` fixtures | Must prove clean detached exact `0ff0adc` and acknowledge ownership after registration | Stable owned-path freeze, atomic summary/boundary/limitations admission, no UI/runtime/trusted-delivery claim |
| S6-R | Queued client `client-new-thread:7bdb3b2f-aa4e-419a-99f3-2da1dfb1247d`; worktree allocated, final mapping pending | Read-only; no owned paths | Must prove exact `0ff0adc` and remain read-only after registration | Independent per-lane and combined verdict with blockers, confidence, and unrun gates |

## Closed gates

- Future compact-graph lazy loader, Worker solver, and lifecycle writing remain
  HOLD until S6-B is reviewed and centrally integrated.
- Real data, external authority, Source Health current, formal performance,
  actual browser/runtime/UI, release, publication, and deployment remain closed.
- `1,000 OD x 5` remains synthetic algorithmic/oracle evidence only; it is not
  real journey, user, safety, accessibility, or city validation.
