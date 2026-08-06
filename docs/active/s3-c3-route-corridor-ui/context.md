# Context

## Current truth

- Worktree: `C:/Users/raede/.codex/worktrees/b1cf/engagement_project`。
- Baseline: clean detached `HEAD@1e9f91d8fbb59482985877ed7a6122e2959bac47`；提交前需创建本任务 `codex/` 分支。
- C1/C2 已在基线：`requestRouteCorridor(options)` 已暴露；route input 支持用户选取 GeoJSON LineString 与 caller-owned manual/drawing coordinates；原始 GPS map matching 仍未实现。
- 当前无 C3 用户 UI 调用者；`routeCorridorModulePromise ||= import(...)` 会永久缓存首次 rejected promise，是本任务需关闭的 Low。
- `docs/active/_worktree_registry.md` 只读；本任务不是 main/integration/remote owner。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-06 start | 用户要求先完成 C3-0，再按 admission 证据进入 UI | 不先写 UI；TDD 从固定虚构路线矩阵开始 |
| 2026-08-06 start | 根目录无 `AGENTS.md` 或 `lessons learned.md`；适用仓库指导为 `docs/AGENTS.md` | 不追加 lessons；遵守用户提供的顶层 AGENTS 合同与 docs 指导 |
| 2026-08-06 start | 当前代码是最终事实源，历史 C1/C2 记录只作决策背景 | 任何历史数字和描述需重新验证 |
| 2026-08-06 C3-0 | bundled police-district proof：短 Center City/100m 通过；同路线 500m、正常中长/跨区路线频繁失败 | single-district 不能作为通用 UI admission |
| 2026-08-06 C3-0 | 官方 OpenDataPhilly City Limits 明确是 City Standard Boundary；固定 ArcGIS GeoJSON 请求实测 HTTP 200、1 Polygon | 采用无新依赖的 `city-limit-interior` proof；固定 boundary 请求不包含 exact route；失败时保留原 single-district fail-closed fallback |
| 2026-08-06 C3-0 | 官方 City Limits matrix：Center short 100/500/1000m、Broad St 100/500/1000m、north 100/500/1000m 均通过；outside 全拒绝；部分靠河/市界的 medium/west-east 仍按 buffer+500m 拒绝 | 足以进入显式 corridor UI；不宣称所有市内路线可用，coverage unavailable 保持独立状态 |
| 2026-08-06 C3 | 首次 UI import rejected promise 已改为可清除并由用户 retry；I2 `sync` 端口异常已复现并返回具体 `incomplete/failedPort` | UI 不永久 pending，不把部分 canonical apply 说成完整成功 |
| 2026-08-06 bundle-1 | feature-enabled：Entry 893274/241125；Crime 39920/14074；C3 UI 11641/4610；route data 13237/4819 | Entry 未扩预算；先压缩 loader，随后按最小实测 ceiling admission Crime/C3 UI |
| 2026-08-06 visual | 首次无 update matrix 暴露次级入口把主 CTA 推出 half sheet；移动到末尾又造成 scroll anchoring | 未更新 baseline 掩盖回归；最终将短入口与 Suggested time windows 放在同一网格行，portrait/landscape 旧 baseline 保持不变 |
| 2026-08-06 visual | 逐图确认 desktop 新入口层级清楚且不遮挡后，仅更新 Crime analysis/help/incident 三张 baseline；阈值未变 | 最终无 update matrix 35 pass/10 configured skip |
| 2026-08-06 i18n | 动态 C3 query/evidence/fallback list 文案全部进入共享中英文 runtime；语言切换保留当前 result envelope | Route UI 独立 chunk 实测 `16359/6082`，ceiling `16600/6200`；Entry ceiling 不变 |
| 2026-08-06 review | 极点附近合法 LineString 会在 coverage 拒绝前产生异常大的米制 line width | TDD 加纬度缩放下限；不影响 Philadelphia 正常纬度精度 |
| 2026-08-06 final bundle | default Entry `893008/241051`、Crime `39939/14058`；feature Entry `893274/241123`、Crime `40145/14150`；共同 route data `13237/4819`、UI `16359/6082` | default/feature bundle policy 均 PASS，未提高 Entry ceiling |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| feature-enabled build/manifest/bundle | S3-C3 owner (this task) | `.tmp/s3-c3-route-corridor-ui/feature-build-final.log` | completed PASS；无进程/端口 |
| full validate | S3-C3 owner (this task) | `.tmp/s3-c3-route-corridor-ui/validate-final.log` | completed PASS；无进程/端口 |
| browser smoke | S3-C3 owner (this task), `127.0.0.1:4173` | `.tmp/s3-c3-route-corridor-ui/browser-smoke-final.log` | completed PASS；4173 已释放 |
| visual matrix | S3-C3 owner (this task), `127.0.0.1:4178` | `.tmp/s3-c3-route-corridor-ui/visual-final-verified.log` | completed PASS；4178 已释放；临时报告提交前删除 |

## Handoff

- 本任务拥有：S3-C3 产品/测试与 `docs/active/s3-c3-route-corridor-ui/`。
- 禁止：main/remote/registry 整合、其他 worktree、外部进程、无关 WIP。
- 目标终态：本分支 exact SHA、验证证据、bundle、残余风险、`ready-for-integration`。

## Next step

主任务按最终 handoff 的 branch/exact SHA 进行 integration 复核，重点处理共享的 Entry/Crime/CSS/bundle/baseline 冲突面并更新主工作树 registry。
