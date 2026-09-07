# Plan

## Goal

在当前审计基线 `4d5c34cf13fbc8e426347661db5cda988477d82a` 上完成 P0-P2 可维护性与运行效率整改：修复不可重试的懒加载、降低 Charts/Diary 初始负载、拆解大协调器和跨领域 store、减少源码字符串测试与重复 CI、收口重复政策值，并在保持现有版本化合同与产品语义的前提下拆分 Route Decision 重模块。

## Scope

- P0：Diary 动态模块失败后可重试；Crime radius 政策单一来源；所有测试文件明确归类。
- P1：Charts 数据/summary 与 Chart.js renderer 解耦并按用户意图加载；Diary 评分/校验延迟加载；Panel、Diary coordinator 按兼容 facade 拆分；源码顺序测试迁为行为测试；CI 避免完整 suite 重复执行。
- P2：`store.js` 逐步拆为 app mode、Crime query/coverage、Diary preferences；Route Decision/Generation 合同按稳定边界拆分，保留现有导出与序列化结果；重复 validator support 收口到有版本与 conformance evidence 的内部层。

## Sources of truth

- 当前分支 `codex/route-decision-s6-real-data`、精确基线 `4d5c34cf13fbc8e426347661db5cda988477d82a`。
- 当前源码、`package.json`、`.github/workflows/ci.yml`、`scripts/run_release_gate.mjs` 与现有 focused tests。
- 本轮只读审计结果；旧 `project-optimization-planning` 仅作为历史线索，不作为当前状态。

## Stages

- [ ] Stage 0：建立中央记录、分派四个隔离实现对话和一个 P0 子代理，冻结 ownership 与测试 owner。
- [ ] Stage 1：完成 P0 quick fixes，并运行 `mode_ui_contracts`、相关 state/UI contracts。
- [ ] Stage 2：完成 Charts/Diary 性能拆分与测试/CI 精简，逐 lane 运行 focused tests；统一候选运行 fresh manifest/bundle 检查。
- [ ] Stage 3：完成 Panel/Diary/store 模块化，逐模块运行行为、session、async、local repository contracts。
- [ ] Stage 4：完成 Route Decision 合同拆分与 validator support 收口，运行 route foundation/S2/S3-S6 focused suites。
- [ ] Stage 5：按绿色→黄色→红色顺序逐 lane 整合；每次整合后运行最小充分局部测试。
- [ ] Stage 6：统一候选执行 lint、targeted aggregate、fresh build:manifest 与 bundle policy；只有必要时再运行 browser/visual，不 push、不部署。

## Acceptance criteria

- Diary chunk 首次加载失败不会污染后续重试。
- Radius min/max/default/presets 只由一个政策模块定义；DOM 与 URL codec 使用相同值。
- Charts pane 未打开时不加载 Chart.js renderer；tract summary 不依赖 renderer chunk。
- Panel/Diary/store/Route Decision 对外 API 与版本化 schema 保持兼容，静态 import cycle 仍为 0。
- 普通业务行为不再由源码变量名或语句顺序断言锁死；保留 privacy/security/schema/lazy/workflow/bundle 边界测试。
- 每个 `.mjs` 测试文件均属于 fast、integration、release、extended 或 quarantined lane；不存在静默未登记文件。
- PR 完整 suite 只执行一次，另一平台仅保留窄 portability smoke；coverage 不再造成无说明的第三次重复。
- 不提高现有 bundle/runtime ceiling 来掩盖回归。

## Non-goals

- 不改变 Philadelphia 产品范围、schema version、claim vocabulary、fail-closed 语义或 Diary 私有数据边界。
- 不升级 MapLibre，不引入新框架，不更换测试框架。
- 不 push、部署、修改远端设置或清理任何既有 worktree/WIP。

## Risks and constraints

- 当前主工作树含用户修改的 `.gitignore` 和大量未跟踪日志/Playwright 产物，全部受保护。
- `package.json`、bundle policy、Panel、Diary 入口和 Route contracts 属于高冲突面，必须单 owner、串行整合。
- execution 对话和子代理不得 merge、push、清理或修改其他 lane 文件；`/root` 是唯一 integration owner。
