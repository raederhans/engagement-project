# Plan

## Goal

审核并集成当前工作树中已经完成的 Help Center、Crime 数据基础、犯罪类型高亮、人口普查区恢复、事件面板与单语显示改动，使本地 `main`、远端 `origin/main` 和 worktree 注册表最终指向同一已验证提交。

## Scope

- 审核当前受版本控制和新增的产品、测试、数据与任务记录文件。
- 明确排除用户拥有的 `.gitignore`、`.playwright-mcp/`、运行日志、验证输出和未完成的只读 UI/UX 审计记录。
- 在当前 dirty `main` 上保护排除项，建立可审查的集成提交边界。
- 运行完整项目验证、生产构建、bundle policy 和必要的浏览器 smoke。
- 创建 Lore 提交，经隔离分支/PR 或安全的主分支快进完成合并，并同步本地与远端。
- 更新 worktree 注册表和任务记录，完成后归档本集成记录及已交付的功能记录。

## Sources of truth

- `git status --short --branch`、`git worktree list --porcelain`、`origin/main` 和提交历史。
- `docs/active/_worktree_registry.md` 及各功能任务记录。
- 当前工作树 diff、项目测试入口、bundle policy 和 `127.0.0.1:5173` 的现有预览。
- 用户当前授权：审核、合并提交、同步本地与远端。

## Stages

- [x] Stage 1: 盘点 Git、worktree、注册表、live process 和提交范围。
- [x] Stage 2: 审核完整 diff，修复阻塞问题并冻结集成边界。
- [x] Stage 3: 运行完整验证、构建、bundle 和浏览器 smoke。
- [ ] Stage 4: 创建 Lore 提交并完成远端合并/同步。
- [ ] Stage 5: 对齐注册表、归档记录并验证本地与远端最终状态。

## Acceptance criteria

- 所有纳入提交的行为有对应测试或明确的浏览器证据。
- `.gitignore`、`.playwright-mcp/`、`logs/`、`output/` 和未完成 UI/UX 审计不进入产品提交。
- 完整测试、生产构建和 bundle policy 通过；浏览器关键流程无新增错误。
- 提交消息符合 Lore 协议，提交范围可审查且无意外文件。
- `main == origin/main`，worktree 注册表与 `git worktree list` 一致，远端合并和 CI/Pages 状态明确。

## Non-goals

- 不继续未完成的 `ui-role-experience-audit` 研究。
- 不删除用户日志、截图、浏览器痕迹或其他未跟踪文件。
- 不合并五个仍有独立远端 PR 的历史功能分支。
- 不 force-push、不重写远端历史、不调整产品口径或 bundle 预算来掩盖失败。

## Risks and constraints

- 当前 diff 跨多个已完成阶段且重叠核心 Crime、i18n、地图和 UI 文件，属于广范围集成。
- 当前唯一 worktree 直接位于 `main` 且包含排除项，暂存必须使用显式路径并逐项核对。
- `5173` 由 PID 74548 的现有 Vite 进程拥有；只复用，不重启、不停止。
- 远端可能在审核期间前进；提交与合并前必须重新 fetch 并检查分叉。
