# Task

## Current status

`verified ready-for-integration` — M1 已从 exact starting candidate
`c027266d40409bac24b85891260a4cad37890333` 在 `c180` 完成代码、官方 smoke、完整
本地回填、幂等复跑、聚焦/标准 gate 和本地 Lore commits。M0 与 M1 都只是 detached
本地候选，未合并、未 push、未上线；M2 deferred。

## Milestone 0 delivered-candidate checklist

- [x] 核对 Git HEAD/base/status、detached ownership 与 worktree 拓扑。
- [x] 完整读取适用 `docs/AGENTS.md`、`manage-task-records`、相关刷新脚本、
  workflows、Source Health contracts、tests 和相邻活跃记录。
- [x] 查重并建立唯一的 DFEV1 活跃记录。
- [x] 在不联网、不改 tracked artifact 的条件下复现月份窗口 receipt 漂移。
- [x] 增加月份窗口、lifecycle rollback、semantic no-op、unavailable 非 zero 回归测试。
- [x] 实现 snapshot validation -> receipt generation/validation -> lifecycle replacement。
- [x] 扩展并验证 machine-readable source registry，移除 tract receipt 手工字段。
- [x] 更新 refresh workflow/package paths，使完整 receipt 与 runtime projection 进入
  validation/change/commit 闭环。
- [x] 运行聚焦与必要标准 gate，检查 diff/overlap，并创建本地 commits。
- [x] 同步最终记录并准备 integration handoff。

## Milestone 1 checklist

- [x] 核对 `c180` worktree、exact HEAD/base/status、适用 AGENTS、三件套和三项 skills。
- [x] 只读核验当前 Philadelphia/OpenDataPhilly、City terms、Census API/ACS/
  geography 第一方来源，并记录可达性之外的真实性限制。
- [x] 冻结事件 schema、source registry/manifest、crosswalk、lineage、DQ 和 ignored
  artifact boundaries。
- [x] 实现可恢复 acquisition、revision-aware canonical ingest 和 overlap incremental refresh。
- [x] 实现 tract、fixed grid/hex、route-corridor fail-closed mapping 与 ACS estimate/MOE。
- [x] 实现机器可检查 DQ report 和 model-input lineage contract。
- [x] 用 synthetic revision fixtures 证明 added/modified/reclassified/late/removed/unchanged。
- [x] 运行 bounded official smoke 并记录 source vintage、schema/count、时间/坐标覆盖与 DQ。
- [x] 运行聚焦、data contract、lint/static 与 `npm run validate`（若标准入口触达）。
- [x] 调用 `write-lore-commits` 审查范围并创建本 worktree 本地 commits；更新最终 handoff。

## Milestone 0 validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` | 初始 `## HEAD (no branch)`，clean。 |
| `git show -s HEAD` | `f300cfe2658375add6542b86c20267c63c56ec4a`；本地 `main`、`origin/main` 相同。 |
| `git worktree list --porcelain` | 多个隔离 worktree；当前任务只拥有 `6f7d`。 |
| 临时 `runPrecompute --as-of 2026-08-31` + snapshot validation | PASS，并复现新 snapshot 与旧 bundled receipt 的月份、count 和 clock 漂移；tracked files 未变。 |
| `node --test scripts/tests/data_pipeline_contracts.mjs scripts/tests/data_automation_contracts.mjs scripts/tests/source_health_contracts.mjs` | 基线 exit 0，40/40；缺失 M0 pair-refresh 回归。 |
| 新 lifecycle test RED | 首次 exit 1：`scripts/lib/tract_crime_receipt.mjs` 不存在；证明新增回归能捕获缺口。 |
| `npm ci` | exit 0；added/audited 396 packages，0 vulnerabilities；只写 ignored `node_modules`。 |
| `npm run test:data-pipeline` | exit 0，27/27；覆盖月份边界、三产物 rollback、两次语义相同无 bytes/mtime diff、committed receipt/projection。 |
| `node --test scripts/tests/data_automation_contracts.mjs scripts/tests/source_health_contracts.mjs` | exit 0，17/17；覆盖 workflow review boundary、四时钟、unavailable 非 zero/current 与 generated runtime receipt。 |
| `node scripts/validate_tract_crime_snapshot.mjs` | exit 0；408 tracts，`[2025-08-01, 2026-08-01)`，snapshot/full receipt/runtime projection/registry 联合验证。 |
| Targeted `npx eslint ... --max-warnings=0` | exit 0；覆盖所有修改的 JS/MJS。 |
| `js-yaml` parse `refresh-tract-data.yml` | PASS。首次尝试不存在的 direct `yaml` package 失败，随后使用 lockfile 已安装的 `js-yaml` 完成实际解析。 |
| `npm run build:manifest && npm run verify:bundle` | exit 0；Source Health catalog 14,924/15,000 bytes，未改变 ceiling。 |
| first `npm run validate` | exit 1；完整 receipt runtime import 使 catalog 16,142/15,000 bytes，证据驱动改为同 lifecycle 生成的最小 projection。 |
| final `npm run validate` | exit 0；完整标准 tests、production manifest build、bundle policy 通过。 |
| `git diff --check` / staged diff review | PASS；仅换行转换提示，无 whitespace error。 |
| Core implementation commit | `c9955d29028ef3042872ed7377227cbc29e368af`，12 files，1095 insertions / 153 deletions。 |

## Milestone 1 validation evidence

| Command or check | Result |
| --- | --- |
| First-party source verification | City/OpenDataPhilly reported crime, current CARTO table/fields, City terms and Census 2024 ACS 5-year E/M sources rechecked on 2026-08-21; reachability was not promoted to authority/current/completeness. |
| Official smoke `[2026-08-19, 2026-08-21)` | exit 0; 506 rows, exact 14-field schema, source snapshot `e63cbd...377b0`, 28 missing coordinates, 478 tract/grid joins, 0 unknown labels; repeated acquisition/ingest preserved bytes and mtimes. |
| Full R2 backfill | exit 0; 21/21 periods, 3,583,548 acquired/canonical rows exactly equal preflight date-scoped count, one missing-time row explicitly excluded, 9.258 GiB ignored output, about 43 minutes, zero stderr. |
| Exact-command full rerun | PASS after semantic-no-op repair; 21 acquisitions and 21 ingests idempotent, and source/canonical/warehouse/checkpoint bytes plus mtimes unchanged. |
| `npm run test:data-pipeline` | exit 0, 34/34; includes revision semantics, transaction rollback, checkpoint resume, unknown/schema drift, spatial/ACS fail-closed, and M0 lifecycle contracts. |
| Targeted M1 ESLint | exit 0, zero warnings. |
| `node scripts/fetch_acs_tracts.mjs --verify` | exit 0; 408 E/M rows and exact tract GEOID set verified. |
| `npm run data:check:tract-crime` | exit 0; M0 snapshot/full receipt/runtime projection still jointly valid for 408 tracts. |
| `npm ci` | exit 0; 395 installed, 396 audited, 0 vulnerabilities; package-lock unchanged. |
| `npm run validate` | fresh exact exit 0; full data contracts/test suite, production manifest build and bundle policy PASS. Source Health catalog stayed 14,924/15,000 bytes. |
| Local Lore code commits | `bcbdb6f1bb71b90ce83187ecb10cc41587959dc0` and `d7dcca41997e34cfd2464432a8973d5cdc8b9c0d`; detached, not pushed/integrated. |

## Open risks and remaining work

- 已运行真实 CARTO smoke 与完整本地事件 backfill，但没有 source-owned不可变快照或
  upstream completeness guarantee；因此不把本次 count equality 扩大为永久完整/权威。
- 未创建 PR，未运行 remote CI、scheduled workflow、browser smoke、部署或产品上线。
- `origin/main` 未实时 fetch；最终只能报告本地 refs 与未验证远端状态。
- Bundle policy 已通过但 Source Health catalog 仅余 76 raw bytes 余量；集成后的并行
  Source Health 变更可能需要在不提高 ceiling 的前提下重新瘦身并重跑 gate。
- 当前只读检查没有发现与当前主 worktree branch 或已枚举 worktree committed HEAD
  的精确路径重叠；未读取其他 worktree 的未归属 WIP，因此集成 owner 仍须重查。
- Full DQ 中 549,594 tract joins 因边界关系而 ambiguous、64,129 unmapped；没有官方
  corridor registry，故全部 corridor 状态 unavailable。集成或 M2 不得把这些状态当精确 street/sidewalk 或 zero/no-match。
- `cartodb_id` 在当前 exposed table 唯一，但上游未承诺跨 table rebuild 永久稳定；
  contract 保留 `objectid`/`dc_key` 诊断并要求未来 refresh 监控 identity churn。
- R1 invalidated task-owned partial 仍在 ignored `.dfev1/crime/full-2026-08-21`；精确
  递归删除被本地安全策略拒绝，未绕过。它不进入任何验收统计或提交。
- M2、synthetic route 扩展与 framework/bundle-ceiling 调整明确 deferred；本地 warehouse
  `serving_eligible: false`，不是 runtime、scheduled refresh、部署或科学有效性。
