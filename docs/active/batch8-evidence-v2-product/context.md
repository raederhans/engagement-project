# Context

## Current truth

- Worktree: `C:\Users\raede\.codex\worktrees\p8-evidence-v2\engagement_project`.
- Assigned and verified baseline: `db41214ad5a428fc0cf0fe369f257f7470196cbe`.
- Git state at start: detached HEAD, clean.
- Batch 8 owns Evidence Bundle product admission; P9 and P10 run in separate worktrees.
- Long/shared validation is not owned by this lane unless the main supervisor explicitly grants a slot.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | `docs/AGENTS.md` applies under `docs/`; the root operating contract was supplied by the supervisor environment. | Records and validation must preserve shared resources and integration ownership. |
| 2026-08-10 | Baseline SHA equals the assigned SHA before edits. | Audit and later handoff use an exact common base. |
| 2026-08-10 | `src/ui/panel.js` is the sole product Evidence Bundle export caller and still imports the v1 composer; that shared file is outside Batch 8 ownership. | Batch 8 will provide a product v2 composer and an exact integration-owner wiring handoff, without editing the panel. |
| 2026-08-10 | v2 validation/import and `saveManyAtomic` already exist; `src/ui/evidence_bundle_import_preview.js` is not mounted in Analysis History. | Work centers on product Source Health projection, UI/controller admission, and stronger preview truthfulness rather than replacing the foundation. |
| 2026-08-10 | Source Health is built from `SOURCE_HEALTH_CATALOG`, admitted observations, and `buildSourceHealthReadModel`; no Evidence Bundle adapter exists. | Add an analysis-layer adapter that consumes this read model and validates its exported projection instead of creating a second freshness model. |
| 2026-08-10 | Preview currently omits source statuses/coverage, limitations, and exact recovery reason; a failed second preview can leave a prior ready preview applicable. | Contracts must invalidate stale previews and display the complete review information before Apply. |
| 2026-08-10 | The integration owner expanded Batch 8 ownership to `src/ui/panel.js` and directly responsible `src/utils/export_analysis.js` so the product writer can actually switch to v2. | Implement the real feature-flagged lazy export wiring while preserving JSON/CSV and entry isolation; package and bundle-policy ownership remain external. |
| 2026-08-10 | Tests-first combined execution was attempted before implementation. The clean worktree lacked dependencies, so Analysis History and Crime UI stopped at `ERR_MODULE_NOT_FOUND: dayjs`; the Evidence v2 entry independently stopped at the missing new product module. | The missing-module evidence is the implementation RED; dependency-backed GREEN waits for the supervisor's slot. |
| 2026-08-10 | No-dependency product checks after implementation emitted v2/current from the real Source Health read model, emitted unavailable/unavailable on coverage error, and completed preview -> one atomic Apply with `remoteRefresh=false`. | Core product, fail-closed, zero-write, and atomic behavior has narrow GREEN evidence without claiming the dependency-backed gates. |
| 2026-08-10 | Dependency/non-browser slot is currently owned by P9; the supervisor placed Batch 8 next. | Stop Node/npm work and continue static audit until explicit authorization arrives. |
| 2026-08-10 | After P9 released the slot, the supervisor authorized `npm ci`, the three focused test files, and JS/CSS lint only. | `npm ci` found 0 vulnerabilities; the first focused run was 90/91 because a privacy negative test matched the required word `attachments` inside the disclosure list rather than exported content. |
| 2026-08-10 | The privacy assertion was narrowed to content excluding the explicit privacy disclosure, matching the established v2 negative-test method. | Subsequent focused runs passed 91/91 and then 92/92 after adding real file-selection/stale-preview coverage; JS and CSS lint both passed. |
| 2026-08-10 | `src/ui/panel.js` now directly imports `evidence_bundle_product.js` only after the feature-flagged button is clicked; History dynamically imports the parser, Source Health adapter, preview UI, and dedicated CSS below its existing lazy boundary. | Heavy v2/Source Health/import code stays out of the initial entry, but the integration owner must update or refactor the current exact manifest/budget contract that still names `evidence_bundle.js` before running bundle/release gates. |
| 2026-08-10 | Read-only comparison of current P8/P9/P10 modified paths found no same-path intersections. | Integration can sequence the three lanes without a direct file merge conflict as of this handoff; shared main/index/package/bundle changes remain integration-owner work. |
| 2026-08-10 | The supervisor later granted an isolated non-browser build slot for `build:manifest` and `verify:bundle`. The first build passed but reported `INEFFECTIVE_DYNAMIC_IMPORT` because v2 statically imported the hash module. | This was a real P8 lazy-boundary defect, not the expected old policy mismatch, so `evidence_bundle_v2.js` was corrected to dynamically import the hash module. |
| 2026-08-10 | The rebuilt manifest completed without the ineffective-import warning. `evidence_bundle_v2` now dynamically imports the unchanged 683/462-byte hash chunk. | Browser cryptography remains nested-lazy from both export and import paths. |
| 2026-08-10 | Final `verify:bundle` stops at the expected exact Entry-set assertion only: actual contains `evidence_bundle_product.js`, while the shared policy still expects `evidence_bundle.js`; the other ten direct lazy edges match. | Preserve the failure as a policy-owner handoff; it is not a product build failure and Batch 8 did not edit the shared policy. |
| 2026-08-10 | Final build metrics against the same-SHA main `dist`: Entry 121451/39001 bytes (-547/-158), Analysis History 17586/6229 (-7200/-1759), total dist 3947424 bytes (+38863; 52576 bytes below the current 4,000,000 ceiling). | P8 stays out of Entry and splits new work into measured nested chunks; combined P8/P9/P10 still needs a fresh integration build and policy admission. |
| 2026-08-10 | P9 handed off `engagement-acs-aggregation-evidence-adapter/v1`; P10 handed off `hin-2025-evidence-contribution/v1` and an HIN Source Health observation. | Neither contribution is copied into P8. Current v2 exact content contract is Crime-only; integration must define a reviewed contribution/schema extension rather than placing either object directly into P8 provenance. HIN additionally needs an admitted catalog entry before its observation is registered. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| Dependency/non-browser checks | Batch 8 | `.tmp/batch8-evidence-v2/01-npm-ci.log` through `07-lint-js-final.log` | Complete; slot released after focused checks. |
| Non-browser build checks | Batch 8 | `.tmp/batch8-evidence-v2/08-build-manifest.log` through `15-final-manifest-graph-metrics.log` | Complete; hash static edge repaired, final build passed, bundle policy stopped only on the expected stale Entry key; slot to be released after final process check. |

## Handoff

- Integration owner must reconcile the manifest/bundle contract with the new panel dynamic import and later wire P9/P10 adapters without inventing schema inside Batch 8.
- Product path is: flagged Crime button -> dynamic `evidence_bundle_product.js` -> Source Health catalog/observations/read model -> v2 composer/hash. Import path is: lazy Analysis History -> nested preview UI -> user Preview -> nested v1/v2 reader + Source Health adapter -> explicit atomic Apply -> local Analysis Repository only.
- v1 remains readable through `evidence_bundle_import.js` and is directly covered by the focused suite; legacy JSON/CSV export handlers were not changed.
- Build manifest is fresh and successful. Shared bundle policy requires its exact Entry key and evidence-based new chunk budgets to be updated by the integration owner; browser, visual, full validate, release, and coverage remain unrun.
- P9/P10 contribution records are future extension inputs, not valid direct additions to the current `public-crime-analysis/v1` v2 content contract. Do not silently widen the schema during merge.

## Next step

Integration owner reviews the 15 changed paths, reconciles the bundle manifest/budget contract, designs a separate reviewed P9/P10 contribution extension, and validates the combined candidate.
