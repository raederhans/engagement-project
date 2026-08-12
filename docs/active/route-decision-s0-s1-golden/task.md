# Task

## Current status

`dispatching` — the shared orchestration and ownership contract is being frozen
before four isolated implementation tasks are created.

## Checklist

- [x] Confirm authorized implementation scope, non-public data boundary, and
  primary integration ownership.
- [x] Inspect current branch, HEAD, worktree topology, untracked artifacts, active
  records, and existing worktree registry.
- [x] Define four non-overlapping execution lanes and provisional cross-lane
  object shapes.
- [ ] Commit the coordination baseline.
- [ ] Create and start the S0 contracts worktree task.
- [ ] Create and start the S1-A evaluator worktree task.
- [ ] Create and start the S1-C graph/router worktree task.
- [ ] Create and start the Golden validation worktree task.
- [ ] Record task IDs, branches/worktrees, ownership, and start status.
- [ ] Monitor all four tasks, provide bounded guidance, and record any escalation
  to an original research task.
- [ ] Review each ready-for-integration delivery package.
- [ ] Integrate in dependency order and run integrated targeted verification.
- [ ] Decide whether broader validation and the next S2 data-admission batch are
  ready to start.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` before task edits | `main...origin/main`; only pre-existing untracked Playwright/log/output artifacts. |
| `git rev-parse HEAD` | `1e9fecad2e42e8081a8fb3f6fee7a0ac175786c8`. |
| `git worktree list --porcelain` | Existing unrelated Codex worktrees inventoried; none will be cleaned or repurposed. |
| Active task and registry inspection | Existing project-native `docs/active/**` structure and `docs/active/_worktree_registry.md` identified and preserved. |

## Open risks and remaining work

- The existing registry contains historical statements that are not the current
  Git topology; this task will append current scoped rows rather than rewriting
  unrelated history.
- Four lanes begin without one another's uncommitted files. The provisional
  contract and exclusive ownership rules are therefore mandatory until S0 is
  integrated.
- No OSM/City/SEPTA/ArcGIS production data is admitted in this batch. Golden and
  synthetic evidence cannot be promoted into Philadelphia or real-user claims.
- Standard package aggregation, bundle checks, full validation, browser smoke,
  commit integration, push, and deployment remain primary-owner work.
