# Task

## Current status

Complete: the original offense highlighting work and all four approved follow-up improvements are implemented and verified.

## Checklist

- [x] Confirm current filter and URL ownership.
- [x] Confirm point source/layer color ownership and root cause.
- [x] Identify palette reuse boundary and legend owner.
- [x] Add and observe failing contracts.
- [x] Implement three-selection limit and palette-derived colors.
- [x] Synchronize map, legend, URL, palette changes and clear state.
- [x] Run focused tests, build/bundle and browser smoke.
- [x] Complete review and report adjacent improvements.
- [x] Align buffer incident points with the selected radius.
- [x] Reload time-filtered offense options when the analysis window changes.
- [x] Re-render the current categorical legend on language changes.
- [x] Preserve native Shift/Ctrl/Cmd multi-selection and explain the platform behavior without replacing keyboard handling.
- [x] Re-run focused tests, build/bundle and browser smoke.
- [x] Complete final review and report remaining risks.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Git/worktree/registry inspection | One worktree on `main`; unrelated dirty WIP identified and protected. |
| Port ownership inspection | Existing listener PID 38872; marked user-owned. |
| Initial targeted contracts | 6 expected failures isolated the missing highlight behavior. |
| Targeted contracts after implementation | `node --test --test-reporter=dot scripts/tests/points_lifecycle.mjs scripts/tests/product_integrity_contracts.mjs scripts/tests/crime_ui_contracts.mjs`: 107/107 passed. |
| i18n contracts | `node --test --test-reporter=dot scripts/tests/i18n_contracts.mjs`: 9/9 passed. |
| UI contracts | Five-file UI run: 71/71 passed. |
| Build and budget | `npm run build:manifest` passed; `npm run verify:bundle` passed with Entry 902576/902665 and Crime 37984/38000 raw bytes. |
| Browser smoke | Two and three highlighted types, Blues→OrRd color synchronization, 3-item disabling, URL persistence, and clear-to-cluster recovery passed; console 0 errors/0 warnings. |
| Existing server | `127.0.0.1:5173` still returns HTTP 200 from preserved PID 38872. |
| Diff hygiene | `git diff --check` passed; only existing LF→CRLF notices were emitted. |
| Independent final review | PASS; no P0/P1 blockers, `node --check` passed for panel, legend and points modules. |
| Follow-up regression | Six focused commands passed 201/201: runtime 14, points 26, Crime async 19, UI P0 76, i18n 9 and product integrity 57. |
| Follow-up build and budget | `npm run build:manifest` passed; `npm run verify:bundle` passed with Entry 902645/902665, Crime 37992/38000 and dist 3415522 bytes. |
| Follow-up browser smoke | `final-result.json` passed: one initial point request; Shift 1→2, Ctrl 2→1, fourth-item attempt capped at 3; 12-month analysis refreshed while the code request was deliberately held; 28 points, maximum projected distance 783.15 m within 800 m; same legend node translated; 0 console/page errors. |
| Follow-up review | Initial review found two time-sync/error-state issues; both were repaired. Re-review: APPROVE, no remaining critical/high/medium findings. |
| Final integration | PR #62 merged as `5184c901`; CI run `30983733787` passed on Windows and Ubuntu, including Chromium smoke and all 36 visual tests |

## Open risks and remaining work

- Native multi-select modifier details remain platform/browser dependent; the UI therefore documents Shift plus Ctrl/Cmd and leaves the browser interaction model intact.
- Restoring a saved analysis currently synchronizes its Crime state and live results but does not explicitly re-query the visible offense-option list; this is a separate history-panel follow-up.
- The entry bundle has only 20 raw bytes of remaining policy headroom; future entry changes should delete or lazy-load before adding code.
