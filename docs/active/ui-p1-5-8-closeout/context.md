# Context

## Starting state

- Worktree: `C:/Users/raede/Desktop/dev/engagement_project-p1-5-8`.
- Branch: `codex/p1-5-8-accessibility-design-ci`, created from clean `origin/main@784b812`.
- P1-1 through P1-4 were already merged and deployed. The original report's P1-5 through P1-8 were not represented in the archived implementation plan and were therefore not completed as one verified scope.
- The primary worktree contains user-owned `.gitignore` changes and is not an edit surface for this task.
- The QoL worktree `C:/Users/raede/Desktop/dev/engagement_project-p1-ui` is on `codex/chart-drawer-sizing@784b812` with uncommitted changes in `index.html`, `src/style.css`, `scripts/tests/browser_smoke.mjs`, and `scripts/tests/ui_shell_contracts.mjs`. Those files are red-overlap integration hotspots and must not be overwritten.

## Initial evidence

- `src/style.css` contains three `:root` blocks, two product font stacks, and many late `!important` overrides.
- `index.html` still contains a large inline style block and extensive element-level inline styles.
- Visible Crime copy still uses “Buffer”, although map-picking copy is already consistently “Pick on map”.
- The incident-density banner is informational only and has no Zoom in action.
- The existing browser smoke covers substantial behavior, but it does not maintain screenshot baselines or run an axe accessibility scan.
- Reduced-motion CSS and camera checks exist, so P1-5 is partial rather than entirely absent.

## Ownership

- Root agent is implementation and integration owner for P1-5 through P1-8.
- Parallel audit agents are read-only and may not edit files, start live processes, or change Git state.
- The separate QoL conversation owns its uncommitted worktree files until integration review.

## Live-process contract

- No live server or browser owner is active yet.
- Before starting Vite preview, Playwright, axe, screenshot generation, or long validation, record the single owner, port, output directories, and stop condition here under `$orchestrate-live-tests`.

## Next step

Finish the evidence audit, classify each P1-5 through P1-8 requirement as complete, partial, or missing, then add failing contracts before editing production UI.
