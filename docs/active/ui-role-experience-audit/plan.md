# Plan

## Goal

基于当前可运行的 Crime 与 Diary 界面，完成一次证据化的 UI/UX、信息架构和角色化体验审计，并给出可分阶段执行的现代化优化方案；本阶段不修改产品代码。

## Scope

- 审计桌面与窄屏下的现有布局、信息密度、层级、导航、反馈、动效、视觉细节和可访问性风险。
- 比较 Crime 与 Diary 两个主要模式，以及 Help、筛选、结果、详情和地图之间的关系。
- 为购房者、当地居民和通行者定义共同核心与不同优先信息，而不是复制三套产品。
- 调研渐进披露、角色化默认视图、地图型决策工具、动效与无障碍的当前权威参考。
- 形成问题优先级、目标信息架构、视觉方向、实施步骤、验收标准与风险边界。

## Sources of truth

- 当前 `http://127.0.0.1:5173/` 的实际页面、DOM、交互与本次截图。
- `index.html`、`src/main.js`、`src/ui/`、`src/routes_crime/`、`src/routes_diary/`、`src/styles/` 和相关测试。
- `docs/active/help-center-redesign/`、`docs/active/crime-safety-data-foundation/` 与 `docs/active/crime-offense-map-highlights/` 中已完成工作的边界和验证证据。
- 当前官方/上游 UX、无障碍和动效指导；第三方产品仅作补充比较，不作为产品事实源。

## Stages

- [x] Stage 1: 确认仓库、工作树、现有预览和研究边界。
- [x] Stage 2: 映射现有界面结构、样式系统和关键用户流程。
- [x] Stage 3: 捕获并检查 Crime、Diary、Help 和窄屏关键状态。
- [x] Stage 4: 完成外部最佳实践与比较产品研究。
- [x] Stage 5: 综合问题、目标体验、视觉方向和分阶段任务。
- [x] Stage 6: 独立复核证据、优先级、可实现性与未验证风险。

## Acceptance criteria

- 每个重要发现都能追溯到当前截图、当前源码或明确引用的外部证据。
- 报告区分结构问题、交互问题、视觉润色问题、数据/产品边界和无障碍风险。
- 报告明确解释三类用户的核心任务、共同信息与优先顺序差异。
- 方案比较通用流程减负、任务焦点和查询预设三种层级；先完成通用流程减负，再以可逆实验验证任务焦点，不引入三份独立应用。
- 视觉建议包含颜色、圆角、阴影、间距、排版、动效和 reduced-motion 边界，并避免用装饰掩盖层级问题。
- 路线图按依赖和影响分阶段，包含任务、成功指标、验收方法、风险和非目标。
- 不把犯罪记录解释为确定的“安全/不安全”结论，不引入预测性执法或不透明单一评分。

## Non-goals

- 原始审计阶段不实现 UI；用户授权扩展后，仅在当前工作树完成阶段一/二本地实现，不提交、推送或部署。
- 不改变现有查询、指标、数据源、地图计算或犯罪分类。
- 不替用户做购房、居住或通行决策。
- 不把截图审计描述为完整 WCAG 合规验证或真实用户研究。

## Risks and constraints

- 当前 `main` 有大量未提交 WIP；本任务不得覆盖、格式化或清理这些改动。
- 5173 端口已有外部/用户拥有的 Vite 进程；只读复用，不重启、不停止。
- 地图和实时数据可能受网络、窗口覆盖范围和浏览器状态影响；必须明确截图与运行验证的限制。
- 三类角色的优先级目前是产品假设，需要后续用户访谈或可逆实验验证。

## Implementation extension: Phase 1 and Phase 2

### Authorization

- 2026-08-05：用户明确同意审计结论并授权执行阶段一与阶段二。
- 本扩展只实现通用流程减负、移动端/无障碍和视觉统一；不实现 P2 关注任务、角色持久化或查询预设。

### Implementation stages

- [x] I1: 以现有测试入口建立首批失败契约，锁住 Crime/Diary 查询、分享与本地历史行为。
- [x] I2: 初始状态隐藏 Crime 结果表面；有结果时显示结果并提供返回编辑入口。
- [x] I3: 查询完成后压缩设置为可编辑的分析条件摘要；恢复编辑不得清除查询或地图状态。
- [x] I4: 默认结果限制为总览、主要证据和地图上下文；事件、完整图表与技术设置后置。
- [x] I5: 移除嵌套 disclosure，并让同一工作区的深层 disclosure 互斥。
- [x] I6: 统一 Help Center 风格、层级 token、过渡和状态反馈，不新增依赖或字体。
- [x] I7: 移动端收敛为单一主要滚动 owner，补足焦点、目标尺寸、文本替代和 reduced-motion。
- [x] I8: 运行定向测试、完整验证、桌面/移动浏览器 smoke 与视觉复核；独立 review 后修复回归。

### Implementation acceptance criteria

- 初始 Crime 页面不显示 incident/chart unavailable 空壳，地图与必要输入保持可用。
- 产生分析后，无需滚动即可看出地点、时间范围、事件数量与主要变化；默认一级结果模块不超过三个。
- 已完成输入折叠为可编辑的分析条件摘要，恢复编辑不会静默改变或丢失当前查询。
- 同一工作区最多一个深层 disclosure 展开；没有 disclosure 嵌套。
- 360、390、768、1440px 无水平溢出；移动端只有一个应用自有的主要内容滚动 owner。
- 键盘可完成设置、查看摘要、进入详情、返回编辑和关闭 Help；主要控件保持 44/48px token，最低目标边界不退化。
- reduced-motion 下移除非必要高度、位移和地图飞行动效。
- Crime 查询、分享链接、Diary 本地历史、数据口径与地图计算保持不变。
- 现有用户 WIP、5173 预览、Git index、分支和远端不被本任务改写。

## Stage 3 review extension: task-focus validation

> Historical plan, superseded on 2026-08-05: the personal-project owner confirmed that recruiting and moderating participants is neither feasible nor appropriate. The protocol, sample-size and participant gates below remain as design history only. The active Stage 3 plan is the evidence-driven scenario model appended at the end of this file; it does not claim user validation.

### Authorization and current decision

- 2026-08-05：用户要求回顾阶段三并研究后续执行方式；本轮只更新研究与执行计划，不修改产品代码。
- 阶段三不是“立即做三种角色版本”，而是验证三类任务是否真的需要不同的信息顺序、说明或查询起点。
- 当前状态：`S3.0 READY FOR PROTOCOL PREP`；`S3.1 CONDITIONAL`；`S3.2 BLOCKED`，直到前一闸门有证据通过。

### First-principles question

用户无法完成任务时，必须先区分四种根因：

1. `discoverability`：信息已经存在，但用户找不到；
2. `comprehension`：用户看到了，但理解错误；
3. `capability gap`：产品没有完成任务所需的数据或能力；
4. `data availability`：数据源 unavailable、fallback、sample 或范围不足。

只有第一类为主，且第二类能通过信息顺序或说明改善时，才应实现 `focusMode`。能力和数据缺口不得用界面个性化掩盖。

### Recommended execution stages

- [x] S3-R1: 复核当前 store、Crime URL、saved analysis、Diary 数据范围、feature flag、analytics 和 bundle 边界。
- [x] S3-R2: 使用官方/标准来源研究任务导向首体验、渐进披露、可逆个性化、位置隐私、犯罪数据误解防护和用户测试方法。
- [x] S3-R3: 完成独立架构复核，确定 `focusMode`、`queryPreset`、持久化、URL 和 telemetry 的所有权边界。
- [ ] S3.0 protocol prep: 冻结 discussion guide、虚构 fixture ledger、正确答案与数据状态、环境/feature flag、每次会话重置步骤、scorecard，以及参与者同意、录屏、访问、保留和删除规则。
- [ ] S3.0 research: 协议复核通过后，用当前 Generic 版本建立真实用户任务基线；不改运行时代码，不输入真实住址、工作地址或家庭路线。
- [ ] S3.0 gate: 将失败归类为 discoverability、comprehension、capability 或 availability，并决定是否需要界面焦点实验。
- [ ] S3.1: 仅在 S3.0 通过后，为 Crime 的 `long_term` / `daily_living` 实现 feature-flagged、second-level-lazy、presentation-only 的 `focusMode` 研究原型。
- [ ] S3.1 gate: 对照 Generic 与可选任务焦点，验证完成率、寻找时间、理解、可逆性和技术不变量。
- [ ] S3.2: 仅在 S3.1 通过后，实现独立的 `queryPreset` preview / cancel / apply / reset 流程。
- [ ] S3.3: 只有前述功能产生稳定价值后，另行评估偏好持久化、远程实验、collector、consent、retention 和删除机制。

### Candidate task language

首轮使用“本次要完成的任务”，不用身份标签：

- `general`：浏览全部；
- `long_term`：比较一个区域的长期变化；
- `daily_living`：查看日常居住周边情况；
- `route_journal`：记录或回顾一段路线体验；仅用于 S3.0 的 Diary 能力/理解研究，不进入首轮 Crime `focusMode`。

在真实 GPS、路线匹配和路线犯罪分析能力完成前，不得把 `route_journal` 写成“找出更安全的通勤路线”。

### State and trust boundaries

| State or action | Owner | Changes request/data | Share URL | Persistence |
| --- | --- | ---: | ---: | ---: |
| `focusMode` | S3.1 experiment local memory | No | No | No in S3.1 |
| `queryPresetPreview` | S3.2 preset controller local memory | No | No | No |
| Confirmed preset fields | Existing Crime store/canonical state | Yes | Encode actual fields | Existing behavior only |
| Study variant | Research build config | No | No | No |
| Study events | Default none; manual scorecard | No | No | No |

`focusMode` may only change module order, default emphasis, explanatory copy and CTA. It must not change time range, radius, offense groups, geography, per-capita settings, classification, API requests, map calculations, saved analysis or displayed totals.

`queryPreset` is a separate explicit action. It must show the exact proposed field changes, offer cancel, apply only after confirmation, trigger exactly one refresh, update the canonical URL with actual fields, and offer reset/undo. The URL must not rely on a preset name as its source of truth.

Preset implementation must start from a full canonical snapshot (`decodeCrimeViewState(encodeCrimeViewState(store))`), merge only allowlisted non-location fields into that snapshot, and save the complete before snapshot for undo. A partial preset object must never be passed directly to `replaceCrimeViewState()`, because omitted fields are canonicalized to defaults and existing locations/selections are cleared before restore.

### S3.0 research protocol

- Before recruitment, protocol prep must define immutable scenario IDs, credible fictional locations/routes, the expected answer and acceptable alternatives, exact data/coverage/fallback state, required flags, reset procedure, facilitator prompts, scoring rubric, consent, recording policy, who can access notes, retention period and deletion step.
- First pilot after protocol sign-off: proposed 9 likely users, split across long-term, daily-living and route-journal tasks; this is an exploratory product decision sample, not a statistical significance claim.
- If patterns are stable, run a confirmation round with five people per task family before coding P1.
- Use credible fictional Philadelphia locations and route scenarios. Do not ask participants for their real home, work, school or family route.
- Limit each participant to at most five believable, answer-neutral tasks. Record independent completion, time to first relevant evidence, wrong-entry count, help usage, perceived ease/confidence and interpretation of limitations.
- Require participants to distinguish historical reported records from live alerts or safety predictions, `unavailable` from zero incidents, and Diary sample/local content from verified community observations.

### Go, no-go and stop conditions

S3.0 to S3.1 proposed gate:

- In each confirmation task family, at least 4/5 identify the same two evidence needs;
- The Generic version has a repeatable discoverability cost, rather than a missing-data/capability problem;
- Task-focus wording can be understood without suggesting that the product decides safety or changes the query automatically.

If Generic already reaches 4/5 independent completion with correct interpretation and no meaningful excess in search time, wrong turns or false confidence, do not implement focus merely for visual personalization.

S3.1 to S3.2 proposed gate:

- Compared with control, at least one primary metric improves: independent completion by at least 1/5, or median time to relevant evidence by at least 20%;
- Trust and comprehension do not worsen;
- Every focus switch preserves `encodeCrimeViewState(store)`, request filters, totals, map selection and current result data;
- Users can return to Generic and understand how to edit the underlying filters;
- Accessibility, browser smoke, bundle and validation gates pass without increasing the existing entry budget.

Immediate stop conditions:

- Commute failures are caused mainly by absent real route/GPS data;
- Any focus switch changes a query field, refreshes the API or moves the map;
- Any participant interprets focus as an official safety/risk classification and copy cannot repair it;
- Warnings, source status, `unavailable` state or limitations become hidden;
- Telemetry includes URL, address, coordinates, geography ID, route/incident ID, free text or API response;
- Entry or Crime bundle can pass only by raising the existing hard budget.

### Implementation constraints if S3.1 is admitted

- Default flag OFF. Use an internal/facilitated research build before any remote rollout.
- S3.1 first covers only Crime `long_term` and `daily_living`. Diary `route_journal` remains a separate capability/understanding lane and, if later admitted, must load from Diary's own lazy boundary rather than a shared Crime coordinator.
- Do not add an always-loaded focus coordinator to `main.js` or other initial-entry modules. The current built Crime chunk is 37,604 / 38,000 raw bytes and 13,221 / 13,500 gzip bytes, leaving only 396 raw / 279 gzip bytes. Load the experiment as a second-level lazy chunk from the existing lazy Crime route, update the manifest contract intentionally, and keep both existing Entry and Crime budgets unchanged.
- If the minimal flag/loader cannot fit the Crime budget, remove or reuse existing code or redesign the hook; do not raise the budget to admit the experiment.
- Keep Generic as the default and provide skip, change and reset actions. Do not infer a focus from addresses, viewed modules, Diary usage or saved analyses.
- Do not add a dependency, account, cloud sync, background location tracking or telemetry in the first S3.1 build. Manual observation and the protocol scorecard are the source of truth; any later event collection is a separate necessity/privacy review.
- Keep all existing “reported incidents, not safety prediction” and sample/local/unavailable boundaries visible in every focus.

### Stage 3 acceptance criteria

- Research evidence separates observed behavior from product assumptions and capability gaps.
- The task-focus prototype, if admitted, is optional, reversible, presentation-only and disabled by default.
- `focusMode` is absent from Crime query state, share URL and saved analysis artifacts.
- Presets never apply implicitly; preview/cancel/apply/reset behavior is visible and testable.
- No precise location or route data is collected for research, and no remote event collector is introduced without a separate privacy decision.
- Existing entry bundle ceiling remains unchanged; `npm run validate`, focused contracts, feature-enabled browser smoke and the required visual/accessibility matrix pass before any completion claim.

### External evidence used for the Stage 3 decision

- [GOV.UK: Start by learning user needs](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs)
- [GOV.UK: Using moderated usability testing](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing)
- [GOV.UK: Usability benchmarking a website or whole service](https://www.gov.uk/service-manual/measuring-success/usability-benchmarking-a-website-or-whole-service)
- [Microsoft: First experience](https://learn.microsoft.com/en-us/windows/win32/uxguide/exper-first-exper)
- [W3C WAI: Let users choose a familiar interface](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o8p04-interface/)
- [W3C: Geolocation privacy considerations](https://www.w3.org/TR/geolocation/)
- [FBI UCR: Caution against ranking](https://ucr.fbi.gov/crime-in-the-u.s/2013/crime-in-the-u.s.-2013/resource-pages/caution-against-ranking)
- [Microsoft Research: Patterns of trustworthy experimentation](https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/)

## Stage 3 active revision: evidence-driven scenario model

### Authorization and truth boundary

- 2026-08-05：用户明确说明个人项目不会、也不能招募受试者，并要求基于既有假设继续广泛检索，依次产出场景假设、功能、UI 布局和必要的代码结构。
- 本阶段产出是 `evidence-informed hypotheses`，不是访谈、可用性测试或已验证用户需求。
- 当前状态：`S3-D0/D1/D2/D3 COMPLETE`；`S3-I1/S3-I2 COMPLETE LOCALLY`；独立分支中的 `S3-C1/C2 READY FOR INTEGRATION`，尚未与当前主工作树合并。
- 研究阶段最初只更新研究、设计和实现合同；在用户后续明确授权后，当前主工作树已完成 S3-I1/I2 本地实现与验证，但仍未 commit、push 或 deploy。

### Replacement validation method

无法获得参与者证据时，按以下证据阶梯降低不确定性，而不伪造确定性：

1. 官方公共服务、标准和方法论是否证明该任务真实存在；
2. 多个官方公共数据产品是否收敛到相似的查询和展示模式；
3. 当前产品是否真的拥有完成任务所需的数据与能力；
4. 用固定虚构场景执行认知走查、反例检查和误解审查；
5. 用状态、URL、请求、地图、保存、bundle、无障碍和浏览器合同证明实现没有副作用；
6. 未来如自然获得真实反馈，再修正假设，但它不是当前阶段的阻塞条件。

证据等级：

- `High`：官方来源直接支持任务，且当前产品能力匹配；
- `Medium`：任务有官方证据，但信息顺序或默认值仍是产品推论；
- `Low`：只有邻近产品类比，或当前产品缺少核心能力；
- `Blocked`：实现会制造产品目前无法兑现的结论或数据能力。

### First-principles segmentation

不把人固定成三种 persona，而把一次使用拆成可切换的任务：

- 同一个人可能今天比较长期居住地，明天查看住处周边，后天记录路线体验；
- 身份不应写入 URL、saved analysis、session 或远程画像；
- Generic 始终是默认和完整入口；
- 任务焦点只降低查找成本，不能替用户作判断；
- Crime 与 Diary 是两套真实能力边界，不能为了角色对称而混成三份 UI。

### Scenario hypotheses

| ID | Trigger and job | Evidence | Current support | Hypothesis and falsifier |
| --- | --- | --- | --- | --- |
| H0 Generic orientation | 用户先想知道这里能查什么、数据到何时、是否实时。 | High | Crime 数据状态、Help、通用查询已存在。 | 默认入口应直接可用且不强制分类。若任务选择比直接查询更慢或更难理解，保持 Generic 即可。 |
| H1 Long-term place comparison | 比较两个候选居住地在同一口径下的长期 reported incidents、构成和变化。 | Medium | Crime 支持长期趋势、A/B、类别、来源与保存。 | 优先时间覆盖、A/B 和类别变化会降低查找成本。若只是换标题或不同口径无法保持一致，就删除该 focus。 |
| H2 Daily nearby review | 查看家、学校、商店或停车地点周边在所选历史时期内发生过什么。 | Medium | Crime 支持单地点、半径、近期记录、类别、地图与事件列表。 | 优先总览、地图、常见类别与事件能提高可读性。若被理解为实时告警或个人风险，就回退文案/排序。 |
| H3 Route journal | 记录或回顾一条演示/本地路线的个人体验。 | Medium | Diary 有 demo route、local history 和 sample community。 | 只在 Diary 中强化 Demo/Local/Sample 层级；不得进入 Crime focus，也不得称为真实路线安全。 |
| H4 Route-corridor history | 查看一条真实路线明确缓冲区附近的历史 reported incidents。 | Low | 当前没有 GPS matching、真实路线走廊查询或可靠的 route-to-crime contract。 | 作为未来 capability discovery；在缓冲区、近似点、缺失率和文字替代无法解释前保持 Blocked。 |
| H5 Urgent/live safety | 用户误把应用当成正在发生事件的实时警报。 | High | 产品只有历史记录。 | Risk severity: High。每个结果层都必须清楚表明非实时，并引导紧急情况使用当地官方渠道；绝不添加伪实时视觉。 |
| H6 Private/manual location | 用户想查常去地点但不愿提供精确 GPS。 | High | 当前可手动输入/地图选点。 | 继续以手动输入为默认；仅在用户主动触发位置功能时请求权限，拒绝后不阻断主流程。 |

### Derived function model

#### S3-I1: low-regret presentation focus

- Crime 内提供可跳过的 `本次关注`：`general`、`long_term`、`daily_living`；默认 `general`。
- 选择只改变模块优先级、标题说明和首层强调；显示“只调整信息顺序，查询条件和结果没有变化”。
- `long_term` 首层：覆盖/趋势、A/B 比较、类别变化；时间不足时提示编辑，不自动改月份。
- `long_term` 没有地点 B 时，用“添加比较地点”替代空 A/B 模块；空模块不占用三个首层名额。
- `daily_living` 首层：所选时期总览、地图上下文、常见类别/事件；不称实时、风险或安全等级。
- 所有 focus 始终显示地点/范围、时间、数据状态、来源、`reported records != safety prediction` 和 `unavailable != zero`。
- Crime 顶部状态不再单独写含混的 `Live`; 使用 `Data available · records through {date}` / `数据可用 · 记录截至 {date}`。Diary 则显示 `Demo`、`Local` 或 `Sample`，不复用 Crime 的实时感文案或绿色安全暗示。
- 现有固定 `Homebuyer view` 改为中性的 `Long-term context` / `长期背景`，避免把一个模块伪装成完整购房产品。
- Diary 保持独立导航；任务入口可显式跳转到 Diary，但不得静默切换模式。
- 不持久化、不进 URL、不进 saved analysis、不触发请求、不移动地图、不增加 telemetry。

#### S3-I2: explicit query presets, separate from focus

- 只有用户主动点击“查看建议设置”后，才显示字段差异。
- 首批只考虑可解释的时间窗口建议，例如 `latest-24-months` 与 `latest-6-months`；不自动选择 offense groups，不生成“安全类别组合”。
- 两个首批 preset 都只产生 `startMonth` 与 `durationMonths` patch，并复用现有 recent-window helper 按已确认的 coverage end 计算；coverage unavailable 时不生成 preview。
- `preview` 和 `cancel` 不改变 store；`apply` 经确认后恰好刷新一次；`undo` 恢复完整 before snapshot。
- 从 `decodeCrimeViewState(encodeCrimeViewState(store))` 得到完整 canonical snapshot，只合并 allowlisted 非位置字段。
- 确认前重新读取 canonical state；如果它与 preview 的 before snapshot 不同，说明用户已经编辑了查询，必须让 preview 过期并重新生成。
- 禁止把 partial preset 直接传给 `replaceCrimeViewState()`；URL 只编码实际查询字段，不依赖 preset 名称。
- A/B 是显式用户动作；preset 可提示“添加比较地点”，不能静默创建 B 或拿城市平均替代。
- Confirm 通过注入端口按一次事务执行：`replaceCanonical -> syncControls -> writeCanonicalUrl -> clearCurrentArtifact -> requestSingleCrimeRefresh`。Undo 在 after snapshot 仍为当前状态时，用 before snapshot 执行同一单刷新流程；不得重复写 URL 或绕过 main-owned refresh coordinator。

#### S3-C1: future route capability, not a UI shortcut

- 需要真实路线来源、GPS/map matching、路线缓冲区、事件空间关联、覆盖/缺失解释、隐私合同和可访问列表替代。
- 结果只能表述为“路线附近、所选历史时段内的 reported incidents”，不能表述为发生在路线本身、实时危险或更安全路线。
- 照明、交通冲突、施工、天气、客流、无障碍和犯罪记录是不同维度；禁止合成不透明总分。

### Target information architecture

```text
App shell
├─ Header: product / Crime / Diary / Help / language
├─ Mode-aware trust strip
│  ├─ Crime: source / coverage / update / historical-not-live / unavailable-not-zero
│  └─ Diary: Demo-Local-Sample / device storage / sharing status / availability
├─ Crime workspace
│  ├─ Optional task focus: Generic / Long-term / Daily nearby
│  ├─ Query setup or compact analysis context
│  ├─ Map
│  └─ Evidence workspace: Overview / Incidents / Trends / Method
└─ Diary workspace
   ├─ Current demo route
   ├─ Local history
   ├─ Sample community
   └─ Permanent Demo / Local / Sample scope labels
```

Desktop initial state:

```text
┌──────────────── header + trust strip ─────────────────┐
│ query rail 320-360px │ map                             │
│ focus: Generic       │ legend + visible data status    │
│ place / time / scope │                                 │
│ advanced filters ▸   │                                 │
│ [view records]       │                                 │
└──────────────────────┴─────────────────────────────────┘
```

Desktop result state:

```text
┌──────────────── header + trust strip ────────────────────────────┐
│ analysis context │ map                         │ evidence 360-400 │
│ focus/place/time │                             │ Overview         │
│ scope            │                             │ primary evidence │
│ [edit analysis]  │                             │ spatial context  │
│ quick navigation │                             │ details ▸ Method │
└──────────────────┴─────────────────────────────┴──────────────────┘
```

Mobile state:

```text
┌──────── header ────────┐
│ mode-aware trust status│
│ map 36-42vh            │
│ [full map] [list view] │
├──── single bottom sheet┤
│ focus + analysis context│
│ Overview / evidence    │
│ Incidents ▸ Charts ▸   │
└────────────────────────┘
```

Mobile keeps one main content scroll owner. The focus selector opens a radio sheet or compact dialog; it is not a horizontal segmented control with truncated bilingual labels.

### Progressive disclosure contract

- Layer 0, never hidden: active mode and scope, edit action, plus the mode-specific trust facts above. Crime keeps location/time/source/coverage/historical-not-live/unavailable-not-zero; Diary keeps Demo/Local/Sample/device-storage/sharing status.
- Layer 1, at most three modules: overview, focus-relevant evidence, spatial context.
- Layer 2, on request: full incident list, full charts, detailed A/B and category breakdown.
- Layer 3: methodology, classification, fallback/sample details, export and display settings.
- One deep disclosure at a time; no nested `<details>` and no independent competing deep-scroll surfaces.

### Visual and motion direction

- Keep the existing calm civic palette: neutral surfaces, dark readable text and one blue interaction accent. Do not use red/amber/green to imply area quality.
- Use hierarchy before decoration: typography, 8/12/16/24 spacing, separators and module order carry most of the structure.
- Card radius `12px`; sheet/modal radius `16px`; do not wrap every nested section in another rounded card.
- Shadows are reserved for floating map controls, Help/dialogs and the mobile sheet; ordinary information blocks use border and spacing.
- Hover/focus feedback `120-180ms`; panels `160-220ms` with at most `4-8px` movement. Focus reordering uses a short opacity transition, not large movement or bounce.
- `prefers-reduced-motion` removes positional motion, smooth scrolling and map fly animations; focus and status changes remain available through text/ARIA.
- Gradients, if retained, are subtle non-semantic surface decoration only; never encode crime intensity, safety or ranking.
- No new font or UI dependency; retain current typography to protect bundle, loading and bilingual behavior.

### Minimal future code structure

S3-I1 should add only one product module unless size or test evidence proves a split is needed:

```text
src/routes_crime/task_focus_controller.js
  - TASK_FOCUS_CONFIG
  - pure presentation derivation
  - page-lifetime in-memory focusMode owner
  - calls a narrow workbench presentation port
```

Existing files to extend:

```text
index.html                         independent always-on Homebuyer -> Long-term copy correction
src/ui/panel.js                    expose the narrow existing Crime presentation API and mount
src/main.js                        pass that API into the already-lazy Crime controller
src/routes_crime/index.js          feature check + second-level dynamic import
src/styles/workbench-shell.css     existing workspace hierarchy and motion tokens
scripts/tests/crime_ui_contracts.mjs
scripts/tests/runtime_contracts.mjs
scripts/tests/product_integrity_contracts.mjs
scripts/tests/crime_async_contracts.mjs
scripts/tests/mode_ui_contracts.mjs
scripts/tests/browser_smoke.mjs
scripts/tests/visual_experience.spec.mjs
scripts/tests/bundle_policy.mjs
```

The lazy focus module should register its small bilingual message pairs through the existing on-demand i18n registration pattern. Do not expand the always-loaded message catalog or add a permanent i18n file for an unproven feature. If the focus is later admitted as a stable product surface, its copy can move into the existing lazy P1 message boundary.

The lazy controller owns only page-lifetime `focusMode` plus pure configuration. `crime_workbench` / `panel` remain the sole owners of DOM, pane selection and focus management. The narrow API should expose mount/sync/getResultPane plus `applyTaskFocusPresentation(config)`; it must not expose store mutation or allow the lazy controller to query/reorder arbitrary DOM. Because `panel.js` and `main.js` are in the initial entry, their adapter bytes must be offset by deletion or migration and proven by a build; moving the main controller to a lazy chunk does not by itself solve the 5-byte Entry limit. A DOM adapter that simulates button clicks may be used only for a disposable spike, not as the production ownership contract.

The Homebuyer-to-Long-term wording correction is an independent always-on copy fix, not a focus feature. With I1 disabled, parity means no focus UI and unchanged behavior, query, accessibility semantics and product data; it does not require byte-identical HTML copy.

S3-I2, only if admitted, adds one independent module:

```text
src/routes_crime/query_preset_controller.js
  - allowlisted preset definitions
  - full-snapshot preview/diff
  - confirm/cancel/undo transaction
  - injected ports: readCanonical / replaceCanonical / syncControls
  - injected ports: writeCanonicalUrl / clearCurrentArtifact / requestSingleCrimeRefresh
```

Do not create a global persona store, three route trees, a shared always-loaded coordinator, a new analytics system or a generic personalization framework. If the single I1 module becomes difficult to test, split pure config/derivation into `task_focus_contract.js`; do not pre-create that abstraction.

### Bundle and state admission

- Entry budget remains `902,665` raw bytes; the current build left 5 bytes and cannot accept an always-loaded coordinator.
- Crime budget remains `38,000` raw / `13,500` gzip; the last verified build left 396 raw / 279 gzip bytes.
- Load S3-I1 as a second-level lazy chunk from the existing lazy Crime route and update the exact manifest contract intentionally.
- A feature flag is optional for local admission, but the architecture must not require a permanent study framework. Default Generic behavior must remain available with the module disabled.
- Bundle budgets are not raised to make the feature pass.
- Generated CSS and total-dist budgets remain unchanged and must pass together with the Entry/Crime JavaScript budgets.

### Validation without participant claims

- Execute each frozen fictional scenario in Generic and each focus; record whether the required evidence is present, whether the task is actually supported, and which caveat remains visible.
- Perform an adversarial wording pass for `safe`, `unsafe`, `risk score`, `best`, `avoid`, `live`, `prediction` and unavailable/zero confusion.
- Assert focus switching preserves canonical Crime state, `getFilters()`, API generation, map selection, totals, result data, URL and saved artifact.
- Assert feature disabled has no task-focus UI and preserves current Generic behavior, query, accessibility semantics and data; the independent neutral copy correction may remain.
- Assert a focus may choose the initial pane for a new analysis but never repeatedly override a pane the user selected manually.
- For preset preview, invalidate the transaction if the canonical state changed after preview; do not overwrite newer user edits.
- Verify visual order, DOM order, Tab order and screen-reader order remain consistent after focus changes.
- Audit map alternatives as an I1 prerequisite: point/radius uses incident list plus range summary; district/tract uses selected-area label plus totals/category table; Diary uses route/segment list plus local history. A future route corridor cannot ship until it has its own segment/table alternative.
- Verify keyboard, ARIA announcement, 360/390/768/1440, 200% zoom, Chinese/English and reduced-motion.
- Run focused contracts first, then `npm run validate`, feature-enabled browser smoke, visual matrix and unchanged bundle ceilings.
- Report this as product-contract and scenario-walkthrough evidence, never as user-success evidence.

### Active execution stages

- [x] S3-D0: replace impractical participant recruitment with an explicit evidence hierarchy and truth boundary.
- [x] S3-D1: research official homebuying, resident crime-map, traveler information, privacy, accessibility and risk-communication sources.
- [x] S3-D2: derive falsifiable H0-H6 scenarios, current capability fit and stop conditions.
- [x] S3-D3: derive function priorities, desktop/mobile IA, visual direction and minimal code boundaries.
- [x] S3-I1: second-level-lazy, page-lifetime, presentation-only Crime task focus implemented locally.
- [x] S3-I1 verification: query/map/URL/save/data invariants, accessibility, responsive visual behavior and frozen bundle contracts passed.
- [x] S3-I2: explicit preset preview/cancel/no-op/stale/apply/undo transaction implemented locally after I1 stabilized.
- [x] S3-C1: known-route corridor foundation and方案 B historical-data slice delivered in the independent ready-for-integration branch; raw GPS map matching and final UI remain explicitly out of scope.

### Acceptance and stop conditions

- Every scenario states evidence strength, current support, product implication and falsifier.
- Generic remains complete, default and recoverable; a focus never becomes an identity.
- Focus does not change numbers or data; preset never applies implicitly.
- Before I1 ships, every affected map state has the mode-appropriate text/list alternative defined above; warnings and source status remain visible.
- No design says safe/unsafe, ranks neighborhoods, recommends buying, predicts events or recommends a safest route.
- Stop a focus if it only changes marketing copy, duplicates UI, hides limitations or requires identity/location profiling.
- Stop route work until real matching, corridor semantics, privacy and data-quality contracts exist.

### Additional external evidence

- [CFPB: Find the right home](https://www.consumerfinance.gov/owning-a-home/explore/find-the-right-home/)
- [HUD: Homebuying checklist](https://www.hud.gov/sites/documents/checklist-en.pdf)
- [City of Philadelphia: Atlas](https://atlas.phila.gov/)
- [City of Philadelphia: Crime incidents 2006-present](https://data.phila.gov/visualizations/crime-incidents/)
- [Seattle Police: Online data maps](https://www.seattle.gov/police/information-and-data/data/online-crime-maps)
- [Police.uk: About crime map data](https://www.police.uk/pu/about-police.uk-crime-data%C2%A0)
- [FHWA: Traveler information needs and decision-making](https://www.fhwa.dot.gov/publications/research/safety/17014/002.cfm)
- [ONS: Crime in England and Wales QMI](https://www.ons.gov.uk/peoplepopulationandcommunity/crimeandjustice/methodologies/crimeinenglandandwalesqmi)
- [FBI UCR: Caution against ranking](https://ucr.fbi.gov/crime-in-the-u.s/2010/crime-in-the-u.s.-2010/caution-against-ranking)
- [W3C: Geolocation privacy considerations](https://www.w3.org/TR/geolocation/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [USWDS: Accessible data visualizations](https://designsystem.digital.gov/components/data-visualizations/)
- [USWDS: Card guidance](https://designsystem.digital.gov/components/card/)
- [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
