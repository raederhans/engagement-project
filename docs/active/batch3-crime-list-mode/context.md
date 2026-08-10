# Context

## Current truth

- Worktree：`C:/Users/raede/.codex/worktrees/fb96/engagement_project`。
- 初始 exact base / Batch 1A ready commit：`f3bf1d490581a1e7d9f5ec5d9d4319830919db12`。
- 本地分支：`codex/batch3-crime-list-mode`，从 `codex/batch1a-handoff` exact base 创建；初始 worktree clean。
- 主工作树仍为 `main`；本任务不是 integration owner，不 push、不整合、不清理。
- 仓库没有实体根 `AGENTS.md` 或 lessons learned；已读取用户注入根规则、`docs/AGENTS.md`、`docs/KNOWN_ISSUES.md`、Batch 1A records 与中央优化 records。
- 已读取并采用：`manage-task-records`、`frontend-components-standards`、`web-design-guidelines`（2026-08-10 fresh upstream rules）、用户显式重新启用的 `test-driven-development`、`orchestrate-live-tests`、`verification-before-completion`、`write-lore-commits`。

## Decisions and evidence

| Date | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | `store.viewMode` 与 `mode_coordinator` 当前拥有 Crime/Diary product mode。 | 新增独立 Crime presentation state，避免重命名或复用既有 product-mode state。 |
| 2026-08-10 | `main.js` 已动态 import `initMap.js`，但启动时无条件执行；顶层仍静态 import MapLibre CSS。 | list-first startup 延后 MapLibre CSS/JS 和 `initMap`，由 optional runtime 只初始化一次。 |
| 2026-08-10 | `routes_crime/index.js` 与 incident map controller 静态依赖 map modules/MapLibre；panel 的地址、filter 与 Evidence export 本身可无地图工作。 | 新的 list controller 直接复用 Crime API、charts/summary、refresh owner 与 provenance，不 import map controller。 |
| 2026-08-10 | 现有 incident result UI 是语义 ordered list，但 list-mode 验收要求 caption/header/scope。 | list presentation 增加独立 semantic table，并保留现有 map incident list 不变。 |
| 2026-08-10 | list controller 从一次 canonical snapshot 驱动 summary、incident table、charts、source status 与 provenance；query mutation 仍只通过 Batch 1A port/action。 | map/list presentation 不产生第二套 Crime truth，也没有重新引入 direct store writes。 |
| 2026-08-10 | 首轮 browser smoke 暴露快速 `list -> map` 时 URL writer 使用旧 query snapshot，可能丢掉公开 Crime query。 | URL writer 改为读取最新 query，并由 generation guard 阻止过期异步 transition 回写；补充行为测试。 |
| 2026-08-10 | 320px browser smoke 暴露既有 app/sheet overflow 会裁掉 list 结果；结果 refresh 的默认 focus 也可能落到隐藏 map-only surface。 | list mode 改为页面滚动并重排 app bar；focus helper 只选择当前可见的 Overview 或 incident heading。 |
| 2026-08-10 | no-WebGL 实测中 MapLibre 可先创建 canvas 再抛错；注入式单元测试可在 constructor 前验证 `supported() === false`。 | optional adapter 捕获真实失败、回退 list、播报可访问错误；list workflow 继续可用，且 map runtime 只加载一次。 |

## Live process ownership

| Resource | Final record |
| --- | --- |
| Owner | 当前 Batch 3 task；全程只有一个 named browser/live lane |
| Command | `npm run quick-preview -- --mode crime --host 127.0.0.1 --port 4183 --no-open`，Evidence Bundle feature enabled |
| Working directory | `C:/Users/raede/.codex/worktrees/fb96/engagement_project` |
| Shared resources | `127.0.0.1:4183` 启动前 listener 0；实际 listener PID `87292`、parent command PID `2796`；未使用其他 worktree 输出 |
| Browser evidence | 详细命令结果与网络/console/Axe 记录保存在 `task.md`；最终截图在 `output/playwright/batch3-crime-list-mode/`。临时 CLI/server raw logs 在安全停止后未保留。 |
| Success | named-session smoke 完成：list 首屏无 MapLibre JS/CSS/init；键盘地址查询、语义结果与 Evidence export 成功；320px、200% reflow、Axe、map 一次加载和 no-WebGL fallback 均已检查 |
| Stop | browser session 已关闭；只终止核验属于本轮的 listener；最终端口 4183 listener 0、owned process 0 |

## Integration intersections

| Delivery | Exact overlap with Batch 3 | Boundary |
| --- | --- | --- |
| Batch 1B (`5394b76`, `a9b23d4`) | `scripts/tests/product_integrity_contracts.mjs` | Diary production files与records均未触碰；仅需合并共享 contract assertions。 |
| Batch 2 (`dc9a86f`, `48ec427`) | `scripts/tests/crime_ui_contracts.mjs`、`scripts/tests/product_integrity_contracts.mjs`、`src/i18n/messages.js` | Batch 3 未触碰 ACS/config/snapshot/tract population/compare MOE 生产文件；共享测试与 i18n 需人工保留两侧意图。 |

推荐顺序：Batch 1A base -> Batch 1B -> Batch 2 -> Batch 3 code commit -> Batch 3 handoff-record commit。Batch 3 最后进入，随后重新运行共享 Crime/product-integrity、lint、bundle 与单一 browser smoke；这只是 integration owner 的建议，本任务未执行整合。

## Handoff boundary

- 允许本地 Lore commits；完成后标记 `ready-for-integration`。
- 禁止 push、更新 main/其他 worktree、整合、清理或 visual baseline 更新。
- 最终报告 base/HEAD/commits、changed files、网络/MapLibre证据、browser 日志、命令退出码、未跑门、Batch 1B/2 交集与推荐整合顺序。
