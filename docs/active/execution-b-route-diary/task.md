# Task

## Current status

`ready-for-integration` — B1/B2/B3 源码、静态/targeted tests、交集扫描和测试槽释放均已完成；未提交、未改 refs。

## Checklist

- [x] 核对 HEAD/main/origin/main 与 detached worktree；三者均为规划基线 `dc1e5672...`，初始 worktree clean。
- [x] 读取适用规则、任务记录 Skill、既有 route/Diary 交接证据和当前测试入口。
- [x] B1 RED contracts。
- [x] B1 implementation + focused tests。
- [x] B2 RED contracts。
- [x] B2 implementation + focused tests。
- [x] B3 truth contracts + implementation；依赖缺失时先以 no-dependency contract 补证，安装槽交接后再运行正式 suites。
- [x] 跨线交集扫描、第一性原理 review、最终记录同步与 ready-for-integration。
- [x] Supervisor finding closure：`diary-demo.html` 无脚本/翻译加载前 title 同步为 Route Experience Diary，并由 Diary truth contract 锁定 EN/zh-CN 注册与静态 fallback。
- [x] Supervisor code-review closure：drawer 初始化/关闭为 inactive，打开为 active；Close/Escape 暂停隐藏 drawing click ownership但保留 drawing/route，mode switch 仍 clear。
- [x] Supervisor code-review closure：`persisted:false` submission message 只说明 browser session preparation 与 no remote write，不再声称 durable/saved local entry。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` | 初始为 clean detached HEAD。 |
| `git rev-parse HEAD/main/origin/main` | 三者均为 `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`。 |
| `git worktree list --porcelain` | 确认多 worktree 并行；本线只写 `f614` 与独占记录目录。 |
| `.tmp/execution-b/00-process-precheck.log` | exit 0；本 worktree scoped node/npm 进程为 0。 |
| `.tmp/execution-b/01-npm-ci.log` | exit 0；214 packages，package/lockfile 未改变。 |
| `.tmp/execution-b/02-npm-audit-high.log` | exit 0；0 vulnerabilities，无 high/critical。 |
| `.tmp/execution-b/03-test-route-corridor-ui.log` | exit 0；11/11，包括 lazy shell、八 phase、keyboard waypoint、pending-close。 |
| `.tmp/execution-b/03b-test-route-corridor-ui-review-retry.log` | exit 0；11/11；review 后补 file-input Clear 语义并复验。 |
| `.tmp/execution-b/04-test-route-corridor-data.log` | exit 0；20/20，包括 exact route 不出站、coarse request、coverage/admission/supersession。 |
| `.tmp/execution-b/05-test-data-sources.log` → `05b-...retry.log` | 首次 30/31；旧 local-only 文案断言失败。B-owned contract 最小修复后 31/31。 |
| `.tmp/execution-b/06-test-runtime-contracts.log` | exit 0；15/15。 |
| `.tmp/execution-b/07-test-product-integrity.log` → `07b-...retry.log` | 首次 58/60；两个旧真实性措辞/内部 key 断言失败。中性命名与事实断言收口后 60/60。 |
| `.tmp/execution-b/08-test-i18n.log` | exit 0；10/10，EN/zh-CN key 与 reader-visible 注册通过。 |
| `.tmp/execution-b/09-test-ui-p0.log` | exit 0；101/101。 |
| `.tmp/execution-b/10-test-diary-local.log` | exit 0；37/37，entry/draft/backup/merge/replace/delete 生命周期未退化。 |
| `.tmp/execution-b/11-test-diary-insights.log` → `11b-...retry.log` | 首次 5/6；旧 Sample Community 标题快照失败。改为 illustrative sample 后 6/6。 |
| `.tmp/execution-b/12a-test-diary-truth-contracts.log` | exit 0；3/3，remote upload 默认关闭、501 live tree 移除、neutral/sample copy。 |
| `.tmp/execution-b/17-git-diff-check-record-final.log` | exit 0；最终记录同步后复验，仅 LF→CRLF working-copy 提示，无 whitespace error。 |
| `.tmp/execution-b/18-process-release-record-final.log` | exit 0；`SCOPED_PROCESS_COUNT=0`、`SLOT_RELEASED=true`。 |
| `.tmp/execution-b/14-static-final-audit.log` → `14b-...retry.log` | 首次发现 3 份旧 Diary 规划仍含错误 route-method hint；标记 historical 并删除提示后，live stub/upload/fetch/hint/persistence/forbidden/package checks 全部为 0，8 个 JS syntax checks通过。 |
| static RED（PowerShell `Select-String`，未启动 node/npm） | contract 先要求 `Route Experience Diary Demo`，当时 HTML 仍为 `Route Safety Diary Demo`；确认 finding 可复现。 |
| static title contract inspection | HTML fallback、`data-i18n="diary.demoDocumentTitle"` 与现有 EN/zh-CN message pair 已同步；Node suite 留给当前测试槽 owner。 |
| static RED（PowerShell source/contract comparison，未启动 node/npm） | contract 要求 inactive hide lifecycle 与 no-saved/durable message；旧 controller 仍 `active=true` 且 hide 未 release，旧 API 仍声明 durable entry saved。 |
| static GREEN inspection | controller 为 `active=false` init、`open()` active、`hideSurface()` inactive、`onMapClick()` active guard；hide block不清 route/drawing；API message 为 `Prepared for this browser session; no remote data was written.` |
| `.tmp/execution-b/19-process-precheck-review-fixes.log` | exit 0；二次测试槽接管前 scoped node/npm = 0。 |
| `.tmp/execution-b/20-test-route-corridor-ui-review-fixes.log` | exit 0；11/11，包含 hidden drawing ownership lifecycle contract。 |
| `.tmp/execution-b/21-test-diary-truth-review-fixes.log` | exit 0；4/4，包含 static title 与 persisted:false message truth contract。 |
| `.tmp/execution-b/22-test-data-sources-review-fixes.log` | exit 0；31/31，local-only API message 与无 remote write contract通过。 |
| `.tmp/execution-b/23-test-product-integrity-review-fixes.log` | exit 0；60/60。 |
| `.tmp/execution-b/24-test-i18n-review-fixes.log` | exit 0；10/10。 |
| `.tmp/execution-b/25-test-ui-p0-review-fixes.log` | exit 0；101/101。 |
| `.tmp/execution-b/29-git-diff-check-records-review-fixes.log` | exit 0；最终记录同步后无 whitespace error。 |
| `.tmp/execution-b/27-baseline-refs-review-fixes.log` | exit 0；HEAD/main/origin/main 均为 `dc1e5672...`，detached HEAD 未改变。 |
| `.tmp/execution-b/28-worktree-intersections-review-fixes.log` | exit 0；A 交集 2 paths、C 交集 1 path，其余 worktree 0。 |
| `.tmp/execution-b/30-process-release-review-fixes.log` | exit 0；最终 scoped node/npm = 0，slot released。 |

## Open risks and remaining work

- 按授权未运行 browser smoke、visual、完整 `npm run validate`、build:manifest、verify:bundle、bundle/checkpoint builder、截图 baseline 或远端 Actions。
- controller 源码明显增长；bundle budget 未获授权验证，整合后需由单一 bundle owner 运行。
- supervisor finding 后的直接回归与相邻 product/i18n/ui suites 已获授权并全部通过，合计 217/217。
- 禁止文件 `src/routes_diary/index.js` 与 `src/map/segments_layer.js` 仍使用旧 risk/safe class/token 名和部分红黄绿表达式；B 已把相关共享 token/reader copy 改为中性，但不能越权完成运行时 selector 重命名。
- 路径交集：`1b4f` 同改 `scripts/tests/product_integrity_contracts.mjs`、`src/i18n/messages.js`；`d1e0` 同改 `scripts/tests/data_source_policy.mjs`。内容属于不同执行线，整合时必须逐 hunk 合并，不能整文件覆盖。
