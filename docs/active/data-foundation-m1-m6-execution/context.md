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
| 2026-08-28 | M1-2 修复 source-final `34b90bd`（parent `3837512`）将 actual canonical scan 提升为所有 existing-warehouse ingest 的统一前置 gate；监督整合为 `037c615`。 | manifest/lineage/partition set/JSON parse/actual rows/bytes/SHA256/warehouse row count 任一漂移均在 transaction 前失败。 |
| 2026-08-28 | 合并树 `test:data-pipeline` 72/72、目标 ESLint、diff-check 通过；M1-4 证明 `037c615` 与 `34b90bd` stable patch-id 相同，原 hostile repro 现拒绝且不留 transaction。 | M1-4 代码门禁 PASS，允许开始重建；不等于数据门禁 PASS。 |
| 2026-08-28 | M1-1 同步为 detached `8325842`，产品代码树与监督 `037c615` 等价；正式根冻结为 `event-warehouse-v1-2006-through-2026-08-28-source-final-037c615`。 | 旧 partial 继续保留；正式首轮成为唯一 live writer。 |
| 2026-08-28 | 当前 M2 protocol/v1 精确冻结的是已丢失的旧 M1 hashes、3,583,548 rows 与 `2026-08-22` exclusive end；evaluation 还硬编码旧 row/ambiguous counts。 | 新 M1 receipt 不能套用或静默改写 v1。M2 必须在读取本轮 performance 前冻结 protocol/v2，保留既有 folds/models/gates，改为 receipt/manifest 驱动的机械计数与实际 mart binding。 |
| 2026-08-28 | 当前 M4 full builder 同样硬编码旧 M1 的 3,583,548 rows 与 `2026-08-22` exclusive end，只读取 manifest/rows，未先消费本轮 v3 admission receipt。 | M4 不能直接重放历史 builder；必须改成验证本轮 receipt 与实际 canonical bindings，且仍保留 public/non-private route 与 source coverage fail-closed。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| M1 full PPD backfill and exact rerun | `01a0489b-18b7-73e0-9264-902155a8b99d` / `ac89` | `.dfev1/crime/event-warehouse-v1-2006-through-2026-08-28-source-final-037c615/logs/run1.*` | active; detached `8325842`, unique owner, first full run |
| M1 tracked source/warehouse audit | `01a0489b-188b-7d30-b0e5-f2289c13f0e3` / `954b` | task-owned worktree | complete; repair source-final `34b90bd` |
| M1 spatial/ACS/DQ gate | `01a0489b-188b-7d30-b0e5-f2073fa849c2` / `6ad0` | task-owned worktree | complete; source-final `35c6cee` |
| M1 independent integration/data gate | `01a048ac-1559-7323-a9a8-ad3598754140` / `0062` | isolated worktree from supervisor branch | code PASS on `037c615`; final data review pending |

## Handoff

阶段尚未完成。代码 blocker 已在 `037c615` 关闭且复审 PASS。M1-1 正在全新根生成
完整 receipt/manifest/checkpoint/lineage/DQ；只有 exact rerun、validate-only 与 M1-4 独立数据门禁
全部 PASS 后，才能创建 M2 新任务。

## Next step

由 M1-1 唯一监控首轮 full backfill；监督线程只读取已落盘快照。首轮 21/21 + receipt/DQ
通过后执行 exact-command rerun 与 validate-only，再把根路径交给 M1-4 做最终数据门禁。
