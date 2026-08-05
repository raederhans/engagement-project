# Context

## Current truth

- 当前只有一个 Git worktree，位于 `C:/Users/raede/Desktop/dev/engagement_project`，但含有用户及上一阶段未提交 WIP。
- `127.0.0.1:5173` 由既有 PID 38872 监听；本任务只复用，不拥有、不重启、不停止。
- 用户当前可通过 `codes=` URL 选择具体犯罪，摘要会按选择更新；已确认原 SQL 筛选正确，缺口位于 MapLibre 精确匹配、palette 消费与图例 owner。
- 用户要求具体犯罪最多三项，每项不同颜色，颜色来自当前分级设色 palette。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-04 | 默认继续查看全部犯罪；只有具体犯罪选择才启用分类高亮。 | 不改变首次使用路径。 |
| 2026-08-04 | 用户明确上限为三项。 | 上限同时成为 UI、状态恢复和绘图表达式契约。 |
| 2026-08-04 | palette 只提供视觉区分，不代表风险高低。 | 图例文案必须避免“更深=更危险”的暗示。 |
| 2026-08-04 | MapLibre 4.7.1 支持 `GeoJSONSource.setClusterOptions`。 | 仅在默认聚类/具体类型单点模式改变时切换，不重建 source。 |
| 2026-08-04 | 超过 20,000 点时沿用既有聚类降级。 | 图例明确需放大查看分类色；不宣称低缩放已显示三色。 |
| 2026-08-04 | 具体类型请求使用 latest-generation ownership。 | 快速切换犯罪大类时，旧响应不再覆盖最新选项。 |
| 2026-08-04 | 当前时间窗没有可用细项时清空具体选择。 | 不保留旧的计数提示、URL 代码或隐藏筛选。 |
| 2026-08-04 | 用户批准四项相邻改进。 | 重新开启本任务，追加圆形口径、时间同步、语言同步和修饰键交互阶段。 |
| 2026-08-04 | 用户指定沿用 Shift/Ctrl 修饰键。 | 官方资料确认修饰键语义因平台而异；保留原生 Shift/Ctrl/Cmd 行为，只补说明与三项约束，不拦截指针或键盘默认事件。 |
| 2026-08-04 | 圆形口径采用 bbox 与 `ST_DWithin` 的交集。 | 地图/列表保留视口性能边界，但所有显示事件必须位于 A 点半径内；摘要仍为整个圆的总数。 |
| 2026-08-04 | 时间变化先刷新分析，再后台校验细项。 | 慢网时地图不再滞留旧窗口；仅当细项失效时追加一次纠正刷新。 |
| 2026-08-04 | 保留选择的细项请求不覆盖选择器状态。 | 请求等待或失败时，当前过滤仍可见、可取消；成功提交前重读最新 store，避免覆盖等待期间的用户操作。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Vite `127.0.0.1:5173`, PID 38872 | Existing/user-owned | Unknown | Preserve; browser smoke only. |
| Focused tests | Root agent | Captured command output | Complete: final six-command regression passed 201/201. |
| `npm run build:manifest` and `npm run verify:bundle` | Root agent | Captured command output | Complete: build passed; Entry 902645/902665, Crime 37992/38000 and dist 3415522 bytes. |
| Playwright CLI smoke against existing `http://127.0.0.1:5173` | Root agent | `output/playwright/crime-offense-highlights/` plus CLI snapshots | Complete: three-choice cap, palette-linked points/legend, URL state and clear-to-cluster recovery verified; 0 console errors/warnings. |
| Follow-up build + bundle policy | Root agent | Captured command output | Complete; budget policy passed without raising limits. |
| Follow-up browser smoke | Root agent | `output/playwright/crime-offense-highlights-followup/final-result.json`, `final.png` | Complete; live API smoke passed and all owned browser sessions were closed. Existing PID 38872 was preserved. |

## Handoff

- Preserve `.gitignore`, `.playwright-mcp/`, Help-center files, Crime foundation files, and all unrelated dirty changes.
- Do not raise bundle budgets to fit this feature.
- Do not label palette-derived point colors as crime severity.

## Final evidence

- `output/playwright/crime-offense-highlights/three-highlights-orrd.png` shows three palette-colored incident types and the matching legend.
- `output/playwright/crime-offense-highlights/default-clustered.png` shows default clustering restored after clearing concrete types.
- `output/playwright/crime-offense-highlights-followup/final-result.json` records the final modifier, held-request time synchronization, spatial and live-translation assertions.
- `output/playwright/crime-offense-highlights-followup/final.png` shows the final 3/3 selection, circle-scoped point map, synchronized incident list and categorical legend.
- The existing Vite listener remains user-owned and unchanged at PID 38872.

## Next step

Keep saved-analysis restore and the visible offense-option list synchronized in a later history-panel task; do not expand this completed work into route safety or new risk indices.
