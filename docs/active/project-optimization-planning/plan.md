# Plan

## Goal

将 2026-08-09 项目全面评估中的发现拆分为六条互不争抢代码的独立规划轨道，并由当前主任务统一监督、去重、排序和形成可执行的总体优化路线图。

## Scope

- P0 数据可信度与时间语义。
- CI、Pages 发布门禁、静态质量与文档治理。
- Known Route 与 Diary UI/可访问性/产品语言收口。
- 代码架构、状态所有权、测试耦合与性能演进。
- 以前计划外的新产品能力与官方对标。
- Local-first 与生产化、GPS、后端、telemetry 的边界决策。
- 主监督负责检查交叉依赖、冲突、优先级、验收标准和实施 handoff。

## Sources of truth

- 当前仓库代码、测试、GitHub workflows 与 `main` 基线 `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`。
- `docs/active/ui-role-experience-audit/` 仅作为历史决策与证据记录；其中陈旧事实必须重新核验。
- `docs/TODO.md` 与 `docs/KNOWN_ISSUES.md` 不能直接作为当前事实源。
- 独立规划任务的最终报告及其直接代码、测试和官方外部来源引用。
- 主监督上一轮运行证据：`npm run validate` 547/547、production build/bundle policy 通过、production dependency audit 0 vulnerability、desktop/mobile UI 现场走查。

## Stages

- [x] Stage 1: 将全面评估拆分为六条规划轨道并定义互斥范围、非目标和统一输出合同。
- [x] Stage 2: 恢复四个既有任务，重建两个失败任务，并取得六个正式 task ID；CI/发布使用本地只读恢复通道。
- [x] Stage 3: 监控首轮规划，处理阻塞、范围漂移和跨轨道依赖。
- [x] Stage 4: 对每份计划做证据、风险、验收和第一性原理复核。
- [x] Stage 5: 合并为一份去重、按依赖排序的总体执行路线图，并给出推荐首个实施批次。
- [x] Stage 6: 启动三个文件所有权互斥的执行任务，并确认进入真实实现阶段。
- [x] Stage 7: 监督三个执行任务的 focused tests、短测试 ownership、交付包和跨 worktree 冲突；长测试统一留给整合候选。
- [x] Stage 8: 由主监督逐条复核 ready-for-integration 交付，创建四个 Lore 提交并按 A → B → C 架构 → C 发布顺序整合到本地 `main`。
- [x] Stage 9: 修复只会在统一候选中暴露的发布门、严格数据夹具、bundle policy 与视觉稳定性问题，完成最终 `npm run ci:release`。
- [x] Stage 10: 提交整合修复与中央交接记录；保留 execution worktree 和用户既有未跟踪产物，不触发远端部署。
- [x] Stage 11: 在唯一 release owner 下发布当前候选；首个 `268bfab` run 因陈旧 Linux visual baseline fail closed，形成并完整重验修复候选 `f6413ec`，再以 exact-artifact promotion 完成 Actions、Pages、HTTP 与生产 browser canary 闭环。
- [x] Stage 12: 在生产健康后恢复 bundle headroom；锁定更严格的 lazy/budget contracts，拆分 MapLibre 与 Evidence hashing ownership，收窄 P1 catalog，并完成 fresh release gate；只形成第二次发布的本地候选，不 push。

## Execution continuation (2026-08-10)

用户在六份规划全部完成后，要求综合各方案并交给三个新的独立任务开始执行。六轨规划按共享文件与依赖关系压缩为三条实施线：

1. Crime 数据可信度 + Evidence Bundle v1：统一负责 Crime admission、时区、Tract immutable enrichment、canonical provenance 与证据包导出。
2. Known Route / Diary 体验 + local-first 收口：统一负责 drawer/sheet、键盘路线、Diary 语言、501 stub 与 remote Diary 边界。
3. 状态架构 + CI/Pages 工程底座：统一负责首批 state/action seam、map-to-Diary 反向依赖、静态质量、coverage report-only、同 SHA artifact promotion 与文档治理。

三个执行任务默认在独立 worktree 中工作，只允许编辑各自 ownership 文件；不得提交、push、改 refs、清理其他 worktree 或改变 GitHub 设置。它们完成后只进入 `ready-for-integration`，由当前主监督按 `$integrate-worktrees` 重新盘点、验证和决定整合顺序。

## Acceptance criteria

- 六条轨道均产生独立、只读、证据化的规划结果。
- 每份结果区分已验证事实、推断和未验证风险。
- 每份结果包含范围/非目标、阶段、验收、目标测试、依赖、回滚、工作量和 executor handoff。
- 不把过期 TODO、存在测试或局部实现误称为当前事实、整体完成或生产就绪。
- 主监督明确识别重复项、先后依赖、冲突决策和不应实施的功能。
- 最终总体路线图只选择有限的首批实施目标，不同时启动所有候选功能。

## Remaining boundaries after local integration

- Phase 1 已将 `f6413ec` 发布到生产；Phase 2 的性能候选未经新的第二次生产授权不得 push，因为该动作会触发新的 GitHub Actions 与 Pages 发布。
- 不清理 execution/planning worktree、未注册的 `d35d` 或用户既有未跟踪日志/输出；它们继续作为证据或用户 WIP 保留。
- 不在本批次选择后端、地图或 telemetry 供应商，也不加入 AI safety score、实时犯罪警报或 safer-route recommendation。
- GitHub Pages 环境保护、required checks 等远端 settings 只能在有仓库权限的外部步骤核验，不能用本地测试替代。

## Local integration closure (2026-08-10)

- Execution A → `b5aac49`：Crime 缺失/畸形/维度不完整数据 fail closed，Evidence Bundle 固定 aggregate v1 schema。
- Execution B → `0e73b80`：Known Route / Diary 响应式交互、本地持久化与示例/个人体验语言收口。
- Execution C architecture → `6899576`：显式 state/submit ports 与中性 Diary 地图 palette。
- Execution C release → `1cd340b`：同一 SHA artifact promotion、不可取消的 Pages deploy、lint/coverage/release contracts。
- Integrated repair → `5f8f526`：自包含 release runner、严格 CARTO 夹具、lazy bundle policy、确定性视觉滚动与单张已审查 portrait baseline。
- 最终本地门：`npm ci` 0；audit 0 vulnerabilities；coverage 58/58 report-only；`npm run ci:release` exit 0；browser smoke PASS；visual 35 passed / 10 conditional skips / 0 failed；`git diff --check` 0；node/npm 与 4173/4178 listener 均为 0。

## Risks and constraints

- 当前证据只允许声称“本地 main 已整合并通过发布门”，不能声称远端 CI 或 Pages 已发布。
- Entry、Crime 与 Evidence Bundle 已接近各自预算上限；后续功能必须优先继续拆分或删除，不应直接放宽 ceiling。
- Coverage 仍是 report-only 且只覆盖选定模块，不能当作全项目 50.78% 的完整风险证明。
- 多个 worktree 和日志被有意保留用于审计/交接，会继续占用磁盘；清理必须在独立授权和 ownership 复核后进行。
