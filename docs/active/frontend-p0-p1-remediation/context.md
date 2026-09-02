# Context

## Current truth

- The primary checkout and `phase1-main` contain protected unrelated WIP.
- This task uses `C:/Users/raede/.codex/worktrees/ui-p0-p1-integration/engagement_project` on `codex/ui-p0-p1-integration`, based on exact `main@fb64b3e`.
- Three user-visible Codex tasks will own disjoint implementation packages; they may run only short focused tests and must not commit, integrate, push, clean, or start shared servers/browser/visual runs.
- `/root` is the sole Git integration and long/live-test owner.
- P0 Crime: task `01a05fda-9c4a-75b2-b5dc-29c29aada7c7`, worktree `C:/Users/raede/.codex/worktrees/5800/engagement_project`.
- P0 Diary: task `01a05fda-9c6c-7402-a46d-6efdf2983d40`, worktree `C:/Users/raede/.codex/worktrees/bd92/engagement_project`.
- P1 Shell: task `01a05fda-9cf5-7db2-af07-666a39d733da`, worktree `C:/Users/raede/.codex/worktrees/306e/engagement_project`.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-09-02 | User explicitly requested parallel Codex conversations to execute P0 and P1, followed by real tests and visual review. | Created an isolated integration branch and split work by production-file ownership. |
| 2026-09-02 | `phase1-main` has uncommitted copy-refresh edits including `index.html` and i18n files. | Do not integrate into or mutate that worktree; produce a separate reviewable local branch. |
| 2026-09-02 | The existing dist budget had only 943 bytes of baseline slack. | Compact generated demo GeoJSON artifacts losslessly; keep every existing bundle threshold unchanged. |
| 2026-09-02 | The 390px browser flow showed the new List workspace covering the half-height query sheet. | Reserve space for collapsed, half, and full sheet states and lock the behavior with a focused contract. |
| 2026-09-02 | Structured chart equivalents introduced duplicate visible-text matches in older visual tests, while List intentionally hides map-only detail panes. | Scope selectors to visible insight headings and make browser/keyboard tests explicitly switch Map/List through the real controls. |
| 2026-09-02 | Independent diff review found the List workspace nested under the mobile Sheet, stale async ownership after lazy loading, fallback focus to the hidden map summary, duplicate accessible data equivalents, and missing Linux baselines. | Move List to an AppShell sibling workspace, recheck ownership after every async boundary, focus the List heading, make only the active data equivalent available, and obtain Linux baselines from exact Ubuntu CI. |
| 2026-09-02 | The post-review 390px touch test showed that List CSS hid the Sheet handle and its high-specificity `height: auto` defeated collapsed/half/full states. | Keep the handle available below 901px and give each List Sheet state an explicit height at matching specificity. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Full validate/build/browser/visual runs | `/root` | `%TEMP%/engagement-ui-p0p1-ci-release-green/{ci-release.stdout.log,ci-release.stderr.log}` | complete; release gate exited successfully |
| Baseline local preview on `127.0.0.1:5187` and in-app Browser capture | `/root` | `%TEMP%/engagement-ui-p0-p1-baseline-5187.{stdout,stderr}.log`; screenshots under the current visualization root | stopped; desktop/mobile List baselines captured, port released; dev CSS prevented full Map/Diary baseline, so final comparison will use a built preview |
| Post-integration local preview and in-app Browser visual review | `/root` | `%TEMP%/engagement-ui-p0p1-preview/{preview.stdout.log,preview.stderr.log}`; screenshots under the current visualization root | complete; port 4190 released and viewport override reset |

## Handoff

- P0 Crime owns List truth, List failure settlement, stable geocoder errors, related i18n, and focused tests.
- P0 Diary owns Philadelphia bucketing, neutral palette, retryable Diary/insights loading, language-updating Community labels, and focused tests.
- P1 Shell owns `index.html`, `panel.js`, shell/workbench/list/responsive CSS, accessible chart equivalents/landmarks, and focused shell/browser contracts.

## Next step

Commit the reviewed branch, reconcile it with the copy-refresh commit in a clean integration branch, then run the full local release gate and exact Ubuntu/Windows remote checks. No push, merge, Pages, or production deployment has yet been performed.
