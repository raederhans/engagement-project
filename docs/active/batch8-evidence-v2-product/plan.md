# Plan

## Goal

Admit the existing Evidence Bundle v2 contract into the Crime public-aggregate product path: the feature-flagged product export writes v2, Analysis History exposes file selection, a read-only preview, and an explicit atomic Apply, while v1 import and legacy JSON/CSV exports continue to work.

## Scope

- Extend the existing Evidence Bundle modules and Analysis History controller/UI boundary.
- Use the existing Source Health read model as v2 provenance; do not create a parallel source-status model.
- Keep import preview write-free and Apply local-only and atomic.
- Cover English and Simplified Chinese, keyboard operation, narrow layouts, retry after failures, and preservation of existing history.
- Add directly responsible contract tests without editing shared package/build/workflow ownership files.

## Sources of truth

- Current code and directly responsible tests at baseline `db41214ad5a428fc0cf0fe369f257f7470196cbe`.
- `docs/AGENTS.md` and the repository release/validation contracts.
- The integration-owner assignment for Batch 8.

## Stages

- [x] Stage 1: Audit existing v1/v2/export/history/source-health paths and record exact seams.
- [x] Stage 2: Add failing product-admission contracts for v2 export, v1/v2 import, privacy exclusions, preview zero-write, and atomic Apply.
- [x] Stage 3: Implement the scoped runtime and UI changes.
- [x] Stage 4: Run permitted targeted checks under the granted dependency/non-browser slot.
- [x] Stage 5: Review scope, intersections, processes, and prepare the integration handoff.

## Acceptance criteria

- Feature-flagged Evidence Bundle export downloads `engagement-evidence-bundle/v2` and does not replace JSON/CSV.
- v1 and v2 files both preview through the same user-visible Analysis History flow.
- Preview performs no repository writes; Apply performs exactly one repository transaction and triggers no remote refresh.
- Preview communicates schema/version, query/geography, source status/coverage, limitations, recoverability, and exact failure reasons in English and Simplified Chinese.
- Existing history remains intact on parse, validation, preview, or Apply failure, and the user can retry.
- Bundles exclude addresses, raw incident rows, GPS traces, route geometry, Diary notes, and attachments.
- Product provenance consumes the existing Source Health contract/read model.
- Targeted tests pass and all unrun release/browser/visual gates are explicitly handed off.

## Non-goals

- ACS or HIN bundle contribution/adapters.
- Source Health runtime-adapter changes.
- Shared entrypoint, package, CI, release, route, ACS, or HIN runtime edits.
- Remote refresh, account/cloud sync, remote import, or schema invention beyond the existing v2 contract.
- Git index/ref, commit, push, deploy, integration, or worktree cleanup changes.

## Risks and constraints

- `package.json`, `src/main.js`, `index.html`, Source Health adapters, CI, bundle policy, and ACS/HIN/route runtime are integration-owner or other-lane scope.
- `src/ui/panel.js` and directly responsible `src/utils/export_analysis.js` are an explicit ownership extension for the real v2 writer; v2 and Source Health code must remain behind the existing dynamic import.
- Shared `src/i18n/messages.js` is allowed only if required and must be reported as a likely cross-lane intersection.
- Build, bundle, browser, visual, full validate, and dependency installation require an explicit live-test slot.
- The worktree starts detached at the exact assigned baseline and must remain detached/uncommitted for handoff.
