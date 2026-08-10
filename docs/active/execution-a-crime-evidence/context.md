# Context

## Current truth

- 2026-08-10 开始时：`HEAD`、`main`、`origin/main` 均为 `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`，无规划基线漂移。
- 当前 worktree：`C:\Users\raede\.codex\worktrees\1b4f\engagement_project`，detached HEAD，初始 `git status --short` 为空。
- Execution A 不是 integration owner；禁止 add/commit/push、branch/ref 变更、merge/rebase/cherry-pick、worktree 清理和远端修改。
- `node_modules` 初始缺失；用户已授予本线首个 dependency/install 槽。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | 采用用户指定的 A1 → A2 顺序，并以两个可独立回滚批次维护 diff/验证证据。 | A1 targeted suites 通过前不进入 A2 production code。 |
| 2026-08-10 | 多 worktree 存在，但本线只做只读 ownership/交集核对。 | 整合、提交、注册表同步和清理由主监督完成。 |
| 2026-08-10 | route-corridor 仅作为 unavailable/zero 原则证据，不从旧 Crime 模块导入。 | 防止反向依赖与并行执行线耦合。 |
| 2026-08-10 | A1 以 `admitCrimeResponse(kind, payload)` 按 points/monthly/top/heat/district/count/codes 分流；coverage 独立 admission。 | 缺 rows、非法维度和 NaN count 抛错；空 group-by rows 与 count=0 保留。 |
| 2026-08-10 | tract snapshot 先验证所有 row/count，再浅复制 collection/feature/properties 写派生字段。 | malformed snapshot 为 unavailable；geometry 引用保留且共享缓存不被污染。 |
| 2026-08-10 | 新增 Crime 专用 `formatCrimeIncidentDate`，只在 incident results 接线。 | Philadelphia 跨日正确；通用/分析历史 formatter 不变。 |
| 2026-08-10 | Evidence Bundle composer 与 sanitizing bridge 同置于 `src/analysis/evidence_bundle.js`，由按钮点击动态 import。 | flag 关闭时不静态加载实验 composer/bridge；旧 JSON/CSV 模块只增加一个轻量 flag helper。 |
| 2026-08-10 | canonical query/result/provenance 采用 sorted-key JSON 与浏览器原生 Web Crypto SHA-256；`generatedAt`/`retrievedAt`/`exportedAt` 从 section hash 排除。 | 导出时刻不改变三个 section checksum；snapshot identity 由三个 checksum 稳定派生。 |
| 2026-08-10 | generic sensitive-key denylist 与 bridge 的 aggregate-only 输出共同防守；空字符串/NaN aggregate count 不做数值强转。 | raw rows、地址/坐标、GPS、Diary notes/route geometry、311 media URL 等 fail closed，malformed 不会变成零。 |
| 2026-08-10 | 最终审查发现 chart stub 路径仍可把非法 count 经 `|| 0` 吞掉，改为复用 `admitCrimeResponse`。 | 默认 fetcher 与测试/替代 fetcher 走相同 admission；合法空 rows 与 admitted zero 保留。 |
| 2026-08-10 | 主监督首次 ready-for-integration 审查发现 export time 被伪作 source retrieval time。 | A 退回 `in-progress`；改用匹配 comparison snapshot 的 `generatedAt`，无证据时导出 `retrievedAt: null`。 |
| 2026-08-10 | 主监督证明 v1 仅靠敏感字段名 denylist 可被 `description/data/memo/polyline/link` 等未知键绕过。 | v1 改为 exact allowed-key schema，denylist 保留为第二层；真实 builder shape 成为 canonical hash fixture。 |
| 2026-08-10 | flag 开启后动态第 4 按钮会独占下一行第一列。 | 不改 B 的 CSS；A 在动态按钮上设置 `grid-column: 1 / -1` 并增加结构断言。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| dependency install (`npm ci`) | Execution A | `.tmp/execution-a/npm-ci.log` | complete; exit 0 |
| dependency/install + non-browser quality slot | Execution C | supervisor-owned log/coordination | handed off after A install; Execution A must not install again |
| dev server/browser/visual/full validate | 主监督待指定 | none | not started; prohibited in current instruction |
| review-repair short targeted tests | Execution A | `.tmp/execution-a/review-repair-*.log` | complete and released; final scoped node/npm count 0 |

## Handoff

主监督随后确认 B 已释放槽且 scoped node/npm=0；A 成为本线短测试唯一 owner，使用现有 `node_modules` 串行完成 4 条授权 GREEN。最终 refs/diff/intersection/process 证据已完成，当前为 `ready-for-integration`。

2026-08-10 监督补充：Execution A 可复用现有 `node_modules` 跑短、资源隔离 targeted tests；不得再次执行 npm install/npm ci、bundle/checkpoint builder、browser smoke、visual 或完整 validate，除非另行授权。

## Integration intersections

- Execution C worktree `d1e0`：与 A 无文件交集。
- Execution B worktree `f614`：与 A 有两个交集：`src/i18n/messages.js`、`scripts/tests/product_integrity_contracts.mjs`。
  - `messages.js`：B 修改 Diary 文案，A 仅新增 `crime.exportEvidenceBundle`；整合时保留两者。
  - `product_integrity_contracts.mjs`：B 新增 Diary truth test/import，A 新增 Evidence Bundle 与 tract regression；整合时保留两组测试/import。
- 其他 detached worktree 与 A 无文件交集；主 worktree 的 128 项既有 WIP 与 A 也无路径交集。

## Next step

由主监督整合 B 的两个加法型交集，随后由指定 live-test owner 执行尚未授权的 bundle/build/browser/完整验证；A 不再占用短测试槽。
