# Task

## Status

Complete. The backend-free public app is split at its runtime mode boundaries, all confirmed high-value review findings are fixed, and the merged GitHub Pages deployment is browser-verified.

## Checklist

- [x] Capture baseline output sizes and chunk/module ownership.
- [x] Map Crime, Diary, charting, MapLibre, Turf, date, and validation imports.
- [x] Add and observe failing regression tests for intended lazy boundaries.
- [x] Implement and measure the smallest safe split.
- [x] Reproduce and triage independent review findings.
- [x] Run targeted tests, full validation, dependency audit, and diff checks.
- [x] Run local Crime and Diary browser smoke checks.
- [x] Commit, integrate, push, and verify CI/Pages.
- [x] Archive the task record after external state matches evidence.

## Evidence log

| Check | Result |
| --- | --- |
| Initial Git state | Clean `main` matched `origin/main` at `71a2d523`; branch `agent/split-and-audit` created. |
| Baseline bundle | Entry `1,115,581` bytes / `323.34 kB` gzip; Diary `190,762` bytes / `59.65 kB` gzip. |
| Final local bundle | Entry `859,681` bytes / `236.42 kB` gzip; Crime controller `32.05 kB`, Charts `212.54 kB`, Diary `191.00 kB`, Diary insights `8.75 kB`, all lazy. |
| Correctness repairs | Fixed 3857/4326 spatial SQL, tract bbox max-x, exact calendar windows, GEOID normalization, ACS population join, map readiness, Diary teardown, and mutation cache semantics. |
| Security/resilience | Escaped remote HTML fields, removed fabricated map-matching output, bounded live geometry fallbacks, vendored MapLibre CSS, and removed unused Luxon. |
| Local verification | `VITE_FEATURE_DIARY=1 npm run validate` passed; `npm audit --audit-level=high` reported 0 vulnerabilities; `git diff --check` passed. |
| Independent review | Comprehensive code review and architecture review both returned `APPROVE`; the final three tract-lifecycle findings were fixed and re-reviewed. |
| Pull request | `#17` merged as `6973c365687511dc1b919f66ba091ea80bba99a4`. |
| Main CI | Run `30518108612` passed. |
| Runtime Pages | Run `30518108618` built and deployed successfully. |
| Production asset | Root and `assets/index-C21gKuBb.js` returned HTTP 200; the deployed entry is `859,738` bytes with the repository base path included. |
| Production Crime | Map and charts loaded from the public URL with zero browser errors or warnings. |
| Production Diary | Direct Diary loaded its route summary without Crime API requests and with zero browser errors or warnings. |

## Remaining product limitations

- Shared Diary submissions still require a separate writable service; GitHub Pages remains intentionally browser-demo-only.
- MapLibre is required for the initial map and remains the main reason the entry exceeds Vite's generic 500 kB warning; the project bundle policy enforces the measured 950 kB ceiling.
- Snapshot/precompute scripts remain developer tooling and need a separate contract cleanup before they become a release source.
- GitHub Actions reports Node 20 deprecation annotations for upstream action tags even though CI and Pages pass.
- Action tags are not yet pinned to immutable commit SHAs.
