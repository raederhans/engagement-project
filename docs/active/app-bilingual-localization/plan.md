# Plan

## Goal

Add complete English and Simplified Chinese presentation to the application and reader-facing project documentation, with one accessible language switch that updates the active interface without reloading.

## Scope

- Inventory visible copy in the application shell, Crime mode, Diary mode, secondary panels, dialogs, map feedback, status, validation, and error states.
- Add one framework-free localization boundary compatible with the existing vanilla JavaScript/Vite architecture.
- Add an app-bar language switch with persisted preference and correct document language metadata.
- Localize static HTML and dynamic JavaScript copy while preserving technical identifiers, data fields, URLs, and storage schemas.
- Add Chinese project documentation and re-check the English README for commands, feature descriptions, architecture, data/privacy, and deployment accuracy.
- Extend existing contract tests before production changes and finish with the repository validation gate.

## Sources of truth

- Current `codex/bilingual-localization` worktree based on `origin/main@f956ab2`; unrelated `.gitignore` WIP must be preserved.
- The accepted P0 shell, mode, responsive, Help, and Diary interaction contracts in `origin/main@f956ab2`.
- `index.html`, `src/main.js`, `src/mode_coordinator.js`, `src/ui/`, `src/routes_crime/`, `src/routes_diary/`, `src/map/`, and `src/compare/` for reader-visible copy.
- `README.md`, `package.json`, Vite configuration, public data files, and current tests for documentation truth.

## Stages

- [x] Stage 1: Inventory visible copy and define the locale/runtime contract.
- [x] Stage 2: Add failing tests for locale choice, persistence, DOM translation, dynamic copy, and the switch control.
- [x] Stage 3: Implement the localization core and app-bar language switch.
- [x] Stage 4: Localize the shell, Crime surfaces, Diary surfaces, secondary panels, map feedback, validation, and errors.
- [x] Stage 5: Re-check README accuracy and add Chinese project documentation.
- [x] Stage 6: Run focused tests, full validation, static untranslated-copy audit, live preview smoke, review, and first-principles simplification check.
- [x] Stage 7: Merge `origin/codex/p1-ui@614e88c` without rewriting history and reconcile shared-file conflicts without changing P1 behavior.
- [x] Stage 8: Inventory and localize every P1-added or changed user-visible string, including data scope, provenance, map selection, Summary/History, route decisions, Insights, and Simulator surfaces.
- [x] Stage 9: Extend localization and P1 contract tests, then run the full feature-enabled validation, browser smoke, bundle policy, untranslated-copy audit, and final review.
- [x] Stage 10: Push the reconciled localization branch and create or update a localization PR layered on the Draft P1 branch; do not merge PR #41 or deploy Pages.

## Acceptance criteria

- Users can switch between English and Simplified Chinese from the app bar without reloading.
- The selected language persists across reloads; first visit follows a Chinese browser preference and otherwise falls back to English.
- `<html lang>` and the switch's accessible name/state match the active language.
- Primary and secondary menus, buttons, headings, labels, placeholders, Help/About content, map feedback, loading, empty, validation, success, and error messages have both locales.
- Switching language refreshes already-rendered static and dynamic UI without losing mode, map, form, filter, or analysis state.
- Reader-facing README/project instructions are available in Chinese, and English commands/current feature claims match the repository.
- Existing behavior, IDs, query parameters, storage keys, data schemas, and bundle limits remain compatible.
- Targeted localization/UI tests and `npm run validate` pass.
- P1 behavior from `966ffaa` remains intact, and all P1-visible copy switches language without a reload or state loss.
- The final validation, browser smoke, bundle policy, and localization audit pass with both Diary and tract-crime feature flags enabled.

## Non-goals

- No framework, i18n dependency, UI library, backend, translation service, or machine-generated runtime translation.
- No translation of code identifiers, protocol fields, dataset column names, commands, paths, URLs, brand names, or licenses.
- No unrelated visual redesign, production deployment, or cleanup of files outside the bilingual-localization branch.

## Risks and constraints

- The worktree is already dirty and localization overlaps files owned by the active P0 UI task; edits must be additive and preserve current behavior.
- Visible copy is split between static HTML and dynamically assembled JavaScript; string coverage needs a mechanical audit plus runtime tests.
- Some API/data error text is technical; user-facing summaries should be localized without changing diagnostic details or control flow.
- Chinese copy can change layout width and wrapping, especially in the app bar, mobile sheet, charts, and rating flow.
