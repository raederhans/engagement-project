# Plan

## Goal

Leave the repository with synchronized local and remote `main`, one protected user worktree, and no obsolete local P0/P1/P2 branches or worktrees.

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
- GitHub PR states for #44-#60
- `docs/archive/p2-product-completion/`
- `docs/active/_worktree_registry.md`

## Stages

- [x] Stage 1: Audit remote, branch, worktree, PR, registry, and protected-WIP truth.
- [x] Stage 2: Remove eligible auxiliary worktrees and local branches while retaining recovery SHAs and remote branches.
- [x] Stage 3: Update records, commit, push, review, merge the reconciliation, and verify exact-main CI and Pages.
- [x] Stage 4: Merge the closeout, verify CI/Pages, remove the transient worktree/local branch, and construct this archive through an isolated remote-only commit.

## Acceptance criteria

- GitHub `main`, `origin/main`, and local `main` are re-synchronized after the archive PR merge.
- The primary bilingual worktree remains untouched in its existing dirty state.
- Only the primary worktree remains.
- Local branches retained are limited to `main`, the protected bilingual branch, and branches backing open pull requests.
- Every deleted local branch has an exact SHA and a retained remote recovery ref or direct inclusion in `main`.
- Registry and archived task records describe the final local state accurately.

## Non-goals

- Do not delete remote branches or close open pull requests.
- Do not merge open QoL pull requests #44-#48.
- Do not stage, reset, rewrite, or inspect away the primary `.gitignore` and `.playwright-mcp/` WIP.
- Do not change runtime code or product behavior.

## Risks and constraints

- Five closed P2 stack branches are not Git ancestors of `main`; deletion was local-only and relies on PR #56's archived semantic-replay evidence plus retained remote refs.
- Worktree removal is destructive to uncommitted files, so every target was clean immediately before removal.
- The final archive is built from an isolated Git index and pushed directly to a remote branch, so the protected primary index and worktree never host or stage these files.
