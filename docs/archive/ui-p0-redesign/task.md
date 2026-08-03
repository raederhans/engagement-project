# Task

## Status

Complete. The P0 task-first map shell, responsive layout, progressive Crime analysis, mode ownership, and staged Diary rating flow are merged, deployed, and verified on the public GitHub Pages site.

## Checklist

- [x] Record current DOM, CSS, mode, map-control, and rating ownership.
- [x] Add and observe failing shell and progressive-result contracts.
- [x] Implement and verify the global shell and design tokens.
- [x] Add and observe failing responsive bottom-sheet contracts.
- [x] Implement and verify portrait, landscape, and low-height layout behavior.
- [x] Add and observe failing Crime task-order and primary-layer contracts.
- [x] Implement and verify Crime progressive disclosure and map selection feedback.
- [x] Add and observe failing mode-specific loading, Help, URL, and status contracts.
- [x] Implement and verify Crime/Diary mode ownership.
- [x] Add and observe failing Diary rating-stepper contracts.
- [x] Implement and verify the staged rating flow.
- [x] Run full local validation and dependency audit.
- [x] Run deterministic browser acceptance at all required viewports.
- [x] Complete independent code, architecture, and design review.
- [x] Commit, publish, integrate, verify CI/Pages, and archive the task records.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Git baseline | main and origin/main at 6272bd6; branch codex/ui-p0-redesign created. |
| Design evidence | 10 findings, 12 referenced screenshots, and 12 executable P0/P1 audit cases passed independent review. |
| P0 behavior tests | Final P0 suite contains 36 contracts; the latest focused shell/rating run passed 20/20 after the final accessibility and overlap fixes. |
| Commit-isolated repository gate | A clean export of the exact staged index passed `VITE_FEATURE_DIARY=1 npm run validate`: demo and tract data checks, the full repository suite, all 36 P0 contracts, production build, and bundle policy. |
| Dependency audit | `npm audit --audit-level=high`: 0 vulnerabilities. |
| Production bundle | Entry `866791/232758`, Crime `29463/10434`, Diary `196841/59660`, Charts `207980/70766`, Diary Insights `10186/3187`, Analysis History `22396/7300`; bundle policy passed. |
| Responsive browser matrix | At 844x390 and 360x640, Crime and Diary kept map, shared handle, and primary CTA visible with zero horizontal overflow. |
| Crime mobile interaction | At 390x844, Pick on map committed the new URL/marker in 37 ms, kept map and controls visible, and opened 0 district popups. |
| Crime information order | Summary showed total, most common offense, recent change, selected time range, and data-through date; charts stayed closed by default. |
| Diary rating flow | Keyboard-only browser smoke selected 5 stars with ArrowRight, moved through Continue/Back/segment override without losing focus, and restored focus to the opener on Escape. |
| Final responsive review | At 360x640 and 844x390, the Diary tabs and route selector remain fully visible; the in-flow rating action no longer covers the current task. |
| Independent review | Final code review and final visual review both returned `APPROVE`; no P0 code or visual blockers remain. |
| Browser health | Final local Crime/Diary session reported 0 console errors and 0 warnings. |
| CI browser-smoke repair | Updated the existing smoke to use the rating radio name, staged Continue/Save flow, progressive data details, explicit More filters/Compare actions, and the compact summary contract. With `VITE_FEATURE_DIARY=1` and `VITE_TRACT_CRIME_SNAPSHOT=1`, the full smoke passed with 0 console errors and 0 page errors. |
| Pull request | PR `#39` merged as `8ac70018f905133792c4a673f33f8f1afcdec438`; only P0 runtime, tests, and task records were included. |
| Main CI | Run `30781936454` passed full validation and browser smoke in 1m7s. |
| Pages deployment | Run `30781936413` completed both build and deploy successfully. |
| Public assets | Root, `assets/index-CZK0rpXj.js`, `assets/index-D-zp2W0_.css`, and `assets/routes_crime-BLOdJ4c3.js` returned HTTP 200. |
| Public Crime | At 390×844 and 844×390, the map and half sheet coexisted with zero horizontal overflow; the public page reported 0 errors and 0 warnings. |
| Public Diary | Direct Diary loaded its demo route; the 390×844 staged flow kept `Save rating` fully visible and submitted successfully with 0 errors and 0 warnings. |

## Remaining follow-ups

- Existing inline HTML and style ownership can make broad visual changes hard to test; prefer extracting only clear shell responsibilities.
- Browser evidence must distinguish immediate visual feedback from external API completion.
- Visual-tool ignore/log residue is not part of this task and must not enter a commit.
- The bilingual-localization task remains a separate delivery and may continue from the merged P0 baseline.
