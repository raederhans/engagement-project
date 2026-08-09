# Task

## Current status

`integration-validated` — 实现、独立复核、分支 Lore commit 与 2026-08-09
父任务新鲜复验均已完成；候选保持 `main + 1`，等待 fast-forward、远端同步、
registry closeout 与安全 worktree/branch 清理。

## Checklist

- [x] 确认 worktree、HEAD、Git 状态与所有权边界。
- [x] 读取适用指导、任务记录流程与 TDD 流程。
- [x] 建立唯一 `plan.md`、`context.md`、`task.md`。
- [x] 完成 C3-0 RED/GREEN admission matrix 与产品准入决策。
- [x] 完成 C3 lazy UI、输入、八状态、取消/重试、文本/地图同步。
- [x] 完成 privacy/product-integrity/I2 exception/bundle contracts。
- [x] 完成定向测试、完整 validate、browser/visual/a11y 验证。
- [x] 完成独立 review、第一性原理复核、精确快照复验。
- [x] 创建 Lore commit 并交付 `ready-for-integration`。
- [x] 父任务复跑 focused、full validate、feature browser 与 visual/a11y gates。
- [ ] Fast-forward main，更新 registry/任务状态并同步远端。
- [ ] 证明包含关系后清理本 worktree/branch；保留 open PR 分支和不明 WIP。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` | detached baseline；仅本任务 owned diff 与测试临时产物，提交前清理 |
| `git rev-parse HEAD` | `1e9f91d8fbb59482985877ed7a6122e2959bac47` |
| guidance/task-record/TDD reads | completed |
| `npm run test:route-corridor-ui` | 7/7 pass；独立 review 后 polar map-width 回归 5/5 pass |
| `npm run test:route-corridor-data` | 20/20 pass |
| `npm run test:crime-async` | 28/28 pass |
| `node --test scripts/tests/crime_ui_contracts.mjs` | 48/48 pass |
| fixed City Limits endpoint | HTTP 200; FeatureCollection; 1 Polygon |
| `npm run validate` | PASS；全部标准测试、manifest build、bundle policy |
| default bundle | Entry 893008/241051；Crime 39939/14058；route data 13237/4819；route UI 16359/6082；Task Focus 6729/3031 |
| feature-enabled bundle | Entry 893274/241123；Crime 40145/14150；route data 13237/4819；route UI 16359/6082；Task Focus 6729/3031 |
| `npm run test:browser-smoke` | PASS；显式加载、无预加载/无 route-open 请求、URL 不变、中英切换、console/page errors 0 |
| Playwright visual matrix（无 update 最终复验） | 35 pass / 10 configured skip；360/390/768/1440、200%、keyboard、reduced-motion、axe critical/serious=0 |
| visual baselines | 逐图复核后只更新 3 张 desktop Crime 图；无像素阈值变化；最终无 update PASS |
| product-truth/privacy static review | exact route 不进入 fetch/URL/storage/log/saved analysis；八状态分离；unavailable 不等于 0；误导词仅出现在明确否定说明 |
| 2026-08-09 parent focused gate | Route UI 7/7；Route data 20/20；Crime async 28/28；Crime UI 48/48 |
| 2026-08-09 parent `npm run validate` | PASS；标准测试、manifest 与 bundle policy exit 0 |
| 2026-08-09 feature bundle | Entry 893274/241129；Crime 40145/14150；Route data 13237/4819；Route UI 16383/6093 |
| 2026-08-09 browser smoke | PASS；console errors 0；page errors 0；4173 released |
| 2026-08-09 visual/a11y | 35 pass / 10 configured skip；baseline 未更新；4178 released |

## Open risks and remaining work

- City Limits 是 live 官方依赖；失败时仍回退到更保守的 single-police-district proof，因此部分正常路线会显示 coverage-unavailable，而不是错误给出 0。
- 市界附近路线会因 `buffer + 500m` 保守余量而拒绝；这是已验证的 fail-closed 取舍，不是全市所有路线均可用的承诺。
- shared conflict surface：`index.html`、Crime `index.js`/task focus、`workbench-shell.css`、bundle policy 与 3 张 desktop baseline；需由 integration owner 对当前 main 复核。
- 分支为 `codex/s3-c3-route-corridor-ui`；本任务不 merge/rebase/push，exact SHA 由最终 handoff 报告。
