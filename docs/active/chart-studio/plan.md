# Plan

## Goal

Turn the right-side Crime charts into a bilingual chart studio that offers a few meaningful view choices and states the main conclusion in plain language.

## Scope

- Keep the existing three data sources and Chart.js dependency.
- Add compact controls for chart type, value method, category count, heat classification, palette, and labels where they materially change interpretation.
- Improve the time comparison, offense composition, and day/hour analysis without new requests or schema changes.
- Preserve the current progressive disclosure, mobile layout, localization rerender, and historical-data caveats.

## Sources of truth

- `src/charts/index.js` for chart data loading, cache, and rerender behavior.
- `src/charts/line_monthly.js`, `bar_topn.js`, and `heat_7x24.js` for current renderers.
- `src/i18n/crime_charts.js` and `src/i18n/messages.js` for bilingual product copy.
- `index.html`, `src/style.css`, and current UI/i18n contracts for the right drawer.

## Chart contract

- Visual thesis: a calm analytical drawer with compact segmented controls, restrained blue/teal color, direct labels, and one readable insight per chart.
- Content plan: shared display settings, then three chart sections; each section has a title, short purpose, view selector, visual, and generated insight.
- Interaction thesis: controls change only cached chart presentation, never refetch data; buttons remain keyboard accessible, responsive, and truthful in both languages.

## Product decisions

- Time trend defaults to indexed comparison so citywide and selected-area shapes share a fair baseline; raw counts remain available as an explicit choice.
- Offense composition defaults to sorted ranking and offers count, share, and Pareto views; a pie chart is rejected because long labels and many categories are harder to compare.
- Day/hour defaults to a true rectangular heat grid and also offers weekday and hour summaries for faster conclusions.
- Heat values support continuous, quantile, and equal-interval classification; classification is scoped to the temporal chart rather than exposed as a misleading global control.
- Shared controls are limited to palette and direct labels. No developer-only debug switches, smoothing that changes the data, or unsupported safety scores.

## Stages

- [x] Stage 1: Audit branch/worktree/process ownership and isolate the task on `codex/chart-studio`.
- [x] Stage 2: Define the chart contract, acceptance criteria, and external design evidence.
- [x] Stage 3: Add and observe focused failing chart-model and control contracts.
- [x] Stage 4: Implement the minimal chart studio, bilingual copy, and responsive styling.
- [x] Stage 5: Run focused/full validation, bundle policy, browser smoke, bilingual QA, audit, and review.
- [ ] Stage 6: Create a scoped Lore commit and push/update the stacked delivery without merging or deploying unrelated branches.

## Acceptance criteria

- A user can switch each chart among the documented views with real buttons and without any new network request.
- Indexed time comparison makes citywide and selected-area trends readable on one scale; raw counts are still available and clearly labeled.
- Offense categories are sorted and can be read as counts, shares, or a Pareto-style cumulative view.
- Day/hour data can be read as a heat grid, weekday summary, or hour summary, with a clear peak-period insight.
- Palette, heat classification, category count, and data-label controls behave consistently and survive language rerender.
- Empty, all-zero, and single-value inputs do not produce invalid scales or invented conclusions.
- English and Chinese controls, tooltips, subtitles, insights, and accessibility names are complete.
- Desktop and mobile drawers have no horizontal overflow, runaway canvas height, console error, or warning.

## Non-goals

- New crime queries, prediction, risk scoring, statistical significance, geographic classification changes, or data schema changes.
- New chart dependencies, MapLibre changes, bundle-budget increases, or changes to PR #49 behavior.
- Merging or deploying P1-5-8, PR #49, or this branch.

## Risks and constraints

- The primary and P1-5-8 worktrees contain unrelated user WIP and must remain untouched.
- P1-5-8 changes some of the same chart/style/test surfaces; later integration needs an explicit owner and semantic conflict review.
- Port 5173 is owned by the existing PR #49 preview and will not be replaced until live-test ownership is explicitly transferred.
