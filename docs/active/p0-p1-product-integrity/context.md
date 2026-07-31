# Context

## Starting state

- Repository: `raederhans/engagement-project`.
- Verified base: clean `main` and `origin/main` at `233851f`.
- Existing parallel worktree: `codex/stage3-data-pipeline` at the same base with protected uncommitted work.
- The stage3 WIP owns tract snapshot generation/validation, CI wiring, and a small panel provenance surface.
- Later P0/P1 work needs `package.json` and `src/ui/panel.js`, so stage3 must be completed and integrated first.

## Confirmed P0 evidence

- Diary success callback drops `response`, then reads the undefined variable.
- Crime uses competing time and spatial state models; Compare and Top-N do not inherit the full active filter snapshot.
- Drilldown codes do not reach all map/chart/SQL consumers.
- Default tract choropleth lacks matching crime data and can display missing values as zero.
- Mobile fixed panels overlap and Diary Insights can intercept the mode switch.

## Confirmed P1 evidence

- Address entry and A/B comparison are incomplete.
- URL state stores only the active mode.
- Diary My Routes and Community contain hard-coded/no-op behavior.
- Coverage failures are hidden and can appear as legitimate zero data.
- CI has no real-browser mobile or mode-transition gate.

## Ownership and safety

- Root agent is integration owner for this user-requested repair program.
- Existing stage3 changes are preserved; no file is reverted or discarded.
- Work proceeds serially across worktrees to avoid red-overlap edits.
- Long-lived server/browser resources will be registered before launch.

## Live validation contract — stage3

- Owner: root agent only.
- Command: `$env:VITE_FEATURE_DIARY='1'; $env:VITE_TRACT_CRIME_SNAPSHOT='1'; npm run validate`.
- Working directory: `C:/Users/raede/Desktop/dev/engagement_project-stage3`.
- Shared resources: this worktree's `dist/`, npm cache, and validation output.
- Log: `%TEMP%/engagement-stage3-validate.log`.
- Success: exit code 0; demo and tract data checks, all Node tests, production manifest build, and bundle policy pass.
- Failure: any non-zero exit; no blind retry without reading the first failing contract.
- Stop: command exit; no server or browser remains running.

## Live validation contract — final browser smoke

- Owner: root agent only; review agents may read completed logs but may not start or control the server/browser.
- Command: `npm run preview -- --host 127.0.0.1 --port 4173` from `C:/Users/raede/Desktop/dev/engagement_project`.
- Shared resources: port `4173`, `dist/`, Playwright session `engagement-p0-p1`, and `output/playwright/`.
- Log: `%TEMP%/engagement-p0-p1-preview.log`.
- Success: Crime A/B and shared state work, Diary local history/sample community work, mobile panels do not overlap, rapid mode switching settles on the latest intent, and browser console has no unexpected errors.
- Failure: any broken flow, stale mode, failed required resource, or unexpected console error; inspect once before retrying.
- Stop: close the Playwright session and terminate only the task-owned preview process after evidence capture.

## Next step

Run the single-owner production browser smoke, then obtain independent code and architecture review before integration.
