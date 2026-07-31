# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `C:/Users/raede/Desktop/dev/engagement_project` | P0/P1 product integrity | `main@8187fd4` | `main@c6fd169` | Repair product correctness, interaction, UI, and local-first Diary | integrated | state, Crime/Diary controllers, panel, compare, charts, CSS | main CI + Pages + production Chromium passed | Delivery merged through PR #28 | complete | Archive task evidence; retain main as verified state. |
| `C:/Users/raede/Desktop/dev/engagement_project-data-automation` | Compact tract refresh follow-up | `main@c6fd169` | `codex/compact-tract-refresh-main@233f551` | Continue tract refresh maintenance | in-progress | separate automation branch/worktree | owned by its task | No edits are owned by this completed P0/P1 task | separate | Preserve; do not modify or integrate here. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Delivery package

- Summary: tract pipeline, data automation, and P0/P1 product delivery are integrated through PRs #26, #27, and #28.
- Files: see each task record.
- Diff from base: product commits `516a078` and `2b9cbcc`, merged as `c6fd169`.
- Commit and branch state: local `main` and `origin/main` both point to `c6fd169`.
- Divergence from main: none for this completed delivery.
- Overlap and conflict risk: the separate compact-refresh worktree remains independently owned.
- Validation evidence: full validate, bundle policy, dependency audit, PR/main CI, Pages, local browser smoke, and production Chromium passed.
- Unverified risks: only explicit non-goals requiring a backend or real GPS routing remain.
- Recommended integration method: no further P0/P1 integration action.
