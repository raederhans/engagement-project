# Task

## Current status

`verified ready-for-integration` — M0 漂移已复现并在本隔离 worktree 修复；
聚焦契约、脚本/YAML/ESLint、production build、bundle gate 和完整
`npm run validate` 均有 fresh exit-0 证据。仅生成本地 detached commits，未 push、
未创建 PR、未运行真实数据网络 refresh。

## Checklist

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

## Validation evidence

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

## Open risks and remaining work

- 未运行真实 CARTO/tract network refresh；因此不声明 upstream 当前、完整、权威或
  workflow 在 GitHub runner 上已成功。
- 未创建 PR，未运行 remote CI、scheduled workflow、browser smoke、部署或产品上线。
- `origin/main` 未实时 fetch；最终只能报告本地 refs 与未验证远端状态。
- Bundle policy 已通过但 Source Health catalog 仅余 76 raw bytes 余量；集成后的并行
  Source Health 变更可能需要在不提高 ceiling 的前提下重新瘦身并重跑 gate。
- 当前只读检查没有发现与当前主 worktree branch 或已枚举 worktree committed HEAD
  的精确路径重叠；未读取其他 worktree 的未归属 WIP，因此集成 owner 仍须重查。
- M1/M2、synthetic route 扩展与 framework/bundle-ceiling 调整明确 deferred。
