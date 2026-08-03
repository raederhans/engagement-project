# Task

## Current status

P2 execution is active. The stacked deliveries, ownership split, and synchronized Crime task flow are verified. Recoverable partial failures and result-level provenance are next.

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
- [ ] Implement recoverable data states and result-level provenance.
- [ ] Complete Diary local lifecycle and unified artifacts.
- [ ] Extend WebGL, Axe, cross-platform, data, and performance gates.
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

## Open risks and remaining work

- The historical five-PR dependency stack has been semantically replayed on current main; the old branches remain untouched as audit evidence.
- Stage 2 used one root-owned Playwright worker on port `4178`; it was stopped after the verified run and generated reports were removed.
- Stage 3 uses one root-owned Playwright worker on port `4178`; all preview processes stopped and generated reports were removed after verification.
- The remaining fenced WSL snapshot workspace is under the system temp directory because recursive cleanup was denied by the execution policy; it contains no credentials or source changes not already present in this worktree.
- The next product risk is partial-source failure: successful summary, incident, chart, and boundary results must remain usable while the failed source exposes an actionable retry and truthful provenance.
