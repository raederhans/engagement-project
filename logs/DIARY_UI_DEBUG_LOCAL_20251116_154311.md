# Diary UI Debug Log 20251116_154311

- start: 2025-11-16T15:43:11-05:00
- npm install

up to date, audited 219 packages in 1s

133 packages are looking for funding
  run `npm fund` for details

2 moderate severity vulnerabilities

To address all issues, run:
  npm audit fix

Run `npm audit` for details.
- npm run build

> dashboard-project@0.0.0 build
> vite build

[36mvite v5.4.20 [32mbuilding for production...[36m[39m
transforming...
[1m[33m[plugin:vite:resolve][39m[22m [33m[plugin vite:resolve] Module "node:fs/promises" has been externalized for browser compatibility, imported by "C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/utils/http.js". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.[39m
[1m[33m[plugin:vite:resolve][39m[22m [33m[plugin vite:resolve] Module "node:fs/promises" has been externalized for browser compatibility, imported by "C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/utils/http.js". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.[39m
[32m✓[39m 669 modules transformed.
rendering chunks...
[1m[33m[plugin:vite:reporter][39m[22m [33m[plugin vite:reporter] 
(!) C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/utils/http.js is dynamically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/ui/panel.js but also statically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/acs.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/boundaries.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/crime.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/meta.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/points.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/tracts_view.js, dynamic import will not move module into another chunk.
[39m
[1m[33m[plugin:vite:reporter][39m[22m [33m[plugin vite:reporter] 
(!) C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/points.js is dynamically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/main.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/main.js but also statically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/main.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/wire_points.js, dynamic import will not move module into another chunk.
[39m
computing gzip size...
[2mdist/[22m[32mindex.html                                  [39m[1m[2m   11.66 kB[22m[1m[22m[2m │ gzip:   2.77 kB[22m
[33m
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[2mdist/[22m[32massets/routes_phl.demo-mkRiNbB7.geojson     [39m[1m[2m   22.20 kB[22m[1m[22m
[2mdist/[22m[32massets/segments_phl.demo-CJVI98fl.geojson   [39m[1m[2m   39.04 kB[22m[1m[22m
[2mdist/[22m[35massets/index-rqFrHuTF.css                   [39m[1m[2m    0.40 kB[22m[1m[22m[2m │ gzip:   0.30 kB[22m
[2mdist/[22m[36massets/__vite-browser-external-BIHI7g3E.js  [39m[1m[2m    0.03 kB[22m[1m[22m[2m │ gzip:   0.05 kB[22m
[2mdist/[22m[36massets/index-dEpk8lqN.js                    [39m[1m[2m  159.66 kB[22m[1m[22m[2m │ gzip:  50.13 kB[22m
[2mdist/[22m[36massets/index-fpiT8f1x.js                    [39m[1m[33m1,100.14 kB[39m[22m[2m │ gzip: 319.06 kB[22m
[32m✓ built in 3.10s[39m
- npm run preview (5s smoke)

> dashboard-project@0.0.0 preview
> vite preview --host --port 4173 --strictPort

  [32m➜[39m  [1mLocal[22m:   [36mhttp://localhost:[1m4173[22m/[39m
  [32m➜[39m  [1mNetwork[22m: [36mhttp://172.21.96.1:[1m4173[22m/[39m
  [32m➜[39m  [1mNetwork[22m: [36mhttp://10.192.1.210:[1m4173[22m/[39m
- npm run data:gen

> dashboard-project@0.0.0 data:gen
> node scripts/generate_demo_data.mjs --seed=20251111 --segments=64 --routes=5

[Diary] Demo data generated: 64 segments, 5 routes (seed=20251111).
- npm run data:check

> dashboard-project@0.0.0 data:check
> node scripts/validate_demo_data.mjs

[Diary] OK — 64 segments / 5 routes validated.
- npm run build (post-fix)

> dashboard-project@0.0.0 build
> vite build

[36mvite v5.4.20 [32mbuilding for production...[36m[39m
transforming...
[1m[33m[plugin:vite:resolve][39m[22m [33m[plugin vite:resolve] Module "node:fs/promises" has been externalized for browser compatibility, imported by "C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/utils/http.js". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.[39m
[1m[33m[plugin:vite:resolve][39m[22m [33m[plugin vite:resolve] Module "node:fs/promises" has been externalized for browser compatibility, imported by "C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/utils/http.js". See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.[39m
[32m✓[39m 663 modules transformed.
rendering chunks...
[1m[33m[plugin:vite:reporter][39m[22m [33m[plugin vite:reporter] 
(!) C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/utils/http.js is dynamically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/ui/panel.js but also statically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/acs.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/boundaries.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/crime.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/api/meta.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/points.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/tracts_view.js, dynamic import will not move module into another chunk.
[39m
[1m[33m[plugin:vite:reporter][39m[22m [33m[plugin vite:reporter] 
(!) C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/points.js is dynamically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/main.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/main.js but also statically imported by C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/main.js, C:/Users/raede/Desktop/essay help master/6920Java/engagement-project/src/map/wire_points.js, dynamic import will not move module into another chunk.
[39m
computing gzip size...
[2mdist/[22m[32mindex.html                                  [39m[1m[2m   11.66 kB[22m[1m[22m[2m │ gzip:   2.77 kB[22m
[2mdist/[22m[32massets/routes_phl.demo-mkRiNbB7.geojson     [39m[1m[2m   22.20 kB[22m[1m[22m
[2mdist/[22m[32massets/segments_phl.demo-CJVI98fl.geojson   [39m[1m[2m   39.04 kB[22m[1m[22m
[2mdist/[22m[35massets/index-rqFrHuTF.css                   [39m[1m[2m    0.40 kB[22m[1m[22m[2m │ gzip:   0.30 kB[22m
[2mdist/[22m[36massets/__vite-browser-external-BIHI7g3E.js  [39m[1m[2m    0.03 kB[22m[1m[22m[2m │ gzip:   0.05 kB[22m
[2mdist/[22m[36massets/index-DMxzHQZ9.js                    [39m[1m[2m  160.22 kB[22m[1m[22m[2m │ gzip:  50.65 kB[22m
[2mdist/[22m[36massets/index-ayePJxHg.js                    [39m[1m[33m1,100.23 kB[39m[22m[2m │ gzip: 319.10 kB[22m
[33m
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 3.66s[39m

## Findings
- Integrated diary stuck on skeleton because `initDiaryMode` bailed unless `VITE_FEATURE_DIARY=1`, ignoring `?mode=diary` override.
- Demo page blank because both store gating and init guard disabled diary when loaded via `diary-demo.html` without env/query flags.

## Fixes applied
- `store.js` now treats `diary-demo.html` as diary-enabled (and logs path) so `setViewMode('diary')` and panel toggle work without env tweaks.
- `routes_diary/index.js` now reuses diary gating (env, ?mode=diary, or demo path) instead of env-only guard; warning message updated accordingly.
- `diary-demo.html` pulls MapLibre CSS and forces block layout for a visible left panel alongside the map.

## Build/validation notes
- npm run data:gen | data:check | build all succeed locally; build still emits Vite externalized fs/promises + chunk size warnings (pre-existing).

## Manual validation (user-facing)
1) Integrated: run `npm run dev`, open http://localhost:5173/?mode=diary. Expect full diary panel (route picker w/5 routes, alt toggle, benefit strip, Rate CTA + simulator). Demo data loads (console logs 64 segments/5 routes). Hover CTAs active; alt toggle and route select repaint overlays; rating modal updates segment colors + benefit strip.
2) Standalone demo: run `npm run dev`, open http://localhost:5173/diary-demo.html. Map + left diary panel show the same controls and demo data without needing ?mode=diary or env flags.
3) Preview: `npm run preview -- --host --port 4173 --strictPort` (tested 5s smoke; server prints local URL and can be stopped with Ctrl+C).
