# Context

## Current truth

- Worktree：`C:/Users/raede/.codex/worktrees/8dcb/engagement_project`。
- Branch：`codex/mainline-m0-m6`；base/merge-base/origin-main 均为
  `cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7`；创建分支前 tracked/untracked status 为空。
- Phase 2 P1-P6 已在该 base 完成集成；本轮禁止重做，只补 M0-M6 新验收目标的差距。
- Primary checkout 与八个以上 registry-listed worktrees 含受保护 WIP/ignored evidence；本任务只写
  当前隔离工作树。
- `ml/**`、`docs/active/python-ml-benchmark/**`、`.github/workflows/ml-ci.yml` 由附属模块对话所有。
- 外部 mutation（GitHub metadata、ruleset、PR/branch、release、push/deploy）只生成计划，不执行。
- 有序实现 commits：`136d755`（M0）、`37734fc`（M1-M3）、`3b3dbdf`（M4-M6）。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-31 | `HEAD=origin/main=merge-base=cfb0af1…`，工作树初始干净且 detached。 | 创建独立 `codex/mainline-m0-m6`，不接触 main owner。 |
| 2026-08-31 | 历史 Phase 2 exact-SHA CI/Pages 已成功，但明确未授予数据 promotion、scientific/routing authority。 | 本轮任何代码/fixture PASS 均不扩大这些权限。 |
| 2026-08-31 | 用户要求建立 `plan/context/task`；`manage-task-records` 适用。 | 只维护本目录一组 active records，完成前不归档。 |
| 2026-08-31 | 三个只读代码映射任务分别审计 M0-M1、M2-M3、M4-M6。 | 只读结果用于缩小改动面；主任务独占实现、Git 和测试。 |
| 2026-08-31 | v2 spatial protocol 仍绑定旧 evaluation SHA；当前 v2 evaluation bytes 为 `sha256:997aaf…`。 | 保留所有 v2 bytes；新增 v3 protocol 显式绑定当前 identity。 |
| 2026-08-31 | 当前仓库没有三源 exact payload receipts，也没有 route-bound crash/accessibility/legality/calibration/sensitivity 完整 receipts。 | M4/M5 tracked reports 保持 `unavailable`；M6 机械输出 `NO-GO/UNAVAILABLE`。 |
| 2026-08-31 | `npm run test:mainline-m0-m6` 17/17 与 focused ESLint 通过。 | 进入共享 `validate` 与 commit 阶段，不扩大实现。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| `npm run validate` | `/root` only | `.cache/mainline-m0-m6-validate.log` (ignored, task-owned) | exited 1 after 4.4 s: worktree had no `node_modules`; `maplibre-gl` unavailable before changed paths ran |
| `npm ci` | `/root` only | `.cache/mainline-m0-m6-npm-ci.log` (ignored, task-owned) | exited 0 after 6.6 s; 395 packages installed from tracked lockfile, 0 vulnerabilities reported |
| `npm run validate` retry | `/root` only | `.cache/mainline-m0-m6-validate-after-ci.log` (ignored, task-owned) | exited 1 after about 41 s: existing Diary truth test required the browser-local demo boundary in `index.html`; prior suites passed |
| targeted Diary/i18n/UI truth check | `/root` | terminal output | exited 0: 44/44 after restoring the demo-only sentence in the new M0 description |
| `npm run validate` final retry | `/root` only | `.cache/mainline-m0-m6-validate-final.log` (ignored, task-owned) | exited 1 after about 30 s: transient Windows `EPERM` in existing `crime_event_warehouse` atomic journal rename; same test had passed in prior full run |
| targeted `crime_event_warehouse` | `/root` only | `.cache/mainline-m0-m6-crime-warehouse.log` (ignored, task-owned) | exited 1: 16/18; two independent unique roots hit the same Windows `EPERM` atomic rename; no current-worktree Node process remained |
| targeted `crime_event_warehouse` final retry | `/root` only | `.cache/mainline-m0-m6-crime-warehouse-final.log` (ignored, task-owned) | exited 0 after 20.4 s: 18/18, confirming transient filesystem interference |
| `npm run validate` closeout | `/root` only | `.cache/mainline-m0-m6-validate-closeout.log` (ignored, task-owned) | exited 0 after about 85 s; all tests, production build, manifest generation and bundle policy passed |

## Handoff

最终交回总协调对话：阶段状态、commits、相对 base diff、验证命令与耗时、外部权限/真实数据缺口、
`ml/**` 语义依赖、远端 mutation plan 和推荐整合顺序。总协调对话负责 main 整合、push、远端 gate 与清理。

## Next step

总协调对话按 `136d755 -> 37734fc -> 3b3dbdf` 审查/整合，并在纳入附属 ML 工作前先解决
MA4 与 mainline Protocol v3 候选集合的语义差异；随后由其执行获授权的 push、远端 gate 和清理。
