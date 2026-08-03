# Task

## Current status

The original bilingual delivery at `d383e30` has been reconciled with P1 `614e88c` through merge commit `541cb1d`, pushed without history rewriting, and opened as layered Draft PR #42. Local verification and GitHub `validate` are complete; review remains the external gate.

## Checklist

- [x] Inventory static HTML, dynamic JavaScript, Help/About, secondary panels, errors, status, and documentation copy.
- [x] Define and observe failing locale runtime and language-switch tests.
- [x] Implement the localization catalog/runtime and app-bar language switch.
- [x] Localize the shell, Crime, Diary, secondary menus, map, validation, status, and errors.
- [x] Add Chinese project documentation and correct README drift.
- [x] Run focused tests and localized-surface coverage audit.
- [x] Run full validation and live preview smoke in both languages.
- [x] Complete review, bug check, and first-principles simplification review.
- [x] Verify the current checkout, three remote handoff SHAs, worktree ownership, empty index, and protected `.gitignore` state.
- [x] Merge P1 without rewriting remote history and preserve all P1 behavior.
- [x] Localize all P1-added or changed visible copy and extend the corresponding tests.
- [x] Run feature-enabled full validation, browser smoke, bundle policy, localization audit, and diff/review checks.
- [x] Push and create or update the localization PR without merging PR #41 or deploying Pages.

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
| P1 integration preflight | Local and remote localization are `d383e30`; P1 is `614e88c`; main is `f956ab2`; both branches share `f956ab2`; index is empty; only user-owned `.gitignore` is dirty and its content hash still matches HEAD. |
| P1 merge and localization | Ordinary `--no-ff` merge resolved shared files without rebase or force-push; new data-scope/provenance, Insights, route-decision, Simulator, Sample Community, Summary, and History copy is catalog-backed in both locales. |
| P1 localization gate | `npm run test:i18n`: 6/6 passed, including P1 runtime language switching and mechanical coverage of every enumerated reader-visible surface. |
| Feature-enabled repository gate | `VITE_FEATURE_DIARY=1 VITE_TRACT_CRIME_SNAPSHOT=1 npm run validate`: 18 groups, 291/291 passed; demo and 408-tract snapshots validated; production build and bundle policy passed. |
| Final bundle policy | Entry 902,370/902,665; Diary 199,149/210,100; P1 translations 8,858/9,000; all raw/gzip limits passed; total `dist` 3,963,581/4,000,000 bytes. |
| P1 browser smoke | PASS against the feature-enabled production build; `consoleErrors=0`, `pageErrors=0`; restore, failure, freshness, and IndexedDB paths passed; 4173/5173 were free afterward. |
| Dependency audit | `npm audit --audit-level=high`: 0 vulnerabilities. |
| Final diff review | No conflict markers; `git diff --check` and staged diff checks passed; `.gitignore` remained unstaged. |
| Merge commit and remote | `541cb1d` has parents `d383e30` and `614e88c`; `origin/codex/bilingual-localization` advanced by ordinary fast-forward push. |
| Localization PR | Draft PR #42 targets `codex/p1-ui`; PR #41 remains Draft; no merge or Pages deployment was performed. |
| GitHub validation | PR #42 CI run `30793889757` passed dependency audit, full validation, Playwright installation, and browser smoke. |

## Open risks and remaining work

- Vite still emits its pre-existing large-entry advisory, but the enforced raw/gzip bundle budgets pass.
- Raw third-party/API diagnostic details remain untranslated when shown after a localized summary; stable application-owned errors are localized.
- Unrelated `.gitignore` WIP remains intentionally unstaged.
- Draft PR #42 still needs review; PR #41 remains Draft and Pages must not be deployed.
