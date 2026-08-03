# Task

## Current status

P1-1 through P1-4 and Stage 6 are complete. PR #42 merged the reviewed bilingual layer into P1, PR #41 merged the final head into `main` as `5985b71`, and exact main CI, Pages, and public Crime/Diary bilingual verification passed. This record is ready for archival.

## Checklist

- [x] Protect the dirty localization checkout and create `codex/p1-ui` from clean `origin/main`.
- [x] Record P1 visual thesis, interaction thesis, scope, sequencing, and acceptance criteria.
- [x] Map current Crime incident, cluster, camera, summary, and history ownership.
- [x] Map current Diary route, comparison, Insights, simulator, and tab ownership.
- [x] Add and observe failing P1-1 tests.
- [x] Implement and verify P1-1.
- [x] Add and observe failing P1-2 tests.
- [x] Implement and verify P1-2.
- [x] Add and observe failing P1-3 tests.
- [x] Implement and verify P1-3.
- [x] Add and observe failing P1-4 tests.
- [x] Implement and verify P1-4.
- [x] Run full validation, dependency audit, bundle policy, browser matrix, accessibility audit, and independent reviews.
- [x] Merge the completed localization work without rewriting history, push, verify CI/Pages, and archive the task record.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Initial primary localization checkout | `codex/bilingual-localization@d383e30` matched its pushed remote branch; the only remaining dirty path was an unrelated user-owned `.gitignore`, which this task did not touch. |
| Initial isolated checkout | Clean `codex/p1-ui` at `f956ab2`, tracking `origin/main`. |
| Baseline full validation | `VITE_FEATURE_DIARY=1 npm run validate` passed: demo and tract data valid, all tests green, build and bundle policy green, 0 dependency vulnerabilities. |
| P1-1 targeted regressions | Selection-gated incidents, cluster expansion, stale ownership, and panel-aware camera behavior passed 37/37 targeted checks; desktop and mobile behavior were smoke-tested with zero console errors or warnings. |
| P1-2 targeted regressions | Summary ordering, current selection state, history restore focus, and map/result synchronization passed 47/47 targeted checks. |
| P1-3 targeted regressions | Live/fallback provenance, local/sample scope, cancellation semantics, and Sample Community truthfulness passed 126/126 targeted checks. |
| P1-4 targeted regressions | Route focus, decision-first alternative copy, scoped Insights, route summary, and collapsed Simulator passed 84/84 targeted checks. |
| Final full validation | `VITE_FEATURE_DIARY=1 VITE_TRACT_CRIME_SNAPSHOT=1 npm run validate` passed after the combined diff: all data checks and tests green; production manifest and bundle policy green. |
| Final bundle | Entry `870,507 / 233,919 gzip`, Crime `33,623 / 11,787`, Diary `198,481 / 60,206`, Charts `207,980 / 70,765`, Diary Insights `11,198 / 3,586`, Analysis History `22,985 / 7,486`; all project budgets passed. |
| Dependency and diff hygiene | `npm audit --audit-level=high` reported 0 vulnerabilities; `git diff --check` passed. |
| Final browser smoke | Passed against a production build with Diary and tract snapshot enabled: unselected Crime issued zero point requests, source freshness completed `current -> mismatch -> current`, history cancel/failure state remained truthful, IndexedDB lifecycle checks passed, console errors 0, page errors 0. |
| Browser matrix | 1440x900, 390x844, and 844x390 Crime/Diary checks passed: no horizontal overflow, truthful Live/Fallback/Demo/Local/Sample states, route fit visible above the sheet, Summary before History, scoped Insights, closed Simulator, 0 console errors/warnings. |
| Independent review | Final architecture, code/security, and design reviews all returned `APPROVE`; no open P0/P1 finding remains. |
| Smoke precondition hardening | Browser smoke now fails immediately with a clear message when `dist` was not built with `VITE_TRACT_CRIME_SNAPSHOT=1`, instead of timing out on an impossible provenance transition. |
| Review delivery | Runtime commit `966ffaa341e50711fc4cb1e375d90f02302cd0be` is pushed on `codex/p1-ui`; Draft PR `#41` targets `main` and explicitly blocks merge/deploy until localization reconciliation. |
| Localization integration | PR #42 passed architecture `PASS`, code `APPROVE`, and exact-head CI run `30796767554`, then merged into `codex/p1-ui` as ordinary merge commit `b4168d67d0635087fbb3fe8a0fa8a65b60122a17`. |
| Combined P1 validation | On `b4168d6`, `VITE_FEATURE_DIARY=1 VITE_TRACT_CRIME_SNAPSHOT=1 npm run validate` passed all data checks and 18 test groups, production build, and bundle policy. |
| Combined P1 browser and audit | `npm run test:browser-smoke` passed with `consoleErrors=0` and `pageErrors=0`; `npm audit --audit-level=high` found 0 vulnerabilities; ports 4173 and 5173 were free afterward. |
| Combined P1 bundle | Entry `872,332 / 234,081 gzip`; Crime `33,663 / 11,795`; Diary `199,940 / 60,300`; Charts `209,897 / 71,569`; P1 translations `8,856 / 3,134`; total `dist` `3,967,480` bytes. All established limits passed. |
| Final PR and main integration | PR #41 exact-head CI run `30797097157` passed on `f21e482`; PR #41 then merged by ordinary merge commit `5985b71896113ebf3f1ae9530ef6a05abe579e38`. |
| Main CI and Pages | Main CI run `30797232222` passed its complete validate and browser-smoke job; Pages run `30797232104` built and deployed the same main SHA. |
| Public production verification | `https://raederhans.github.io/engagement-project/` returned HTTP 200; Crime and Diary passed English/Chinese switching, 390×844 had 0 px horizontal overflow, and the clean-browser check recorded 0 console errors and 0 page errors. |

## Residual non-blocking risks

- MapLibre still triggers Vite's generic 500 kB warning; the stricter project bundle budgets pass, and a map-runtime migration remains outside this P1 scope.
