# Context

## Current truth

- Repository: `raederhans/engagement-project`.
- Working branch: `codex/bilingual-localization@541cb1d`, matching `origin/codex/bilingual-localization@541cb1d` after P1 reconciliation.
- P1 handoff: `origin/codex/p1-ui@614e88c`, with runtime commit `966ffaa`; both P1 and localization independently descend from `origin/main@f956ab2`.
- P0 UI runtime commits were merged by PR #39 as `8ac7001`; P0 records were archived by PR #40 as `f956ab2`. Current local HEAD and `origin/main` both point to `f956ab2`.
- The only unrelated dirty file is `.gitignore`; it is not owned by this task and must not be staged or committed.
- The application is vanilla JavaScript with Vite and MapLibre; there is no existing localization module or dependency.
- Existing UI contracts are Node tests under `scripts/tests/`, and `npm run validate` is the repository-wide gate.
- No repository-root `lessons learned.md` exists.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-01 | Keep localization framework-free and catalog-driven. | Matches the existing architecture and avoids a new dependency. |
| 2026-08-01 | Use one app-wide locale owner with DOM bindings and direct translation calls for dynamic text. | Static and runtime copy share one catalog without duplicating mode state. |
| 2026-08-01 | Preserve English as fallback; first visit may select Chinese from browser preference, then persist explicit user choice. | Existing links remain compatible while Chinese users get an appropriate default. |
| 2026-08-01 | Keep `README.md` as the English canonical entry with a Chinese sibling and visible language links. | Chinese documentation is easy to find without duplicating every technical file. |
| 2026-08-03 | Move the preserved localization WIP from the merged P0 branch onto `codex/bilingual-localization` based on `origin/main@f956ab2`. | The task now starts from the accepted P0 baseline without stash, reset, or overlap loss. |
| 2026-08-03 | Keep one dependency-free catalog/runtime and use DOM bindings plus narrow rerenders for stateful surfaces. | Language changes update static copy and already-rendered Diary, rating, history, chart, map, and comparison UI without resetting app state. |
| 2026-08-03 | Correct README validation and Pages deployment descriptions, and add `README.zh-CN.md`. | Reader-facing project setup is bilingual and matches the current package/Vite/workflow contracts. |
| 2026-08-03 | Keep Analysis History translations in their own lazy chunk. | Both the existing entry/history bundle budgets and complete bilingual history copy remain intact. |
| 2026-08-03 | Bind MapLibre canvas, navigation, attribution, and marker accessibility labels to the app catalog. | Third-party-created controls switch language with the rest of the interface. |
| 2026-08-03 | Reconcile P1 with an ordinary merge, never rebase or force-push. | Both branch histories remain reviewable and the localization remote can advance by fast-forward push. |
| 2026-08-03 | Keep the localization PR layered on `codex/p1-ui` unless an existing PR contract requires otherwise. | PR #41 remains the P1 delivery to `main`; the localization review shows only the bilingual delta and does not merge or deploy P1. |
| 2026-08-03 | Keep shared P1 copy in a focused lazy catalog and keep Live-route simulator copy inside the Diary lazy boundary. | Complete P1 localization stays below the existing entry, Diary, and new P1 catalog budgets without raising a limit. |
| 2026-08-03 | Create Draft PR #42 with `codex/p1-ui` as its base. | Localization remains a reviewable layer over Draft PR #41; neither PR was merged and Pages was not deployed. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Previous quick preview on 127.0.0.1:5173 | root | `C:\Users\raede\AppData\Local\Temp\codex-engagement-project\preview-5173.log` | No listener present on 2026-08-03; a fresh preview is required for final bilingual smoke. |
| Previous P0 preview on 127.0.0.1:4173 | P0 task owner | `C:\Users\raede\AppData\Local\Temp\engagement-ui-p0-preview-20260801.log` | No listener present on 2026-08-03. |
| Full repository validation | root | `C:\Users\raede\AppData\Local\Temp\engagement-i18n-validate-final.log` | Complete: `npm run validate` exited 0 with 257/257 tests and bundle policy PASS. |
| Bilingual dev preview | root | `C:\Users\raede\AppData\Local\Temp\engagement-i18n-preview.log` | Stopped before P1 integration; prior owned PID 38492 was terminated and port 5173 verified free. |
| P1 reconciliation validation | root | `C:\Users\raede\AppData\Local\Temp\engagement-p1-i18n-validate-final.log` | Complete with both feature flags: 291/291 tests, production build, and bundle policy passed. |
| Browser smoke | root | `C:\Users\raede\AppData\Local\Temp\engagement-p1-i18n-browser-smoke.log` | Complete against the feature-enabled production build; consoleErrors=0 and pageErrors=0; owned server stopped. |
| Dependency audit | root | `C:\Users\raede\AppData\Local\Temp\engagement-p1-i18n-npm-audit.log` | Complete: `npm audit --audit-level=high` found 0 vulnerabilities. |

## Handoff

- Root owns implementation, tests, task records, and the 5173 preview.
- Preserve `.gitignore`; stage and commit only the localization implementation, tests, documentation, and task records.
- Keep technical terms such as Crime Incidents, Street Diary, MapLibre, GeoJSON, API, URL, localStorage, and IndexedDB explicit where translation would reduce precision.

## Next step

Review Draft PR #42; its GitHub `validate` run `30793889757` passed. Keep PR #41 Draft and do not deploy Pages until the layered delivery is accepted.
