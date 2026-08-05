# S3-C1 context

## 2026-08-05 — admission spike

- Worktree: `C:/Users/raede/.codex/worktrees/9188/engagement_project`, detached
  at `cf191aaffb0f991fe0a3fa1dabac9b2ce0da5c38`; initially clean.
- `src/utils/match.js` throws for raw GPS map matching.  `src/routes_diary/my_routes.js`
  is deferred and cannot be used as a production-route source.
- Canonical point querying is `src/api/crime.js` / `src/utils/sql.js`; its current
  spatial implementation supports only a point `ST_DWithin` buffer.  Refresh
  ownership is `src/routes_crime/crime_refresh_owner.js`.
- Crime coverage comes from `src/api/meta.js`; an unavailable coverage state must
  remain distinct from no matched incident points.
- Existing package dependency `@turf/turf` is reused only by the isolated module;
  no new dependency is proposed.  The module will not be imported by Entry or
  Crime in this branch, so the initial build has no new emitted runtime chunk.
- User-owned Vite already listens on 127.0.0.1:5173.  No server will be started,
  stopped, reused, or monitored here.

## Live-process ownership

`test:crime-async` could not start because this clean checkout has no installed
`node_modules` (`ERR_MODULE_NOT_FOUND: dayjs` from pre-existing charts code).
This task is the sole live-process owner for `npm ci --ignore-scripts` followed
by `npm run build:manifest` / `npm run verify:bundle`, all from this worktree.
Shared resources are only this checkout's ignored `node_modules/` and `dist/`;
no port, database, cache, checkpoint, or user-owned listener is used.  Output is
captured in `.runtime/s3-c1-route-corridor-build.log`; success is zero exit and
the project checks passing, while any non-zero exit will be recorded before one
evidence-led retry.  No other owner may start, poll, or stop these commands.

`npm ci --ignore-scripts` finished with exit 0: 214 locked packages installed,
215 audited, and npm reported 0 vulnerabilities.  The same owner then ran
`npm run build:manifest && npm run verify:bundle`; its log ends `EXITCODE:0`.
Vite emitted no route-corridor asset because no Entry or Crime module imports
the capability yet; bundle policy passed with Entry 899147/241925, Crime
37604/13221, and total dist 3420877 bytes.  The owner now exclusively runs the
standard `npm test` regression gate from this worktree (no network, port, or
process sharing) into the same build log before handoff.

## Decision

Deliver the truthful foundation now: explicit known-polyline validation, bounded
corridor association, data coverage/missing evidence, and a text-list-ready
result model.  Keep raw-GPS, providers, UI, location permissions, persistence,
and canonical-Crime integration explicitly unimplemented.

## 2026-08-05 — implementation and verification

- TDD RED: `npm run test:route-corridor` failed with `ERR_MODULE_NOT_FOUND` for
  the absent capability module.  GREEN: 5/5 route-corridor contracts passed.
- A first attempt to import existing `@turf/turf` found that clean worktree
  dependencies had not yet been installed.  The final module intentionally uses
  a dependency-free spherical great-circle segment calculation instead, so its
  focused contract remains reproducible before installation and adds no runtime
  dependency/bundle pressure.
- After `npm ci --ignore-scripts`, targeted checks passed: route-corridor 5/5,
  Crime async 22/22, Crime safety foundation 9/9, syntax check, and diff check.
  Full `npm test` ended `EXITCODE:0`; P1 had 14/14 and visual baseline policy
  reported 66 deterministic baselines.
- Build/manifest and bundle policy ended `EXITCODE:0`; Entry 899147/241925,
  Crime 37604/13221, total dist 3420877.  No route-corridor chunk was emitted:
  no production import exists in this C1 foundation branch.
- Mandatory `code-reviewer` and `architect` lanes were launched as read-only
  independent review.  Neither yielded a report after repeated 60-second and
  30-second bounded waits, then interrupt/retry.  Per the review workflow this
  blocks an approved/merge-ready conclusion even though implementation checks
  passed.  No commit was made.

## 2026-08-05 — independent review findings and repair

- The independent code reviewer reported fail-open unmapped evidence, malformed
  incident input, unknown source/request status, unbounded O(events×segments),
  dedupe ordering, date parsing, and stale Turf documentation.  The architect
  additionally blocked any zero result without proof that canonical data covered
  the whole route corridor rather than a viewport/Point-A subset.
- The repair is test-first and fail-closed: a `no-mapped-incidents` or `ready`
  result now requires `requestStatus: current`, `sourceStatus: ready`, a strict
  `incidentScope` of `{ kind: 'route-corridor', complete: true }`, strict
  calendar `availableStart/availableEndExclusive`, and a known non-negative
  `unmappedIncidentCount`.  Unknown/partial/pending/malformed paths cannot
  become a zero result.  Route and feature inputs are capped at 512/2000.
- Fresh focused proof after repair: 8/8 route-corridor contracts pass.  Full
  test/build/bundle and re-review must be repeated before any ready conclusion.

## 2026-08-05 — final verification ownership

- Re-review after the query-fingerprint repair: architect status `CLEAR`; code
  reviewer found one equal-distance duplicate tie issue, which was added as RED
  then repaired with deterministic stable serialization.  Final focused result
  is 11/11 and code reviewer verdict is `APPROVE` with zero HIGH/CRITICAL.
- This task is now the sole owner of `npm run validate` in this worktree.  It
  writes only `.runtime/s3-c1-route-corridor-final-validate.log` and this
  worktree's `dist/`; it uses no port, external service, database, shared cache,
  or user-owned Vite process.  Success is an `EXITCODE:0` log marker; otherwise
  the exact failure is preserved before any retry.

## 2026-08-05 — closeout evidence

- Final `npm run validate` ended `EXITCODE:0`: the full standard test chain,
  manifest build, and bundle policy passed.  The focused C1 suite is 11/11;
  visual baseline policy passed 66 deterministic baselines.
- Final bundle evidence: Entry 899147 raw / 241925 gzip, Crime 37604 / 13221,
  total dist 3420877.  C1 is still not imported by production, so no route-
  corridor emitted chunk exists and no current budget grows.
- Independent final verdicts: architect `CLEAR`; code review `APPROVE`, zero
  HIGH/CRITICAL.  The one final equal-distance duplicate issue was resolved by
  deterministic stable serialization and regression test.
- No Vite/browser process, provider, location permission, URL/history/storage,
  or shared Crime UI file was touched.  No Git commit was created because this
  detached integration worktree is an evidence handoff, not the target branch.
