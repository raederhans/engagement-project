# Plan

## Goal

在 `main` 基线 `9f585b9e86fc3ee4f2378647cba2ef49a0308ccb` 上，把 Diary 的本地持久化、会话生命周期和地图/UI 组合职责划清：IndexedDB-backed `local_repository` 是 My Routes 唯一持久真相，`src/routes_diary/index.js` 不再读写 `store.myRoutes` 或维护第二份可写数组镜像。

## Scope

- `src/routes_diary/**` 内的 repository/session/controller 最小拆分。
- 扩展既有 Diary repository、lifecycle、session、async、My Routes、rating 行为测试。
- 本目录内唯一一组 Batch 1B 交接记录。

## Sources of truth

- 当前 worktree 源码与测试；基线 `9f585b9e86fc3ee4f2378647cba2ef49a0308ccb`。
- `docs/AGENTS.md` 的 local-only/private Diary contract。
- `docs/active/project-optimization-planning/{plan,context,task}.md` 中已整合的 local-first、Diary UI 和 state ownership 决策；只读，不编辑中央记录。
- Targeted Diary node tests、相关 ESLint 与 `git diff --check` 的 fresh output。

## Stages

- [x] Stage 1: 核对基线、所有权、仓库约束和既有规划证据。
- [x] Stage 2: 以失败测试锁定唯一 repository truth、session disposal 和 controller 读模型契约。
- [x] Stage 3: 最小实现 controller/session 边界并收薄 Diary 组合入口。
- [x] Stage 4: 执行 targeted 验证、diff/bug/第一性原理复核。
- [x] Stage 5: 创建并复核本地 Lore 提交，交付 ready-for-integration。

## Acceptance criteria

- My Routes 的持久写入和刷新只经 repository/lifecycle；Diary 不读写 `store.myRoutes`，也不通过数组追加/删除模拟 repository 结果。
- repository read model、Diary session ownership 与 MapLibre source/layer 生命周期明确分开；过期 session 的异步结果不能覆盖当前 owner。
- `index.js` 只组合 local controller，不再直接拥有 storage import、repository/lifecycle、backup/delete 状态机。
- rating、My Routes、Sample Community、Insights、overlay、submit port、local lifecycle 与现有中英文文案保持不变。
- 范围内 Diary tests、相关 lint、`git diff --check` 通过；browser/visual/dev server/full release 明确留给 integration owner。

## Non-goals

- 不修改 `src/state/**`；`store.myRoutes` 字段的最终删除留给 integration follow-up。
- 不引入 remote API、账户、云同步、framework、dependency、event bus 或产品文案/视觉变化。
- 不修改中央 planning records、Batch 1A 文件、release/bundle policy、package/lockfile、visual baseline 或 README。
- 不 push、不修改 main/其他 worktree、不整合或清理 worktree。

## Risks and constraints

- `index.js` 仍有地图与 DOM runtime state；本批优先收敛会造成双写或 stale apply 的 local repository/session 部分，不做一次性大重写。
- 只允许运行不占端口的 targeted node tests 与 lint；browser/visual/full release 结果不在本任务声明范围内。
- 当前 worktree 是 detached HEAD；用户已授权在本 worktree 创建本地提交，但未授权分支、远端或 integration 操作。
