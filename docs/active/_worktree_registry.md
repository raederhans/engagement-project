# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `C:/Users/raede/Desktop/dev/engagement_project` | P0/P1 product integrity | `main@f405545` (contains pipeline `6e1619f`) | `codex/p0-p1-product-integrity@6e1619f` + verified WIP | Repair product correctness, interaction, UI, and local-first Diary | ready-for-review | state, Crime/Diary controllers, panel, compare, charts, CSS | full validate + deterministic browser smoke passed | Owns all remaining delivery changes | 1 | Finish independent re-review, commit, rebase onto current main, and integrate. |
| `C:/Users/raede/Desktop/dev/engagement_project-data-automation` | Tract data refresh automation | `main` | `codex/data-refresh-automation@b94ffec` | Keep the published tract snapshot current | in-progress | separate automation branch/worktree | owned by its task | No edits are owned by this P0/P1 task | separate | Preserve; do not modify or integrate here. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Delivery package

- Summary: tract pipeline is integrated through PR #26; P0/P1 product candidate is locally verified and awaiting final re-review.
- Files: see each task record.
- Diff from base: pending.
- Commit and branch state: WIP is on `codex/p0-p1-product-integrity`; current `main@f405545` already contains the pipeline commit.
- Divergence from main: only the pipeline merge commit separates the dirty candidate from current main; rebase after the P0/P1 commit.
- Overlap and conflict risk: no overlap with the preserved data-refresh automation worktree.
- Validation evidence: full validate, bundle policy, dependency audit, and deterministic browser smoke passed on the current diff.
- Unverified risks: final independent re-review, pull-request CI, Pages deployment, and production smoke.
- Recommended integration method: create the Lore commit, rebase onto `main@f405545`, rerun verification, then push a PR.
