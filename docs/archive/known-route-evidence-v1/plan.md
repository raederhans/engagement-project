# Known Route Evidence v1

## Goal

串行建立在 exact cumulative candidate
`b78ee20816d1f14703aa8670ca24e8ae0ff3e010` 上执行 DFEV1 Milestone 4。将现有
Known Route 从历史 corridor 辅助入口升级为用户可完成的证据分析任务：用户在浏览器
会话中绘制或导入一条已知路线，显式同意 disclosed public-source query 后，系统用真实
Philadelphia street centerline 做 fail-closed map-match，并分别呈现 reported-incident、
HIN/crash 与 accessibility 的 route/segment evidence、coverage 和 uncertainty。

用户委派原文是范围、状态与验收权威。本记录只保存可恢复的执行基线，不把 M0-M3
local candidate、官方 API 可达性、bounded smoke、row count、hash 或本地验证扩大成
main、remote CI、部署、citywide validity、routing authority 或产品安全结论。

## Scope

- 严格验证 GeoJSON/manual known route 的坐标、Philadelphia bbox、点数、长度、重复、
  精度、jump、自交、transport mode 与 schema/data version；恶意/超大/污染对象 fail closed。
- 使用 City of Philadelphia `Street_Centerline` 的真实 geometry、`seg_id` 和 node 字段建立
  session-only source catalog；metadata/query/metadata 绑定同一 data edit version。
- 只做 mode-neutral centerline matching。未发布 one-way domain、步行/自行车 access、
  sidewalk、curb-ramp 和 wheelchair 字段不被推断为 transport/accessibility authority。
- 建立 deterministic route canonicalization、candidate resolution、matched edge chain、
  corridor identity 和 rerun/checkpoint contract；off-network、ambiguous、disconnected、
  source drift 与 response truncation fail closed。
- M1 generalized PPD coordinates 只以 disclosed uncertainty corridor 方法进入本地 aggregate
  builder；禁止 precise snap、street-segment crime attribution 或事件级 tracked/browser output。
- HIN 使用已审查的 2025 City snapshot，继续表达 2019-2023 historical planning evidence、
  near/intersects relation 和 partial 状态；raw crash/accessibility 没有独立 admission 时保持
  unavailable，不制造零值、mock 或代理量。
- 输出 route-level 与 matched-corridor contributions；同一 evidence dimension 内可加总，
  不跨量纲合成总分，不产生 safest route、street safety、personal risk 或 causal claims。
- 精确路线、端点和通勤模式默认仅在会话内；share state、普通日志、tracked artifact、
  telemetry 和 URL 不得包含 coordinates/polyline/address/destination/source record IDs。
- 在现有 Vanilla JS/Vite、Known Route drawer、map、bilingual、Source Health、HIN 和
  fail-closed contracts 上扩展一个独立 lazy boundary，不向 Home Compare chunks 回灌。

## Sources of truth

- 当前用户对 M4 的完整委派、禁止项、最低测试和最终交付要求。
- Exact starting candidate `b78ee20816d1f14703aa8670ca24e8ae0ff3e010` 的代码、测试、
  tracked M2 no-promotion serving report、M3 source/privacy/share contracts 和 bundle ceilings。
- Strict-read-only M1 root
  `C:/Users/raede/.codex/worktrees/c180/engagement_project/.dfev1/crime/full-2026-08-21-v2`。
- Strict-read-only M2 root
  `C:/Users/raede/.codex/worktrees/fed9/engagement_project/.dfev1/area-intelligence/m2-baseline`。
- 必要时只读的 M3 aggregate/schema root
  `C:/Users/raede/.codex/worktrees/d7da/engagement_project/.dfev1`。
- `docs/AGENTS.md`、当前 package-lock、`manage-task-records`、
  `orchestrate-live-tests` 与 `write-lore-commits` contracts。
- City Street Centerlines catalog/API/terms、City Vision Zero 2025/HIN official material、
  PennDOT public crash documentation；外部事实绑定本轮观测时钟和 source version。

## Stages

- [x] Stage 4A: 核验 exact Git/base/clean/instructions，记录 M1/M2/M3 初始只读
  inventory/mtime/manifest identity，并完成 bounded official source/licensing research。
- [x] Stage 4B: 冻结 route schema、privacy disclosure、source registry、map-match、corridor、
  contribution、unavailable 与 ignored artifact/checkpoint contracts。
- [x] Stage 4C: 实现真实 City centerline acquisition/admission、deterministic map-match 和
  M1 generalized-event corridor aggregate builder，保留 HIN/crash/accessibility独立状态。
- [x] Stage 4D: 在独立 Known Route lazy boundary 完成 bilingual route workflow、evidence
  cards、segment drill-down、limitations、privacy/share 和 accessibility contracts。
- [x] Stage 4E: 运行 focused/security/privacy tests、bounded official/public-route smoke，
  资源允许时运行完整 M1 warehouse aggregate/idempotency。
- [x] Stage 4F: 由唯一 live owner 运行 lint/style、production build、bundle、final-dist
  browser smoke 和完整 `npm run validate`，清理进程并复核上游 identity/package/隐私。
- [x] Stage 4G: 按 Lore protocol 审查范围并创建本地小 commits，收口 exact candidate。

## Acceptance criteria

- Route input 对 bbox/coordinate/precision/point/length/jump/duplicate/self-intersection/mode、
  GeoJSON shape、prototype pollution、HTML/URL injection 和体积限制有机器可检查的拒绝。
- 同一 normalized route 与同一 centerline data version 产生同一 matched edge order、
  corridor identity 和 contributions；重跑/恢复语义幂等。
- Official centerline catalog 校验 service item、last edit time、feature/schema/geometry、
  node/edge/connectivity 和 response completeness；off-network/ambiguity/disconnect fail closed。
- M1 hundred-block/generalized points只以不确定性 buffer/weight 形成 corridor contribution；
  ambiguous/unavailable 排除且计数，不向 edge 精确归因或泄露 record identity。
- HIN/crash/accessibility 各自携带 source vintage、coverage、precision、uncertainty、
  limitations 和 unavailable reason；admitted zero 与 unavailable 保持不同。
- Segment contributions 可加总至同维度 route aggregate；不存在跨来源/量纲总分、winner、
  route recommendation、safety/danger 或 personal-risk 输出。
- 精确路线、端点、polyline、地址、目的地、模式和 source record ID 不进入 tracked output、
  普通日志、share state、URL 或 telemetry；公共 API disclosure 与实际 request 一致。
- M2 保持 historical available / forecast unavailable / not-promoted；M3 source claims 仍
  partial，road/transit routing authority 仍 unavailable；M0-M3 contracts 和 ceilings 不退化。
- Focused、official smoke、full-warehouse（若安全可运行）、browser、build/bundle 和标准
  validation 有 fresh evidence；未运行 gate 明确列为缺口。

## Non-goals

- M5 candidate route generation、fastest/balanced/lower-exposure ranking、Pareto winner、
  rerouting、turn-by-turn、real-time navigation 或 automated safer-route advice。
- Diary/community backend、cloud sync、geolocation/GPS/background tracking、persistent route
  history、share URL、telemetry 或自动外发精确 geometry。
- 把 City centerline 当成工程测量、pedestrian/accessibility network、one-way authority，
  或把 HIN/PPD evidence 当成街段事故事实、绝对安全、因果或个人风险。
- 提高现有 bundle/source-health ceiling、框架重写、默认新增依赖、生产 mock、main/remote/
  refs/worktree topology/merge/rebase/cherry-pick/push/deploy。

## Risks and constraints

- 当前为 detached HEAD；只允许本 worktree 的小型 local commits，且不修改 refs。
- City centerline API 的 service data 可漂移、bbox query 可超 2,000 rows、node/one-way 字段
  可缺失；任一版本/完整性/ambiguity 问题必须 fail closed。
- Street Centerlines 官方只承诺 reference use，不保证工程精度；one-way domain、sidewalk、
  wheelchair、curb-ramp 与 pedestrian restriction 未发布，不能从字段名或缺失值推断。
- M1 canonical data 约 9.94 GB；完整扫描必须单 owner、ignored checkpoint/output/log、可恢复，
  且不得在日志或报告输出 event coordinates、generalized location、address 或 source IDs。
- M3 Home Compare controller 仅余 50 gzip bytes；M4 必须拥有独立 lazy chunk。Non-VRE dist
  仅余 46,868 bytes，所有现有 ceiling 保持不变。
- 外部 API 请求的 derived bbox 仍是位置敏感信息；没有发送前 disclosure/consent 时不得查询。
- 成功的 API、schema、hash、count、public landmark smoke 或本地 test 不证明 citywide
  completeness、scientific validity、route legality、accessibility 或 production authority。
