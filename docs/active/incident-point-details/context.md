# Context and handoff

## Verified baseline

- The primary worktree contains user-owned `.gitignore` and `.playwright-mcp/` changes and is not used for this implementation.
- The P1-5-8 worktree contains overlapping uncommitted changes in point, route, panel, style, and test files and must remain untouched.
- This isolated worktree starts from the clean chart-studio head `a1eea91`.
- Port 5173 belongs to the P1 UI worktree and must not be restarted or reused for validation.

## Root-cause evidence

- `src/map/points.js` already configures clustering with `clusterMaxZoom: 14` and creates an `unclustered` circle layer.
- `src/map/wire_points.js` only attaches cluster expansion; it has no single-incident click or hover interaction.
- `src/api/crime.js` and `src/utils/sql.js` load point properties within the current map bounding box, not within the analysis buffer.
- `src/ui/panel.js` explicitly hides `#clearSelBtn` in buffer mode and its handler only clears district/tract identifiers.
- `src/routes_crime/index.js#syncComparisonOverlays` creates A/B markers and buffers but only removes them when leaving buffer mode, not when a center becomes null.

## Safety boundaries

- Keep the query viewport-bounded to prevent accidental citywide point loading.
- Escape all incident property text before inserting popup HTML.
- Clear dependent comparison point B when point A is removed so the state cannot retain an orphan comparison.
- Use a new isolated validation port and preserve the existing 5173 process.

## Live validation ownership

- Owner: root agent only.
- Working directory: `C:/Users/raede/Desktop/dev/engagement_project-incident-details`.
- Full gate: `$env:VITE_FEATURE_DIARY='1'; $env:VITE_TRACT_CRIME_SNAPSHOT='1'; npm run validate`.
- Browser gate: same feature flags, then `npm run test:browser-smoke`; its Vite preview owns strict port 4173 only for the command lifetime.
- Audit gate: `npm audit --audit-level=high`.
- Shared outputs: this worktree's `dist/`, npm cache, and Vite cache; commands run serially.
- Logs: `C:/Users/raede/AppData/Local/Temp/engagement-incident-details-20260803/` (task-scoped; safe to expire after 2026-08-10).
- Success: exit code 0 with no browser page/console errors; failure: any nonzero exit, port conflict, or unexpected shared-process ownership.
- Stop condition: do not retry the same failure more than three times; diagnose before any retry.

## Delivery evidence

- Product commit: `5c853aae5b738045fdcf3edb24c6ac7dfb0674ce`.
- Stacked Draft PR: [#51](https://github.com/raederhans/engagement-project/pull/51), based on `codex/chart-studio` / PR #50.
- Focused tests passed: point lifecycle 17/17, i18n 9/9, and Crime UI P0 contracts 54/54.
- Flagged full validation, bundle policy, browser smoke, and dependency audit all passed.
- Manual browser QA expanded a real cluster, opened a real incident popup, switched it live between English and Chinese, and removed the placed map point.
- After removal, both addresses and centers were empty, markers and popups were absent, URL keys `a` and `b` were removed, and the empty analysis prompt returned.
- Ports 4173 and 4174 were released after validation; the separately owned port 5173 process was not changed.
