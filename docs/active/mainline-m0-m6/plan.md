# Mainline M0-M6 Execution

## Goal

从干净 `main@cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7` 起步，在当前隔离工作树完成
主线 M0-M6 的可审查实现与本地验证；复用已集成的 Phase 2 P1-P6，只补真实缺口。当前任务
可以创建本地结构化 commits，但远端 main 整合、push、release、deploy、规则/权限变更和工作树
清理由总协调对话保留。

## Scope

- M0：将公开叙事升级为 Philadelphia Urban Evidence Lab，提供架构、数据流、模型晋级图和
  远端治理 mutation plan，但不执行远端 mutation。
- M1：补齐 provider-neutral、content-hash-bound 的 ArtifactRegistry/restore 运营闭环与灾备
  receipt；无真实外部观察时严格保留 `unavailable`。
- M2：定义 `UncertaintyFootprintArtifact/v1`，实现 identity-bound fractional/kernel aggregate
  attribution 与 tract/grid 对照；不改写 canonical event。
- M3：在读取最终 test-fold 结果前冻结 Evaluation Protocol v3；保留 v2 bytes 和历史关系。
- M4：定义并准入 reported incidents、311、L&I/vacancy 三源 aggregate，身份、lineage、coverage
  任一不确定即 `unavailable`；私人地址只作为瞬时定位输入。
- M5：分层定义 raw crash、centerline/corridor match、accessibility、walking legality、人工校准和
  sensitivity evidence；不合并为 safety score，不继承 routing authority。
- M6：只实现机器可读 R7 go/no-go gate/report；当前证据不足时输出 `NO-GO/UNAVAILABLE`，
  不生成路线 alternatives。
- 不修改 `ml/**`、`docs/active/python-ml-benchmark/**`、`.github/workflows/ml-ci.yml`，也不修改
  其他 worktree 或默认检出的未归属 WIP。

## Sources of truth

- 当前用户委派、根 `AGENTS.md` 与 `docs/AGENTS.md`。
- `docs/active/_worktree_registry.md` 的 current effective registry。
- 当前仓库代码、contracts、fixtures 和 tests；`docs/TODO.md` 不是自动命令队列。
- Phase 2 集成与发布基线 `cfb0af1…`；旧 ignored/local evidence 只作历史线索，必须与当前可读
  identity/receipt 区分。

## Stages

- [x] M0-M6 基线、规则、边界和现有资产审计启动。
- [x] M0 Portfolio v2 与远端 mutation plan。
- [x] M1 R1 运营闭环增量。
- [x] M2 Spatial Attribution 完整比较。
- [x] M3 Evaluation Protocol v3 冻结。
- [x] M4 Home Compare 三源 aggregate。
- [x] M5 Known Route 真实证据分层合同。
- [x] M6 R7 go/no-go gate/report。
- [x] 聚焦验证与完整共享验证。
- [x] 分阶段 commits 与最终交接。

## Acceptance criteria

- 现有 P1-P6 不被平行重写；每个新增合同复用项目的严格 schema、identity、lineage、coverage 和
  `unavailable/partial/ambiguous/unmapped` 语义。
- `sample/local/synthetic/unavailable` 不被描述为 `production/live/complete/zero`。
- 3,586,620 records 与约 10.81 GB bundle 只按已有 exact receipt 的限定语境陈述。
- weighted attribution 的每条记录权重非负且总和为 1；weighted 结果只进入 aggregate report。
- Protocol v3 在 test-fold 结果前冻结，候选资格不等于 promotion；v2 不改写。
- Known Route 的 incidents/crash、source/route/corridor/centerline/catalog/producer identity 分离；
  walking legality 以外的 mode 无权威数据时 `unavailable`。
- R7 gate 的任何硬门槛不足都机械地产生 `NO-GO/UNAVAILABLE`，并证明无 alternative/safest/
  combined-safety-score 输出面。
- 每阶段使用最窄充分测试；长/共享进程只有一个 owner，并记录命令、结果、耗时和未运行项。

## Non-goals

- M7/R7 Adaptive Route Alternatives、safest route、combined safety score 或 routing authority。
- 真实云对象存储上传、第二物理机器、scheduled run、生产数据发布、模型 promotion、远端 CI/Pages。
- push、merge main、deploy、tag/release、PR/branch/worktree 清理、GitHub ruleset/权限/secret mutation。

## Risks and constraints

- 当前仓库已含大量历史 route-decision 与 Data Foundation 代码；名称相近不代表属于本轮目标。
- bundle 体积接近既有 ceiling；M0 优先静态文档/首页内容，不扩大 runtime dependency。
- 持久 `.dfev1` evidence 位于其他受保护 worktree；本轮不写入、不移动、不清理。
- v3 与附属 `ml/**` 可能存在未来语义依赖，但本轮只能定义 mainline protocol/validation seam。
