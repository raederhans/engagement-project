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

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Full PBF download/extraction | Unallocated | None | Closed in first wave. |
| Shared build/browser/Worker/performance validation | Integration owner only | None | Not started. |
| External source observation | RD-A only, bounded HEAD/sidecar request | Per-thread output only | Allowed; no payload persistence. |

## Handoff

Every writer must start from the exact committed coordination baseline, report
HEAD/status before writing, modify only its owned new paths, and return an exact
uncommitted or committed-in-worktree freeze without touching refs/index/package/
catalog/runtime/public/CI/shared outputs. RD-R reviews exact bytes and performs no
writes. Only the primary integration owner may form source-final commits,
integrate, run shared gates, push, or change publication state.

## Next step

Commit this coordination record, create RD-A/B/C/D and RD-R worktree tasks from
the exact branch, record returned thread/worktree identities, and wait for each
preflight/freeze without opening full acquisition or publication gates.
