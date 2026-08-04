# Plan

## Goal

Leave the repository with a synchronized local and remote `main`, one protected user worktree, and no obsolete local P0/P1/P2 branches or worktrees.

## Scope

- Re-audit remote `main`, local branches, worktree dirt, open pull requests, and archived integration evidence.
- Preserve the dirty bilingual-localization worktree and all branches backing open pull requests.
- Remove clean merged P2 worktrees and clean closed P2 stack worktrees that PR #56 semantically replayed and verified.
- Delete only local branches that are merged, closed-and-superseded with remote recovery refs, or attached to removed worktrees.
- Synchronize local `main`, publish the registry/task-record correction through pull requests, and verify CI and Pages.

## Sources of truth

- `git ls-remote origin refs/heads/main`
- `git worktree list --porcelain`
- Local branch ancestry and ahead/behind counts against `origin/main`
- GitHub PR states for #44-#59
- `docs/archive/p2-product-completion/`
- `docs/active/_worktree_registry.md`

## Stages

- [x] Stage 1: Audit remote, branch, worktree, PR, registry, and protected-WIP truth.
- [x] Stage 2: Remove eligible auxiliary worktrees and local branches while retaining recovery SHAs and remote branches.
- [x] Stage 3: Update records, commit, push, review, merge the reconciliation, and verify exact-main CI and Pages.
- [ ] Stage 4: Merge this closeout, verify CI/Pages, remove the transient worktree/local branch, then archive through a remote-only commit that creates no new local worktree.

## Acceptance criteria

- GitHub `main`, `origin/main`, and local `main` resolve to the same final merge commit.
- The primary bilingual worktree remains byte-for-byte untouched in its existing dirty state.
- Only the primary worktree remains after the transient integration worktree is removed.
- Local branches retained are limited to `main`, the protected bilingual branch, and branches backing open pull requests.
- Every deleted local branch has an exact SHA and a retained remote recovery ref or direct inclusion in `main`.
- Registry and archived task records describe the final state accurately.

## Non-goals

- Do not delete remote branches or close open pull requests.
- Do not merge open QoL pull requests #44-#48.
- Do not stage, reset, rewrite, or inspect away the primary `.gitignore` and `.playwright-mcp/` WIP.
- Do not change runtime code or product behavior.

## Risks and constraints

- Five closed P2 stack branches are not Git ancestors of `main`; deletion is local-only and relies on PR #56's archived semantic-replay evidence plus retained remote refs.
- Worktree removal is destructive to uncommitted files, so every target was required to be clean immediately before removal.
- The closeout worktree cannot honestly record its own future deletion. Final archival therefore occurs after removal through an isolated temporary index and remote branch, without touching the primary index or creating another worktree.
