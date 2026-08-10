# Plan

## Goal

在不改变 Crime 查询/数据语义、Diary IndexedDB 行为或 static Pages 架构的前提下，完成 Known Route 的 shell-level、键盘等价、非模态体验，以及 Diary 的 local-first 真实性收口，并交付可由主监督整合的独立回滚批次。

## Scope

- B1：Known Route 入口继续位于 Crime 工作区并保持 second-level lazy；实际 surface 移出 `#sidepanel`，成为 shell-level 非模态 drawer / bottom sheet，补齐 focus、ARIA、Escape、mode switch、reduced-motion 和窄屏 reflow 契约。
- B2：在既有 GeoJSON 与 pointer draw 之外加入 Lon/Lat waypoint 编辑器，所有入口统一进入 `createManualRouteInput`；明确 presentation phases 与显式 Review admission。
- B3：将 Diary reader-visible 边界收口为 Route Experience Diary / 路线体验日记，保持个人、本地、sample、historical reported records 的真实来源说明；移除 live runtime 的 501 stub 和默认 remote upload 能力。
- 只修改用户列出的 Execution B ownership；不修改中央/其他 execution 记录。

## Sources of truth

- 用户委派中的 B1/B2/B3、ownership、禁止项和最低验收。
- 基线 `dc1e5672d8b2229bebf587e2ec72ba3550f2f592` 的实际源码与测试。
- 现有 route corridor coordinator/admission 契约，尤其 unavailable/failure 不等于 zero。
- 当前 IndexedDB/local entry/draft/backup/merge/replace/delete 实现与相关测试。

## Stages

- [x] Stage 0: 只读核对 HEAD/main/origin/main、worktree、规则、既有记录与 live-test 边界。
- [x] Stage 1 (B1 RED -> GREEN): shell-level Known Route surface、结构/ARIA/focus/响应式契约。
- [x] Stage 2 (B2 RED -> GREEN): keyboard waypoint editor、显式 Review、phase/stale/abort admission。
- [x] Stage 3 (B3 RED -> GREEN): Diary/local-first 文案、视觉语义、501 stub 与 remote adapter 收口。
- [x] Stage 4: focused validation、交集扫描、第一性原理/review、ready-for-integration 交接。
- [x] Stage 5: 关闭 supervisor title、hidden drawing ownership、local-only message 三项 finding，并补直接 contracts。
- [x] Stage 6: 获得二次短测试槽后完成 6 个 suites（217/217）、diff/refs/intersection/process closeout，再次 ready-for-integration。

## Acceptance criteria

- 用户点击 Known Route 前不加载 route UI chunk；入口仍在 Crime 工作区，surface host 在 `#sidepanel` 外。
- 打开 surface 不使用 `aria-modal=true`；触发器有 `aria-expanded`/`aria-controls`，surface 有可访问名称，Escape 关闭并恢复焦点；mode switch 会 hidden/inert/clear。
- 桌面为 420–480px 非模态 drawer；移动竖屏为单一滚动 owner 的 bottom sheet；drawing 时显示紧凑 instruction rail；长中英文不裁切、不形成嵌套滚动或 sticky action 遮挡。
- 键盘用户可用至少两个 Lon/Lat waypoint 完成 route input，Add/Remove/Undo/Clear 可用，且与 GeoJSON/pointer draw 统一进入 `createManualRouteInput`。
- phase 明确覆盖 route-required、drawing、route-provided、pending、coverage-unavailable、source-failure、admitted zero、ready；buffer/route/query 变化只使结果 stale/superseded，Review 才请求。
- pending close abort 后回到 route-provided；close 不等于 Clear；精确 geometry 不进入 URL、Web Storage、IndexedDB、Saved Analysis、日志或远程 request body。
- EN/zh-CN 同步；Diary 不做 safety/risk/community safety score 承诺，Sample Community 不暗示真实投稿，zero 不用绿色安全暗示。
- 默认 static build 严格 local-only；不上传 rating、notes、route geometry、draft；501 stub 不再作为 live runtime 能力；本地保存行为不退化。
- route existing zero/unavailable 7 tests及相关 focused tests通过；未运行的 live gates明确列出。

## Non-goals

- 不建设后端、账号、cloud sync、GPS、telemetry、真实社区聚合。
- 不实现 clear-all、口令加密备份、生产后端、自动 route request 或 find-safer-route。
- 不修改 package/lockfile、workflow、README、中央 DEPLOY/TODO/KNOWN_ISSUES、visual baseline。
- 不执行 git add/commit/push、refs/branch/worktree 拓扑修改、merge/rebase 或清理。

## Risks and constraints

- 多 worktree 并行；共享文件只允许修改 Execution B ownership，最终必须扫描与其他 execution 的交集。
- `src/routes_crime/index.js`、`src/routes_diary/index.js`、`src/ui/panel.js` 禁止修改，因此 shell host 与 mode lifecycle 必须从允许文件和现有 DOM/事件契约接入。
- dependency/install 与非浏览器 targeted-test 槽先后两次由主监督正式交给 Execution B；两轮均按授权顺序串行完成并释放，日志位于 `.tmp/execution-b/`。
- 视觉和响应式最终证据仍需要后续单一 live owner；本执行线只提供静态/DOM contract 与待办矩阵。
