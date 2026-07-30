# Task

## Status

Local implementation, full verification, and independent review are complete; ready for GitHub integration and Pages verification.

## Checklist

- [x] Capture baseline output sizes and chunk/module ownership.
- [x] Map Crime, Diary, charting, MapLibre, Turf, date, and validation imports.
- [x] Add and observe failing regression tests for intended lazy boundaries.
- [x] Implement and measure the smallest safe split.
- [x] Reproduce and triage independent review findings.
- [x] Run targeted tests, full validation, dependency audit, and diff checks.
- [x] Run local Crime and Diary browser smoke checks.
- [ ] Commit, integrate, push, and verify CI/Pages.
- [ ] Archive the task record after external state matches evidence.

## Evidence log

| Check | Result |
| --- | --- |
| Initial Git state | Clean `main` matched `origin/main` at `71a2d523`; branch `agent/split-and-audit` created. |
| Existing validation | Previous deployed baseline passed tests, build, CI, Pages, and both browser modes. |
| Baseline bundle | Entry `1,115,581` bytes / `323.34 kB` gzip; Diary `190,762` bytes / `59.65 kB` gzip. |
| Final bundle | Entry `859,681` bytes / `236.42 kB` gzip; Crime controller `32.05 kB`, Charts `212.54 kB`, Diary `191.00 kB`, Diary insights `8.75 kB`, all lazy. |
| Correctness repairs | Fixed 3857/4326 spatial SQL, tract bbox max-x, exact calendar windows, GEOID normalization, ACS population join, map readiness, Diary teardown, and mutation cache semantics. |
| Security/resilience | Escaped remote HTML fields, removed fabricated map-matching output, bounded live geometry fallbacks, vendored MapLibre CSS, and removed unused Luxon. |
| Full validation | `VITE_FEATURE_DIARY=1 npm run validate` passed; `npm audit --audit-level=high` reported 0 vulnerabilities; `git diff --check` passed. |
| Browser verification | Production Crime and Diary direct URLs plus rapid Crime/Diary switching passed with 0 console errors/warnings; Diary direct made no Crime API requests. |
| Independent review | Comprehensive code review and architecture review both returned `APPROVE`; the final three tract-lifecycle findings were fixed and re-reviewed. |

## Low-risk follow-ups

- MapLibre remains the main reason the entry chunk exceeds Vite's generic 500 kB warning; it is required for the initial map and is covered by the stricter project bundle policy.
- Snapshot/precompute scripts remain developer tooling and should receive a separate contract cleanup before they are used as a release source.
- GitHub Actions dependencies use version tags rather than immutable commit SHAs; pinning them is a later supply-chain hardening task.
