# Context

## Current truth

- Integration owner: root agent.
- Target worktree: `C:/Users/raede/Desktop/dev/engagement_project-p2`.
- Target branch: `codex/p2-product-completion`, created clean from `origin/main@e32e3426c3db75d5429d07e678ca65c48b2d734c`.
- Primary worktree is intentionally untouched on `codex/bilingual-localization@65ac92f` with user-owned `.gitignore` and `.playwright-mcp/` changes.
- Relevant clean stacked branches: comparison `20eda9b`, charts `a1eea91`, incident details `8f78a61`, summary insights `aecec62`, custom radius `ffdf351`.
- PRs #49, #50, #51, #53, and #55 have successful exact-head CI but are based on the pre-P1 line and require semantic current-main integration.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-03 | Treat current `origin/main`, not the primary checkout, as the integration baseline. | Preserves user WIP and avoids replaying already integrated P1 work. |
| 2026-08-03 | Integrate the five stacked product deliveries before splitting shared CSS or adding more overlapping UI. | Avoids turning existing semantic conflicts into cross-file extraction conflicts. |
| 2026-08-03 | Preserve P1 behavior and visual contracts as admission gates for every P2 phase. | P2 cannot trade accessibility or truthfulness for new features. |
| 2026-08-03 | Keep the product backend-free through P2. | Diary remains local-only and all shared/community/GPS capabilities stay out of scope. |
| 2026-08-03 | Compact only the published boundary copies to six decimal places after each build. | Preserves readable source data and sub-meter fallback geometry while recovering about 720 KB of deployable budget instead of raising the 4 MB limit. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Current-main bundle admission | root agent | `C:/Users/raede/Desktop/dev/engagement_project-p2/p2-bundle.tmp` | Complete through Incident Details. `npm run build:manifest` and `npm run verify:bundle` passed; this worktree's `dist/` is 3,286,677 bytes. The same single-owner contract will be reused after later P2 layers. |

## Handoff

- Only the root agent may alter Git refs, index state, worktree topology, PRs, or deployment state.
- Read-only subagents may inspect integration conflicts, architecture, and verification coverage but must not edit files.
- Do not use or stop ports owned by other worktrees; register the P2 preview before starting it.

## Next step

Integrate the selected-window summary insights next and remove any obsolete short-window comparison requests.
