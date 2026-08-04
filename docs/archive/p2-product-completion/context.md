# Context

## Current truth

- Integration owner: root agent.
- Runtime worktree: `C:/Users/raede/Desktop/dev/engagement_project-p2`, preserved for audit at `codex/p2-product-completion@c1e02b5863d96dfc9d144ee9aa1ba0379007357d`.
- PR #56 merged the P2 runtime as `main@1aa9bde1088e8fe1d71fb4a3679242012eb55274`.
- PR #57 merged the live result-metadata correction as final runtime `main@b649424d34ec4dd9fd9fce226fc6ad4391002c61`.
- Primary worktree is intentionally untouched on `codex/bilingual-localization@65ac92f` with user-owned `.gitignore` and `.playwright-mcp/` changes.
- Relevant clean stacked branches: comparison `20eda9b`, charts `a1eea91`, incident details `8f78a61`, summary insights `aecec62`, custom radius `ffdf351`.
- PRs #49, #50, #51, #53, and #55 were semantically integrated by #56, annotated, and closed while their branches and worktrees were retained.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-03 | Treat current `origin/main`, not the primary checkout, as the integration baseline. | Preserves user WIP and avoids replaying already integrated P1 work. |
| 2026-08-03 | Integrate the five stacked product deliveries before splitting shared CSS or adding more overlapping UI. | Avoids turning existing semantic conflicts into cross-file extraction conflicts. |
| 2026-08-03 | Preserve P1 behavior and visual contracts as admission gates for every P2 phase. | P2 cannot trade accessibility or truthfulness for new features. |
| 2026-08-03 | Keep the product backend-free through P2. | Diary remains local-only and all shared/community/GPS capabilities stay out of scope. |
| 2026-08-03 | Compact only the published boundary copies to six decimal places after each build. | Preserves readable source data and sub-meter fallback geometry while recovering about 720 KB of deployable budget instead of raising the 4 MB limit. |
| 2026-08-03 | Admit custom radii through the existing share-state contract and P1 field system. | Preserves progressive disclosure, avoids queries while typing, and makes non-preset analyses reproducible without a new state channel. |
| 2026-08-03 | Keep `src/style.css` as the single ordered entry and split rules into five responsibility owners without reordering selectors. | Makes future UI changes reviewable while preserving the P1 cascade and one-file production CSS. |
| 2026-08-03 | Create one simulator per committed Diary session and keep `routes_diary/index.js` as the stable lazy facade. | Timers, lifecycle listeners, and late callbacks are released by instance identity without changing public imports or eager-loading Diary. |
| 2026-08-03 | Update only the Linux/Windows desktop Help baseline for adaptive Drilldown rows introduced in `32d84d2`. | Repairs a missing visual artifact from the earlier P2 integration; the baseline update is kept separate from the behavior-preserving Stage 2 refactor. |
| 2026-08-03 | Make the point-response generation the single source for both MapLibre and the incident list. | Prevents duplicate API requests and selection drift; stale generations cannot commit to either sink. |
| 2026-08-03 | Use CARTO `cartodb_id` only as an in-memory current-result key. | Provides deterministic map/list identity without implying a durable public incident identifier or leaking it into shares, history, or exports. |
| 2026-08-03 | Keep incident results inside the existing results drawer and lazy-load their controller only after an authorized point query. | Preserves one mobile sheet, keeps initial Crime within its existing budget, and places current incidents before charts and history. |
| 2026-08-03 | Preserve list focus and explicitly scroll only a list-activated incident into view. | Keyboard selection remains stable after the inserted detail panel; map selection does not force the sheet or list to move. |
| 2026-08-03 | Treat a failed incident-results chunk as a recoverable refresh failure, not a permanent map-only fallback. | The rejected lazy-load promise is cleared, the user receives an explicit failure toast, and the next refresh retries without loading the chunk merely to clear idle state. |
| 2026-08-04 | Give each Crime result surface its own presenter token, immutable provenance, and scoped retry. | Successful surfaces remain usable during partial failure; stale work and busy scoped retries cannot replace or cancel the active full refresh. |
| 2026-08-04 | Keep current source callbacks separate from same-filter retained lineage. | A current live provider cannot be overwritten by an older fallback, while a stale metric still reports the exact lineage that produced it. |
| 2026-08-04 | Remove the route-local tract outline cache and rely on the metadata-aware boundary cache. | Every refresh can resolve truthful live/fallback metadata without duplicating geometry ownership. |
| 2026-08-04 | Make the Diary repository the single serialized owner of drafts, entries, imports, and snapshots. | Drafts survive teardown, exports include the latest accepted intent, replace cannot race queued writes, and cross-tab retry cannot create a newer revision than later user input. |
| 2026-08-04 | Separate canonical private Diary backup schema v2 from public Crime share/export artifacts. | Local notes, route geometry, ratings, and drafts are recoverable without implying server persistence or leaking transport payload/user hashes into a public artifact. |
| 2026-08-04 | Leave WebGL reconstruction to MapLibre and add only app-owned status, reload, and lifecycle cleanup. | Avoids duplicate map/painter recovery while keeping a visible escape path when automatic restoration does not recover the page. |
| 2026-08-04 | Run the full repository validation contract on Linux and Windows while keeping one Linux owner for Playwright. | Adds cross-platform confidence without duplicating shared browser ports, reports, or visual baselines. |
| 2026-08-04 | Measure runtime JavaScript from actual same-origin response bodies and reset the collector between mode navigations. | Proves semantic lazy boundaries and deterministic raw-byte ceilings without wall-clock, Resource Timing, cache, or compression-header variance. |
| 2026-08-04 | Normalize CARTO coverage timestamps to calendar dates at the store ingestion boundary. | Keeps strict `YYYY-MM-DD` result provenance, preserves SQL date semantics across client time zones, and prevents valid Crime results from being labeled unavailable. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Current-main bundle admission | root agent | `C:/Users/raede/Desktop/dev/engagement_project-p2/p2-bundle.tmp` | Complete through all five stacked deliveries. `npm run build:manifest` and `npm run verify:bundle` passed; this worktree's `dist/` is 3,288,581 bytes. The same single-owner contract was reused by later P2 layers. |
| Stage 2 visual experience | root agent | Playwright console plus failure-only `test-results/` | Complete. Port `4178`, single worker, no snapshot-wide update: 24 pass and 6 intentional skips; process stopped and generated diagnostics removed. |
| Stage 3 visual experience | root agent | Playwright console plus failure-only `test-results/` | Complete. Port `4178`, one serial worker: 27 pass and 6 intentional skips. Six incident baselines plus the intentionally changed Crime analysis baselines were generated for Windows/Linux; repeated incident runs were stable and all preview processes stopped. |
| Stage 4 browser smoke | root agent | Console-only failure diagnostics | Complete. Pages-equivalent build used `VITE_FEATURE_DIARY=1` and `VITE_TRACT_CRIME_SNAPSHOT=1`; browser smoke passed with zero console/page errors and port `4173` was released. |
| Stage 5 Diary lifecycle gate | root agent | Console output; generated logs/reports removed after evidence capture | Complete. `npm run validate`, audit, Pages-equivalent build, bundle policy, browser smoke, and the Windows serial visual run passed. IndexedDB migration, atomic import/commit, latest-only draft intent, private backup, and responsive UI evidence are green; ports `4173` and `4178` are released. |
| Stage 6 release-gate extension | root agent | Console output plus failure-only Playwright diagnostics | Complete locally. Data contracts, Linux/Windows CI shape, WebGL recovery, three-viewport Axe, runtime lazy-boundary budgets, full validate/audit/build, and 30-pass browser experience are green; generated diagnostics are removed and port `4178` is released. |
| PR #56 and initial deployment | root agent | GitHub Actions runs `30888257103`, `30889219931`, and `30889219926` | Complete. Exact-head CI, merge-main CI, and Pages passed. A first lazy asset request briefly returned 503 during propagation and then stabilized at HTTP 200. |
| Production metadata hotfix | root agent | PR #57 CI `30891097925`, main CI `30891464471`, Pages `30891464435` | Complete. Windows and Ubuntu validation, browser smoke, visual experience, build, and deploy passed on final `main@b649424d`. |
| Final production smoke | root agent | Root-owned Playwright sessions and HTTP probes | Complete. Four Crime provenance surfaces are current after selection, incident detail and mode switching work, direct Diary stays local/private, all actual app assets return 200, and both browser paths have zero errors or warnings. All sessions and ports are released. |

## Handoff

- Only the root agent may alter Git refs, index state, worktree topology, PRs, or deployment state.
- Read-only subagents may inspect integration conflicts, architecture, and verification coverage but must not edit files.
- Do not use or stop ports owned by other worktrees; register the P2 preview before starting it.

## Next step

Complete. Preserve the audit worktrees and the primary bilingual WIP; future product work starts from the verified `main@b649424d` line rather than reopening the superseded stacked branches.
