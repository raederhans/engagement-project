# UltraQA Report

## Goal and success criteria

- Goal: prove the Stage 1 Analysis Artifact and local History flow under normal, malformed, interrupted, stale, and browser-lifecycle conditions.
- Stop condition: full validation, adversarial browser smoke, independent review, dependency audit, and cleanup all pass on the final candidate.
- Safety bounds: no production writes, no backend, no destructive IndexedDB migration, no Diary database access from the Analysis feature.

## Scenario matrix

| ID | User or attacker model | Scenario | Command or harness | Expected signal | Actual result | Status | Evidence | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UQ-01 | Normal Crime user | Save, reload, reopen, rename, share, export, and delete | `npm run test:browser-smoke` | Complete local lifecycle | Lifecycle completed | PASS | Browser smoke exit 0 | Browser and preview closed |
| UQ-02 | Malformed or oversized input | Unknown fields, lossy coordinates, oversized labels, corrupt rows, contradictory Tract provenance | repository and product contract suites | Reject writes; retain valid rows with warning | Repository 13/13; Product 46/46 | PASS | `npm run validate` exit 0 | No temporary fixture remained |
| UQ-03 | Repeated interruption | Restore A held, restore B missing or unreadable; explicit Diary cancellation | History plus real coordinator harness | Abort A before B read settles; no late sink | History 20/20; late applied count 0 | PASS | targeted restore-owner tests | All owners settled |
| UQ-04 | Stale async owner | Failed, superseded, or cancelled refresh returns after saved snapshot | History, Crime, Points suites | Saved comparison remains truthful; stale result cannot commit | History 20/20; Crime 13/13; Points 11/11 | PASS | suite exit 0 | Signals/listeners released |
| UQ-05 | Privacy-sensitive Diary user | Open Diary directly | Browser smoke | No History chunk, Analysis DB, or Crime API | All three remained absent | PASS | `historyChunk=false`, `analysisDb=false` | Diary session closed |
| UQ-06 | Concurrent browser tabs | Blocked IndexedDB v1 to v2 upgrade while History stays visible | Browser smoke raw v1 connection fixture | `versionchange` and `blocked`; record retained after release | Version 2 opened; `migration-fixture` retained | PASS | browser smoke exit 0 | Connections closed |
| UQ-07 | External API failure | Expected CARTO 503 during failed refresh | Browser smoke mocked remote hosts | Exactly bounded failures; no unexpected console errors | `intentionalCarto503=3`, errors 0 | PASS | browser smoke exit 0 | Network mocks removed |
| UQ-08 | Rapid A/B user | Second `flyTo` synchronously stops the first movement | Points lifecycle harness | Old move resolves false; final move owns one refresh | Points 11/11 | PASS | replacement moveend regression | No timers remained |
| UQ-09 | Hostile payload | Injection-like strings and unsupported artifact payload fields | strict artifact validation and DOM rendering tests | No instruction-like or HTML payload can bypass schema or render unsafely | Rejected or escaped | PASS | Product and repository suites | No payload persisted |
| UQ-10 | Slow or hung dependency | HTTP timeout, abort during backoff, deferred JSON parsing | data-source contracts | Bounded timeout/abort, no retry after caller cancellation | Data-source 27/27 | PASS | suite exit 0 | Timers/listeners released |
| UQ-11 | Dirty worktree operator | Run QA with intentional Stage 1 modifications and untracked task records | status before/after plus `git diff --check` | No reset, masking, or unrelated staging | Task diff preserved; no Git writes | PASS | status/diff inspection | No generated debris |
| UQ-12 | Misleading success output | Chain validation by exit code rather than PASS text | PowerShell fail-closed command chain | Any non-zero child stops the gate | Final chain exit 0 | PASS | validate, audit, browser, diff-check | Port 4173 listeners 0 |

## Commands run

- `[0] VITE_FEATURE_DIARY=1 VITE_TRACT_CRIME_SNAPSHOT=1 npm run validate` - data, all tests, production manifest, and bundle policy.
- `[0] npm audit --audit-level=high` - 0 vulnerabilities.
- `[0] npm run test:browser-smoke` - adversarial dynamic browser and IndexedDB lifecycle coverage.
- `[0] git diff --check` - no whitespace errors; line-ending notices only.

## Failures found and fixed

- A newer restore did not immediately abort an older Crime refresh while its repository read was pending. The queue now exposes explicit cancellation and the controller cancels before every new read.
- A replacement `flyTo` could misread MapLibre's synchronous old `moveend` as completion of the new move. The new owner is armed only after the action returns.
- `pendingAddressMove` duplicated ownership without affecting behavior. It was removed after the real owner tests passed.

## Cleanup and rollback

- No temporary harness was added; all new tests are intentional regression coverage.
- Browser smoke closed Chromium and Vite in `finally`.
- Final port check reported `PORT_4173_LISTENERS=0`.
- UltraQA state was not written because Autopilot already owned the top-level OMX workflow; the active Autopilot state was preserved.

## Residual risks

- Browser storage remains device-local by product choice and does not sync across devices.
- Browser eviction or private mode can remove or block local History; visible errors and JSON export are provided, but there is no backend recovery.
- The main entry remains above Vite's generic 500 kB warning because MapLibre is required at startup; project-specific bundle budgets pass.

## Result

`ULTRAQA COMPLETE: Goal met after 1 cycle.`
