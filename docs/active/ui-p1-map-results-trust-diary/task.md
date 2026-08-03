# Task

## Current status

P1-1 through P1-4 and Stage 5 verification are complete. The isolated branch is ready for a stable review commit and Draft PR; localization reconciliation remains a separate Stage 6 integration gate.

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
- [ ] Rebase onto the completed localization work, integrate, push, verify CI/Pages, and archive the task record.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Primary localization checkout | `codex/bilingual-localization@d383e30` matches its pushed remote branch; the only remaining dirty path is an unrelated user-owned `.gitignore`, which this task did not touch. |
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

## Open risks and remaining work

- The localization branch is stable and pushed, but it predates the new P1 user-visible strings. Its owner must reconcile the P1 commit deliberately before merge.
- This P1 branch will remain a Draft PR until localization reconciliation, final CI, and production integration are complete.
- MapLibre still triggers Vite's generic 500 kB warning; the stricter project bundle budgets pass, and a map-runtime migration remains outside this P1 scope.
