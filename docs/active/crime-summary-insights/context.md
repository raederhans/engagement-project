# Context and handoff

## Verified baseline

- The primary worktree contains user-owned `.gitignore` and `.playwright-mcp/` changes and remains untouched.
- The P1-5-8 worktree contains broad staged WIP, including overlapping comparison, i18n, style, and test files; it remains untouched.
- Port 5173 is owned by Vite from `engagement_project-p1-ui` and must not be restarted or reused.
- This isolated worktree starts from the clean PR #51 head `8f78a61`.

## Root-cause evidence

- `src/compare/card.js#updateCompare` independently fetches the selected-window total, last 30 days, and prior 30 days for each point.
- It computes `delta30 = (last30 - prior30) / prior30`; a sparse `1 -> 0` change therefore renders `-100%` even though it is not a stable trend signal.
- The main summary displays only total, most-common label, and `delta30`; it omits the category count/share already available in `top3`.
- Official CDC guidance warns that rates and percentage-style estimates based on small event counts can be unstable and misleading.

## Decision

- Remove the short-window comparison instead of adding an arbitrary suppression threshold or smoothing model.
- Derive a normalized 30-day average from the full selected window and exact total; this adds no query and keeps the interpretation explicit.
- Reuse existing top-three rows to show counts and shares; do not add a new backend query.
- Keep `delta30: null` in runtime snapshots and the existing export schema for saved-artifact compatibility, but stop rendering it as an active insight.

## Safety boundaries

- Preserve historical-data caveats and avoid safety rankings or predictions.
- Do not change the selected time window, dataset coverage, spatial query, or filter semantics.
- Do not touch the existing port 5173 process or P1-5-8 WIP.

## Live validation ownership

- Owner: root agent only.
- Working directory: `C:/Users/raede/Desktop/dev/engagement_project-summary-insights`.
- Full gate: `$env:VITE_FEATURE_DIARY='1'; $env:VITE_TRACT_CRIME_SNAPSHOT='1'; npm run validate`.
- Browser gate: the same flags with `npm run test:browser-smoke`; its preview owns strict port 4173 only for the command lifetime.
- Manual QA: a task-owned Vite preview may use port 4174; port 5173 remains externally owned and untouched.
- Shared outputs: this worktree's `dist/`, Vite cache, and npm cache; validation commands run serially.
- Logs: `C:/Users/raede/AppData/Local/Temp/engagement-summary-insights-20260803/` (task-scoped; safe to expire after 2026-08-10).
- Success: exit code 0, bundle policy pass, and no browser page/console errors; failure: any nonzero exit, port conflict, or unexpected process ownership.
- Stop condition: do not retry the same failure more than three times without a new diagnosis.

## Delivery evidence

- Product commit: `23c9c9565d6f7e30e458583f7a76f8de62baf150`.
- Stacked Draft PR: [#53](https://github.com/raederhans/engagement-project/pull/53), based on `codex/incident-point-details` / PR #51.
- Flagged full validation, bundle policy, dependency audit, and browser smoke all passed.
- Manual QA with the reported Robbery Firearm filter rendered 8 incidents, a 0.7-per-30-day selected-window average, and an 8 / 100% category row in both languages.
- Manual A/B QA rendered stable averages of 0.7 and 1.1, with no `-100%`, old 30-day-change copy, horizontal overflow, console warning, or console error.
- The temporary 4174 preview was stopped and released; the separately owned port 5173 process was not changed.
