# Task

## Current status

Implementation, review, and local validation are complete. The scoped commit and stacked remote delivery remain.

## Checklist

- [x] Audit worktrees, branches, current chart implementation, and port ownership.
- [x] Define a minimal visual, content, and interaction contract.
- [x] Review mature official patterns for serial charts, temporal heat charts, small multiples, and Chart.js interaction.
- [x] Add and observe failing model/control/i18n tests.
- [x] Implement chart transformations, controls, insights, localization, and styling.
- [x] Run focused tests and full flagged validation.
- [x] Run bundle policy, browser smoke, bilingual desktop/mobile QA, and dependency audit.
- [ ] Complete the scoped Lore commit and push.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Worktree audit | New work is isolated at `engagement_project-chart-studio`; primary `.gitignore`, P1-5-8 WIP, and PR #49 worktree remain untouched. |
| Dependency audit | Existing Chart.js 4.5.1 covers the planned line, mixed, bar, scatter, tooltip, and interaction behavior; no package addition is required. |
| Current renderer audit | Monthly raw counts share one scale, offense bars lack alternative value views, and day/hour uses fixed-radius scatter points as a pseudo heatmap. |
| External pattern review | ArcGIS serial/heat/data-clock patterns, Power BI scale/small-multiple guidance, and Chart.js mixed/interaction contracts support the selected direction. |
| TDD RED | Model, control markup, preference store, lazy i18n, long-label, partial-month, and Pareto-axis contracts failed for the expected missing behavior. |
| Focused GREEN | `npm run test:chart-studio` passed 9/9; combined chart/i18n/UI/async/product contracts passed 92/92 before the final refinements. |
| Flagged full validation | `VITE_FEATURE_DIARY=1 VITE_TRACT_CRIME_SNAPSHOT=1 npm run validate` exited 0, including data checks, all tests, manifest build, and bundle policy. |
| Bundle policy | PASS — Entry 875843/235044; Crime 33663/11794; Charts 222660/75825; dist 3995809 bytes. |
| Automated browser smoke | PASS — 0 console errors and 0 page errors. |
| Local browser QA | English/Chinese controls and insights, indexed/count, count/share/Pareto, heat/weekday/hour, palette, classification, desktop/mobile overflow, and fixed canvas heights passed; runtime logs had 0 warnings/errors. |
| Dependency audit | `npm audit --audit-level=high` found 0 vulnerabilities. |
| Final review | Removed misleading partial-current-month trend conclusions, corrected Pareto to the top x axis, wrapped long category labels, and retained the no-refetch/cache contract. |

## Open risks and remaining work

- This branch is stacked on PR #49 and should not merge independently before its base is resolved.
- P1-5-8 has uncommitted overlapping chart/style/test work; no cross-worktree changes or automatic conflict resolution are authorized.
- The implementation intentionally keeps chart preferences in the current page session rather than adding persistence or URL schema.
