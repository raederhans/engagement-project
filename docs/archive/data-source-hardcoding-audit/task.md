# Task

## Status

Complete. The public app is API-first, has no developer-machine runtime dependency, truthfully labels non-persistent Diary behavior, and is deployed and browser-verified.

## Checklist

- [x] Inventory URLs, bundled files, embedded dates, region codes, thresholds, and data-generating scripts.
- [x] Classify each item as configuration, authoritative API data, cached fallback, derived snapshot, or demo fixture.
- [x] Verify official Census, Philadelphia/ArcGIS, and CARTO endpoints.
- [x] Define and implement source precedence with response validation.
- [x] Add or extend focused tests.
- [x] Run project validation, dependency audit, and production build.
- [x] Run local and deployed browser smoke checks for Crime and Diary modes.
- [x] Commit, merge, push, and verify GitHub Actions/Pages.
- [x] Archive this task record after all external state matches the evidence.

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
| Pull request | `#16` merged as `deac63bb74020f93be244fd38778dc376b8641ce`. |
| Main CI | Run `30514807469` passed. |
| Runtime Pages | Run `30514807468` built and deployed successfully. |
| Production assets | Root, JavaScript, CSS, demo segments, and demo routes returned HTTP 200. |
| Production Crime | Police, TIGER, Census Reporter, and CARTO requests returned HTTP 200; zero browser errors or warnings. |
| Production Diary | 246 segments and 5 routes loaded; submission updated 48 segments with `persisted: false`; zero browser errors or warnings. |
| Repository checkout | Removed an unconfigured, unreferenced `Routesafetydiaryui` gitlink that caused checkout cleanup warnings. |

## Remaining product limitations

- Shared Diary submissions still need a separate writable service; GitHub Pages only hosts static assets.
- The largest production JavaScript chunk is about 1.1 MB minified, so code splitting remains a useful performance follow-up.
- GitHub Actions currently emits Node 20 deprecation annotations even though both workflows pass.
