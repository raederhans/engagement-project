# Data Foundation and External Validity v1

## Goal

串行推进 Data Foundation and External Validity v1。Milestone 0 已在本地候选
`c027266d40409bac24b85891260a4cad37890333` 交付，但尚未集成、推送或上线；
当前只执行 Milestone 1：建立可重建、事件级、revision-aware 的 Philadelphia
reported crime warehouse、可复用空间映射、ACS estimate/MOE enrichment、lineage
与机器可检查的数据质量报告。Milestone 2 继续 deferred。

用户对 M0 和当前 M1 的委派原文是范围与验收权威；本文件只保存可恢复的执行
基线，不把本地候选扩大成 main、remote、runtime、部署或科学有效性事实。

## Scope

- 保持 M0 snapshot/full receipt/runtime projection 的同 transaction、四时钟、
  claim vocabulary、generated receipt/projection 与 15,000-byte Source Health ceiling。
- 从官方可验证来源建立事件级 reported crime ingest，支持可获得的 2006 年至当前
  backfill、checkpoint/resume 和带重叠回看的 incremental refresh。
- 保留稳定 source identifier、原始/规范化类别、事件时间、generalized location、
  坐标/精度声明、source vintage、first/last seen 与 row hash；检测新增、修改/
  重分类、late arrival、unchanged 和消失/删除候选，不假设 append-only。
- 建立版本化 offense crosswalk；未知 label fail closed，不静默归类。
- 建立 tract、固定 grid/hex 和 route-corridor 可复用映射；hundred-block location 与
  点坐标都保留上游精度限制，不推断精确 sidewalk/street-segment。
- 接入 geography/vintage 一致的 ACS estimate 与 MOE；二者保持不同字段和语义。
- 为每个模型输入保存 source snapshot/manifest lineage，并输出 schema drift、count、
  坐标、label、join coverage、freshness 与 revision lifecycle 的机器可检查 DQ 报告。
- 只提交代码、schema、registry/crosswalk、安全 synthetic fixtures 与小型 manifests/
  reports/artifact contracts；raw/canonical 大文件和潜在敏感事件数据留在 ignored 目录。

## Sources of truth

- 当前用户委派的 M1 目标、实现边界、验收和最终交付格式，以及此前 M0 委派。
- Exact starting candidate `c027266d40409bac24b85891260a4cad37890333`
  的代码、测试、workflow 和数据产物；`f300cfe` 是其本地 `origin/main` 基线，
  `c9955d2` 与 `c027266d` 是未集成/未推送的 M0 本地提交。
- `docs/AGENTS.md` 与 `manage-task-records` 约束。
- 当前数据脚本、source contracts、source/serving adapters、route-corridor contracts、
  ACS aggregation contracts 与项目标准入口。
- 当前官方 Philadelphia/OpenDataPhilly、City terms 与 Census API/geography/ACS
  文档和 API 响应；页面/API 可达性本身不证明 current、complete 或 authority。
- 现有 HIN lifecycle pair 是代码库内的可复用模式证据，不赋予 tract artifact
  任何 HIN review、authority 或 freshness 结论。

## Stages

- [x] Stage 0A: 建立 Git/base/worktree、规则、相关记录和聚焦测试基线。
- [x] Stage 0B: 在临时目录复现月份边界后的 snapshot/receipt 漂移。
- [x] Stage 0C: 锁定 M0 regression contracts，并实现最窄的生成/验证/成对发布闭环。
- [x] Stage 0D: 扩展 machine-readable source registry 和 Source Health receipt 消费。
- [x] Stage 0E: 运行聚焦/标准验证、审查相对 base diff、创建本地小 commits 并收口记录。
- [x] Stage 1A: 核验 exact base、现有契约和当前第一方来源，冻结 M1 schema、
  source registry、crosswalk 与 ignored artifact boundaries。
- [x] Stage 1B: 实现可恢复 source snapshot acquisition、revision-aware canonical store、
  overlap incremental ingest 与 lifecycle classification。
- [x] Stage 1C: 实现 tract、fixed grid/hex、route-corridor fail-closed mapping 和 ACS
  estimate/MOE enrichment。
- [x] Stage 1D: 实现 lineage manifests、机器可检查 DQ report 与 serving artifact contract。
- [x] Stage 1E: 用 synthetic revision fixtures、官方 bounded smoke、聚焦/标准 gate 验证，
  审查 diff 后创建本地 Lore commits 并收口记录。
- [ ] Milestone 2: deferred；不得在 M1 中开始模型训练、预测 UI 或 route recommendation。

## Milestone 0 acceptance baseline (must not regress)

- Snapshot、完整 receipt 和 runtime receipt projection 均由同一候选生成并验证，
  随后才替换正式 lifecycle。
- 替换任一步骤失败都恢复原正式 snapshot/receipt/projection；不留下新旧混合
  lifecycle 或临时文件。
- 月份窗口变化自动更新 receipt 的 sourceAsOf、coverage、identity 与 record count。
- 连续两次相同语义输入保留既有正式 bytes/mtime，不产生只有 retrieval/build
  时钟变化的无意义 diff。
- `sourceAsOf`、`retrievedAt`、`builtAt`、`observedAt` 保持不同含义；未知旧时钟为
  `null`，不从相邻时钟推断。
- `unavailable`、`unknown`、`partial`、`stale` 不变成 `zero` 或 `current`。
- Source registry 可由机器解析，并准确表达上游条款、build-time retrieval、
  derived historical aggregate、freshness policy 和 fail-closed 行为。
- 聚焦测试、脚本/JSON/YAML 解析和相关数据契约通过；若改动进入标准入口，
  `npm run validate` 也必须通过或明确记录无法运行的 gate。

## Milestone 1 acceptance criteria

- 干净环境可按文档命令初始化/恢复 ingest；相同 source vintage 重复运行幂等。
- 受控 synthetic revisions 稳定证明 added、modified/reclassified、late-arriving、
  removal candidate 与 unchanged，且 `first_seen_at`、`last_seen_at`、`row_hash` 正确。
- Canonical event schema 和 crosswalk 版本化；schema drift 与 unknown offense label
  fail closed 并出现在 DQ 报告，不制造 production mock 或隐式类别。
- Tract、fixed grid/hex、route-corridor 映射及无法可靠映射状态可复用、可测试；
  generalized location 不被提升为精确街段/sidewalk 事实。
- ACS estimate/MOE 按 geography/vintage 配对并保持不同语义；不丢弃或互换 MOE。
- 每个模型输入可追溯至 source snapshot/manifest；DQ 报告区分
  `unavailable/partial/stale/zero`，并覆盖 freshness、revision、coverage 和异常。
- 至少一次官方 bounded smoke 真实运行并记录 source vintage、row count、schema、
  时间/坐标覆盖与 DQ 摘要；未安全完成全量时明确 blocked gate，不声称已完整回填。
- 聚焦测试、数据契约、lint/static checks 和标准入口通过；若进入标准入口，
  `npm run validate` 必须 fresh exit 0 或明确记录真实阻塞。

## Non-goals

- M2 模型训练、预测 UI、Home Compare、route recommendation 或 route runtime/public 接线。
- 提高 bundle ceiling、引入依赖、增加 mock production data、改变外部数据 authority。
- 在未确认官方来源、许可、存储/空间预算与 checkpoint 恢复前执行真实全量 backfill。
- Push、PR、merge/rebase/cherry-pick、main 更新、其他 worktree 或拓扑操作、部署。
- Absolute safety、victim probability、safest route、实时危险或产品上线声明。

## Risks and constraints

- 跨两个文件的替换必须在失败时回滚；单文件 atomic rename 不足以证明 pair 完整。
- 当前 legacy snapshot 没有独立 retrieval clock；初始 receipt 必须保留 `null`。
- Artifact digest 只用于 receipt 对 exact snapshot bytes 的 identity 契约，不能替代
  snapshot/receipt 行为验证、freshness 或 authority。
- 当前 worktree 是 detached HEAD；只允许本 worktree 的本地 commits，不得改 refs、
  push 或整合。
- 其他 worktree 有 route/source-health 热点；最终必须报告路径重叠，但不读取或修改
  其未归属产物。
- 上游 schema、label、历史范围、API、license/terms 与更新时间都可能变化；所有
  结论绑定 source snapshot/vintage，HTTP 可达性不升级数据状态。
- 上游犯罪点与 hundred-block 文本是 generalized evidence；空间映射必须显式记录
  方法、coverage 和 unavailable/ambiguous 状态。
- 全量事件 backfill 可能长耗时和占用显著磁盘；启动前必须按
  `orchestrate-live-tests` 记录唯一 owner、ignored output/checkpoint/log 和停止恢复方式。
