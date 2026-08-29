# Phase 2 P1-P6 Context

## Current truth

- 用户引用对话已只读核对；第二阶段 P1-P6 冻结为最新串行主线 R1-R6，不包含 R0 和 R7。
- primary checkout `C:/Users/raede/Desktop/dev/engagement_project` 在 `codex/route-decision-s6-real-data@4d5c34c`，存在未归属 `.playwright-mcp/`、`logs/`、`output/`，保持不动。
- 本地 Phase 1 汇总 `main@9d93df2`；持久 DFEV1 M1-M6 候选为 `codex/dfev1-data-foundation-persistent@122bba9`，相对 main 串行增加 68 commits，工作树干净。
- Phase 2 integration worktree 为 `C:/Users/raede/Desktop/dev/engagement_project-phase2`，branch `codex/phase2-p1-p6`，exact base `122bba9`。
- 远端 `origin/main` 的当前已知本地追踪值为 `f300cfe`；本轮未 fetch、push、PR、部署或发布。

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-29 | 浏览器读取用户指定 ChatGPT 对话；最新计划使用 R1-R6 | 按用户措辞统一编号为 P1-P6；不混入旧 Diary/API 文档中的其他 “Phase 2” |
| 2026-08-29 | 发现既有 `data-foundation-m1-m6-execution` 已完成上一轮 M1-M6 | 第二阶段从 `122bba9` 接续，先审计复用，禁止重复造轮子 |
| 2026-08-29 | primary 有未跟踪用户工件，持久候选干净 | 新建隔离 integration worktree，primary 不编辑、不切换、不清理 |
| 2026-08-29 | P1 创建 registry、restore、workflow 三个用户可见任务 | P1 对话预算达到 3/3；不得再创建新的 P1 用户可见任务 |
| 2026-08-29 | P1 inventory 冻结为双 registry + bundle descriptor，稳定集合由 producer receipt/manifest 白名单驱动 | M1 保留 raw/canonical/current control；M2 保留 marts/evaluation/protocol；排除 staging、transactions、logs、旧报告 |
| 2026-08-29 | 发现 M1 lineage registry 保存旧 worktree 绝对 manifest 路径 | P1 必须修复相对路径/legacy 安全重定位并通过搬迁测试，不能靠恢复到旧路径绕过 clean-room 验收 |
| 2026-08-29 | ArtifactRegistry/v1 已整合并通过目标测试与 Ajv strict schema compile | registry 只描述/比较调用方 observation，不自行声称真实 artifact 已验证；所有 authority 固定 false |
| 2026-08-29 | 真实 producer 声明已物化为 bundle `sha256:c254caf491d161ea4a0d82152a21bdba726ed8bb28c3d30d6d4cbef190e86c5e` | metadata 位于 `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/metadata`；当前仍为 `not-observed`，不等于 payload 已复制或验证 |
| 2026-08-29 | 本地镜像在 root-owned session `60979` 完成 | mirror 精确包含 1,596 objects / 10,811,898,840 bytes / 8,785,158 declared rows；这只证明本机镜像，不证明跨机器或云存储可用 |
| 2026-08-29 | registry、materializer、mirror、restore 与 workflow 已在 integration worktree 汇合 | 组合契约测试 58 PASS / 1 permission SKIP / 0 FAIL；lineage portability 17/17 PASS；authority 仍全部 false |
| 2026-08-29 | P1 security review 返回 MEDIUM，P0/P1=0、P2=4；四项均已修复并新增 hostile regressions | materializer link traversal、mirror byte/capacity exhaustion、workflow registry TOCTOU 与 restore implicit replacement 均 fail closed；81-test 组合为 80 PASS / 1 permission SKIP / 0 FAIL |
| 2026-08-29 | final staged review 发现公共 registry 曾接纳 restore 无 verifier 的 rowCount 组合；修复后 focused re-review PASS | 公共 contract/schema 已统一限制为 line-delimited JSON，registry+restore 39/39 与 Ajv strict PASS；当前无开放 P0-P2，剩余 gate 为真实 clean-room |
| 2026-08-29 | clean-room M1/M2 restore 与独立 verify 全部 exit 0 | 恢复目标位于独立 artifact root；原持久 source root 未被修改，authority 仍全部 false |
| 2026-08-29 | M2 exact gate 发现重复打开 legacy producer absolute path | `1288ae1` 让 official mart admission 复用已完成的强 M1 admission；8/8、ESLint 和独立复核 PASS，无开放 P0-P2 |
| 2026-08-29 | 恢复后的真实 M1、M2、evaluation exact chain PASS | M1 3,586,620 canonical rows；M2 128 parts / 1,611,918 rows；evaluation 幂等且维持 `unavailable` / `not-promoted` |
| 2026-08-29 | 以冻结 observed-at 从 clean-room roots 重建 metadata | 三个 metadata 文件与原件字节级一致；bundle 仍为 `sha256:c254caf491d161ea4a0d82152a21bdba726ed8bb28c3d30d6d4cbef190e86c5e`；P1 local gate 完成 |
| 2026-08-29 | P2 分派 denominator、methods、report 三个互斥有效任务 | 有效预算达到 3/3；调度重试误建的重复 denominator task `01a04da9-3ebd-7d20-987e-abde654de7a0` 已立即收到停止指令并归档，不得修改、提交或进入集成 |
| 2026-08-29 | 用户要求之后部署的其他对话推理等级不超过 `high` | P3-P6 的新用户可见任务显式设置 `high` 或更低；当前进行中的 P2 任务不重建，以免重复执行或丢失进度 |
| 2026-08-29 | P2 exact producer、report、runner 与协议已整合 | commits `36d943b`、`e1ef453`、`88e211d`、`1b6ec10`、`56e975d`、`7ca9e7b`、`dd36428`、`8352292`、`b75aeff`；最终协议 `sha256:ab57e1d387a30b538952c49aa816773cf1c745a353b505ff0f57a46de9ea8658` |
| 2026-08-29 | 首次真实 P2 build 在 report-build 阶段 fail closed | 发现 observed PSA 字符串 `"0"` 被误判为 zero-fill；修复后明确区分 observed `"0"` 与 null unavailable，并要求 null stratum 与 missing count 精确守恒 |
| 2026-08-29 | P2 真实 A/B evidence build 完成且逐字节一致 | 两次 bundle 均为 `sha256:28598f2721d16d22ca338125227ba9d0eb37f2e10848be6b9d1f1d0768b8042a`；四个文件的集合、长度、SHA-256 与 bytes 全部一致；119/119 tests PASS |
| 2026-08-29 | P3 分派 protocol、model diagnostics、evaluator 三个互斥用户可见任务 | 预算达到 3/3；任务均显式使用 `high`，主任务保留唯一 integration 与 live-data owner |
| 2026-08-29 | P3 protocol 在读取真实表现前冻结 | byte SHA `sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde`；绑定 exact M1 receipt file SHA、16 个 primary tuples、numerical/interval gates 与全 false authority |
| 2026-08-30 | evaluator 独立审查先返回 REQUEST CHANGES，修复后整合 | 深校验改为绑定调用方 frozen protocol/mart/checkpoint 并独立重算；complete checkpoint 先于 manifest；`.dfev1` realpath/junction 越界零写入；39/39 integration tests PASS |
| 2026-08-30 | exact M1 在新协议下重建 P3 M2 | artifact `sha256:df200d11666b314285750a4914eb35f6377c7534aef14bac2fbc2b4419749861`；canonical 3,586,620、mart 1,611,918 rows、128 parts、825,033,042 bytes；旧 `5c6361...` M2 保持历史证据 |
| 2026-08-30 | 真实 P3 evaluation 与幂等复跑完成 | 64/64 count-model fit states 未在冻结 iteration cap 前收敛，多个 coverage/MAE slices 失败；结果诚实 `not-promoted`、无 local candidate；9 个 artifact 第二次运行逐字节不变，authority 全 false |
| 2026-08-30 | P4 分派 serving、UI、privacy 三个互斥用户可见任务 | 预算达到 3/3；全部显式使用 `high` 或更低推理，主任务保持唯一 integration/live-test owner |
| 2026-08-30 | exact P3 证据投影为 Area Intelligence serving/v2 | tracked artifact 为 3,087 bytes / `sha256:5a8733c877983556e80896ea2689eb1b86c4707e6bf17f48bb985f6abca06314`；完整分母、unit/mart rows、2 km block、hundred-block precision 与 64/0/64/0 fit-state outcome 可见；forecast 空且 authority 全 false |
| 2026-08-30 | P4 URL/storage/network/share 私隐边界关闭 | 私人地址、raw lng/lat 与派生 EPSG point 仅允许 runtime；私人 address/buffer 在网络任务前 fail closed，公共 district/tract 使用 private-null snapshot；legacy 私人 IndexedDB 行保留但不可 restore/share/resave/export |
| 2026-08-30 | P4 浏览器独立复核先返回 REQUEST CHANGES，修复后 PASS | `8e540dd` 将 healthy path 绑定到 tracked/built v2 逐字节一致和完整 view/contract/i18n/CSS freshness，四格正向断言 source-as-of、coverage、UTC week、geometry、exclusions 与非个人概率/安全结论 |
| 2026-08-30 | P5 分派 source lifecycle、join/DQ、readiness/product 三个互斥用户可见任务 | 预算达到 3/3；全部显式使用 `high`，root 保留 exact M1 scan、真实 artifact、production build 与 browser gate 的唯一所有权 |
| 2026-08-30 | fresh bounded official observation 取代旧 2026-08-21 smoke 作为 P5 时钟/schema/count 输入 | observation semantic identity `8f37f779...3433a`、exact file `d8c23444...90079`；mutable metadata 仍不等于 immutable payload、completeness、join 或 redistribution authority |
| 2026-08-30 | 九源 lifecycle 从 fresh observation、exact M1 receipt 与 HIN receipt fail-closed 合成 | lifecycle `3d159c0d...04b09`；只有 reported-crime 从 exact M1 得到 available，HIN 因 legacy review/build clocks 不完整保持 partial，其余缺 exact payload/revision 的来源 partial/unavailable |
| 2026-08-30 | citywide join/DQ 不读取私人地址、parcel 或 source rows | ledger `f717464a...dcc3d`；9 个维度全部 `total:null`、`available_zero:false`，PPD source-ready 仍是 join not-admitted，HIN 不被升级为 raw crash/current safety |
| 2026-08-30 | readiness 首轮集成复核连续拒绝 false-green，root 恢复严格门后通过 | runtime/producer 重算 identity、闭合九源九维 nested types/status/cross-bind；writer atomic no-overwrite 且 cleanup failure 可见；被缩减的 integration/browser coverage 已恢复 |
| 2026-08-30 | Home Compare 严格 private zero-egress 与 citywide readiness 同时产品化 | tracked readiness `cb796760...f04a`, 18,548 bytes / file `b8f04859...7da5`；公开 limitation/reason/DQ 为固定安全模板；真实 build/browser en/zh x desktop/mobile PASS，clipboard/URL/history/web storage/IndexedDB 无私人值，address-level profile 诚实 unavailable |
| 2026-08-30 | P6 冻结为 crash/accessibility、mode-legality/match-quality、segment-sensitivity/product 三条互斥车道 | 预算 3/3，全部 `high`；A/B 只产独立 aggregate-only v1 evidence，C 只消费已验证身份；HIN、PPD、OSM 与 M5 不得代替 raw crash/accessibility/mode authority |
| 2026-08-30 | P6 三条车道完成并在 root 接入真实 build/UI 边界 | A/B/M4 route、corridor、data-version 与 canonical catalog identity 全部交叉绑定；v3 artifacts 绑定完整 v2 handoff 和 frozen M2 protocol；默认产品零新增 evidence 请求并明确显示 unavailable |
| 2026-08-30 | 没有获准的 raw-crash、citywide accessibility、per-mode legality 或 sensitivity variant producer | crash/accessibility、四个 mode、match quality 与 sensitivity 分维度 fail closed；HIN 仅 historical planning context，generalized reported incidents 不升级为 raw crash，禁止 score/rank/winner/safest/recommendation |
| 2026-08-30 | P6 扩大本地验证完成 | focused 45/45、Known Route/HIN/corridor 113/113、Product Integrity 80/80、Architecture Ports 7/7、production build 与 en/zh desktop/mobile browser gate 全部 PASS；未 push、deploy 或扩大 authority |
| 2026-08-30 | P6 final focused re-review PASS | 已关闭 product reachability、self-signed sensitivity、v2 handoff/protocol、catalog bridge、score spelling 与 exact publication findings；无剩余 material correctness/privacy/authority 问题 |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| P1 local artifact mirror | root integration owner | `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/logs/mirror.log` | completed exit 0 in session `60979`; 1,596 objects / 10,811,898,840 bytes / 8,785,158 declared rows copied and atomically promoted; authority remained all false |
| P1 clean-room M1 restore | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/logs/cleanroom-m1.log` | completed exit 0 in session `11727`; 1,456 restored / 1,456 verified / 9,984,857,453 bytes declared; target atomically promoted, no backup |
| P1 clean-room M1 exact validator | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/logs/cleanroom-m1-exact-validator.log` | completed exit 0 in session `68293`; receipt `bc439541...e315`, 3,586,620 canonical rows; CLI path-policy refusal was separated from the exported exact data validator |
| P1 clean-room M2 restore | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/logs/cleanroom-m2.log` | completed exit 0; 140 restored / 140 verified / 827,041,387 bytes declared; target atomically promoted, no backup |
| P1 clean-room M2/evaluation exact validator | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/logs/cleanroom-m2-exact-validator.log` | completed exit 0 at `1288ae1`; M2 `be26fcab...6d76`, 128 parts / 1,611,918 rows / 825,033,042 bytes; evaluation idempotent, unavailable and not-promoted |
| P1 clean-room identity reproduction | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-artifacts/p1-dfev1-122bba9/logs/cleanroom-identity-reproduction.log` | completed exit 0; bundle ID reproduced and all three metadata files are byte-identical |
| P2 exact spatial attribution A | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-phase2/.dfev1/p2-spatial-attribution-real-ab57e1d3-a` | completed exit 0; bundle `28598f...8042a`; canonical 3,586,620; tract mapped/ambiguous/unmapped 2,972,905 / 549,598 / 64,117; grid mapped/unavailable 3,530,212 / 56,408 |
| P2 exact spatial attribution B | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-phase2/.dfev1/p2-spatial-attribution-real-ab57e1d3-b` | completed exit 0; same bundle and all four published files byte-identical to A |
| P3 exact M2 rebuild | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-phase2/.dfev1/p3-area-intelligence-997aaf/m2` | completed exit 0; artifact `df200d...9861`, 3,586,620 canonical rows, 1,611,918 mart rows, 128 parts / 825,033,042 bytes, peak RSS 246,677,504 bytes |
| P3 exact evaluation | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-phase2/.dfev1/p3-area-intelligence-997aaf/evaluation` | completed then idempotent; `not-promoted`, no candidate, 64/64 fit states non-converged before cap, 9 artifact hashes stable, peak first-run RSS 136,650,752 bytes |
| P5 source lifecycle | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-phase2/.dfev1/home-compare-p5/source-lifecycle-8f37f779/lifecycle.json` | completed from exact inputs; 9 source receipts, identity `3d159c0d...04b09`, authority false |
| P5 join/DQ ledger | root live-test owner | `C:/Users/raede/Desktop/dev/engagement_project-phase2/.dfev1/home-compare-p5/join-dq-3d159c0d/ledger.json` | completed aggregate-only; 9 dimensions, identity `f717464a...dcc3d`, no admitted address join or zero-filled total |

## Handoff

P1 已完成 provider-neutral DataOps clean-room 闭环。P2 已完成 exact denominator、四方法 comparator 与逐字节一致的 aggregate-only evidence。P3 已冻结协议并从 exact M1 重建新 M2；真实 evaluation 因 64/64 count-model fit states 未在 iteration cap 前收敛而诚实 no-promotion，幂等复跑的 9 个 artifact 全部字节不变。P4 已将这些证据投影为中英文、桌面/移动均可验证的 aggregate-only 历史证据界面，并关闭新的私人值 URL/storage/network/share 通路。P5 已将 9 个 Home Compare 来源的独立 identity/freshness/coverage/DQ 状态投影到真实 tracked readiness；exact PPD、partial HIN 和其它 partial/unavailable 来源继续分开，私人地址级 profile 与 routing 仍 fail closed。P6 已建立 Known Route crash/accessibility、四 mode legality、match quality、segment projection 与 product boundary；由于真实 source/variant authority 不足，对应维度诚实 unavailable，未生成 safety score、winner 或 safest route。所有本地证据均不扩大为 cloud/cross-machine、CI、serving、scientific、causal、safety、routing、redistribution 或 deletion authority。

## Next step

Phase 2 P1-P6 的本地 integration scope 已完成。若继续，必须由用户另行授权远端 push/PR/CI/部署、外部对象存储，或为 P5/P6 选择并许可真实 citywide/raw-crash/accessibility/mode-legality 数据；在此之前保持现有 local candidate、partial/unavailable 状态与全 false authority，不清理 primary WIP 或 ignored evidence。
