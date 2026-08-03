# Plan

## Goal

Implement the approved P1-1 through P1-4 UI roadmap in order: make the Crime map calm and task-driven, connect map selections to current results, make data scope and freshness immediately understandable, and simplify Diary around route choice, trade-off, rating, and scoped insights.

## Scope

- P1-1: suppress unhelpful citywide incident noise, progressively reveal incidents after an intentional analysis selection, expand clusters, and fit selected geography with panel-aware camera padding.
- P1-2: put the current analysis summary before saved history and create deterministic map-to-result and result-to-map selection behavior.
- P1-3: expose concise source/date/persistence states for live, fallback, local, and sample data; remove simulated-live cues from Sample Community.
- P1-4: fit Diary routes to the usable map, remove repeated route content, make the alternative trade-off decision-first, scope Insights per tab, and make the simulator secondary by default.
- Extend existing behavior tests before production edits and keep the existing Vite/MapLibre architecture.

## Visual thesis

A calm civic map workspace: the basemap stays readable, one selected place or route dominates, and concise results read like a trusted place card rather than a dashboard mosaic.

## Content plan

1. Shared app bar: product mode and truthful data scope.
2. Crime: location task, quick filters, current summary, optional comparison, recent analyses, advanced details.
3. Diary: route choice, route trade-off, rating, scoped insights, secondary preview and filters.
4. Map: primary workspace with selection, fit, and progressive detail.

## Interaction thesis

- Selecting an area or saved analysis synchronizes the map camera and current result with panel-aware padding.
- Dense incident clusters reveal progressively and expand on activation instead of covering the city at first load.
- Sheets, drawers, simulator, and advanced details use short restrained disclosure transitions and honor reduced motion.

## Sources of truth

- `docs/archive/ui-p0-redesign/` for the verified P0 shell and responsive contracts.
- `docs/archive/p0-p1-product-integrity/` for current Crime/Diary data and persistence contracts.
- The 2026-08-01 rendered design audit and the 2026-08-03 post-P0 comparison report.
- `origin/main@f956ab2` as the isolated implementation base.
- `docs/active/_worktree_registry.md`, live Git state, and current browser behavior for integration truth.

## Stages

- [x] Stage 0: isolate the localization WIP, map current owners, add failing P1 contracts, and capture baseline evidence.
- [x] Stage 1: P1-1 Crime map decluttering, progressive incidents, cluster expansion, and camera fit.
- [x] Stage 2: P1-2 current-summary ordering and bidirectional map/result selection.
- [x] Stage 3: P1-3 live/fallback/local/sample status semantics and Sample Community truthfulness.
- [x] Stage 4: P1-4 Diary route focus, decision-first comparison, scoped Insights, and secondary simulator.
- [x] Stage 5: full repository validation, browser matrix, accessibility check, bundle audit, and independent reviews.
- [ ] Stage 6: merge the completed localization delivery without history rewriting, resolve user-visible-copy conflicts deliberately, integrate, deploy, and verify production.

## Acceptance criteria

- P1-1A: an unselected Crime entry does not render a citywide incident carpet or the `Too many points` banner.
- P1-1B: after a point, district, tract, or restored analysis is selected, the selected geometry is fitted inside the unobscured map area and incident detail is loaded only for the active analysis.
- P1-1C: activating a cluster expands it through the MapLibre cluster API; stale or inactive requests never mutate the map.
- P1-2A: current analysis summary precedes Recent analyses in visual order and accessibility order.
- P1-2B: selecting an area or history result gives the current result a selected state and fits/highlights the same object on the map within 300 ms of local state commitment.
- P1-3A: Live API, fallback, Diary local, and Sample Community each expose date/source/persistence scope without mixed labels.
- P1-3B: Sample Community contains no simulated relative recency or identity that can reasonably be mistaken for current shared-user activity.
- P1-4A: selecting a Diary route fits it around the active panel/sheet; routine rating remains the sole primary action.
- P1-4B: the alternative summary states benefit and cost in that order, Insights labels match the active tab, and Simulator is collapsed by default.
- Existing P0 responsive, data, URL, A/B, export, local Diary, bundle, CI, and Pages contracts remain green.
- Mobile portrait, mobile landscape, and desktop Crime/Diary smoke produce zero page errors and no unexpected console warnings.

## Non-goals

- No writable backend, accounts, shared community, moderation, cross-device sync, GPS recording, map matching, or arbitrary routing.
- No framework migration, new UI library, new dependency, external font, dark mode, or MapLibre major-version upgrade.
- No broad localization rewrite in this branch; user-visible strings are reconciled against the dedicated localization delivery during Stage 6.
- No additional charts or permanent dashboard panels.

## Risks and constraints

- The active `codex/bilingual-localization` worktree overlaps most UI files and must not be edited or staged by this task.
- Map camera padding differs across desktop drawer and mobile sheet states; behavior needs real browser evidence.
- Suppressing initial incidents must not break restored share URLs or saved analyses.
- Cluster activation and rapid mode changes can create stale async map mutations; tests must prove cancellation/ownership.
- Sample/fallback copy is a product truth contract, not cosmetic wording.
