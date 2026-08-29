# Task

## Current status

`M1-M6 local execution complete — persistent M1/M2/M4 evidence rebuilt; current integrated candidate 6308bbd passed full local validation and focused M5/M6 review with P0/P1/P2/P3 zero; public Diary writes and product routing remain unavailable/NO_PRODUCT_PROMOTION`。

## Checklist

- [x] 完整读取用户指定规划对话并冻结 M1-M6 语义。
- [x] 核对 local main/current branch/worktrees/dirty state 和适用 `docs/AGENTS.md`。
- [x] 证明旧 M1/M2 ignored 重型数据已丢失、tracked pipeline 仍在。
- [x] 建立隔离监督 worktree 和唯一三件套。
- [x] 派发 M1-1 数据重建、M1-2 ingest 恢复、M1-3 空间/ACS/DQ 三个 high 任务。
- [x] 记录三个任务的真实 thread/worktree/HEAD；均从 `9d93df2` 干净起步。
- [x] 在监督 base 运行 M0/M1 聚焦基线并记录结果。
- [x] 接收 M1-2/M1-3 source-final commits，按顺序整合并通过联合回归。
- [x] 派发 M1-4 独立集成与数据门禁 reviewer；本阶段新任务达到 4/4。
- [x] 接收 M1-4 首轮代码门禁：REQUEST CHANGES；hostile overlap 复现确认 P1。
- [x] 整合 M1-2 补丁并让 M1-4 对修复后的精确 SHA 复审：PASS。
- [x] 由 M1-1 从全新根生成 full data receipt、exact rerun 与 validate-only。
- [x] 运行 M1 stage gate；记录 independent reviewer-channel 缺口并冻结 M2 exact input。
- [x] 派发 M2-1 protocol/integrity、M2-2 unique data owner、M2-3 serving/UI 三个 high 任务。
- [x] 整合 protocol-v2 和 serving source-final，运行中央代码门禁。
- [x] 给 M2-2 精确数据 GO，完成 mart exact rerun 与 frozen evaluation。
- [x] 创建 M2-4 最终 reviewer 并完成 M2 exact data/evaluation stage gate。
- [x] M2 Area Intelligence stage gate。
- [x] 派发 M3-1 source/admission、M3-2 comparison/privacy、M3-3 UI/browser 三个 high 任务。
- [x] 整合 M3 source-final candidates 并运行中央 Home Compare gate。
- [x] 创建 M3-4 最终 reviewer；首轮复核在 `a795450` 以 3 个 P1、1 个 P2 fail closed。
- [x] 复用 M3-1/M3-2 修复全部四项 findings，并在监督 worktree 运行合并态中央门禁。
- [x] 让 M3-4 对修复后的精确候选做 focused re-review 并完成 M3 stage gate。
- [x] M3 Home and Neighborhood Compare stage gate。
- [x] M4 Known Route Evidence stage gate。
- [x] M5 Adaptive Route Alternatives stage gate。
- [x] M6 Local Diary / closed Community Evidence stage gate。
- [x] 识别旧 `ac89`/`79c2`/`f1a1` ignored evidence roots 已随临时 worktree 删除，禁止继续把历史路径当作当前证据。
- [x] 建立持久数据工作树并从当前 exact code 重新生成 M1、M2 和 M4；逐阶段完成首次运行、精确复跑和 validate-only/lineage gate。
- [x] 将 M2 protocol 只重冻到当前 M1 exact receipt，将 M5 receipt 只重绑定到当前 M4 handoff；科学字段、图 identities 与 authority 语义不变。
- [x] 在 exact `6308bbd` 完成 `npm run validate`、bundle、M5 浏览器门禁及 M5/M6 聚焦独立复核。

## Validation evidence

下表保留完整执行时间线；其中引用已删除 `ac89`/`79c2`/`f1a1` roots 的行仅是历史记录。
当前可重验数据声明以其后的 “Persistent recovery evidence” 为唯一准线。

| Command or check | Result |
| --- | --- |
| `git status --short --branch` on primary | primary branch has only untracked logs/output; preserved. |
| `git status --short --branch` on phase1-main | clean local main, ahead of local origin/main by 93. |
| `.dfev1` inventory on phase1-main | `crime` directory contains 0 files. |
| known historical data roots `c180` and `fed9` | absent; no recovery shortcut available there. |
| `git worktree add -b codex/dfev1-m1-m6-supervisor ... main` | exit 0 at exact `9d93df2`. |
| `npm ci` | exit 0; 395 packages installed, 396 audited, 0 vulnerabilities. |
| `npm run test:data-pipeline` | exit 0; 66/66 M0-M3 pipeline/contract tests passed. |
| `npm run data:check:tract-crime` | exit 0; current 408-tract snapshot/full receipt/runtime projection pair valid for `[2025-08-01, 2026-08-01)`. |
| M1-2 source-final `3837512` | task tests 68/68; official one-day smoke 386 rows; rerun idempotent; integrated as `ffa8d45`. |
| M1-3 source-final `35c6cee` | task tests 67/67 plus focused 11/11; integrated as `5d1b0d8`. |
| `npm run test:data-pipeline` after both integrations | exit 0; 69/69 passed. |
| focused ESLint on M1 contract/source/warehouse/spatial/ACS/tests | exit 0. |
| `git diff --check` after both integrations | exit 0. |
| M1-1 source preflight | live count 3,586,621 for `[2006-01-01, 2026-08-28)`; no current warehouse receipt yet. |
| M1-4 review of `9d93df2..5d1b0d8` | REQUEST CHANGES; targeted 13/13, syntax, ESLint and JSON parse pass, but hostile overlap repro confirms canonical drift can be re-signed. |
| M1-1 sync to detached `4c9abe2` | code/contract tree equals supervisor `5d1b0d8`; 13/13 + ESLint + diff-check pass; new data root remains absent. |
| M1-2 repair source-final `34b90bd` | three new regressions red before fix; focused 6/6 and full task suite 71/71 after fix. |
| supervisor cherry-pick `037c615` | combined `npm run test:data-pipeline` 72/72; targeted ESLint and diff-check pass. |
| M1-4 re-review of `037c615` | PASS; independent hostile script now rejects before transaction; 16/16 targeted tests plus syntax/ESLint/JSON/diff-check pass. |
| M1-1 final sync | detached `8325842`; product tree equals supervisor `037c615`; formal source-final root and run1 ownership frozen. |
| M1 formal root | 10,061,298,932 bytes / 1,514 files; 21 manifests / 1,344 raw shards; 3,586,620 acquisition = canonical = active rows; 64 canonical partitions / 8,741,798,048 bytes. |
| M1 first backfill | exit 0; 4,507.311s; peak RSS 967,610,368 bytes; checkpoint 21/21. |
| M1 exact-command rerun | exit 0; 3,712.230s; all 21 acquisition/ingest phases idempotent; receipt bytes/mtime/identity unchanged. |
| M1 `--validate-only` | exit 0; 1,003.474s; frozen receipt and actual warehouse admission revalidated. |
| M1 receipt identity | declared `sha256:cd7585ae6de518cbbf57ab5c301073a69ef3c4d6543ec6d3acdadc253b3e16e4`; manifest/checkpoint/lineage/current quality/canonical bindings present. |
| bounded spatial/ACS/DQ gate | PASS; coordinate/tract/grid/corridor/ACS state sums each equal 3,586,620; unavailable is not zero; serving/integration remain false. |
| final delegated data-review follow-ups | M1-3 twice, M1-2 fallback once and M1-4 once completed with 0 items; no independent reviewer verdict may be claimed. |
| M2-1 source-final `5607949` / supervisor `285ede0` | protocol v2 SHA `d7d75ce0eb0aaf80b950aa87125e5a98742dca57db38d22938b3851fed048ff6`; exact 9.37 GiB M1 gate exit 0; 8/8 hostile tests and targeted ESLint pass. |
| M2-3 source-final `3c8b3d4` / supervisor `dcd31ce` | run/v2 + seam parts + coverage/source continuity + publication rollback integrated; no real publish or performance run. |
| central M2/publisher focused suite | exit 0; 21/21 PASS. |
| central i18n suite | exit 0; 11/11 PASS. |
| central targeted ESLint and commit diff-check | exit 0. |
| central `npm run build:manifest` | exit 0; production build complete. |
| central `npm run verify:bundle` | PASS; 3,999,977 / 4,000,000 bytes excluding declared ACS VRE source artifact. |
| central Area Intelligence browser | PASS; current-lineage promoted/not-promoted/invalid, responsive, zero console/page errors. |
| M2-2 first GO pre-write protocol check | BLOCKED safely before root/process: LF Git blob SHA `d7d75ce0…` versus CRLF worktree SHA `f67fa948…`. |
| supervisor `5c1f11d` protocol-byte fix | `.gitattributes` forces LF; M2 test asserts 6,935-byte LF-only SHA `d7d75ce0…`; 8/8 + ESLint + byte/diff checks PASS; protocol blob unchanged. |
| M2-2 exact pre-write gate at `37359d7` | tracked clean; protocol-v2 6,935 bytes / 0 CR / SHA `d7d75ce0…`; focused 8/8; exact fresh root absent; M1 receipt `cd7585ae…` with 3,586,620 rows / 64 parts. |
| M2 mart run1 and identical rerun | exit 0; 1,265.499s then 1,007.255s; rerun `idempotent`; manifest/checkpoint/64 parts (66 files) had 0 bytes/SHA/mtime changes. |
| M2 mart exact inventory | schema `/v2`; 64 parts / 1,611,918 rows / 825,033,042 part bytes; artifact identity `5ad0b1d0…aba894`; all actual part rows/bytes/SHA match. |
| M2 evaluation run1 and identical rerun | exit 0; 285.620s then 6.386s; rerun `idempotent`; manifest/checkpoint/7 artifacts (9 files) had 0 bytes/SHA/mtime changes. |
| M2 frozen promotion gate | honest `not-promoted` / `unavailable`; selected promotion model `null`; 7/7 artifacts match actual bytes/SHA; serving artifact validates with 0 predictions. |
| main independent M2 root validation | mart validator rehashed exact parts and protocol successfully; evaluation `/v2` seam matches protocol, actual mart manifest/identity, 64 parts, 1,611,918 rows, exact M1 receipt and outcome. |
| M2-4 initial review at `d23863b` | FAIL with one P1: production UI used a weak present-lineage check and accepted malformed current lineage that the strict validator rejected; artifact/scientific subgates remained truthful. |
| supervisor runtime repair `7f167e6` | UI now calls strict serving-candidate validator; built-browser hostile present-lineage case is `invalid`; M2/publisher 21/21, ESLint, diff-check, build, bundle and Area browser PASS. |
| unchanged bundle ceiling after repair | PASS at 3,996,762 / 4,000,000 non-VRE bytes; build-only HTML compaction removed 5,282 indentation bytes while preserving every line break and text spacing. |
| general browser-smoke diagnosis | same Analysis History line-716 timeout reproduced on exact unmodified `d23863b` in a fresh worktree/npm install/original HTML; not caused by the M2 repair, but remains an existing repository test gap. |
| M2-4 focused re-review of `7f167e6` | P0/P1/P2 zero; M2 code+artifact local gate PASS and M3 unavailable-only admission PASS; scientific promotion and tracked publish/serving remain FAIL. |
| M3-1 source/admission `3b78b73` plus bundle repair `06b1b44` | official-source POST/no-log seam, future transfer-date withholding and independent source failure isolation integrated; no endpoint, field, query condition, policy or dependency changed by the repair. |
| M3-2 comparison/privacy `eb51e8f` | 28/28 task gate; unique normalized address/parcel admission, exact 100.0% largest-remainder weights, stale-session cancellation, private alias rejection, M2 history/unavailable-only and commute unavailable enforced. |
| M3-3 UI/browser `148cfaa` plus POST fixture repair `c06dcfc` | close destroys the private session owner; rejected private share state is removed; empty results have an accessible name; built fixture follows POST bodies without weakening duplicate or privacy gates. |
| central M3 domain/source gate at `5e21439` | exit 0; 29/29 Home Compare and source-privacy tests, targeted ESLint and commit diff-check PASS. |
| central M3 production build and bundle | build exit 0; non-VRE dist 3,998,837 / 4,000,000 bytes, leaving 1,163 bytes; ceiling/config/dependencies unchanged. |
| central M3 built-browser gate | PASS for 2/3/4 profiles, English/Chinese, partial/unavailable, M2 not-promoted/unavailable, commute unavailable, 390px, named dialog/results, focus restoration, no private URL/history/storage/IndexedDB/share values, destinations not transmitted, and 0 console/page errors. |
| central public-landmark live admission after final repair | one high-confidence candidate, one exact OPA join, 0.9 m point agreement, profile partial, all nine source states partial, and 0 new query/retry logs; no address, coordinate or parcel was printed or persisted. |
| M3-4 initial review of `a795450` | local gate FAIL; P0=0, P1=3, P2=1. Future OPA property dates, ordinary unsafe conclusion text, camelCase private aliases, and source endpoint/dataset/schema drift were accepted. All other focused/browser/bundle/privacy gates passed. |
| M3-2 review repair `04a047c` / supervisor `73a3a97` | normalized camel/snake/kebab private keys; recursively rejects identity aliases and unsafe conclusions across metric/source/profile/root text while preserving ordinary `sourceId`/non-identity `ownership`. Task gate 31/31, build, bundle and browser PASS. |
| M3-1 review repair `98f7b49` / supervisor `0bb709d` | OPA property dates later than retrieval +1 day are withheld and counted; metric becomes partial and `dataAsOf` uses admitted dates only. A synchronous code-owned SHA-256 identity binds all nine source endpoints/datasets/field contracts. |
| central merged M3 repair gate at `0bb709d` | 32/32 Home Compare/source tests, targeted ESLint, build, diff-check and built-browser PASS; source registry chunk 4,601/1,985 raw/gzip; non-VRE 3,999,488/4,000,000 bytes, leaving 512 bytes; zero console/page errors. |
| M3 semantic hardening through `4201fcb` | Removed match-wide negation and bounded proximity inference, bound direct/causal predicates locally, scoped metadata to trusted subjects, compacted generated Vite manifest from 18,152 to 14,681 bytes, and passed 51/51 plus built-browser; reviewer still found four classes of ordinary-language variants. |
| fail-closed semantic candidate `0602a4a` | Replaced open-ended direct/causal/evidence inference with unsafe-lexicon default denial and fully anchored owned disclosure, quantified denial, metadata and operational allowlists; 53/53, ESLint, build, bundle and browser passed, but reviewer reproduced one P1 where `.+` in evidence denial swallowed a later assertion. |
| evidence-denial repair `9ccabe5` | EN/ZH evidence denials now bind one complete controlled target and reject cross-sentence, inference and second-predicate suffixes; 54/54 PASS, bundle 3,999,738/4,000,000 and browser PASS. Reviewer independently found 0 semantic/source/privacy findings, but exposed an existing close/reopen browser-test race at 2 PASS / 2 FAIL. |
| final browser-gate repair `7a0f03c` | Test waits for the newly mounted visible dialog and exactly two visible empty address controls before checking a fresh private session; no sleeps/retry swallowing or product-code change. Central and independent reviewer each obtained six consecutive browser PASS runs; final reviewer verdict P0=0/P1=0/P2=0, M3 local gate PASS, M4 admission PASS. |
| M4 integrated code gate through `b4fcc63` | M4 16/16, Centerline 3/3, targeted ESLint, build, bundle and built-browser all PASS; the live public ArcGIS transaction returned 47 deterministic reference features with exact count, EPSG:4326 CRS, object-id and metadata recheck bindings. |
| M4 source-final ignored root | `full-warehouse-source-final-b4fcc63` contains exactly `checkpoint.json`, `aggregate-report.json` and `final-handoff.json`; 64/64 M1 partitions, 3,586,620 rows and 8,741,798,048 raw bytes bind receipt `cd7585ae…e16e4` and M2 mart `5ad0b1d0…ba894`. |
| M4 fresh writer plus completed rerun | first writer exit 0; completed rerun returned `restoredCompletedCheckpoint:true` and `idempotent:true`; exact inventory, bytes, SHA-256 and 100ns mtimes had zero changes and no temp/backup/transaction residue. |
| M4 evidence semantics | 3,530,212 generalized eligible rows, 2,024 contributors and 609.840838 aggregate contribution units; coverage `[2006-01-01, 2026-08-28)`; M2 remains `not-promoted/unavailable`, Centerline remains reference-only and routing/accessibility/safety authority remains false. |
| M4-4 exact-tip review of `b4fcc63` | PASS / APPROVE with P0=0, P1=0, P2=0, P3=0; all original 3 P1 and 1 P2 findings CLOSED; reviewer independently repeated public validate-only, data-chain, focused code, build, bundle and browser gates on a clean exact tip. |
| M5 mature OSRM graph and v3 responder receipt | Project OSRM 26.8.0 / Windows x64 / MLD / `foot.lua`; 26 graph files / 2,533,170,416 bytes; v3 validate-only binds receipt `1cbbf205…fced8`, GraphArtifact `3adc0b82…901e0`, topology `25f3d33d…e0e3a`, geometry `eef990bb…c75b`. |
| M5 v3 public-probe causality | OS-assigned loopback port; readiness and both query boundaries bind the unique listener owner to the spawned child PID; byte-identical canned port pre-owner fails closed and is not terminated. Final sibling is 5 files / 37,546 bytes; original 86-file / 2,952,679,139-byte root is unchanged. |
| M5 authority-neutral alternatives core | 16/16 PASS; Pareto, balanced sensitivity, accessibility `available/partial/unavailable`, unknown candidate inventory, duplicate conflicts and terminal contradictions are mechanically distinct. Production wrapper remains fixed `m5-authority-unavailable`. |
| M5 product/browser no-promotion gate | 2/2 private-sentinel self-tests plus Chromium desktop/mobile x English/Chinese PASS; per-cell Axe serious/critical and overflow are zero; console/page/private/candidate-OSRM requests are zero. |
| M5 central build and bundle | `build:manifest` PASS at 263 modules; non-VRE bundle 3,999,824 / 4,000,000 bytes, leaving 176 bytes; ceiling unchanged. M4 16/16 and Known Route browser remain PASS. |
| M5-4 independent review | initial exact `d7f55aa` returned P0=0/P1=0/P2=4/P3=1; repairs reused M5-1/2/3 with no fifth task. Focused re-review of exact `7a8cd80` returned APPROVE with all original findings CLOSED and new P0/P1/P2/P3 zero. |
| M6 initial integrated candidate `4360960` | IndexedDB `engagement-diary` v2 CRUD/restart/export/delete and preview-confirm one-time replace token implemented; public submit/agree/improve fixed deterministic `unavailable` with zero transport; Sample Community neutral/static contracts integrated through 4/4 high tasks. |
| M6-4 initial review of `4360960` | REQUEST CHANGES with P0=0/P1=2/P2=2: storage unavailable/partial was lost at the Insights port, sample segment cards retained counts/confidence/write CTAs, Data Scope omitted full hidden/ARIA limits, and Help implied a configurable upload seam. |
| M6 review repairs | M6-1 source `dd9d809` integrated as `ad97e75`; full storage snapshot now reaches final Insights DOM and keeps unavailable/partial distinct. M6-3 source `9e5ce6e` integrated as `6eed490`; example cards are static-invented-read-only, full bilingual truth reaches visible/hidden/ARIA/title/data attrs, mobile text is not clipped, and Help states there is no current upload/share capability. |
| M6 central exact-candidate gate | 14 focused groups 414/414 plus visual baseline policy 66/66, targeted ESLint/Stylelint/diff-check, Diary/M4/M5 Chromium, and full `npm run validate` all PASS. Fresh 264-module bundle is 3,993,513 / 4,000,000 non-VRE bytes, leaving 6,487 bytes; ceiling unchanged. |
| M6-4 focused re-review of exact `6eed490` | APPROVE with all four original findings CLOSED and new P0/P1/P2/P3 zero. Independent fresh evidence: M6 contracts 349/349, focused truth 20/20, full visual 35 passed / 10 policy-skipped / 0 failed, Diary/M4/M5 browsers PASS, 3 private sentinels with zero console/URL/request/WebSocket leakage. |

## Persistent recovery evidence (supersedes deleted-root rows)

| Current artifact or gate | Result |
| --- | --- |
| Persistent worktree | `C:/Users/raede/Desktop/dev/engagement_project-data-foundation`, branch `codex/dfev1-data-foundation-persistent`; retained with the supervisor worktree. |
| M1 current warehouse | 1,496 files / 10,060,285,521 bytes; 64 canonical parts / 3,586,620 rows / 8,741,798,048 bytes; aggregate `sha256:f936b166…16cb6`; coverage `[2006-01-01, 2026-08-28)`. |
| M1 current receipt and reruns | Exact receipt identity `sha256:bc439541…5e315`; first full run, exact rerun and validate-only exit 0; all 21 acquisition/ingest scopes idempotent. |
| M1 current DQ | coordinate available/missing/invalid/outside = 3,530,212/56,034/338/36; tract mapped/ambiguous/unmapped = 2,972,905/549,598/64,117; grid mapped/unavailable = 3,530,212/56,408; all corridor states unavailable; ACS available/unavailable/incompatible = 651,264/613,715/2,321,641. |
| M2 protocol refresh | Protocol remains 6,935-byte LF-only; current SHA `5c6361a3…e7eac` binds only the current M1 receipt. Frozen v1-derived models, folds, metrics, thresholds, slices and promotion rules were not changed. |
| M2 current mart/evaluation | Root 8,331 files / 1,548,712,302 bytes; 128 mart parts / 1,611,918 rows / 825,033,042 part bytes; artifact identity `sha256:be26fcab…96d76`; exact mart and evaluation reruns are idempotent. Evaluation remains `not-promoted`, selected model `null`, forecast `unavailable`; publisher was not run. |
| M4 current Known Route | 3 files / 27,205 bytes; semantic identity `sha256:d153850a…b4c38`, handoff identity `sha256:c0ea04ce…1c63f`; first build and completed-checkpoint rerun exit 0/idempotent. 2,024 rows contribute 609.840838 units; report remains `partial`, Centerline reference-only, safety/accessibility/routing authority false. |
| M5 current M4 rebind | Current M4 copy is exactly 5,401 bytes / raw SHA `68aa8579…c470`; new receipt identity `sha256:378bf673…9ebf0` exactly matches the private registry. GraphArtifact/topology/geometry remain `3adc0b82…901e0` / `25f3d33d…0e3a` / `eef990bb…c75b`; old receipt is audit-only with no fallback. |
| Exact `6308bbd` central gates | `npm run validate` exit 0; route-real 350/350, alternatives 16/16, private gate 2/2, desktop/mobile × en/zh Chromium PASS, fresh bundle 3,993,513 / 4,000,000. |
| Exact `6308bbd` focused reviews | M5 rebind and M6 regression each APPROVE with P0/P1/P2/P3=0. M6 current diff contains no Diary/Community files; its original full visual approval remains anchored at `6eed490`. |

## Open risks and remaining work

- 旧 M1 `ac89`、M2 `79c2` 和 M4 `f1a1` worktree/ignored roots 已被自动移除；其表中数字只保留为历史审计，不能重新验证或作为当前证据。当前可读根只以本节的持久工作树为准，未经单独清理授权不得移动、回收或删除。
- M1-1 的历史 50,000-row partial 明确无效且其旧根现不可读；任何下游不得发现旧路径后自动 fallback。
- 新 pre-ingest full scan is intentionally O(canonical bytes + rows)；exact rerun 观测到约 190.7 GiB
  机械扫描下界和 93,252,120 row inspections，后续增量性能需单独优化但不能削弱 fail-closed gate。
- 独立 final data reviewer 通道没有返回 evidence；M1 只能声明 local mechanical gate PASS，不能声明
  independent data-review PASS，也不能据此开放 serving/publish。
- 当前只有本地 evidence；remote CI、scheduled refresh、deployment 和 product liveness 均未运行。
- M2 历史结论为 honest `not-promoted`，本轮不得因追求功能而放松预注册 gate。
- M2-1 memory quick pass 意外暴露旧 performance 摘要；科学规则机械等同旧冻结 v1 且未读取
  本轮结果，因此没有结果驱动调参，但不得声称严格观察者盲态无污染，M2-4 必须独立评估。
- 本轮 frozen gate 未选出可发布模型：Poisson 与 negative-binomial 均有 primary/category/coverage
  失败；M2 forecast/serving 必须保持 `unavailable`，不得把 aggregate gain 或 audit model 当作 promotion。
- M2 当前 ignored root 位于持久工作树；publisher 未运行，历史 tracked serving artifact 未被本轮覆盖。
- M4 reviewer 的历史观测为 3,999,920/4,000,000 non-VRE bytes；M5 历史 exact build 为
  3,999,824/4,000,000；当前 exact `6308bbd` 为 3,993,513/4,000,000，余 6,487 bytes。
  这些属于不同 exact checkout/fresh build 观测；ceiling 始终未变，后续 bundled 改动仍须先做
  真实 code-splitting/体积收敛。
- 全局 `test:browser-smoke` 当前稳定停在既有 Analysis History “Needs refresh” 等待；已在精确
  未修改 `d23863b` 新环境复现。M3 不能把该缺口冒充为本轮 Area Intelligence 回归或忽略它。
- Protocol identity depends on raw bytes by design；所有非 Git/manual copies也必须通过 exact SHA gate，
  不能只比较解析后的 JSON 语义。
- M4 当前精确三工件和本轮 M1/M2 lineage 位于持久工作树；旧 `full-warehouse` 路径仅作审计历史，禁止自动 fallback。
- M4 Centerline 只拥有 reference topology/geometry authority；M5 的 accessibility、safety 与
  realtime 权限不能从它继承。M5 现有 OSRM authority 仅限本机、固定公开 probe 与 same-session
  private handle；`candidateGenerationAuthorized:false`、`privateRuntimeProductPromotion:false`，
  不得作为任意私人路线或产品 routing authority。
- M5 原始图、旧 receipts 和当前新 sibling receipt 在本次 closeout 后继续保留；代码只接受当前
  `sha256:378bf673…9ebf0`，不得 fallback 到旧 receipt，也不得把测试 seam 或序列化 handle
  当作调用者可扩展权限。
- M6 浏览器证据限于本机 Windows Chromium；未覆盖 Safari/Firefox、无痕模式、quota/eviction、
  断电/崩溃或长期耐久性。IndexedDB 事务与应用级 replace guards 不构成灾难恢复保证。
- M6 当前不存在上传、共享或公共社区写入能力；任何未来 moderation/abuse/deletion/k-anonymity/
  authority 服务必须作为独立能力重新设计、审查并获得外部发布授权，不能复用当前 unavailable seam。
