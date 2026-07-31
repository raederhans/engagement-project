# Worktree Registry

| Worktree / path | Task | Base branch / commit | Current branch / HEAD | Goal | State | Hotspots | Tests | Overlap | Order | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `C:/Users/raede/Desktop/dev/engagement_project` | Product integrity and tract automation | `main@8187fd4` | `main@d5da209` | Maintain the verified public app and review-gated tract refresh | integrated | Crime/Diary runtime, tract pipeline, Actions, Pages | final validate, dependency audit, main CI, Pages, change/no-change refresh paths passed | Deliveries merged through PRs #28, #30, and #31 | complete | Monitor scheduled refresh and source-audit results; review generated changes before merge. |

States: `in-progress`, `blocked`, `ready-for-review`, `ready-for-integration`, `integrated`, `abandoned`.

## Delivery package

- Summary: tract pipeline, data automation, P0/P1 product delivery, compact refresh output, and the normalized data baseline are integrated through PRs #26, #27, #28, #30, and #31.
- Files: see each task record.
- Diff from base: product commits `516a078` and `2b9cbcc`, merged as `c6fd169`.
- Commit and branch state: local `main` and `origin/main` both point to `d5da209` before this registry-only synchronization commit.
- Divergence from main: none for this completed delivery.
- Overlap and conflict risk: no additional worktree or owned delivery branch remains.
- Validation evidence: full validate, bundle policy, dependency audit, PR/main CI, Pages, browser smoke, successful refresh PR creation, and successful no-change refresh passed.
- Unverified risks: upstream Action tags still emit Node 20 deprecation annotations; backend persistence and real GPS routing remain explicit non-goals.
- Recommended integration method: keep `main` as the single local worktree and use review-only generated data PRs for future tract changes.
