# Context

## Current truth

- 监督 worktree：`C:/Users/raede/.codex/worktrees/dfev1-m1-m6-supervisor/engagement_project`。
- Branch：`codex/dfev1-m1-m6-supervisor`；base `9d93df211a6a51fe99d9002d494937519fd79780`。
- 持久数据 worktree：`C:/Users/raede/Desktop/dev/engagement_project-data-foundation`，branch
  `codex/dfev1-data-foundation-persistent`；当前 M1/M2/M4 ignored evidence 只以该根为准。
- 当前 implementation exact candidate（本 closeout 文档提交之前）：
  `6308bbd4a7cf8dea732945c30d3e130f4b8562f1`。原始 M6 功能
  candidate 为 `6eed4908ec20b4e05ef052402a223fbe9051a43f`；其后只改 M2 protocol receipt
  binding 与 M5 current-M4 receipt binding，没有 Diary/Community 文件变更。
- 本地 `main` clean，但相对本地 `origin/main@f300cfe` 超前 93 commits；未 fetch/push。
- 当前 primary worktree 在 `codex/route-decision-s6-real-data@4d5c34c`，含未跟踪 logs/output；
  它们不属于本任务。
- M0 transactional tract snapshot/full receipt/runtime projection 代码在本地 main；本轮需以
  聚焦测试确认不回归，不重新实现。
- M1-M4 tracked 代码已存在；旧 `.dfev1` 事件仓库和 Area Intelligence mart 已随临时
  worktree 消失。当前 phase1-main `.dfev1/crime` 无文件，known old roots `c180/fed9` 及本轮早期
  `ac89/79c2/f1a1` 均不存在；其历史 hashes/汇总不得作为当前输入。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-28 | 完整读取用户指定规划对话；当前请求明确扩展到 M1-M6，而旧收尾曾只冻结 M0-M2。 | 当前委派为最新授权；仍保留阶段串行门槛。 |
| 2026-08-28 | 旧 M1/M2 ignored roots 不存在，但代码和小型 tracked serving artifacts 在本地 main。 | 先重建数据，不重做已验证骨架。 |
| 2026-08-28 | 创建三个 M1 high 任务：数据重建、ingest 恢复修补、空间/ACS/DQ 门禁。 | 监督线程唯一整合 owner；完整 backfill 只允许 M1-1 写入。 |
| 2026-08-28 | M1-1 官方源 preflight 观察到 `[2006-01-01, 2026-08-28)` 共 3,586,621 rows；3,586,620 有事件时间、56,035 缺坐标、374 位于城市 bbox 外、1 缺事件时间、0 重复 `cartodb_id`。 | 这些只是 source-final 前的实时观测，不能替代仓库 receipt；冻结 full rebuild 的 exclusive through 为 `2026-08-28`。 |
| 2026-08-28 | M1-1 在暂停前留下 50,000-row、17,187,284-byte、`complete:false` 的单页 partial，0/21 yearly scopes，且无 warehouse/receipt/lineage/DQ。 | partial 保留取证但永不复用；正式重建必须写入新根。 |
| 2026-08-28 | M1-2 source-final `3837512` 与 M1-3 source-final `35c6cee` 均从 `9d93df2` 派生；监督分支分别整合为 `ffa8d45`、`5d1b0d8`。 | raw schema、partition bytes/hash/rows、overlap drift、corridor coverage、ACS/DQ admission 现均 fail-closed。 |
| 2026-08-28 | 监督分支对合并树运行 `test:data-pipeline` 69/69、聚焦 ESLint 和 `git diff --check`，全部通过。 | 仅证明代码门禁；仍需独立 reviewer 与新 M1 数据 receipt。 |
| 2026-08-28 | M1-4 (`01a048ac-1559-7323-a9a8-ad3598754140`) 对 `9d93df2..5d1b0d8` 独立审查并给出 REQUEST CHANGES。 | 完整 backfill 继续暂停；不得用绿色既有测试越过 P1 blocker。 |
| 2026-08-28 | Hostile overlap 复现证明：篡改一个不被下一 snapshot 覆盖的旧 canonical event 后，ingest 仍成功、保留伪造值并生成新的 partition binding。 | 任何 ingest 前必须先机械校验 manifest/lineage 与实际 canonical rowCount/bytes/SHA256；需补内容篡改、partition missing、非当前 vintage replay 回归。 |
| 2026-08-28 | M1-1 已把 `3837512`、`35c6cee` 同步为 detached `4c9abe2`，与监督 `5d1b0d8` 的代码/契约树等价；13/13 + ESLint + diff-check 通过。 | 候选新根仍不存在，任务等待修复后的最终 GO。 |
| 2026-08-28 | M1-2 修复 source-final `34b90bd`（parent `3837512`）将 actual canonical scan 提升为所有 existing-warehouse ingest 的统一前置 gate；监督整合为 `037c615`。 | manifest/lineage/partition set/JSON parse/actual rows/bytes/SHA256/warehouse row count 任一漂移均在 transaction 前失败。 |
| 2026-08-28 | 合并树 `test:data-pipeline` 72/72、目标 ESLint、diff-check 通过；M1-4 证明 `037c615` 与 `34b90bd` stable patch-id 相同，原 hostile repro 现拒绝且不留 transaction。 | M1-4 代码门禁 PASS，允许开始重建；不等于数据门禁 PASS。 |
| 2026-08-28 | M1-1 同步为 detached `8325842`，产品代码树与监督 `037c615` 等价；正式根冻结为 `event-warehouse-v1-2006-through-2026-08-28-source-final-037c615`。 | 旧 partial 继续保留；正式首轮成为唯一 live writer。 |
| 2026-08-28 | 当前 M2 protocol/v1 精确冻结的是已丢失的旧 M1 hashes、3,583,548 rows 与 `2026-08-22` exclusive end；evaluation 还硬编码旧 row/ambiguous counts。 | 新 M1 receipt 不能套用或静默改写 v1。M2 必须在读取本轮 performance 前冻结 protocol/v2，保留既有 folds/models/gates，改为 receipt/manifest 驱动的机械计数与实际 mart binding。 |
| 2026-08-28 | 当前 M4 full builder 同样硬编码旧 M1 的 3,583,548 rows 与 `2026-08-22` exclusive end，只读取 manifest/rows，未先消费本轮 v3 admission receipt。 | M4 不能直接重放历史 builder；必须改成验证本轮 receipt 与实际 canonical bindings，且仍保留 public/non-private route 与 source coverage fail-closed。 |
| 2026-08-29 | M1-1 在正式 ignored 根完成首轮 backfill、完全相同命令复跑和 `--validate-only`，三次均 exit 0；范围 `[2006-01-01, 2026-08-28)`，acquisition/canonical/active 均 3,586,620，64 partitions，root 10,061,298,932 bytes。 | 当前可读 M1 receipt 取代全部历史 hashes/counts；旧 50,000-row partial 保留但不可消费。 |
| 2026-08-29 | Receipt declared identity 为 `sha256:cd7585ae6de518cbbf57ab5c301073a69ef3c4d6543ec6d3acdadc253b3e16e4`；exact rerun 的 21/21 acquisition/ingest 均 idempotent，receipt bytes/mtime/identity 未变。 | M2 只能绑定该 exact receipt/manifest/checkpoint/lineage/canonical set；不得绑定路径名或旧 v1 常量。 |
| 2026-08-29 | 主线程对当前 receipt/DQ v2 做有界恒等式 gate：coordinate、tract、grid、corridor、ACS 五组状态各自机械相加均等于 3,586,620；corridor registry 为 null 时 3,586,620 全为 unavailable；serving/integration authority 仍 false。 | M1 空间/ACS/DQ 语义允许作为 M2 protocol-v2 输入；不授予 serving、publish 或 safety claim。 |
| 2026-08-29 | M1-3 最终 gate 两次、M1-2 fallback gate 一次、M1-4 最终 data-review gate 一次均由 Codex host 标记 completed，但返回 0 message/tool items。 | 这些静默回合不计为 reviewer PASS；记录独立 reviewer-channel 证据缺口。M1 本地机械数据门禁仍 PASS，但后续不得声称独立 data-review 完成。 |
| 2026-08-29 | 创建 M2-1 protocol/integrity、M2-2 unique data owner、M2-3 serving/UI 三个 high 任务，均从监督 `a055752` 干净起步；M2-4 暂不创建。 | Protocol-v2 必须先冻结并整合，M2-2 才能读取新 performance；最终 reviewer 将从真实整合候选创建，M2 当前使用 3/4 新任务。 |
| 2026-08-29 | M2-1 source-final `5607949` 冻结 protocol v2（SHA-256 `d7d75ce0eb0aaf80b950aa87125e5a98742dca57db38d22938b3851fed048ff6`），将 mart/evaluation 升为 exact receipt、实际 part set/rows/bytes/SHA 与 run-manifest `/v2` 单一 lineage seam；监督整合为 `285ede0`。 | v1 的 folds/models/metrics/thresholds/slices/promotion gate 逐字段不变；M2-2 只能从该代码门禁和全新 ignored root 执行。 |
| 2026-08-29 | M2-1 的 memory quick pass 意外暴露旧 M2 performance 摘要，但未读取本轮 evaluation 输出；机械测试证明 protocol v2 科学设计字段与旧冻结 v1 完全相同。 | 不得声称观察者层面的严格 performance blindness 无污染；M2-4 必须独立判断该程序性偏差，同时禁止据本轮结果改 gate。 |
| 2026-08-29 | M2-3 最终 source-final `3c8b3d4` 仅接受 evaluation run `/v2` 和含完整 `parts[]` 的 seam，验证 receipt→report→raw-serving coverage/source-vintage 连续性，并提供六文件事务 rollback；监督整合为 `dcd31ce`。 | 历史 tracked serving artifact 缺少当前 lineage 时 fail closed；本轮尚未真实 publish，也未授予 serving authority。 |
| 2026-08-29 | 监督组合门禁：M2/publisher 21/21、i18n 11/11、目标 ESLint、production build、bundle policy 和 browser promoted/not-promoted/invalid 全部 PASS；bundle 为 3,999,977/4,000,000 bytes。 | M2 code gate PASS，可向唯一 M2-2 数据 owner 发 GO；后续任何 UI 变更必须重跑 bundle，不能提高 ceiling。 |
| 2026-08-29 | M2-2 首次 GO 在创建 root 前发现 protocol Git blob/LF SHA 为 `d7d75ce0…`，但 `core.autocrlf=true` 的 supervisor/79c2 工作树被检出为 CRLF SHA `f67fa948…`；未启动数据进程。监督 `5c1f11d` 为 protocol JSON 强制 LF 并新增 exact SHA 回归，协议 blob 与科学字段未改变。 | 原 GO 作废；所有 checkout 必须先验证 6,935 bytes、LF-only、SHA `d7d75ce0…`，再创建 M2 root。 |
| 2026-08-29 | M2-2 从 exact `37359d7` 在全新 ignored root 完成 mart run1 与同命令 rerun：64 actual parts、1,611,918 rows、825,033,042 part bytes，rerun 返回 `idempotent`，66 个 mart artifacts 的 bytes/SHA/mtime 均 0 变化。 | 当前 mart artifact identity 为 `sha256:5ad0b1d0c0765f6aaa05f8b5d68fdc04bce85f12234050d15ce89cb7ababa894`；只绑定本轮 protocol/M1 receipt/实际 parts，不替代历史 v1。 |
| 2026-08-29 | Frozen evaluation run1 与同命令 rerun 均 exit 0；run schema `/v2`，7/7 artifacts 实际 bytes/SHA 匹配，rerun `idempotent` 且 9 个文件 bytes/SHA/mtime 0 变化。结果为 `not-promoted`、selected promotion model `null`、`unavailable`。 | 不运行 publisher，不改 tracked reports/public data；aggregate 表现或 selected audit model 都不能绕过所有 primary/category/coverage gates。 |
| 2026-08-29 | 主线程重新调用 mart validator 并逐一验证 evaluation artifacts、serving contract 与 lineage seam：protocol `d7d75ce0…`、mart manifest `83bddd65…`、64 parts / 1,611,918 rows、M1 receipt `cd7585ae…` 和 not-promoted outcome 全部闭合。 | 当前可创建 M2-4 做最终独立 stage review；这仍不是 serving/publish、remote CI、deployment 或 product-liveness authority。 |
| 2026-08-29 | M2-4 在 `d23863b` 独立复算 data chain 后发现一个 P1：production `view.js` 的弱 admission 接纳 present-but-malformed lineage，尽管 strict serving-candidate validator 会拒绝。 | M2 local gate 首轮 FAIL；暂停 M3，复用既有 M2-3 task 但其 follow-up 产生 0 items，最终由 integration owner 做最小修复。 |
| 2026-08-29 | 监督 `7f167e6` 让 runtime 直接调用 strict validator，并新增实际 built-browser hostile case；为维持不变的 4,000,000-byte ceiling，只在 build 时删除 HTML 行首缩进并保留全部换行/文本空白。 | 21/21、ESLint、diff-check、build、bundle 3,996,762/4,000,000 和 Area browser 均 PASS；protocol/data/publisher/tracked artifact 未改。 |
| 2026-08-29 | 全局 browser smoke 连续停在 Analysis History line 716；在精确未修改 `d23863b` 的新临时 worktree、fresh `npm ci` 与原始 39.53 KB HTML 上复现相同 timeout，随后安全移除该临时 worktree。 | 这是可复现的既有测试缺口，不归因于 `7f167e6`；不阻止已聚焦证明的 M2 repair，但后续阶段需继续披露。 |
| 2026-08-29 | M2-4 对 exact `7f167e6` focused re-review 为 P0/P1/P2 zero、总体 PASS；原 hostile runtime 现 `invalid` 且不渲染 historical evidence。 | M2 本地阶段完成并允许进入 M3，前提是 M2 只作为 unavailable/history dimension；scientific promotion、tracked publish/serving、remote/deploy 继续 FAIL/关闭。 |
| 2026-08-29 | 从记录 M2 closeout 的 exact supervisor `7ce54dd` 创建 M3-1 source/admission、M3-2 comparison/privacy、M3-3 UI/browser 三个 high tasks；M3-4 保留给真实整合候选的最终 review。 | 三个 worktree 文件所有权互斥；地址/坐标/parcel 只允许 synthetic/session-memory，commute 和 M2 forecast 均保持 unavailable，bundle ceiling 不提高。 |
| 2026-08-29 | M3 三条实现线分别交付 source/admission `3b78b73`、comparison/privacy `eb51e8f` 和 UI/browser `148cfaa`；组合后暴露 bundle 4,001,582/4,000,000 与旧 GET fixture 两个跨线 blocker。 | 复用原 M3-1/M3-3 任务修复，不创建第五任务、不提高 ceiling；POST fixture `c06dcfc` 与 source 去重 `06b1b44` 均从真实整合 chain 重新验证。 |
| 2026-08-29 | 监督 exact `5e21439` 的中央 gate：29/29、ESLint、build、bundle 3,998,837/4,000,000 和 built browser 全部 PASS；公开市政地标 live admission 为 1 candidate/1 parcel/0.9 m，九源均 partial 且日志增量 0。 | M3 integrated candidate 可进入第 4/4 个独立 reviewer；这不是 private-address completeness、商业许可、remote CI、deployment 或 product-liveness 证明。 |
| 2026-08-29 | M3-4 在 exact `a795450` 首轮独立复核给出 FAIL：P0=0、P1=3、P2=1。property future clocks、普通 evidence/source 结论文本、camelCase private aliases 和 source registry drift 均有可复现 hostile admission。 | M4 继续暂停；复用既有 M3-1/M3-2 任务修复，不创建第五个 M3 任务，也不提高 bundle ceiling。 |
| 2026-08-29 | M3-2 `04a047c` 扩展 conclusion/private-key fail-closed；M3-1 `98f7b49` 过滤未来 OPA 日期并以同步 SHA-256 绑定九源 endpoint/dataset/schema。监督依次整合为 `73a3a97`、`0bb709d`。 | 四项初始 findings 均有 hostile regression；M2 forecast 与 commute 仍 unavailable，地址/坐标/parcel 仍只在会话内和准入的 POST body。 |
| 2026-08-29 | 合并态中央 gate 在 `0bb709d` 通过 32/32、ESLint、build、bundle 3,999,488/4,000,000 和 built browser；source registry 4,601/1,985 raw/gzip，浏览器 0 console/page errors。 | 只允许把该 exact repair candidate 交回同一 M3-4 reviewer；M3 尚未关闭，M4 尚未启动。 |
| 2026-08-29 | 多轮 M3-4 对抗证明自然语言肯定语法枚举仍会漏普通复数、修饰词、中文体貌词和省略主语结构；监督在 `0602a4a` 改为 unsafe lexicon 默认拒绝，只允许全字符串受控 disclosures/denials/metadata/operational 文案。 | 未知或歧义安全语义被拒是产品策略；不再把运行时 regex 当成开放式 NLP。typed claim AST 保留为后续架构方向，不扩大本轮范围。 |
| 2026-08-29 | M3-4 在 `0602a4a` 仍复现 evidence-denial `.+` 跨句吞掉后续肯定结论；`9ccabe5` 将英中文本绑定到单个受控 target，35 hostile/39 legitimate 独立矩阵无逃逸或误拒。 | 语义/source/privacy gate 已闭合；任何新的代码拥有安全词汇文案仍须显式进入全锚定 allowlist。 |
| 2026-08-29 | M3-4 在同一 fresh dist 上发现 close/reopen browser gate 2 PASS/2 FAIL：测试在 async controller 重建前读取空控件；`7a0f03c` 改为等待新 dialog 与恰好两个可见空地址控件。中央与 reviewer 各自连续 6/6 PASS。 | 这是既有 test race 而非 production tree 回归；最终 exact `7a0f03c` 的独立 verdict 为 P0/P1/P2 zero、M3 local PASS、M4 admission PASS。M4 可以开始。 |
| 2026-08-29 | M4-1/M4-2/M4-3/M4-4 四个 high 任务分别完成 builder/receipt、Centerline/privacy/UI、唯一 ignored-data writer 和独立 exact-tip review；最终监督 SHA 为 `b4fcc63c7540f0a5e31844158a0fc853d2c8c0a6`。 | 本阶段任务数冻结为 4/4；新 source-final 根只绑定 exact `b4fcc63`，旧 `full-warehouse` 不可 fallback。 |
| 2026-08-29 | M4 writer 从本轮 M1 64 partitions 扫描 3,586,620 rows / 8,741,798,048 raw bytes，生成精确三工件；completed rerun idempotent 且 bytes/SHA/100ns mtime 零变化。 | M4 证据覆盖 `[2006-01-01, 2026-08-28)`；2,024 contributing rows 与 609.840838 contribution units 只是聚合历史 evidence，不是个体风险或安全结论。 |
| 2026-08-29 | M4-4 首轮发现 Centerline schema/CRS、M1 aggregation TOCTOU、v2 validator 和 completed-inventory 四类问题；修复后 reviewer 在 exact `b4fcc63` 独立复验为 P0/P1/P2/P3 全零。 | M4 local stage gate PASS；Centerline 继续 reference-only，mode/accessibility/routing/safety/M2 authority 全为 false，M5 不得继承不存在的路由授权。 |
| 2026-08-29 | 最终 reviewer 构建观测 non-VRE bundle 3,999,920/4,000,000，M4 chunk 36,497/36,500；浏览器双语、键盘、桌面/移动、隐私与 0 console/page errors 全部 PASS。 | M5-M6 只有 80-byte 总包余量，必须 code-split/压缩现有字节，禁止提高 ceiling。 |
| 2026-08-29 | M5-1 用 Project OSRM 26.8.0 Windows x64、MLD、`foot.lua` 和 2026-08-24 Pennsylvania extract 构建本地图；26 个 graph files / 2,533,170,416 bytes，GraphArtifact、topology、geometry identity 分别为 `3adc0b82…901e0`、`25f3d33d…e0e3a`、`eef990bb…c75b`。 | 成熟图和公开固定 probe 的本机可复建证据成立；原始 86-file / 2,952,679,139-byte ignored 根保留，不授予任意私人路线或产品 runtime authority。 |
| 2026-08-29 | M5-2/M5-3 完成 authority-neutral alternatives core、oracle、private-sentinel 与四格 Chromium gate；unknown accessibility 保持 `partial/unavailable`，生产 wrapper 固定 `m5-authority-unavailable`，UI 保持 `NO_PRODUCT_PROMOTION`。 | Pareto/sensitivity 可机械验证，但 candidate generation、accessibility、safety、realtime 和产品 routing 均未晋级；0 私人值进入 URL/network/log/share。 |
| 2026-08-29 | M5-4 在 exact `d7f55aa` 首轮给出 P0=0/P1=0/P2=4/P3=1：public-probe responder causality、accessibility unknown flatten、terminal candidate contradiction、late console checkpoint 和中文 Axe/layout 缺口。 | 暂停 M6，复用 M5-1/2/3 修复；阶段任务继续冻结为 4/4，不创建第五任务。 |
| 2026-08-29 | M5-1 v3 sibling 将公开 probe 绑定 OS-assigned loopback port 与 spawned child PID 的 readiness/query 前后唯一 TCP ownership；hostile canned pre-owner fail closed 且不被杀死。5-file / 37,546-byte final receipt identity 为 `1cbbf205…fced8`。 | 原 v2 root 字节不变且不得 fallback；v3 authority 仍仅是 same-session private handle，`candidateGenerationAuthorized:false`、`privateRuntimeProductPromotion:false`。 |
| 2026-08-29 | 监督 exact `7a8cd80` 通过 v3 validate、route-real 350/350、core 16/16、private gate 2/2、四格 Chromium、M4 回归、build、bundle 与 ESLint；M5-4 focused re-review 为 APPROVE，原 findings 全关闭且新 P0/P1/P2/P3=0。 | M5 local stage gate PASS；fresh bundle 3,999,824/4,000,000，余 176 bytes。没有 remote CI、deploy、publish、redistribution 或 product promotion。 |
| 2026-08-29 | M6-1/2/3 从 M5 closeout 分别完成本地 Diary 生命周期、公共写硬禁用和中立 Sample Community；初始整合 exact `4360960` 通过中央合约、Diary/M4/M5 browser 与 bundle。 | 本阶段任务数冻结为 4/4；公共 submit/agree/improve 对 hostile env/adapter/request aliases 仍固定 unavailable/零网络，Diary 私人值只在本地 IndexedDB/用户导出边界内。 |
| 2026-08-29 | M6-4 首轮在 exact `4360960` 返回 P0=0/P1=2/P2=2：storage unavailable/partial 在 Insights port 丢失，示例卡片仍有人数/confidence/write CTA，Data Scope 隐藏/ARIA 不完整，Help 暗示可配置上传。 | M6 暂停收尾并复用 M6-1/M6-3 修复；不创建第五任务，也不以初始 green tests 覆盖 reviewer 的直接消费者证据。 |
| 2026-08-29 | M6-1 `dd9d809` 保留完整 storage snapshot 到最终 DOM；M6-3 `9e5ce6e` 将路段卡片、Data Scope、移动端可见文本与 Help 收敛为完整静态虚构只读/no-upload truth。监督依次整合为 `ad97e75`、`6eed490`。 | unavailable/partial 不再投影 empty/available/zero；Sample Community 无人数、confidence、共识或写 CTA，public unavailable 明确为未保存/未共享。 |
| 2026-08-29 | exact `6eed490` 中央 `npm run validate`、414/414 focused、66/66 baseline policy、Diary/M4/M5 Chromium、build/bundle/lint 全 PASS；M6-4 独立 fresh full visual 为 35 pass/10 policy-skip/0 fail，最终 APPROVE 且 P0/P1/P2/P3=0。 | M1-M6 本地执行完成；bundle 3,993,513/4,000,000，余 6,487 bytes。未运行 remote CI、push、deploy、publish；公共写、M2 forecast 和 M5 product routing 继续关闭。 |
| 2026-08-29 | 收尾核查发现承载早期 M1/M2/M4 ignored roots 的 `ac89`、`79c2`、`f1a1` worktree 已被自动移除；精确名称扫描（含回收站）没有找到副本。 | 历史 rows/hashes/path 仍可作审计线索，但不可作为当前可重验 evidence；必须从 tracked pipeline 在持久工作树重建。 |
| 2026-08-29 | 在 `C:/Users/raede/Desktop/dev/engagement_project-data-foundation` 重建当前 M1：1,496 files / 10,060,285,521 bytes、64 canonical parts / 3,586,620 rows，first run、exact rerun、validate-only 均 exit 0；receipt identity `bc439541…5e315`。 | 当前 M1 exact input 可读且幂等；旧 `cd7585ae…e16e4` receipt 不再是当前 evidence。 |
| 2026-08-29 | 在任何新 performance 前，只将 protocol v2 的 exact receipt identity/frozen clock 重冻到当前 M1，保留所有 v1-derived scientific fields；新 protocol 为 6,935 bytes、LF-only、SHA `5c6361a3…e7eac`。随后重建 M2：128 parts / 1,611,918 rows，mart/evaluation exact rerun 幂等。 | M2 仍 `not-promoted/unavailable`、selected model `null`；publisher 未运行，未授予 serving authority。 |
| 2026-08-29 | 在持久根重建 M4 三工件：semantic identity `d153850a…b4c38`、handoff identity `c0ea04ce…1c63f`，completed rerun 幂等；2,024 contributing rows / 609.840838 units，report `partial`。 | Centerline 仅 reference-only；mode/accessibility/routing/safety/M2 route authority 仍全部 false。 |
| 2026-08-29 | M5 以新 sibling receipt 重绑定当前 M4 handoff；新 receipt identity `378bf673…9ebf0`，GraphArtifact/topology/geometry identities 未漂移。代码只接受新路径，旧 receipt 保留但 no-match、无 fallback。 | `candidateGenerationAuthorized`、private runtime promotion、publication、redistribution、deployment 继续 false；Source Health `not-applied`。 |
| 2026-08-29 | exact `6308bbd` 通过 `npm run validate`、route-real 350/350、alternatives 16/16、private 2/2、四格 Chromium 和 3,993,513/4,000,000 bundle；M5 rebind 与 M6 regression 聚焦独立复核均 APPROVE，P0/P1/P2/P3=0。 | 当前 tracked candidate 本地 gate 闭合；M6 完整 fresh visual 仍锚定未改功能候选 `6eed490`，不将聚焦复核冒充重复全视觉验证。 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| M1 persistent rebuild, exact rerun and validate-only | integration owner / persistent worktree | `.dfev1/crime/event-warehouse-v1-2006-through-2026-08-28-persistent-20260829` | complete; 1,496 files / 10,060,285,521 bytes; receipt `bc439541…5e315`; no active backfill |
| M1 tracked source/warehouse audit | `01a0489b-188b-7d30-b0e5-f2289c13f0e3` / `954b` | task-owned worktree | complete; repair source-final `34b90bd` |
| M1 spatial/ACS/DQ gate | `01a0489b-188b-7d30-b0e5-f2073fa849c2` / `6ad0` | task-owned worktree | source-final `35c6cee`; final data follow-ups returned 0 items, so main performed bounded metadata gate |
| M1 independent integration/data gate | `01a048ac-1559-7323-a9a8-ad3598754140` / `0062` | isolated worktree from supervisor branch | code PASS on `037c615`; final data follow-up returned 0 items and provides no verdict |
| M2 protocol-v2 and integrity | `01a04973-bb21-7cc1-9b39-4b12a56b9f97` / `51c8` | task-owned worktree from `a055752` | complete; source-final `5607949`, integrated as `285ede0`; exact M1 gate exit 0 |
| M2 current mart/evaluation build | integration owner / persistent worktree | `.dfev1/area-intelligence/m2-v2-persistent-20260829` | complete; 8,331 files / 1,548,712,302 bytes; mart/evaluation reruns idempotent; no active process or publish |
| M2 serving/UI gate | `01a04973-badc-7aa1-b307-b08bfd66965c` / `e034` | task-owned worktree from `a055752` | complete; source-final `3c8b3d4`, integrated as `dcd31ce`; no real publish/performance read |
| M2 final independent review | `01a049db-fda6-77b1-98fe-e1078002aa23` / `2b86` | exact reviewer bases `d23863b` then `7f167e6` | initial FAIL on runtime lineage P1; focused re-review PASS with P0/P1/P2 zero; worktree clean, no publish or long data rerun |
| M3 source/admission | `01a049fa-60bc-7070-b635-9650b58e4ed9` / `cf2d` | initial source `3b78b73`, bundle repair `06b1b44`, review repair parent `a795450` | complete; final repair `98f7b49`, integrated as `0bb709d`; live public-landmark gate complete, no active source/browser process |
| M3 comparison/privacy contract | `01a049fa-60dc-7e90-862e-b8aed88c23db` / `c979` | final repair bases through exact `0602a4a` | complete; fail-closed source `4a2a72c` and single-target denial repair `d7d8fd1` integrated as `0602a4a` and `9ccabe5`; worktree clean |
| M3 UI/browser privacy | `01a049fa-bf6b-7c12-b608-c2a236da3fec` / `1f65` | final supervisor exact `7a0f03c` | complete; original source-final `148cfaa`, POST fixture `c06dcfc`; final follow-up returned 0 items, so supervisor made the one-file observable-ready test repair and proved six consecutive PASS runs |
| M3 final independent review | `01a04a1d-74f8-7b70-a252-0b7ea1ee55f5` / `73e0` | final exact candidate `7a0f03c` | complete; final P0/P1/P2 zero, M3 local gate PASS and M4 admission PASS; no active browser/server process |
| M4 builder/receipt | `01a04ad4-c4d4-7013-b315-f22eefb56c69` | tracked source-final commits through exact supervisor `b4fcc63` | complete; receipt/validator/aggregation repairs integrated, no active process |
| M4 Centerline/privacy/UI | `01a04ad4-c50c-7800-8128-1056e4d4b2df` | exact live Centerline transaction and focused browser gates | complete; 47-feature public reference smoke PASS, no active server/listener |
| M4 current ignored-data writer | integration owner / persistent worktree | `.dfev1/known-route-evidence-v1/full-warehouse-persistent-20260829` | complete; exact three-artifact root, fresh writer and completed rerun PASS; no active process |
| M4 final independent review | `01a04b18-68d7-7810-b23d-f854a1064575` / `7897` | exact `b4fcc63` plus source-final root | complete; P0/P1/P2/P3 zero, all original findings CLOSED, tracked clean |
| M5 mature engine/graph/current M4 binding | integration owner / persistent + supervisor worktrees | `.dfev1/route-real-graph-m5-1` plus `route-real-graph-m5-1-repair-p2/source-final-owned-queries/mature-engine-receipt-persistent-20260829-v3.json` | complete; graph `3adc0b82…901e0`, current receipt `378bf673…9ebf0`; old receipt audit-only/no fallback |
| M5 alternatives core/oracle | `01a04b4e-e153-7a03-9924-40994308cde0` / `4e9f` | source/repair commits integrated through exact `7a8cd80` | complete; 16/16, accessibility uncertainty preserved, terminal contradictions fail closed, production wrapper unavailable |
| M5 product/browser no-promotion | `01a04b6e-46ca-7400-b7dc-93b00fe12d45` / `a7b8` | exact supervisor `7a8cd80` built output | complete; private self-test 2/2 and desktop/mobile x en/zh-CN Chromium PASS, zero console/page/private/candidate-OSRM requests |
| M5 final independent review | visible reviewer plus current focused reviewer | original exact `7a8cd80`; current exact `6308bbd` | original full review APPROVE; current rebind focused APPROVE with P0/P1/P2/P3 zero; visible current follow-up returned 0 items and is not claimed as evidence |
| M6 local Diary lifecycle | `01a04b9f-7280-7790-9e7b-f416f71d2663` / `b29f` | source `39e2413`, repair `dd9d809`, supervisor integrations `4360960` and `ad97e75` | complete; DB v2 lifecycle, restart/export/delete and one-time replace token PASS; storage unavailable/partial reaches final Insights DOM |
| M6 public write hard-disable | `01a04b9f-7280-7790-9e7b-f3f6e4ed1832` / `29f9` | sources `1d485d0`, `bbd1827`; supervisor `df39332`, `5c45978` | complete; submit/agree/improve deterministic unavailable, hostile seams and private sentinels produce zero transport |
| M6 neutral Sample Community | `01a04b9f-729f-7fc1-b19e-f6952b548785` / `778e` | source `ffa519e`, repair `9e5ce6e`; supervisor `441e202`, `6eed490` | complete; static-invented-read-only truth across visible/hidden/ARIA/title/data attrs, mobile disclosure visible, no write CTA |
| M6 final independent review | visible reviewer plus current focused reviewer | original exact `4360960`/`6eed490`; current exact `6308bbd` | original findings CLOSED and full visual 35/10 skip/0 fail at `6eed490`; current no-Diary-diff regression focused APPROVE with P0/P1/P2/P3 zero |

## Handoff

M1-M6 本地执行已在当前 exact tracked candidate `6308bbd` 闭合。旧临时 ignored roots 已不可读，
因此当前声明只绑定持久工作树中重新生成的 M1 receipt `bc439541…5e315`、M2 artifact
`be26fcab…96d76`、M4 handoff `c0ea04ce…1c63f`，以及新 M5 receipt `378bf673…9ebf0`。
中央 `npm run validate`、bundle 和四格 M5 Chromium 均 PASS；M5 current rebind 与 M6 current
regression 聚焦复核均 APPROVE、P0/P1/P2/P3=0。M6 完整 visual 35 pass/10 policy-skip/0 fail
仍准确锚定原始未改功能候选 `6eed490`。Diary 只在本地 IndexedDB/用户手势导出边界内，公共写
固定 unavailable/零网络，Sample Community 固定静态虚构只读，M5 继续
`NO_PRODUCT_PROMOTION`。M1 reviewer-channel 缺口、M2 observer-blinding 偏差、既有 general
browser-smoke failure、Windows Chromium 单浏览器边界以及未运行 remote CI/push/deploy/
publish/redistribution 继续披露；监督与持久数据 worktree 原样保留。

## Next step

当前授权范围内没有剩余自动执行步骤。提交 docs-only closeout 后保持 supervisor、持久数据
worktree、其 M1/M2/M4/M5 ignored roots 和用户 Desktop WIP 不动，不 push、deploy、publish 或清理。后续若要运行 remote CI、
发布当前只读产品、扩展 Safari/Firefox/quota/eviction 持久化验证，或设计真正的公共社区写入，必须
作为单独任务重新取得相应授权；M2 forecast 与 M5 product routing 也不能因本次 M1-M6 完成而晋级。
