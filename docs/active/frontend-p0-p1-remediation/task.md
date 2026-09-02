# Task

## Current status

Local release candidate complete on `codex/ui-p0-p1-release`: the reviewed P0/P1 packages and copy refresh are reconciled, runtime and browser regressions are repaired, final Win32 baselines are visually accepted, and the complete release plus coverage gates pass. Ubuntu baselines, remote CI, merge, and exact-SHA Pages verification remain pending.

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
| Final integrated `npm run ci:release` | PASS; lint, full core validation, production build, bundle policy, five browser suites, and visual experience all exited successfully. |
| Bundle policy | PASS without threshold changes; Route corridor UI `23,999/24,000`, Home Compare styles `4,762/4,800`, dist `4,168,005` bytes and `3,986,046` bytes excluding the separately admitted ACS VRE artifact. |
| Browser smoke | PASS; console errors `0`, page errors `0`, held restore point requests `1`, retry/cancel/migration flows green. |
| Visual experience | PASS; `36` executed checks across desktop/portrait/landscape, `12` configured skips, plus `66` platform-specific baselines. |
| `npm run coverage:report` | PASS; `76/76` focused coverage tests passed and the report was generated. |
| Accessibility/layout | PASS; no critical or serious automated findings; 360/390/768/1440 overflow check and 200% reflow/focus check green. |
| In-app visual review | PASS with limitations recorded; 390 List/half-sheet gap measured at 12px with zero document overflow, and EN/ZH Crime/Diary surfaces inspected. |
| Post-review focused contracts | PASS; 86/86 List ownership, focus, shell hierarchy, and state contracts. |
| Post-review touch workflow | PASS; 7 executed / 2 designed skips across direct Crime/Diary routes plus real 390px List half/full/collapsed transitions. |

## Open risks and remaining work

- The reconciled local candidate is ready for remote review; the P0/P1 DOM structure remains authoritative and copy boundaries were retained in compact disclosures.
- Linux visual baselines have not been updated locally. Exact Ubuntu CI captures are required before merge; Windows images cannot substitute for them.
- No remote CI, Pages, deployment, or production-serving claim exists.
- Visual review used current local deterministic fixtures and live local preview; it does not certify assistive-technology behavior on physical devices.
