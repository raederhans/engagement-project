# Route-decision S6 real-data integration context

## Current truth

- Canonical starting revision is
  `main@f300cfe2658375add6542b86c20267c63c56ec4a`; local and remote were equal
  before creating `codex/route-decision-s6-real-data`.
- S6-A/B/C/D are complete only for their bounded synthetic/tooling contracts.
  The current compact compiler writes synthetic provenance and the S6 runtime is
  a same-realm reference seam.
- S5-D deliberately has no trusted authority root and cannot mint actual
  admission, product materialization, Source Health update, redistribution,
  public-access, or publication records.
- Existing candidate contracts already distinguish OSM/city/synthetic sources,
  licence/attribution, four clocks, coverage, content identities, normalization,
  audit, semantic diff, and candidate-only receipts. They do not establish
  historical order, reviewer identity, source authenticity, or product/public
  eligibility.
- Geofabrik currently offers a dated Pennsylvania PBF suitable as an offline
  candidate. The observed `260813` file is approximately 344 MB and there is no
  Philadelphia city-level Geofabrik PBF.
- The repository has no direct admitted OSM PBF parser and the local environment
  has no `osmium` or `ogr2ogr`. The transitive `pbf` dependency belongs to other
  packages and is not an authorized OSM parser surface.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-14 | Treat the completed S6 as immutable synthetic evidence and start a new real-data follow-on. | Prevents schema/claim relabelling and preserves prior review truth. |
| 2026-08-14 | Prefer a dated Geofabrik Pennsylvania PBF over `latest`, public Overpass, OSM API bbox scans, or tile scraping. | Makes candidate acquisition bounded and reproducible without depending on shared public runtime services. |
| 2026-08-14 | Treat a public pedestrian graph as an ODbL Derivative Database for release planning. | Requires visible attribution, distinct data licence metadata, and a machine-readable graph or complete rebuild method before publication. |
| 2026-08-14 | Do not acquire the full 344 MB PBF or install extraction tooling in the first parallel wave. | First freezes source manifest, OSM semantics, authority, and compact contracts; a later owner-controlled wave decides tool and payload acquisition. |
| 2026-08-14 | Use module-private installed authority rather than caller JSON, while keeping the default registry empty. | Allows code/spec work without fabricating an actual trusted admission before exact source and review evidence exist. |
| 2026-08-14 | Keep package scripts, public barrels, Source Health catalog, runtime, CI, Git state, and release assets integration-owner-only. | Avoids red-path conflicts and prevents worker tasks from publishing or promoting data. |
| 2026-08-14 | Commit the common research/ownership baseline before dispatch. | Commit `20b2be1` gives every task the same exact plan, evidence boundary, and owned paths. |
| 2026-08-14 | Record queued clients separately from resolved thread identities. | Five detached worktrees exist at `20b2be1`, but the App has returned only client IDs so writer preflight and task-to-path mapping are not yet claimed. |
| 2026-08-14 | Reconcile actual writer bytes instead of queued-client records. | RD-A resolved to `4342` and has seven untracked owned files with fresh `11/11`; RD-B resolved to `502c` and has six untracked owned files with fresh `19/19`. Both remain detached exact `20b2be1`, uncommitted, and independently unreviewed. RD-R resolved to clean read-only `53d1`; `3e2f` and `c219` remain clean/unassigned and do not prove C/D implementation. |
| 2026-08-14 | User authorizes the first three remaining priorities under primary supervision. | Open coordination for A/B/C/D closure, exact tool/boundary selection, one private full-PBF download/extraction/build, and actual graph admission/real compact compilation. Runtime/UI, formal performance, pilot, public release, deployment, credentials, and claim expansion remain closed. |
| 2026-08-14 | Add one single-owner RD-E build lane and a read-only RD-Q cross-lane gate. | RD-E owns only new build code/test/fixture paths plus the private live output/log locations; it cannot start a live acquisition until the supervisor records and releases the exact reviewed command. RD-Q owns no writes and cannot approve moving bytes or rubric-only state. |
| 2026-08-14 | Recover stopped writer/reviewer tasks in place after an App crash and recreate only the missing RD-D task. | A/B/C/E/Q retain their existing worktrees and bytes; RD-D now runs in `6844@45ca4c7`. Clean `b5f8@45ca4c7` is an unassigned crash orphan and is preserved, not treated as implementation evidence. |
| 2026-08-14 | Treat the first A/B exact-freeze review as a rejection, despite green focused tests. | RD-A must bound arrays before expansion and enforce descriptors; RD-B must repair hostile ingress, clipping geometry, complete result identity, and rounded geometry. Both need new freezes and fresh review. |
| 2026-08-14 | Reject every A/B/C/D/E freeze after fresh exact-byte and dual-lane review. | Green focused tests did not cover resource-order, semantic recomputation, caller-current, cross-lane bridge, live-release path, or acquisition lifecycle blockers. No bytes advance to source-final or integration. |
| 2026-08-14 | Keep the future OPL bridge/controller lane closed until B and E expose accepted stable interfaces. | Avoids creating a placeholder adapter against moving schemas. D must stop inventing costs; E must split acquisition/receipt/extraction authority before a separate bounded OPL-to-B/build-evidence lane is dispatched. |
| 2026-08-14 | Accept and integrate RD-B independently while the other real-data lanes remain blocked or under review. | Exact manifest `750e8dc8...c22dcd` passed code/security and architecture review, became source-final `c7388ea`, and integrated as `110007c`; this establishes only a candidate OSM walking adapter and does not open extraction, authority, GraphArtifact, runtime, or product claims. |
| 2026-08-14 | Discard the stale RD-D architecture verdict after per-file review-object drift, then accept only the manifest seen by both independent lanes. | The reconciled seven files passed `APPROVE/CLEAR`, became source-final `8fb9be2`, and integrated as `86c54ca`; production RD-B/RD-C dependencies remain unavailable and the accepted surface proves only one allowlisted synthetic mechanics fixture. |
| 2026-08-14 | Accept RD-A only after transport truth and null-projection blockers close on a fresh exact freeze. | Manifest `df4d01ea...a5bdf1` passed `APPROVE/CLEAR`, became source-final `410a029`, and integrated as `50fee85`; it establishes bounded candidate acquisition observation only and does not download PBF or establish source authority/current. |
| 2026-08-14 | Accept RD-E only after both Windows path-boundary repairs close on the same exact bytes. | Manifest `ee0411a...f0c6` passed `APPROVE/CLEAR`, became source-final `1eb128d`, and integrated as `0f4d6e1`; it freezes non-executable acquisition/receipt/extraction records and keeps controller, commands, tool execution, PBF and actual build unavailable. |
| 2026-08-14 | Dispatch RD-F only after accepted RD-B/RD-E interfaces exist. | Thread `019fffdb-aaf8-7093-ad14-8537d4e06f1f` starts clean detached at `0f4d6e1` in `8a3c` and owns only new offline OPL bridge/build-evidence paths. This does not release a live process or permit a hidden parser/controller. |
| 2026-08-14 | Accept RD-C only after the deep-import, label/readiness and pre-materialization budget blockers close on the same exact ten files. | Aggregate `b13b95aa...0ae2` passed `APPROVE/CLEAR`, became source-final `06b7bee`, and integrated as `6075b4e`; combined focused `242/242` passes. The installed registry remains empty, so actual authority, Source Health current and product/runtime/publication claims remain unavailable. |
| 2026-08-14 | Reject RD-F's first exact freeze, then accept only the repaired bytes seen by both fresh review lanes. | The first aggregate `e2d6c673...8e7` left two P1 identity/byte closures and one P2 hostile-options boundary open. Repaired aggregate `7f9ac429...92fa5` passed `APPROVE/CLEAR`, became source-final `110ef1e`, and integrated as `490e364`; it remains synthetic-mechanics/unavailable/non-capability only. |
| 2026-08-14 | Treat the Windows CRLF checkout failure as an integration invariant, not a parser relaxation. | Commit `696eedf` forces the one reviewed `.opl` fixture to LF. The first central run was honestly `242/243`; after the attribute repair A/B/C/D/E/F passed `257/257`, and the reviewed eleven Git blobs remained exact. |
| 2026-08-14 | Dispatch RD-G as a separate source-only controller/tool-admission gate from exact baseline `da7b270`. | Worktree `rdg1` owns only new controller library/test/fixture paths. Its review must keep every positive registry and live primitive closed while proving fail-closed nonce/replay/crash/deadline, Windows path/reparse, exact argv and closed-file promotion contracts. |
| 2026-08-15 | Accept only RD-G v7 after repeated lifecycle, clock, replay and store-lineage repairs, then integrate its exact source-only bytes. | Aggregate `1ff1187b...96d63f` over 16 files / 220,665 bytes passed independent `APPROVE/CLEAR`, became source-final `5c52de5`, and integrated as `1bd91c9`. Central RD-A-G adjacent `328/328` and full `npm run validate` pass. This closes RD-6A source contracts, not a native controller, positive tool install, live PBF, authority, current, runtime or publication gate. |
| 2026-08-15 | Make LF checkout identity an explicit RD-G integration invariant. | The reviewed Git blobs are LF. Path-scoped `.gitattributes` entries prevent Windows checkout-only CRLF drift without weakening any parser or admission rule. |
| 2026-08-15 | Push the reviewed source-only integration on a new remote branch without changing main. | `origin/codex/route-decision-s6-real-data` was absent before a normal non-force push; `origin/main` remained `f300cfe`. The remote branch is reviewable but is not a main merge, deployment or live-data release. |
| 2026-08-15 | Dispatch RD-6B as three disjoint lanes rather than combining source, native proof and tool observation. | All lanes start clean detached at exact `9bc56a0`. `rd6b-prototype` owns only isolated Windows capability prototype paths; `rd6b-adapter` owns only the new source-only sibling/protocol paths; `rd6b-observation` is read-only tracked-tree and the sole owner of local version/identity preflight. No lane may install/download, access network/PBF, write shared output or change authority/current/runtime/publication state. |
| 2026-08-15 | Treat the three RD-6B producer handoffs as candidates and move acceptance into four separate user-visible review tasks. | Adapter code/security=`01a00380-1d2e-7fb1-9fce-8e5e5acd8235`; adapter architecture/claims=`01a00380-4e48-7d01-b3e2-a9046e89a49a`; native prototype=`01a00380-7e75-7230-9a94-850f4dce7456`; positive observation/admission=`01a00380-b221-7c22-bdda-016d3087d077`. These tasks are read-only reviewers, not integration or release owners. |
| 2026-08-15 | Reject both first RD-6B implementation freezes and keep the tool memo observation-only. | Adapter v1 is `REQUEST CHANGES/BLOCK`: fail-closed status is sound, but command-bearing requests are caller-self-hashed, results are not bound to admitted requests/native evidence, extraction phase and capability coverage drift, and capture/deep-import boundaries are incomplete. Native prototype v1 is feasibility-only with three P1 wording/mechanics findings. Curl remains observed-candidate; osmium is bounded-not-observed; no positive admission exists. |
| 2026-08-15 | Continue through new user-visible repair tasks rather than internal producer lanes. | Adapter v2=`01a00398-5b86-7d43-a668-f24cfb4ba92a`; native prototype v2=`01a0039c-5efa-78e2-bbe1-240b59b2b599`; observation evidence v2 queued as `client-new-thread:1790b75a-227c-4b82-8ff2-5aae096f45fd`. Each has exclusive owned paths; central integration, PBF, positive registry and publication remain closed. |
| 2026-08-15 | Treat writer-v2 completion and actual acceptance as separate gates. | Adapter v2 produced an exact eight-file candidate with focused/adjacent checks green but still requires dual independent review. Native v2 produced repaired source bytes, but its live attempt failed before the relevant Win32 path and the final bytes remain unverified. Neither candidate is source-final or integrated. |
| 2026-08-15 | Supersede the unmaterialized observation client with four actual user-visible supervision tasks. | Adapter code=`01a00475-8a26-7ac1-a52c-0d04240444be`; adapter architecture=`01a00475-9d86-7302-9286-743f4c0217fe`; native final-byte probe=`01a00476-3fa2-73b3-8479-a4257a460412`; observation retry=`01a00475-ccb8-7d50-a681-62bdecf9b66f`. The former queued client is recorded as unmaterialized, not as evidence or completion. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Full PBF download/extraction and exact intermediate build | Future single owner only after RD-F, controller, tool admission and explicit supervisor release | `logs/route-real-graph-build-*.log`; private bytes under `output/route-real-graph-build-private/**` | Not released or started; no current task owns live process, network, PBF or private outputs. |
| Shared build/browser/Worker/performance validation | Integration owner only | None | Not started. |
| External source observation | RD-A only, bounded HEAD/sidecar request | Per-thread output only | Allowed; no payload persistence. |
| Isolated Windows native final-byte probe | Task `01a00476-3fa2-73b3-8479-a4257a460412` | Worktree-local `output/route-real-graph-controller-windows-native-private/**` | Unique owner of exactly one `node --test scripts/tests/route_real_graph_controller_windows_native_prototype.mjs` run from `rd6b-prototype`; zero retry and no source edits. It may report only observed feasibility. Curl/osmium/network/PBF, Job Object and production capability remain closed. |
| Local helper/curl/osmium identity/version preflight | Task `01a00475-ccb8-7d50-a681-62bdecf9b66f` | Worktree-local `output/route-real-graph-controller-windows-observation-private/evidence-v2/**` | Unique owner of bounded local discovery/version/identity commands and raw transcripts. No URL, install/download, PBF, helper build, native prototype or positive registry. |

## Handoff

Every writer must start from the exact committed coordination baseline, report
HEAD/status before writing, modify only its owned new paths, and return an exact
uncommitted or committed-in-worktree freeze without touching refs/index/package/
catalog/runtime/public/CI/shared outputs. RD-R reviews exact bytes and performs no
writes. Only the primary integration owner may form source-final commits,
integrate, run shared gates, push, or change publication state.

Current supervised task mapping:

- RD-A: thread `019ffebb-64d2-7143-a2e6-b88a62a58abb`, worktree `4342`,
  clean detached source-final `410a029`; exact seven-file bytes integrated as
  `50fee85` after `APPROVE/CLEAR`. Combined A+B+D focused `63/63`, syntax,
  ESLint, fixture and blob identities pass; no PBF or source authority exists.
- RD-B: thread `019ffebb-73db-7f52-a02d-494e0013b1fe`, worktree `502c`,
  source-final `c7388ea`; exact eight-file bytes integrated centrally as
  `110007c` after `APPROVE/CLEAR` and central focused/static gates.
- RD-C: thread `019fff36-7a99-7332-a978-8d8f9ae23005`, worktree `00d0`,
  clean detached source-final `06b7bee`; exact ten-file bytes integrated as
  `6075b4e` after `APPROVE/CLEAR`. Source-final-to-central Git blobs `10/10`
  match and combined A/B/C/D/E focused `242/242` passes. The private installed
  registry remains empty; actual authority and Source Health current remain
  unavailable.
- RD-D: thread `019fff4d-a816-7120-a9e2-d85841dbdb6d`, worktree `6844`,
  clean detached source-final `8fb9be2`; exact seven-file bytes integrated as
  `86c54ca` after same-manifest `APPROVE/CLEAR` and central `45/45` D+B gates.
  Real compact compilation and every product/current claim remain closed.
- RD-E: thread `019fff28-6e92-7cc0-9717-de612065fd8f`, worktree `1461`,
  clean detached source-final `1eb128d`; exact twelve-file bytes integrated as
  `0f4d6e1` after `APPROVE/CLEAR`. Combined A+B+D+E focused `90/90`, syntax,
  ESLint, fixtures and twelve blob identities pass. This freezes only
  non-executable build-control records; no controller, PBF or actual build exists.
- RD-F: thread `019fffdb-aaf8-7093-ad14-8537d4e06f1f`, worktree `8a3c`,
  clean detached source-final `110ef1e`; repaired aggregate
  `7f9ac429...92fa5` passed `APPROVE/CLEAR` and integrated as `490e364`.
  Central A/B/C/D/E/F is `257/257` after LF invariant commit `696eedf`.
  The bridge remains synthetic mechanics and caller-claim-only evidence, never
  a real process observation or authority.
- RD-G: worktree `rdg1`, clean detached source-final `5c52de5`; exact v7
  aggregate `1ff1187b...96d63f` passed independent code/spec/security
  `APPROVE` and architecture/claims `CLEAR`, then integrated as `1bd91c9`.
  RD-G focused `84/84`, adjacent RD-A-G `328/328`, syntax/ESLint/fixtures and
  full repository validation pass. All native registries/capabilities and
  actual/current/runtime/publication claims remain unavailable or false.
- RD-6B prototype: task `/root/rd6b_native_prototype`, worktree
  `rd6b-prototype`, clean detached `9bc56a0`. Owned prototype source/test/
  fixture paths only. Independent task `01a00380-7e75-7230-9a94-850f4dce7456`
  reviewed v1 as `REQUEST CHANGES`, feasibility-only. V2 task
  `01a0039c-5efa-78e2-bbe1-240b59b2b599` produced exact aggregate
  `1afc39ba...c30a5`, but its live run failed before the relevant Win32 path and
  the repaired final bytes were not rerun. Task
  `01a00476-3fa2-73b3-8479-a4257a460412` is the unique no-edit final-byte probe
  owner. The result cannot establish production capability by itself.
- RD-6B source adapter: task `/root/rd6b_source_adapter`, worktree
  `rd6b-adapter`, clean detached `9bc56a0`. Owned new sibling source/test/
  fixture paths only; its eight-file candidate is complete and unintegrated.
  Independent tasks `01a00380-1d2e-7fb1-9fce-8e5e5acd8235` and
  `01a00380-4e48-7d01-b3e2-a9046e89a49a` review code/security and
  architecture/claims respectively; both rejected v1. V2 task
  `01a00398-5b86-7d43-a668-f24cfb4ba92a` produced exact aggregate
  `5b87362a...be65e` over eight files / 72,371 raw bytes with focused `18/18`
  and adjacent `84/84`. Fresh tasks `01a00475-8a26-7ac1-a52c-0d04240444be`
  and `01a00475-9d86-7302-9286-743f4c0217fe` independently review the same
  freeze; it is not source-final until both approve. No subprocess, network,
  PBF, registry installation or accepted RD-G edits are authorized.
- RD-6B positive observation: task `/root/rd6b_positive_observation`, worktree
  `rd6b-observation`, clean detached `9bc56a0`. Its bounded preflight is
  complete with tracked/index state unchanged; system curl remains an observed
  candidate and osmium is bounded-not-observed. Independent task
  `01a00380-b221-7c22-bdda-016d3087d077` accepted only the memo semantics and
  rejected positive admission. The evidence-v2 queued client never materialized;
  replacement actual task `01a00475-ccb8-7d50-a681-62bdecf9b66f` may add only
  raw private transcripts while preserving missing/unavailable/candidate/
  admitted truth.
- RD-Q: thread `019fff36-85e6-7410-a451-5d10b14a5169`, worktree `fedf`,
  detached `45ca4c7`; active read-only cross-lane gate.

`b5f8@45ca4c7` is a clean unassigned worktree left by the failed RD-D creation.
It must not be reviewed, integrated, changed, or cleaned without a separate
topology decision.

## Next step

Supervise the adapter v2 dual review, native final-byte one-run probe and local
tool observation retry as four separate user-visible tasks. If and only if both
adapter reviews approve the same exact freeze, the integration owner may form a
source-final commit with a path-scoped LF checkout invariant and run central
checks. Prototype evidence and local tool observations remain separate from
production capability and positive admission. A full-PBF live process may start
only after independently accepted native capability and positive exact-tool
admission gates, an explicit single-owner release, and a fresh live preflight;
authority installation, Source Health current, runtime and publication remain
closed.
