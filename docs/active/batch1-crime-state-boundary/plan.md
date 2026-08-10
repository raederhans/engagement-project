# Plan

## Goal

在不改变 Crime 用户行为、DOM、文案、数据语义、URL、Evidence Bundle 或 Analysis History 结果的前提下，将 Crime 查询状态写入口收敛到命名明确的 action/port，并从 `src/routes_crime/index.js` 抽出最窄的地图 selection/query 协调职责。

## Scope

- 扩展 `src/state/crime_state_port.js` 及其现有 action owner，使 panel 与 Crime map/controller 通过同一窄入口修改 Crime query/selection 状态。
- 仅修改 `src/ui/panel.js` 的 Crime 查询 mutation 与事件绑定片段。
- 仅修改 `src/routes_crime/index.js` 的 Crime selection/query/coordinator 片段，并按需要新增一个 Crime 专用 selection coordinator。
- 优先扩展 `scripts/tests/architecture_ports.mjs`，仅在职责无法清晰容纳时新增测试文件。

## Sources of truth

- 用户指定基线 `9f585b9e86fc3ee4f2378647cba2ef49a0308ccb` 与当前 worktree 代码。
- `docs/AGENTS.md`。
- `docs/active/project-optimization-planning/{plan,context,task}.md` 中已整合 explicit state port、Crime 数据语义、release owner 与共享验证边界。
- Crime codec/validation owner：`src/state/crime_view_state.js` 与 `src/state/store.js` 的既有 helpers。
- Crime refresh owner：`src/routes_crime/crime_refresh_owner.js`；本任务不复制其 generation、abort 或 result 状态职责。

## Stages

- [x] Stage 1: 核验基线、工作树、所有权、项目指令和既有 state/architecture/release 记录。
- [x] Stage 2: 盘点 query-owned、result/runtime-owned 字段与例外，并写 RED contracts。
- [x] Stage 3: 以最小 action 集收敛 panel/map/controller 写入口。
- [x] Stage 4: 抽出最窄 Crime map selection coordinator，保持 presentation/refresh owner 不变。
- [x] Stage 5: targeted tests、相关 lint、diff review、bug review、第一性原理复核。
- [x] Stage 6: 创建本地 Lore commit 并交付 ready-for-integration 证据。

## Acceptance criteria

- Query-owned：`queryMode`、时间窗、半径、offense filters、district/tract selection、tract overlay、comparison points/labels/projections、rate、classification 与瞬态 map selection；panel 与 Crime route/controller 对这些字段不再直接赋值。
- Derived query exceptions：`adminLevel` 继续由 `setAnalysisMode` 派生，`selectedTypes` 继续由既有 offense catalog helper 派生，`center3857` / `centerB3857` 继续由 store projection helper 派生；它们只由 port 委托既有 owner 更新。
- Result/runtime-owned：coverage/status/error/notice、加载 generation/abort、result presenters/provenance、地图对象/GeoJSON/cache/camera、route corridor runtime；本任务不接管。
- 例外：`src/state/store.js` 保留底层 store helper/coverage normalization，`src/state/crime_view_state.js` 保留 codec/action mutation，Crime refresh owner 保留结果生命周期。
- Action 名称稳定可搜索；URL codec、coverage validation、refresh generation 不被复制。
- URL serialization、历史恢复、Evidence Bundle、Analysis History、Crime 查询结果及 copy/DOM 不变。
- Coordinator 只抽 selection/query 事件协调，不吸收 presentation、refresh、map rendering 或 result state。

## Non-goals

- 不触碰 Diary、`src/main.js`、地图启动/lazy-loading、Evidence Bundle、visual baselines、README、依赖或 lockfile。
- 不引入框架、依赖、全局 event bus、兼容层、通用 facade 或一次性大重写。
- 不运行 dev server、browser/visual、完整 `ci:release` 或共享端口门禁。
- 不 push、不修改 main/其他 worktree、不整合或清理 worktree。

## Risks and constraints

- `panel.js` 同时承载 UI presentation；只替换 mutation 路径，DOM 和事件顺序必须保持。
- Coverage normalization 会同时校正 query 时间窗并写 coverage notice；通过注入既有 helper 保留 owner，不复制算法。
- 当前是 detached execution worktree；只有本任务本地提交权限，没有 integration 权限。
