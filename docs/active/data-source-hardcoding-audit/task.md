# Task

## Status

In progress: implementation and local validation complete; GitHub integration and deployed verification remain.

## Checklist

- [x] Inventory URLs, bundled files, embedded dates, region codes, thresholds, and data-generating scripts.
- [x] Classify each item as configuration, authoritative API data, cached fallback, derived snapshot, or demo fixture.
- [x] Verify official Census, Philadelphia/ArcGIS, and CARTO endpoints.
- [x] Define and implement source precedence with response validation.
- [x] Add or extend focused tests.
- [x] Run project validation, dependency audit, and production build.
- [ ] Run local and deployed browser smoke checks for Crime and Diary modes. Local checks pass; deployed checks remain.
- [ ] Commit, merge, push, and verify GitHub Actions/Pages.
- [ ] Archive this task record after all external state matches the evidence.

## Evidence log

| Check | Result |
| --- | --- |
| Initial Git status | Preserved two deployment-archive wording corrections; no unrelated code changes. |
| Branch | `agent/audit-data-sources` created from deployed `main`. |
| Source probes | Police API returned 21 districts; TIGER/PASDA/Esri returned 408 tracts; CARTO covers 2006 through the current table date. |
| ACS choice | Census now requires a key; Census Reporter returned ACS 2024 five-year data for 408 Philadelphia tracts with browser CORS. |
| Regression tests | Six data-source policy tests pass, including API ordering, fallback, parsing, deterministic Diary mode, and the submission callback regression. |
| Local verification | `npm run validate` and the production build pass; `npm audit --audit-level=high` reports zero vulnerabilities. |
| Browser smoke | Crime live APIs and both modes load without console errors; Diary submission updates 48 segments and reports `persisted: false`. |
| Local-path audit | Built output contains no `C:\\Users`, `localhost`, or `127.0.0.1` references. |

## Remaining external-state checks

- Confirm the merged runtime commit passes CI and GitHub Pages deployment.
- Confirm the public Crime page reaches CARTO, City police, TIGER, and Census Reporter successfully.
- Confirm the public Diary page loads same-origin assets and honestly remains non-persistent until a writable backend is configured.
