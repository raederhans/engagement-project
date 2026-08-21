# Context

## Current truth

- 2026-08-21 M4 开始 worktree 为
  `C:/Users/raede/.codex/worktrees/f76a/engagement_project`，detached、clean，exact
  `HEAD=b78ee20816d1f14703aa8670ca24e8ae0ff3e010`；starting candidate 与 HEAD 完全相同，
  base ancestry check exit 0。本任务只拥有 `f76a`。
- `b78ee208` 累积 M0-M3 local commits，但不是 main、push、remote CI、runtime deployment
  或 citywide validity。M2 仍为 historical available / forecast unavailable / not-promoted；
  M3 官方 sources 均仅 partial，road/transit routing authority unavailable。
- M4 implementation commit is
  `e9db82eaf5f47e8bb49f1d83acf377a7981218ee`, directly descended from the exact
  starting candidate. It is a detached local candidate only; no main/ref/remote/deploy state was changed.
- Initial M1 upstream inventory：1,495 files / 49 dirs / 9,940,613,544 bytes；root mtime
  `2026-08-21T07:01:26.7070453Z`，latest file mtime
  `2026-08-21T07:01:26.7038367Z`。Warehouse manifest identity
  `sha256:152c994ee721dfd9803c07bd36f6439abd5274e11ad1323c76879cade93ceb40`；
  backfill checkpoint identity
  `sha256:3c3d0a75d7426900b3243dff4a9c36772d58ca2d10d1b3840303d8e94ff1d687`。
  既有 verified contract 为 21/21 scopes、3,583,548 canonical active rows、64 partitions、
  `[2006-01-01, 2026-08-22)`、`serving_eligible:false`；initial inventory 阶段未读取事件行，
  后续由 task-owned streaming builder 完整读取 64 个 partitions，未把事件行写入日志或报告。
- Initial M2 upstream inventory：4,171 files / 70 dirs / 1,546,732,384 bytes；root mtime
  `2026-08-21T07:51:45.1522225Z`，latest file mtime
  `2026-08-21T07:53:40.8278193Z`。Mart manifest
  `sha256:5ce31c209a15180a65d85d53c0be6b4aecf983adb0a59f7db7b452159c49fca8`；
  evaluation manifest
  `sha256:2a5bf92c735550c90ec67e46df07919900854a13ce43e161c84ce24072206fd2`；
  serving artifact
  `sha256:2defb1b00cd7b5c7836b7d38234a721db65efa87eb5703316ab891cce8ce21a6`。
- Initial M3 read-only aggregate root inventory：812 files / 1,186 dirs / 41,189,590 bytes；
  root mtime `2026-08-21T12:16:22.2200335Z`，latest file mtime
  `2026-08-21T12:19:09.8192710Z`；official smoke manifest identity
  `sha256:31208a21aaee02c8d0d67f9fb1445d06c9943a82808c359761a1bd052a7cca06`。
- Initial inventory only read filesystem metadata and small identity manifests. No M1 event rows,
  coordinates, generalized location, address, dc_key/source ID or private M3 input were copied.
- Official City Street Centerline catalog links service item
  `c36d828494cd44b5bd8b038be696c839`, FeatureServer layer 0, City license, public/free use,
  reference-only/non-engineering-accuracy disclaimer. 2026-08-21 bounded observation found
  41,271 features, `esriGeometryPolyline`, maxRecordCount 2,000, Query-only capability,
  data/schema edit time `2026-07-29T13:55:32.074Z`, and fields `seg_id`, `fnode_`, `tnode_`,
  `oneway`, `class`, `streetlabe`, `update_`.
- The official layer exposes no coded domain for `oneway` and no sidewalk, curb-ramp,
  wheelchair or pedestrian-access fields. M4 therefore limits it to mode-neutral centerline
  map-match/corridor identity; routing legality and accessibility remain unavailable.
- Public non-private Center City bbox `[-75.171,39.946,-75.145,39.957]` returned 822 features;
  a five-feature GeoJSON smoke confirmed LineString geometry and selected field shape. This is
  connectivity-path evidence only, not citywide completeness or map-match validity.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-21 | Exact HEAD equals authorized cumulative M3 candidate and worktree is clean/detached. | M4 can proceed locally without integration or ref changes. |
| 2026-08-21 | City Street Centerline is official, version-observable and includes node/edge geometry, but has a reference-only accuracy disclaimer and undocumented one-way vocabulary. | Use for centerline matching only; do not claim transport routing authority. |
| 2026-08-21 | No reviewed citywide sidewalk/curb-ramp/wheelchair source is admitted. | Accessibility card is explicit unavailable; no proxy or zero value. |
| 2026-08-21 | Existing City HIN 2025 snapshot is versioned/reviewed and derived from 2019-2023 crash data. | Reuse as partial historical planning evidence; raw crash remains separately unavailable. |
| 2026-08-21 | City API bbox query necessarily reveals a route-derived area. | Require explicit pre-send disclosure/consent; send bbox and fixed fields only, never route polyline/address/destination. |
| 2026-08-21 | A distance-only candidate test falsely classified ordinary cross streets as ambiguity in all four first public-route trials. Direction-aware deterministic cost retained the parallel-edge ambiguity gate and admitted one public landmark route. | Current map match uses distance plus local tangent agreement, then enforces the same off-network, near-tie ambiguity and node-connectivity fail-closed gates. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Long data/build/browser/validate lanes | `/root` current Codex task; one lane at a time | Task-owned ignored `.dfev1/known-route-evidence-v1/logs/` | Complete; no lane, browser server, or task-owned Node process remains active. |
| `npm ci` dependency restore | `/root` current Codex task, exclusive | `.dfev1/known-route-evidence-v1/logs/npm-ci.log`; cache `.dfev1/known-route-evidence-v1/cache/npm` | Complete: 395 packages, 0 audit vulnerabilities. No global install; package and lockfile unchanged. |
| Production manifest build | `/root` current Codex task, exclusive after dependency restore | `.dfev1/known-route-evidence-v1/logs/build-manifest.log`; output `dist/` | Registered before launch. No port; stop with Ctrl-C; rerun is output replacement by the same owner; inspect manifest/chunk sizes before bundle admission. |
| Bounded official route/HIN smoke | `/root` current Codex task, exclusive | `.dfev1/known-route-evidence-v1/logs/official-smoke.log`; public input `.dfev1/known-route-evidence-v1/inputs/public-route.json`; output `.dfev1/known-route-evidence-v1/official-smoke/report.json` | Registered before launch. No port; sequential City centerline and HIN reads; Ctrl-C stops; exact public route remains ignored and report/log omit geometry, endpoints, edge IDs and HIN rows. |
| Full M1 public-route corridor aggregate | `/root` current Codex task, exclusive; upstream M1 strictly read-only | `.dfev1/known-route-evidence-v1/logs/full-warehouse.log`; checkpoint/output `.dfev1/known-route-evidence-v1/full-warehouse/` | Registered before launch after exact M1 identity recheck. No port; one sequential streaming reader; Ctrl-C stops safely after/within a partition, rerun resumes only from a validated completed-partition checkpoint; logs contain aggregate counts only; cleanup is limited to task-owned ignored output if explicitly needed. |
| Final-dist M4 browser | `/root` current Codex task, exclusive | Port `4194`; log `.dfev1/known-route-evidence-v1/logs/browser.log`; no screenshot/video; Playwright temp owned by process | Registered before launch. Synthetic responses exist only in browser interception and are explicitly labelled; production `dist/` is served read-only. `finally` closes context/browser/server; Ctrl-C fallback requires checking and stopping only the task-owned port/process before rerun. |
| Final-dist M3 regression browser | `/root` current Codex task, exclusive after M4 browser | Port `4189`; existing Home Compare browser output remains task-local/ignored | Registered before launch. Confirms M2 forecast-unavailable, M3 partial/privacy/share-state and lazy boundary still work in the cumulative build. `finally` closes browser/server; cleanup is limited to the task-owned process on port 4189. |
| Full standard `npm run validate` | `/root` current Codex task, exclusive after all browser servers close | `.dfev1/known-route-evidence-v1/logs/validate.log`; build output `dist/` | Registered before launch. No port; sequential project-standard tests, production manifest build and original bundle gate. Stop with Ctrl-C; resume by rerunning the full command because individual test output is not an admission checkpoint. |

## Handoff

- This is the only active `known-route-evidence-v1` record. Do not rewrite completed DFEV1/M3
  task history.
- Preserve the strict-read-only upstream paths and re-check their inventories/mtimes/identities
  before any full warehouse build and at final closeout.
- Current implementation decision is a separate Known Route lazy boundary plus build-time
  generalized-event aggregator. Do not import M4 into Home Compare chunks or Source Health catalog
  unless budget evidence changes.
- Closeout recheck reproduced all initial M1/M2/M3 inventories, mtimes and six manifest/checkpoint
  identities exactly. Ports 4173/4178/4189/4194 and task-owned Node processes were clear.

## Next step

Hand the detached cumulative candidate to the integration owner. Integration, remote CI, deployment,
user research, citywide validity and M5 remain separate gates.
