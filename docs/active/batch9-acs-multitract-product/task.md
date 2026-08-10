# Task

## Current status

`ready-for-integration` — 产品代码、目标契约、dependency/non-browser 与 focused browser 验证均已完成；所有授权 slot 已释放，等待 integration owner 合并共享 catalog/policy/schema 接线。

## Checklist

- [x] 核对 exact baseline、Git 权限边界与并行 worktree 所有权。
- [x] 读取适用 AGENTS 指令、manage-task-records skill 与模板。
- [x] 核对 Census 官方 VRE 方法、snapshot provenance/schema 与 repo 数学实现。
- [x] 设计并测试 selection/review/calculate 状态机及所有 fail-closed 路径。
- [x] 实现二级 lazy 产品入口、table-first UI、无地图路径和 scoped CSS。
- [x] 实现 feature-owned Source Health observation 与 Evidence contribution seam。
- [x] 验证静态 a11y 标记、英文/中文文案、module graph 与 source-artifact 预算边界。
- [x] 请求并运行必要共享 live-test gates，或明确记录未运行缺口。
- [x] 更新最终路径交集、进程检查和 integration handoff。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` / `main` | 均为 `db41214ad5a428fc0cf0fe369f257f7470196cbe` |
| `git status --short --branch` | Detached HEAD，启动时无本任务改动 |
| Census 2024 VRE/geography 官方页面 | VRE 用于跨 geography/table collapsing 的 MOE；summary level 140 tract 为 2020 Census vintage |
| `npm run test:acs-aggregation` / direct target | 最终短复跑 19/19 pass；显式 Review 前 source load=0，未 Review 时 Calculate=null，pending selection 可 supersede |
| Target ESLint / Stylelint | 最终 owned JS 与 ACS CSS 均 exit 0 |
| `npm run build:manifest` | 最终候选 exit 0，238 modules；确认 main -> loader -> controller/facade 二级 lazy |
| `npm run verify:bundle` | exit 1：shared policy exact set 尚未准入第 12 个 direct-lazy loader；本线按所有权未修改 policy |
| Bundle metrics（最终 P9 候选，raw/default gzip） | Entry 123100/39195；loader 788/473；controller 20965/7419；CSS 3029/903；VRE 181959/71672；all-dist 4118473 bytes |
| Focused Playwright | 最终 exit 0；Review 前 VRE request=0、Review 后=1、Calculate 复用；exact GEOID/vintage、estimate/SE/MOE、中英、键盘、Escape/focus return、无地图、390px 单列/0 overflow、console/page errors=0 |
| `git diff --check` | exit 0，仅工作树 LF->CRLF 提示 |
| Final process/port scan | strict 4189 listener=0；P9 scoped node/npm/playwright=0；forbidden changed paths=0 |

## Open risks and remaining work

- 公共 visual baseline、shared browser smoke、dev/full validate/full release/coverage 未运行；focused browser 已覆盖本 feature 的真实 dialog/focus/窄屏行为，但不能替代整合候选的共享回归门禁。
- Shared `bundle_policy.mjs` 必须由 integration owner 准入第 12 个 loader，并按“透明 source-artifact 分区”记录门限；不得隐式排除 VRE 或放宽现有 executable 4,000,000 门。
- `acs-tract-population-vre` 还没有中央 catalog 条目；integration owner 需新增 catalog contract 后再注入 P0 `registeredSourceHealthObservations`，否则不能把 observation 接入 read model。
- `package.json`、`src/i18n/messages.js`、中央 Source Health assembler 和 Evidence Bundle v2 核心不在本线所有权内。
- P8/P9 与 P9/P10 的 exact changed-path 交集均为 0；P8 将消费 Evidence contribution shape，属于契约接线而非同路径合并。
