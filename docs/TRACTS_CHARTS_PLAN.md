# Tract-Level Charts — Feasibility + Implementation Options

**Status**: Feasible with current data
**Priority**: P1 (Feature enhancement, not blocking)
**Current Behavior**: Tract mode shows citywide-only series, charts disabled

---

## Executive Summary

**✅ FEASIBLE**: Tract-level charts can be enabled using existing CARTO incident points (point geometry) + local tract polygons (GeoJSON cache). Two implementation options:

1. **Option 1 (RECOMMENDED)**: Live SQL with polygon intersection — Instant after selection, ~200-500ms per query
2. **Option 2**: Precomputed monthly aggregations — Fastest runtime, requires periodic rebuild

---

## Current State Analysis

### Existing Behavior

**File**: [src/charts/index.js:64-80](../src/charts/index.js#L64-L80)

```javascript
} else {
  // tract mode (MVP): show citywide only, disable others
  [city] = await Promise.all([
    fetchMonthlySeriesCity({ start, end, types }),
  ]);
  topn = { rows: [] };
  heat = { rows: [] };
  bufOrArea = { rows: [] };
  const pane = document.getElementById('charts') || document.body;
  const status = document.getElementById('charts-status') || (() => {
    const d = document.createElement('div');
    d.id = 'charts-status';
    d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
    pane.appendChild(d);
    return d;
  })();
  status.textContent = 'Tract mode: charts are disabled for this cycle (citywide series only).';
}
```

**Impact**: Users can select tracts but see no tract-specific insights, reducing feature value.

---

### Available Resources

1. **Tract Geometry**: [public/data/tracts_phl.geojson](../public/data/tracts_phl.geojson)
   - 408 features, ~1.4 MB
   - Each feature has `GEOID` property (11-digit identifier)
   - Polygons in EPSG:3857 (Web Mercator)

2. **Runtime Fallback**: [src/api/boundaries.js:fetchTractsCachedFirst()](../src/api/boundaries.js)
   - Cache-first strategy
   - External endpoints: PASDA, TIGERweb Tracts_Blocks

3. **Selected Tract Access**: [src/state/store.js:44](../src/state/store.js#L44)
   - `selectedTractGEOID` — 11-digit string (e.g., "42101001600")
   - Available in `store.getFilters()` output

4. **Incident Points**: CARTO table `incidents_part1_part2`
   - Column: `the_geom` (PostGIS geometry, EPSG:3857)
   - ~2.5M rows (2015-2024)

---

## Option 1: Live SQL with Polygon Intersection (RECOMMENDED)

### Overview

When user selects a tract:
1. Retrieve tract's GeoJSON polygon from local cache (already in memory)
2. Convert polygon to WKT or GeoJSON string
3. Send to CARTO with `ST_Intersects` or `ST_Within` predicate
4. Return monthly/topN/7×24 aggregations for that tract

### Advantages ✅

- ✅ **No precomputation** — Works immediately after tract selection
- ✅ **Always current** — Reflects latest CARTO data
- ✅ **Flexible time windows** — User can adjust start/end on the fly
- ✅ **Offense filters work** — Types/drilldown codes apply normally

### Performance ⚡

- **Typical query time**: 200-500ms (tract polygons are small, spatial index efficient)
- **Acceptable for user**: Charts update within 1-2s (similar to buffer mode)

### Implementation Details

---

#### A) Add SQL Builders

**File**: `src/utils/sql.js`

**New Functions**:

##### 1. Monthly Series by Tract

```javascript
/**
 * Build SQL for monthly series within a single tract polygon.
 * @param {{start:string,end:string,types?:string[],drilldownCodes?:string[],tractGeoJSON:object}} params
 * @returns {string} SQL statement
 */
export function buildMonthlyTractSQL({ start, end, types, drilldownCodes, tractGeoJSON }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });

  // Convert GeoJSON to PostGIS geometry
  const geoJsonStr = JSON.stringify(tractGeoJSON).replace(/'/g, "''");
  clauses.push(`  AND ST_Intersects(the_geom, ST_SetSRID(ST_GeomFromGeoJSON('${geoJsonStr}'), 3857))`);

  return [
    "SELECT date_trunc('month', dispatch_date_time) AS m, COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1 ORDER BY 1",
  ].join("\n");
}
```

**Alternative (WKT format)**:
```javascript
// If CARTO doesn't support ST_GeomFromGeoJSON, use WKT
const wkt = tractPolygonToWKT(tractGeoJSON); // Helper function to convert
clauses.push(`  AND ST_Intersects(the_geom, ST_SetSRID(ST_GeomFromText('${wkt}'), 3857))`);
```

##### 2. Top-N Types by Tract

```javascript
/**
 * Build SQL for top-N offense types within a tract polygon.
 * @param {{start:string,end:string,tractGeoJSON:object,limit?:number}} params
 * @returns {string} SQL statement
 */
export function buildTopTypesTractSQL({ start, end, tractGeoJSON, limit = 12 }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  // Note: includeTypes: false to aggregate all codes, not filter by them
  const clauses = baseTemporalClauses(startIso, endIso, undefined, { includeTypes: false });

  const geoJsonStr = JSON.stringify(tractGeoJSON).replace(/'/g, "''");
  clauses.push(`  AND ST_Intersects(the_geom, ST_SetSRID(ST_GeomFromGeoJSON('${geoJsonStr}'), 3857))`);

  const limitValue = ensurePositiveInt(limit, 'limit');

  return [
    "SELECT text_general_code, COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    `GROUP BY 1 ORDER BY n DESC LIMIT ${limitValue}`,
  ].join("\n");
}
```

##### 3. 7×24 Heatmap by Tract

```javascript
/**
 * Build SQL for 7×24 heatmap aggregates within a tract polygon.
 * @param {{start:string,end:string,types?:string[],drilldownCodes?:string[],tractGeoJSON:object}} params
 * @returns {string} SQL statement
 */
export function buildHeatmap7x24TractSQL({ start, end, types, drilldownCodes, tractGeoJSON }) {
  const startIso = dateFloorGuard(start);
  const endIso = ensureIso(end, 'end');
  const clauses = baseTemporalClauses(startIso, endIso, types, { drilldownCodes });

  const geoJsonStr = JSON.stringify(tractGeoJSON).replace(/'/g, "''");
  clauses.push(`  AND ST_Intersects(the_geom, ST_SetSRID(ST_GeomFromGeoJSON('${geoJsonStr}'), 3857))`);

  return [
    "SELECT EXTRACT(DOW  FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS dow,",
    "       EXTRACT(HOUR FROM dispatch_date_time AT TIME ZONE 'America/New_York') AS hr,",
    "       COUNT(*) AS n",
    "FROM incidents_part1_part2",
    ...clauses,
    "GROUP BY 1,2 ORDER BY 1,2",
  ].join("\n");
}
```

---

#### B) Add API Wrappers

**File**: `src/api/crime.js`

```javascript
/**
 * Fetch monthly series for a single tract polygon.
 * @param {{start:string,end:string,types?:string[],drilldownCodes?:string[],tractGeoJSON:object}} params
 * @returns {Promise<object>} Aggregated monthly results
 */
export async function fetchMonthlySeriesTract({ start, end, types, drilldownCodes, tractGeoJSON }) {
  const sql = Q.buildMonthlyTractSQL({ start, end, types, drilldownCodes, tractGeoJSON });
  await logQuery('fetchMonthlySeriesTract', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000, // 60s cache
  });
}

/**
 * Fetch top-N offense types for a tract polygon.
 */
export async function fetchTopTypesTract({ start, end, tractGeoJSON, limit = 12 }) {
  const sql = Q.buildTopTypesTractSQL({ start, end, tractGeoJSON, limit });
  await logQuery('fetchTopTypesTract', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
  });
}

/**
 * Fetch 7×24 heatmap for a tract polygon.
 */
export async function fetch7x24Tract({ start, end, types, drilldownCodes, tractGeoJSON }) {
  const sql = Q.buildHeatmap7x24TractSQL({ start, end, types, drilldownCodes, tractGeoJSON });
  await logQuery('fetch7x24Tract', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
  });
}
```

---

#### C) Wire in Charts Module

**File**: `src/charts/index.js`

**Replace Tract Mode Block** (lines 64-80):

```diff
- } else {
-   // tract mode (MVP): show citywide only, disable others
-   [city] = await Promise.all([
-     fetchMonthlySeriesCity({ start, end, types }),
-   ]);
-   topn = { rows: [] };
-   heat = { rows: [] };
-   bufOrArea = { rows: [] };
-   const pane = document.getElementById('charts') || document.body;
-   const status = document.getElementById('charts-status') || (() => {
-     const d = document.createElement('div');
-     d.id = 'charts-status';
-     d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
-     pane.appendChild(d);
-     return d;
-   })();
-   status.textContent = 'Tract mode: charts are disabled for this cycle (citywide series only).';
- }
+ } else if (queryMode === 'tract' && selectedTractGEOID) {
+   // Tract mode: fetch tract geometry and query by polygon
+   const tractsGeo = await fetchTractsCachedFirst(); // From boundaries.js
+   const tractFeature = tractsGeo.features.find((f) => f.properties.GEOID === selectedTractGEOID);
+
+   if (!tractFeature || !tractFeature.geometry) {
+     throw new Error(`Tract ${selectedTractGEOID} geometry not found`);
+   }
+
+   [city, bufOrArea, topn, heat] = await Promise.all([
+     fetchMonthlySeriesCity({ start, end, types, drilldownCodes }), // Citywide series (baseline)
+     fetchMonthlySeriesTract({ start, end, types, drilldownCodes, tractGeoJSON: tractFeature.geometry }), // Tract series
+     fetchTopTypesTract({ start, end, tractGeoJSON: tractFeature.geometry, limit: 12 }),
+     fetch7x24Tract({ start, end, types, drilldownCodes, tractGeoJSON: tractFeature.geometry }),
+   ]);
+ } else {
+   // Tract mode but no tract selected yet
+   const pane = document.getElementById('charts') || document.body;
+   const status = document.getElementById('charts-status') || (() => {
+     const d = document.createElement('div');
+     d.id = 'charts-status';
+     d.style.cssText = 'position:absolute;right:16px;top:16px;padding:8px 12px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.1);background:#fff;font:14px/1.4 system-ui';
+     pane.appendChild(d);
+     return d;
+   })();
+   status.textContent = 'Tip: click a census tract on the map to show tract-level charts.';
+   return; // skip
+ }
```

**Add Import**:
```diff
  import {
    fetchMonthlySeriesCity,
    fetchMonthlySeriesBuffer,
+   fetchMonthlySeriesTract,
    fetchTopTypesBuffer,
+   fetchTopTypesTract,
    fetch7x24Buffer,
+   fetch7x24Tract,
    fetchTopTypesByDistrict,
    fetch7x24District,
  } from '../api/crime.js';
+ import { fetchTractsCachedFirst } from '../api/boundaries.js';
```

---

#### D) Update Function Signature

**File**: `src/charts/index.js:34`

```diff
- export async function updateAllCharts({ start, end, types = [], center3857, radiusM, queryMode, selectedDistrictCode }) {
+ export async function updateAllCharts({ start, end, types = [], drilldownCodes = [], center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID }) {
```

---

### Sample SQL (Option 1)

**Scenario**: User selects tract `42101001600` (Philadelphia County, Tract 16.00), time window 2024-01-01 to 2025-01-01, no offense filters.

**Monthly Series Query**:
```sql
SELECT date_trunc('month', dispatch_date_time) AS m, COUNT(*) AS n
FROM incidents_part1_part2
WHERE dispatch_date_time >= '2015-01-01'
  AND dispatch_date_time >= '2024-01-01'
  AND dispatch_date_time < '2025-01-01'
  AND ST_Intersects(
    the_geom,
    ST_SetSRID(ST_GeomFromGeoJSON('{
      "type":"Polygon",
      "coordinates":[[[-75.123,39.987],[-75.122,39.987],[-75.122,39.988],[-75.123,39.988],[-75.123,39.987]]]
    }'), 3857)
  )
GROUP BY 1 ORDER BY 1
```

**Expected Response**:
```json
{
  "rows": [
    {"m": "2024-01-01T00:00:00Z", "n": 12},
    {"m": "2024-02-01T00:00:00Z", "n": 8},
    ...
  ],
  "time": 0.345,
  "total_rows": 12
}
```

---

## Option 2: Precomputed Monthly Aggregations

### Overview

Extend `scripts/precompute_tract_counts.mjs` to produce per-tract monthly JSON:
- File: `public/data/tract_counts_monthly.json`
- Structure: `{ "42101001600": { "2024-01": 12, "2024-02": 8, ... }, ... }`
- Rebuild: Monthly cron job or on-demand via script

Runtime reads precomputed arrays for selected tract → instant charts.

### Advantages ✅

- ✅ **Fastest runtime** — No SQL query, just JSON lookup (~10ms)
- ✅ **Lowest server load** — Precompute once, serve many

### Disadvantages ❌

- ❌ **Stale data** — Requires periodic rebuild
- ❌ **Fixed time windows** — Can't support arbitrary start/end (e.g., last 3 months)
- ❌ **Large file size** — 408 tracts × 120 months × 6 offense groups = ~300KB JSON
- ❌ **No top-N/7×24** — Only monthly series (would need separate precomputes)

### Implementation (High-Level)

#### A) Extend Precompute Script

**File**: `scripts/precompute_tract_counts.mjs`

```javascript
// For each tract, for each month in last 24 months, query CARTO:
const tractMonthly = {};
for (const tract of tracts.features) {
  const geoid = tract.properties.GEOID;
  tractMonthly[geoid] = {};

  for (const month of monthsArray) { // ['2022-01', '2022-02', ...]
    const sql = `
      SELECT COUNT(*) AS n
      FROM incidents_part1_part2
      WHERE dispatch_date_time >= '${month}-01'
        AND dispatch_date_time < date_trunc('month', '${month}-01'::date + interval '1 month')
        AND ST_Intersects(the_geom, ST_GeomFromGeoJSON('${JSON.stringify(tract.geometry)}'))
    `;
    const result = await queryCARTO(sql);
    tractMonthly[geoid][month] = result.rows[0].n;
  }
}

// Write to public/data/tract_counts_monthly.json
fs.writeFileSync('public/data/tract_counts_monthly.json', JSON.stringify(tractMonthly, null, 2));
```

**Runtime**: ~10 minutes for 408 tracts × 24 months = ~9,800 queries (with batching)

#### B) Runtime Loader

**File**: `src/api/precomputed.js` (new)

```javascript
let tractMonthlyCache = null;

export async function loadTractMonthly() {
  if (tractMonthlyCache) return tractMonthlyCache;
  const response = await fetch('/data/tract_counts_monthly.json');
  tractMonthlyCache = await response.json();
  return tractMonthlyCache;
}

export async function getTractMonthlySeries(geoid, startMonth, endMonth) {
  const data = await loadTractMonthly();
  const tractData = data[geoid] || {};
  const months = Object.keys(tractData).filter((m) => m >= startMonth && m < endMonth).sort();
  return months.map((m) => ({ m, n: tractData[m] || 0 }));
}
```

#### C) Wire in Charts

**File**: `src/charts/index.js`

```diff
+ import { getTractMonthlySeries } from '../api/precomputed.js';

  } else if (queryMode === 'tract' && selectedTractGEOID) {
-   // Live SQL option
+   // Precomputed option
+   const startMonth = dayjs(start).format('YYYY-MM');
+   const endMonth = dayjs(end).format('YYYY-MM');
+   [city, bufOrArea] = await Promise.all([
+     fetchMonthlySeriesCity({ start, end, types, drilldownCodes }),
+     getTractMonthlySeries(selectedTractGEOID, startMonth, endMonth),
+   ]);
+   topn = { rows: [] }; // No precomputed top-N
+   heat = { rows: [] }; // No precomputed heatmap
  }
```

**Limitation**: Only monthly line chart works. Top-N and 7×24 would require separate precomputes or hybrid approach.

---

## Comparison Matrix

| Feature | Option 1 (Live SQL) | Option 2 (Precomputed) |
|---------|---------------------|------------------------|
| **Response Time** | 200-500ms | ~10ms |
| **Data Freshness** | Real-time | Stale (rebuild cycle) |
| **Time Window Flexibility** | Arbitrary start/end | Fixed months only |
| **Offense Filters** | ✅ Full support | ❌ None (or massive file) |
| **Top-N Chart** | ✅ Yes | ❌ Requires separate precompute |
| **7×24 Heatmap** | ✅ Yes | ❌ Requires separate precompute |
| **Implementation Effort** | 2-3 hours | 4-5 hours (script + runtime) |
| **Maintenance** | None | Monthly rebuild cron job |
| **File Size** | 0 (runtime queries) | ~300KB JSON (monthly only) |

---

## Recommendation: Option 1 (Live SQL)

**Rationale**:
- ✅ **Best UX**: Instant response to time window/filter changes
- ✅ **Complete feature parity**: All 3 charts work (monthly, top-N, 7×24)
- ✅ **No maintenance burden**: No rebuild scripts or cron jobs
- ✅ **Acceptable performance**: 200-500ms is indistinguishable from buffer mode (similar complexity)

**Tradeoff**: Slightly higher server load (but tract polygons are small, spatial index makes this efficient).

---

## Acceptance Criteria

### AC1: Tract Selection Shows Charts ✅

**Steps**:
1. Switch to "Census Tract" mode
2. Click a tract on the map
3. Observe charts panel

**Expected**:
- Monthly line: Citywide series (blue) + Tract series (orange)
- Top-N bar: Top 12 offense codes within that tract
- 7×24 heatmap: Hour/day pattern within that tract

**No Status Message**: "Charts are disabled" message should not appear

---

### AC2: Time Window Changes Update Charts ✅

**Steps**:
1. Select tract (charts populate)
2. Change time window from 12mo to 6mo
3. Wait ~1-2s

**Expected**: All charts update to reflect new 6-month window (fewer months in line chart, different top-N ranks)

---

### AC3: Offense Filters Apply to Tract Charts ✅

**Steps**:
1. Select tract
2. Select "Vehicle" offense group
3. Observe charts

**Expected**:
- Monthly line shows only vehicle thefts
- Top-N shows only vehicle-related codes
- 7×24 shows only vehicle theft timing

---

### AC4: Drilldown Works with Tract Charts ✅

**Steps**:
1. Select tract
2. Select "Vehicle" group → Drilldown to "Motor Vehicle Theft"
3. Observe charts

**Expected**: Charts show **only** motor vehicle thefts (not theft from vehicle)

---

### AC5: Empty Tract Handling ✅

**Steps**:
1. Select a tract with 0 incidents in time window
2. Observe charts

**Expected**:
- Monthly line: Flat zero line for tract series (citywide series still shows data)
- Top-N: Empty (no bars)
- 7×24: Empty (no heat)
- Status banner: "No incidents in selected window. Adjust the time range."

---

## Files to Modify (Option 1)

| File | Changes | Lines | Effort |
|------|---------|-------|--------|
| **src/utils/sql.js** | Add 3 SQL builders (monthly, topN, 7×24) | +80 | 30 min |
| **src/api/crime.js** | Add 3 API wrappers | +60 | 20 min |
| **src/charts/index.js** | Replace tract mode block, add imports | 64-80, 6-13 | 30 min |
| **src/main.js** | Pass `selectedTractGEOID` to `updateAllCharts` | 1 line | 5 min |

**Total Effort**: ~1.5-2 hours

---

## Files to Create (Option 2, if chosen)

| File | Purpose | Lines | Effort |
|------|---------|-------|--------|
| **scripts/precompute_tract_monthly.mjs** | Generate monthly JSON | ~150 | 2 hours |
| **src/api/precomputed.js** | Runtime JSON loader | ~40 | 30 min |
| **public/data/tract_counts_monthly.json** | Precomputed data | ~300KB | 10 min (script runtime) |

**Total Effort**: ~2.5-3 hours + monthly maintenance

---

## External Tract Sources (Reference)

### TIGERweb (Census ArcGIS REST)

**Service URL**: https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer

**Tracts Layer**: Layer ID 0 (Census Tracts)

**Query Example** (GeoJSON output, Philadelphia County):
```
https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=STATE%3D%2742%27%20AND%20COUNTY%3D%27101%27&outFields=GEOID,NAME,ALAND,AWATER&returnGeometry=true&f=geojson
```

**Fields**:
- `GEOID`: 11-digit identifier (e.g., "42101001600")
- `NAME`: Human-readable (e.g., "Census Tract 16")
- `ALAND`, `AWATER`: Land/water area (square meters)

---

### PASDA (PA Spatial Data Access)

**Service URL**: https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer

**Tracts Layer**: Layer ID 28 (Census Tracts 2020)

**Query Example**:
```
https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer/28/query?where=1%3D1&outFields=*&f=geojson
```

**Note**: Returns all Philadelphia tracts (no need to filter by county).

---

## Next Steps for Codex

1. **Implement Option 1** (recommended):
   - Add 3 SQL builders to `sql.js`
   - Add 3 API wrappers to `crime.js`
   - Update `charts/index.js` tract mode block
   - Pass `selectedTractGEOID` from `main.js`

2. **Test with Sample Tract**:
   - Select tract `42101001600` (or any tract)
   - Verify all 3 charts populate
   - Check SQL in network tab or logs

3. **Handle Edge Cases**:
   - No tract selected → Show hint message
   - Empty tract → Show zero/empty charts
   - Tract geometry not found → Error message

4. **Optional Enhancements**:
   - Add loading spinner during API call
   - Show tract name/GEOID in charts title
   - Compare tract to citywide average (percentile ranking)

---

## Risk Assessment

### Option 1 Risks ⚠️

- **CARTO Query Limits**: Heavy usage could hit rate limits (unlikely with 60s cache)
- **Large Polygons**: Some tracts may have complex boundaries (~500+ vertices) → Longer query time (test with worst-case tract)

**Mitigation**: Monitor query times in logs, adjust cache TTL if needed.

### Option 2 Risks ⚠️

- **Stale Data**: Users see outdated counts (up to 1 month old)
- **Maintenance Burden**: Requires reliable cron job + monitoring

**Mitigation**: Option 1 avoids this entirely.

---

## Conclusion

**Recommended Path**: Implement **Option 1 (Live SQL)** for full feature parity, real-time data, and minimal maintenance.

**Fallback**: If query performance proves inadequate (>2s), switch to hybrid approach (precompute monthly, live for top-N/7×24).
