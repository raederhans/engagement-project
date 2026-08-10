# P0 Maintenance Task

## Current status

Integrated into the local `main` candidate — P0 edits and focused integration validation are complete; live-test slot released. Push and remote release are intentionally deferred.

## Checklist

- [x] Capture pre-change Route corridor raw/gzip metrics.
- [x] Restore meaningful adapter budget headroom without changing behavior or limits.
- [x] Verify and pin the Node 24-compatible upload-artifact major in both workflow locations.
- [x] Preserve exact-artifact, main-tip and one-candidate release semantics.
- [x] Decide and test the minimum Source Health observation registration seam.
- [x] Run authorized focused validation and prepare a ready-for-integration handoff.

## Validation evidence

| Command or check | Result |
| --- | --- |
| `git rev-parse HEAD` | `92344502eaecb7436f8b7a4ef658ba29928f6368` |
| Initial `git status --short` | Clean before task records were created. |
| `npm ci` | Exit 0; 395 packages installed, 396 audited, 0 vulnerabilities. Log `01-install.log`. |
| Baseline `npm run build:manifest && npm run verify:bundle` | Exit 0; Route app adapter `3399/1500`. Log `02-baseline-bundle.log`. |
| Official upstream checks | Latest release/tag `v7.0.1`; commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`; `action.yml` uses Node 24. Log `00-upstream-action-evidence.log`. |
| Initial focused contracts | Expected investigative failure `42/43`: comment matcher over-counted unrelated v7.0.1 action comments. Log `03-targeted-contracts.log`. |
| Corrected focused contracts | Exit 0, `43/43`. Log `04-targeted-contracts-green.log`. |
| Final `npm run build:manifest && npm run verify:bundle` | Exit 0; app adapter `1917/896`, runtime ports `1978/984`, Entry `121998/38900`, total dist `3908567`. Log `05-final-bundle.log`. |
| `npm run lint:js` | Exit 0, 0 warnings. Log `06-lint-js.log`. |
| `js-yaml` parse of `.github/workflows/ci.yml` | Exit 0; jobs exactly `core,release,coverage,deploy`. Log `07-yaml-parse.log`. |
| Final Source Health plus release contracts | Exit 0, `19/19`. Log `08-final-contracts.log`. |
| `git diff --check` | Exit 0; only existing Windows LF-to-CRLF notices. Log `09-diff-check.log`. |
| Final scoped process/ref/status check | Scoped Node/npm count 0; `HEAD == main == origin/main` at baseline. Log `10-final-process-and-git.log`. |
| Integration-owner direct contracts | PASS: 43/43 on the local `main` candidate. |
| Integration-owner manifest and bundle gate | PASS: Route app `1917/896`, runtime ports `1978/984`, Entry `121998/38900`, total dist `3908561`. |

## Open risks and remaining work

- Combined candidate browser/visual/full release and remote Actions remain the integration owner's responsibility.
- Source Health registration property is now the shared boundary for B8/B9/B10; source-specific adapters must remain in their feature modules and return admitted observations.
- B10 and any future chunk work must coordinate ownership of `scripts/tests/bundle_policy.mjs` and the Route/HIN contract files rather than overwriting this nested lazy boundary.
