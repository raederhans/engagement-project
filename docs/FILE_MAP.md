# File Map — What to Edit for Common Changes

Quick reference guide for locating files when making specific modifications.

---

## Controls & UI

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Add new control element** | [public/index.html](../public/index.html) (or `/index.html` after fix) | Add HTML element with unique `id`, then wire in panel.js |
| **Wire control to state** | [src/ui/panel.js](../src/ui/panel.js) | `addEventListener` → update `store.*` → call `onChange()` |
| **Change debounce delay** | [src/ui/panel.js](../src/ui/panel.js) line 3 | Default: 300ms |
| **Button text/labels** | [public/index.html](../public/index.html) | Search for button id or text |

---

## State & Filters

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Default radius** | [src/state/store.js](../src/state/store.js) | `radius: 400` (meters) |
| **Default time window** | [src/state/store.js](../src/state/store.js) | `durationMonths: 6`, `timeWindowMonths: 6` |
| **Default admin level** | [src/state/store.js](../src/state/store.js) | `adminLevel: 'districts'` (or `'tracts'`) |
| **Filter derivation logic** | [src/state/store.js](../src/state/store.js) | `getFilters()` method |
| **Add new state property** | [src/state/store.js](../src/state/store.js) | Add key to store object, then access via `store.*` elsewhere |

---

## Offense Groups & Types

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Add/edit offense group** | [src/data/offense_groups.json](../src/data/offense_groups.json) | Format: `"GroupName": ["Code1", "Code2"]` (array required) |
| **Group expansion logic** | [src/utils/types.js](../src/utils/types.js) | `expandGroupsToCodes()` — maps groups → codes |
| **Point colors by category** | [src/utils/types.js](../src/utils/types.js) | `groupColor()`, `categoryColorPairs()` |
| **Control dropdown options** | [public/index.html](../public/index.html) | `<select id="groupSel">` — hardcoded options |

---

## Map: Basemap & Initialization

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Basemap tiles** | [src/map/initMap.js](../src/map/initMap.js) | OSM URL: `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| **Default center/zoom** | [src/map/initMap.js](../src/map/initMap.js) | `center: [-75.1652, 39.9526]`, `zoom: 11` |
| **Map style (version 8)** | [src/map/initMap.js](../src/map/initMap.js) | Replace `style` object for vector tiles, etc. |
| **Error badge hook** | [src/map/initMap.js](../src/map/initMap.js) | Add error handler for tile load failures |

---

## Map: Districts Choropleth

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **District fetch/cache** | [src/map/choropleth_districts.js](../src/map/choropleth_districts.js) | Calls `src/api/boundaries.js` → ArcGIS or cache |
| **Choropleth colors** | [src/map/render_choropleth.js](../src/map/render_choropleth.js) line 12 | 5-color array: `['#f1eef6', ...]` |
| **Number of breaks** | [src/map/render_choropleth.js](../src/map/render_choropleth.js) line 11 | `quantileBreaks(values, 5)` — change `5` |
| **District labels** | [src/map/render_choropleth.js](../src/map/render_choropleth.js) line 57-68 | Symbol layer config (text-field, text-size, halo) |
| **District names** | [src/utils/district_names.js](../src/utils/district_names.js) | Map of `code → name` (e.g., `'01' → '1st'`) |
| **Hover tooltip** | [src/map/ui_tooltip.js](../src/map/ui_tooltip.js) | Mousemove/mouseleave handlers |
| **Click popup** | [src/map/ui_popup_district.js](../src/map/ui_popup_district.js) | Fetch stats + display in MapLibre popup |
| **Legend** | [src/map/ui_legend.js](../src/map/ui_legend.js) | Draw swatches + labels for breaks/colors |

---

## Map: Tracts Choropleth

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Tracts GeoJSON fetch** | [src/map/tracts_view.js](../src/map/tracts_view.js) | Multi-endpoint fallback (cache URLs + ArcGIS) |
| **Tracts rendering** | [src/map/render_choropleth_tracts.js](../src/map/render_choropleth_tracts.js) | Fill + line + labels (similar to districts) |
| **Per-10k calculation** | [src/map/render_choropleth_tracts.js](../src/map/render_choropleth_tracts.js) | `value / pop * 10000` logic |
| **ACS demographics** | [src/data/acs_tracts_2023_pa101.json](../src/data/acs_tracts_2023_pa101.json) | Array[381] with pop, median_income, poverty_pct |
| **Precomputed counts** | [src/data/tract_counts_last12m.json](../src/data/tract_counts_last12m.json) | ❌ Not present; run `scripts/precompute_tract_counts.mjs` |

---

## Map: Crime Points

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Points fetch** | [src/map/points.js](../src/map/points.js) | Calls `src/api/crime.js: fetchPoints({ bbox, start, end, types })` |
| **Cluster config** | [src/map/points.js](../src/map/points.js) line 62-64 | `clusterMaxZoom: 14`, `clusterRadius: 40` |
| **Unclustered colors** | [src/map/points.js](../src/map/points.js) | Uses `categoryColorPairs()` from types.js |
| **Feature count guard** | [src/map/points.js](../src/map/points.js) | ⚠️ 20k limit logic (may need to add) |

---

## Map: Buffer Overlay

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Buffer circle creation** | [src/map/buffer_overlay.js](../src/map/buffer_overlay.js) | Uses Turf.js `circle(centerLonLat, radius, { units: 'meters' })` |
| **Buffer colors** | [src/map/buffer_overlay.js](../src/map/buffer_overlay.js) | Fill: `#38bdf8` (opacity 0.15), Line: `#0284c7` (width 1.5) |
| **Buffer update trigger** | [src/main.js](../src/main.js) | `updateBuffer()` called on map click + radius change |

---

## Charts

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Chart orchestration** | [src/charts/index.js](../src/charts/index.js) | `updateAllCharts(filters)` — calls all chart modules |
| **Monthly time series** | [src/charts/line_monthly.js](../src/charts/line_monthly.js) | Chart.js line config |
| **Top-N offense types** | [src/charts/bar_topn.js](../src/charts/bar_topn.js) | Chart.js bar config |
| **7×24 heatmap** | [src/charts/heat_7x24.js](../src/charts/heat_7x24.js) | Chart.js matrix config |
| **Chart colors/fonts** | Individual chart files | Chart.js options: `scales`, `plugins`, `backgroundColor`, etc. |

---

## API & SQL

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **SQL query builders** | [src/utils/sql.js](../src/utils/sql.js) | Envelope, buffer, filters, aggregations |
| **SRID (coordinate system)** | [src/utils/sql.js](../src/utils/sql.js) | All queries use EPSG:3857 (`the_geom`) |
| **Date floor guard** | [src/utils/sql.js](../src/utils/sql.js) | `dispatch_date_time >= '2015-01-01'` |
| **Crime data API** | [src/api/crime.js](../src/api/crime.js) | Fetch functions for points, districts, tracts, buffer stats |
| **Boundaries API** | [src/api/boundaries.js](../src/api/boundaries.js) | Fetch districts/tracts GeoJSON from ArcGIS or cache |
| **ACS demographics** | [src/api/acs.js](../src/api/acs.js) | May use local JSON instead of API |

---

## Caching & HTTP

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Cache TTLs** | [src/utils/http.js](../src/utils/http.js) | Memory/session TTLs for citywide vs buffer queries |
| **Retry/backoff** | [src/utils/http.js](../src/utils/http.js) | 429 rate limits, 5xx transient errors |
| **In-flight dedupe** | [src/utils/http.js](../src/utils/http.js) | Prevent duplicate concurrent requests |
| **Cache keys** | [src/utils/http.js](../src/utils/http.js) | URL + params hash |

---

## Compare Card

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Compare logic** | [src/compare/card.js](../src/compare/card.js) | Fetch buffer A stats, compute metrics |
| **Compare UI** | [public/index.html](../public/index.html) | `<div id="compare-card">` |

---

## Entry & Wiring

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **Init order** | [src/main.js](../src/main.js) | DOMContentLoaded → initMap → choropleth → points → charts → panel |
| **refreshAll() logic** | [src/main.js](../src/main.js) | Called on any filter change; orchestrates all updates |
| **Map click handler** | [src/main.js](../src/main.js) | Buffer A selection mode + marker placement |

---

## Static Assets & Config

| What to Change | File(s) to Edit | Notes |
|----------------|-----------------|-------|
| **HTML entry** | `/index.html` (🔴 CURRENTLY `public/index.html`) | Main HTML, control IDs, inline styles |
| **Vite config** | [vite.config.js](../vite.config.js) | 🔴 REMOVE `root: 'public'`, change `outDir: 'dist'` |
| **Police districts cache** | [public/data/police_districts.geojson](../public/data/police_districts.geojson) | 364K GeoJSON (update via `scripts/fetch_districts.js`) |
| **Tracts cache** | `public/data/tracts_phl.geojson` | ❌ NOT FOUND; create via `scripts/fetch_tracts.mjs` |

---

## Scripts & Data Generation

| What to Do | Script to Run | Output |
|------------|---------------|--------|
| **Fetch police districts** | `node scripts/fetch_districts.js` | `public/data/police_districts.geojson` |
| **Fetch tracts GeoJSON** | `node scripts/fetch_tracts.mjs` | `public/data/tracts_phl.geojson` |
| **Fetch ACS demographics** | `node scripts/fetch_acs_tracts.mjs` | `src/data/acs_tracts_2023_pa101.json` |
| **Precompute tract counts** | `node scripts/precompute_tract_counts.mjs` | `src/data/tract_counts_last12m.json` |
| **Audit offense codes** | `node scripts/audit_offense_codes.mjs` | Logs live codes from API |
| **Fix offense_groups.json** | `node scripts/fix_offense_groups.mjs` | Normalizes JSON structure |
| **Validate offense_groups** | `node scripts/validate_offense_groups.mjs` | Checks Object<string, string[]> shape |

---

## Common Scenarios

### Add a New Offense Group
1. Edit [src/data/offense_groups.json](../src/data/offense_groups.json)
   ```json
   "NewGroup": ["Code1", "Code2", "Code3"]
   ```
2. (Optional) Run `node scripts/validate_offense_groups.mjs` to verify
3. Add option to [public/index.html](../public/index.html) `<select id="groupSel">`
4. No code changes needed — `expandGroupsToCodes()` handles new groups automatically

### Change District Choropleth Colors
1. Edit [src/map/render_choropleth.js](../src/map/render_choropleth.js) line 12
   ```javascript
   const colors = ['#NEW_COLOR_1', '#NEW_COLOR_2', ...]; // 5 colors for 5 breaks
   ```
2. Refresh browser (no build needed in dev mode)

### Change Default Time Window to 12 Months
1. Edit [src/state/store.js](../src/state/store.js)
   ```diff
   - durationMonths: 6,
   + durationMonths: 12,
   - timeWindowMonths: 6,
   + timeWindowMonths: 12,
   ```
2. Refresh browser

### Add a New Field to District Popup
1. Edit [src/map/ui_popup_district.js](../src/map/ui_popup_district.js) line 21-26
2. Fetch additional data from API if needed
3. Update HTML template string

### Adjust Cache TTLs
1. Edit [src/utils/http.js](../src/utils/http.js)
2. Find TTL constants (e.g., `sessionTTL`, `memoryTTL`)
3. Change values (milliseconds)

---

**Last Updated:** 2025-10-15 16:04
**Related:** [STRUCTURE_AUDIT.md](STRUCTURE_AUDIT.md), [EDIT_POINTS.md](EDIT_POINTS.md)
