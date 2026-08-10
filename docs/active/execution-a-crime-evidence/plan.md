# Plan

## Goal

在不改变合法零值语义、现有 JSON/CSV 导出和其他执行线所有权的前提下，分两个可独立回滚的批次完成 Crime 外部响应 fail-closed admission，以及 feature-flagged Evidence Bundle v1 实验。

## Scope

- A1：`src/api/crime.js` 与 `src/api/meta.js` 的按查询类型响应校验；Crime incident 的 Philadelphia 日期显示；tract enrichment 不可变性；对应既有测试。
- A2：纯、无依赖 Evidence Bundle composer；稳定 canonical section hash；敏感字段拒绝；显式 source status；在现有导出 UI 中以 feature flag 增加 bundle JSON；EN/zh-CN 合同与回归测试。
- 只编辑用户授予 Execution A ownership 的文件和直接对应测试。

## Sources of truth

- 用户委派中的 A1/A2 目标、ownership、禁止范围和最低验收。
- 当前代码与测试；Git 基线 `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`。
- `docs/AGENTS.md`、`$manage-task-records`、`$integrate-worktrees` 与 TDD 工作流约束。
- 既有产品语义：`unavailable`/source failure 不等于真实零；route-corridor 模块只提供原则，不形成旧 Crime 模块依赖。

## Stages

- [x] Stage 0: 核对 HEAD/main/origin/main、worktree 权限、适用规则、依赖状态与任务记录结构。
- [x] Stage A1-RED: 扩展职责重合测试，证明 malformed HTTP 200、NaN/缺 rows、非法维度、tract 污染和跨时区日期当前失败。
- [x] Stage A1-GREEN: 实现最小 fail-closed admission、不可变 enrichment 和 Crime 专用时区显示；运行 targeted suites。
- [x] Stage A2-RED: 为 canonical hashes、schema/status、隐私拒绝、旧导出与双语合同建立失败测试。
- [x] Stage A2-GREEN: 实现 composer 与 feature-flagged 下载接线；运行 targeted suites。
- [x] Stage Review: 自查 bug、过度抽象、兼容性和隐私；扫描其他 worktree 文件交集；记录当前禁止运行的 bundle/build/browser gate 并整理交付包。
- [x] Stage A2-Review-Repair: 修复 provenance retrieval time、v1 exact allowed-key schema 和四按钮 grid 收口；完成 RED→GREEN 与授权 targeted suites。
- [x] Stage Handoff: 完成最终 refs、diff、禁止路径、跨 worktree 交集与 scoped process-zero 检查，释放短测试槽并标记 `ready-for-integration`。

## Acceptance criteria

- malformed HTTP 200、缺少 `rows`、非法或 NaN count、非法 month/dow/hour、非法 district/tract row 均 fail closed，不被 `|| 0`、`|| []` 或宽松 `rowsOf()` 降级成真实零。
- 合法 group-by 空 rows 和已具备充分 admission 的合法零保持可区分；`unavailable !== zero` 有直接断言。
- tract enrichment 浅复制 FeatureCollection、Feature 与 properties，保留 geometry 引用；第二次 enrichment 不改变第一次结果或共享 input。
- Crime incident 显式以 `America/New_York` 显示，Philadelphia 跨日 fixture 通过；其他通用/历史日期显示不变。
- Evidence Bundle 使用 `engagement-evidence-bundle/v1`，保留 canonical query/result/provenance/limitations/privacy 及要求的来源元数据。
- query/result/provenance section checksum 由稳定 canonical serialization 与浏览器原生 SHA-256 生成，`generatedAt` 不影响 section hash。
- raw incident rows、exact addresses、GPS trace、Diary notes/route geometry、311 media URL 等默认拒绝；未知 schema version fail closed。
- source unavailable 明确导出为 unavailable；旧 JSON/CSV 格式和按钮不变；bundle 下载只在 flag 开启时出现；EN/zh-CN 不宣称 verified safe、real-time 或 complete record。
- bundle `generatedAt` 只表示导出生成时刻；source `retrievedAt` 只能来自匹配的 comparison snapshot `generatedAt`，无可证明时刻时为 `null`。
- v1 的 query/result/provenance/source/coverage 与嵌套对象使用精确 allowed-key 集；未知字段 fail closed，字段名 denylist 作为第二层。
- feature flag 开启时 Evidence Bundle 动态按钮跨满 `.button-grid--three` 下一行，原 Copy/JSON/CSV 保持首行三列。
- 所有改动停在未提交的 detached worktree，最终状态只标记 `ready-for-integration`。

## Non-goals

- 不做 ACS MOE、revision timeline、HIN、311、Place Brief、no-map、AI safety score、实时警报或 safer-route recommendation。
- 不迁移 IndexedDB，不引入 ZIP/RDF/AJV/第三方 hash 依赖，不改 ACS/HIN/311/MapLibre。
- 不启动 dev server、browser smoke、visual、完整 `npm run validate` 或共享端口/长 gate。
- 不执行 Git index、refs、branch、worktree、remote 或 GitHub 写操作。

## Risks and constraints

- `panel.js` 与 i18n/export 表面是并行执行线潜在交集；只做所需最小接线并在交付前扫描实际差异。
- 现有 Crime 查询返回形状可能按 endpoint 不同；必须逐类校验，不能用一个宽松通用 parser 掩盖 schema 差异。
- 浏览器原生 Web Crypto 是异步接口；composer 需要保持纯输入模型，同时明确异步 checksum 生成边界。
- `node_modules` 初始缺失；已使用当时获授的唯一 install 槽，日志保存在 `.tmp/execution-a/`，后续未重复安装。
