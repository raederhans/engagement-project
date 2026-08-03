# Context

## Starting state

- Worktree: `C:/Users/raede/Desktop/dev/engagement_project-p1-5-8`.
- Branch: `codex/p1-5-8-accessibility-design-ci`, created from clean `origin/main@784b812`.
- P1-1 through P1-4 were already merged and deployed. The original report's P1-5 through P1-8 were not represented in the archived implementation plan and were therefore not completed as one verified scope.
- The primary worktree contains user-owned `.gitignore` changes and is not an edit surface for this task.
- The QoL worktree `C:/Users/raede/Desktop/dev/engagement_project-p1-ui` remains independently owned at `codex/comparison-detail-menu@20eda9b`. The chart-studio worktree is separately owned at `codex/chart-studio@a1eea91`; incident details is separately owned at `codex/incident-point-details@8f78a61`. All three are clean, remain outside this delivery, and must not be reset, copied, or rewritten.

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

- Owner: root agent only. No child agent may start, poll, retry, or stop the build, preview, or browser sessions.
- Working directory: `C:/Users/raede/Desktop/dev/engagement_project-p1-5-8`.
- Commands run serially: feature-enabled `npm run validate`, `npm run test:browser-smoke`, then `npm run test:visual-experience`.
- Shared resources: `dist/`, Vite preview ports 4173 and 4178, Chromium, `playwright-report/`, and `test-results/visual-experience/`.
- Stable diagnostics: console output plus `playwright-report/` and `test-results/` on failure. Generated logs and reports are task-owned and removed after evidence capture when tests pass.
- Success: validation, dependency audit, legacy browser smoke, and all deterministic desktop/portrait/landscape experience checks pass with no unexpected console/page errors.
- Failure: any non-zero command, port conflict, critical/serious accessibility finding, hidden primary CTA, horizontal overflow, focus obstruction, or unexpected Crime API call on direct Diary load.
- Stop: all serial checks finish or the same failure repeats three times under one hypothesis; preview processes must be stopped before Git integration.

## Verified local state

- P1-5: representative Crime, Help/Data, Diary, My Routes, and rating-modal states have zero Axe `critical` or `serious` findings; keyboard Crime analysis and Diary rating flows pass; focus, 200% scaling, live regions, reduced motion, and marker semantics are covered.
- P1-6: one token/font layer owns product styling; product HTML/JS has no static inline style attributes, and product CSS has no `!important` or `system-ui` fallback.
- P1-7: task-language copy, actionable density feedback, fixed mobile actions, safe-area handling, and 44px touch targets are implemented and tested.
- P1-8: 60 platform-specific screenshot baselines cover ten states across desktop, portrait, and landscape on Windows and Linux. Each platform's deterministic Playwright matrix passes 24 tests with six intentional compact-project skips. The normal visual command always rebuilds first, so it cannot silently preview stale output.
- Full `VITE_FEATURE_DIARY=1` and `VITE_TRACT_CRIME_SNAPSHOT=1` validation, bundle policy, dependency audit, browser smoke, Windows visual comparison, Linux visual comparison, and `git diff --check` pass. The final browser smoke reports zero console and page errors.
- Final code, design/accessibility, and first-principles architecture reviews returned `APPROVE`; architecture status is `CLEAR`.
- Task-owned `logs/`, `playwright-report/`, `test-results/`, and obsolete non-platform screenshot baselines were removed. Only the 60 platform baselines remain in the delivery set.

## Next step

Create the Lore implementation commit, then run the exact-head PR, main CI, Pages, and production verification gates.
