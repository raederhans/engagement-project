# Task

## Current status

`ready-for-integration` — 三项 review repair 已实现，授权 RED→GREEN/targeted suites、最终静态检查和 scoped process-zero 证据均已完成；未执行任何 Git 写操作。

## Checklist

- [x] 核对 Git 基线、detached worktree、初始 clean status 和多 worktree 权限边界。
- [x] 读取适用 Skill、项目 `docs/AGENTS.md`、任务记录模板和相关历史语义。
- [x] 执行唯一一次依赖安装并记录命令、退出码与日志。
- [x] A1 malformed/zero/immutability/timezone RED 失败证据。
- [x] A1 最小实现与 targeted GREEN 证据。
- [x] A2 bundle/hash/privacy/source/export/i18n RED 失败证据。
- [x] A2 最小实现与 targeted GREEN 证据。
- [ ] build:manifest/verify:bundle、browser/visual/full validate：监督明确禁止 A 运行，留给后续单 owner gate。
- [x] 最终 review、跨 worktree 交集扫描与 ready-for-integration 交付包。
- [x] Review repair 测试契约：retrievedAt 证据、unknown-key fail-closed、builder valid shape、四按钮结构。
- [x] Review repair 最小产品修复。
- [x] 监督释放槽后观察 review-repair RED→GREEN 并运行 A targeted suites。
- [x] 重新执行 diff check、交集扫描、scoped process 证据并恢复 `ready-for-integration`。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD; git rev-parse main; git rev-parse origin/main` | 三者均为 `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`。 |
| `git status --short --branch` | `## HEAD (no branch)`；初始无改动。 |
| `git worktree list --porcelain` | 检测到主 worktree 与多个 detached 执行 worktree；本线无 Git 写权限。 |
| `Test-Path node_modules` | `False`；需要使用获授 install 槽。 |
| `npm ci` | exit 0；added/audited 215 packages，0 vulnerabilities；完整输出见 `.tmp/execution-a/npm-ci.log`。 |
| 5 组 A1 `--test-name-pattern` RED | 均 exit 1，分别证明 admission API 缺失、tract 引用污染、Crime formatter 缺失、宽松 rowsOf 将 malformed `{}` 判为 success。 |
| A1 定向 GREEN patterns | 5 个命令均 exit 0；9 个直接契约全部通过。 |
| `npm run test:crime-async` | exit 0；31/31。 |
| `npm run test:crime-safety-foundation` | exit 0；10/10。 |
| `npm run test:p2-recovery` | exit 0；33/33。 |
| `npm run test:product-integrity` | 最终 exit 0；64/64。 |
| `npm run test:i18n` | exit 0；11/11。 |
| A2 composer/bridge/UI RED | composer 缺失、未知 schema/敏感字段合同、source status、懒加载 bridge 与 UI flag 合同先失败；实现后通过。 |
| chart NaN 自查 RED | `node --test scripts/tests/chart_partial_contracts.mjs` 首次 exit 1：非法 `'NaN'` top count 实际 `success`；统一 admission 后 exit 0，7/7。 |
| aggregate empty-count RED | `npm run test:product-integrity` 首次 exit 1：空字符串被转成 0；收紧 aggregate admission 后 exit 0，64/64。 |
| lazy bridge RED | `npm run test:product-integrity` 首次 exit 1：`buildEvidenceBundleSections is not a function`；移动到 lazy module 后 product 64/64、ui-p0 102/102。 |
| 最终 8-suite 矩阵 | 全部 exit 0：crime-safety-foundation 10/10、crime-async 31/31、p2-recovery 33/33、product-integrity 64/64、i18n 11/11、ui-p0 102/102、runtime-contracts 15/15、points-lifecycle 33/33；合计 299/299。 |
| `git diff --check` | exit 0；仅 Git 的 LF→CRLF 工作副本警告，无 whitespace error。 |
| 跨 worktree 路径交集 | B/f614 两项：`src/i18n/messages.js`、`scripts/tests/product_integrity_contracts.mjs`；C/d1e0 为零；其余执行 worktree 为零。 |
| review repair `npm run test:product-integrity` RED | exit 1；61/64；unknown `description` 未拒绝、`retrievedAt:null` 未接受、source builder 缺失。日志：`.tmp/execution-a/review-repair-red-product-integrity.log`。 |
| review repair direct Crime UI RED | exit 1；48/49；动态第 4 按钮缺少 full-row grid span。日志：`.tmp/execution-a/review-repair-red-crime-ui.log`。 |
| review repair `npm run test:product-integrity` GREEN | exit 0；64/64。日志：`.tmp/execution-a/review-repair-green-product-integrity.log`。 |
| review repair direct Crime UI GREEN | exit 0；49/49。日志：`.tmp/execution-a/review-repair-green-crime-ui.log`。 |
| review repair `npm run test:ui-p0` | exit 0；102/102。日志：`.tmp/execution-a/review-repair-green-ui-p0.log`。 |
| review repair `npm run test:i18n` | exit 0；11/11。日志：`.tmp/execution-a/review-repair-green-i18n.log`。 |
| review repair 最终静态检查 | refs 无漂移；`git diff --check` exit 0；禁止路径/CSS 交集为零；B/f614 仍仅两个已知交集、C/d1e0 为零；日志：`.tmp/execution-a/review-repair-final-static.log`。 |
| review repair 槽位释放 | worktree 命令行范围内 `node`/`npm` 进程为 0；日志：`.tmp/execution-a/review-repair-slot-release.log`。 |

## Open risks and remaining work

- 原 299/299 证据早于本轮 review repair；本轮四次授权命令累计执行 226 个 tests（`test:ui-p0` 已包含 direct Crime UI，因此不能解释为 226 个互不重叠断言），没有扩大到未受影响的 A1 suites。
- 未运行 bundle/checkpoint builder、build:manifest、verify:bundle、browser smoke、visual 或完整 `npm run validate`；这是监督明确的槽位限制，不是通过声明。bundle delta 未测量。
- feature-flagged button 仅有静态/UI 合同证据，尚无真实浏览器点击与下载验证。
- B 的两个加法型文件交集必须由主监督整合后重跑相关合同；A 不回退或改写 B worktree。
- 当前 detached worktree 未 add/commit/push；整合、提交、main 更新、长 gate、状态同步和清理由主监督负责。
- Execution A 的短测试槽已释放；scoped `node`/`npm` 为 0。

## Rollback batches

- A1：Crime/meta admission、chart/district/tract fail-closed 消费、immutable tract enrichment、Crime incident Philadelphia formatter，以及对应 A1 tests。
- A2：`src/analysis/evidence_bundle.js`、`src/utils/export_analysis.js` flag helper、`src/ui/panel.js` feature-flagged lazy download、`src/i18n/messages.js` 单键和 Evidence Bundle tests。
