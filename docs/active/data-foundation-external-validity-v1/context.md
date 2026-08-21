# Context

## Current truth

- 2026-08-21 开始时，本 worktree 为
  `C:/Users/raede/.codex/worktrees/6f7d/engagement_project`，detached、clean，
  `HEAD=main=origin/main=f300cfe2658375add6542b86c20267c63c56ec4a`。
- 未 fetch；`origin/main` 只表示当前本地 remote-tracking ref，不证明远端实时状态。
- `git worktree list --porcelain` 显示多个隔离 worktree；本任务只拥有 `6f7d`，
  不修改其他 worktree、refs、拓扑或远端。
- `docs/active` 没有 DFEV1 等价记录。`execution-a-crime-evidence` 与
  `batch10-hin-lifecycle` 提供相邻历史契约，但职责分别是旧 Crime/Evidence 和 HIN。
- 基线 tract refresh 只写
  `public/data/tract_crime_counts_last12m.json`；Source Health 的 tract receipt 则在
  `src/source_health/source_health_bundled_receipts.js` 手工维护。
- 聚焦基线 40/40 通过；这证明既有测试没有覆盖刷新后的 receipt 一致性，
  不是 M0 问题不存在。
- M0 实现 commit 为 `c9955d29028ef3042872ed7377227cbc29e368af`；当前 detached
  HEAD 从基线前进，未创建或移动 branch ref，未 push。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-21 | 临时目录复现：`as-of=2026-08-31` 生成 `[2025-09-01, 2026-09-01)`、2-row snapshot；bundled receipt 仍为 `sourceAsOf=2026-07-30`、`[2025-08-01, 2026-08-01)`、408 rows。 | 漂移为当前代码事实；进入最小实现，不制造无关 diff。 |
| 2026-08-21 | 复用 HIN 的 validated pair 思路，但为 tract 建立独立 schema、语义比较和 registry binding。 | 避免复制 HIN review/authority 语义，保留 tract-specific lifecycle。 |
| 2026-08-21 | Legacy tract snapshot 的独立 `retrievedAt` 不可从 `generated_at` 推断。 | 初始 receipt 使用 `retrievedAt: null`；未来 refresh 在 acquisition 完成时记录该时钟。 |
| 2026-08-21 | Synthetic route 工作保持暂停。 | 不编辑 route decision/generation、bundle ceiling 或 synthetic fixtures。 |
| 2026-08-21 | 只读核验 OpenDataPhilly Crime Incidents、City Terms of Use 和 Census citation/public-use 页面。 | Registry 保留 City Crime license/terms 与 Census public-use/citation handoff；HTTP 可达性不成为 sourceAsOf、current 或 authority。 |
| 2026-08-21 | `test:data-contract` 首次在未改动的 `data_source_policy` import 阶段因本 worktree 没有 `maplibre-gl` 停止。 | 先按 lockfile 执行一次 `npm ci`，再运行标准 gate；该失败不是 M0 contract failure。 |
| 2026-08-21 | 第一次完整 `npm run validate` 在 Source Health catalog bundle gate 失败：完整 JSON receipt 被 runtime 内联后为 16,142 bytes，超过既有 15,000-byte ceiling。 | 不提高 ceiling；保留完整 JSON receipt 供审计，并在同一 lifecycle 原子生成、验证最小 runtime projection。修复后 catalog 为 14,924 bytes。 |
| 2026-08-21 | 相同语义判断在生成器内完成，而不是 workflow 在写入后再恢复文件。 | 连续相同输入保持 snapshot、receipt、projection 的 bytes 和 mtime；workflow 只检测最终文件 diff。 |
| 2026-08-21 | 本地 main ref 仍为基线；当前主 worktree 的 `codex/route-decision-s6-real-data` 已提交状态与已枚举其他 worktree HEAD 均无本任务精确路径重叠。 | Source Health/data automation 仍是概念热点；集成时重新核对目标 branch 与并行 WIP，不能把本次只读快照当未来无冲突保证。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| `npm ci` | DFEV1 M0 primary owner | `logs/dfev1-m0-npm-ci.log.tmp` | Completed exit 0; wrote ignored `node_modules`; no process remains. |
| first `npm run validate` | DFEV1 M0 primary owner | `logs/dfev1-m0-validate.log.tmp` | Completed exit 1 at the existing bundle ceiling; failure was reviewed and repaired without increasing the ceiling. |
| final `npm run validate` | DFEV1 M0 primary owner | `logs/dfev1-m0-validate-rerun.log.tmp` | Completed exit 0; wrote ignored `dist`; no process, port, database or checkpoint remains. |

## Handoff

本任务是 M0 的独立本地交付。完成后只可标记 `verified ready-for-integration`、
`evidence-backed no-op` 或 `blocked`；本地证据不代表 main、remote CI、PR、定时
workflow、部署或产品上线。

## Next step

由 integration owner 从 `c9955d2` 及随后的 DFEV1 记录 commit 审查/集成本地
detached commit 链；集成前重新核对目标 branch、并行 Source Health 热点和标准 gate。
M1/M2 保持 deferred，不由本任务启动。
