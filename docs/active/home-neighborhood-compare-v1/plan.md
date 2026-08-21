# Home and Neighborhood Compare v1

## Goal

在 exact cumulative candidate `9e8ff7ea24b1237a7322a59de602603f2786df5f`
上交付 Milestone 3：让普通用户可并排比较 2–4 个 Philadelphia 住宅地址或社区的
房产、环境、历史 reported-incident、交通暴露与数据质量证据。比较只展示可追溯的
维度和权重敏感性，不生成单一 safety score、最安全结论、受害概率或自动推荐。

M2 的 frozen evaluation 结论保持 `not-promoted`：历史 PPD reported-incident evidence
可用，forecast 必须继续为 `unavailable`，不得由 M3 数据、UI 或权重逻辑绕过。

## Scope

- 优先复用现有 Vanilla JS/Vite、地图、地址搜索、compare、i18n、Source Health 与
  fail-closed vocabulary；不改框架、不增加 package dependency。
- 为 OPA property/assessment history、real-estate transfers、311、L&I、vacancy、
  crash/HIN context 建立 revision-aware source/manifest/field-mapping/DQ 合同；真实无法
  可靠取得的来源明确 `partial` 或 `unavailable`。
- 扩展地址标准化，保留 normalized address、match score、坐标及可取得的 parcel/OPA
  identifier；低分、多候选、缺 parcel 或地理不一致 fail closed。
- 建立最窄可重建的 property/environment comparison mart 与 privacy-safe serving
  projection，支持 2–4 个地址、来源/时钟/覆盖/精度/限制 drill-down。
- 对用户提供的通勤目的地只消费经过验证的真实 routing authority；没有已 admission
  的道路或交通 authority 时显式 `unavailable`，不以直线距离或 synthetic graph 代替。
- 支持用户显式权重和 sensitivity view；权重只改变证据维度的展示/稳定性分析，
  demographics 不进入 safety ranking，默认不产生价值判断。
- 支持严格验证的本地 analysis/share state；tracked artifact、URL、日志、遥测与可分享
  状态不得包含私人精确地址、目的地、事件级坐标、generalized location 或 source ID。
- 保留 desktop/mobile、键盘、屏幕阅读器标签和中英文工作流。

## Sources of truth

- 当前用户委派的 M3 产品目标、边界、最低验证和结束状态。
- Exact starting candidate `9e8ff7ea24b1237a7322a59de602603f2786df5f` 的代码、
  tests、M0/M1/M2 commits 与 tracked reports；它相对本地 `main`/`origin/main`
  `f300cfe2658375add6542b86c20267c63c56ec4a` 领先 7 commits，尚未集成或推送。
- 只读 M1 root
  `C:/Users/raede/.codex/worktrees/c180/engagement_project/.dfev1/crime/full-2026-08-21-v2`
  与只读 M2 root
  `C:/Users/raede/.codex/worktrees/fed9/engagement_project/.dfev1/area-intelligence/m2-baseline`。
- M1 warehouse contract：21/21 scopes、3,583,548 active canonical rows、64
  partitions、coverage `[2006-01-01, 2026-08-22)`、`serving_eligible:false`。
- M2 serving contract：`status:not-promoted`、historical evidence `available`、forecast
  `unavailable`、`predictions:[]` 与 forbidden-claims list。
- 适用的 workspace instructions、`docs/AGENTS.md`、当前 package/bundle policies、
  executable tests，以及检索时最新的 Philadelphia/Census/road or transit 第一方文档。

## Stages

- [x] Stage 3A: 核验 exact Git/base/clean、适用指令、M1/M2 只读 evidence identity/mtime/
  inventory，冻结 source、privacy、routing、share-state 与 M2 no-promotion 边界。
- [x] Stage 3B: 实现 revision-aware source registry/manifest、schema mapping、address
  admission、DQ、comparison mart 与 privacy-safe serving contracts。
- [x] Stage 3C: 对可实际取得的第一方来源做 bounded smoke；输出真实 count/coverage/DQ，
  无法取得的来源保持 partial/unavailable；可行时产出小型安全 Philadelphia baseline。
- [x] Stage 3D: 实现 2–4 地址/社区 compare UI、用户权重 sensitivity、source/limitation
  drill-down、通勤 unavailable/authority 状态、双语与可访问交互。
- [x] Stage 3E: 运行 focused、lint、build/bundle、browser smoke 与标准 validate；验证
  zero console/page errors、desktop/mobile、恶意 state/HTML 拒绝和原预算 gate。
- [x] Stage 3F: 复核隐私边界、M1/M2 upstream 未写入、diff/overlap/clean；使用 Lore
  protocol 创建本 worktree 本地 commits 并交付 exact cumulative candidate。

## Acceptance criteria

- 2/3/4 地址都可完成并排 evidence profile；低分、多候选、parcel/geography mismatch、
  missing/partial/unavailable 均阻止未经证实的 downstream claim。
- 数据 ingest/normalization 覆盖 schema drift、revision/no-op idempotence、join coverage、
  source clocks/vintage/terms/accuracy limitation 与 privacy-field exclusion。
- OPA/assessment、transfers、311、L&I、vacancy、crash/HIN 每项都明确真实接入状态，
  不以 mock、空数组或零冒充真实结果。
- M2 forecast 始终 `not-promoted/unavailable`；UI/serving/weight/share state 均不能提升。
- commute 只在真实且经过 contract 验证的 routing authority 下展示 travel time/
  isochrone；否则显式 unavailable。
- share-state 严格反序列化、限长/限项/限值并做 allowlist；不允许任意 HTML、prototype
  pollution、私人地址或目的地进入 URL/shareable payload。
- focused tests、实际可行的官方 bounded smoke、production build、现有 bundle gate、
  browser smoke 与 `npm run validate` 有 fresh evidence，或精确记录 blocked/unrun gate。
- tracked artifacts 不包含事件级坐标、地址、source record ID、用户目的地或敏感输入。

## Non-goals

- M4 Known Route Evidence、M5 自动候选路线、Diary/community backend、生产部署或远端集成。
- 单一 safety score、最安全/最危险标签、受害概率、因果结论、房价预测或自动买租建议。
- 用 demographics 建立 safety ranking，或把 M2 audit model/aggregate gain 改写为 forecast。
- 提高任何 bundle ceiling、重写框架、默认引入依赖或把 raw/event-level data 提交进 Git。
- 修改其他 worktree、refs、main、remote、worktree topology 或上游 evidence artifacts。

## Risks and constraints

- 当前 worktree detached；只允许本任务范围内的小型本地 commits，不 push、不移动 refs。
- Source Health catalog 保持 `14,924/15,000` bytes（余 76 bytes）；final production bundle
  的 non-VRE dist 为 `3,953,132/4,000,000`（余 46,868 bytes）。所有 ceiling 保持不变。
- 官方 portal/API 的可达性、HTTP 成功和 row count 不能证明 complete/current/authority；
  每个结论绑定 retrieval time、source vintage、revision identity、coverage 与限制。
- 私人住宅地址和目的地只可在当前浏览器内存中处理，不得出现在 tracked artifacts、
  share state、logs、telemetry 或测试截图文本。
- M1/M2 roots 属于其他 worktrees 且严格只读；结束时必须复核 identity/mtime/inventory。
- 外部 routing authority 若未验证，commute 为 unavailable；不得用 geodesic distance、
  synthetic graph 或旧 candidate receipt 冒充真实 travel time。
