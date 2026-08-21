# Data Foundation and External Validity v1

## Goal

串行推进 Data Foundation and External Validity v1。Milestone 0 与 Milestone 1 已累积在
本地候选 `a86b4fb02d3c06c3a7904b1674f3eae1b16a5929`，但尚未集成、推送或上线；
当前只执行 Milestone 2：建立 tract-week 与 fixed-grid-week Area Intelligence marts，
冻结并运行外部有效性协议，比较 seasonal naive、4/13-week moving average、Poisson
与 negative-binomial baselines，并以 fail-closed serving contract 最小接线历史趋势和
promotion/no-promotion 状态。

用户对 M0、M1 和当前 M2 的委派原文是范围与验收权威；本文件只保存可恢复的执行
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
- 从获授权的 exact M1 local candidate 流式构建 sparse weekly marts；tract ambiguous/
  unmapped 与 grid unavailable 行保持排除，禁止空间强制分配。
- 在模型表现可见前冻结时间 folds、spatial block holdout、类别/数据量切片、指标和
  promotion gate；目标只表达空间单元周度 PPD reported incident count。
- 比较 seasonal naive、4/13-week moving average、Poisson 与 negative-binomial
  baselines，输出 prediction interval、deviance、coverage、相对增益和残差审计。
- ACS E/M 只在 temporal-compatible 时进入背景/误差审计；race、income、poverty
  当前无 admitted 数据时保持 unavailable，且任何人口变量都不进入 safety ranking。
- 产品历史趋势不依赖模型 promotion；forecast 仅在预定义 gate 通过且 serving
  contract 完整时显示，no-promotion/invalid contract 明确显示 unavailable。

## Sources of truth

- 当前用户委派的 M2 目标、实现边界、验收和最终交付格式，以及此前 M0/M1 委派。
- Exact starting candidate `a86b4fb02d3c06c3a7904b1674f3eae1b16a5929`
  的代码、测试、workflow 和 M0/M1 local candidate records；本地 `origin/main`
  未 fetch，且 M0/M1 均未集成、未推送、未部署。
- 获授权的只读 M1 data root
  `C:/Users/raede/.codex/worktrees/c180/engagement_project/.dfev1/crime/full-2026-08-21-v2`
  及其 exact warehouse manifest、backfill checkpoint、lineage registry 和 64 canonical
  partitions；它不是 product runtime 或持续更新 source。
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
- [x] Stage 2A: 核验 exact Git/上游身份与现有契约，原地激活 M2，并在查看表现前冻结
  评估协议、admission、lineage、ignored output 和 promotion/no-promotion contract。
- [x] Stage 2B: 实现可恢复、语义幂等的 tract-week 与 fixed-grid-week streaming marts。
- [x] Stage 2C: 实现 seasonal naive、4/13-week moving average、Poisson/NB baselines，
  rolling temporal folds、spatial block holdout、interval 与残差/切片审计。
- [x] Stage 2D: 输出机器可检查 ModelEvaluationReport、model card、lineage summary、
  residual map、bias/error audit 与 fail-closed serving artifact。
- [x] Stage 2E: 完成最小 Area Intelligence UI 接线与 promoted/no-promotion contract tests。
- [x] Stage 2F: 在完整 M1 warehouse 上运行 mart/backtest、幂等复跑、聚焦/标准/browser
  gates，审查隐私与 diff 后创建本地 Lore commits 并收口记录。

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

## Milestone 2 acceptance criteria

- 上游 gate 必须绑定 exact M1 manifest/checkpoint/lineage identity、21/21 scopes、
  3,583,548 active rows 和 64 partitions；任一不匹配都在 mart/training 前 fail closed。
- mart build 流式读取 canonical JSONL，以任务专属 ignored staging/checkpoint/output
  恢复；同输入复跑保留已发布 mart/manifest bytes 与 mtimes。
- tract 只接纳 `mapped`，grid 只接纳 `mapped`；549,594 ambiguous tract rows 与所有
  unavailable/unmapped 行只进入 exclusion audit，绝不进入相应 unit count。
- 评估协议在表现可见前冻结；每个 baseline 使用相同 rolling folds、spatial block
  holdout、类别/数据量切片与 target week，且所有 feature 都只读取 prediction origin
  之前的数据。
- 报告至少包含 MAE、Poisson/NB deviance、90% prediction interval coverage、相对
  seasonal naive 增益、类别/空间/数据量错误、残差空间分布和 over/under-estimation。
- promotion 只在预定义的多个时间窗口与 spatial holdout 都稳定超过 seasonal naive、
  interval coverage 合格且数值诊断有限时成立；否则产出 honest no-promotion。
- 所有 prediction 带 interval、trained-through、model version、generated-at、source
  vintage 和限制；禁止 safety score、victim probability、safest area/route。
- 真实完整 M1 warehouse 的 mart/backtest、聚焦 tests、标准 `npm run validate`、bundle
  gate 与必要 browser smoke 有 fresh evidence；无法运行的 gate 明确列为缺口。

## Non-goals

- Home Compare、route recommendation、route runtime/public 接线、单一 safety score，
  或超出最小 Area Intelligence status/forecast card 的 UI 重写。
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
- M2 只读上游位于另一个 worktree；任何写入、mtime 变化或 identity drift 都是训练前
  阻塞，不得自动修复或从缩小样本继续。
- 统计 baseline 与本地回测只能支持 bounded historical modeling evidence；它们不证明
  因果、个人风险、未来稳定性、科学有效性、产品决策质量或部署状态。
