# Context

## Starting truth

- Repository: raederhans/engagement-project.
- Working branch: codex/ui-p0-redesign.
- Base: main and origin/main at 6272bd663842a4625f9750f64f91a342fb2a5fb4.
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
| Vite production preview: `npm run preview -- --host 127.0.0.1 --port 4173` in repository root | root | `C:\Users\raede\AppData\Local\Temp\engagement-ui-p0-preview-20260801.log` | Stopped after desktop, 390×844, 844×390, and 360×640 Crime/Diary checks passed with 0 console errors/warnings. |

## Final integration

- Runtime commit `4229d95f77d5a9baf353b2d70d122df4e961d1a5` and browser-smoke contract commit `d35ce35d296f07e3852f11d06d5e4034b77106a5` merged through pull request `#39`.
- Merge commit `8ac70018f905133792c4a673f33f8f1afcdec438` is the verified `origin/main` runtime state.
- Main CI run `30781936454` passed the full repository gate and browser smoke.
- Pages run `30781936413` built and deployed successfully.
- The public root, entry JavaScript, stylesheet, and Crime chunk returned HTTP 200.
- Public Crime at 390×844 and 844×390 retained map context with zero horizontal overflow; public Diary completed the staged rating flow with its save action visible at 390×844.
- Both public modes produced zero browser errors or warnings.

## Preserved boundary

The concurrent bilingual-localization work remained unstaged and was not included in pull request `#39` or this archive-only follow-up.
