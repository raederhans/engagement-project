# Task

## Status

P1-5 through P1-8 are locally implemented, fully verified, and independently approved. The branch is ready for its Lore implementation commit and GitHub integration.

## Checklist

- [x] Record a complete P1-5 through P1-8 coverage matrix.
- [x] Protect primary-worktree and QoL-worktree WIP.
- [x] Add failing accessibility and keyboard/focus contracts.
- [x] Add failing design-system and mobile-detail contracts.
- [x] Add failing deterministic screenshot and experience contracts.
- [x] Implement and verify P1-5.
- [x] Implement and verify P1-6.
- [x] Implement and verify P1-7.
- [x] Implement and verify P1-8.
- [x] Run targeted tests, full validation, audit, bundle checks, and diff review.
- [x] Run independent code, architecture, accessibility, and visual reviews.
- [x] Reconcile ownership with the parallel QoL worktree without losing its changes.
- [ ] Commit, push, create PR, verify CI, integrate, and verify Pages.
- [ ] Archive records only after external state matches evidence.

## Evidence log

| Check | Result |
| --- | --- |
| Branch baseline | Clean worktree created from `origin/main@784b812`. |
| Protected WIP | Primary `.gitignore` modification and QoL worktree's four modified files remain untouched. |
| P1-5 baseline | Partial: reduced-motion and some live regions exist; complete semantics, automated axe, zoom, focus-obscured, and non-map flow proof are missing. |
| P1-6 baseline | Missing as a completed scope: three `:root` blocks, two font systems, inline styles, and broad `!important` use remain. |
| P1-7 baseline | Partial: “Pick on map” and compact title exist; “Buffer”, passive density warning, small controls, and feedback hierarchy remain. |
| P1-8 baseline | Partial: one deterministic browser smoke covers behavior; stable screenshot baselines and the full viewport/state matrix are absent. |
| P1-5 final | Axe found one real Diary primary-button contrast failure; the shared green token was darkened, and the final Crime/Diary representative-state scan reports zero serious/critical findings. Keyboard, focus, 200% zoom, reduced motion, live-region, and marker contracts pass. |
| P1-6 final | Static UI styling moved to shared classes; product UI has no static inline style attributes, `!important`, or `system-ui` declarations. P1 static contracts pass 12/12. |
| P1-7 final | “Around a point” and “Pick on map” are canonical; density feedback exposes Zoom in; mobile primary actions, attribution, and Diary tags meet the 44px target. |
| P1-8 final | 60 deterministic PNG baselines cover ten states across three viewports on Windows and Linux; each platform passes 24 tests with six intentional compact-project skips. The standard visual command now performs a fresh production build before previewing, preventing stale-`dist` false regressions. |
| Full validation | Feature-enabled `npm run validate`, bundle policy, `npm audit --audit-level=high`, browser smoke, fresh-build Windows visual comparison, isolated Linux baseline comparison, and `git diff --check` pass. Entry remains within policy at 874,360 bytes / 234,725 deterministic gzip. Browser smoke reports zero console and page errors. |
| Independent review | Final code, design/accessibility, and first-principles architecture reviews all returned `APPROVE`; architecture status is `CLEAR`. |
| Protected parallel work | Primary `.gitignore` and `.playwright-mcp/` WIP remain unchanged. The clean comparison-detail-menu, chart-studio, and incident-point-details worktrees remain separately owned and untouched. |
| Delivery hygiene | Task-owned query logs, Playwright reports, test results, and 27 obsolete non-platform screenshot baselines were removed; only the 60 `win32`/`linux` baselines remain. |

## Open integration risks

- `src/compare/card.js`, `src/i18n/messages.js`, `src/style.css`, Crime tests, and the registry overlap separately owned UI branches. Their owners must rebase or merge semantically after P1 integration.
- CI and Pages still need exact-head verification before the task can move to `docs/archive/`.
