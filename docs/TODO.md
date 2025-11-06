# TODO (Single Source of Truth)

## Pending

### Critical Bugs (Manager Audit Batch — 2025-10-20)

 - [ ] **DATA-drilldown**: Fix drilldown empty list bug (P0) - Critical typo in crime.js:223 sets `endIso = start` instead of `end`, creating zero-length time window. Drilldown list always shows "No sub-codes in this window" regardless of data.
   - **Root Cause**: [logs/DRILLDOWN_DIAG_20251020_194408.md](../logs/DRILLDOWN_DIAG_20251020_194408.md)
   - **Fix Plan**: [DRILLDOWN_FIX_PLAN.md](DRILLDOWN_FIX_PLAN.md)
   - **Acceptance**:
     - Select "Vehicle" group → Drilldown populates with 2 codes ("Motor Vehicle Theft", "Theft from Vehicle")
     - Select "Motor Vehicle Theft" → Map/charts filter to MVT only (not all vehicle crimes)
     - Empty window shows helpful hint: "Try expanding time range"
     - All 5 acceptance tests pass

 - [ ] **CHARTS-tracts**: Enable tract-level charts with live SQL (P1) - Tract mode currently shows citywide-only series, charts disabled. Implement polygon intersection queries to enable monthly/topN/7×24 charts for selected tract.
   - **Plan**: [TRACTS_CHARTS_PLAN.md](TRACTS_CHARTS_PLAN.md)
   - **Implementation**: Option 1 (Live SQL with `ST_Intersects`) — 3 new SQL builders, 3 API wrappers, update charts/index.js
   - **Acceptance**:
     - Click tract → All 3 charts populate within 1-2s (monthly, topN, 7×24)
     - Time window changes → Charts update to reflect new window
     - Offense filters apply to tract charts
     - Drilldown works with tract charts
     - Empty tract shows zero/empty charts with helpful message

 - [ ] **CHARTS-responsive**: Fix cramped chart heights on smaller viewports (P2) - Charts panel uses fixed pixel heights (140/160/180px), causing cramped layout on 768p displays and potential scrollbars. Implement CSS Grid with dynamic heights.
   - **Plan**: [CHARTS_RESPONSIVE_PLAN.md](CHARTS_RESPONSIVE_PLAN.md)
   - **Implementation**: CSS Grid with `flex-basis` percentages (30%/28%/32%), min/max height constraints, responsive breakpoints
   - **Acceptance**:
     - 768p display: Charts fit without scrollbar, no label truncation
     - Window resize: Charts adjust height smoothly
     - Mobile (≤768px): Panel moves to bottom, charts stack vertically
     - 1080p display: Charts use full 80vh, no excessive white space
     - All chart labels readable, no overlap

### UX Enhancements

 - [ ] UX-usemap: Implement select-on-map mode for "Use Map Center" button (owner: dev) - Toggle button to enable crosshair cursor; click map to set buffer center; render marker A + orange circle overlay.
   - Acceptance: Click "Select on Map" �?cursor crosshair �?click location �?marker appears �?circle renders �?address input updates �?mode exits
   - Test: Verify circle persists during pan/zoom; verify button text toggles; verify debounced refresh triggers

 - [ ] UX-radius: Add buffer circle visualization for radius selector (owner: dev) - Render orange circle at buffer center when radius changes; update circle geometry on dropdown change.
   - Acceptance: Set buffer center �?change radius to 800m �?circle expands to 800m �?change to 1600m �?circle expands again
   - Test: Verify circle uses EPSG:4326 for Turf.js; verify MapLibre projects correctly; verify no flicker on update

 - [ ] UX-timewindow: Replace fixed "last N months" with start + duration model (owner: dev) - Add `<input type="month">` for start date; add preset buttons ("Last 3mo", etc.); update store.getStartEnd() logic.
   - Acceptance: Leave start blank + select "Last 6mo" �?queries use (today - 6mo) to today; Set start "2023-01" + duration "6" �?queries use 2023-01-01 to 2023-07-01
   - Test: Click "Last 3mo" preset �?start input clears �?duration becomes 3; verify SQL logs show correct date ranges

 - [ ] UX-drilldown: Populate fine-grained codes dropdown dynamically from CARTO (owner: dev) - Query `SELECT DISTINCT text_general_code, COUNT(*) AS n WHERE text_general_code IN (...)` when groups selected; populate `#fineSel` with results.
   - Acceptance: Select "Property Crimes" �?drilldown shows "Loading..." �?populates with codes ("THEFT (12,345)", "RETAIL THEFT (8,901)", ...); Select specific codes �?map filters to those codes only
   - Test: Deselect all groups �?drilldown disables with "(select groups first)"; verify 60s cache TTL; verify loading spinner

 - [ ] BUG-group-blank: Fix offense group selection blanking map (owner: dev) - Run `node scripts/audit_offense_codes.js` to query CARTO for canonical text_general_code values; update offenseGroups in types.js or offense_groups.json with exact matches.
   - Acceptance: Run audit script �?verify output has >50 codes; Update offenseGroups with actual values; Select "Property Crimes" �?map renders with non-zero counts
   - Test: Run unit test to verify all group codes exist in canonical list; check SQL logs for `rows.length > 0`

 - [ ] UX-help: Add collapsible help card to control panel (owner: dev) - Insert `<details>` element with "How to Use This Dashboard" summary and 6 bullet points; add CSS styling to match panel.
   - Acceptance: Open dashboard �?help card collapsed; Click header �?card expands with instructions; Click again �?card collapses
   - Test: Verify styling matches existing panel components; verify no layout shift on expand/collapse

### Map Enhancements

 - [ ] MAP-tracts: Finalize Census Tracts view with precomputed counts (owner: dev) - Create `scripts/precompute_tract_counts.js` to generate last-12-months counts per tract; update tracts_view.js to use precomputed data (no population fallback).
   - Acceptance: Run precompute script �?JSON file created; Switch to "Census Tracts" �?tracts render with gradient; Toggle "Per 10k" �?legend updates; If precompute missing �?tracts show value=0
   - Test: Hover tract �?tooltip shows GEOID, count, population, rate; verify population < 500 masked in per-10k mode

 - [ ] MAP-district-labels: Show district names instead of numeric IDs (owner: dev) - Create district_names.js lookup table with ID �?name mapping (22 districts); update ui_tooltip.js to show "District 01 - Central: 123" format.
   - Acceptance: Hover District 01 �?tooltip shows "Central: 123"; Hover District 22 �?tooltip shows "North: 456"
   - Test: Hover invalid district �?tooltip shows "District XYZ: 0"; verify all 22 districts have names

 - [ ] MAP-click-popup: Implement click popup with detailed stats (owner: dev) - Add map.on('click', 'districts-fill') handler; render MapLibre Popup with district name, total, per-10k, 30d delta, top-3 offenses; query CARTO for top-3 if not cached.
   - Acceptance: Click district �?popup appears within 500ms; Shows district name, total, top-3 offenses; Click elsewhere �?popup closes
   - Test: Click during select-on-map mode �?no popup (buffer center set instead); verify 30s cache TTL; verify 2s timeout with spinner

## In Progress

 - [x] V1.2: Z-cache: http client caching + tract counts precompute (owner: codex) - HTTP layer adds LRU+session cache, in-flight dedupe, backoff + logs; tract counts script outputs src/data/tract_counts_last12m.json.
 - [x] Bootstrap Vite + deps (maplibre, turf, dayjs) and base folders (ID: A-boot) (owner: codex) - Vite scaffold & deps OK; smoke log: logs/npm_run_dev_*.out.log; 2 moderate dev-only vulnerabilities.
 - [x] Create API layer stubs in src/api/* with signatures from plan (ID: B-api) (owner: codex) - files created: src/config.js, src/utils/{http,sql}.js, src/api/{crime,boundaries,acs}.js, src/state/store.js.
 - [x] Implement SQL builders for endpoints Sec 2.1-2.6 (ID: B-sql) (owner: codex) - SQL builders implemented in src/utils/sql.js.
 - [x] Boundaries: fetch & cache Police Districts GeoJSON (ID: C-districts) (owner: codex) - cached to public/data/police_districts.geojson; logs: logs/fetch_districts_20251014_115926.log, logs/check_districts_20251014_115956.log.
  - [x] Map B (district choropleth) join dc_dist<->DIST_NUMC (ID: D-mapB) (owner: codex) - rendered districts choropleth with legend/tooltip; uses cached or remote boundaries.
  - [x] Map A (points) minimal render + bbox-limited fetch (ID: D-mapA) (owner: codex) - clustered points with bbox+time window; unclustered hidden when >20k; debounce and retry guards.
  - [x] Charts: monthly series (A vs citywide) (ID: E-series) (owner: codex) - chart.js installed; build passed.
  - [x] Charts: Top-N offenses (buffer A) (ID: E-topn) (owner: codex)
  - [x] Charts: 7x24 heatmap (buffer A) (ID: E-7x24) (owner: codex)
  - [x] Controls: address + radius + 3/6/12 months (ID: F-controls1) (owner: codex)
  - [x] Controls: offense groups + drilldown skeleton (ID: F-controls2) (owner: codex)
  - [x] AB compare card (total/per10k/top3/30d delta) (ID: G-compare) (owner: codex) - Compare A uses live count/top3/30d and per-10k (tracts); see logs/compare_queries_*.log.
  - [x] README: sources + limitations + disclaimers (ID: H-readme) (owner: codex) - README expanded with sources, limitations, run steps, caching/performance, compare A/B semantics.
  - [x] V1.1: cache ACS to src/data/acs_tracts_2023_pa101.json (ID: I-acs) (owner: codex) - cached to src/data/acs_tracts_2023_pa101.json; log: logs/fetch_acs_tracts_*.log. Tracts GeoJSON cache attempted: logs/fetch_tracts_*.log.
  - [x] V1.1: Tracts view + ACS join + per-10k (ID: I-tracts) (owner: codex) - tracts choropleth wired; ACS merged; per-10k toggle; population<500 masked.

## Blocked
*(codex writes reason + suggestion)*



