# Task

## Current status

`honest no-promotion ready-for-integration` — M2 从 exact starting candidate
`a86b4fb02d3c06c3a7904b1674f3eae1b16a5929` 在 `fed9` 串行完成。M0/M1 仍是 verified
local candidates，未合并、未 push、未 remote CI、未部署。完整 frozen evaluation 的
结论是 `not-promoted`：产品候选只展示历史 reported-incident evidence，forecast 明确
`unavailable`，没有零预测或隐藏 fallback。

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

## Milestone 2 checklist

- [x] 核对 `fed9` exact HEAD/status、适用 AGENTS、唯一三件套与三项用户指定 skills。
- [x] 只读核验获授权 M1 root 的 21/21 scopes、3,583,548 rows、64 partitions、
  manifest/checkpoint/lineage identities 与 `serving_eligible:false`。
- [x] 在读取任何 M2 performance 前冻结 rolling folds、spatial holdout、metrics、
  category/data-volume slices、interval 与 promotion/no-promotion gates。
- [x] 实现 streaming/resumable/idempotent tract-week 与 fixed-grid-week marts。
- [x] 实现时间泄漏防护、seasonal/4/13-week/Poisson/NB baseline 与数值稳定测试。
- [x] 输出 evaluation report、model card、lineage summary、residual map、bias/error audit。
- [x] 输出 fail-closed serving artifact 并最小接线 Area Intelligence 双语 UI。
- [x] 在真实完整 M1 warehouse 运行 mart build、backtest 和 exact-input idempotence rerun。
- [x] 运行聚焦、lint/static、production build、bundle、browser smoke 与 `npm run validate`。
- [x] 调用 `write-lore-commits` 审查范围并创建本 worktree 小型本地 commits；收口记录。

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

## Milestone 2 validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `git status --short --branch` | exact `a86b4fb02d3c06c3a7904b1674f3eae1b16a5929`; detached and initially clean. |
| Upstream warehouse gate | manifest/checkpoint/lineage show 21/21 scopes, 3,583,548 canonical/active rows, 64 partitions, `[2006-01-01, 2026-08-22)`, `serving_eligible:false`; canonical bytes total 8,631,014,134. |
| Frozen protocol | `scripts/data/area_intelligence_evaluation_protocol.v1.json` was authored before any M2 model fit or performance output. |
| Full mart build | exit 0; streamed all 3,583,548 canonical rows into 1,610,440 sparse weekly rows across 408 admitted tracts and 2,352 admitted fixed-grid cells. It excluded exactly 549,594 ambiguous plus 64,129 unmapped tract rows and 56,420 grid-unavailable rows. Runtime 123.187 s, peak RSS 228,126,720 bytes, task-owned output 1,545,960,398 bytes. Artifact identity is input/output byte identity only, not model correctness. |
| Mart exact-command rerun | exit 0 in 0.740 s with `status:idempotent`; identical artifact identity, 64/64 part sizes and mtimes unchanged, and original manifest/checkpoint mtimes preserved. |
| Full frozen evaluation | exit 0; four temporal folds × tract/fixed-grid × heldout/non-heldout, 545,851 primary observations per model, 80 primary rows, 240 category rows, 240 volume rows and 60 temporally compatible ACS population audit rows. Runtime 115.679 s, peak RSS 114,475,008 bytes. |
| Promotion decision | honest `not-promoted`. NB aggregate MAE 1.2198 and 15.07% gain over seasonal, but all 16 primary interval slices were above the frozen 95% upper bound and predefined category slices regressed. Poisson aggregate MAE 17.4851 and -1,117.39% gain, with severe tract instability. No forecast is served. |
| Evaluation exact-command rerun | exit 0 in 0.011 s with `status:idempotent`; same no-promotion decision, 7/7 artifact hashes valid, original manifest/checkpoint mtimes unchanged. |
| Safe artifact publication | local publisher validated ignored evaluation identities and produced six tracked, non-event-level artifacts. Serving contract says historical evidence `available`, forecast `unavailable`, `predictions:[]`, explicit model-baseline failure; local-path/privacy-field scan PASS. |
| Focused tests and lint | `npm run test:data-pipeline` exit 0, 42/42 including 8 M2 leakage/holdout/model/interval/promotion/serving/resume tests; targeted M2 ESLint exit 0, zero warnings. |
| First standard validation | exit 1 only at bundle policy after all tests/build passed: static Area Intelligence import made Charts 240,540 bytes vs unchanged 233,791-byte ceiling. Source Health remained 14,924/15,000. Repair uses its own dynamic fail-closed lazy chunk; no budget increase. |
| Targeted build/bundle repair | final targeted check exit 0: independent 8,259-byte Area Intelligence lazy chunk; Charts 233,101/233,791, Source Health catalog 14,924/15,000, aggregate dist 3,999,860/4,000,000 excluding the admitted ACS VRE artifact. No ceiling changed. |
| Real browser smoke | R2 exit 0 against production lazy chunk: explicit no-promotion and synthetic promoted states, interval/uncertainty copy, desktop/mobile responsive layout, zero console/page errors, clean port/process/harness teardown. Synthetic promoted input is rendering evidence only. |
| Final `npm run validate` | fresh exit 0; complete standard tests, production manifest build and bundle policy PASS. Charts 233,101/233,791, Source Health catalog 14,924/15,000, aggregate dist 3,999,860/4,000,000 excluding admitted ACS VRE. |
| Final upstream read-only recheck | warehouse manifest `152c994e...b40`, checkpoint `3c3d0a75...687`, and lineage `596e69ad...a41` remained exact with their original mtimes after all M2 reads. |
| Local Lore implementation commit | `5bcd52e0f741f702bc22991756cf48e46e54a227`; detached, local-only, not pushed or integrated. |

## Open risks and remaining work

- 已运行真实 CARTO smoke 与完整本地事件 backfill，但没有 source-owned不可变快照或
  upstream completeness guarantee；因此不把本次 count equality 扩大为永久完整/权威。
- 未创建 PR，未运行 remote CI、scheduled workflow、持续训练、部署或产品上线；本地
  production-chunk browser smoke 已运行，但不等于部署后的 runtime smoke。
- `origin/main` 未实时 fetch；最终只能报告本地 refs 与未验证远端状态。
- Bundle policy 已通过，但 Source Health catalog 仅余 76 raw bytes、aggregate dist 仅余
  140 bytes；集成后的并行变更必须在不提高 ceiling 的前提下重新审查并重跑 gate。
- 当前只读检查没有发现与当前主 worktree branch 或已枚举 worktree committed HEAD
  的精确路径重叠；未读取其他 worktree 的未归属 WIP，因此集成 owner 仍须重查。
- Full DQ 中 549,594 tract joins 因边界关系而 ambiguous、64,129 unmapped；没有官方
  corridor registry，故全部 corridor 状态 unavailable。集成或 M2 不得把这些状态当精确 street/sidewalk 或 zero/no-match。
- `cartodb_id` 在当前 exposed table 唯一，但上游未承诺跨 table rebuild 永久稳定；
  contract 保留 `objectid`/`dc_key` 诊断并要求未来 refresh 监控 identity churn。
- R1 invalidated task-owned partial 仍在 ignored `.dfev1/crime/full-2026-08-21`；精确
  递归删除被本地安全策略拒绝，未绕过。它不进入任何验收统计或提交。
- M2 frozen backtest 已完成并明确 `not-promoted`。NB 虽有 15.07% aggregate MAE gain，
  但 16/16 primary interval slices 过度覆盖且预定义类别切片退化；Poisson tract slices
  严重不稳定。不得从 aggregate 指标择优 promotion 或事后改 gate。
- ACS race、income、poverty 均 unavailable，故相应差异未被测量而不是已排除；population
  E/M 只在 compatible 期间用于误差审计，禁止变成产品排名权重。
- M1 warehouse 仍为 `serving_eligible:false`；本地 mart/model/test 不等于 scheduled
  refresh、持续训练、部署、未来表现、科学有效性或用户决策质量。

## Integration closeout

- Final cumulative candidate: `d1630d0f6c44f7ff0908e4a1792d7020c10a7f82`.
- Integration: local `main` was strictly fast-forwarded from `f300cfe2658375add6542b86c20267c63c56ec4a`; `origin/main` was not changed.
- Review: independent code review ended at `COMMENT` and architecture review at `WATCH`, both with zero blockers after the privacy, path-confinement, authority-recomputation, complexity-bound, and visual-baseline repairs.
- Exact-tip verification: JavaScript/CSS lint, full `npm run validate`, and the Area Intelligence, Home Compare, and Known Route browser suites all passed with zero console/page errors.
- Product truth: M0-M2 are complete only at the local evidence boundary. Historical evidence is available; the frozen forecast remains `not-promoted`/`unavailable`; the M1 warehouse remains `serving_eligible:false`.
- Deferred gates: no push, remote CI, scheduled refresh, continuous training, deployment, or production/runtime liveness proof was run.
