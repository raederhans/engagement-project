# Context

## Current truth

- The global Help surface is created in `src/ui/about.js` and mounted from the app bar.
- Crime also contains a small inline `<details id="help-card">` quick-help list in `index.html`; it is not the full source/methodology surface.
- The repository already has bilingual Help strings and live source-status UI, but the global Help content is brief.
- The current worktree is `main` at `f4be752b`; unrelated `.gitignore` and `.playwright-mcp/` changes predate this task.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-04 | Use an editorial civic-research Help Center with in-panel navigation. | Supports dense methodology without turning Help into an unreadable modal card. |
| 2026-08-04 | Keep source/method claims grounded in current code and configuration. | No speculative freshness or completeness promises. |
| 2026-08-04 | RED test run failed on the four-section structure, Diary provenance, and substantial-panel contract; the same 17-test file passed after implementation. | Confirms the new tests exercised missing behavior before production changes. |
| 2026-08-04 | User preferred a centered panel over the initial side-panel direction. | Replaced the side-panel contract with a centered modal and moved the modal/backdrop to `document.body` so transformed app-bar ancestors cannot offset viewport positioning. |
| 2026-08-04 | Detailed Help content and its translation catalog are loaded only when Help first opens. | Preserves the existing entry bundle budget while keeping the full methodology available on demand. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| `npm run quick-preview -- --host 127.0.0.1 --port 5173 --no-open` | `/root` | `%TEMP%/engagement_project-preview-5173.stdout.log` and `.stderr.log` | Running; HTTP 200 verified before this task |
| Build and browser verification | `/root` | Terminal output; temporary screenshots removed after inspection | Complete; preview remains running on port 5173 |

## Handoff

No handoff. The primary agent owns implementation, live preview checks, and final verification.

## Next step

No implementation step remains. Keep the Help copy synchronized with any future data-source or calculation changes.
