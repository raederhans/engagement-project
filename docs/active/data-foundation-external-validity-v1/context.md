# Context

## Current truth

- 2026-08-21 M1 开始时，本 worktree 为
  `C:/Users/raede/.codex/worktrees/c180/engagement_project`，detached、clean，
  exact `HEAD=c027266d40409bac24b85891260a4cad37890333`。
- `c027266d` 包含 M0 implementation `c9955d2` 与 M0 handoff record commit；二者
  仅是已验证的本地候选。`main` 与本地 `origin/main` 仍为 `f300cfe`，未 fetch，
  未合并、未推送、未上线。
- 当前任务只拥有 `c180` worktree。其他 worktree 的 refs、文件、WIP、topology、
  process、cache 和 artifacts 均不在范围内。
- M1 code commits 为 source acquisition `bcbdb6f1bb71b90ce83187ecb10cc41587959dc0`
  与 event warehouse `d7dcca41997e34cfd2464432a8973d5cdc8b9c0d`；仍是 detached、
  本地、未集成、未推送、未上线候选。最终 handoff record commit 由本任务结束时的
  exact HEAD 标识。
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
| 2026-08-21 | 用户以 `c027266d` 为 exact starting candidate 串行启动 M1。 | M0 保持 delivered candidate 事实；M1 active；M2 deferred；本任务不承担 integration 或 remote state。 |
| 2026-08-21 | M1 默认只运行 bounded official smoke；真实全量 backfill 必须先完成 source/license/storage/checkpoint gate。 | 在 gate 前优先交付可重建 pipeline、synthetic revision coverage 和 honest partial evidence，禁止把小切片写成完整仓库。 |
| 2026-08-21 | 第一轮 full backfill 在完成 2006–2008 三个 annual scopes 后由 owner 停止；代码把 2024 ACS value availability 与事件期 temporal compatibility 混在一起。 | 该轮是 abandoned partial，不能作为回填证据。先增加 `incompatible-vintage` fail-closed 状态，再从新的 ignored root 重跑，不复用旧 canonical warehouse。 |
| 2026-08-21 | R1 的精确任务目录已验证在本 worktree 下，但递归删除被本地安全策略拒绝。 | 不绕过安全策略；R1 继续作为 ignored、invalidated 的 task-owned partial 保留，R2 使用全新的 root，任何验收统计均排除 R1。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| `npm ci` | DFEV1 M0 primary owner | `logs/dfev1-m0-npm-ci.log.tmp` | Completed exit 0; wrote ignored `node_modules`; no process remains. |
| first `npm run validate` | DFEV1 M0 primary owner | `logs/dfev1-m0-validate.log.tmp` | Completed exit 1 at the existing bundle ceiling; failure was reviewed and repaired without increasing the ceiling. |
| final `npm run validate` | DFEV1 M0 primary owner | `logs/dfev1-m0-validate-rerun.log.tmp` | Completed exit 0; wrote ignored `dist`; no process, port, database or checkpoint remains. |
| M1 full event backfill R1 (abandoned partial) | DFEV1 M1 primary owner in task `01a022d3-9041-7be2-a3e2-620cd283f603` | stdout `logs/dfev1-m1-full-backfill.log.tmp`; stderr `logs/dfev1-m1-full-backfill.err.tmp` | PID `51620` started `2026-08-21T06:09:38.2902395Z` and was owner-stopped at `2026-08-21T06:13:19.0425307Z` after 3/21 periods. Root `.dfev1/crime/full-2026-08-21` is an invalidated task-owned partial because ACS temporal compatibility was not fail-closed; do not resume or cite it as completed backfill. No process remains. |
| M1 full event backfill R2 | DFEV1 M1 primary owner in task `01a022d3-9041-7be2-a3e2-620cd283f603` | root `.dfev1/crime/full-2026-08-21-v2`; stdout `logs/dfev1-m1-full-backfill-v2.log.tmp`; stderr `logs/dfev1-m1-full-backfill-v2.err.tmp` | PID `71912` ran `2026-08-21T06:17:20.9910486Z`–`07:00:20.636Z`, completed 21/21 scopes with zero stderr. Checkpoint is `<root>/backfill-checkpoint.json`; no process remains. |
| M1 full backfill exact-command idempotence rerun R3 | DFEV1 M1 primary owner in task `01a022d3-9041-7be2-a3e2-620cd283f603` | same R2 root/checkpoint; stdout `logs/dfev1-m1-full-backfill-v2-rerun.log.tmp`; stderr `logs/dfev1-m1-full-backfill-v2-rerun.err.tmp` | PID `71528` completed with every source and warehouse snapshot idempotent and zero stderr. Source/canonical/warehouse bytes and mtimes stayed fixed, but outer checkpoint refreshed completion clocks; code was tightened so semantic no-op checkpoints are no longer rewritten. |
| M1 full backfill exact-command idempotence rerun R4 | DFEV1 M1 primary owner in task `01a022d3-9041-7be2-a3e2-620cd283f603` | same R2 root/checkpoint; stdout `logs/dfev1-m1-full-backfill-v2-rerun2.log.tmp`; stderr `logs/dfev1-m1-full-backfill-v2-rerun2.err.tmp` | PID `61096` completed: 21 source and 21 warehouse vintages idempotent, zero stderr; source/canonical/warehouse/checkpoint bytes and mtimes stayed fixed. No process remains. |
| M1 clean lockfile install | DFEV1 M1 primary owner in task `01a022d3-9041-7be2-a3e2-620cd283f603` | worktree-only ignored `node_modules`; stdout `logs/dfev1-m1-npm-ci.log.tmp`; stderr `logs/dfev1-m1-npm-ci.err.tmp` | PID `73648` completed exit 0: 395 packages installed, 396 audited, 0 vulnerabilities; package/lockfile stayed unchanged. No process remains. |
| M1 project standard `npm run validate` | DFEV1 M1 primary owner in task `01a022d3-9041-7be2-a3e2-620cd283f603` | ignored `dist`; stdout `logs/dfev1-m1-validate.log.tmp`; stderr `logs/dfev1-m1-validate.err.tmp` | PID `20260` completed through bundle policy PASS; a same-owner foreground rerun then captured exact exit 0. Source Health catalog remained 14,924/15,000 bytes; only the existing Vite chunk-size warning was emitted. No process remains. |

## M1 first-party source and smoke evidence

| Evidence | Observation and boundary |
| --- | --- |
| `https://data.phila.gov/visualizations/crime-incidents/` | City page currently describes preliminary PPD reported-crime data from 2006 to present, later reclassification, and hundred-block generalized locations. Page reachability is not data completeness, continuing freshness, or authority. |
| `https://opendataphilly.org/datasets/crime-incidents/` and current official CARTO table `incidents_part1_part2` | Catalog exposes annual CSV resources and the CARTO API and says the dataset is updated daily. Live aggregate at `2026-08-21` observed 3,583,549 rows, 3,583,549 distinct `cartodb_id`, 3,583,309 distinct `dc_key`, one row without event time, 56,047 missing coordinates and 374 coordinates outside the admitted Philadelphia bbox. These are timestamped observations, not a permanent source guarantee. |
| `https://www.phila.gov/terms-of-use/` | Current City terms and the catalog's as-is accuracy boundary are recorded in the versioned source registry; transport success does not upgrade license/accuracy authority. |
| `https://api.census.gov/data/2024/acs/acs5.html` and official 2024 table-based summary file | ACS contract admits 2024 ACS 5-year B01003 for 2020–2024 only. `B01003_001E` estimate and `B01003_001M` 90% MOE remain separate. `node scripts/fetch_acs_tracts.mjs --verify` re-fetched/verified 408 exact tract GEOIDs and rows identity `sha256:c30e568037e55fd77b49396d039d98e03b2dc0d2bbe5c3f3035dcfe9c83db356`. Event years outside 2020–2024 are `incompatible-vintage` for model input even when ACS E/M values exist. |
| Official bounded smoke `[2026-08-19, 2026-08-21)` | Exact source snapshot `sha256:e63cbd128e9c2ed6f63f0e6c345a0d2dd2ca94fdb68cd9a1dd4d855d40b377b0`, retrieved `2026-08-21T06:06:52.316Z`, max observed event `2026-08-20T03:47:00Z`, 506 rows, exact 14-field schema, 0 duplicate source IDs, 28 missing coordinates, 0 invalid/outside coordinates, 478 tract/grid joins, 28 fail-closed unmapped, 0 unknown labels. Corridor registry is absent (`unavailable`, not zero); all 478 mapped 2026 rows retain ACS E/M but are `incompatible-vintage`. Same snapshot acquisition and ingest reruns preserved manifest/canonical bytes and mtimes. |

## M1 completed local backfill evidence

- R2 requested exact half-open scope `[2006-01-01, 2026-08-22)` and completed 21/21
  annual periods in about 43 minutes. Preflight and acquired totals both equal 3,583,548 rows;
  the only other live source row lacked event time and is recorded as one explicit exclusion.
- Ignored R2 root is 9,940,613,540 bytes: 1,238,161,776 acquisition bytes and
  8,631,014,134 canonical bytes. Warehouse has 64 partitions, 3,583,548 active rows,
  0 removal candidates on the initial complete backfill, 21 exact source snapshot manifests,
  and `serving_eligible: false`.
- Final canonical coordinate DQ: 3,527,128 available, 56,046 missing, 338 invalid and
  36 otherwise outside the admitted city bbox. Tract mapping: 2,969,825 mapped,
  549,594 ambiguous and 64,129 unmapped. Fixed grid: 3,527,128 mapped and 56,420
  unavailable. Ambiguous/unavailable states remain fail closed.
- No official corridor registry was supplied: all 3,583,548 corridor joins are
  `unavailable`, not zero/no-match. ACS E/M: 651,264 temporally compatible available,
  613,723 unavailable because tract admission failed, and 2,318,561
  `incompatible-vintage`; estimate and MOE stay separate in every admitted value.
- Final DQ observed all 32 versioned offense labels with zero unknown labels. The current-year
  source slice had 0 duplicate source IDs and 4 `dc_key` excess rows (diagnostic only), and
  flagged 2026-01-26 plus the partial latest day 2026-08-20 as count anomalies; flags are
  review prompts, not proof of source error.
- After removing meaningless checkpoint clock rewrites, the exact full command returned all
  21 source and 21 warehouse vintages as idempotent while source/canonical/warehouse/checkpoint
  bytes and mtimes remained fixed.

## Handoff

本任务是从 M0 candidate 串行前进的 M1 独立本地交付。结束时只可标记
`verified ready-for-integration`、`honest partial with explicit blocked gates`、
`evidence-backed no-op` 或真正 `blocked`；本地证据不代表 main、remote CI、PR、
定时 refresh、持续更新、runtime、部署或科学有效性。

## M1 reproducible runbook

- Clean dependency install: `npm ci`.
- Full/resumable annual backfill: `npm run data:backfill:crime-events -- --start=2006-01-01 --through=<exclusive-YYYY-MM-DD> --root=.dfev1/crime/<run-id>`.
  Re-run the identical command to resume the outer/annual checkpoints or prove source-vintage ingest idempotence.
- Overlap refresh acquisition: `npm run data:acquire:crime-events -- --warehouse=.dfev1/crime/<run-id>/warehouse --overlap-days=45 --end=<exclusive-YYYY-MM-DD> --output=.dfev1/crime/<run-id>/acquisitions/<refresh-id>`.
- Apply the validated refresh: `npm run data:ingest:crime-events -- --snapshot=.dfev1/crime/<run-id>/acquisitions/<refresh-id> --warehouse=.dfev1/crime/<run-id>/warehouse`.
- Focused validation: `npm run test:data-pipeline`, targeted ESLint for M1 scripts, `node scripts/fetch_acs_tracts.mjs --verify`, then the project standard `npm run validate`.
- Raw/canonical rows, checkpoints, revision ledgers, DQ and lineage live only under ignored
  `.dfev1/`. Synthetic fixtures require an explicit library-only test admission and the official
  CLIs reject them. A local warehouse manifest always remains `serving_eligible: false`.

## Next step

Integration owner 从最终 exact detached HEAD 审查 M1 三个本地 commits，并在目标
integration worktree 重新核对 package/data/source-health 热点与标准 gate。M2 starting
commit 是本 handoff 的最终 HEAD；M2 仍不得由本任务启动。不得把本地 full backfill
扩大为 remote CI、scheduled refresh、持续更新、runtime、部署或科学有效性。
