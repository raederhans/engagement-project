# Task

## Current status

`honest partial with explicit blocked gates - Stage 4G complete`。Implementation commit
`e9db82eaf5f47e8bb49f1d83acf377a7981218ee` delivers the user workflow and passed local gates.
Centerline matching is verified only as reference-topology matching; HIN remains partial, while raw
crash and accessibility remain unavailable. This is not citywide or routing authority.

## Checklist

- [x] Verify exact `HEAD=b78ee208...`, base object/ancestry, detached clean status and worktree ownership.
- [x] Read all user-specified Skills, `docs/AGENTS.md`, templates and relevant M0-M3 boundaries.
- [x] Record initial M1/M2/M3 inventory/mtime/manifest identity without reading private/event rows.
- [x] Verify current City Street Centerline/HIN/PennDOT source, license, limitations and admission gaps.
- [x] Create the unique `known-route-evidence-v1` plan/context/task record set.
- [x] Freeze and test route schema/canonicalization/privacy/source/map-match/corridor contracts.
- [x] Implement official centerline bounded query/admission and deterministic fail-closed map-match.
- [x] Implement generalized M1 corridor contribution builder with ignored checkpoint/output/log.
- [x] Integrate HIN partial and raw crash/accessibility unavailable as independent evidence dimensions.
- [x] Add independent lazy bilingual workflow, segment drill-down, sources/limitations and safe share state.
- [x] Run focused tests, targeted lint/style and bounded official/public-landmark smoke.
- [x] Run full M1 warehouse aggregate and exact rerun/idempotency checks.
- [x] Run production build, original bundle gate, final-dist browser smoke and full `npm run validate`.
- [x] Recheck upstream identity, task-owned process/port cleanup, privacy scan and package/lock drift.
- [x] Apply Lore commit protocol, create local commits, verify exact commit chain and clean closeout.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Initial `git rev-parse HEAD` / `git status --short --branch` | Exact `b78ee20816d1f14703aa8670ca24e8ae0ff3e010`; detached; clean. |
| Initial `git cat-file -t b78ee208...` / ancestry check | Commit exists; ancestry exit 0; initial HEAD equals base. |
| M1 initial inventory/identity | 1,495 files / 49 dirs / 9,940,613,544 bytes; manifest/checkpoint identities match prior M2 gate. |
| M2 initial inventory/identity | 4,171 files / 70 dirs / 1,546,732,384 bytes; mart/evaluation/serving identities recorded. |
| M3 initial inventory/identity | 812 files / 1,186 dirs / 41,189,590 bytes; official smoke manifest identity recorded. |
| City Street Centerline metadata/count/bbox smoke | Query-only FeatureServer; 41,271 features; 2026-07-29 data edit time; 822 features in public Center City bbox; selected geometry/schema observed. |
| Source admission review | Centerline valid only for reference-grade geometry/topology matching; mode routing and accessibility unavailable; HIN partial; raw crash unavailable pending separate acquisition. |
| `npm run test:known-route-evidence` | 9/9 pass: strict input and malicious payloads, deterministic identity/match, fail-closed states, generalized-location uncertainty, additive contributions, strict checkpoint recovery, lazy/privacy boundaries and route-free share state. |
| `node --check` M4 UI/runtime/controller | Pass. `git diff --check` pass. |
| Official public-landmark smoke | Current City centerline `2026-07-29T13:55:32.074Z`; 13 query features; 3 matched analysis segments / 4 distinct nodes; max match distance 26.96 m; deterministic repeat true. HIN current contract 162 features and route association admitted zero; raw crash/accessibility unavailable. |
| Production manifest / original bundle gate | Build pass. Existing ceilings unchanged: Route UI 23,985/8,245; Home Compare 53,386/17,949. Independent M4 chunk 36,090/12,879 within its 36,500/13,100 admission. Non-VRE dist 3,990,906/4,000,000. |
| Pre-full-scan M1 identity recheck | Exact initial inventory/mtime/manifest/checkpoint identities unchanged; no upstream mutation observed. |
| Full M1 aggregate | 64/64 partitions and 3,583,548 rows read in 40,006 ms; peak RSS 149,561,344 bytes; 3,527,128 location/category-eligible rows, 4,680 contributing rows, 2,163.395448 contribution units across 3 segments; segment sum exact. |
| Exact command rerun | Completed checkpoint restored with `restoredCompletedCheckpoint:true` and 64 run-resumed partitions; semantic identity `sha256:52ee6fc...` and 6,143-byte report bytes unchanged. Privacy flags all false; no combined safety score. |
| `npm run test:known-route-evidence-browser` | Pass on final `dist`: valid and off-network failure paths; partial/unavailable; additive segment drill-down; no score; no route in URL/storage; English/Chinese; Escape focus return; desktop/mobile no overflow; 0 console/page errors. All network fixtures are labelled synthetic browser interception only. |
| Latest `npm run verify:bundle` | Pass with all existing ceilings unchanged. Route UI 23,985/8,245; runtime 2,672/1,183; M4 independent chunk 36,090/12,879; Home Compare 53,386/17,949; non-VRE dist 3,990,906/4,000,000. |
| Targeted ESLint / stylelint / syntax checks | Pass on all M4 source, scripts and tests; `git diff --check` pass. |
| `npm run validate` | Pass after the final source changes: the complete standard test chain, production manifest build and original bundle policy all passed. |
| `npm run test:home-compare-browser` | Pass on the final cumulative `dist`: forecast not-promoted/unavailable, commute unavailable, sources partial/unavailable, share weights/dimensions only, English/Chinese, mobile no overflow and 0 console/page errors. |
| Final upstream recheck | M1 1,495/49/9,940,613,544; M2 4,171/70/1,546,732,384; M3 812/1,186/41,189,590, with initial root/latest mtimes and all six identities unchanged. |
| Final privacy/package/process checks | 0 exact public-route coordinate token hits across 15 production/record files; ordinary task logs had no coordinate/address/generalized-location/source-record tokens; package-lock unchanged; ports and task-owned Node processes clear. |

## Open risks and remaining work

- City API can drift or exceed record limits; City geometry is reference-use only and its one-way,
  pedestrian, accessibility and route-legality semantics are not admitted.
- HIN is partial historical planning evidence. Raw crash and accessibility remain unavailable rather
  than zero; no cross-dimension score or route winner exists.
- The official/public-landmark smoke proves only this bounded chain. Remote CI, deployment, user
  research, citywide external validity and M5 remain explicitly unrun/outside this task.
