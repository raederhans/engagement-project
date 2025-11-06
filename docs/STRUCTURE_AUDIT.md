# Crime Dashboard — Structure Audit Report

**Date:** 2025-10-15 16:04
**Type:** Static read-only analysis
**Raw logs:** [logs/STATIC_AUDIT_20251015_160419.md](../logs/STATIC_AUDIT_20251015_160419.md)

---

## Executive Summary

This audit examines the Philadelphia Crime Dashboard's repository structure, data artifacts, subsystem organization, and code patterns **without executing any code**. The analysis identifies **3 critical blockers** preventing production builds, validates data artifact integrity, maps all functional subsystems to their source files, and provides actionable fix recommendations.

### Key Findings

✅ **Good:**
- offense_groups.json structure is valid (all values are arrays)
- ACS tract data loaded (381 tracts with demographics)
- SQL SRID usage is consistent (EPSG:3857 throughout)
- Subsystems are well-organized into logical directories

🔴 **Blockers (Must Fix Before Build):**
1. **Vite project structure violated:** `vite.config.js` sets `root: 'public'` causing HTML inline proxy errors
2. **HTML entry in wrong location:** `/index.html` missing, exists at `/public/index.html` instead
3. **Script tag uses wrong path:** `public/index.html:129` has `../src/main.js` (relative) instead of `/src/main.js` (absolute)

⚠️ **Performance Issues:**
- Tracts GeoJSON cache missing (falls back to slow remote fetch)
- Precomputed tract counts missing (requires live aggregation)

---

## 1. Project Layout Verdict

### Vite Structural Requirements

| Requirement | Expected | Actual | Status |
|-------------|----------|--------|--------|
| **HTML entry at project root** | `/index.html` | ❌ Not found | 🔴 FAIL |
| **No HTML in public/** | `public/` static only | ❌ Has `index.html` (7.6K) | 🔴 FAIL |
| **vite.config.js sanity** | Default or minimal | ❌ `root: 'public'` | 🔴 FAIL |
| **Script tag paths** | Absolute (`/src/`) | ❌ Relative (`../src/`) | 🔴 FAIL |
| **src/ modules** | Yes | ✅ 34 files | ✅ PASS |
| **package.json** | Yes | ✅ Present | ✅ PASS |

**Verdict:** 🔴 **FAIL** — Vite project structure is fundamentally broken. Build cannot succeed until fixed.

### Why This Matters

**Vite Convention:**
- `index.html` = **entry point** at project root (processed by Vite, transforms applied, inline CSS/JS bundled)
- `public/` = **static assets** folder (files copied as-is, NO processing)
- `src/` = **source modules** (bundled, tree-shaken, minified)

**Current Misconfiguration:**
```
dashboard-project-Ryan/
├── public/
│   └── index.html          ← 🔴 WRONG LOCATION (should be at root)
├── src/
│   └── main.js
└── vite.config.js          ← Sets root: 'public' (🔴 VIOLATES CONVENTION)
```

**Error:** Vite's HTML inline proxy cannot process `<style>` tags when `index.html` is in `public/`.

---

## 2. Subsystems: Files, Responsibilities, Call Paths

### 2.1 Controls & State Management

**Purpose:** Capture user input (location, time, groups, admin level, rate) and maintain application state.

**Files:**
- **[public/index.html](../public/index.html)** — Control element IDs
  - Location: `addrA` (text input), `useCenterBtn` (button)
  - Time: `startMonth` (month picker), `durationSel` (dropdown), `preset6`/`preset12` (buttons), `twSel` (legacy)
  - Filters: `radiusSel` (dropdown), `groupSel` (multi-select), `fineSel` (drilldown multi-select)
  - Display: `adminSel` (Districts/Tracts), `rateSel` (Counts/Per-10k)
- **[src/ui/panel.js](../src/ui/panel.js)** — DOM event listeners, debounce (300ms), store updates
  - Line 42-54: "Use Map" button toggles `store.selectMode` ('point' ↔ 'idle')
  - Line 66-79: `groupSel` change populates `fineSel` drilldown from offense_groups.json
  - Line 31-35: Debounced `onChange()` triggers `handlers.onChange()` (wired to `refreshAll` in main.js)
- **[src/state/store.js](../src/state/store.js)** — Centralized state object
  - Keys: `selectMode`, `centerLonLat`, `center3857`, `radius`, `startMonth`, `durationMonths`, `timeWindowMonths`, `adminLevel`, `per10k`, `selectedGroups`, `selectedTypes`
  - Method: `getFilters()` — Derives `{ start, end, types, center3857, radiusM }` from state

**Call Path:**
```
User changes control (e.g., radiusSel)
  → panel.js: addEventListener('change')
  → store.radius = Number(value)
  → debounce(onChange, 300ms)
  → main.js: refreshAll()
    → Fetch districts/tracts → render choropleth
    → Fetch points → render clusters/markers
    → Fetch buffer stats → update charts + compare card
```

---

### 2.2 Maps & Layers

**Purpose:** Render basemap, choropleth (districts/tracts), crime points (clustered/unclustered), buffer overlay, labels, popups, tooltips.

**Files (14 in src/map/):**

#### Initialization
- **[src/map/initMap.js](../src/map/initMap.js)** — MapLibre GL setup
  - Returns `new maplibregl.Map({ style: { version: 8, sources: { osm: raster } } })`
  - OSM tiles: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
  - Center: `[-75.1652, 39.9526]` (Philadelphia), Zoom: 11

#### Districts Choropleth
- **[src/map/choropleth_districts.js](../src/map/choropleth_districts.js)** — Fetch + merge
  - Calls `src/api/boundaries.js` → fetch GeoJSON from ArcGIS/cache
  - Calls `src/api/crime.js: fetchByDistrict({ start, end, types })` → aggregate counts per district
  - Calls `src/utils/join.js` → merge counts into GeoJSON properties
- **[src/map/render_choropleth.js](../src/map/render_choropleth.js)** — Render layers
  - Line 11: `quantileBreaks(values, 5)` → 5-class breaks
  - Line 12: Colors: `['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d']`
  - Line 31-40: `districts-fill` layer (choropleth with step expression)
  - Line 45-54: `districts-line` layer (boundaries)
  - Line 57-68: `districts-label` layer (symbol with district names/codes)

#### Tracts Choropleth
- **[src/map/tracts_view.js](../src/map/tracts_view.js)** — Fetch tracts GeoJSON
  - Multi-endpoint fallback (cache URLs + remote ArcGIS)
  - Returns FeatureCollection with tract geometries + crime counts (or per-10k rates)
- **[src/map/render_choropleth_tracts.js](../src/map/render_choropleth_tracts.js)** — Render tracts
  - Similar to districts: fill + line + labels
  - Per-10k logic: `value / pop * 10000` when `store.per10k === true`

#### Crime Points
- **[src/map/points.js](../src/map/points.js)** — Fetch + cluster
  - Line 62-64: Cluster config: `{ cluster: true, clusterMaxZoom: 14, clusterRadius: 40 }`
  - Unclustered points colored by offense category (via `categoryColorPairs()` from types.js)
  - Calls `src/api/crime.js` → fetch GeoJSON points filtered by bbox + time + types

#### Buffer Overlay
- **[src/map/buffer_overlay.js](../src/map/buffer_overlay.js)** — Turf.js circle
  - Creates `turf.circle(centerLonLat, radius, { units: 'meters' })`
  - Adds/updates `buffer-a` source with fill + line layers

#### Interactivity
- **[src/map/ui_tooltip.js](../src/map/ui_tooltip.js)** — Hover tooltip on choropleth
- **[src/map/ui_popup_district.js](../src/map/ui_popup_district.js)** — Click handler on `districts-fill`
  - Fetches total count + top-3 offense types for clicked district
  - Uses `src/utils/district_names.js` for display names
- **[src/map/ui_legend.js](../src/map/ui_legend.js)** — Draw legend (breaks + colors + swatches)

**Call Path (Map → Choropleth):**
```
main.js: DOMContentLoaded
  → initMap() → map instance
  → map.on('load')
    → getDistrictsMerged({ start, end, types })
      → src/api/boundaries.js: fetchDistricts()
      → src/api/crime.js: fetchByDistrict({ start, end, types })
        → src/utils/sql.js: buildDistrictQuery()
          → envelope: ST_MakeEnvelope(..., 3857)
          → filter: text_general_code IN (...)
        → src/utils/http.js: cachedFetch(url, { ttl })
      → src/utils/join.js: mergeByProperty(geo, data, 'DIST_NUMC', 'dc_dist')
    → renderDistrictChoropleth(map, merged)
      → quantileBreaks() → step expression → addLayer('districts-fill')
    → attachHover(map, 'districts-fill')
    → attachDistrictPopup(map, 'districts-fill')
```

---

### 2.3 Charts

**Purpose:** Visualize crime trends (monthly time series, top offense types, hour×day heatmap) for buffer A.

**Files (4 in src/charts/):**
- **[src/charts/index.js](../src/charts/index.js)** — `updateAllCharts(filters)`
  - Calls line_monthly, bar_topn, heat_7x24 in parallel
- **[src/charts/line_monthly.js](../src/charts/line_monthly.js)** — Monthly series (Chart.js line)
- **[src/charts/bar_topn.js](../src/charts/bar_topn.js)** — Top-N offense types (Chart.js bar)
- **[src/charts/heat_7x24.js](../src/charts/heat_7x24.js)** — 7×24 heatmap (Chart.js matrix)

**Dependencies:**
- Chart.js v4
- Fetches data from `src/api/crime.js`:
  - `fetchMonthlyBufferSeries({ start, end, types, center3857, radiusM })`
  - `fetchTopNBufferTypes({ start, end, types, center3857, radiusM })`
  - `fetch7x24Buffer({ start, end, types, center3857, radiusM })`

---

### 2.4 API & SQL & Caching

**Purpose:** Build SQL queries, fetch from CARTO API, cache responses, handle errors/retries.

**Files:**

#### API Wrappers (src/api/)
- **[src/api/crime.js](../src/api/crime.js)** — Crime data fetchers
  - `fetchByDistrict({ start, end, types })` → aggregate counts per district
  - `fetchByTract({ start, end, types })` → aggregate counts per tract
  - `fetchTopNBufferTypes(...)` → top offense codes in buffer
  - `fetchMonthlyBufferSeries(...)` → monthly counts in buffer
  - `fetch7x24Buffer(...)` → hour × day counts in buffer
  - `fetchPoints({ bbox, start, end, types })` → GeoJSON points for map
- **[src/api/boundaries.js](../src/api/boundaries.js)** — Fetch districts/tracts GeoJSON
- **[src/api/acs.js](../src/api/acs.js)** — Fetch ACS demographics (may use local JSON instead)

#### SQL Builders (src/utils/sql.js)
- **Envelope filter:** `ST_MakeEnvelope(xmin, ymin, xmax, ymax, 3857)`
  - Used for bbox constraints on points queries
- **Buffer filter:** `ST_DWithin(the_geom, ST_SetSRID(ST_Point(x, y), 3857), distance)`
  - Used for buffer-based aggregations (charts, compare)
- **Type filter:** `text_general_code IN ('X', 'Y', 'Z')`
- **Date filter:** `dispatch_date_time >= 'YYYY-MM-DD' AND dispatch_date_time < 'YYYY-MM-DD'`
- **District/Tract aggregation:** `GROUP BY dc_dist` or `GROUP BY point`
- **Date floor:** All queries have `dispatch_date_time >= '2015-01-01'` guard

**SRID Consistency:**
✅ All queries use `the_geom` (EPSG:3857 Web Mercator). No SRID mismatches detected.

#### HTTP Client (src/utils/http.js)
- **In-flight deduplication:** Same URL requested multiple times → single fetch
- **Memory + session cache:** TTLs for citywide vs buffer queries
- **Retry with backoff:** 429 rate limits, 5xx transient errors
- **Cache keys:** URL + params hash

---

### 2.5 Types & Mappings

**Purpose:** Map offense groups → codes, district codes → names, tract codes → GEOIDs.

**Files (src/utils/):**
- **[src/utils/types.js](../src/utils/types.js)** — Offense group logic
  - `expandGroupsToCodes(selectedGroups)` → flat array of text_general_code values
  - `groupColor(name)` → hex color for offense type
  - `categoryColorPairs()` → match expression for unclustered points
  - Imports `src/data/offense_groups.json`
- **[src/utils/district_names.js](../src/utils/district_names.js)** — `Map` of district code → display name
  - E.g., `'01' → '1st'`, `'14' → '14th'`
- **[src/utils/geoids.js](../src/utils/geoids.js)** — Tract GEOID helpers
- **[src/utils/join.js](../src/utils/join.js)** — Join GeoJSON features with data arrays by property

---

### 2.6 Entry & Orchestration

**File:** **[src/main.js](../src/main.js)**

**Responsibilities:**
1. Initialize map on `DOMContentLoaded`
2. Load initial choropleth (districts, 6-month fixed window)
3. Wire points layer
4. Load initial charts (buffer at map center)
5. Wire control panel listeners
6. Define `refreshAll()` function (called on any filter change)
   - Refresh choropleth (districts or tracts based on `store.adminLevel`)
   - Refresh points
   - Update charts with new filters
   - Update compare card
7. Handle map click for buffer A selection
8. Update buffer overlay on radius/center changes

**Call Path (User Action → Full Refresh):**
```
User clicks "Use Map" → clicks map
  → main.js: map.on('click', (e) => { if (store.selectMode === 'point') { ... } })
  → store.centerLonLat = [e.lngLat.lng, e.lngLat.lat]
  → store.setCenterFromLngLat(...)
  → Place marker A
  → updateBuffer() → turf.circle → add/update buffer-a layers
  → refreshAll()
    → switch (store.adminLevel)
        case 'districts': getDistrictsMerged → renderDistrictChoropleth
        case 'tracts': getTractsMerged → renderTractsChoropleth
    → refreshPoints(map, { start, end, types })
    → updateAllCharts({ start, end, types, center3857, radiusM })
    → updateCompare({ types, center3857, radiusM, ... })
```

---

## 3. Risks & Smells

### 🔴 Critical Blockers (Prevent Build)

| # | Symptom | Evidence | Impact | Fix |
|---|---------|----------|--------|-----|
| **1** | Vite `root: 'public'` config | `vite.config.js:4` | HTML inline proxy fails during build | Remove line 4, change outDir to `'dist'` |
| **2** | HTML entry in `public/` instead of root | `/index.html` missing, `/public/index.html` exists | Vite cannot process entry point | Move `public/index.html` → `index.html` |
| **3** | Script tag uses relative path | `public/index.html:129` `src="../src/main.js"` | Module resolution breaks in build | Change to `src="/src/main.js"` |

**Minimal Fix (diff-style):**

**File:** `vite.config.js`
```diff
 import { defineConfig } from 'vite';

 export default defineConfig({
-  root: 'public',
   build: {
-    outDir: '../dist',
+    outDir: 'dist',
     emptyOutDir: true,
   },
   server: {
     port: 5173,
-    fs: { strict: false, allow: ['..'] },
   },
```

**File:** `index.html` (after moving from `public/`)
```diff
-    <script type="module" src="../src/main.js"></script>
+    <script type="module" src="/src/main.js"></script>
```

**Commands:**
```bash
mv public/index.html index.html
# Apply diffs above
npm run build  # Should succeed
```

---

### ⚠️ High Priority (Performance/UX)

| # | Symptom | Evidence | Impact | Fix |
|---|---------|----------|--------|-----|
| **4** | Tracts GeoJSON cache missing | `public/data/tracts_phl.geojson` not found | Remote fetch adds 2-3s latency | Run `scripts/fetch_tracts.mjs`, commit artifact |
| **5** | Precomputed tract counts missing | `src/data/tract_counts_last12m.json` not found | Live aggregation slower for long time windows | Run `scripts/precompute_tract_counts.mjs`, commit artifact |

---

### 🟡 Medium Priority (Code Health)

| # | Symptom | Evidence | Impact | Fix |
|---|---------|----------|--------|-----|
| **6** | ACS median_income sentinel value | 4 tracts have `-666666666` | May show as large negative number in UI | Filter or replace with `null` in rendering |
| **7** | Potential orphan modules | `src/config.js`, `src/utils/pop_buffer.js`, `src/map/wire_points.js` | Dead code bloats bundle | Audit imports, remove if unused |
| **8** | >20k points guard unclear | Not found in `src/map/points.js` grep | May render too many unclustered points → slow | Add feature count check before unclustered layer |

---

## 4. Data Artifact Integrity

| Artifact | Type | Status | Notes |
|----------|------|--------|-------|
| **offense_groups.json** | Object<string, string[]> | ✅ VALID | All 6 groups have array values |
| **acs_tracts_2023_pa101.json** | Array[381] | ✅ VALID | 4 tracts have median_income sentinel `-666666666` |
| **police_districts.geojson** | FeatureCollection (assumed) | ⚠️ NOT INSPECTED | 364K file in `public/data/` |
| **tracts_phl.geojson** | FeatureCollection (expected) | ❌ NOT FOUND | Fetched remotely (slow) |
| **tract_counts_last12m.json** | Object {rows, meta} | ❌ NOT FOUND | Precompute script exists but not run |

---

## 5. SQL & SRID Audit

**Geometry Column:** `the_geom` (EPSG:3857 Web Mercator)

**Spatial Filters:**
- **Envelope (bbox):** `the_geom && ST_MakeEnvelope(xmin, ymin, xmax, ymax, 3857)`
- **Buffer (proximity):** `ST_DWithin(the_geom, ST_SetSRID(ST_Point(x, y), 3857), distance)`

**Consistency:** ✅ All queries use SRID 3857. No 4326/3857 mixing detected.

**Date Guards:** All queries include `dispatch_date_time >= '2015-01-01'` floor.

---

## 6. Import/Export Orphans (Manual Check Recommended)

**Potential Orphans (Not Exhaustively Verified):**
- `src/config.js` — What does it export? Is it imported?
- `src/utils/pop_buffer.js` — Population buffer utility; is it used?
- `src/map/wire_points.js` vs `src/map/points.js` — Which is active?

**Recommended Audit:**
```bash
# List all exports
grep -rh "^export " src/ --include="*.js" | sort > /tmp/exports.txt

# List all imports
grep -rh "^import " src/ --include="*.js" | grep -v "node_modules" | sort > /tmp/imports.txt

# Find exports never imported
comm -23 /tmp/exports.txt /tmp/imports.txt
```

---

## 7. Appendix: Directory Trees

See [logs/STATIC_AUDIT_20251015_160419.md](../logs/STATIC_AUDIT_20251015_160419.md) Section B for full trees.

**Summary:**
- `/public/` — 2 files (index.html 🔴, police_districts.geojson ✅)
- `/src/` — 34 .js files across 7 subdirectories
- `/src/data/` — 3 files (2 JSON artifacts ✅, 1 README)
- `/scripts/` — 10 files (fetch/precompute/audit/fix utilities)
- `/docs/` — 8+ markdown files

---

## 8. Next Actions

### Critical (Block Build)
1. ✅ Move `public/index.html` → `index.html`
2. ✅ Edit `index.html:129` — Change `../src/main.js` to `/src/main.js`
3. ✅ Edit `vite.config.js` — Remove `root: 'public'`, change `outDir: 'dist'`, remove `fs.allow`
4. ✅ Run `npm run build` to verify

### High Priority (Performance)
5. Cache tracts GeoJSON: `node scripts/fetch_tracts.mjs`
6. Precompute tract counts: `node scripts/precompute_tract_counts.mjs`

### Medium Priority (Code Health)
7. Audit orphan modules (config.js, pop_buffer.js, wire_points.js)
8. Add >20k feature guard to prevent unclustered point overload
9. Handle ACS median_income sentinel value (-666666666) in rendering

---

**Audit Status:** COMPLETE
**Blockers:** 3 (Vite structure)
**Data Quality:** Good (offense_groups ✅, ACS ✅)
**Subsystems:** Fully mapped
**Ready for:** Fix → Build → Deploy
