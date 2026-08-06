# S3-C1 plan: route-corridor historical incidents

## Goal

Create an honest, integration-ready foundation that can answer only: which
available, reported incidents have a locatable reported point within an explicit
buffer around an explicitly supplied historical route during a selected historic
time range.

## Scope

- Accept only explicit, known `LineString` route polylines from a user-provided,
  manually drawn, or imported route.  Raw GPS matching is deliberately excluded.
- Validate a bounded metre buffer and a half-open historic date range.
- Associate already-fetched incident point features with the corridor, preserve
  source/coverage/unmapped evidence, and distinguish failure states.
- Provide a pure, non-network capability module and deterministic Node contracts.

## Non-goals

- No routing provider, geocoding, GPS/map matching, route persistence, account
  sync, background location, sharing, map UI, map animation, safety score, or
  recommendation.
- No direct network query and no changes to the canonical Crime query, URL,
  saved-analysis, refresh coordinator, Entry, Crime, or CSS surfaces.

## Admission / ownership boundary

`src/routes_crime/route_corridor_capability.js` receives a validated route and
already-loaded incident GeoJSON.  A future lazy UI adapter must obtain a
coordinator-owned envelope through the main-owned Crime refresh/data coordinator:
`requestStatus: current`, `sourceStatus: ready`, `incidentScope:
{ kind: 'route-corridor', complete: true }`, strict temporal coverage, and a
known non-negative `unmappedIncidentCount`.  Only that envelope may yield a
ready or no-mapped result.  This module must never fetch, persist, request
geolocation, mutate canonical Crime state, or reinterpret a viewport/Point-A
subset as route-corridor evidence.

## Phases and acceptance criteria

1. [x] Audit existing route, Crime, coverage, ownership, bundle, and test facts.
2. [x] Establish RED contracts for valid known polylines, raw-GPS rejection,
   corridor boundary/end-cap matching, coverage/missing states, deduplication,
   and superseded/source failure.
3. [x] Implement the smallest pure capability satisfying those contracts.
4. [x] Run focused test, relevant existing contracts, build/bundle policy, and
   independent review.
5. [x] Leave a ready-for-integration handoff; do not integrate UI work.

## Risks / explicit limits

- Incident points can be generalized, approximate, missing, or duplicated.  A
  corridor match means only the reported point is within the chosen buffer, not
  that an event occurred on the route.
- Coverage unavailable or partially outside the selected period is never a
  zero-result claim.  The model keeps reported source, available interval, and
  unmapped count separate from matches.
- Buffer geometry uses a dependency-free spherical great-circle distance to each
  supplied line segment and includes round end caps by comparing with
  `<= bufferM + 0.01m`.  Routes are capped at 512 vertices and incident inputs at
  2,000 features to bound synchronous work.  This analytic approximation is
  unsuitable for legal boundaries or precision claims beyond supplied route /
  incident-coordinate quality; a future high-volume flow needs a worker or
  indexed spatial query.
- The repository's 5173 listener is user-owned and out of scope.  A build or
  bundle check is single-owner and has no port.
