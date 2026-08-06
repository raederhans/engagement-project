# S3-C2 route-corridor data admission plan

## Goal

Deliver the first five stages of the route-corridor capability using privacy
scheme B: an explicit known route remains exact and ephemeral in the browser;
only a deliberately coarse bounding box is sent to the existing historical
Crime source; complete candidates are then associated with the exact route
locally.

This remains an evidence-informed capability hypothesis. It must only answer
which available reported incidents were located near the chosen route within
the selected historic period. It does not describe incidents as occurring on
the route, current or future danger, a safer route, advice, or a score.

## Stages in this delivery

1. Stabilize and commit the reviewed S3-C1 pure capability foundation.
2. Add a one-request, one-statement historical candidate-envelope admission
   path with explicit coverage dates/months, source-wide unmapped count,
   completeness, and truncation evidence.
3. Add explicit imported/manual known-LineString inputs; keep raw GPS matching
   rejected because the repository has no reliable matching contract.
4. Apply privacy scheme B: exact geometry, buffer, and results stay in runtime
   memory; only an outward-snapped coarse EPSG:3857 envelope is disclosed.
5. Add a lazy adapter owned by the Crime controller which captures the existing
   canonical Crime snapshot and preserves its refresh/data ownership.

## Non-goals

- No route UI, map drawing UI, result presentation, CSS, localization, or
  responsive layout work. Those are stage 6 and remain with S3-I1/I2.
- No GPS/geolocation request, map matching, route provider, Diary reuse,
  persistence, URL state, saved analysis, sharing, account sync, or telemetry.
- No dependency, bundle-limit increase, merge, push, deployment, main-worktree
  edit, or interference with the user-owned Vite listener on port 5173.

## Admission and stop conditions

- The source query must be one CARTO POST containing one PostgreSQL statement,
  so candidate rows, counts, coverage, and unmapped evidence share one command
  snapshot. Multi-request pagination is not admitted.
- Candidate completeness is capped at 2,000. Any truncation, count mismatch,
  duplicate identity, malformed geometry, missing coverage, or stale request
  fails closed and cannot become a zero-result claim.
- The coarse envelope must contain the buffered exact route, be snapped outward
  to a fixed grid, and remain within a bounded span. The request layer must
  never receive or serialize exact route vertices.
- A zero result additionally requires a local, conservative proof that the
  exact route corridor remains inside a known Philadelphia boundary interior;
  boundary uncertainty or source failure is coverage-unavailable.
- The production adapter must remain lazy and have a measured independent chunk
  budget while existing Entry, Crime, CSS, and total-dist limits remain fixed.
- Completion requires focused RED/GREEN evidence, standard validation, bundle
  evidence, independent review, first-principles review, and a Lore commit.

## External contracts used

- CARTO SQL API calls and geospatial data:
  https://cartodb.github.io/developers/sql-api/guides/making-calls/
  https://cartodb.github.io/developers/sql-api/guides/handling-geospatial-data/
- PostgreSQL statement snapshot and JSON aggregation:
  https://www.postgresql.org/docs/17/transaction-iso.html
  https://www.postgresql.org/docs/current/functions-json.html
- PostGIS envelope and GeoJSON conversion:
  https://postgis.net/docs/manual-3.7/en/ST_MakeEnvelope.html
  https://postgis.net/docs/manual-3.3/ST_AsGeoJSON.html
- GeoJSON coordinate contract: https://www.rfc-editor.org/rfc/rfc7946
- Browser file/privacy boundaries:
  https://www.w3.org/TR/FileAPI/
  https://www.w3.org/TR/geolocation/#privacy-for-recipients
