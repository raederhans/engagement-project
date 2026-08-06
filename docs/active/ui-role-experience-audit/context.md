# Context

## Current truth

- 当前主工作树为 `C:/Users/raede/Desktop/dev/engagement_project`，分支 `main`。S3-C1/C2 的隔离 Git worktree 已在合入并同步后注销，本地 `codex/s3-c2-route-corridor-data` 分支已删除；原目录只剩一个被外部进程临时占用的空文件夹，不再是 Git worktree。当前主工作树继续保留用户拥有的未跟踪日志/报告与行尾噪声。
- `127.0.0.1:5173` 由 PID 74548 的 Vite 进程监听；`/?mode=crime` 与 `/?mode=diary` 均返回 HTTP 200。
- Help Center、Crime 数据基础、犯罪类型地图高亮已有完成记录；本任务研究它们组合后的当前体验，不重复实现这些阶段。
- Product Design saved user context 不存在；本次以用户当前目标、当前代码和当前运行页面为准。
- 2026-08-05 实施开始时，`main == origin/main == cf191aa`，单一 worktree；此前审计基于的 UI 改动已经合入当前主线。
- 实施前的 `.gitignore`、`src/style.css` 行尾状态，以及审计截图、日志和测试报告等未跟踪产物均被保留；本任务没有改写 Git index、分支、worktree 拓扑或远端。
- 2026-08-06 用户授权 `/root` 作为 integration owner，将当前 S3-I1/I2 WIP 与隔离分支 S3-C1/C2 整合、提交、同步 main/origin，并在验证后清理已整合 worktree 与分支；审计日志、Playwright 报告和 `output/` 仍作为未跟踪产物排除在提交外。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-05 | 用户要求先研究并提交完整报告，没有授权产品实现。 | 本任务保持产品代码只读，输出可执行的后续优化计划。 |
| 2026-08-05 | 当前工作树包含大量未提交改动。 | 所有检查以当前工作树为准；不切分支、不清理、不覆盖。 |
| 2026-08-05 | 三类用户共享同一数据产品，但关注顺序与可能需要的查询预设不同。 | 先修通用流程；后续将“展示焦点”与“显式查询预设”分离验证，不复制三套产品，也不让角色静默改变数字。 |
| 2026-08-05 | 独立批评审查认为直接实施 lens 会过早锁定未经验证的答案。 | P0 改为隐藏空结果、折叠已完成输入、默认最多三个结果模块、合并高级设置、取消嵌套/并行深层 disclosure；任务焦点降为 P2 可逆实验。 |
| 2026-08-05 | 用户授权执行阶段一和阶段二。 | 任务从只读审计扩展为本地实现与验证；P2 关注任务仍明确排除。 |
| 2026-08-05 | 阶段一/二属于既有 UI 行为变更。 | 严格执行测试先行：先观察新契约按预期失败，再写最小产品代码。 |
| 2026-08-05 | 角色 lens 仍缺少真实用户证据。 | 阶段一/二只增加本地临时的 `stage` 与 `resultPane`，不写入 store、sessionStorage 或分享 URL，也不静默改变查询。 |
| 2026-08-05 | 深层结果说明需要互斥且入口 bundle 已接近硬上限。 | 使用原生 `<details name="crime-results">`，删除自定义互斥监听，保持一个状态所有者并减少入口代码。 |
| 2026-08-05 | 阶段三复核发现“购房/居住 Crime 任务”和“通勤 Diary 任务”的数据能力不对称。 | 角色化 UI 不得把 Diary demo/local/sample 包装成真实路线犯罪或安全分析；真实 GPS/路线能力是独立 capability gate。 |
| 2026-08-05 | 官方研究支持安全默认、可跳过设置、任务语言、渐进披露、用户控制和可回退个性化。 | 首轮保留 Generic 默认；使用“比较长期变化 / 查看日常周边 / 记录或回顾路线”等任务焦点，不强制选择身份。 |
| 2026-08-05 | `[SUPERSEDED]` 当前仓库没有产品 telemetry、实验分流或远程 collector 基础设施。 | 原方案为 S3.0 moderated research；当前不执行 participant research，且仍不新增远程采集。该基础设施事实与隐私边界继续有效。 |
| 2026-08-05 | Crime 查询、URL 和 saved analysis 已有严格 canonical contract。 | `focusMode` 只影响展示；显式 `queryPreset` 经 preview/confirm 后才写入现有查询状态和 URL；preset 名称不成为 URL 真相。 |
| 2026-08-05 | 默认入口 bundle 为 902660 / 902665 bytes，只余 5 bytes。 | S3.0 零代码；S3.1 若获准，从既有 lazy Crime 边界加载并设置独立预算，不提高 Entry 上限。 |
| 2026-08-05 | `[SUPERSEDED]` 阶段三桌面研究与架构复核完成；真实用户研究尚未执行。 | 原 participant protocol/gate 不再执行；fixtures 转为认知走查和回归合同，当前状态以后续 D0-D3/I1/I2/C1 记录为准。 |
| 2026-08-05 | 最终复核确认 Crime built chunk 为 37,604 / 38,000 raw 和 13,221 / 13,500 gzip。 | S3.1 必须使用 second-level lazy chunk；只余 396 raw / 279 gzip 给 loader，manifest 契约需显式更新且预算不提高。 |
| 2026-08-05 | `replaceCrimeViewState()` 会先 canonicalize 输入并清空旧选择。 | Query preset 从完整 canonical before snapshot 合并 allowlisted 非位置字段；禁止把 partial preset 直接传入，undo 恢复完整 snapshot。 |
| 2026-08-05 | 用户确认个人项目不会、也不能招募受试者。 | 原 S3.0 招募/主持/样本闸门保留为历史方案但不再是当前执行条件；阶段三改为证据驱动的场景建模，不把桌面研究或 AI 走查称为用户研究。 |
| 2026-08-05 | 官方购房、城市犯罪地图、旅客信息、风险沟通、隐私和无障碍来源收敛到任务而非身份、透明过滤、地图加文字替代和显式 caveat。 | 使用 H0-H6 可证伪场景、High/Medium/Low/Blocked 证据等级和固定虚构认知走查；Generic 始终默认、完整和可恢复。 |
| 2026-08-05 | 长期地点比较与日常周边回顾的任务存在有官方证据且当前 Crime 能力匹配，但具体信息顺序仍只是 Medium product hypothesis；路线走廊只有低强度类比，且 GPS matching/route-to-crime contract 不存在。 | 首个可实施候选只包含 Crime 的 `general/long_term/daily_living` presentation focus；Diary 路线日记保持独立，真实路线历史是新的 capability 项目。 |
| 2026-08-05 | `crimeWorkbench` 已拥有展示状态但封装在 `panel.js`；Entry 只余 5 bytes。 | 未来 I1 需要极薄 presentation API、Crime 二级 lazy controller 和等量入口删除/迁移；不能用 DOM click 模拟作为生产架构，也不能抬高 bundle 预算。 |
| 2026-08-05 | 用户授权执行 `S3-I1` 与 `S3-I2`。 | 当前主任务按 TDD 顺序执行：先完成 bundle admission 与 I1，再在 I1 不变量通过后实现独立的 canonical preset transaction。 |
| 2026-08-05 | 用户要求另起 Codex 任务并行执行 `S3-C1`。 | 已创建独立任务 `019fd1fa-eb9d-77c3-a3d3-4b484cca0dcf`，worktree 为 `C:/Users/raede/.codex/worktrees/9188/engagement_project`；该任务只交付 route capability 分支，不操作当前 WIP、5173、main 或 I1/I2 所有权。 |
| 2026-08-05 | S3-I1/I2 的最终 TDD、浏览器、视觉、完整 validate 与 bundle gate 通过。 | `general/long_term/daily_living` 只调整展示顺序与新分析初始 pane；preset 只在显式确认后修改 allowlisted 时间字段。移动端采用紧凑渐进披露，主 CTA 仍在首屏。 |
| 2026-08-05 | 独立任务继续完成 S3-C1 基础提交及 S3-C2 方案 B 数据切片。 | 分支 `codex/s3-c2-route-corridor-data`、commits `751b5ef`/`6f0c2c2` 为 `ready-for-integration`；当前任务不自动合并，combined bundle 和共享文件冲突仍是独立集成门槛。 |
| 2026-08-06 | 用户授权整合、提交、双端同步和清理；允许按 fresh build 最小抬升 bundle 入口预算，并只在整合证据要求时补必要视觉现代化。 | `/root` 成为 integration 与 live-test 唯一 owner；先提交当前 I1/I2 运行面，再按 `751b5ef → 6f0c2c2` 整合，最终以 combined validate、bundle、browser/visual 和远端事实作为完成门槛。 |
| 2026-08-06 | combined build 的 Crime lazy chunk 实测为 38375/13527，超过旧上限 38000/13500；主 Entry 同时下降到 892948/240979。 | 只将 Crime 上限最小调整为 38500/13750；Entry 和全局 dist 上限均不提高。 |
| 2026-08-06 | 完整视觉矩阵暴露 11 个旧 Diary 场景失败；expected/actual/diff 与两次独立复核确认差异来自受测的私密备份 IA 和统一 Help 控件，没有布局或行为回归。 | 仅更新 15 张实际变化的 Win32 Diary baseline；无更新参数复跑为 35 passed、10 designed skips、0 failed，不提高像素阈值。 |
| 2026-08-06 | `ab8b72c`、`751b5ef`、`6f0c2c2` 经 `b09d4a2` 整合，视觉收口为 `c48108f`，随后同步到 `origin/main`。 | 保留 C1/C2 原始 SHA；独立 Git worktree 注销，本地分支普通删除；不执行 force push 或生产部署。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Vite `127.0.0.1:5173`, PID 74548 | Existing/user-owned | Unknown | Running; read-only browser audit only; do not restart or stop. |
| `npm run quick-preview -- --host 127.0.0.1 --port 5201 --no-open --mode diary` | `/root` | `%TEMP%/engagement-ui-audit-5201.log` | Stopped after capture; PID 60432 terminated and port 5201 verified released. |
| In-app Browser audit session | `/root` | Screenshots under `output/ui-role-experience-audit/` | Finalized after desktop/mobile Crime, Help and Diary capture; console warning/error check returned empty. |
| Phase 1/2 implementation tests and browser verification | `/root` | Playwright/test output under existing project artifact paths | Completed on isolated ports 5201/4173; both ports are released. Existing 5173 was not restarted or stopped. |
| S3-I1/I2 build, browser and visual verification | `/root` | Existing project `dist/`, Playwright output and task evidence | Complete；4173/4178 isolated listeners released，final validate/bundle/Crime visual rerun passed。 |
| S3-C1/C2 independent Codex task | Codex task `019fd1fa-eb9d-77c3-a3d3-4b484cca0dcf` | Archived task records; original commits `751b5ef`/`6f0c2c2` | Integrated into main; Git worktree unregistered and local branch deleted after remote containment proof. |
| S3 integration build/test/browser/visual commands | `/root` only | `%TEMP%/engagement-s3-integration-*.log`; shared `dist/`, Playwright output, isolated Vite ports 4173/4178 | Complete；all commands ran serially, listeners were released, and user-owned 5173 was not touched. |

## Handoff

- 子代理只做静态代码映射、外部研究或独立复核；不得操作 5173 服务、浏览器会话或产品文件。
- 现有未提交 WIP、`.playwright-mcp/`、日志和已有任务记录全部保留。
- S3-C1/C2 的独立任务已完成并整合；其原始提交与归档记录保留，后续不再存在需要轮询的 live process。

## Audit evidence

- `output/ui-role-experience-audit/` contains 13 accepted screenshots covering Crime start, result, filters, all-open overload, Help Center, mobile summary, and Diary current/history/community states.
- Runtime inspection confirmed that Crime can expose setup, advanced filters, summary, incident log and chart details at the same time, producing two independently scrolling side surfaces around the map.
- Static inspection confirmed existing 8/12/16px radii, a surface shadow, 120/180ms motion tokens and reduced-motion handling; visual polish exists but is not consistently orchestrated into a hierarchy.
- Diary already separates current route, local history and community sample, but its current-route view still stacks route selection, comparison, rating, simulator and filter cards in one long panel.
- External research used IBM/Carbon progressive-disclosure guidance, ONS interactive-visualisation guidance, WCAG 2.2, W3C reduced-motion guidance, and official crime-reporting methodology sources.
- The isolated preview was cleaned up; the pre-existing 5173 listener remains PID 74548 and still returns HTTP 200.
- Independent review accepted the overload and styling evidence, but required narrower wording: the two panels are visually near-equal rather than mathematically identical; Diary has some hierarchy; styling effects exist but are scattered; persona-related content exists as a fixed Homebuyer card even though no user-switchable lens state exists.

## Next step

本轮 Stage 3 实现、整合、验证和双端同步已完成：

1. `S3-D0/D1/D2/D3 COMPLETE`：已冻结证据阶梯、H0-H6 场景、证据等级、反例、能力边界、UI/视觉方向和代码结构；这些是 product hypotheses，不是已验证用户需求。
2. `S3-I1 COMPLETE AND SYNCED`：`general/long_term/daily_living` 为 page-lifetime、presentation-only、second-level-lazy；Generic 默认，不写 storage，不改变 query/map/URL/save/data。即时导航 DOM/Tab 顺序会调整，但不会抢走用户当前手动 pane；新分析才采用 preferred pane。
3. `S3-I2 COMPLETE AND SYNCED`：preset 使用独立 nested-lazy canonical transaction；preview/cancel/no-op/stale/apply/undo 与单次刷新均已验证，只允许首批时间字段。
4. `S3-C1/C2 COMPLETE AND SYNCED`：真实已知路线、route buffer、粗 bbox 隐私边界、CARTO 历史候选和本地精确关联已合入 main；没有最终 UI、没有原始 GPS matching，也不产生安全路线建议。

当前最有价值的下一步不是继续扩大本轮 scope，而是单独设计 route corridor 的可访问 UI 与完整限制文案；在此之前，底层能力不应被描述成用户可用的通勤安全产品。长期偏好、telemetry、生产 rollout、GPS matching 和任何安全建议仍分别受价值、隐私、数据与政策边界约束。

## Stage 3 review evidence

- `crime_workbench` 当前只持有编辑/结果 pane 等展示状态，适合作为 presentation-only 模型；Crime 查询真相仍由 store 和 canonical URL contract 所有。
- 实施前 `focusMode`、`queryPreset` 和用户可切换角色均不存在；本轮新增的是 page-lifetime task focus 与显式 query preset，不是持久身份或用户画像。
- Diary 是 demo/local/sample 混合体验，真实 GPS map matching 明确为 TODO 并在调用时抛错。
- 产品代码中没有可复用的行为 analytics 或 A/B experiment system；Diary API 的 analytics 是业务数据接口，不是 UI telemetry。
- 官方来源支持：以真实任务验证用户需求、非必要设置可跳过、个性化可配置可回退、位置数据最小化、reported crime 不可作为完整安全结论、性能指标必须与用户研究和 guardrails 结合。
- 本轮补充官方研究确认：购房决策需要比较并结合多种信息；Philadelphia Atlas 将房地产和 nearby activity 分层；Police.uk 明确近似地点、未显示记录和 unavailable/zero 限制；FHWA 把通行任务描述为路线、时间、延误和事件信息，而不是犯罪安全评分。
- UI Pro Max 的可接受建议是中性高对比、清晰 focus ring、44px 目标、可跳过 onboarding 和 reduced-motion；三步 funnel、红橙绿安全语义和手写字体已明确拒绝。
- 当前 IA 收敛为一个 App shell、Crime/Diary 两个能力工作区、Crime 内两个可选任务焦点，以及按 mode 切换内容的 trust strip：Crime 显示来源/覆盖/历史非实时，Diary 显示 Demo/Local/Sample/设备存储；桌面保留地图中心，移动使用单一 bottom-sheet scroll owner。
- 已实现的最小代码边界为 lazy `src/routes_crime/task_focus_controller.js`，配合 `panel.js`/`main.js` 的窄 presentation API 和 Crime 二级 dynamic import；query preset 使用独立模块和完整 canonical transaction。
