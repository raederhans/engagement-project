# Task

## Current status

`ready-for-integration`：Crime list-mode 实现、targeted verification、唯一 browser/accessibility smoke、复核和本地 Lore code commit 均已完成。未 push、未整合、未更新 main/其他 worktree。

## Checklist

- [x] 核对 exact base、handoff ref、worktree、branch 与无初始 WIP。
- [x] 阅读要求的规则、records、skills、当前 runtime/UI/test surface。
- [x] 建立本任务唯一 plan/context/task，不修改中央或 Batch 1A records。
- [x] RED：presentation URL/history、latest-query transition 与 Diary privacy。
- [x] RED：list-first optional MapLibre runtime 与一次初始化/失败恢复。
- [x] RED：Crime list query/results/provenance、语义 table、滚动与 visible focus。
- [x] GREEN：实现 view mode、optional map、list controller/UI/style/i18n。
- [x] 运行 targeted Node、lint、bundle policy、diff check。
- [x] 按单 owner 契约运行一次 targeted browser/accessibility smoke。
- [x] 完成 diff/bug/第一性原理/accessibility 复核。
- [x] 创建并复核本地 Lore commits，进入 ready-for-integration。

## Validation evidence

| Check | Result |
| --- | --- |
| Initial `git status --short --branch` | `## HEAD (no branch)`，clean |
| Initial `git rev-parse HEAD` | `f3bf1d490581a1e7d9f5ec5d9d4319830919db12` |
| Handoff ref | `refs/heads/codex/batch1a-handoff` 指向 exact base |
| Local task branch | `codex/batch3-crime-list-mode` 从 handoff ref 创建 |
| TDD RED | URL 18/21、Crime async 31/32、Crime UI 49/51、no-WebGL 2/3；另观察 latest-query URL、320px scroll/copy 和 visible-result focus 的定向失败 |
| Targeted Node suite | `200 tests, 200 pass, 0 fail`；exit `0`。覆盖 Crime async/UI、mode URL/history、map recovery、P1 accessibility、architecture ports、product integrity |
| JavaScript lint | `npm run lint:js`；exit `0` |
| CSS lint | `npm run lint:css`；exit `0` |
| Build manifest | `npm run build:manifest`；exit `0`，212 modules；list controller `6279 B / 2536 B gzip`；MapLibre 保持 lazy chunk；未提高 budget |
| Bundle policy | `npm run verify:bundle`；exit `0`；entry `114984/36962`、Crime `40762/14397`、Crime list `6279/2536` bytes |
| Whitespace | `git diff --check` 与 staged cached diff check；exit `0`（仅 Git 的 LF/CRLF conversion warning） |
| Code Lore commit | `62a2a82df30cf69bb874e3c6df87e445f512d1ae` — `Enable Crime analysis when the map is unavailable` |

## Browser and accessibility log

- Live ownership：端口 `4183` 启动前 listener 0；单一 named browser session；实际 listener PID `87292`（parent `2796`）。结束时 browser 关闭、listener 0、owned process 0。
- 初始 URL：`?mode=crime&view=list`。首屏已加载的 61 个静态资源中没有 `src/map/initMap.js`、MapLibre JS 或 MapLibre CSS；只包含不触发 runtime 的 optional adapter。
- 键盘查询：地址 `1500 MARKET ST, 19102`，radius `400m`，现有日期/offense/rate controls 可达。结果为 1,430 reported incidents；Overview、200-row admitted incident table、charts、source status、method limitations 与 Evidence Bundle 均呈现并可操作。
- 真值/provenance：source status 为 `Data available · records through Aug 8`，accessible label 明确为 historical、not live；Evidence Bundle 为 `engagement-evidence-bundle/v1` aggregate-only，并省略精确 query selection、地址/坐标、GPS、Diary notes/route geometry。
- 语义与焦点：incident result 使用 caption、column headers、row headers/scope 和 live status；refresh 后 focus 落在当前可见 Overview 或 incident heading，而不是隐藏 map-only surface。
- 首次切 map 后 status `Map ready.`、canvas 1；MapLibre CSS、`src/map/initMap.js`、Vite `maplibre-gl.js` 各请求 1 次。再次 `list -> map` 后请求计数仍均为 1、canvas 仍为 1，公开 query（含日期、坐标/label、radius）保持不变。
- no-WebGL 模拟：自动回退 `view=list`，播报 `Map unavailable. List view remains available.`，list 仍显示 200 admitted rows。真实 MapLibre 在抛错前创建的 canvas 被隐藏/失活；注入式 test 另验证 unsupported pre-check 不调用 Map constructor。
- 320px：`innerWidth=320`、`scrollWidth=320`、页面可纵向滚动且 panel 不裁切。200% reflow：以 640 CSS px 模拟 1280 physical px，无横向 overflow。
- Axe：violations `0`、passes `27`；incomplete 为 `aria-valid-attr-value: 1`（既有 lazy Task Focus dialog reference）与 `color-contrast: 21`（渐变/遮挡背景无法自动判定），均不是 reported violation。
- 最终 browser console errors `0`、warnings `0`。保留截图：`output/playwright/batch3-crime-list-mode/crime-list-320px.png` 与 `crime-list-200pct.png`；它们是交接证据，不是 visual baseline。

## Changed surface

- Startup/presentation：`index.html`、`src/main.js`、`src/map/initMap.js`、`src/map/optional_map_runtime.js`、`src/ui/crime_view_mode.js`、`src/ui/mode_surfaces.js`。
- Crime list workflow：`src/routes_crime/list_mode_controller.js`、`src/ui/crime_list_results.js`、`src/ui/panel.js`。
- Presentation copy/style：`src/i18n/messages.js`、`src/style.css`、`src/styles/crime-list-mode.css`。
- Tests/policy：`bundle_policy`、Crime async/UI、map recovery、mode UI、P1 accessibility contract tests。
- Handoff evidence：本目录三个 records 与两张 browser screenshots。

## Unrun gates and residual risks

- 按任务边界未运行完整 `ci:release`、完整 `npm test`/`validate`、visual experience/baseline suite 或生产发布；不能据此声称 release-ready 或 production-verified。
- 未更新 visual baselines。两张 intentional UI screenshot 仅供 integration owner 审查；Axe incomplete 项仍需要人在最终综合 UI 中复核。
- Batch 1B 共享 `scripts/tests/product_integrity_contracts.mjs`；Batch 2 共享 `crime_ui_contracts.mjs`、`product_integrity_contracts.mjs`、`src/i18n/messages.js`。推荐 Batch 3 最后整合并 fresh 重跑共享 tests、lint、bundle 与单一 browser smoke。
- Build 保留既有 MapLibre lazy chunk >500 kB warning；本任务既未把它拉回 entry，也未提高 bundle ceiling。
