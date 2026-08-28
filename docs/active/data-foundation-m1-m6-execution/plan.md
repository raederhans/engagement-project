# Data Foundation M1-M6 Execution

## Goal

从本地 `main@9d93df211a6a51fe99d9002d494937519fd79780` 串行完成规划对话定义的 M1-M6：
重建事件级数据仓库，恢复可复跑的 Area Intelligence 证据，然后依次完成住房/社区比较、
Known Route 证据、自适应路线替代，以及默认本地和隐私友好的 Diary。每个阶段最多创建
四个 `high` 推理 Codex 任务；本 worktree 是唯一整合 owner。

## Scope

- 恢复已丢失的 ignored `.dfev1` 重型数据；不把 raw/canonical 事件或私人路线提交到 Git。
- 复用当前已落地的 M0-M4 代码，先核验再只修补可复现缺口，不重复制造平行实现。
- M1-M6 严格串行；每个阶段的 exact input receipt、聚焦验证和状态语义通过后才进入下一阶段。
- 本地实现、官方公开数据下载、模型回测、浏览器验证和本地 commits 在范围内。
- Push、远端 CI、部署、生产发布、公开收集社区数据、凭据/权限变更不在当前授权内。

## Sources of truth

- 用户在 2026-08-28 指定的 “engagement项目拓展与方向规划” 对话及当前委派；阶段名称和
  原始目标保持为 M1 事件仓库、M2 Area Intelligence、M3 Home Compare、M4 Known Route、
  M5 Adaptive Alternatives、M6 Diary/Community Evidence。
- 当前代码、tests、workflows 和 `docs/AGENTS.md`；`docs/TODO.md` 不是自动命令队列。
- 已归档 `docs/archive/data-foundation-external-validity-v1/` 的 M0-M2 本地证据；所有旧 SHA、
  数据路径和行数只作恢复线索，必须以本轮新证据刷新。
- 官方 Philadelphia/Census/transport/property sources、各自 terms/license、source manifests
  与本轮生成的 exact receipts。

## Stages

- [ ] M1: 重建 2006 年至当前可获得日期的 revision-aware 事件仓库、crosswalk、tract/grid/
  corridor 状态、ACS E/M、lineage 与 DQ；仓库默认 `serving_eligible:false`。
- [ ] M2: 从本轮 exact M1 receipt 重建 tract/grid-week marts，复跑冻结评估；只有预定义 gate
  通过才提供 forecast，否则诚实保留 `not-promoted/unavailable`。
- [ ] M3: 让 2-4 个住房/社区比较维度拥有可验证 source adapters、地址/parcel admission、
  partial/unavailable 语义、权重敏感性和会话内隐私边界。
- [ ] M4: 在真实道路图和来源准入成立后完成 Known Route corridor evidence、分段贡献、
  不确定性与会话内路线隐私；禁止 raw GPS 与 “safest route” 表述。
- [ ] M5: 选择并准入 routing engine，生成可复现候选，提供 fastest/balanced/lower modeled
  exposure/accessible 的 Pareto 与敏感性比较，并用独立 oracle 验证失败路径。
- [ ] M6: 完成本地 Diary 记录、导出、删除与隐私回归；公共提交只建立默认关闭的严格契约，
  在 moderation/abuse/deletion/k-anonymity/authority 未闭合时不得启用。

## Acceptance criteria

- 每阶段从 exact committed source-final base 开始；工作线程给出 commit/data root/receipt/命令，
  主线程检查重叠、整合并运行最窄充分 gate。
- `unavailable/partial/stale/ambiguous/unknown` 永不投影为 `zero/current/low risk`。
- 重型数据可由 documented command、checkpoint 和官方源重建；同输入复跑语义幂等。
- 产品措辞限定为 reported incidents、historical evidence、modeled exposure 和 uncertainty；
  不宣称个人受害概率、绝对安全、因果或实时保障。
- 私人地址、Diary、路线或原始位置不进入 URL、遥测、网络、日志、截图或 share state。
- 最终候选通过按风险扩大的本地 tests/build/browser gates；未运行的 remote/deploy gates 明示。

## Non-goals

- 重写前端框架、提高 bundle ceiling、加入无证据依赖或重新开启 synthetic stage chain。
- 删除现有 worktree、logs、ignored artifacts、WIP 或历史审计记录。
- 在没有外部发布授权时 push、开 PR、部署或启用公共社区写入。

## Risks and constraints

- 旧 M1 约 9.9 GB 仓库与 M2 约 1.5 GB mart 所在临时 worktree 已不存在；本轮必须重建，
  且不能把历史行数/identity 当作当前完成证据。
- 本地 `main` 比 `origin/main` 超前 93 commits；未 fetch，远端当前状态未知。
- 当前主工作树含未归属 logs/output；监督工作只在隔离 worktree，禁止清理或覆盖。
- M4-M5 依赖真实图、许可、边界和 authority；synthetic/candidate 状态不得绕过 admission。
- 全量下载、mart 和模型为长进程，必须有唯一 owner、日志、checkpoint 和可恢复路径。
