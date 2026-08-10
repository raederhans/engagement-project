# Task

## Current status

Ready for integration. All Batch 8 implementation stages and authorized focused checks are complete; broader combined-candidate gates remain with the integration owner.

## Checklist

- [x] Map the current v1 export, v2 composition/import, Analysis History UI, repository transaction, and Source Health read-model seams.
- [x] Add failing directly responsible product-admission contracts.
- [x] Implement v2 product export without regressing JSON/CSV or v1 reader support.
- [x] Implement user-visible select, preview, retry, and explicit Apply flow in Analysis History.
- [x] Prove preview zero-write, Apply atomicity/local-only behavior, privacy exclusions, and history preservation.
- [x] Add bilingual and narrow/keyboard UI coverage.
- [x] Run permitted targeted validation under the explicit dependency/non-browser slot.
- [x] Audit path intersections, Git state, and scoped processes; prepare ready-for-integration handoff.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` | `db41214ad5a428fc0cf0fe369f257f7470196cbe` |
| `git status --short --branch` | Detached HEAD, clean before task records. |
| Combined directly responsible Node tests before implementation | RED: missing clean-worktree dependencies (`dayjs`) and missing new `evidence_bundle_product.js`; no product assertion was reported as passing. |
| `node --check` on all changed JS/MJS plus `git diff --check` | Exit 0 after implementation. |
| No-dependency real product composer check | v2/current with private address/center absent; coverage failure produced unavailable source and unavailable result. |
| No-dependency v2 import check | Preview made zero writes; Apply made one atomic write and returned `remoteRefresh=false`. |
| Static lazy/read compatibility audit | Panel dynamically imports only the v2 product composer; History dynamically imports the v1/v2 reader and Source Health adapter; legacy JSON/CSV calls remain; no static product import entered the entry. |
| `npm ci` | Exit 0; 395 packages installed, 396 audited, 0 vulnerabilities. |
| Focused tests, first dependency-backed run | 90/91; one test-only false positive matched the required privacy-disclosure word `attachments`; failure retained in `02-focused-tests.log`. |
| Focused tests after assertion repair | 91/91, exit 0 (`03-focused-tests-green.log`). |
| Final focused tests after real file selection/stale-preview contract | 92/92, exit 0 (`06-focused-tests-final.log`). |
| `npm run lint:js` | Exit 0; final log `07-lint-js-final.log`. |
| `npm run lint:css` | Exit 0; log `05-lint-css.log`. |
| P8/P9 and P8/P10 current same-path intersections | None. |
| Final scoped process check | No Node/npm process command line references the P8 worktree; dependency slot released. |
| Initial `npm run build:manifest` | Exit 0, but Vite exposed a real ineffective dynamic hash import caused by v2's static hash edge (`08-build-manifest.log`). |
| Hash lazy-boundary repair | `evidence_bundle_v2.js` now imports `evidence_bundle_hash.js` dynamically inside checksum composition; rebuilt manifest has a separate 683/462-byte hash chunk and no ineffective-import warning. |
| Final `npm run build:manifest` | Exit 0 (`13-build-manifest-hash-lazy.log`). Entry 121451/39001; total dist 3947424 bytes. |
| Final `npm run verify:bundle` | Expected exit 1 at the first shared-policy assertion only: actual direct edge `evidence_bundle_product.js` vs stale expected `evidence_bundle.js`; exact log `14-verify-bundle-expected-policy.log`. |
| Final manifest graph and sizes | Logged in `15-final-manifest-graph-metrics.log`; Analysis History directly lazy-loads reader, adapter, preview; v2 dynamically loads hash; all new chunks have raw/gzip evidence. |

## Open risks and remaining work

- The current bundle manifest contract names `src/analysis/evidence_bundle.js` as the direct entry import; P8 intentionally changes the product writer to `evidence_bundle_product.js`. Integration must reconcile that exact key and set evidence-based budgets for product 1429/748, adapter 4633/1753, import 6875/2937, preview 5278/1848, v2 shared 22751/6228, and CSS 1319/524 bytes.
- No current P9/P10 same-path intersection was found. `src/i18n/messages.js` remains a potential future shared integration surface.
- Build manifest was run and passed. Bundle policy was run and stopped only on the expected stale direct-entry key before later size assertions. Browser, visual, full validate, release, and coverage were not authorized or run.
- P9 ACS and P10 HIN contributions do not conform directly to the current Crime-only exact v2 content schema; integration must not merge them into `provenance.sources` without an explicit reviewed projection/version change.
- No Git index/ref, commit, push, integration, deploy, or worktree-topology action was taken.
