# Mainline M7 Public Product Plan

## Goal

在干净 `main@dfb4bc8` 的隔离工作树中，为 Pages 增加 walking-only 的
`Adaptive Route Alternatives v1` Public Scenario Mode：用户只能选择预计算、公开的
Philadelphia landmark OD pair，并以确定、诚实、可访问的产品界面比较已准入路线及其证据。
本 lane 可以创建本地结构化提交；main 整合、push、release、deploy、远端设置和其他 worktree
清理由总协调任务保留。

## Scope

- 新增公开路线产品模块、预计算 landmark scenario fixtures 和相应 unit/browser tests。
- 复用现有 admitted route/candidate/evidence、map-match 和 sensitivity 合同；不重写路线算法。
- 每个 scenario 最多展示 `Fastest`、`Lower historical exposure`、`Balanced`，以及仅在
  accessibility evidence 已准入时展示的 `Accessibility-oriented`。
- 核心解释 Pareto frontier、detour、权重敏感性和缺失证据；敏感性不稳定时只展示 trade-offs，
  不选择 winner。
- 卡片明确展示 travel time、distance、detour、historical reported-incident exposure、crash、
  HIN、accessibility、map-match quality、freshness 与 uncertainty；缺失值显示 `Unavailable`。
- 实现 OSRM/candidate/evidence/map-match/sensitivity 的 fail-closed 产品状态：只有一条路线就只展示
  一条；证据质量不足时只展示普通路线；不得将 fixture 或不完整证据升级为 runtime authority。
- 完成 `src/main.js`、`src/style.css`、i18n 和页面 wiring 的最小必要改动，以及双语、键盘、Axe、
  响应式和 Pages-base 验证。

## Sources of truth

- 当前用户委派、根 `AGENTS.md` 与 `docs/AGENTS.md`。
- 当前 `main@dfb4bc8` 的代码、contracts、fixtures、tests 和 package scripts。
- `docs/active/mainline-m0-m6/**` 的 M5/M6 fail-closed gate；其当前 NO-GO/UNAVAILABLE 结论不被
  Public Scenario fixture 改写。
- 现有 route-decision/route-generation 与 Known Route 合同；公开场景只消费已准入输出。
- `docs/active/_worktree_registry.md` 仅作只读所有权证据，本 lane 不修改它。

## Stages

- [x] Stage 1：核对基线、状态、仓库规则、现有合同与任务记录；创建独立分支和 M7 记录。
- [x] Stage 2：冻结 Public Scenario fixture 与 fail-closed presenter/view-model 合同。
- [x] Stage 3：实现 Pages 产品界面、双语、键盘与响应式交互。
- [x] Stage 4：补齐 unit/browser/Axe/Pages-base 测试与诚实文案断言。
- [x] Stage 5：运行最窄充分的 Node、lint、build、bundle 和 browser 验证。
- [x] Stage 6：建立结构化本地提交并完成 handoff。
- [x] Stage 7：修复独立精确 manifest/content-digest 准入缺口，补 hostile 回归并重做 handoff。

## Acceptance criteria

- 输入面只允许预定义公开 Philadelphia landmark OD pair；没有自由文本地址、坐标输入、定位、
  私人地址存储或任意公共路由 backend 请求。
- 仅 walking mode；fixture 与 view model 的 route/scenario/schema 版本和 evidence admission 可机械检查。
- 同一场景最多四条路线，角色集合受控且不重复；accessibility-oriented 只有在其所需 evidence
  admitted 时才存在。
- Pareto/detour/sensitivity 语义可见；敏感性不稳定时没有 winner、推荐或单一排序。
- 不出现 `Safest`、`Best route`、`Risk/Safety score`、个人受害概率或等价单一安全赢家文案。
- 所有要求字段均可见；不存在或未准入的值为 `Unavailable`，绝不以 `0` 代替。
- OSRM、candidate、evidence、map-match 或 sensitivity 任一 gate 失败都按合同降级；只有一个 admitted
  candidate 时不伪造 alternatives；路线质量不足时只显示普通路线。
- 英文与简体中文完整，所有交互可键盘完成，Axe 无新增 serious/critical violations，桌面与移动端
  无关键内容截断，Pages base path 下 fixture 和入口可加载。
- 聚焦 unit/browser/build/bundle 检查通过；不修改视觉阈值、不无故更新基线、不启动共享长进程。

## Non-goals

- 私人地址、自由 OD、地理定位、Diary/known-route 私人 geometry、个人路线历史或网络传输。
- 公共任意 OSRM/路由 API、local companion service、full OD benchmark、实时候选生成或新路由算法。
- ML forecast/ranking、combined safety score、safest/best route、个人风险或受害概率。
- 全局 README、worktree registry、release/CI/Pages 部署、main merge、push、远端 mutation 或清理。

## Risks and constraints

- 历史 route-decision 与 real-graph 代码存在多层 candidate/authority 边界；Public Scenario fixture 必须
  明确是预计算演示数据，不能建立新的真实图或 routing authority。
- M5/M6 当前真实证据并不完整；M7 产品可展示受控公开 scenario，但不得把 fixture PASS 描述成
  Philadelphia 全域、实时、最安全或生产路由能力。
- `src/main.js` 与 `src/style.css` 是共享大文件；改动需局部、避免破坏既有 Diary/Crime/Home Compare。
- bundle 接近既有预算时优先静态 JSON 与无依赖模块；视觉 baseline/阈值保持不变。
  聚合 bundle 上限只能依据 `dfb4bc8` 基线和 M7 实测增量窄调，并单独限制 fixture 大小。
