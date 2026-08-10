# Plan

## Goal

在 Batch 1A ready commit `f3bf1d490581a1e7d9f5ec5d9d4319830919db12` 上，为 Crime 提供不依赖 MapLibre/WebGL 的可访问 list presentation，同时保持 Crime query/result/provenance/Evidence Bundle 真值与现有 map presentation 一致。

## Scope

- `view=map|list` 独立 presentation state、URL/history codec 与可访问模式切换。
- `src/main.js` / `src/map/initMap.js` 的 list-first lazy startup；list 首屏不请求、不 import、不初始化 MapLibre runtime，首次进入 map 才初始化一次。
- 一个职责窄的 optional-map runtime adapter 与 Crime list controller/result view。
- 通过 Batch 1A `crimeStatePort` / actions 继续拥有 Crime query mutation；panel 不重新直接写 store。
- Crime list 的地址查询、日期/offense/radius/rate filters、Overview、Incident log、Charts、source status、limitations 与 Evidence Bundle。
- Crime/list 专用语义 HTML、样式、i18n、architecture/product-integrity/accessibility/browser tests。
- 本目录唯一 `plan.md`、`context.md`、`task.md`。

## Stages

- [x] 核对 worktree、exact base、规则、技能、Batch 1A 与中央优化证据。
- [x] 写并观察 presentation URL、optional runtime、list refresh、semantic result 的 RED tests。
- [x] 实现最小 list-first runtime 与 Crime list workflow。
- [x] 运行 targeted Node tests、lint、bundle policy 和 diff checks。
- [x] 按单 owner 契约运行一次 targeted browser/accessibility smoke，不更新 visual baselines。
- [x] 完成 diff/bug/第一性原理/accessibility 复核并创建本地 Lore commits。

## Acceptance criteria

- `viewMode=map|list` 只影响 presentation，不改变 canonical Crime query/result truth。
- URL 保存公开 Crime query 与 `view`；不读写私人 Diary route/state；back/forward 结果确定。
- list 初次启动的 network/module graph 没有 MapLibre JS/CSS/runtime；切到 map 后仅初始化一次，失败可访问且 list 继续可用。
- map 现有 product mode、URL/copy、查询、结果与 Known Route 真实性边界不变。
- list 可用地址选择完成 buffer Crime query，并继续支持现有日期、offense、radius 与适用 rate filters；map-only controls 在 list 中不可操作并解释替代路径。
- Overview、incident records、charts、source status、method limitations 与 Evidence Bundle 使用既有数据/API/provenance owner；failure/unavailable 不显示为 0。
- 结果使用 headings、caption、table headers/scope、lists、live status 与明确 focus management；键盘、320px、200% zoom、no-WebGL 可用。
- 不声称 live、predictive、risk score 或 safer route。

## Non-goals

- Diary、community、云功能、private route URL、safer-route。
- Batch 2 的 ACS/config/snapshot/tract population/compare MOE 文件。
- Batch 1B records、中央 planning records、release workflow、README、依赖、lockfile、bundle ceiling。
- visual baseline 更新、push、main/其他 worktree 更新、integration 或 cleanup。

## Risks

- 现有 `store.viewMode` 是 Crime/Diary product mode，不能复用；presentation state 必须独立。
- 现有 Crime map controller 有静态 map imports；list controller 必须只复用数据/refresh/provenance owner，不得通过 optional adapter 把 MapLibre 拉回入口。
- `src/main.js`、panel/i18n/tests 与 Batch 1B/2 可能重叠；最终逐文件报告并推荐整合顺序。
- browser/preview/build 是共享资源；本任务作为唯一 owner 串行使用一个明确端口与日志目录。
