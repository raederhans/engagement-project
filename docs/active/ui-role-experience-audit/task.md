# Task

## Current status

Stage 3 integration and synchronization complete: `S3-I1`/`S3-I2` 已作为 `ab8b72c` 提交；`S3-C1`/`S3-C2` 原始提交 `751b5ef`/`6f0c2c2` 通过 merge commit `b09d4a2` 保留并整合；受审阅的 Diary 视觉基线以 `c48108f` 收口。产品提交已同步到 `origin/main`，独立 Git worktree 已注销，本地分支已删除。所有体验结论仍是 evidence-informed product hypotheses，不是用户研究结论；`S3-I3` 继续作为未授权的未来选项。

## Checklist

- [x] 确认仓库、分支、工作树、相关任务记录和现有预览。
- [x] 映射当前页面结构、CSS token、组件边界和交互状态。
- [x] 捕获并检查 Crime 主流程、结果、Help 与关键筛选状态。
- [x] 捕获并检查 Diary 主流程和窄屏状态。
- [x] 调研信息层级、渐进披露、角色化体验、动效和无障碍参考。
- [x] 定义三类用户的任务、共同核心、优先内容与切换模型。
- [x] 形成优先级问题清单、目标风格和分阶段实施任务。
- [x] 完成独立 review、bug 检查和第一性原理复核。
- [x] 更新当前主线、工作树和 live-process 所有权事实。
- [x] 首批阶段一/二契约测试按预期失败。
- [x] 完成 Crime 初始/结果/编辑状态减负。
- [x] 完成结果渐进披露与互斥规则。
- [x] 完成 Help 风格、视觉 token、移动滚动和无障碍统一。
- [x] 完成定向、全量、构建、bundle、浏览器和视觉验证。
- [x] 完成独立 code review、bug 检查和第一性原理复核。
- [x] 回顾阶段三既有假设、任务记录和 Phase 1/2 结果。
- [x] 映射 `focusMode`、query state、URL、saved analysis、Diary 数据范围、feature flag、analytics 和 bundle 边界。
- [x] 研究任务导向首体验、可逆个性化、位置隐私、犯罪数据误解防护、用户研究和实验 guardrail 的官方依据。
- [x] 完成历史阶段三独立架构复核，当时明确 S3.0/S3.1/S3.2 participant 闸门；当前只继续采用其中的状态、bundle、隐私和能力边界。
- [x] 更新阶段三执行记录；本轮未修改产品代码或启动额外服务。
- [x] 记录个人项目无法招募受试者的约束，并将原 S3.0 participant protocol 标记为历史方案。
- [x] 建立官方来源、同类官方产品、当前能力、认知走查和技术合同组成的证据阶梯。
- [x] 形成 H0-H6 场景、High/Medium/Low/Blocked 证据等级、当前支持、反例和停止条件。
- [x] 从场景推导 Crime/Diary 功能边界、桌面/移动 IA、渐进披露、视觉/动效和无障碍合同。
- [x] 推导 presentation API、二级 lazy focus、canonical preset transaction、bundle 和测试扩展边界。
- [x] S3-I1：完成 page-lifetime、presentation-only Crime task focus；Generic 默认，不写 storage，不改变 canonical query。
- [x] S3-I1 verification：query/map/URL/save/data 不变量、即时 DOM/Tab 顺序、手动 pane 不被抢、响应式/视觉和 bundle 均有通过证据。
- [x] S3-I2：完成显式 preset preview/cancel/apply/undo、exact diff、no-op、stale-preview 和单次刷新事务。
- [x] S3-C1/C2：独立分支完成真实已知路线 corridor 基础与方案 B 数据能力；没有用 Diary demo 或 UI 文案替代，原始提交已保留并合入 `main`。
- [x] S3 integration：提交 I1/I2 运行面，整合 C1/C2，解决共享文件，完成 combined 验证与最小 Crime lazy-chunk bundle admission。
- [x] S3 synchronization：产品提交已同步到 local main 与 origin/main；任务/注册表事实已收口，独立 Git worktree 已注销且本地分支已删除。
- [ ] S3-I3：若未来有稳定价值，再单独评估偏好持久化、远程 telemetry、隐私和生产 rollout。

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git status --short --branch` 与 `git worktree list --porcelain` | 单一 `main` worktree；大量既有未提交 WIP 已识别并保护。 |
| 端口与进程检查 | PID 74548 的 Vite 监听 `127.0.0.1:5173`；归类为外部/用户拥有。 |
| `GET /?mode=crime` 与 `GET /?mode=diary` | 两者均为 HTTP 200。 |
| 相邻任务记录检查 | Help Center、Crime 数据基础、犯罪高亮均已有完成与验证记录。 |
| 13 张运行态截图 | 覆盖桌面/移动 Crime、Help、Diary 当前路线/本地历史/社区示例；关键截图已逐张视觉检查。 |
| 浏览器日志检查 | 审计会话未发现 console warning/error；该结果不等同于完整功能测试。 |
| 隔离预览清理 | PID 60432 已停止，5201 端口已释放；既有 5173 仍由 PID 74548 监听并返回 HTTP 200。 |
| 源码结构核验 | 确认单一 Crime sidepanel、结果 drawer、advanced filters、Diary 三分区、现有 token/motion/reduced-motion 和未实现 GPS map matching 边界。 |
| 独立 evidence review | 6 项核心主张均有证据；要求把“同权重”“没有视觉效果”“Diary 没有层级”“完全没有角色内容”等绝对说法收窄。 |
| 独立 first-principles critique | 不批准直接实施 lens；路线图改为 P0 通用减负、P1 移动/无障碍/视觉统一、P2 可逆任务焦点实验，并分离 `focusMode` 与显式 `queryPreset`。 |
| 测试先行证据 | setup/results、Data details 多节点同步、District Incident log、A+B context、Help 对比度/动效等新契约均先观察失败，再完成最小修复。 |
| 最终 `npm run validate` | 退出码 0；全部数据、逻辑、UI 与 P1 合约通过，`ui-p0` 101/101、P1 accessibility/design 19/19、视觉基线策略 66/66；fresh manifest build 与 bundle policy 同轮通过。 |
| 阶段一/二关键视觉套件 | 19 passed、8 skipped；覆盖 desktop/portrait/landscape、360/390/768/1440 overflow、键盘流、200% scaling 和 axe serious/critical 扫描。 |
| S3-I1/I2 focused contracts | `crime_ui_contracts` 48/48、`crime_async_contracts` 28/28；覆盖 presentation-only、即时结果导航顺序、manual pane ownership、direct offense code、preview/no-op/stale/apply/undo 与单次刷新。 |
| Diary + tract-snapshot browser smoke | PASS；除既有 Crime/Diary、fallback、IndexedDB 流程外，新增验证 `codes=Thefts` 保留、Long-term 即时导航顺序、preset cancel 无副作用、apply 一次刷新、undo 完整恢复；`consoleErrors=0`、`pageErrors=0`。 |
| S3-I1/I2 + final visual rerun | Crime desktop/portrait/landscape 9/9 PASS。独立视觉审阅确认 Diary 差异来自已受测的私密备份 IA 与统一 Help 控件；只重建 15 张实际变化的 Win32 Diary baselines，最终无更新参数全矩阵 35 passed、10 designed skips、0 failed。远端 Ubuntu 首轮又证明 7 张 Linux Crime 基线仍是旧 UI；逐张检查 CI actual/expected/diff 后只同步这 7 张，不提高像素阈值。 |
| 独立最终 code review | 上轮 4 项发现全部修复；4 个静态/Node 契约文件 98/98 通过；原生 `<details name>` 未引入新的 P0/P1，当前无阻断。 |
| Git/进程收口 | `751b5ef`/`6f0c2c2` 均为 main 祖先，独立 Git worktree 已注销且分支已删除。任务没有重启或停止用户拥有的 5173；最终端口快照中 4173/4178/5173 均无监听。未手动执行生产部署。 |
| 阶段三仓库映射 | `focusMode` / `queryPreset` 不存在；展示状态、查询 store、Crime URL、saved analysis 和 Diary session data 的所有权边界已逐项确认。 |
| 通勤能力核验 | Diary 当前为 demo/local/sample 组合；`src/utils/match.js` 的 GPS map matching 仍为 TODO 并明确抛错，不得描述为真实路线风险能力。 |
| 实验基础核验 | 未发现产品行为 telemetry、A/B 分流或远程 collector；阶段三不能把业务 analytics API 当作实验系统。 |
| Final Stage 3 bundle gate | PASS；CI/Pages 等价功能开关构建测得 Entry 893181/241114，Crime 38580/13629，Route corridor 22908/7530，Task Focus 6070/2776，Query Preset 4934/1939，dist 3480819 bytes。主 Entry、Crime gzip 和全局 dist 上限未提高；只将 Crime raw 从 38500 最小调整到 38750，保留 170 bytes 余量。 |
| 官方研究 | GOV.UK、W3C、Microsoft、FTC/ICO、FBI/ONS/BJS 等一手来源支持任务验证、可跳过/可回退个性化、位置最小化、reported-crime 限制和 guardrail 设计。 |
| 历史 Stage 3 architecture/final review | 当时结论为 S3.0 protocol prep ready、S3.1 conditional、S3.2 blocked；其 Crime/Diary scope、focus/preset、canonical snapshot、route capability、bundle 与隐私边界继续有效，但 participant gate 已被用户约束取代。 |
| 用户约束修订 | 明确不招募受试者；旧 protocol/人数门槛保留为历史记录，不再作为当前执行 gate，也不把 desk research/AI walk-through 写成用户研究。 |
| 2026-08-05 外部检索 | CFPB/HUD、Philadelphia Atlas/Crime Incidents、Police.uk/Seattle data maps、FHWA、ONS/BJS/FBI、W3C/WCAG、USWDS 和 Apple HIG 等一手来源完成交叉验证。 |
| UI Pro Max design-system/UX/chart/stack searches | 保留 Accessible & Ethical、中性蓝色交互、visible focus、可跳过 onboarding、地图+文字替代、reduced-motion；拒绝 funnel、红橙绿风险语义、手写字体和无意义动效。 |
| Scenario model | H0/H5/H6=`High`，H1/H2/H3=`Medium`，H4=`Low/Blocked`；每个场景都有当前能力匹配、产品推论和 falsifier。 |
| IA and architecture review | 一个 Generic app shell、Crime/Diary 两个能力工作区、Crime 内两个可选 focus；I1 一个二级 lazy module + 窄 presentation API，I2 一个独立 canonical preset module。 |
| S3 implementation delivery | I1/I2=`ab8b72c`；C1=`751b5ef`；C2=`6f0c2c2`；integration=`b09d4a2`；reviewed visual closeout=`c48108f`。产品提交已推送到 `origin/main`；独立 Git worktree/branch 已清理，未执行生产部署。 |

## Open risks and remaining work

- 角色/任务优先级仍是 evidence-informed hypothesis，没有真实用户验证；最终方案必须保留通用入口、随时切换和删除 focus 的能力。
- 本轮不是完整 WCAG 合规测试、性能测试或真实用户研究；目标尺寸、读屏顺序和角色理解度需要单独验证。
- 主工作树仍保留 `.gitignore`、`src/style.css` 的既有行尾/index 噪声，以及用户拥有的日志、Playwright 报告和 `output/`；它们没有进入任何提交，也没有被删除。
- 默认 Entry 仍受 902665/247583 硬上限约束；本轮实测为 892948/240979。后续入口代码仍应优先删除、复用或进入 lazy boundary，不能把当前余量理解为无限预算。
- 原生 `<details name>` 已在项目当前 Chromium 自动化中验证；若产品要求较旧浏览器或额外浏览器引擎，需要单独补兼容性矩阵。
- Win32 Diary 的历史视觉漂移已在 expected/actual/diff 独立审阅后收口；未来 baseline 变化仍必须逐图审阅，禁止通过提高全局像素阈值掩盖回归。
- Task focus 与 query preset 已本地实现；长期角色持久化、remote telemetry、账户同步和强制 onboarding 均未实现，也没有被默认开启。
- 阶段三不会招募或执行参与者研究；旧人数与阈值只保留为历史方案，不能再描述为当前待办或统计结论。
- 当前 Generic UI 的真实任务完成率、理解正确率、寻找时间和信心没有用户基线；未来 focus 即使通过技术合同，也只能描述为可逆的产品假设，不能称为已证明改进。
- 真实已知路线 corridor 数据能力已进入 main，但仍没有最终用户 UI，且不能表达实时危险、未来风险或“更安全路线”。原始 GPS map matching 仍未实现。
- 远程 telemetry、长期偏好、账户同步和精确位置收集都需要单独的 purpose、consent、retention、deletion 和 jurisdiction review。
- 固定虚构场景仍用于认知走查和回归验收，但不能被报告为参与者行为或用户成功率。
- S3-I1 首轮只覆盖 Crime 的长期变化/日常居住；Diary 路线记录/回顾和真实通勤能力保持独立，不能通过 Crime focus 隐式切换模式。
- S3-I1/C2 合并后 Entry 为 892948/902665，主入口预算未提高；Crime lazy chunk 因两条调度边界实测超限而获得 500 raw/250 gzip 的最小预算调整。
- S3-I2 已从完整 canonical snapshot 合并 allowlisted 时间字段，用完整 before snapshot undo，并在 confirm 前拒绝过期 preview；后续扩展字段必须继续经过同一 allowlist 与 stale gate。
- C1/C2 与 I1/I2 的共享文件已人工组合；`npm run validate`、feature-enabled browser smoke、Crime 9/9 及全视觉矩阵均在 combined tree 上通过。
