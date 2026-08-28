# Task

## Current status

`M1 active — data recovery dispatched (3/4 high tasks)`。

## Checklist

- [x] 完整读取用户指定规划对话并冻结 M1-M6 语义。
- [x] 核对 local main/current branch/worktrees/dirty state 和适用 `docs/AGENTS.md`。
- [x] 证明旧 M1/M2 ignored 重型数据已丢失、tracked pipeline 仍在。
- [x] 建立隔离监督 worktree 和唯一三件套。
- [x] 派发 M1-1 数据重建、M1-2 ingest 恢复、M1-3 空间/ACS/DQ 三个 high 任务。
- [x] 记录三个任务的真实 thread/worktree/HEAD；均从 `9d93df2` 干净起步。
- [x] 在监督 base 运行 M0/M1 聚焦基线并记录结果。
- [ ] 接收/审查 M1 commits 与 full data receipt，按 source-final 顺序整合。
- [ ] 运行 M1 stage gate；更新 verdict 并在 PASS 后派发 M2。
- [ ] M2 Area Intelligence stage gate。
- [ ] M3 Home and Neighborhood Compare stage gate。
- [ ] M4 Known Route Evidence stage gate。
- [ ] M5 Adaptive Route Alternatives stage gate。
- [ ] M6 Local Diary / closed Community Evidence stage gate。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` on primary | primary branch has only untracked logs/output; preserved. |
| `git status --short --branch` on phase1-main | clean local main, ahead of local origin/main by 93. |
| `.dfev1` inventory on phase1-main | `crime` directory contains 0 files. |
| known historical data roots `c180` and `fed9` | absent; no recovery shortcut available there. |
| `git worktree add -b codex/dfev1-m1-m6-supervisor ... main` | exit 0 at exact `9d93df2`. |
| `npm ci` | exit 0; 395 packages installed, 396 audited, 0 vulnerabilities. |
| `npm run test:data-pipeline` | exit 0; 66/66 M0-M3 pipeline/contract tests passed. |
| `npm run data:check:tract-crime` | exit 0; current 408-tract snapshot/full receipt/runtime projection pair valid for `[2025-08-01, 2026-08-01)`. |

## Open risks and remaining work

- M1 full official backfill may take about one hour and roughly 10 GB based on historical evidence; current source
  schema/count/storage must be rechecked before use.
- 新 Codex tasks initially returned client thread IDs while worktree setup was queued; real task IDs尚待登记。
- 当前只有本地 evidence；remote CI、scheduled refresh、deployment 和 product liveness 均未运行。
- M2 历史结论为 honest `not-promoted`，本轮不得因追求功能而放松预注册 gate。
- M4/M5 的真实道路图 authority 和许可仍需从当前 main 的实际 contracts重新判定。
