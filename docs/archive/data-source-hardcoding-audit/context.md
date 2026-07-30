# Context

## Starting repository state

- Branch created from deployed `main`: `agent/audit-data-sources`.
- Production deployment was already verified at `https://raederhans.github.io/engagement-project/`.
- Two uncommitted documentation corrections from the completed deployment archive were preserved on the branch.

## Final integration and deployment

- Pull request `#16` merged into `main` as runtime commit `deac63bb74020f93be244fd38778dc376b8641ce`.
- CI run `30514807469` passed and Pages run `30514807468` built and deployed successfully.
- The production root and its referenced JavaScript and CSS assets returned HTTP 200.
- Crime browser verification observed HTTP 200 from CARTO, the City police service, TIGERweb, and Census Reporter with zero console errors or warnings.
- Diary browser verification loaded 246 segments and 5 routes from same-origin Pages assets. A four-star submission updated 48 segments, repainted in 4 ms, and reported `mode: demo` and `persisted: false` with zero console errors or warnings.
- The final task-archive commit is documentation-only; it does not change the verified runtime bundle.

## Initial evidence

- `src/config.js` centralizes CARTO, police district, tract, and 2023 ACS endpoints, but embeds the Philadelphia state/county identifiers and ACS year in URL strings.
- `src/api/acs.js` currently loads `src/data/acs_tracts_2023_pa101.json` before calling Census APIs.
- `src/api/boundaries.js` currently loads bundled police-district and tract files before live endpoints.
- Diary routes and segment ratings are explicitly named `.demo.geojson`; they are product demo fixtures, not authoritative public records.
- The repository contains a roughly 59 MB optional network GeoJSON that is intentionally disabled in production unless enabled by a feature flag.

## Verified source policy

- Crime incidents remain live CARTO queries. The table currently covers records from 2006 onward, so the former 2015 UI floor was removed.
- Police districts load the City of Philadelphia ArcGIS API first and fall back to the bundled GeoJSON only after response validation fails.
- Census tracts load Census TIGERweb first, followed by PASDA and Esri endpoints, then the bundled GeoJSON fallback.
- The current Census API requires a key. GitHub Pages cannot safely hold that credential, so Census Reporter supplies the default live ACS 2024 five-year data; optional managed/proxy Census URLs can override it. The bundled 2023 ACS file is last-resort fallback only.
- Diary route and segment seed files remain intentional demo fixtures served as versioned, same-origin HTTPS assets. A configured `VITE_DIARY_API_BASE` enables real writes; without it the UI reports browser-only demo results and never invents persisted analytics.

## User clarification

- The intended product is an online, interactive showcase. Runtime requests must not depend on a developer workstation.
- Bundled demo geometry may remain only when Vite publishes it as an HTTPS application asset; changing factual datasets should prefer online APIs.
- Shared Diary persistence still requires a real writable backend. GitHub Pages cannot host that API, so the client contract is configurable and demo mode must never claim remote persistence.

## Live process ownership

- Owner: root agent only.
- Command: `npm run preview -- --host 127.0.0.1 --port 4173` from the repository root.
- Shared resource: TCP port 4173 and the built `dist/` directory; browser checks run serially against this single server.
- Logs: `%TEMP%\\engagement-data-source-audit\\preview.stdout.log` and `preview.stderr.log`.
- Success condition: HTTP 200 plus Crime and Diary browser checks with no unexpected console errors; stop after evidence is captured.
- Failure condition: server exit, repeated browser failure under the same assumption, or invalid live data; the owner alone may retry or stop it.

## Next step

Add a separate writable backend when shared Diary submissions are required, then configure it through `VITE_DIARY_API_BASE` without placing private credentials in the Pages bundle.
