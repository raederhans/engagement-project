# Data Foundation and External Validity v1

## Goal

完成串行 Milestone 0：恢复 tract crime snapshot 与其 Source Health receipt
的同闭环可信度，使机器生成、验证和发布的 snapshot/receipt 不再因月份窗口、
artifact identity 或 record count 的手工维护而漂移。

用户委派原文是本记录的范围与验收权威；本文件只保存可恢复的执行基线，
不扩大或改写 M0。

## Scope

- 复现当前 tract refresh / bundled receipt 漂移，只修复仍可复现的共同根因。
- 在现有刷新工具上实现临时 snapshot 生成、snapshot 验证、receipt 生成、
  receipt 验证和成对替换；任何失败保留原正式 pair。
- 复用并扩展现有 machine-readable tract source contract，记录 source、
  license/terms、retrieval/build semantics、freshness policy 与 fail-closed 状态。
- 让 Source Health 从生成的 receipt 消费窗口、identity、record count 与四时钟，
  不再手工复制这些字段。
- 只修改与 M0 直接相关的产品/数据契约语言：reported incidents、historical
  evidence、modeled exposure；拒绝 absolute safety、victim probability 和
  safest route 含义。
- 增加月份边界、失败不污染、语义幂等、unavailable 不等于 zero 的稳定测试。

## Sources of truth

- 当前用户委派的 M0 目标、禁止范围、验收和最终交付格式。
- 当前 checkout `f300cfe2658375add6542b86c20267c63c56ec4a` 的代码、测试、
  workflow 和数据产物；旧研究只用于定位，不作为当前实现事实。
- `docs/AGENTS.md` 与 `manage-task-records` 约束。
- `scripts/precompute_tract_crime.mjs`、`scripts/lib/tract_crime_snapshot.mjs`、
  `scripts/validate_tract_crime_snapshot.mjs`、`refresh-tract-data.yml`、
  Source Health catalog/adapters/read-model 及其标准可达测试。
- 现有 HIN lifecycle pair 是代码库内的可复用模式证据，不赋予 tract artifact
  任何 HIN review、authority 或 freshness 结论。

## Stages

- [x] Stage 0A: 建立 Git/base/worktree、规则、相关记录和聚焦测试基线。
- [x] Stage 0B: 在临时目录复现月份边界后的 snapshot/receipt 漂移。
- [x] Stage 0C: 锁定 M0 regression contracts，并实现最窄的生成/验证/成对发布闭环。
- [x] Stage 0D: 扩展 machine-readable source registry 和 Source Health receipt 消费。
- [x] Stage 0E: 运行聚焦/标准验证、审查相对 base diff、创建本地小 commits 并收口记录。

## Acceptance criteria

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

## Non-goals

- M1、M2；synthetic route stage 的继续扩展、框架重写或 route runtime/public 接线。
- 提高 bundle ceiling、引入依赖、增加 mock production data、改变外部数据 authority。
- 真实网络 refresh，除非可安全、可复现且不会污染受版本控制产物。
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
