# Task

## Status

Complete. GitHub Pages is deployed from `main`, required assets are reachable, and both public modes pass live browser smoke checks.

## Completed checklist

- [x] Confirm production URL and repository-subpath assumptions.
- [x] Add the Pages workflow and repository-aware Vite base.
- [x] Validate data, tests, dependency audit, build, and generated assets.
- [x] Integrate all deployment and runtime fixes into `main`.
- [x] Verify CI and Pages Actions runs.
- [x] Exercise Crime and Diary modes in the deployed browser.
- [x] Rank the remaining improvements.

## Validation evidence

| Check | Result |
| --- | --- |
| GitHub Pages configuration | Workflow build type, HTTPS enforced, production URL active. |
| Final CI run `30513404951` | Passed on `d4d0e9d`. |
| Final Pages run `30513404940` | Build and deploy jobs passed on `d4d0e9d`. |
| Production root and referenced assets | HTTP 200 for HTML, JavaScript, CSS, favicon, district data, tract data, and bundled demo assets. |
| Crime browser smoke | Map loaded; point selection and radius update completed; CARTO requests used POST; 0 console errors. |
| Diary browser smoke | `Route Safety Diary (demo)`, route chooser, and Insights control visible; 0 console errors. |
| Pages-environment `npm run validate` | Demo-data validation, math tests, aggregation tests, and Vite build passed. |
| `npm audit --audit-level=high` | 0 vulnerabilities. |
| `git diff --check` | Passed. |

## Ranked follow-up work

1. **Add a browser smoke job to CI.** Exercise the built site in Crime and Diary modes, fail on console errors, and verify one map-selection interaction. This task found several real defects that unit scripts and an HTTP 200 check missed.
2. **Reduce the initial JavaScript payload.** The main production chunk is about 1.11 MB minified and 322 KB gzip. Remove mixed static/dynamic imports, isolate browser and Node logging, and lazy-load chart/map/Diary owners by route or mode before adding manual chunk configuration.
3. **Design a delivery format for the optional road network.** The checked-in source is about 59 MB. Prefer simplified geometry, tiled delivery, or a deliberately bounded subset; only enable `VITE_DIARY_NETWORK_DATA=1` when the artifact ships with the build.
4. **Create a reproducible tract-snapshot pipeline.** Generate, validate, timestamp, and publish the crime snapshot with provenance, then enable `VITE_TRACT_CRIME_SNAPSHOT=1`. Do not publish an empty placeholder.
5. **Refresh GitHub Actions runtimes.** Successful runs still warn that current action revisions target deprecated Node.js 20 and are forced onto Node.js 24; update official actions and investigate the post-job Git exit-128 annotation.
6. **Improve Diary discoverability.** The public root defaults to Crime and the Diary button remains gated unless `?mode=diary` is used. Add an explicit public entry link or product-approved feature flag once the intended navigation is decided.
7. **Do a responsive and accessibility pass.** The desktop uses fixed 300 px and 420 px panels over a full-screen map; validate narrow screens, focus order, control labels, contrast, and keyboard access before presenting it as a polished public product.
