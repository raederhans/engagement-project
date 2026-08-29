# Phase 2 P1-P6 Plan

## Goal

在 `codex/dfev1-data-foundation-persistent@122bba909cc251b91dc3a2388e2f06765ecfe927`
之上，串行完成用户所指规划对话最新主线的 P1-P6：

1. P1 可移植 DataOps 与版本化证据仓库；
2. P2 Spatial Attribution v2；
3. P3 Area Intelligence Evaluation Protocol v2；
4. P4 Area Intelligence 产品化；
5. P5 Home Compare 真实城市数据；
6. P6 Known Route crash、accessibility 与 route-legality 证据。

## Scope

- 复用已完成的 DFEV1 M1-M6 本地候选与持久 ignored evidence，不复制平行实现。
- 每个 P 严格串行：先冻结输入、实现、聚焦验证和状态语义，再进入下一 P。
- 每个 P 最多创建 3 个新的用户可见 Codex 任务；内部子代理不计入该上限，但也只用于明确独立工作面。
- P3-P6 后续新建的用户可见任务必须显式使用不高于 `high` 的推理等级；不为变更等级而重建已在运行的 P2 任务。
- 主任务是唯一 integration owner；其他任务不得整合、推送、清理或改写共享 Git 历史。
- 本地实现、公开数据读取、可恢复构建、测试和本地提交在范围内。
- Push、PR、远端 CI、部署、对象存储上传、凭据或权限变更、公开社区写入不在本轮默认授权内。

## Sources of truth

- 用户引用的 ChatGPT 对话 `engagement项目拓展与方向规划`，最新回答中的 R1-R6；本记录将其编号冻结为 P1-P6。
- 当前仓库、`docs/AGENTS.md`、既有 `docs/active/data-foundation-m1-m6-execution/` 记录和 executable contracts。
- 当前 exact base `122bba909cc251b91dc3a2388e2f06765ecfe927`；旧 SHA、路径和历史报告只作线索，声明必须重新绑定当前证据。
- 官方 Philadelphia、Census、SEPTA、OSM/Overture 等来源及其可核验 license、freshness 和 source identity。

## Stages

- [x] P1: 为 raw snapshot、canonical warehouse、mart 和 evaluation receipt 建立 provider-neutral registry、下载/校验/恢复流程、retention state、轻重 CI 分层与 clean-room reconstruction 证据；scheduled flow 不自动 promotion。
- [x] P2: 对 ambiguous/unmapped 事件按年份、类别、警区、道路/边界与人口特征分层，比较 tract fail-closed、fixed-grid、fractional attribution 与 kernel attribution；事件层继续保留未分配事实。
- [x] P3: 在读取新表现前冻结 v2 身份，正式纳入 eligible simple models、数值稳定性、interval calibration、slice gates 和审计边界；允许诚实 no-promotion。
- [ ] P4: 围绕一次 Area Intelligence 用户任务交付历史证据、分析几何、source-as-of、precision、excluded-event policy 和 Why unavailable；forecast 只在 promotion gate 通过时出现。
- [ ] P5: 为 OPA、assessment、transfer、311、L&I、vacancy、crash/HIN 建立 citywide snapshot/admission/DQ lifecycle；住房地址和目的地不进入 share state，routing 无 authority 时保持 unavailable。
- [ ] P6: 为 Known Route 补齐 crash warehouse、accessibility evidence、分交通方式 legality、map-matching 质量、corridor/generalization sensitivity 与稳定 segment contribution；不生成 safest-route 或单一 winner。

## Acceptance criteria

- P1：无原 worktree 的干净 checkout 能从 manifest 与显式授权的 artifact location 恢复、校验同一 M1/M2 输入身份；若外部存储未授权，必须把本地 clean-room PASS 与跨机器发布缺口分开。
- P2：报告覆盖全部 ambiguous/unmapped denominator，方法身份可复跑；fixed-grid/tract/派生 attribution 的差异有定量证据，未分配不变成零或确定 tract。
- P3：协议字节和输入 lineage 在运行前冻结；所有 primary slices、收敛/最大预测/coverage gates 可执行；结果不因总体指标而绕过失败切片。
- P4：英语/中文、桌面/移动端均能完成历史证据任务；unavailable 有原因，历史计数、模型计数和个人受害概率边界可见；无私人值进入 URL/storage/network/share。
- P5：每个来源都有独立 identity、freshness、coverage、DQ receipt 与 partial/unavailable 状态；比较维度不压缩成不可解释 safety score。
- P6：同 route/data version 结果确定；generalized event 不伪装成精确 street fact；crash/accessibility/legality 缺失时 fail closed；segment contribution 与 sensitivity 可解释。
- 每阶段运行最窄充分 gate；最终再运行按共享契约风险扩大的本地验证。远端、发布、scientific promotion 和产品 authority 分开陈述。

## Non-goals

- 不在 P1-P6 中执行 R0 远端 Phase 1 合并/部署或 R7 Adaptive Route Alternatives。
- 不引入单一 safety score、个人受害概率、实时保障、因果结论或 `safest route`。
- 不上传 9+ GiB 数据、不启用云存储/社区写入、不改变凭据/权限，除非用户另行明确授权。
- 不删除或清理现有 worktree、logs、output、ignored evidence、数据库、截图或用户 WIP。

## Risks and constraints

- 本地 `main@9d93df2` 与持久 DFEV1 候选 `122bba9` 均未合入 `origin/main@f300cfe`；本阶段基于本地候选，不能称为远端或生产完成。
- M1/M2/M4/M5 的重型证据是本地 ignored data；任何恢复或分析前必须重验 exact receipt、part inventory 和 lineage。
- P1 的真正跨机器对象存储、P5/P6 的部分 citywide 数据或 redistribution 可能需要外部存储、许可或凭据授权；未获授权时不得把本地证据冒充发布闭环。
- 长数据流程和浏览器/构建共享资源必须有唯一 owner、日志和可恢复 checkpoint。
