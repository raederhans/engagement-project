# Plan

## Goal

在 Crime workspace 中交付一个 second-level lazy、显式触发、仅处理用户已知路线的历史 reported-record corridor UI；先用固定虚构 Philadelphia 路线证明现有空间准入是否足够，再按证据决定正式能力或明确 prototype 限制。

## Scope

- C3-0 固定虚构路线 spatial/coverage admission matrix。
- GeoJSON LineString 文件与现有地图显式绘制输入、整数米 buffer、canonical 历史时间与 offense filters 快照。
- 八种互斥 UI 状态、可访问文本摘要/列表、地图 route/buffer/points 同步。
- lazy import failure/retry、请求取消/取代、I2 端口异常合同、隐私与产品真相不变量。
- bundle/manifest、完整验证、feature-enabled browser/visual/a11y 证据与独立复核。

## Sources of truth

- 当前代码库 `main@1e9f91d8` 的 Crime、route corridor、task focus、query preset、map、incident presenter、i18n、CSS、测试和 bundle contract。
- `docs/active/ui-role-experience-audit/` 的当前 Stage 3 边界。
- `docs/archive/s3-c1-route-corridor-history/` 与 `docs/archive/s3-c2-route-corridor-data/` 的历史决策；与当前代码冲突时以当前代码为准。
- 用户本次 S3-C3 完整执行计划与验收门槛。

## Stages

- [x] C3-0：建立可信虚构路线 fixture 与可审计 admission matrix，验证 single-district proof、2,000 candidate limit、100 km bbox limit 与失败状态。
- [x] C3-1：基于 C3-0 证据冻结正式/prototype 产品准入与最小架构。
- [x] C3-2：TDD 实现显式入口、输入、second-level lazy controller、八状态、取消/重试与 canonical snapshot。
- [x] C3-3：复用 incident presenter 语义与地图能力，补齐文本/地图等价、隐私/产品真相、响应式/i18n/a11y。
- [x] C3-4：运行 bundle/manifest、完整 validate、browser smoke、visual matrix 与独立复核。
- [x] C3-5：精确提交快照复验，创建 Lore commit，交付 ready-for-integration。
- [x] C3-6：由 integration owner 完成 main 快进、依赖/视觉远端门修复、双端同步、任务归档和安全分支/worktree 清理。

## Integration outcome

- Product/admission commits `d15c425` and `16cb8ce` were fast-forwarded to
  `main`; lockfile security repair `fc999cc` and Linux visual baseline repair
  `74d68a5` closed the newly observed remote gates.
- Exact `74d68a5` passed Ubuntu/Windows CI `31310028016` and Pages
  `31310027990` before cleanup began.
- The C3 Git worktree and contained local branch were removed from Git topology.
  The recovery ledger in `context.md` records every deleted local/remote ref;
  all open QoL and Dependabot pull-request heads were retained.

## Acceptance criteria

- 用户显式点击前不 import C3 UI、不读文件、不绘图、不改 query/URL/map/saved state、不发 route request。
- focus 切换只改变展示；preset 仍是 preview/confirm；route corridor 是独立显式空间请求。
- exact route、buffer、fingerprint、候选与匹配结果只在浏览器内存；远端只见 coarse bbox、canonical 日期与 offense filters。
- `route-required`、`route-invalid`、`pending`、`coverage-unavailable`、`source-failure`、`superseded`、`no-mapped-incidents`、`ready` 分别呈现；只有 no-mapped-incidents 可表达零匹配。
- 地图不是唯一载体；文本摘要和键盘列表包含 coverage、unmapped、generalization、reported/non-unique、historical/not-live、near-route-not-on-route、spatial proof、coarse disclosure 与不持久化说明。
- 无安全路线、风险分数、排名、实时/预测性含义；不把 unavailable 当零。
- 360/390/768/1440、200% zoom、中英文、键盘、ARIA live、reduced-motion 与水平溢出门槛通过。
- Entry ceiling 不提高；C3 UI 有独立 chunk/manifest contract 与实测预算。

## Non-goals

- 原始 GPS、map matching、routing provider、A-to-B 自动路线、定位权限、后台位置。
- route persistence、URL/hash/history/storage/IndexedDB/cookie/cache/service worker、Saved Analysis、账户同步、分享、telemetry 或 A/B collector。
- Diary 作为真实 route source、永久 commuter persona、新依赖、第二套数据/URL/refresh owner。
- merge/rebase/push/deploy、修改主工作树 registry 或清理无关 WIP。

## Risks and constraints

- 现有 single-district proof 可能拒绝常见跨区路线；C3-0 证据不足时只能明确 prototype，不能宣称通用能力。
- 2,000 候选与 100 km bbox 为 fail-closed 安全边界，不以 UI 便利为由放宽。
- Entry/Crime/shared UI 文件存在集成冲突与 bundle 风险；优先复用、迁移到独立 lazy chunk，并实测 admission。
- 历史 bundle 数字只作参考，当前 worktree 必须重新测量。
