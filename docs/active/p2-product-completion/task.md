# Task

## Current status

P2 execution is active. Stages 1 through 6 are locally verified. Stage 7 will complete final independent review, GitHub integration, exact-commit Pages verification, and archival.

## Checklist

- [x] Verify `origin/main`, all worktrees, branch heads, dirt, and user-owned WIP.
- [x] Create the isolated P2 integration worktree and branch.
- [x] Integrate and verify PR #49 comparison details.
- [x] Integrate and verify PR #50 chart studio.
- [x] Integrate and verify PR #51 incident details.
- [x] Integrate and verify PR #53 summary insights.
- [x] Integrate and verify PR #55 custom radius.
- [x] Split CSS and Diary ownership with behavior locks.
- [x] Implement task flow and map/list dual-channel analysis.
- [x] Implement recoverable data states and result-level provenance.
- [x] Complete Diary local lifecycle and unified artifacts.
- [x] Extend WebGL, Axe, cross-platform, data, and performance gates.
- [ ] Run independent review, full verification, integration, deployment, and production smoke.
- [ ] Archive records after GitHub and Pages state match evidence.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Remote truth | `origin/main` and GitHub `main` both resolve to `e32e3426c3db75d5429d07e678ca65c48b2d734c`. |
| Worktree audit | Primary WIP preserved; five stacked P2 worktrees are clean and track their remote branches. |
| Existing PR CI | PRs #49, #50, #51, #53, and #55 each report a successful `validate` check on their current head. |
| P2 worktree | Clean `codex/p2-product-completion` created from current `origin/main`. |
| Comparison integration | Detailed A/B metrics, truthful unavailable states, preserved disclosure state, and adaptive native drilldown rows pass `test:ui-p0`, `test:i18n`, and `test:p1-ui`; dynamic bars use class-owned native progress elements. |
| Chart Studio integration | Indexed/count trends, count/share/Pareto categories, temporal views, insights, and cached display preferences pass 9 chart contracts plus the P0, P1, and bilingual gates. |
| Artifact budget recovery | Build-only six-decimal boundary compaction preserves source data and published feature counts; `verify:bundle` passes at 3,284,167 bytes without increasing any budget. |
| Incident Details integration | Unclustered points expose escaped bilingual details, clear-selection reconciles markers/buffers/comparison state, and stale point lifecycles remain fenced; points, Crime async, P0, P1, i18n, build, and bundle gates pass. |
| Summary Insights integration | Summary and A/B detail use the selected analysis window, show average per 30 days and category composition, avoid sparse 30-day comparisons, and pass product, UI, async, P1, i18n, build, and bundle gates. |
| Custom radius integration | Presets plus a progressive custom 100-10000 metre input round-trip through URL/share state; drafts do not query and each committed value refreshes once. P0, product, i18n, P1, async, build, and bundle gates pass. |
| Full stacked bundle admission | `verify:bundle` passes at 3,288,581 bytes; the entry is 879,137 bytes and all lazy feature chunks remain within their project budgets. |
| CSS ownership | The canonical 3,193-line stylesheet is now an ordered five-owner entry (`tokens-base`, `diary-map-ui`, `workbench-shell`, `civic-product`, `crime-charts-responsive`); normalized rules and cascade order match the pre-split source. |
| Diary ownership | Seed loading/cache, pure view models, and the simulator are focused modules behind the existing lazy facade; each active Diary session owns its exact simulator instance and cleanup. |
| Stage 2 behavior gates | `npm run validate`, `npm audit --audit-level=high`, and bundle policy pass; Diary remains a dynamic entry with no delayed CSS, the entry emits one stylesheet, and `dist` is 3,289,764 bytes. |
| Stage 2 visual gates | Windows deterministic experience run: 24 pass and 6 intentional project skips across desktop, portrait, and landscape. The Linux and Windows desktop Help baseline was deliberately aligned to the earlier adaptive Drilldown-row behavior. |
| Stage 2 independent review | Architecture review returned `APPROVE/CLEAR`; session identity, timer/listener cleanup, lazy CSS, facade compatibility, and stale-owner fencing have no blocking or medium findings. |
| Stage 3 task flow | Crime now presents one ordered Explore -> Summary -> Incidents path, with incidents and charts before recent analyses and no second navigation or mobile sheet. |
| Stage 3 map/list contract | One accepted CARTO GeoJSON response and generation update both MapLibre and the bounded incident list; `cartodb_id` is a current-result key only and is not persisted, shared, or exported. |
| Stage 3 selection and safety | Map and list use one selection owner and escaped bilingual detail model; stale responses mutate neither sink, a missing next-generation item clears selection, list activation preserves focus visibility, and high-density DOM output is capped at 200 rows. A map-selected item outside the first 50 rows is inserted from the same cached generation without querying, scrolling, or stealing focus. |
| Stage 3 lazy/bundle gate | Incident results remain a focused lazy chunk at 6,988 bytes / 2,773 gzip. Entry 880,076 / 236,277, Crime 35,251 / 12,260, and total dist 3,305,100 bytes all pass unchanged project budgets. A failed chunk load is surfaced, its rejected promise is cleared, and the next refresh retries. |
| Stage 3 visual/a11y gate | Windows deterministic experience: 27 pass / 6 intentional skips across desktop, portrait, and landscape. Linux/Windows incident baselines are stable across all three viewports; Axe reports no critical or serious issue in the incident flow. |
| Stage 3 full verification | Feature-enabled `npm run validate`, `npm audit --audit-level=high`, and `git diff --check` pass; 66 cross-platform UI baselines are present and dependency audit reports 0 vulnerabilities. |
| Stage 3 independent review | Final code review returned `APPROVE` and architecture review returned `CLEAR`; pagination synchronization, retryable chunk loading, current-generation ownership, focus behavior, XSS sinks, and unchanged bundle ceilings have no remaining blocker. |
| Stage 4 partial-result ownership | Charts, comparison, summary, incidents, and optional tract overlays settle independently; a failed surface retains only same-filter usable data, exposes an accessible scoped retry, and cannot cancel an in-flight full refresh. |
| Stage 4 provenance | Every acted-on result receives immutable scope, coverage, generated/retained time, metric state, and actual live/fallback lineage. Current source callbacks and retained stale lineage are separate, so old fallbacks cannot overwrite current live providers in mixed A/B results. |
| Stage 4 source contracts | Population results include both tract-boundary and demographic lineage even when counts, rather than per-10k values, are displayed. Metadata-aware source caches are consulted on every refresh and cancellation cannot publish a source. |
| Stage 4 focused verification | Recovery, provenance, and Crime async contracts pass `43/43`; full `npm test` and `git diff --check` pass. |
| Stage 4 build and browser gate | Pages-equivalent build passes bundle policy at entry `900,663 / 242,542` gzip, Crime `37,698 / 13,117`, Charts `224,236 / 76,299`, and total `3,334,759` bytes. Browser smoke passes with `consoleErrors=0`, `pageErrors=0`; port 4173 is released. |
| Stage 4 independent review | Final correctness review returned `APPROVE` and architecture review returned `CLEAR`; current/stale lineage, export isolation, same-filter retention, scoped retry, cancellation, and lazy ownership have no blocker. |
| Stage 5 local lifecycle | IndexedDB schema v2 stores canonical private entries and resumable route drafts; commits atomically save an entry and remove its draft, every mutation/import/snapshot shares one serialized repository queue, and latest local draft intent wins across teardown and cross-tab timestamp conflicts. |
| Stage 5 private portability | Versioned private backups include entries and drafts, validate size/schema/duplicates/geometry, preview merge or destructive replace, require an exact same-transaction snapshot token for replace, and remain structurally distinct from public Crime shares and exports. |
| Stage 5 browser and visual gate | Browser smoke verified v1-to-v2 migration, blocked/versionchange IndexedDB handling, local history visibility, private backup flows, and zero console/page errors. Windows deterministic visual experience passed 27 cases with 6 intentional skips across desktop, portrait, and landscape. |
| Stage 5 final verification | Feature-enabled `npm run validate`, Pages-equivalent build, bundle policy, `npm audit --audit-level=high`, and browser smoke pass. Entry is `900,407 / 242,419` gzip, Diary local storage is `20,449 / 6,328`, total `dist` is `3,372,254` bytes, and the dependency audit reports 0 vulnerabilities. |
| Stage 5 independent review | Final correctness review returned `APPROVE` and architecture review returned `APPROVE/CLEAR`; the last cross-tab retry race is locked by an A-waits, B-registers, A-superseded regression and no correctness, security, ownership, or deadlock blocker remains. |
| Stage 6 WebGL recovery | MapLibre keeps ownership of WebGL context reconstruction; the app adds a bilingual non-blocking lost/restored status and explicit page-reload path without recreating or resizing the map. Listener, timer, and UI cleanup pass 2 focused behavior tests. The recovery surface is locked above the mobile sheet and below the app bar. |
| Stage 6 data and platform gates | `test:data-contract` is the single aggregate entry for data validation, source/runtime/pipeline/automation contracts, and the top-level suite no longer duplicates those commands. CI runs the same `validate` contract on `ubuntu-latest` and `windows-latest`; one Linux lane owns Playwright and diagnostics. |
| Stage 6 runtime and accessibility gates | Runtime response-body measurement proves Diary and Crime cold starts exclude the other mode and optional Charts/Incidents, then admits those chunks only after analysis. Axe reports zero critical/serious findings on desktop, portrait, and landscape. |
| Stage 6 full local verification | Feature-enabled `npm run validate`, Pages-equivalent build, bundle policy, `npm audit --audit-level=high`, and `git diff --check` pass. Pages-equivalent output is entry `901,588 / 242,846` gzip and total `dist` `3,374,730` bytes. Deterministic browser experience reports 30 pass and 6 intentional desktop-only skips across three viewports. |
| Stage 6 independent review | Final code review returned `APPROVE`; architecture review moved from `BLOCK` to `CLEAR` after locking `sheet 25 < map notice 28 < WebGL recovery 29 < app bar 30`. No MapLibre duplicate-recovery, CI duplication, data-contract, lazy-boundary, or event-lifecycle blocker remains. |

## Open risks and remaining work

- The historical five-PR dependency stack has been semantically replayed on current main; the old branches remain untouched as audit evidence.
- Stage 2 used one root-owned Playwright worker on port `4178`; it was stopped after the verified run and generated reports were removed.
- Stage 3 uses one root-owned Playwright worker on port `4178`; all preview processes stopped and generated reports were removed after verification.
- The remaining fenced WSL snapshot workspace is under the system temp directory because recursive cleanup was denied by the execution policy; it contains no credentials or source changes not already present in this worktree.
- Stage 5 test logs and Playwright reports were task-owned temporary artifacts and were removed after verification; ports `4173` and `4178` are released.
- Stage 6 generated Playwright diagnostics are task-owned and are removed before commit; port `4178` is released after each serial browser run.
- Stage 7 still needs final independent approval on the corrected recovery layer, exact remote-drift/worktree checks, PR CI on both operating systems, merge, Pages deployment, production smoke, and record archival.
