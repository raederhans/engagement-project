# Phase 1 Evidence Completion Task

## Status

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Baseline and ownership | complete | Clean detached `91cba5544f6a1ae7dc8c26a9d265657f452aae3b`; required DFEV closeout is an ancestor. |
| Unified Phase 1 record | complete | This directory is the sole Phase 1A-D plan/context/task surface. |
| 1-0 release/browser gate | complete | Release runner includes Area Intelligence, Home Compare, and Known Route browser suites exactly once; workflow/package contract is green. |
| 1-0 Home Compare gzip headroom | complete | Results renderer moved behind first compare; controller is 10,799 gzip bytes under unchanged 18,000 ceiling (7,201 bytes headroom). |
| 1-0 M0/lifecycle semantics | complete | Precise recoverable serial multi-file transaction language and four-clock/status/schema/revision/DQ/lineage acceptance are frozen in `plan.md`; existing Source Health/data contracts are green. |
| Independent review | requested | Main supervising task must perform independent code/architecture review; this task cannot self-approve integration. |
| Integration / remote gates | deferred | Integration owner only; no merge/push/remote CI/deploy/live smoke in this task. |

## Local verification ledger

Commands, exit codes, and any retained diagnostic location are appended here
before handoff. Browser suites execute serially under the owner declared in
`context.md` and are never treated as remote/live source evidence.

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci` | 0 | 395 lockfile packages installed locally; 396 audited; 0 vulnerabilities; `package-lock.json` unchanged. |
| `node --test scripts/tests/release_workflow_contracts.mjs scripts/tests/home_compare_m3.mjs scripts/tests/source_health_contracts.mjs` | 0 | 34/34; release scripts/workflow, Home Compare privacy/projection/registry and Source Health clocks/status contracts pass. |
| `npm run build:manifest && npm run verify:bundle` | 0 | Vite manifest built; all budgets pass. Home Compare controller `30,427/10,799` raw/gzip, result chunk `3,672/1,504`; ceiling unchanged. |
| `npm run test:area-intelligence-browser` | 0 | Real browser suite passed with promoted/no-promotion paths and zero console/page errors; port 4192 released. |
| `npm run test:home-compare-browser` | 0 | Real browser suite passed 2/3/4 profiles, bilingual/privacy/partial-unavailable/mobile paths with zero console/page errors; port 4193 released. |
| `npm run test:known-route-evidence-browser` | 0 | Real browser suite passed consent/privacy/fail-closed/mobile paths with zero console/page errors; port 4194 released. |
| `npm run validate` | 0 | Complete project test aggregate, production manifest build, and bundle policy passed. |
| `npm run audit:dependencies`; `npm run lint:js`; `npm run lint:css` | 0 | 0 audit vulnerabilities; both linters clean. |
| `npm run test:browser-smoke`; `npm run test:acs-multitract-browser` | 0 | General smoke and ACS browser passed; ACS reported zero console/page errors. |
| `npm run test:visual-experience:dist` | 0 | 45 one-worker Playwright visual tests passed; temporary preview used port 4178 and exited. |

The release runner itself was intentionally not rerun after its three new
browser steps had been run directly. The executable contract verifies its exact
command list, and every listed release command was exercised once locally;
this avoids duplicate browser-suite execution while retaining release-gate
evidence.
