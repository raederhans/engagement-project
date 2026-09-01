# Context

## Current truth

- Sole clean integration baseline: `C:/Users/raede/.codex/worktrees/phase1-main/engagement_project`, `main@dfb4bc8`, tracked/index clean when lanes were dispatched.
- Local `main` contains the verified Mainline M0-M6 and ML0-ML6 work and is ahead of `origin/main@cfb0af1`; it has not been pushed.
- The primary checkout remains protected WIP on `codex/route-decision-s6-real-data@4d5c34c` with unrelated untracked logs and output.
- ML M7, public-route M7, and local-private/validation M7 are active in separate project worktrees from `main@dfb4bc8`.
- This coordination task remains the only combined integration, registry, remote-release, and cleanup owner.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-09-01 | Latest project guidance defines M7 as the last large feature stage and requires ML/route isolation. | No new M8/M9 feature family is started; work is bounded to M7 and product closeout. |
| 2026-09-01 | Live Git proves clean local `main@dfb4bc8`; old registry prose still names an earlier integration code tip. | All new lanes use live Git `dfb4bc8`, not the stale prose or `origin/main`. |
| 2026-09-01 | Existing ML and route maps show M7 was explicitly excluded from M0-M6 and is not product-wired. | The lanes implement new M7 seams instead of relabeling M5/M6 contracts as completed product work. |
| 2026-09-01 | Shared UI/release files create red overlap risk. | Public-product lane owns UI wiring; private/validation lane avoids global UI; combined integration remains serial. |
| 2026-09-01 | User requested multiple Codex conversations. | Three user-visible tasks were created; this task coordinates M7-0 readiness and final integration. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| ML focused/full validation | ML M7 task | Lane task record | Not started / full run conditional on exact registry admission |
| Public route browser/Axe/Pages-base checks | Public-product M7 task | Lane task record | Not started |
| Local OSRM/benchmark lifecycle | Private-validation M7 task | Lane task record | Not started / real engine may remain unavailable |
| Combined release gate | Current coordination task | To be recorded before execution | Pending lane integration |

## Handoff

- ML task: thread `01a05b06-64ac-7582-9ab5-7369bcc42c24`, client `client-new-thread:28c71736-6f6d-44a3-9b84-1030c36119fc`, worktree `C:/Users/raede/.codex/worktrees/a593/engagement_project`; its generated lane branch is being established from detached `dfb4bc8`.
- Public-product task: thread `01a05b06-64ac-7582-9ab5-738a0e48c03a`, client `client-new-thread:9e618765-24ed-4bee-a357-6f9ac7690e72`, worktree `C:/Users/raede/.codex/worktrees/f50e/engagement_project`, branch `codex/mainline-m7-public-product`.
- Private-validation task: thread `01a05b06-6465-75f2-bc41-28d862d24cc1`, client `client-new-thread:44528d82-c3c8-4ecd-a068-eedde03b10c5`, worktree `C:/Users/raede/.codex/worktrees/5326/engagement_project`, branch `codex/mainline-m7-private-validation`.
- Each lane may commit only to its generated task branch; it may not merge, push, deploy, edit the shared registry, or clean another worktree.

## Next step

Follow the three active lanes with bounded snapshots, keep their ownership seams aligned, and wait for commit-level delivery packages before any combined integration.
