# Edit Points — Step-by-Step How-To Guide

Detailed walkthroughs for common modifications with example code snippets.

**Note:** All patches below are **suggestions only** and have **not been applied**. Use as reference when making changes.

---

## 1. Add a New Offense Group

**Goal:** Add a new category "Sexual Offenses" to the offense group selector.

### Step 1: Update offense_groups.json

**File:** [src/data/offense_groups.json](../src/data/offense_groups.json)

**Change:**
```diff
 {
   "Assault_Gun": [...],
   "Burglary": [...],
   "Property": [...],
   "Robbery_Gun": [...],
+  "Sexual_Offenses": [
+    "Rape",
+    "Other Sexual Offense"
+  ],
   "Vandalism_Other": [...],
   "Vehicle": [...]
 }
```

### Step 2: Add HTML Option (Optional, if hardcoded)

**File:** [public/index.html](../public/index.html) (or `/index.html` after structure fix)

**Find:**
```html
<select id="groupSel" multiple size="6" ...>
  <option value="property">Property</option>
  <option value="vehicle">Vehicle</option>
  ...
</select>
```

**Change:**
```diff
 <select id="groupSel" multiple size="6" ...>
   <option value="property">Property</option>
   <option value="vehicle">Vehicle</option>
   <option value="burglary">Burglary</option>
   <option value="robbery_gun">Robbery (gun)</option>
   <option value="assault_gun">Assault (gun)</option>
+  <option value="sexual_offenses">Sexual Offenses</option>
   <option value="vandalism_other">Vandalism/Other</option>
 </select>
```

### Step 3: Validate

```bash
node scripts/validate_offense_groups.mjs
```

**Expected:** ✅ All values are arrays

---

## 2. Change District Choropleth Color Scheme

**Goal:** Switch from blue gradient to red gradient for districts.

### File: src/map/render_choropleth.js

**Find (line 12):**
```javascript
const colors = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
```

**Change:**
```diff
-const colors = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
+const colors = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'];
```

**Result:** Light pink → dark red gradient (ColorBrewer Reds)

---

## 3. Switch Default Time Window to 12 Months

**Goal:** App starts with 12-month window instead of 6 months.

### File: src/state/store.js

**Find:**
```javascript
export const store = {
  // ...
  timeWindowMonths: 6,
  durationMonths: 6,
  // ...
};
```

**Change:**
```diff
 export const store = {
   // ...
-  timeWindowMonths: 6,
-  durationMonths: 6,
+  timeWindowMonths: 12,
+  durationMonths: 12,
   // ...
 };
```

**Also update HTML default:**

**File:** [public/index.html](../public/index.html)

**Find:**
```html
<select id="twSel" ...>
  <option value="3">3 months</option>
  <option value="6" selected>6 months</option>
  <option value="12">12 months</option>
</select>
```

**Change:**
```diff
 <select id="twSel" ...>
   <option value="3">3 months</option>
-  <option value="6" selected>6 months</option>
-  <option value="12">12 months</option>
+  <option value="6">6 months</option>
+  <option value="12" selected>12 months</option>
 </select>
```

---

## 4. Tighten the >20k Points Guard

**Goal:** Prevent rendering unclustered points when count exceeds 10,000 (stricter than 20k).

### File: src/map/points.js

**Current (assumed location):**
```javascript
export async function refreshPoints(map, { start, end, types }) {
  const { srcId, clusterId, clusterCountId, unclusteredId } = ensureSourcesAndLayers(map);
  const bbox = map.getBounds().toArray().flat();
  const geojson = await fetchPoints({ bbox, start, end, types });

  // Add guard here (if not present)
  const featureCount = geojson?.features?.length || 0;
  if (featureCount > 20000) {
    console.warn(`Too many points (${featureCount}), hiding unclustered layer`);
    map.setLayoutProperty(unclusteredId, 'visibility', 'none');
    // Show warning to user: "Zoom in to see individual points"
  } else {
    map.setLayoutProperty(unclusteredId, 'visibility', 'visible');
  }

  // Update source
  map.getSource(srcId).setData(geojson);
}
```

**Change:**
```diff
-  if (featureCount > 20000) {
+  if (featureCount > 10000) {
     console.warn(`Too many points (${featureCount}), hiding unclustered layer`);
```

**Bonus:** Add UI notification

**File:** [src/map/points.js](../src/map/points.js) (add after console.warn)

```diff
   console.warn(`Too many points (${featureCount}), hiding unclustered layer`);
+  const msg = document.getElementById('points-warning') || (() => {
+    const d = document.createElement('div');
+    d.id = 'points-warning';
+    d.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#f59e0b;color:#fff;padding:8px 16px;border-radius:6px;z-index:100;';
+    document.body.appendChild(d);
+    return d;
+  })();
+  msg.textContent = `${featureCount.toLocaleString()} points found. Zoom in to see unclustered view.`;
```

---

## 5. Adjust Cache TTLs (City vs Buffer)

**Goal:** Increase cache duration for citywide district aggregations (slow queries) from 5 minutes to 15 minutes.

### File: src/utils/http.js

**Find (assumed):**
```javascript
const DEFAULT_CITY_TTL = 5 * 60 * 1000;  // 5 minutes
const DEFAULT_BUFFER_TTL = 2 * 60 * 1000; // 2 minutes
```

**Change:**
```diff
-const DEFAULT_CITY_TTL = 5 * 60 * 1000;  // 5 minutes
+const DEFAULT_CITY_TTL = 15 * 60 * 1000; // 15 minutes
 const DEFAULT_BUFFER_TTL = 2 * 60 * 1000; // 2 minutes
```

**Or, if TTLs are passed per-call:**

**File:** [src/api/crime.js](../src/api/crime.js)

**Find:**
```javascript
export async function fetchByDistrict({ start, end, types }) {
  const sql = buildDistrictQuery({ start, end, types });
  const url = `${CARTO_BASE}?q=${encodeURIComponent(sql)}`;
  return cachedFetch(url, { ttl: 5 * 60 * 1000 }); // 5 min
}
```

**Change:**
```diff
-  return cachedFetch(url, { ttl: 5 * 60 * 1000 }); // 5 min
+  return cachedFetch(url, { ttl: 15 * 60 * 1000 }); // 15 min
```

---

## 6. Add New Popup Field (Per-10k Rate in Districts)

**Goal:** Show per-10k rate in district click popup (requires ACS population data for districts).

### Step 1: Fetch Population Data (if not already available)

**File:** [src/api/crime.js](../src/api/crime.js) or new `src/api/pop_districts.js`

```javascript
// Assume we have a district population lookup
const DISTRICT_POP = {
  '01': 50000,
  '02': 45000,
  // ... etc
};
```

### Step 2: Update Popup Logic

**File:** [src/map/ui_popup_district.js](../src/map/ui_popup_district.js)

**Find (lines 19-26):**
```javascript
const n = (Array.isArray(byDist?.rows) ? byDist.rows : byDist).find?.((r) => String(r.dc_dist).padStart(2,'0') === code)?.n || 0;
const topRows = Array.isArray(topn?.rows) ? topn.rows : topn;
const html = `
  <div style="min-width:220px">
    <div style="font-weight:600">${name} (${code})</div>
    <div>Total: ${n}</div>
    <div>Top 3: ${(topRows||[]).map(r=>`${r.text_general_code} (${r.n})`).join(', ') || '—'}</div>
  </div>`;
```

**Change:**
```diff
 const n = (Array.isArray(byDist?.rows) ? byDist.rows : byDist).find?.((r) => String(r.dc_dist).padStart(2,'0') === code)?.n || 0;
+const pop = DISTRICT_POP[code] || 0;
+const per10k = pop > 0 ? ((n / pop) * 10000).toFixed(1) : '—';
 const topRows = Array.isArray(topn?.rows) ? topn.rows : topn;
 const html = `
   <div style="min-width:220px">
     <div style="font-weight:600">${name} (${code})</div>
     <div>Total: ${n}</div>
+    <div>Per 10k: ${per10k}</div>
     <div>Top 3: ${(topRows||[]).map(r=>`${r.text_general_code} (${r.n})`).join(', ') || '—'}</div>
   </div>`;
```

### Step 3: Import District Population Data

**File:** [src/map/ui_popup_district.js](../src/map/ui_popup_district.js) (top)

```diff
 import maplibregl from 'maplibre-gl';
 import dayjs from 'dayjs';
 import { store } from '../state/store.js';
 import { fetchByDistrict, fetchTopTypesByDistrict } from '../api/crime.js';
+import { DISTRICT_POP } from '../data/district_population.js'; // Assume this exists or create it
```

---

## 7. Change Default Map Center

**Goal:** Start map centered on City Hall instead of default.

### File: src/map/initMap.js

**Find (line 26):**
```javascript
center: [-75.1652, 39.9526],
```

**Change:**
```diff
-center: [-75.1652, 39.9526],
+center: [-75.1636, 39.9526], // City Hall coordinates
```

---

## 8. Increase Cluster Radius

**Goal:** Larger cluster circles (60px radius instead of 40px).

### File: src/map/points.js

**Find (line 64):**
```javascript
clusterRadius: 40,
```

**Change:**
```diff
-clusterRadius: 40,
+clusterRadius: 60,
```

---

## 9. Add Buffer Color Customization

**Goal:** Change buffer overlay to purple instead of blue.

### File: src/map/buffer_overlay.js

**Find:**
```javascript
map.addLayer({
  id: 'buffer-a-fill',
  type: 'fill',
  source: srcId,
  paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.15 }
});
map.addLayer({
  id: 'buffer-a-line',
  type: 'line',
  source: srcId,
  paint: { 'line-color': '#0284c7', 'line-width': 1.5 }
});
```

**Change:**
```diff
 map.addLayer({
   id: 'buffer-a-fill',
   type: 'fill',
   source: srcId,
-  paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.15 }
+  paint: { 'fill-color': '#a855f7', 'fill-opacity': 0.15 }
 });
 map.addLayer({
   id: 'buffer-a-line',
   type: 'line',
   source: srcId,
-  paint: { 'line-color': '#0284c7', 'line-width': 1.5 }
+  paint: { 'line-color': '#7c3aed', 'line-width': 1.5 }
 });
```

**Result:** Purple buffer (Tailwind purple-500 / purple-600)

---

## 10. Add SQL Date Range Validation

**Goal:** Prevent queries with `start > end` by adding validation to SQL builder.

### File: src/utils/sql.js

**Find (assumed location in main query builder):**
```javascript
export function buildDistrictQuery({ start, end, types }) {
  let where = [`dispatch_date_time >= '2015-01-01'`];
  if (start) where.push(`dispatch_date_time >= '${start}'`);
  if (end) where.push(`dispatch_date_time < '${end}'`);
  // ... rest of query
}
```

**Change:**
```diff
 export function buildDistrictQuery({ start, end, types }) {
+  if (start && end && start >= end) {
+    throw new Error(`Invalid date range: start (${start}) must be before end (${end})`);
+  }
   let where = [`dispatch_date_time >= '2015-01-01'`];
   if (start) where.push(`dispatch_date_time >= '${start}'`);
   if (end) where.push(`dispatch_date_time < '${end}'`);
   // ... rest of query
 }
```

---

## 11. Change Number of Quantile Breaks

**Goal:** Use 7 classes instead of 5 for district choropleth.

### File: src/map/render_choropleth.js

**Find (line 11-12):**
```javascript
const breaks = quantileBreaks(values, 5);
const colors = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
```

**Change:**
```diff
-const breaks = quantileBreaks(values, 5);
-const colors = ['#f1eef6', '#bdc9e1', '#74a9cf', '#2b8cbe', '#045a8d'];
+const breaks = quantileBreaks(values, 7);
+const colors = ['#f1eef6', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#91003f'];
```

**Note:** Must provide 7 colors for 7 classes (ColorBrewer RdPu scheme)

---

## 12. Filter Out Low-Population Tracts

**Goal:** Hide tracts with population < 500 from choropleth (unstable rates).

### File: src/map/render_choropleth_tracts.js

**Find (assumed location before adding layer):**
```javascript
export function renderTractsChoropleth(map, merged) {
  const values = (merged?.features || []).map((f) => Number(f?.properties?.value) || 0);
  const breaks = quantileBreaks(values, 5);
  // ... add layers
}
```

**Change:**
```diff
 export function renderTractsChoropleth(map, merged) {
+  // Filter out low-population tracts
+  const filtered = {
+    ...merged,
+    features: (merged?.features || []).filter(f => (f.properties?.pop || 0) >= 500)
+  };
-  const values = (merged?.features || []).map((f) => Number(f?.properties?.value) || 0);
+  const values = (filtered?.features || []).map((f) => Number(f?.properties?.value) || 0);
   const breaks = quantileBreaks(values, 5);
   // ... add layers with 'filtered' instead of 'merged'
-  map.getSource(sourceId).setData(merged);
+  map.getSource(sourceId).setData(filtered);
 }
```

---

## Summary of Editing Patterns

| Pattern | Example Files | Key Principle |
|---------|---------------|---------------|
| **Data-driven changes** | offense_groups.json, acs_tracts_*.json | Edit JSON, validate, no code changes |
| **Visual styling** | render_choropleth.js, buffer_overlay.js, ui_legend.js | Change color arrays, opacity, line-width |
| **Business logic** | sql.js, types.js, store.js | Edit filter logic, SQL builders, state derivation |
| **UI wiring** | panel.js, main.js | addEventListener → update store → call refresh |
| **API integration** | api/crime.js, api/boundaries.js | Modify fetch calls, URL params, cache TTLs |

---

**Reminder:** All code snippets above are **suggestions only** and have **NOT been applied** to the repository. Test changes in dev mode before building for production.

**Last Updated:** 2025-10-15 16:04
**Related:** [STRUCTURE_AUDIT.md](STRUCTURE_AUDIT.md), [FILE_MAP.md](FILE_MAP.md)
