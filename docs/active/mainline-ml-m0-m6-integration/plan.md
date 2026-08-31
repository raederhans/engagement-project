# Plan

## Goal

将已完成的 `codex/mainline-m0-m6` 与 `codex/python-ml-benchmark` 串行整合到干净的本地 `main`，消解跨语言模型候选资格语义，并用联合验证证明本地交付可进入远端授权闸门。

## Scope

- 整合主线 M0-M6 的四个提交与附属 ML0-ML6 的三个提交。
- 保留 v2 历史字节、fail-closed 数据准入、research-only ML authority 和 R7 NO-GO。
- 将 MA4 明确限定为诊断基线，不赋予 Evaluation Protocol v3 晋级资格。
- 更新本记录与既有 worktree registry，使 Git 事实可恢复。

## Sources of truth

- `docs/AGENTS.md`
- `docs/active/_worktree_registry.md`
- `docs/active/mainline-m0-m6/`
- `docs/active/python-ml-benchmark/`
- Git base `cfb0af1cf0e00a7a6c23e07cacc8d7cc50e3d6a7`

## Stages

- [x] Stage 1: 核验 target/source 工作树、远端漂移、提交链和路径交集。
- [x] Stage 2: 串行整合主线 M0-M6。
- [x] Stage 3: 串行整合附属 ML0-ML6。
- [x] Stage 4: 解决 Protocol v3 与 ML 候选资格语义并运行联合验证。
- [x] Stage 5: 更新 registry、提交整合记录并明确远端状态。
- [x] Stage 6: 执行本地 release/coverage 预检并只读核对 GitHub 治理与 Pages 状态。

## Acceptance criteria

- 本地 `main` 包含两个交付包且工作树干净。
- `ml/**` 不读取 raw/canonical events，不获得 serving/promotion authority。
- MA4 只可作为 diagnostic baseline；v3 正式候选集合保持预冻结方案。
- `npm run validate`、主线聚焦测试、ML lock/lint/type/test 和必要跨层检查通过。
- 合并、push、部署、GitHub ruleset、release、云凭据和外部数据状态分别如实记录。

## Non-goals

- 不实现 ML7/R7 或 Adaptive Alternatives。
- 不生成 safest route、combined safety score、forecast promotion 或 routing authority。
- 未获得明确授权前不 push、deploy、修改 GitHub 权限/规则、创建 release 或云资源。

## Risks and constraints

- 两分支文件交集为 0，但 Protocol v3 正式候选与 ML 内 MA4 实现存在语义相关性。
- 全量 M2 mart 缺覆盖 128 parts 的 exact `ArtifactRegistry/v1`，因此 full benchmark 必须保持 `unavailable`。
- 默认检出和其他 worktree 含用户 WIP/大体积证据，禁止清理或吸收。
