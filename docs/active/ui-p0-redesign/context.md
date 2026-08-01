# Context

## Current truth

- Repository: raederhans/engagement-project.
- Working branch: codex/ui-p0-redesign.
- Base: main and origin/main at 6272bd663842a4625f9750f64f91a342fb2a5fb4.
- One local worktree exists.
- The 2026-08-01 design audit scored the current UI D and found 10 issues; this task owns only the seven P0 implementation themes in plan.md.
- The older p0-p1-product-integrity program completed functional mobile, mode, data, and local Diary integrity. This task improves the rendered hierarchy and interaction model without reopening those product contracts.
- Current HTML keeps the side panel, compare card, charts, legend, and many inline styles in index.html.
- Current mobile CSS turns fixed result surfaces into static content inside a nearly full-height side panel, which preserves operability but hides the map.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-01 | Use a calm civic map workbench rather than a dashboard-card redesign. | Map remains the primary visual anchor and cards are limited to real interactive objects. |
| 2026-08-01 | Keep vanilla JavaScript, Vite, MapLibre 4, and current lazy module boundaries. | No dependency or framework migration is required. |
| 2026-08-01 | Treat 44px desktop and 48px mobile as product usability targets, not WCAG AA minimum claims. | Accessibility tests remain explicit about WCAG 2.2 rules and project-specific targets. |
| 2026-08-01 | Implement P0 in red-green-refactor stages. | No production behavior change lands before its targeted test fails for the expected reason. |
| 2026-08-01 | Keep the analysis summary visible and place charts in a closed result drawer. | First-time users see the result before optional analytical detail; desktop keeps the map dominant and mobile reuses the sheet. |
| 2026-08-01 | Default Crime rendering uses incidents/clusters; district and tract fills become mutually exclusive task modes. | A single statistical encoding owns the map at a time. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Vite production preview: `npm run preview -- --host 127.0.0.1 --port 4173` in repository root | root | `C:\Users\raede\AppData\Local\Temp\engagement-ui-p0-preview-20260801.log` | Active during final review. Desktop and 390×844, 844×390, 360×640 Crime/Diary checks passed with 0 console errors/warnings. Root will stop the exact owned listener after review evidence is captured. |

## Handoff

- Root agent owns all edits, Git operations, live processes, integration, and deployment.
- Read-only agents map code ownership, refine the UI specification, and review test coverage.
- Do not modify or stage task-owned visual-tool residue if it reappears during browser work; remove it before commit.

## Next step

Create a P0-only commit that excludes the concurrent localization WIP, validate that commit from an isolated snapshot, then run the GitHub/Pages integration gate.
