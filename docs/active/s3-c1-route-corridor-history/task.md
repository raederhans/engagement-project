# S3-C1 task status

## Current state

Ready for integration: the final fail-closed foundation, independent review,
and project validation are complete.  It remains deliberately unintegrated from
the shared Crime UI/data coordinator. This record is independent from
`ui-role-experience-audit` and does not change S3-I1/S3-I2 status.

## Checklist

- [x] Read applicable agent guidance, package scripts, route/Crime/data/geometry
  ownership, bundle policy, and relevant archived Crime task records.
- [x] Establish that GPS matching and Diary My Routes are explicitly unimplemented.
- [x] Write and observe focused RED contracts (`ERR_MODULE_NOT_FOUND` before
  capability implementation).
- [x] Implement and observe GREEN (first 5/5 focused contracts; review-repair
  suite is 8/8).
- [x] Run focused and related regression checks (new 5/5, Crime async 22/22,
  Crime safety foundation 9/9, then full `npm test` exit 0).
- [x] Re-run single-owner `npm run validate` after review repair: `EXITCODE:0`;
  Entry 899147/241925, Crime 37604/13221, total dist 3420877.
- [x] Independent re-review: architect `CLEAR`; code reviewer `APPROVE`, no
  HIGH/CRITICAL findings after the deterministic duplicate tie-breaker repair.
- [x] Ready-for-integration: no commit made; exact integration boundary below.

## Required integration contract

Future S3-I1/I2 UI code may dynamically import the capability only after an
explicit user action.  It may pass `routeInput`, `bufferM`, `selectedRange`,
`coverage` (`availableEndExclusive`), `incidentScope`, `sourceStatus`,
`requestStatus`, and coordinator-owned incident features.  It must map existing
refresh outcomes at its current owner: only `current + ready` may calculate;
`pending/loading` stays pending, `partial` stays coverage-unavailable,
`failed/invalid` stays source-failure, and aborted/superseded work stays
superseded. It must not make this module an alternate source, URL owner, refresh
owner, storage owner, or location-permission trigger.

## Delivered capability and deliberate gaps

- Delivered: known-polyline admission (`user-provided`, `manual-draw`,
  `imported-route`); raw-GPS rejection; 10–10,000 integral-metre corridor;
  spherical segment/end-cap point association; stable-ID-only deduplication;
  separate unmapped points; source/coverage interval/unmapped-count evidence;
  `route-required`, `route-invalid`, `coverage-unavailable`, `source-failure`,
  `superseded`, `no-mapped-incidents`, and `ready` states.
- Not delivered: an actual route provider, raw GPS matching, location permission,
  persistence/account sync, a UI/map/list, canonical Crime query integration,
  localization, responsive CSS, or a production lazy emitted chunk.  A future
  UI must create the dynamically imported boundary and add keyboard/text-list
  rendering; it must not present this foundation alone as a user-facing feature.

## Integration handoff

S3-I1/I2 must keep their current shared-file ownership and add no shortcut fetch.
The main-owned coordinator must produce an in-memory corridor envelope for the
same request: `requestStatus: 'current'`, `sourceStatus: 'ready'`, a nonnegative
generation, canonical filter key, `availableStart` / `availableEndExclusive`, a
known nonnegative `unmappedIncidentCount`, complete route-corridor Feature data,
and `incidentScope` with the matching `createRouteCorridorQueryFingerprint()`.
Any missing, partial, stale, mismatched, or malformed evidence is intentionally
not a zero-result.  Default corridor analysis is ephemeral: do not write route
data to URL, saved analysis, storage, sharing, or background location systems.
If those product decisions change, extend the canonical schemas in a dedicated
privacy/data review.  Reuse the existing incident-results presenter for keyboard
and text-list rendering, and establish a separate dynamic chunk/bundle budget
before importing this module from production code.
