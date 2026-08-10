# P0 Maintenance Context

## Current truth

- Worktree: `C:\Users\raede\.codex\worktrees\p0-maintenance\engagement_project`.
- Baseline `HEAD`: `92344502eaecb7436f8b7a4ef658ba29928f6368`.
- No pre-existing `docs/active/p0-maintenance/` record was present.
- Executor handoff reached `ready-for-integration` without changing refs or index state. The integration owner then created the isolated P0 commit and cherry-picked it into the local `main` candidate.
- Route app adapter changed from `3399/1500` raw/gzip to `1917/896`; its runtime ports now load only after the explicit Known Route open action and measure `1978/984` under a separate `3000/1400` ceiling.

## Decisions and deviations

| Time | Evidence or decision | Impact |
| --- | --- | --- |
| 2026-08-10 | Main supervisor assigned P0 as an isolated edit-only handoff. | No add/commit/push/ref/worktree/deploy operations are allowed here. |
| 2026-08-10 | Baseline build reproduced the Route app adapter at `3399/1500`, including only 0 gzip bytes below the existing limit. | A new nested runtime boundary was justified by direct bundle evidence. |
| 2026-08-10 | `route_corridor_app_runtime.js` now owns map/request/HIN ports and loads only after an explicit open. | The app-level mode entry is `1917/896`, below the requested `2975/1275` target; data, HIN, UI, keyboard and no-map boundaries remain nested-lazy and contract-covered. |
| 2026-08-10 | Official release `v7.0.1` resolves to commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`; its `action.yml` declares `using: node24`. Sources: https://github.com/actions/upload-artifact/releases/tag/v7.0.1 and https://github.com/actions/upload-artifact/commit/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a. | Both artifact retention uses, the immutable allowlist, release contract and deployment documentation use the same full SHA. |
| 2026-08-10 | Source Health central assembly would otherwise require every source to add imports. Added only `runtimeEvidence.registeredSourceHealthObservations`. | ACS/HIN modules can own adaptation/admission and explicitly register results; no plugin registry, dependency or premature observation was added. Default Crime plus bundled output is deep-equality tested unchanged. |
| 2026-08-10 | The first focused run was `42/43` because the new test counted every repository `# v7.0.1` comment instead of only upload-artifact lines. | The assertion was narrowed to exact action SHA plus comment; the rerun passed `43/43`. This was a test-scope correction, not a product fallback. |

## Live process ownership

| Process | Owner | Log path | State |
| --- | --- | --- | --- |
| `npm ci` then focused manifest/bundle builds | P0 agent | `.tmp/p0-maintenance/01-install.log`, `02-baseline-bundle.log`, `05-final-bundle.log` | Complete; final scoped Node/npm count is 0 and the slot is released. No browser, visual, dev server, full validate or release ran. |

## Handoff

- Status: integrated into the local `main` candidate; push and remote release remain deferred to the integration owner.
- Integration owner: main supervisor.
- Product/contract paths changed: `.github/workflows/ci.yml`, `docs/DEPLOY.md`, `src/routes_crime/route_corridor_app_loader.js`, new `src/routes_crime/route_corridor_app_runtime.js`, `src/source_health/source_health_adapters.js`, and six directly overlapping test files under `scripts/tests/`.
- Predicted integration overlaps: `scripts/tests/bundle_policy.mjs` is a shared release owner for B8/B9/B10; B10 may also need the Route/HIN contract files. Future batches should consume `registeredSourceHealthObservations` rather than reopening the central adapter assembler.
- Unrun by authorization boundary: browser smoke, visual regression, full `npm test`, full `npm run validate`, coverage, `ci:release`, remote Actions and deployment.

## Integration evidence

- The integration owner independently reran the five directly related Node suites: 43/43 passed.
- The integrated `main` candidate reran `npm run build:manifest` and `npm run verify:bundle`: both exited 0 with Route app `1917/896`, runtime ports `1978/984`, Entry `121998/38900`, and total dist `3908561` bytes.
- `git diff --check HEAD~1..HEAD` exited 0. Browser, visual, full release, push, remote Actions, and deployment remain explicitly unrun for this local P0-only candidate.

## Next step

Start B8/B9/B10 from the integrated P0 baseline with disjoint worktrees and preserve the shared-file ownership rules above.
