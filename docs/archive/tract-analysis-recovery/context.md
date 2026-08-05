# Context

## Current truth

- 当前只有一个 worktree，分支 `main`，并含犯罪分类、地图高亮、帮助中心和本地化等未提交 WIP。
- 2026-08-05 检查时，`127.0.0.1:5173` 与 `4173` 均无监听进程。
- 普查区快照文件存在且校验通过，共 408 个普查区，覆盖 `[2025-08-01, 2026-08-01)`。
- 运行时快照开关默认关闭；日期不完全匹配时快照也会被判定不可用。
- 当前快照不可用分支不建立 `tracts-fill`，而普查区点击只监听该图层。
- 当前事件刷新资格只接受带中心点的 `buffer` 模式，分局和普查区会清空事件结果。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-05 | 用户明确要求修复。 | 从只读诊断切换为实现与验证。 |
| 2026-08-05 | 不把固定快照扩展为任意窗口全市聚合。 | 最小修复聚焦“始终可选区 + 选中区实时查询”。 |
| 2026-08-05 | 快照只控制设色，不控制交互。 | 无快照时使用中性、可点击的普查区层。 |
| 2026-08-05 | 复用现有多边形 SQL 与事件结果控制器。 | 避免新依赖和并行查询架构。 |
| 2026-08-05 | MapLibre 官方规范支持 `fill-opacity` 和 `fill-outline-color`，官方示例使用绑定到 polygon fill layer 的点击事件。 | 无快照状态采用低透明度中性 fill，避免依赖不可见图层的隐含交互。 |
| 2026-08-05 | RED 测试证明摘要仍调用 buffer count/top/population。 | 普查区摘要必须选择 tract 专用 fetchers，不能复用保留的 A 点。 |
| 2026-08-05 | 普查区事件点继续作为结果数据加载，但地图主图层仍保持普查区填色。 | 事件列表可用，同时不让事件图例覆盖普查区分级图例。 |
| 2026-08-05 | 切换到普查区时，point request 不再传递保留的 `center3857/radiusM`。 | 避免旧缓冲区与普查区多边形错误求交。 |
| 2026-08-05 | 地图产生的普查区选择同步控件并立即写入 URL。 | 刷新、分享和结果卡使用同一个 GEOID，避免地图状态只停留在内存。 |
| 2026-08-05 | 用小型本地球面几何工具替代入口中的整包 Turf 引用。 | 保持现有 64 段圆形和半径语义，同时满足不可变 bundle 预算。 |
| 2026-08-05 | 正值与零值普查区均完成真实浏览器验证。 | `42101030100` 返回 6/6；`42101035602` 诚实返回 0，而非“数据不可用”。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Focused unit/contract tests | Root agent | Captured command output | Complete; final targeted run passed 166/166. |
| Vite validation server | Root agent | `output/tract-analysis-recovery/vite.out.log`, `output/tract-analysis-recovery/vite.err.log` | Running on 5173 and intentionally retained for user review. |
| Browser smoke | Root agent | In-app browser | Complete; zero and positive tract paths passed with no new warnings. |

## Handoff

- Preserve all unrelated dirty files and active task records.
- Do not restart or stop any listener without first rechecking port ownership.
- Do not convert the palette into a severity scale.

## Next step

No implementation step remains. The user can inspect the retained local preview; arbitrary-window citywide tract aggregation is a separate product enhancement.
