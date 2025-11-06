# Address/Selection Flow — Redesign Plan

**Date:** 2025-10-20
**Purpose:** Implementation plan for codex to clarify "Query Mode" UX
**Scope:** Add explicit Point Buffer vs. Area Selection modes
**Effort:** ~30-40 minutes (UI restructure, state additions, conditional rendering)

---

## Revised UX Specification

### Step 1: Query Mode Selection (NEW)

User explicitly chooses how they want to analyze crime data:

```
┌─────────────────────────────────────┐
│ Query Mode:                         │
│ ○ Point Buffer                      │
│ ○ Police District                   │
│ ○ Census Tract                      │
└─────────────────────────────────────┘
```

**Default:** `Point Buffer` (preserves current "select on map" behavior)

**Behavior:**
- Switching mode:
  - Clears previous selection (marker, buffer circle, or highlighted area)
  - Shows/hides relevant controls (radius visible ONLY in Point Buffer mode)
  - Updates available options below

---

### Step 2a: Point Buffer Mode

**Controls visible:**
- "Select on map" button OR Address geocoder (if implemented)
- Radius dropdown (400m / 800m)
- Time window
- Offense groups / drilldown

**Interaction:**
1. User clicks "Select on map"
2. Cursor → crosshair
3. User clicks location
4. Red marker appears
5. Blue circle (radius-based) appears
6. Charts update (buffer-based queries)
7. **Choropleth:** Either (a) hidden, or (b) faded/dimmed to emphasize buffer zone

**State:**
```javascript
{
  queryMode: 'buffer',
  center3857: [x, y],
  centerLonLat: [lng, lat],
  radius: 400,
  selectedDistrictCode: null,
  selectedTractGEOID: null
}
```

---

### Step 2b: Police District Mode

**Controls visible:**
- District selector dropdown (01, 02, 03, …, 25) OR click-to-select on map
- Time window
- Offense groups / drilldown

**Controls hidden:**
- Radius (not applicable)
- "Select on map" button (or repurposed to "Click a district on map")

**Interaction (Option A: Dropdown):**
1. User selects "District 03" from dropdown
2. Map zooms/pans to District 03
3. District 03 highlighted (thicker stroke, brighter fill)
4. Other districts dimmed or hidden
5. Points layer filtered to `dc_dist = '03'`
6. Charts update (district-filtered queries)

**Interaction (Option B: Click-to-Select):**
1. User clicks "Select district on map" button
2. Cursor → pointer
3. User clicks a district polygon
4. Same highlighting/filtering as Option A

**State:**
```javascript
{
  queryMode: 'district',
  selectedDistrictCode: '03',
  center3857: null,
  radius: null,
  selectedTractGEOID: null
}
```

---

### Step 2c: Census Tract Mode

**Controls visible:**
- Tract selector (text input for GEOID or click-to-select)
- Time window
- Offense groups / drilldown

**Controls hidden:**
- Radius

**Interaction:**
1. User clicks a tract polygon on map
2. Tract highlighted
3. Other tracts dimmed or hidden
4. Points layer filtered to `ST_Within(the_geom, selected_tract_boundary)`
5. Charts update (tract-filtered queries)

**State:**
```javascript
{
  queryMode: 'tract',
  selectedTractGEOID: '42101980100',
  center3857: null,
  radius: null,
  selectedDistrictCode: null
}
```

---

### Step 3: Common Filters (All Modes)

- Time window (start month + duration)
- Offense groups / drilldown
- Rate toggle (counts vs. per-10k)

**Behavior:** These filters apply AFTER query mode determines the spatial extent.

---

## State Contract

### New State Keys

| Key | Type | Default | Purpose | Mutually Exclusive With |
|-----|------|---------|---------|-------------------------|
| `queryMode` | `'buffer' \| 'district' \| 'tract'` | `'buffer'` | Explicit mode selection | — |
| `selectedDistrictCode` | `string \| null` | `null` | Active district ID (e.g., `'03'`) | `center3857`, `selectedTractGEOID` |
| `selectedTractGEOID` | `string \| null` | `null` | Active tract ID (e.g., `'42101980100'`) | `center3857`, `selectedDistrictCode` |

### Modified Keys

| Key | Type | Default (OLD) | Default (NEW) | Change |
|-----|------|---------------|---------------|--------|
| `adminLevel` | `string` | `'districts'` | **DEPRECATED** (replaced by `queryMode`) | Remove or alias to `queryMode` |
| `center3857` | `[number,number] \| null` | `null` | `null` | Only set when `queryMode === 'buffer'` |
| `radius` | `number` | `400` | `400` | Only relevant when `queryMode === 'buffer'` |

### Validation Rules

**When `queryMode === 'buffer'`:**
- `center3857` must be non-null to render buffer-based data
- `selectedDistrictCode` and `selectedTractGEOID` must be `null`
- Radius control visible and enabled

**When `queryMode === 'district'`:**
- `selectedDistrictCode` must be non-null to filter
- `center3857`, `radius`, `selectedTractGEOID` must be `null`
- Radius control hidden

**When `queryMode === 'tract'`:**
- `selectedTractGEOID` must be non-null to filter
- `center3857`, `radius`, `selectedDistrictCode` must be `null`
- Radius control hidden

---

## Exact Changes: File-by-File

### 1. Add Query Mode Control to HTML

**File:** [index.html](../index.html)
**Location:** Insert BEFORE line 32 (before "Address A" input)

```html
<label for="queryModeSel" style="display:block; font-size:12px; color:#374151; margin-bottom:4px;">Query Mode</label>
<select id="queryModeSel" style="width:100%; margin-bottom:12px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;">
  <option value="buffer" selected>Point Buffer</option>
  <option value="district">Police District</option>
  <option value="tract">Census Tract</option>
</select>
```

**Conditional visibility (add wrapper divs):**

Replace lines 32-45 (Address A, Select on map, Radius, Time Window) with:

```html
<!-- Point Buffer Mode Controls -->
<div id="bufferModeControls" style="display:block;">
  <label for="addrA" style="display:block; font-size:12px; color:#374151;">Address A</label>
  <div style="display:flex; gap:6px; margin-bottom:8px;">
    <input id="addrA" type="text" placeholder="Enter address (optional)" style="flex:1; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
    <button id="useCenterBtn" style="padding:6px 8px; border:1px solid #94a3b8; background:#f8fafc; border-radius:6px; cursor:pointer;">Select on map</button>
  </div>
  <div id="useMapHint" style="display:none; color:#64748b; font-size:12px; margin-top:-4px; margin-bottom:8px;">Click the map to set buffer center. Press Esc to cancel.</div>

  <label for="radiusSel" style="display:block; font-size:12px; color:#374151;">Radius</label>
  <select id="radiusSel" style="width:100%; margin-bottom:8px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;">
    <option value="400">400 m</option>
    <option value="800">800 m</option>
  </select>
</div>

<!-- District Mode Controls -->
<div id="districtModeControls" style="display:none;">
  <label for="districtSel" style="display:block; font-size:12px; color:#374151;">Select District</label>
  <select id="districtSel" style="width:100%; margin-bottom:8px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;">
    <option value="">— Click district on map or choose —</option>
    <option value="01">District 01</option>
    <option value="02">District 02</option>
    <option value="03">District 03</option>
    <!-- Add all 25 districts -->
  </select>
  <div style="font-size:11px; color:#64748b; margin-top:-4px; margin-bottom:8px;">Or click a district polygon on the map</div>
</div>

<!-- Tract Mode Controls -->
<div id="tractModeControls" style="display:none;">
  <label for="tractInput" style="display:block; font-size:12px; color:#374151;">Select Tract</label>
  <input id="tractInput" type="text" placeholder="Click tract on map or enter GEOID" style="width:100%; margin-bottom:8px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" readonly />
  <div style="font-size:11px; color:#64748b; margin-top:-4px; margin-bottom:8px;">Click a census tract polygon on the map</div>
</div>
```

**Keep existing:** Time Window, Admin Level (deprecate later), Offense Groups, etc.

---

### 2. Update State Store

**File:** [src/state/store.js](../src/state/store.js)
**Location:** Lines 23-62 (store definition)

**Add new keys:**

```diff
 export const store = /** @type {Store} */ ({
   addressA: null,
   addressB: null,
   radius: 400,
   timeWindowMonths: 6,
   startMonth: null,
   durationMonths: 6,
   selectedGroups: [],
   selectedTypes: [],
-  adminLevel: 'districts',
+  queryMode: 'buffer',  // 'buffer' | 'district' | 'tract'
+  selectedDistrictCode: null,  // '01', '02', ..., '25'
+  selectedTractGEOID: null,    // '42101980100', etc.
   selectMode: 'idle',
   centerLonLat: null,
   per10k: false,
   mapBbox: null,
   center3857: null,
```

**Update getFilters():** [store.js:48-54](../src/state/store.js#L48-L54)

```diff
   getFilters() {
     const { start, end } = this.getStartEnd();
     const types = (this.selectedTypes && this.selectedTypes.length)
       ? this.selectedTypes.slice()
       : expandGroupsToCodes(this.selectedGroups || []);
-    return { start, end, types, center3857: this.center3857, radiusM: this.radius };
+    return {
+      start,
+      end,
+      types,
+      queryMode: this.queryMode,
+      center3857: this.center3857,
+      radiusM: this.radius,
+      districtCode: this.selectedDistrictCode,
+      tractGEOID: this.selectedTractGEOID,
+    };
   },
```

---

### 3. Wire Query Mode Toggle

**File:** [src/ui/panel.js](../src/ui/panel.js)
**Location:** Insert after line 29 (after `preset12` declaration)

```javascript
const queryModeSel = document.getElementById('queryModeSel');
const bufferModeControls = document.getElementById('bufferModeControls');
const districtModeControls = document.getElementById('districtModeControls');
const tractModeControls = document.getElementById('tractModeControls');

queryModeSel?.addEventListener('change', () => {
  store.queryMode = queryModeSel.value;

  // Show/hide mode-specific controls
  if (bufferModeControls) bufferModeControls.style.display = store.queryMode === 'buffer' ? 'block' : 'none';
  if (districtModeControls) districtModeControls.style.display = store.queryMode === 'district' ? 'block' : 'none';
  if (tractModeControls) tractModeControls.style.display = store.queryMode === 'tract' ? 'block' : 'none';

  // Clear selections from other modes
  if (store.queryMode !== 'buffer') {
    store.center3857 = null;
    store.centerLonLat = null;
  }
  if (store.queryMode !== 'district') {
    store.selectedDistrictCode = null;
  }
  if (store.queryMode !== 'tract') {
    store.selectedTractGEOID = null;
  }

  onChange();
});
```

**Initialize visibility:** Insert after line 106 (after durationSel default)

```javascript
// Initialize query mode controls visibility
if (queryModeSel) queryModeSel.value = store.queryMode || 'buffer';
if (bufferModeControls) bufferModeControls.style.display = store.queryMode === 'buffer' ? 'block' : 'none';
if (districtModeControls) districtModeControls.style.display = store.queryMode === 'district' ? 'block' : 'none';
if (tractModeControls) tractModeControls.style.display = store.queryMode === 'tract' ? 'block' : 'none';
```

---

### 4. Wire District Dropdown

**File:** [src/ui/panel.js](../src/ui/panel.js)
**Location:** Insert after query mode listener

```javascript
const districtSel = document.getElementById('districtSel');
districtSel?.addEventListener('change', () => {
  store.selectedDistrictCode = districtSel.value || null;
  onChange();
});
```

---

### 5. Add Radius Update Handler

**File:** [src/main.js](../src/main.js)
**Location:** Line 111 (initPanel call)

**Replace:**
```javascript
initPanel(store, { onChange: refreshAll, getMapCenter: () => map.getCenter() });
```

**With:**
```javascript
initPanel(store, {
  onChange: refreshAll,
  getMapCenter: () => map.getCenter(),
  onRadiusInput: (radius) => {
    if (store.centerLonLat && store.queryMode === 'buffer') {
      upsertBufferA(map, { centerLonLat: store.centerLonLat, radiusM: radius });
    }
  }
});
```

**Import:** Add at top of file
```javascript
import { upsertBufferA, clearBufferA } from './map/buffer_overlay.js';
```

---

### 6. Update refreshAll to Handle Query Modes

**File:** [src/main.js](../src/main.js)
**Location:** Lines 67-109 (refreshAll function)

**Replace choropleth logic:**

```diff
   async function refreshAll() {
     const { start, end, types } = store.getFilters();
     try {
-      if (store.adminLevel === 'tracts') {
-        const merged = await getTractsMerged({ per10k: store.per10k });
-        const { breaks, colors } = renderTractsChoropleth(map, merged);
-        drawLegend(breaks, colors, '#legend');
-      } else {
-        const merged = await getDistrictsMerged({ start, end, types });
-        const { breaks, colors } = renderDistrictChoropleth(map, merged);
-        drawLegend(breaks, colors, '#legend');
-      }
+      if (store.queryMode === 'tract') {
+        const merged = await getTractsMerged({ per10k: store.per10k });
+        const { breaks, colors } = renderTractsChoropleth(map, merged);
+        drawLegend(breaks, colors, '#legend');
+        // TODO: Highlight selected tract if store.selectedTractGEOID is set
+      } else if (store.queryMode === 'district') {
+        const merged = await getDistrictsMerged({ start, end, types });
+        const { breaks, colors } = renderDistrictChoropleth(map, merged);
+        drawLegend(breaks, colors, '#legend');
+        // TODO: Highlight selected district if store.selectedDistrictCode is set
+      } else if (store.queryMode === 'buffer') {
+        // Option A: Show all districts (current behavior)
+        const merged = await getDistrictsMerged({ start, end, types });
+        const { breaks, colors } = renderDistrictChoropleth(map, merged);
+        drawLegend(breaks, colors, '#legend');
+        // Option B: Hide choropleth entirely in buffer mode
+        // clearDistrictLayers(map); clearTractLayers(map);
+      }
     } catch (e) {
       console.warn('Boundary refresh failed:', e);
     }
```

**Update points refresh:**

```diff
-    refreshPoints(map, { start, end, types }).catch((e) => console.warn('Points refresh failed:', e));
+    const pointFilters = { start, end, types };
+    // Add spatial filter based on query mode
+    if (store.queryMode === 'buffer') {
+      // Points layer uses bbox (current behavior)
+    } else if (store.queryMode === 'district' && store.selectedDistrictCode) {
+      // TODO: Add district filter to points SQL
+      pointFilters.districtCode = store.selectedDistrictCode;
+    } else if (store.queryMode === 'tract' && store.selectedTractGEOID) {
+      // TODO: Add tract filter to points SQL
+      pointFilters.tractGEOID = store.selectedTractGEOID;
+    }
+    refreshPoints(map, pointFilters).catch((e) => console.warn('Points refresh failed:', e));
```

**Update charts call:**

```diff
     const f = store.getFilters();
-    if (f.center3857) {
+    if (f.queryMode === 'buffer' && f.center3857) {
       updateAllCharts(f).catch((e) => { /* error handling */ });
+    } else if (f.queryMode === 'district' && f.districtCode) {
+      // TODO: Call district-specific charts update
+      // updateDistrictCharts({ start, end, types, districtCode });
+    } else if (f.queryMode === 'tract' && f.tractGEOID) {
+      // TODO: Call tract-specific charts update
+    } else {
+      const pane = document.getElementById('charts') || document.body;
+      const status = document.getElementById('charts-status');
+      if (status) status.innerText = 'Select a location/area to show charts';
     }
```

---

### 7. Add District Click Handler

**File:** [src/main.js](../src/main.js) OR new file [src/map/wire_area_select.js](../src/map/wire_area_select.js)
**Location:** Insert after `wirePoints` call (around line 47)

```javascript
// Wire district selection
map.on('click', 'districts-fill', (e) => {
  if (store.queryMode === 'district') {
    const f = e.features && e.features[0];
    if (!f) return;
    const code = String(f.properties?.DIST_NUMC || '').padStart(2, '0');
    store.selectedDistrictCode = code;

    // Update UI
    const districtSel = document.getElementById('districtSel');
    if (districtSel) districtSel.value = code;

    refreshAll();
  }
});

// Wire tract selection
map.on('click', 'tracts-fill', (e) => {
  if (store.queryMode === 'tract') {
    const f = e.features && e.features[0];
    if (!f) return;
    const geoid = f.properties?.__geoid || f.properties?.GEOID;
    store.selectedTractGEOID = geoid;

    // Update UI
    const tractInput = document.getElementById('tractInput');
    if (tractInput) tractInput.value = geoid;

    refreshAll();
  }
});
```

---

### 8. Add Esc Key Listener

**File:** [src/main.js](../src/main.js)
**Location:** Insert after `map.on('click', ...)` handlers (around line 150)

```javascript
// Cancel point selection on Esc key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && store.selectMode === 'point') {
    store.selectMode = 'idle';
    const btn = document.getElementById('useCenterBtn');
    if (btn) btn.textContent = 'Select on map';
    const hint = document.getElementById('useMapHint');
    if (hint) hint.style.display = 'none';
    document.body.style.cursor = '';
  }
});
```

---

## Acceptance Tests

### Test 1: Point Buffer Mode (Default)

**Steps:**
1. Open app (fresh load)
2. Verify Query Mode dropdown shows "Point Buffer" selected
3. Verify "Select on map" button visible
4. Verify Radius dropdown visible (400m selected)
5. Click "Select on map"
6. Click map location
7. Verify:
   - Red marker appears
   - Blue circle (400m) appears
   - Charts update (monthly, top-N, heatmap)
   - `store.queryMode === 'buffer'`
   - `store.center3857` is non-null
   - `store.selectedDistrictCode === null`
8. Change radius to 800m
9. Verify:
   - Buffer circle redraws to 800m
   - Charts refetch with new radius
   - Visual circle matches selected radius

**Expected:** ✅ All buffer features work, radius updates visual

---

### Test 2: Switch to District Mode

**Steps:**
1. Set Query Mode to "Police District"
2. Verify:
   - Radius dropdown hidden
   - "Select on map" button hidden (or repurposed)
   - District dropdown visible
3. Select "District 03" from dropdown
4. Verify:
   - Map shows District 03 highlighted (TODO: implement highlight)
   - Points layer filtered to District 03 (TODO: implement filter)
   - `store.selectedDistrictCode === '03'`
   - `store.center3857 === null`
5. Click a different district polygon on map
6. Verify:
   - Dropdown updates to clicked district code
   - `store.selectedDistrictCode` updates
   - Highlight moves to new district

**Expected:** ✅ District mode works, radius hidden, selection state updates

---

### Test 3: Switch to Tract Mode

**Steps:**
1. Set Query Mode to "Census Tract"
2. Verify:
   - Radius dropdown hidden
   - Tract input visible (read-only)
3. Click a tract polygon on map
4. Verify:
   - Tract input shows GEOID (e.g., "42101980100")
   - `store.selectedTractGEOID` set
   - `store.center3857 === null`
   - Tract highlighted (TODO: implement)

**Expected:** ✅ Tract mode works, click-to-select functional

---

### Test 4: Switch Between Modes

**Steps:**
1. Set to Point Buffer, select a point
2. Verify buffer circle visible, `center3857` set
3. Switch to District mode
4. Verify:
   - Buffer circle cleared (TODO: implement clear)
   - `center3857 === null`
   - `selectedDistrictCode === null` (no district selected yet)
5. Select District 05
6. Switch back to Point Buffer
7. Verify:
   - `selectedDistrictCode === null`
   - Previous buffer circle NOT restored (user must re-select)

**Expected:** ✅ Mode switches clear incompatible selections

---

### Test 5: Esc Key Cancels Point Selection

**Steps:**
1. Set to Point Buffer mode
2. Click "Select on map" (cursor → crosshair)
3. Press Esc key
4. Verify:
   - Cursor returns to normal
   - Button text → "Select on map"
   - Hint text hidden
   - `store.selectMode === 'idle'`

**Expected:** ✅ Esc key cancels selection

---

### Test 6: Radius Control Visibility

**Steps:**
1. Set to Point Buffer → verify radius visible
2. Set to District → verify radius hidden
3. Set to Tract → verify radius hidden
4. Set back to Point Buffer → verify radius visible again

**Expected:** ✅ Radius only shown in buffer mode

---

## Phased Implementation

### Phase 1: Minimal (MVP)

**Goal:** Add query mode dropdown and conditional visibility
**Files:** index.html, panel.js, store.js
**Features:**
- Query mode dropdown (buffer / district / tract)
- Show/hide radius based on mode
- State keys added (queryMode, selectedDistrictCode, selectedTractGEOID)

**Validation:** Radius hidden in district/tract modes

---

### Phase 2: District Selection

**Goal:** Enable district dropdown and click-to-select
**Files:** main.js (add district click handler), panel.js (district dropdown wiring)
**Features:**
- District dropdown functional
- Click district polygon → sets selectedDistrictCode
- Dropdown updates when polygon clicked

**Validation:** District code stored in state, dropdown syncs with map clicks

---

### Phase 3: Visual Feedback

**Goal:** Highlight selected district/tract
**Files:** render_choropleth.js, render_choropleth_tracts.js
**Features:**
- Add highlight layer for selected area
- Dim/hide non-selected areas (optional)

**Validation:** Selected district has thicker stroke, others faded

---

### Phase 4: Filtering & Charts

**Goal:** Filter points and charts to selected area
**Files:** sql.js (add district/tract WHERE clauses), charts/index.js (district charts)
**Features:**
- Points SQL: `AND dc_dist = '03'` when district selected
- Charts: district-specific aggregations
- Tract filtering (requires spatial query)

**Validation:** Points and charts only show data for selected area

---

## Rollback Plan

If redesign causes issues:

1. **Revert HTML changes:** Restore original controls (remove queryModeSel, wrapper divs)
2. **Revert store.js:** Remove `queryMode`, `selectedDistrictCode`, `selectedTractGEOID`
3. **Revert panel.js:** Remove query mode listener
4. **Keep fixes:** Radius update handler (onRadiusInput), Esc key listener (if no conflicts)

**Rollback command:**
```bash
git checkout HEAD -- index.html src/state/store.js src/ui/panel.js src/main.js
```

---

## Summary

**Key Changes:**
1. Add `queryMode` dropdown (buffer / district / tract)
2. Conditional control visibility (radius only in buffer mode)
3. Add district/tract selection state keys
4. Wire district dropdown + map click handlers
5. Update `refreshAll()` to branch on `queryMode`
6. Add `onRadiusInput` handler to redraw buffer circle
7. Add Esc key listener

**Benefits:**
- Explicit user intent (buffer vs. area selection)
- Reduced confusion (radius hidden when irrelevant)
- Foundation for single-district/tract filtering
- Visual consistency (radius slider matches buffer circle)

**Effort:** 30-40 minutes for Phase 1+2; additional time for Phase 3+4 (highlighting, filtering)

---

**Status:** ✅ READY FOR CODEX IMPLEMENTATION
**Priority:** Implement Phase 1 first (minimal viable UX improvement)
