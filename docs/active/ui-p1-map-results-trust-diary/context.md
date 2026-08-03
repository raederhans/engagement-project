# Context

## Current truth

- Primary checkout: `C:/Users/raede/Desktop/dev/engagement_project`, branch `codex/bilingual-localization@65ac92f`, pushed to the matching remote branch; only an unrelated user-owned `.gitignore` remains dirty.
- Isolated P1 checkout: `C:/Users/raede/Desktop/dev/engagement_project-p1-ui`, branch `codex/p1-ui@b4168d6`, matching its remote after PR #42 merged the complete bilingual layer; Draft PR #41 targets `main`.
- P0 UI is merged and publicly verified. Its shell, responsive sheet, mode ownership, progressive details, and staged Diary rating are protected behavior.
- Product-integrity P1 features already present include A/B comparison, share/restore, export, data-source infrastructure, IndexedDB My Routes, and Sample Community read-only semantics.
- P1-1 through P1-4 and the bilingual UI are integrated on one review head. The remaining work is exact-head CI, main merge, Pages deployment, public verification, and task-record archival.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-03 | The primary checkout contains uncommitted localization work across nearly every P1 hotspot. | P1 implementation is isolated in a separate worktree and will rebase after localization is committed. |
| 2026-08-03 | The user requested P1-1 through P1-4 in order. | Stages are sequential; each stage gets failing tests and targeted verification before the next begins. |
| 2026-08-03 | Existing Vite, MapLibre, public API, and browser-local persistence contracts are already verified. | No framework, dependency, backend, or major map-runtime change is permitted. |
| 2026-08-03 | P1-1 through P1-4 reached targeted green in sequence. | The remaining work is combined-diff validation, browser evidence, independent review, and Git integration only. |
| 2026-08-03 | Full validation, browser matrix, final browser smoke, dependency audit, bundle policy, and three independent reviews passed. | The isolated P1 delivery is ready for a stable review commit and Draft PR. |
| 2026-08-03 | The localization branch is committed and pushed but predates P1 strings. | P1 must be handed to the localization owner for catalog reconciliation before merge or Pages deployment. |
| 2026-08-03 | Runtime commit `966ffaa` was pushed and Draft PR `#41` opened. | The delivery is reviewable but intentionally not mergeable as a completed product until Stage 6. |
| 2026-08-03 | PR #42 passed two independent reviews and exact-head CI, then merged by ordinary merge commit `b4168d6`. | P1 behavior and complete English/Chinese copy now share one history without rebase or force-push. |
| 2026-08-03 | The combined P1 head passed feature-enabled full validation, browser smoke, bundle policy, and dependency audit. | PR #41 can advance after its exact-head GitHub `validate` succeeds. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Baseline full validation (`VITE_FEATURE_DIARY=1 npm run validate`) | root agent | `p1-baseline-validate.log.tmp` | complete; data checks, tests, build, and bundle policy passed |
| P1-1 browser smoke | root agent | task-owned Playwright session | complete; Crime selection gating and mobile camera fit passed |
| Combined post-change browser smoke | root agent | task-owned `engagement-p1-matrix` session | complete; desktop, mobile portrait, and mobile landscape passed with zero browser errors/warnings |
| Final production browser smoke | root agent | `npm run test:browser-smoke` on port 4173 | complete; all assertions passed with zero console/page errors; server stopped |
| Vite production preview | root agent | port 4173 | complete and stopped; port verified free |

Shared validation resources are limited to this worktree's `node_modules/`, `dist/`, and ignored `*.tmp` logs. Read-only agents must not start, monitor, retry, or stop these processes.

## Handoff

- Root agent owns all edits, index/refs, commits, integration, push, and deployment.
- Read-only review agents may inspect `C:/Users/raede/Desktop/dev/engagement_project-p1-ui` but must not edit files or change Git state.
- The localization WIP in the primary checkout is outside this task and must remain untouched.

## Next step

Wait for PR #41 exact-head CI on `b4168d6`, update the final integration record, then merge to `main` and verify main CI, Pages, and the public bilingual Crime/Diary experience.
