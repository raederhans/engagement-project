# Context

## Current truth

- 监督 worktree：`C:/Users/raede/.codex/worktrees/dfev1-m1-m6-supervisor/engagement_project`。
- Branch：`codex/dfev1-m1-m6-supervisor`；base `9d93df211a6a51fe99d9002d494937519fd79780`。
- 本地 `main` clean，但相对本地 `origin/main@f300cfe` 超前 93 commits；未 fetch/push。
- 当前 primary worktree 在 `codex/route-decision-s6-real-data@4d5c34c`，含未跟踪 logs/output；
  它们不属于本任务。
- M0 transactional tract snapshot/full receipt/runtime projection 代码在本地 main；本轮需以
  聚焦测试确认不回归，不重新实现。
- M1-M4 tracked 代码已存在；旧 `.dfev1` 事件仓库和 Area Intelligence mart 已随临时
  worktree 消失。当前 phase1-main `.dfev1/crime` 无文件，known old roots `c180/fed9` 不存在。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-28 | 完整读取用户指定规划对话；当前请求明确扩展到 M1-M6，而旧收尾曾只冻结 M0-M2。 | 当前委派为最新授权；仍保留阶段串行门槛。 |
| 2026-08-28 | 旧 M1/M2 ignored roots 不存在，但代码和小型 tracked serving artifacts 在本地 main。 | 先重建数据，不重做已验证骨架。 |
| 2026-08-28 | 创建三个 M1 high 任务：数据重建、ingest 恢复修补、空间/ACS/DQ 门禁。 | 监督线程唯一整合 owner；完整 backfill 只允许 M1-1 写入。 |
| 2026-08-28 | M1-1 官方源 preflight 观察到 `[2006-01-01, 2026-08-28)` 共 3,586,621 rows；3,586,620 有事件时间、56,035 缺坐标、374 位于城市 bbox 外、1 缺事件时间、0 重复 `cartodb_id`。 | 这些只是 source-final 前的实时观测，不能替代仓库 receipt；冻结 full rebuild 的 exclusive through 为 `2026-08-28`。 |
| 2026-08-28 | M1-1 在暂停前留下 50,000-row、17,187,284-byte、`complete:false` 的单页 partial，0/21 yearly scopes，且无 warehouse/receipt/lineage/DQ。 | partial 保留取证但永不复用；正式重建必须写入新根。 |
| 2026-08-28 | M1-2 source-final `3837512` 与 M1-3 source-final `35c6cee` 均从 `9d93df2` 派生；监督分支分别整合为 `ffa8d45`、`5d1b0d8`。 | raw schema、partition bytes/hash/rows、overlap drift、corridor coverage、ACS/DQ admission 现均 fail-closed。 |
| 2026-08-28 | 监督分支对合并树运行 `test:data-pipeline` 69/69、聚焦 ESLint 和 `git diff --check`，全部通过。 | 仅证明代码门禁；仍需独立 reviewer 与新 M1 数据 receipt。 |
| 2026-08-28 | M1-4 (`01a048ac-1559-7323-a9a8-ad3598754140`) 对 `9d93df2..5d1b0d8` 独立审查并给出 REQUEST CHANGES。 | 完整 backfill 继续暂停；不得用绿色既有测试越过 P1 blocker。 |
| 2026-08-28 | Hostile overlap 复现证明：篡改一个不被下一 snapshot 覆盖的旧 canonical event 后，ingest 仍成功、保留伪造值并生成新的 partition binding。 | 任何 ingest 前必须先机械校验 manifest/lineage 与实际 canonical rowCount/bytes/SHA256；需补内容篡改、partition missing、非当前 vintage replay 回归。 |
| 2026-08-28 | M1-1 已把 `3837512`、`35c6cee` 同步为 detached `4c9abe2`，与监督 `5d1b0d8` 的代码/契约树等价；13/13 + ESLint + diff-check 通过。 | 候选新根仍不存在，任务等待修复后的最终 GO。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| M1 full PPD backfill and exact rerun | `01a0489b-18b7-73e0-9264-902155a8b99d` / `ac89` | task-owned `.dfev1` and `logs/` | detached `4c9abe2`; paused on M1-4 P1 blocker |
| M1 tracked source/warehouse audit | `01a0489b-188b-7d30-b0e5-f2289c13f0e3` / `954b` | task-owned worktree | active; repairing pre-ingest canonical verification |
| M1 spatial/ACS/DQ gate | `01a0489b-188b-7d30-b0e5-f2073fa849c2` / `6ad0` | task-owned worktree | complete; source-final `35c6cee` |
| M1 independent integration/data gate | `01a048ac-1559-7323-a9a8-ad3598754140` / `0062` | isolated worktree from supervisor branch | REQUEST CHANGES on `5d1b0d8`; read-only |

## Handoff

阶段尚未完成。M1-4 已证明 `5d1b0d8` 存在 overlap canonical drift re-signing blocker。
只有修复整合且复审 PASS、M1-1 从新根生成完整 receipt/manifest/checkpoint/lineage/DQ，
并由 M1-4 独立数据门禁 PASS 后，才能创建 M2 新任务。

## Next step

等待 M1-2 的 pre-ingest canonical verification 修复 source-final；整合并联合验证后让 M1-4 复审。
只有复审 PASS 才同步 M1-1 并在全新数据根执行完整重建、同命令幂等复跑和 validate-only。
