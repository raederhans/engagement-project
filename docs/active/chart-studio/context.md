# Context

## Current truth

- Implementation worktree: `C:/Users/raede/Desktop/dev/engagement_project-chart-studio`.
- Branch: `codex/chart-studio`, based on `codex/comparison-detail-menu@20eda9bf483fd6162956298495151f2fc313e405`.
- Existing preview: PR #49 is served from the separate `engagement_project-p1-ui` worktree on `127.0.0.1:5173`.
- The chart data cache already supports localization rerender without refetching.
- No additional package or backend endpoint is needed for the requested views.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-03 | Create a dedicated stacked worktree instead of editing P1-5-8 or PR #49 surfaces. | Preserves unrelated WIP and keeps chart changes reviewable. |
| 2026-08-03 | Prefer indexed time comparison over dual raw-count axes as the default. | Makes trend shape comparable without implying that two differently scaled axes are directly equal. |
| 2026-08-03 | Prefer ranked bars/Pareto over pie or donut charts for offense types. | Long labels and multiple categories remain directly comparable. |
| 2026-08-03 | Add heat, weekday, and hour views rather than only polishing the current scatter chart. | Users can inspect detail or obtain a quick aggregated conclusion from the same cached matrix. |
| 2026-08-03 | Limit shared settings to palette and labels; keep classification local to the heat chart. | Avoids a large, ambiguous developer control panel. |

## Live process ownership

| Process | Owner | Worktree | State |
| --- | --- | --- | --- |
| Vite `127.0.0.1:5173` | root | `engagement_project-p1-ui` | Existing PR #49 preview; do not replace before explicit live-test handoff. |
| Vite `127.0.0.1:5174` | root | `engagement_project-chart-studio` | Completed; exact Vite PID 64148 stopped after QA, port 5174 no longer listens, and the existing 5173 listener remains active. |

## Validation process contract

- Owner: root.
- Command: `$env:VITE_FEATURE_DIARY='1'; $env:VITE_TRACT_CRIME_SNAPSHOT='1'; npm run validate` in this worktree.
- Shared output: this worktree's `dist/` and Vite cache only; port 4173 is reserved later for the serial browser smoke.
- Log: `C:/Users/raede/AppData/Local/Temp/codex-engagement-chart-studio/validate.stdout.log`.
- Success: exit 0 with data checks, all tests, manifest build, and bundle policy passing.
- Failure/stop: stop after one product failure for diagnosis; do not repeat the same failing assumption three times.

## Handoff

Only this task directory, its registry row, right-drawer chart markup/styles, `src/charts/`, chart localization, and directly overlapping tests belong to this task. Do not stage `.gitignore`, Playwright artifacts, logs, P1-5-8 files, or unrelated worktree changes.

## Next step

Create the scoped Lore commit, push `codex/chart-studio`, and open or update a stacked PR without merging or deploying it.
