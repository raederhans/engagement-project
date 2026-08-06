# S3-C2 context and decisions

## Repository facts

- Worktree: `C:/Users/raede/.codex/worktrees/9188/engagement_project`.
- Branch: `codex/s3-c2-route-corridor-data`, based on `cf191aaf`.
- S3-C1 was committed as `751b5ef`; its expanded focused suite now passes
  12/12.
- The primary worktree contains user-owned S3-I1/I2 WIP. This worktree does not
  depend on those unstaged changes and must not modify the primary worktree.
- The only planned red-overlap file is `src/routes_crime/index.js`, where this
  branch adds a small lazy data-capability method. It must not copy task-focus,
  preset, panel, main, HTML, CSS, or I1/I2 presentation logic.
- `src/utils/match.js` still has no GPS map-matching implementation. Diary data
  remains demo/local/sample content and is not a production Crime source.
- `CARTO_SQL_BASE` already points to Philadelphia's CARTO SQL API, and the
  source table exposes unique `cartodb_id`, EPSG:4326 `the_geom`, EPSG:3857
  `the_geom_webmercator`, reported time, offense, district, and location block.

## Data-admission decision

CARTO v2 exposes ordinary SQL requests but no source snapshot cursor suitable
for consistent client pagination. S3-C2 therefore uses one POST and one SQL
statement with CTEs. PostgreSQL gives one command a consistent snapshot at the
default READ COMMITTED level. The response contains:

- complete candidate count before the hard limit;
- up to 2,001 rows in stable `cartodb_id` order, proving whether the 2,000-row
  client association limit was exceeded;
- global available coverage dates;
- sorted observed source coverage months, so an omitted month cannot be inferred
  from a broad minimum/maximum interval;
- source-wide unmapped count for the selected historic period and filter;
- candidate features with reported point, time, offense, district, and block.

Candidate count above 2,000, a count/row mismatch, duplicate identity, invalid
point/time, or missing coverage produces a fail-closed unavailable/failure
state. `unavailable` is never rewritten as zero incidents.

The public source probe on the final SQL returned 46/46 candidates without
truncation, 248 observed months including the selected `2025-06`, coverage
`2006-01-01` through `2026-08-04`, and 286 selected-time/filter citywide
unmapped records. Candidate points were not printed.

## Privacy decision: scheme B

- Imported GeoJSON is read with the browser `File` API only after a caller has
  the user-selected file. Manual coordinates are accepted directly.
- No geolocation API is used. Manual/imported known routes remain available.
- Exact GeoJSON, vertices, exact buffer, fingerprint, candidates, and local
  matches stay in runtime memory. This capability does not write URL/hash,
  history, local/session storage, IndexedDB, cookies, Cache API, service worker,
  saved analysis, logs, or telemetry.
- The provider receives a coarse outward-snapped bounding box, selected dates,
  and offense filters only. This still discloses a coarse area to CARTO and is
  not a zero-location-disclosure design.
- The API layer deliberately does not use the repository SQL query logger,
  caching, retries, or request deduplication for this route-derived request.
- A separate fixed police-district boundary request carries no route-derived
  parameters. Exact geometry is used only after that boundary is in browser
  memory to prove local spatial coverage.

## Geometry decision

- Route input coordinates follow RFC 7946 longitude/latitude order.
- Web Mercator is limited to latitude ±85.05112878 degrees.
- The candidate envelope adaptively subdivides each great-circle segment until
  projected midpoint deviation is at most 0.25 m, applies the explicit
  Web-Mercator/spherical-radius ratio and latitude scale, then snaps every edge
  outward to a 2,000-metre grid. This is only a candidate superset, not the
  exact corridor. Routes whose projected coarse envelope exceeds 100 km in
  either dimension fail closed before a provider request.
- A zero-result claim additionally requires the entire route plus requested
  buffer and a 500 m conservative margin to remain inside one official police
  district polygon. Crossing an internal district boundary or approaching any
  polygon edge is intentionally `coverage-unavailable`, even when both sides
  are within Philadelphia. This smaller admission region is a conservative
  proof, not a claim that the source stops at district boundaries.
- Exact association remains the C1 spherical point-to-LineString calculation,
  including round endpoint behaviour and an inclusive boundary tolerance.
- Coverage reuses canonical Crime metadata: results are reported source rows,
  not guaranteed unique incidents, and locations are generalized to the
  hundred block by the source. Source-wide unmapped records remain separate.

The first spatial implementation attempted Turf union/buffer/difference and
measured about 356 kB raw. It was rejected: the required truth claim only needs
a conservative local containment proof. The dependency-free single-district
interior method is smaller, easier to audit, and safely rejects more routes.

## Main-feature relationship

The C2 coordinator captures `readCrimeSnapshot(store)` only at explicit request
time. It passes the canonical start/end/types/drilldown filters into its own
abortable route request owner; it does not mutate the store, URL, saved-analysis
schema, or main refresh coordinator. It reads the canonical snapshot again
before returning and converts any result whose dates/offense filters changed in
flight to `superseded`. Any replacement request, including an invalid route,
also aborts the prior generation. Stage 6 can call this lazy method and feed its
truthful states into a synchronized text list/map presentation, while the
existing Crime coordinator remains the sole owner of canonical query changes.

## Live validation ownership

- Owner: root agent in this worktree only.
- Commands: review `npm run build:manifest`, later the final `npm run validate`,
  both from this worktree and never concurrently.
- Shared resources: only this worktree's `dist/`; no port, database, browser,
  dev server, external Vite listener, or cross-worktree cache is used.
- Logs: task-owned `.runtime/s3-c2-*-build-manifest.log` evidence during repair
  and `.runtime/s3-c2-final-validate.log` for the final gate; all are removed
  before commit after their evidence is recorded here.
- Success: command exit code 0 and expected manifest/bundle evidence. Failure:
  preserve the exact log, diagnose before retrying, and stop after three equal
  failures under the same assumption. No non-owner may start, poll, retry, or
  interpret these commands while this record assigns ownership here.

The final `npm run validate` exited 0. A subsequent production-source change
only removed one trailing blank line; the exact committed HEAD was then rebuilt
and its bundle policy measured Entry 889451/239906, Crime 37995/13404, route
corridor data 22908/7531, and total dist 3448718 bytes. The route-only ceiling
is 23500/7800 and no pre-existing ceiling changed. Independent architecture
review returned `CLEAR`; independent code review returned `APPROVE` with no
critical, high, or medium finding. The task-owned `.runtime` and query-log
artifacts were removed after recording these results.
