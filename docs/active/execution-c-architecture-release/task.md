# Task

## Current status

`ready-for-integration` — the accepted neutral-palette and package-entry repairs now have fresh executable and static evidence: the C-owned palette contract passed 2/2, both Diary contract entrypoints remain in aggregate `npm test`, baseline refs are unchanged, and no scoped node/npm process remains.

## Checklist

- [x] Verify `HEAD == main == origin/main == dc1e5672d8b2229bebf587e2ec72ba3550f2f592` and a clean starting worktree.
- [x] Confirm execution-only Git permissions and reserve live-test ownership for Execution A.
- [x] Add Crime state port and migrate URL/preset/history/map selection call sites.
- [x] Inject Diary submit port into the segments map layer.
- [x] Add focused behavior and architecture boundary tests.
- [x] Add ESLint flat config, Stylelint correctness config, and report-only coverage.
- [x] Consolidate CI/Pages into one exact-artifact control chain.
- [x] Align maintainer docs and archive-state truth.
- [x] Release the dependency/non-browser verification slot with no scoped node/npm process remaining.
- [x] Run permitted static checks, review, and overlap scan.
- [x] Confirm final process state and prepare the ready-for-integration handoff.
- [x] Prevent main release workflows and in-progress Pages deploy jobs from being cancelled by newer runs.
- [x] Re-run the direct release contract, YAML parse, diff check, and prepare a corrected handoff.
- [x] Replace the two C-owned Diary map expressions with the neutral ordered slate/blue/violet palette without changing thresholds or data fields.
- [x] Add a non-overlapping Diary palette contract and package entrypoint.
- [x] Expose Execution B's `diary_truth_contracts.mjs` through `test:diary-truth` and the aggregate `npm test` entrypoint without modifying the B-owned test.
- [x] Obtain the non-browser slot, execute the C-owned palette suite, prepare the corrected handoff, and release the slot.
- [ ] Integration owner: execute `test:diary-truth` after B's test file and C's package entry coexist in the integrated candidate.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD; git rev-parse main; git rev-parse origin/main` | All three: `dc1e5672d8b2229bebf587e2ec72ba3550f2f592`. |
| `git status --short` before edits | Clean. |
| `npm install --package-lock-only --ignore-scripts` | Exit 0; lockfile resolved only approved ESLint/Stylelint dev dependencies and necessary transitives. Log: `.tmp/execution-c/01-package-lock-only.log`. |
| `npm ci` | Exit 0; 395 packages installed, 396 audited, 0 vulnerabilities. Log: `.tmp/execution-c/02-npm-ci.log`. |
| `npm audit --audit-level=high` | Exit 0; 0 vulnerabilities. Log: `.tmp/execution-c/03-npm-audit-high.log`. |
| Focused port/release contracts | Exit 0; 8/8 total, preserving 4/4 architecture and 4/4 release contracts. Log: `.tmp/execution-c/04-port-and-release-contracts.log`. |
| `npm run lint:js` | Initial scoped-rule failure recorded; after removing one cross-line high-noise rule, exit 0 with 0 errors/warnings. Logs: `05-lint-js.log`, `05b-lint-js-after-scope-adjustment.log`. |
| `npm run lint:css` | Initial existing-cascade failure recorded; after removing one structural rule, exit 0 with 0 errors/warnings. Logs: `06-lint-css.log`, `06b-lint-css-after-scope-adjustment.log`. |
| `npm run coverage:report` | Exit 0; 58/58 tests and non-empty Node report (50.41% lines / 73.58% branches / 52.46% functions overall). Report-only, no threshold/browser claim. Log: `.tmp/execution-c/07-coverage-report.log`. |
| Targeted architecture/Diary/workflow regressions | Initial run exposed a missing submit-port forwarding seam; after the scoped fix, exit 0 with 112/112 tests. Logs: `.tmp/execution-c/08-targeted-regressions.log`, `.tmp/execution-c/08b-targeted-regressions-after-submit-port-fix.log`. |
| YAML, changed-JS syntax, focused contracts, lint, and `git diff --check` | Exit 0; workflow parsed with jobs `core,release,coverage,deploy`, 8/8 focused contracts, both lint gates clean, and no whitespace errors. Log: `.tmp/execution-c/09b-final-static-and-contracts.log`. The earlier `09-static-syntax-and-diff.log` is an invalid command attempt and is not evidence. |
| Cross-line lint compatibility | C's config read-only linted 18 current Execution A JS files and 15 current Execution B JS files with zero findings; B's three changed CSS files also passed. Valid log: `.tmp/execution-c/10c-cross-line-lint-readonly-valid.log`; the earlier outside-base attempt is retained but not treated as evidence. |
| Official pinned Pages action input contracts | `upload-pages-artifact@fc324d...` supports `name`, `path`, and `retention-days`; `deploy-pages@cd2ce8...` supports `artifact_name`. |
| Final targeted verification | Exit 0; 61/61 directly related contracts, state barrel import, both lint gates, workflow YAML parse, and `git diff --check` passed. Log: `.tmp/execution-c/11-final-verification.log`. |
| Final read-only handoff check | Exit 0; baseline refs unchanged, forbidden-path count 0, MapLibre/Vite version diff 0, 11/11 action pins full SHA, A overlap 0, B overlap exactly `scripts/tests/data_source_policy.mjs`, scoped node/npm count 0. Log: `.tmp/execution-c/12-final-readonly-handoff-check.log`. |
| Pages concurrency contract RED | Expected failure, 4/5: the new contract rejected workflow-level `true` and deploy-level `true`. Log: `.tmp/execution-c/13-release-concurrency-red.log`. |
| Pages concurrency contract GREEN | Exit 0, 5/5 after the two scoped YAML changes. Log: `.tmp/execution-c/14-release-concurrency-green.log`. |
| Corrected concurrency verification | Exit 0; package entrypoint 5/5, YAML parsed workflow cancellation as the exact PR expression and deploy cancellation as boolean `false`, then `git diff --check` passed. Log: `.tmp/execution-c/15b-release-concurrency-verification.log`. |
| Final review-finding closeout | Exit 0; fresh 5/5 release contracts, YAML semantic/type assertions, test syntax, deployment-doc assertions, zero pending C checklist items, unchanged baseline refs, `git diff --check`, and scoped node/npm count 0. Log: `.tmp/execution-c/16-concurrency-finding-final.log`. |
| Diary palette static RED | Exit 0 as an expected static finding: both map expressions still contained the four legacy red/yellow/green colors, old risk/safety comments, and `ROUTE_SAFETY_EXPRESSION`. No Node test was run because Execution A owns the slot. Log: `.tmp/execution-c/17-diary-palette-static-red.log`. |
| Diary palette static GREEN | Exit 0: legacy match count 0; neutral palette, unchanged thresholds/data property, package entrypoint, and `git diff --check` verified. This is static evidence only; executable contract remains pending. Log: `.tmp/execution-c/18-diary-palette-static-green.log`. |
| Diary palette edit-only handoff | Exit 0: legacy match count 0, package entrypoint present, exactly two pending authorization/checklist records, baseline refs unchanged, `git diff --check`, scoped node/npm count 0, and explicit `node-test-executed=false`. Log: `.tmp/execution-c/19-diary-palette-edit-only-handoff.log`. |
| Diary truth entrypoint static RED | Exit 0 as expected evidence: B's test file exists, but `test:diary-truth` was absent and aggregate inclusion was false. No Node test was run. Log: `.tmp/execution-c/20-diary-truth-entry-static-red.log`. |
| Diary truth entrypoint static GREEN | Exit 0: exact command and aggregate ordering verified; B file exists only in B with SHA-256 `F1084126...B606EB`, C file remains absent, overlap remains only `data_source_policy.mjs`, `git diff --check` passed, scoped processes 0, and Node/npm remained unrun. Log: `.tmp/execution-c/21-diary-truth-entry-static-green.log`. |
| Diary truth edit-only handoff | Exit 0: exact script and aggregate order remain valid, `test:diary-palette` remains aggregated, B's file hash is unchanged, C still does not contain the B-owned file, the only B/C same-path overlap remains `data_source_policy.mjs`, `git diff --check` passed, scoped processes 0, and Node/npm remained unrun. Log: `.tmp/execution-c/22-diary-truth-entry-edit-only-handoff.log`. |
| Diary palette executable contract | Exit 0: 2/2 tests passed, preserving both expressions' thresholds/data fields and locking the neutral ordered palette. Only `npm run test:diary-palette` was executed. Log: `.tmp/execution-c/23-diary-palette-test.log`. |
| Post-palette static handoff | Exit 0: both named Diary entries are exact and aggregated, `HEAD == main == origin/main == dc1e567...`, A/C overlap is zero, B/C overlap remains only `data_source_policy.mjs`, `git diff --check` passed, and scoped node/npm count is zero. `test:diary-truth` was not executed. Log: `.tmp/execution-c/24-diary-palette-final-static.log`. |
| Scoped process check after slot | No node/npm process command line points to this worktree; only the checking PowerShell process was visible. Slot released. |

## Open risks and remaining work

- Resolved review finding: top-level cancellation is now conditional on `pull_request`, deploy cancellation is boolean `false`, and a 5-test release contract prevents both values from returning to unconditional `true`.
- Resolved cross-line finding: both map expressions use the neutral ordered palette and neutral comments, and the dedicated executable contract passed 2/2 under the authorized C slot. Ready-for-integration is restored.
- The authorized C short-test slot was used only for `npm run test:diary-palette` and is released with scoped node/npm count zero.
- The B-owned Diary truth contract now has a standard package/aggregate entrypoint, but `npm run test:diary-truth` is intentionally unrun under the same slot restriction.
- `test:diary-truth` cannot execute in the current C worktree because the B-owned file correctly remains only in B; the integration owner must run the named entrypoint after combining both deliveries.
- Full validate, browser, visual, Pages deploy, and remote Actions remain unrun and unauthorized in this lane.
- Execution B and C both modify `scripts/tests/data_source_policy.mjs`; integration must preserve B's local-only Diary assertions and C's injected submit-port positive/negative assertions. No same-path overlap was found with Execution A.
- GitHub branch protection, Pages environment, and Actions policy are external settings and are not authorized in this lane.
