# Task

## Current status

The accepted P0 baseline is synchronized at `origin/main@f956ab2`. The localization runtime, app-bar switch, static and dynamic UI coverage, MapLibre controls, error/status copy, and bilingual README are implemented and verified.

## Checklist

- [x] Inventory static HTML, dynamic JavaScript, Help/About, secondary panels, errors, status, and documentation copy.
- [x] Define and observe failing locale runtime and language-switch tests.
- [x] Implement the localization catalog/runtime and app-bar language switch.
- [x] Localize the shell, Crime, Diary, secondary menus, map, validation, status, and errors.
- [x] Add Chinese project documentation and correct README drift.
- [x] Run focused tests and localized-surface coverage audit.
- [x] Run full validation and live preview smoke in both languages.
- [x] Complete review, bug check, and first-principles simplification review.

## Validation evidence

| Command or check | Result |
| --- | --- |
| Initial Git/worktree check | Dirty `codex/ui-p0-redesign` worktree confirmed; existing edits are protected and remain unstaged. |
| Initial preview | `http://127.0.0.1:5173/?mode=diary` returned HTTP 200 before localization changes. |
| P0/main reconciliation | Current WIP moved without stash or reset onto `codex/bilingual-localization`; HEAD and `origin/main` are both `f956ab2`, with no localization-path overlap in the three incoming P0/archive commits. |
| Current i18n gate | `npm run test:i18n`: 5/5 passed, including catalog parity, persistence, accessible switch, 120+ used keys, and all enumerated visible surfaces wired to i18n. |
| Focused P0 UI regression | `npm run test:ui-p0`: 36/36 passed. |
| Analysis History regression | `npm run test:analysis-history`: 20/20 passed. |
| Product integrity regression | `npm run test:product-integrity`: 46/46 passed. |
| Final repository gate | `npm run validate`: 16 groups, 257/257 passed; build and bundle policy passed. |
| Bundle policy | Default entry 901,317/902,665 bytes; feature-enabled browser build entry 901,525/902,665 bytes; History and History translations stayed within their existing/new focused budgets. |
| Bilingual browser check | Crime, Diary, My routes, persisted reload, MapLibre controls, and marker labels checked in English and Simplified Chinese; 0 console errors and 0 warnings. |
| Full browser smoke | PASS with Diary/tract feature flags; consoleErrors=0 and pageErrors=0, including lazy history, cancellation/failure, freshness, and IndexedDB migration paths. |
| Static review | `git diff --check` passed; visible-copy audit found only data values, identifiers, glyphs, or localized call sites. |

## Open risks and remaining work

- Vite still emits its pre-existing large-entry advisory, but the enforced raw/gzip bundle budgets pass.
- Raw third-party/API diagnostic details remain untranslated when shown after a localized summary; stable application-owned errors are localized.
- Unrelated `.gitignore` WIP remains intentionally unstaged.
