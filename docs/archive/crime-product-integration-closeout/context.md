# Context

## Current truth

- 当前只有一个 Git worktree：`C:/Users/raede/Desktop/dev/engagement_project`，分支 `main`，初始 HEAD `f4be752b`，初检时与 `origin/main` 对齐。
- 当前工作树包含 45 个已跟踪修改和多组新增功能文件；已有 Help、Crime 数据基础、犯罪类型高亮和人口普查区恢复记录均显示实现完成。
- `.gitignore` 与 `.playwright-mcp/` 被既有记录明确标记为用户拥有，不得暂存、覆盖或删除。
- `docs/active/ui-role-experience-audit/` 是未完成的只读研究，不属于本次产品集成。
- `logs/` 与 `output/` 是运行/验证产物，不进入产品提交。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-05 | 用户授权审核、合并提交和两端同步。 | 主代理作为 integration owner，可提交、合并、推送并同步注册表。 |
| 2026-08-05 | `git worktree list` 仅返回当前 `main` worktree。 | 无跨 worktree 文件冲突，但仍需核对保留分支和注册表。 |
| 2026-08-05 | 当前 `main` 与 `origin/main` 初始均为 `f4be752b`。 | 可从共同基线建立集成提交；推送前重新 fetch。 |
| 2026-08-05 | 现有功能记录将 `.gitignore`、`.playwright-mcp/`、日志和输出归为用户/运行产物。 | 使用显式路径暂存，不执行清理或全量 `git add -A`。 |
| 2026-08-05 | 审核发现 Help 的点位/聚类说明落后于半径交集与三色高亮逻辑。 | 先写失败合同，再把方法说明改为实际查询和降级口径。 |
| 2026-08-05 | 审核复现零事件 buffer 的住宅稳定性错误回退到全市数据。 | 以 `queryMode`/区域选择决定数据序列；空区域序列按零月份处理，语言缓存保持同一口径。 |
| 2026-08-05 | 事件列表聚焦未遵守 reduced-motion，分类版本在两处硬编码。 | 聚焦在减少动态效果时使用 0ms；分类版本只保留 JSON/分类工具这一处事实源。 |
| 2026-08-05 | CI 视觉审核发现事件 popup 会在地图刷新后消失。 | 先增加失败合同，再让新结果代次重建当前 popup；视觉测试在截图前再次确认 popup 存在。 |
| 2026-08-05 | PR #62 的 Windows/Ubuntu 门禁全部通过并合并为 `5184c901`。 | 产品分支已完成；本地 `main` 快进到同一远端提交后，仅剩任务记录归档。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Vite `127.0.0.1:5173`, PID 74548 | Existing/user-owned | Unknown | Running; reuse only, do not restart or stop. |
| Full validation/build/bundle | Root integration owner | Captured terminal output | Complete; `npm run validate` passed serially, including tests, Vite build and bundle policy. |
| In-app browser smoke | Root integration owner | In-app browser state | Complete; one owner, existing 5173 process reused. |

## Handoff

- 暂存前重新核对排除项与未跟踪文件。
- 每次 Git 写操作后检查 HEAD、index 和工作树状态。
- 若远端前进或出现产品语义冲突，停止直接推送并改用隔离分支/PR。

## Validation checkpoint

- `npm run validate` passed after the audit fixes. Vite built 192 modules and every bundle policy remained within its existing budget; Help Center used 22,293 raw / 9,257 gzip bytes against 22,500 / 9,300 limits.
- Browser smoke on the existing `127.0.0.1:5173` process confirmed the centered `aria-modal=true` Help dialog, 59-event two-offense highlight flow, current-language-only offense labels, incident detail focus without URL mutation, and restored tract totals/event lists.
- Zero-event residential stability is covered by a focused regression contract for both immediate rendering and locale-cache refresh; the browser tract smoke used live source data and therefore validated the non-empty tract path.

## Next step

归档完成记录，经文档-only closeout PR 合并后再次同步 `main`、核对主分支 CI/Pages 与公开站点。
