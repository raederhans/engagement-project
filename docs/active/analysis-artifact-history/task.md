# Task

## Status

Autopilot `ultragoal`: Stage 1 implementation, final independent review, and UltraQA are complete; GitHub delivery remains.

## Checklist

- [x] Confirm clean base and create isolated branch.
- [x] Create Autopilot context and durable task records.
- [x] Draft PRD and test specification.
- [x] Record Architect approval followed by Critic approval.
- [x] Create Ultragoal story ledger and begin TDD.
- [x] Implement Analysis Artifact and local repository.
- [x] Implement history UI and lifecycle integration.
- [x] Run cleaner, independent code review, and UltraQA.
- [ ] Commit, push, PR, CI, merge, Pages verification, archive.

## Evidence log

| Evidence | Result |
| --- | --- |
| Git intake | Clean `main` matched `origin/main` at `f1b8f07`; one worktree. |
| Scope | Stage 1 only: artifact contract, local history, IndexedDB layer. |
| Dependency | Exact `idb@8.0.3`; thin adapter/repository boundary; Dexie rejected as unnecessary. |
| Architect | Initial `BLOCK`: required atomic restore, awaitable refresh, artifact discriminator, split freshness state, corrupted-row isolation, and an independent Analysis database. Revised plan now includes all findings. |
| Critic | Initial `BLOCK`: required deterministic save eligibility, one restore owner, strict refresh result, real upgrade fixture, and hard lazy/privacy gates. Revised plan now includes all findings. |
| Consensus | Critic re-review returned `APPROVE`; plan is executable and testable. |
| G001 RED/GREEN | Six initial contract failures, then a refresh aggregation failure, were observed before implementation. Final: Product 41/41, Points 9/9, Crime Async 10/10, Diary Async 26/26. |
| G002 RED/GREEN | Repository tests started 0/8 and ended 8/8. Exact `idb@8.0.3`; Product 41/41; audit 0 vulnerabilities. Diary database untouched. |
| G003 RED/GREEN | History controller began with missing-module RED and ended 8/8. Restore is latest-intent/once-only; source freshness is transient; lazy chunk 15.68 kB. |
| G004 RED/GREEN | Initial browser RED exposed a URL-sync race; a later isolation RED exposed unmocked MapLibre glyph traffic. Final serial gate passed: entry 890,941 bytes (<950k), Analysis History lazy chunk 15,856/5,709 raw/gzip, dist 3,889,797 bytes; browser verified full artifact lifecycle, stale-B clearing before one fresh CARTO request, blocked/versionchange/visible v1→v2 upgrade with record retention, fully mocked remote hosts, and 0 console/page errors. |
| G006 review blockers | RED covered invalid writes, the controller/coordinator double-refresh boundary, failed/superseded snapshot text, missing tract provenance, invalid tract metadata, and the loosened Entry budget. GREEN: targeted 65/65 plus bounded-metadata coverage; async regression 124/124; full `npm test` passed; strict-before-canonicalization and real-date validation retained the Entry budget at 902665/247583 with a fresh 891453/246992 build; the runtime-store projection regression proved creation ignores non-artifact fields while preserving strict known-field and external V1 validation; History measured 21635/7193 against the then-current 22000/7300 budget, leaving only 365/107 raw/gzip headroom before required G007 behavior; final browser PASS saved the runtime store successfully, retained exact restore-owner Point request count 1, and reported 0 console/page errors. |
| G007 snapshot/cancellation/freshness | RED proved the missing real cached comparison renderer, non-canonical null labels, absent coordinator cancellation propagation, non-semantic tract provenance acceptance, cancelled restores left Refreshing, load-only freshness, and duplicate geocode refresh work. GREEN added real cached comparison rendering, canonical null labels, atomic last-success snapshots, coordinator cancellation, semantic tract provenance, live freshness recomputation, and one geocode refresh generation. Final resolver coverage proves failed/superseded/cancelled refreshes redraw the saved comparison; `runProgrammaticMapMove` suppresses programmatic `flyTo` `moveend`, preserves user pan, and releases when no movement occurs; expected CARTO 503 is constrained by stage, URL, and exact count. One behavior-preserving compression pass was attempted; further safe simplifier changes worsened gzip, so required blocker functionality recalibrated History from 22000/7300 to 23000/7800 while Entry remained 902665/247583. Latest GREEN: History 16/16, Points 10/10, Crime 13/13; `npm run validate` passed; audit reported 0 vulnerabilities. The production build used exactly `VITE_FEATURE_DIARY=1` and `VITE_TRACT_CRIME_SNAPSHOT=1`; no `VITE_FEATURE_ANALYSIS_HISTORY` exists or is required. Bundle: Entry 891985/247181, Crime 29515/10626, History 22349/7445. Browser PASS: 1200 ms geocode response with generation=1, intentional503=3, 0 unexpected console/page errors, and port/process clean after cleanup. |
| Final async owners | New restore intent cancels the prior coordinator transition before its IndexedDB read; late sink count is 0. Overlapping A/B `flyTo` ignores the synchronous old `moveend` and owns only the final movement. History 20/20; Points 11/11. |
| Final verification | `npm run validate`, audit, browser smoke, and diff-check passed on the simplified candidate. Bundle: Entry 892339/247309, Crime 29716/10693, History 22927/7576, dist 3899831; 0 vulnerabilities; 0 console/page errors; port 4173 listeners 0. |
| Independent gates | Code review `APPROVE` with 0 findings; architecture `APPROVE/CLEAR`; simplifier removed one redundant variable and reported no correctness blocker. |
| AI slop cleaner | Changed-file scan found no masking fallback; removed redundant `pendingAddressMove`; retained independently justified restore and snapshot terminal state. Post-cleaner validation/browser gates passed. |
| UltraQA | One adversarial cycle passed normal lifecycle, malformed/corrupt input, cancellation, stale owners, Diary isolation, blocked IndexedDB upgrade, API failure, parallel map moves, timeout, dirty-worktree, and exit-code scenarios. See `ultraqa-report.md`. |

## Open items

- Complete GitHub delivery after those final gates pass.
