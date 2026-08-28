# Task

## Current status

`M1 active — code source-final integrated; independent gate and full rebuild pending (4/4 high tasks)`。

## Checklist

- [x] 完整读取用户指定规划对话并冻结 M1-M6 语义。
- [x] 核对 local main/current branch/worktrees/dirty state 和适用 `docs/AGENTS.md`。
- [x] 证明旧 M1/M2 ignored 重型数据已丢失、tracked pipeline 仍在。
- [x] 建立隔离监督 worktree 和唯一三件套。
- [x] 派发 M1-1 数据重建、M1-2 ingest 恢复、M1-3 空间/ACS/DQ 三个 high 任务。
- [x] 记录三个任务的真实 thread/worktree/HEAD；均从 `9d93df2` 干净起步。
- [x] 在监督 base 运行 M0/M1 聚焦基线并记录结果。
- [x] 接收 M1-2/M1-3 source-final commits，按顺序整合并通过联合回归。
- [x] 派发 M1-4 独立集成与数据门禁 reviewer；本阶段新任务达到 4/4。
- [ ] 接收 M1-4 代码门禁，并在 PASS 后由 M1-1 从全新根生成 full data receipt。
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
| M1-2 source-final `3837512` | task tests 68/68; official one-day smoke 386 rows; rerun idempotent; integrated as `ffa8d45`. |
| M1-3 source-final `35c6cee` | task tests 67/67 plus focused 11/11; integrated as `5d1b0d8`. |
| `npm run test:data-pipeline` after both integrations | exit 0; 69/69 passed. |
| focused ESLint on M1 contract/source/warehouse/spatial/ACS/tests | exit 0. |
| `git diff --check` after both integrations | exit 0. |
| M1-1 source preflight | live count 3,586,621 for `[2006-01-01, 2026-08-28)`; no current warehouse receipt yet. |

## Open risks and remaining work

- M1 full official backfill may take about one hour and roughly 10 GB based on historical evidence; source schema/count
  preflight已重查，但完整 bytes、manifest、checkpoint、lineage、DQ 和 receipt 仍不存在。
- M1-1 的 50,000-row partial 明确无效且不可恢复使用；后续必须写入全新根。
- M1-4 initially returned a client thread ID while worktree setup was queued; real task ID尚待登记。
- 当前只有本地 evidence；remote CI、scheduled refresh、deployment 和 product liveness 均未运行。
- M2 历史结论为 honest `not-promoted`，本轮不得因追求功能而放松预注册 gate。
- M4/M5 的真实道路图 authority 和许可仍需从当前 main 的实际 contracts重新判定。
