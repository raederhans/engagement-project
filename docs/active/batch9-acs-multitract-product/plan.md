# Plan

## Goal

把现有 ACS 2024 VRE B01003 聚合基础接入一个经过显式审查的多 tract 产品流程：选择至少两个完整 Philadelphia 2020 Census tracts，审查准确 GEOID、完整性与 vintage，用户明确 Calculate 后才计算，并以 table-first 方式呈现 estimate、SE、90% MOE、时期、地理 vintage、方法与限制。

## Scope

- 复用现有 ACS snapshot、计算 facade、表格 renderer 与 Evidence contribution seam。
- 新增 feature-owned selection/model/controller/lazy-loader/UI，并提供无地图列表路径。
- 新增 feature-owned ACS Source Health admitted-observation adapter，留给中央 assembler 后续接线。
- 在 `src/main.js` 与 `index.html` 添加真实、二级懒加载产品入口。
- 扩展职责重合的 ACS 测试或增加 ACS 专属契约测试；不修改共享 package/bundle/CI 配置。

## Sources of truth

- 基线 revision：`db41214ad5a428fc0cf0fe369f257f7470196cbe`。
- `src/acs_aggregation.js`、`src/api/acs_aggregation.js`、`src/data/acs_aggregation.js` 与现有 ACS 测试。
- `docs/ACS_AGGREGATION_VRE.md` 及 snapshot provenance/schema。
- 美国 Census Bureau 的 ACS VRE 官方方法与文件说明。

## Stages

- [x] Stage 1: 核对基线、权限、适用指令并建立持久记录。
- [x] Stage 2: 审计现有数学、地理、lazy graph、UI/i18n 与 Source Health seam。
- [x] Stage 3: 先以目标契约覆盖选择、审查、负路径、产品入口、Source Health/Evidence contribution。
- [x] Stage 4: 实现最小产品流程及 scoped CSS/双语可见文案。
- [x] Stage 5: 运行获准的最小充分验证并修复回归（dependency/non-browser 与 focused browser 均完成）。
- [x] Stage 6: 更新交接证据、确认 scoped process=0、标记 ready-for-integration。

## Acceptance criteria

- 只有两个或更多完整、唯一、已知、同为 Philadelphia 2020 vintage 的 tract 才能进入 Calculate。
- 用户先审查准确 GEOID，再显式 Calculate；地图不重新定义 admitted tract 集合；无地图路径完整可用。
- 输出表格包含 tract 数、aggregate estimate、SE、90% MOE、ACS period、geography vintage、method 与 limitations。
- GEOID 缺失/重复/未知、少于两个、mixed vintage、80 replicates 异常、无可靠 correspondence 均 fail closed；不存在 area/centroid/population weighting、MOE 相加或地址/route buffer 推断。
- ACS 计算/数据保持二级 lazy，不进入 Entry/Crime 初始模块图。
- Feature-owned Source Health adapter 只在成功 admit 后返回 observation，并可由中央 seam 注入；Evidence adapter 保持纯贡献边界。
- 键盘、焦点状态、ARIA live、窄屏、英文和中文可理解；不能以不可用表示零。
- 目标 Node/静态测试通过；browser/visual/build/full validate 的执行状态被准确记录。

## Non-goals

- 不修改或重建 Census snapshot，除非先发现并上报可复现不一致。
- 不实现地址、route buffer、partial tract、任意 polygon 或个人级统计推断。
- 不编辑 Evidence Bundle v2 核心、Analysis History、HIN/route runtime、Source Health 中央 assembler、CI/package/bundle policy 或共享 i18n catalog。
- 不执行 git add/commit/push/ref/worktree/deploy。

## Risks and constraints

- `src/main.js` 与 `index.html` 是 Batch 9 独占入口，但整合时仍可能与基线后主线变化冲突。
- 不编辑 `src/i18n/messages.js`，因此该独立入口的双语文案必须由 feature-owned 模块/DOM locale 同步完成，并在整合时建议迁入中央 catalog。
- `package.json` 与 bundle policy 非本线所有；新增测试入口或预算调整必须作为 handoff 交给 integration owner。
- build、bundle、browser、visual 与完整 validate 属于共享 live-test lane，运行前必须取得主监督授权。
