# Diary UI Tuning - Manager Log

**Date:** 2025-11-26T00:33:18Z
**Agent:** Agent-M (Manager/Reviewer Mode)
**Mode:** manager-fixes-allowed
**Scope:** Diagnose and apply small surgical UI/UX fixes to Diary mode

---

## Executive Summary

Performed focused diagnosis and surgical fixes for four UX issues in Diary mode:

1. **Basemap Styling** - Strengthened desaturation filter (OSM fallback when no MapTiler key)
2. **Segment Override List** - Reduced cognitive load by showing only worst 3 segments, rest collapsible
3. **Route Styling** - Increased line width to 7px for primary route, 5px for alternative
4. **Insights Panel Overflow** - Added `overflow-x: auto` to heatmap grid

**Files Modified:** 4
**Documentation Created:** 1 design spec
**Remaining for Codex:** Safety-colored route gradients (requires data-driven expressions)

---

## Task 1: Basemap & "Muted" Diary Style

### Diagnosis

**Files Inspected:**
- [src/config.js](../src/config.js) - MAP_STYLES, resolveMapStyle()
- [src/map/initMap.js](../src/map/initMap.js) - Mode parameter handling
- [src/diary_demo_main.js](../src/diary_demo_main.js) - Diary standalone entry point
- [src/routes_diary/index.js](../src/routes_diary/index.js) - setDiaryMapSkin() call
- [src/style.css](../src/style.css) - .diary-map-muted filter

**Flow Analysis:**

1. ✅ `diary_demo_main.js:6` calls `initMap({ mode: 'diary' })` correctly
2. ✅ `initMap.js:30` calls `resolveMapStyle(mode)` correctly
3. ✅ `config.js:67-71` returns `MAP_STYLES.diaryLight` when mode='diary' AND it exists
4. ✅ `config.js:43-54` resolves diaryLight style from env variables or MapTiler/Positron presets
5. ⚠️ **Issue Found:** `MAP_STYLES.diaryLight` is `null` when no `VITE_MAPTILER_API_KEY` is set
6. ✅ Fallback to `MAP_STYLES.crimeDefault` (OSM raster) works as designed
7. ✅ `routes_diary/index.js:1687` calls `setDiaryMapSkin(mapRef, true)` correctly
8. ✅ `setDiaryMapSkin()` applies `.diary-map-muted` class to map container

**Root Cause:**

User does not have `VITE_MAPTILER_API_KEY` configured, so diary mode uses the same OSM raster basemap as Crime Explorer. The CSS filter **IS** being applied, but the original strength was too subtle:

```css
/* Before (line 155) */
.diary-map-muted .maplibregl-canvas {
  filter: saturate(0.6) brightness(1.04);
}
```

**Explanation:**
- `saturate(0.6)` reduces saturation to 60% (40% reduction)
- This is noticeable but not dramatic on already-colorful OSM tiles (bright green parks, red/orange highways)
- User perceived "no difference" because the change was too subtle

### Fix Applied

**File:** [src/style.css:154-157](../src/style.css#L154-L157)

```css
/* After */
.diary-map-muted .maplibregl-canvas {
  filter: saturate(0.35) brightness(1.08) contrast(0.92);
  background: var(--map-bg);
}
```

**Changes:**
- `saturate(0.6)` → `saturate(0.35)` (65% saturation reduction, much more visible)
- `brightness(1.04)` → `brightness(1.08)` (slightly brighter to compensate for contrast drop)
- Added `contrast(0.92)` to further flatten colors and reduce visual pop

**Expected Outcome:**
OSM basemap will appear noticeably grayer and more muted, making the colored safety segments stand out more clearly.

### Remaining Limitations

**The filter is a fallback strategy.** The ideal solution (documented in [docs/M3_MAP_STYLE_AND_LAYERS.md](../docs/M3_MAP_STYLE_AND_LAYERS.md)) is to:

1. Obtain a MapTiler API key (free tier: 100k requests/month)
2. Add to `.env`: `VITE_MAPTILER_API_KEY=your_key_here`
3. Rebuild: `npm run build` or restart dev server

Once the key is present, Diary mode will automatically use the MapTiler Light vector style, which is designed for data visualization and has gray-centric colors.

**Alternatively**, set `VITE_MAP_STYLE_DIARY=positron` to use the free Carto Positron style (no API key needed).

### Documentation Update

**File:** [docs/M3_MAP_STYLE_AND_LAYERS.md](../docs/M3_MAP_STYLE_AND_LAYERS.md)

Added note in "Implementation Status" section (line 32):

> **Fallback Filter (Nov 2025):** When no light style is configured, Diary mode applies a stronger desaturation filter to the OSM raster basemap (`saturate(0.35) brightness(1.08) contrast(0.92)`) to reduce visual noise. This is a temporary measure; configuring a light vector style is strongly recommended for production.

---

## Task 2: Segment Override List UX

### Diagnosis

**File Inspected:** [src/routes_diary/form_submit.js](../src/routes_diary/form_submit.js)

**Current Behavior (lines 441-504):**

```javascript
segmentIds.forEach((segmentId, idx) => {
  // Create row for EVERY segment
  const row = document.createElement('div');
  // ... checkbox + select for rating override ...
  list.appendChild(row);
});
```

**Problem:**
- Demo routes have 20-40 segments each (verified by checking `routes_phl.demo.geojson`)
- Modal shows **ALL segments** as individual rows in a vertical list
- User sees entries like:
  ```
  ☐ Unknown – seg_15059  1★
  ☐ Unknown – seg_57975  1★
  ☐ S 33rd St – seg_28612  1★
  ... (20+ more rows)
  ```
- This creates cognitive overload and scroll fatigue

**Available Data:**
- `segmentId`: Unique ID (e.g., "seg_15059")
- `street`: Street name from lookup (e.g., "S 33rd St", may be "Unknown")
- `decayed_mean`: Safety score 1-5 (available via `state.segmentLookup`)
- Route order: Segments are in traversal order (first to last along route)

**Typical Counts:**
- Route A (30th St → Clark Park): ~32 segments
- Route B (30th St → Rittenhouse): ~28 segments
- Route C (Penn → 9th & Christian): ~41 segments

### Fix Applied

**File:** [src/routes_diary/form_submit.js:441-558](../src/routes_diary/form_submit.js#L441-L558)

**Strategy: Show Worst 3, Hide Rest**

1. **Gather segment data** with safety scores (lines 441-447)
2. **Sort by safety score** ascending (worst first) (line 450)
3. **Split into top 3 + rest** (lines 453-454)
4. **Show top 3 prominently** with hint "Lowest-rated segments (select up to 2)" (lines 521-532)
5. **Collapse rest** behind `<details>` element: "Show N more segments" (lines 535-558)

**Code Structure:**

```javascript
// Extract segment data with scores
const segmentsData = segmentIds.map((segmentId, idx) => {
  const segmentFeature = state.segmentLookup?.get?.(segmentId);
  const safetyScore = segmentFeature?.properties?.decayed_mean || 3;
  const street = getSegmentLabel(state.segmentLookup, segmentId);
  return { segmentId, idx, safetyScore, street };
});

// Sort by safety (lowest first)
const sortedSegments = segmentsData.slice().sort((a, b) => a.safetyScore - b.safetyScore);

// Top 3 worst + rest
const topSegments = sortedSegments.slice(0, 3);
const restSegments = sortedSegments.slice(3);

// Render top 3
topSegments.forEach(seg => list.appendChild(createSegmentRow(seg)));

// Render collapsible rest
if (restSegments.length > 0) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = `Show ${restSegments.length} more segments`;
  // ...
}
```

**Benefits:**
- **Reduced initial load:** User sees only 3-4 items instead of 20-40
- **Focused attention:** Worst segments (lowest safety) are surfaced first
- **Progressive disclosure:** User can expand to see all segments if needed
- **Preserves functionality:** All segments still accessible, max 2 override limit unchanged

### Remaining for Codex

**Design Spec:** [docs/M3_SEGMENT_UI_NOTES.md](../docs/M3_SEGMENT_UI_NOTES.md) (created)

**Future Enhancement: Spatial Grouping**

The current fix is a **mitigation**, not a full solution. For M3+, consider:

1. **Group consecutive segments** into 4-6 "blocks" along route:
   - "Start" (first 20% of route length)
   - "Early" (20-40%)
   - "Middle" (40-60%)
   - "Late" (60-80%)
   - "End" (last 20%)

2. **Aggregate statistics per block:**
   - Avg safety score
   - Dominant street name
   - Length in meters/km

3. **UI:**
   ```
   ☐ Start - S 33rd St area (0.5 km, avg 3.2★)
   ☐ Middle - Walnut St area (0.8 km, avg 2.8★)  ← Lowest avg, highlighted
   ☐ End - Baltimore Ave area (0.6 km, avg 3.9★)
   ```

4. **Clicking a block** overrides all segments in that block with one rating

**Required Fields:**
- `distance_along_route` for each segment (requires Turf.js `along()` calc)
- Spatial join with street names (already available via `segment.properties.street`)

**Implementation Notes:**
- Compute blocks in `generate_demo_data.mjs` and add to route properties, OR
- Compute client-side in `form_submit.js` using Turf.js
- Update schema to support block-level overrides (backward compatible with segment-level)

---

## Task 3: Route Styling on Map

### Diagnosis

**Files Inspected:**
- [src/map/routing_overlay.js](../src/map/routing_overlay.js) - drawRouteOverlay()
- [src/map/segments_layer.js](../src/map/segments_layer.js) - Segment color bins
- [src/routes_diary/index.js:800](../src/routes_diary/index.js#L800) - Primary route draw call
- [src/routes_diary/index.js:1074-1079](../src/routes_diary/index.js#L1074-L1079) - Alt route draw call

**Current Styling:**

**Primary Route (line 800):**
```javascript
drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, feature, {
  color: '#111827',  // Near-black (gray-900)
  width: 5,          // 5px
  opacity: 0.88
});
```

**Alternative Route (lines 1074-1079):**
```javascript
drawRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID, altInfo.feature, {
  color: '#2563eb',     // Blue-600
  width: 4,             // 4px (thinner than primary)
  opacity: 0.75,
  dasharray: [0.6, 0.9] // Dashed pattern
});
```

**routing_overlay.js Implementation (lines 179-195):**
```javascript
function ensureLineLayer(map, layerId, sourceId, paint = {}) {
  const layout = {
    'line-cap': 'round',    // ✅ Already rounded
    'line-join': 'round',   // ✅ Already rounded
  };
  // ...
}
```

**Findings:**
- ✅ Line caps/joins are **already** rounded (good!)
- ❌ Width too narrow (5px for primary, user wants 6-8px)
- ❌ Primary route uses **solid dark color** (#111827) instead of safety-semantic colors
- ❌ No gradient or stepwise color along path

**User's Desired Styling:**
- Primary route: 6-8px, safety colors (#34d399 safe, #fbbf24 caution, #f87171 risk)
- Alternative route: Dashed, distinct hue (blue/teal), color-blind safe

### Fixes Applied

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js)

**Primary Route (line 800):**
```javascript
// Before
drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, feature, {
  color: '#111827', width: 5, opacity: 0.88
});

// After
drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, feature, {
  color: '#0f172a', width: 7, opacity: 0.92
});
```

**Alternative Route (lines 1074-1079):**
```javascript
// Before
drawRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID, altInfo.feature, {
  color: '#2563eb', width: 4, opacity: 0.75, dasharray: [0.6, 0.9]
});

// After
drawRouteOverlay(mapRef, ALT_ROUTE_SOURCE_ID, altInfo.feature, {
  color: '#0891b2',  // Cyan-600 (more distinct from primary)
  width: 5,          // Closer to primary but still distinguishable
  opacity: 0.8,
  dasharray: [1, 0.8]  // Longer dashes, more visible
});
```

**Changes:**
- **Primary width:** 5px → 7px (now in 6-8px target range)
- **Primary opacity:** 0.88 → 0.92 (stronger presence)
- **Alt color:** Blue (#2563eb) → Cyan (#0891b2) for better distinction
- **Alt width:** 4px → 5px (reduces visual dominance gap)
- **Alt dasharray:** [0.6, 0.9] → [1, 0.8] (longer dashes, more noticeable)

**Rationale:**
- Cyan vs. dark gray provides clear visual separation (color-blind safe: different lightness values)
- Dashed pattern + color difference makes alt route unmistakable
- 7px primary width feels substantial without overwhelming the network layer

### Remaining for Codex

**Safety-Colored Route Gradients - Requires Data-Driven Expressions**

**Problem:** Current implementation draws the entire route as a **single LineString feature** with uniform color. To apply safety-semantic colors along the route, we need to either:

1. **Split route into multi-segment LineStrings** (one per safety rating), OR
2. **Use MapLibre data-driven styling** with segment-level properties

**Design Approach (Recommended):**

**Option A: Multi-Segment Route (Simpler)**

1. In `routes_diary/index.js`, when calling `drawRouteOverlay()`, pass an array of segment features instead of a single route feature
2. Each segment gets colored based on its `decayed_mean` property
3. Modify `routing_overlay.js` to handle FeatureCollections:

```javascript
export function drawRouteOverlay(map, sourceId, routeData, opts = {}) {
  // If routeData is array of segments, convert to FeatureCollection
  const geojson = Array.isArray(routeData)
    ? { type: 'FeatureCollection', features: routeData }
    : normalizeFeature(routeData);

  ensureSource(map, sourceId, geojson);

  const layerId = `${sourceId}-line`;
  const paint = {
    'line-color': opts.useSafetyColors
      ? buildSafetyColorExpression() // From segments_layer.js
      : opts.color || '#0ea5e9',
    'line-width': opts.width || 4,
    'line-opacity': typeof opts.opacity === 'number' ? opts.opacity : 0.9,
    'line-blur': typeof opts.blur === 'number' ? opts.blur : 0.2,
  };
  // ...
}

function buildSafetyColorExpression() {
  return [
    'step',
    ['coalesce', ['get', 'decayed_mean'], 3],
    '#f87171',  // < 2.5 (risky)
    2.5, '#fbbf24',  // 2.5-3.4 (caution)
    3.4, '#34d399',  // 3.4-4.25 (safer)
    4.25, '#10b981'  // > 4.25 (safest)
  ];
}
```

4. Update call site:
```javascript
// In routes_diary/index.js, line 800
const routeSegments = feature.properties.segment_ids.map(id => segmentLookup.get(id));
drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, routeSegments, {
  useSafetyColors: true,
  width: 7,
  opacity: 0.92
});
```

**Option B: Gradient Line (Complex, Better UX)**

Use MapLibre's `line-gradient` property (requires line-metrics):

1. Enable `lineMetrics: true` in source
2. Compute gradient stops based on cumulative distance along route
3. Map each stop to a safety color

**Pros:** Smooth color transitions
**Cons:** More complex, requires Turf.js distance calculations

**Recommendation:** Implement Option A first (multi-segment), iterate to Option B if UX testing shows value.

**Spec Document:** See updated section in [docs/M3_MAP_STYLE_AND_LAYERS.md](../docs/M3_MAP_STYLE_AND_LAYERS.md#route-styling-design) (to be added)

---

## Task 4: Insights Panel Overflow

### Diagnosis

**Files Inspected:**
- [src/charts/diary_insights.js:274-340](../src/charts/diary_insights.js#L274-L340) - renderHeatmap()
- [src/charts/diary_insights.js:341-348](../src/charts/diary_insights.js#L341-L348) - Root container styling

**Current Constraints:**

**Root Container (line 344):**
```javascript
root.style.width = '360px';
root.style.maxHeight = '88vh';
root.style.overflow = 'hidden';
```

**Heatmap Grid (lines 289-297):**
```javascript
const grid = document.createElement('div');
grid.style.display = 'grid';
grid.style.gridTemplateColumns = `84px repeat(${heatmapWindows.length}, 1fr)`;
grid.style.gap = '8px';
grid.style.border = '1px solid #e2e8f0';
grid.style.borderRadius = '12px';
grid.style.padding = '10px';
grid.style.background = '#f8fafc';
```

**Layout Calculation:**
- Container: 360px
- Card padding (cardStyle): 12px × 2 = 24px
- Heat element padding (cardStyle): 12px × 2 = 24px
- Grid border: 1px × 2 = 2px
- Grid padding: 10px × 2 = 20px
- **Available for grid content:** 360 - 24 - 24 - 2 - 20 = **290px**

**Grid Structure:**
- 1 column (day labels): 84px
- 5 columns (time windows): `1fr` each
- 5 gaps @ 8px: 40px

**Expected column widths:**
- Total available: 290px
- Used by labels + gaps: 84px + 40px = 124px
- Remaining for 5 columns: 290 - 124 = **166px**
- Per column: 166px / 5 = **33.2px**

**Problem:**
The `1fr` units expand based on content, and if the grid cells have min-content larger than 33.2px, the grid overflows. Likely culprits:
- Time window labels (e.g., "Late night") might be wider than 33.2px when rendered
- No `max-width` constraint on grid, so it expands beyond container

### Fix Applied

**File:** [src/charts/diary_insights.js:289-299](../src/charts/diary_insights.js#L289-L299)

```javascript
// Before (lines 289-297)
const grid = document.createElement('div');
grid.style.display = 'grid';
grid.style.gridTemplateColumns = `84px repeat(${heatmapWindows.length}, 1fr)`;
grid.style.gap = '8px';
grid.style.border = '1px solid #e2e8f0';
grid.style.borderRadius = '12px';
grid.style.padding = '10px';
grid.style.background = '#f8fafc';

// After (added lines 298-299)
grid.style.maxWidth = '100%';
grid.style.overflowX = 'auto';
```

**Changes:**
- `maxWidth: '100%'` - Prevents grid from exceeding parent container width
- `overflowX: 'auto'` - If content still overflows, adds horizontal scrollbar **within the grid box**

**Expected Behavior:**
- Grid respects container boundaries (no overflow beyond card border)
- If time window labels are too wide, grid becomes horizontally scrollable
- Scrollbar appears **inside** the rounded heatmap box, not outside the card
- Vertical scrolling unaffected (root container handles via `maxHeight: '88vh'`)

**Trade-off:**
- Best case: No overflow, grid fits perfectly (most likely on desktop 1920×1080+)
- Fallback: Horizontal scroll within heatmap box (acceptable UX for small viewports)

### Alternative Solution (Not Implemented)

**Responsive Column Widths:**

```javascript
grid.style.gridTemplateColumns = `84px repeat(${heatmapWindows.length}, minmax(auto, 1fr))`;
```

**Reasoning:** `minmax(auto, 1fr)` allows columns to shrink below their content size, but this could make labels unreadable (e.g., "Evening" wrapped to 2 lines). The `overflow-x: auto` solution preserves readability.

---

## Summary of Changes

### Files Modified

1. **[src/style.css:154-157](../src/style.css#L154-L157)**
   - Strengthened diary map desaturation filter
   - `saturate(0.6)` → `saturate(0.35) brightness(1.08) contrast(0.92)`

2. **[src/routes_diary/form_submit.js:441-558](../src/routes_diary/form_submit.js#L441-L558)**
   - Refactored segment override list
   - Sort by safety score (worst first)
   - Show top 3 prominently, collapse rest in `<details>` element

3. **[src/routes_diary/index.js:800](../src/routes_diary/index.js#L800)**
   - Primary route: width 5→7px, opacity 0.88→0.92

4. **[src/routes_diary/index.js:1074-1079](../src/routes_diary/index.js#L1074-L1079)**
   - Alt route: color blue→cyan (#0891b2), width 4→5px, dasharray [0.6,0.9]→[1,0.8]

5. **[src/charts/diary_insights.js:298-299](../src/charts/diary_insights.js#L298-L299)**
   - Heatmap grid: added `maxWidth: '100%'` and `overflowX: 'auto'`

### Documentation Created

1. **[docs/M3_SEGMENT_UI_NOTES.md](../docs/M3_SEGMENT_UI_NOTES.md)** (new)
   - Segment override UX design spec
   - Spatial grouping strategy for M3+
   - Implementation notes for Codex

### Documentation Updated

1. **[docs/M3_MAP_STYLE_AND_LAYERS.md:32](../docs/M3_MAP_STYLE_AND_LAYERS.md#L32)**
   - Added note about fallback filter strength

---

## Remaining TODOs for Codex

### High Priority

1. **Safety-Colored Route Gradients**
   - Implement multi-segment route drawing OR line-gradient
   - See Task 3 design notes above
   - Target: M3 or when UX testing confirms value

2. **Spatial Segment Grouping**
   - Implement block-based override UI
   - See [docs/M3_SEGMENT_UI_NOTES.md](../docs/M3_SEGMENT_UI_NOTES.md)
   - Target: M3+

### Medium Priority

3. **MapTiler Light Style Integration**
   - User should obtain API key and add to `.env`
   - No code changes needed (already wired)
   - See [docs/M3_MAP_STYLE_AND_LAYERS.md](../docs/M3_MAP_STYLE_AND_LAYERS.md) for setup guide

4. **Responsive Heatmap**
   - Test on mobile/tablet viewports
   - Consider hiding heatmap entirely on small screens (< 768px)
   - OR: Switch to vertical layout (days as rows, windows as columns)

### Low Priority

5. **Route Styling: Start/End Markers**
   - Add small circle markers at route endpoints
   - White fill, dark border, 6-8px radius
   - See user's original spec (not implemented due to scope)

---

## Testing Recommendations

**Manual Verification (User):**

1. **Basemap Filter:**
   - Open Diary mode
   - Zoom to 12-14 (typical route viewing)
   - OSM basemap should appear **noticeably grayer** (parks less green, roads less orange)
   - Compare to Crime Explorer (should still be colorful)

2. **Segment Override List:**
   - Select any demo route
   - Click "Rate this route" button
   - Scroll to "Segment overrides" section
   - Should see:
     - Hint: "Lowest-rated segments (select up to 2):"
     - 3 segments visible (worst safety scores)
     - Collapsible disclosure: "Show N more segments"
   - Click disclosure → rest of segments appear
   - Total checkboxes = route segment count (20-40)

3. **Route Styling:**
   - Primary route should be **thicker** (7px) and **slightly darker** than before
   - Alternative route (if toggled on) should be **cyan/teal** with **dashed pattern**
   - Both routes should have **rounded line caps** (no sharp edges)

4. **Insights Panel:**
   - Expand Insights card (click "Insights ▾")
   - Scroll to "7×24 Heatmap" section
   - Grid should fit **entirely within card borders**
   - No horizontal scrollbar **outside** the heatmap box
   - If viewport is narrow, scrollbar may appear **inside** heatmap box (acceptable)

**Console Checks:**

```javascript
// Verify basemap style
map.getStyle().sources  // Should show 'osm' if no MapTiler key

// Verify map container class
document.querySelector('#map').classList.contains('diary-map-muted')  // Should be true in Diary mode

// Verify route layers
map.getLayer('diary-route-overlay-line')  // Should exist
map.getPaintProperty('diary-route-overlay-line', 'line-width')  // Should be 7
map.getPaintProperty('diary-route-overlay-line', 'line-color')  // Should be '#0f172a'
```

---

## Notes for Future Iterations

**Basemap:**
- Filter strength (`saturate(0.35)`) chosen for OSM raster fallback; may need adjustment for other raster styles
- If user configures MapTiler/Positron, filter will still apply (may be redundant) - consider mode check in setDiaryMapSkin()

**Segment Override List:**
- Current sort by `decayed_mean` assumes that lower scores = more concerning
- If future scoring inverts (e.g., crime count instead of safety rating), flip sort order
- Top 3 limit is arbitrary; could make configurable (e.g., show top 5 on larger modals)

**Route Styling:**
- Current fix maintains single-color route; gradient implementation will require significant refactor
- Consider A/B testing: do users actually notice/care about color gradients vs. hover inspection?
- Alternative approach: Add legend explaining "hover any segment to see safety rating"

**Insights Panel:**
- Overflow fix is defensive; actual overflow may not occur on desktop viewports
- Test on 1366×768 (common laptop resolution) and 1024×768 (iPad landscape) to confirm
- Consider making heatmap collapsible (like tags/trend sections) to save vertical space

---

**Log Complete**
**Agent-M**
**2025-11-26T00:33:18Z**
