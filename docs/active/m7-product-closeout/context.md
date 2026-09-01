# Context

## Current truth

- Sole integration worktree: `C:/Users/raede/.codex/worktrees/phase1-main/engagement_project`; reviewed M7 lane commits and release-budget closeout are integrated locally through product tip `main@bf4bfbc`.
- Local `main` contains the verified Mainline M0-M6 and ML0-ML6 work and is ahead of `origin/main@cfb0af1`; it has not been pushed.
- The primary checkout remains protected WIP on `codex/route-decision-s6-real-data@4d5c34c` with unrelated untracked logs and output.
- ML M7, public-route M7, and local-private/validation M7 completed in separate project worktrees from `main@dfb4bc8`; their worktrees remain preserved and clean.
- This coordination task remains the only combined integration, registry, remote-release, and cleanup owner.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-09-01 | Latest project guidance defines M7 as the last large feature stage and requires ML/route isolation. | No new M8/M9 feature family is started; work is bounded to M7 and product closeout. |
| 2026-09-01 | Live Git proves clean local `main@dfb4bc8`; old registry prose still names an earlier integration code tip. | All new lanes use live Git `dfb4bc8`, not the stale prose or `origin/main`. |
| 2026-09-01 | Existing ML and route maps show M7 was explicitly excluded from M0-M6 and is not product-wired. | The lanes implement new M7 seams instead of relabeling M5/M6 contracts as completed product work. |
| 2026-09-01 | Shared UI/release files create red overlap risk. | Public-product lane owns UI wiring; private/validation lane avoids global UI; combined integration remains serial. |
| 2026-09-01 | User requested multiple Codex conversations. | Three user-visible tasks were created; this task coordinates M7-0 readiness and final integration. |
| 2026-09-01 | Independent reviews blocked forged public-fixture admission, forged ML admission/arbitrary output paths, and unauthenticated private-loopback/module-loading paths. | Each blocker was remediated in its owning lane and re-reviewed PASS before integration. |
| 2026-09-01 | ML and public commits overlapped in `package.json`; private validation reused the public `test:mainline-m7` name. | Integration preserved `test:ml-m7`, split `test:mainline-m7-public` and `test:mainline-m7-private`, and made `test:mainline-m7` their aggregate. No threshold was relaxed. |
| 2026-09-01 | Twelve reviewed lane commits were cherry-picked serially onto coordination `main@19118c6`. | Current combined code tip is `0202f5a`; remote state remains untouched. |
| 2026-09-01 | The first exact release run reached bundle policy and failed because release-enabled non-VRE output was 454 bytes above the frozen ceiling. | The threshold was not raised; repeated public source dates were normalized through a strict three-entry table while admitted output remains ISO and fail closed. |
| 2026-09-01 | The next release run exposed five intentional visual baseline changes plus a real 166-byte Diary initial-script overage. | Visual inspection found the new M7 entry and release feature state valid; generic existing loading/retry copy recovered the script budget, and only five reviewed baselines were refreshed. |
| 2026-09-01 | Final release, M7 Pages browser, coverage, and bounded diff review all passed. | Local M7 implementation and product closeout are complete at `bf4bfbc`; no remote authority is implied. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| ML focused/full validation | ML M7 task | Lane task record | Completed focused gates; full run unavailable without exact registry |
| Public route browser/Axe/Pages-base checks | Public-product M7 task | Lane task record | Completed in lane |
| Local OSRM/benchmark lifecycle | Private-validation M7 task | Lane task record | Focused gates completed; real engine benchmark unavailable |
| Combined `npm run validate` | Current coordination task only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-combined-validate-20260901-1316.log` | PASS, exit 0; no ports, wrote only this worktree's `dist/` |
| Combined Pages-base M7 browser/Axe | Current coordination task only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-combined-pages-20260901-1320.log` | PASS, exit 0; task-owned preview on 4207 closed |
| Combined Python ML gates | Current coordination task only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-combined-ml-20260901-1323.log` | PASS, exit 0; no ports; one documented live-symlink permission skip |
| First combined `npm run ci:release` | Current coordination task only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-combined-release-20260901-1326.log` | FAIL at frozen bundle policy; non-VRE exceeded by 454 bytes; no threshold change. |
| Visual baseline diagnosis/update | Current coordination task only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-visual-baseline-update-20260901-1405.log` | PASS: 35 passed / 10 project-scoped skips; only five reviewed release-config baselines changed. |
| Final combined `npm run ci:release` | Current coordination task only | `C:/Users/raede/AppData/Local/Temp/engagement-m7-combined-release-final-20260901-1410.log` | PASS, exit 0; release bundle, browser/visual matrix, and listener postcondition passed. |
| Final Pages-base M7 browser/Axe | Current coordination task only | Current-turn command output | PASS; task-owned preview on 4207 closed. |
| `npm run coverage:report` | Current coordination task only | Current-turn command output | PASS, 76/76; report-only coverage generated. |

## Handoff

- ML task: thread `01a05b06-64ac-7582-9ab5-7369bcc42c24`, client `client-new-thread:28c71736-6f6d-44a3-9b84-1030c36119fc`, worktree `C:/Users/raede/.codex/worktrees/a593/engagement_project`, branch `codex/ml-m7-governed-admission`.
- Public-product task: thread `01a05b06-64ac-7582-9ab5-738a0e48c03a`, client `client-new-thread:9e618765-24ed-4bee-a357-6f9ac7690e72`, worktree `C:/Users/raede/.codex/worktrees/f50e/engagement_project`, branch `codex/mainline-m7-public-product`.
- Private-validation task: thread `01a05b06-6465-75f2-bc41-28d862d24cc1`, client `client-new-thread:44528d82-c3c8-4ecd-a068-eedde03b10c5`, worktree `C:/Users/raede/.codex/worktrees/5326/engagement_project`, branch `codex/mainline-m7-private-validation`.
- Each lane may commit only to its generated task branch; it may not merge, push, deploy, edit the shared registry, or clean another worktree.
- Integrated source sequences: ML `8579abb -> 9bf297f -> 471e3c0 -> 79a1ccb`; public `53f90ca -> 8d75065 -> 79a6217 -> ec6d9ff`; private/validation `67eceed -> 5e546a4 -> 083e797 -> 77c71c3`.

## Next step

No local M7 implementation gate remains. If separately authorized, the next phase is remote push followed by exact-SHA CI/Pages/deployment/governance verification; until then, remote state and repository settings remain untouched.
