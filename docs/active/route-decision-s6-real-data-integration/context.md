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

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Full PBF download/extraction and exact intermediate build | Future RD-E conversation only after explicit supervisor release | `logs/route-real-graph-build-*.log`; private bytes under `output/route-real-graph-build-private/**` | Authorized in principle, not started; exact tool/command/boundary and stop criteria still pending review. |
| Shared build/browser/Worker/performance validation | Integration owner only | None | Not started. |
| External source observation | RD-A only, bounded HEAD/sidecar request | Per-thread output only | Allowed; no payload persistence. |

## Handoff

Every writer must start from the exact committed coordination baseline, report
HEAD/status before writing, modify only its owned new paths, and return an exact
uncommitted or committed-in-worktree freeze without touching refs/index/package/
catalog/runtime/public/CI/shared outputs. RD-R reviews exact bytes and performs no
writes. Only the primary integration owner may form source-final commits,
integrate, run shared gates, push, or change publication state.

Current supervised task mapping:

- RD-A: thread `019ffebb-64d2-7143-a2e6-b88a62a58abb`, worktree `4342`,
  detached `20b2be1`; active exact-review rework.
- RD-B: thread `019ffebb-73db-7f52-a02d-494e0013b1fe`, worktree `502c`,
  detached `20b2be1`; active exact-review rework.
- RD-C: thread `019fff36-7a99-7332-a978-8d8f9ae23005`, worktree `00d0`,
  detached `45ca4c7`; active authority writer preserving partial bytes.
- RD-D: thread `019fff4d-a816-7120-a9e2-d85841dbdb6d`, worktree `6844`,
  detached `45ca4c7`; recreated active real-compact writer.
- RD-E: thread `019fff28-6e92-7cc0-9717-de612065fd8f`, worktree `1461`,
  detached `45ca4c7`; active offline tool/boundary writer preserving partial bytes.
- RD-Q: thread `019fff36-85e6-7410-a451-5d10b14a5169`, worktree `fedf`,
  detached `45ca4c7`; active read-only cross-lane gate.

`b5f8@45ca4c7` is a clean unassigned worktree left by the failed RD-D creation.
It must not be reviewed, integrated, changed, or cleaned without a separate
topology decision.

## Next step

Receive new stable A/B freezes and the first C/D/E freezes, route them through
RD-Q plus lane-specific exact-byte review, then integrate only accepted units.
A full-PBF live process may start only after A/B integration, RD-E tool/boundary
review, and an explicit single-owner follow-up; publication and runtime remain
closed.
