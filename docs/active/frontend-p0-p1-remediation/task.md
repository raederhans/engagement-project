# Task

## Current status

Review remediation complete on the UI branch: all three delivery packages are integrated, independent review findings are repaired, and the post-review focused contracts plus real 390px touch workflow pass. Final copy reconciliation, full merged release gate, Ubuntu baselines, remote CI, merge, and Pages verification remain pending.

## Checklist

- [x] Create P0 Crime task and record its thread/worktree.
- [x] Create P0 Diary task and record its thread/worktree.
- [x] Create P1 Shell task and record its thread/worktree.
- [x] Inspect all delivery packages and changed-path intersections.
- [x] Integrate P0 Crime and run focused checks.
- [x] Integrate P0 Diary and run focused checks.
- [x] Integrate P1 Shell and run focused checks.
- [x] Run full validation and release-equivalent checks.
- [x] Run current-build browser and visual review with accepted screenshots.
- [x] Update records and leave exact Git/worktree state.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git worktree add -b codex/ui-p0-p1-integration ... fb64b3e` | PASS; clean isolated integration baseline created. |
| P0 Crime focused contracts | PASS; 3/3 list truth, failure settlement, and retry contracts. |
| P0 Diary focused contracts | PASS; 49/49 time-zone, palette, loader retry, and language-label contracts. |
| P1 shell/accessibility/i18n/chart contracts | PASS; 82/82 shell ownership, hidden/inert, localization, and structured chart-data contracts. |
| Final `npm run ci:release` | PASS; lint, full core validation, production build, bundle policy, browser suites, and visual experience all exited successfully. |
| Bundle policy | PASS without threshold changes; dist `4,166,386` bytes and `3,984,427` bytes excluding the separately admitted ACS VRE artifact. |
| Browser smoke | PASS; console errors `0`, page errors `0`, held restore point requests `1`, retry/cancel/migration flows green. |
| Visual experience | PASS; `35` executed checks across desktop/portrait/landscape, `10` configured skips, plus `66` platform-specific baselines. |
| Accessibility/layout | PASS; no critical or serious automated findings; 360/390/768/1440 overflow check and 200% reflow/focus check green. |
| In-app visual review | PASS with limitations recorded; 390 List/half-sheet gap measured at 12px with zero document overflow, and EN/ZH Crime/Diary surfaces inspected. |
| Post-review focused contracts | PASS; 86/86 List ownership, focus, shell hierarchy, and state contracts. |
| Post-review touch workflow | PASS; 7 executed / 2 designed skips across direct Crime/Diary routes plus real 390px List half/full/collapsed transitions. |

## Open risks and remaining work

- The copy-refresh work is now committed separately and must be reconciled semantically; the P0/P1 DOM structure is authoritative while plain-language values are transplanted without weakening product boundaries.
- Linux visual baselines have not been updated locally. Exact Ubuntu CI captures are required before merge; Windows images cannot substitute for them.
- No remote CI, Pages, deployment, or production-serving claim exists.
- Visual review used current local deterministic fixtures and live local preview; it does not certify assistive-technology behavior on physical devices.
