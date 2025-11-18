# Road Network Audit — Visibility & Route Location Issues

**Date:** 2025-11-18T03:00:00Z
**Agent:** Agent-M (Manager Audit Mode)
**Task:** Diagnose why background network is invisible and why demo routes appear in New Jersey

---

## Executive Summary

**Current State:** Road network pipeline successfully fetches 109,953 raw streets and generates 144,120 network segments, but:

1. **Background Network Invisible:** Gray network layer renders but is indistinguishable from basemap roads
2. **Routes in New Jersey:** All 5 demo routes are east of the Delaware River (lng -75.03 to -74.99)
3. **No UI Toggle:** Missing "Show road network" checkbox in Diary panel
4. **Random Route Generation:** Routes pick random start points from entire 144k segment network (both PA and NJ)

**Root Causes:**
- Network layer color/width nearly identical to basemap → invisible to users
- Overpass bbox includes New Jersey → routes can start anywhere in region
- No geographic constraints in `walkRoute()` function → random walks cross state lines
- Layer insertion order not specified → may render below basemap roads

---

## A. Road Network Data Extent Analysis

### A.1 — Data Files Inspection

**Command Run:**
```bash
node scripts/inspect_roadnet.mjs data/streets_phl.raw.geojson
node scripts/inspect_roadnet.mjs data/segments_phl.network.geojson
node scripts/inspect_roadnet.mjs data/routes_phl.demo.geojson
```

**Results:**

| File | Features | Class Distribution | Bbox | Status |
|------|----------|-------------------|------|--------|
| `streets_phl.raw.geojson` | 109,953 | unknown: 109,953 | *too large to compute* | ✅ Data exists |
| `segments_phl.network.geojson` | 144,120 | 1: 4,043<br>2: 8,267<br>3: 5,598<br>4: 126,212 | *too large to compute* | ✅ Properly classified |
| `routes_phl.demo.geojson` | 5 | unknown: 5 | **[-75.0307, 39.9947]** to **[-74.9990, 40.0089]** | ❌ **IN NEW JERSEY** |

**Analysis:**

**Routes are in New Jersey:**
- Route bbox longitude: **-75.03 to -74.99**
- Philadelphia City Hall: approximately **-75.16** longitude
- Delaware River (east bank): approximately **-75.13** longitude
- **Conclusion:** Routes are 0.13-0.16 degrees **east** of Philadelphia proper

**Sample Route Coordinate (from routes_phl.demo.geojson:10-11):**
```json
[-75.0277302, 40.0069865]
```
This is near **Palmyra, NJ** (across the river from Tacony/Northeast Philadelphia).

### A.2 — Overpass Query Bbox

**File:** [scripts/fetch_streets_phl.mjs:14-16](../scripts/fetch_streets_phl.mjs#L14-L16)

```javascript
const DEFAULT_OVERPASS_URL =
  'https://overpass-api.de/api/interpreter?data=[out:json];way["highway"](39.90,-75.30,40.05,-75.00);out geom;';
const STREETS_PHL_URL = process.env.STREETS_PHL_URL || DEFAULT_OVERPASS_URL;
```

**Bbox Analysis:**
- **Overpass bbox:** `(39.90, -75.30, 40.05, -75.00)` (south, west, north, east)
- **Coverage:**
  - Latitude: 39.90 to 40.05 (covers all of Philadelphia north-south) ✅
  - Longitude: **-75.30 to -75.00** (includes eastern New Jersey) ❌

**Geographic Reality:**
- Philadelphia core: approximately -75.28 to -75.13 longitude
- Delaware River: approximately -75.13 to -75.10 longitude
- New Jersey shore: approximately -75.10 to -75.00 longitude

**Problem:** The eastern boundary at **-75.00** extends **10 km into New Jersey**, including:
- Camden, NJ
- Palmyra, NJ
- Merchantville, NJ
- Cherry Hill, NJ

### A.3 — Segment Network Segmentation Bbox

**File:** [scripts/segment_streets_phl.mjs:14](../scripts/segment_streets_phl.mjs#L14)

```javascript
const STUDY_BBOX = [-75.28, 39.90, -75.00, 40.05];
```

**Analysis:**
- Segmentation uses same bbox as Overpass query
- Does NOT filter out New Jersey segments
- All 144,120 segments include both Pennsylvania and New Jersey roads

**Recommendation:** Narrow eastern boundary to approximately **-75.13** (Delaware River) to exclude New Jersey.

---

## B. Background Network Layer Visibility Analysis

### B.1 — Network Layer Code

**File:** [src/map/network_layer.js](../src/map/network_layer.js)

**Source & Layer IDs:**
- Source: `diary-network` (line 3)
- Layer: `diary-network-line` (line 4)

**Styling (lines 50-70):**
```javascript
paint: {
  'line-color': '#cbd5e1',        // Tailwind gray-300
  'line-opacity': 0.4,
  'line-width': [
    'interpolate', ['linear'], ['zoom'],
    10, ['case',
      ['==', ['get', 'class'], 1], 3.4,
      ['==', ['get', 'class'], 2], 2.8,
      ['==', ['get', 'class'], 3], 2.0,
      1.5],
    14, ['case',
      ['==', ['get', 'class'], 1], 4.2,
      ['==', ['get', 'class'], 2], 3.4,
      ['==', ['get', 'class'], 3], 2.4,
      1.6],
  ],
}
```

**Throttling (lines 24-27):**
```javascript
if (Array.isArray(raw?.features) && raw.features.length > 15000) {
  const step = Math.ceil(raw.features.length / 15000);
  raw.features = raw.features.filter((_, idx) => idx % step === 0);
}
```
- Network has 144,120 segments → throttled to ~15,000 features (every 10th segment)

### B.2 — Integration in Diary Route

**File:** [src/routes_diary/index.js:1659](../src/routes_diary/index.js#L1659)

```javascript
await addNetworkLayer(mapRef);
```

**Lifecycle:** Called during `initDiaryMode()` after map loads, before demo segments.

**Layer Insertion:** No `beforeId` parameter specified in `map.addLayer()` call (network_layer.js:45) → layer added to **top of stack**.

### B.3 — Why Network is Invisible

**Root Cause: Style Indistinguishable from Basemap**

1. **Color:** `#cbd5e1` (light gray) matches typical basemap road colors
   - Most basemaps (Maptiler, Mapbox, OpenStreetMap) use gray/white for roads
   - 0.4 opacity makes it even more subtle

2. **Line Width:** 1.5-4.2px depending on zoom/class
   - Similar to basemap road widths
   - No halo or outline for contrast

3. **No Minzoom:** Layer renders at all zoom levels
   - At low zoom (city-wide view), lines are too thin to see
   - At high zoom (street level), indistinguishable from basemap

4. **Layer Order:** Added to top of stack, but:
   - May still render below basemap labels
   - No guaranteed z-order relative to basemap roads

**Evidence from User Report:** "I still do not see any obvious gray 'background network' lines"

### B.4 — Recommended Style Tweaks (Small Hotfixes)

To make network **clearly visible but still subtle**:

1. **Increase Contrast:**
   ```javascript
   'line-color': '#94a3b8',  // Darker gray (slate-400 instead of gray-300)
   'line-opacity': 0.6,      // Increase from 0.4
   ```

2. **Add Minzoom:**
   ```javascript
   layout: {
     'line-cap': 'round',
     'line-join': 'round',
     'minzoom': 11,  // Only show at neighborhood zoom or closer
   }
   ```

3. **Increase Width Slightly:**
   ```javascript
   // At zoom 10: 1.8-4.0px (was 1.5-3.4)
   // At zoom 14: 2.0-5.0px (was 1.6-4.2)
   ```

4. **Add Halo for Contrast (Optional):**
   - Create second layer `diary-network-halo` with white blur

**Status:** These are small, surgical fixes appropriate for Agent-M. Can be applied now or documented for Codex.

---

## C. Demo Routes Location Analysis

### C.1 — Route Geographic Extent

**File:** [data/routes_phl.demo.geojson](../data/routes_phl.demo.geojson)

**Bbox:** `[-75.0307521, 39.9947419]` to `[-74.9990806, 40.0089411]`

**All 5 Routes in New Jersey:**

| Route | ID | Length | Approx Location |
|-------|-----|--------|-----------------|
| Route A | route_A | ~2.8 km | Palmyra/Riverton, NJ |
| Route B | route_B | ~3.2 km | Palmyra, NJ |
| Route C | route_C | ~2.5 km | Merchantville, NJ |
| Route D | route_D | ~3.6 km | Pennsauken/Camden, NJ |
| Route E | route_E | ~2.2 km | Cherry Hill, NJ |

**Verification:** Sample coordinates from Route A (lines 9-11):
```
[-75.0277302, 40.0069865]  → Palmyra, NJ (east of Tacony Creek State Park)
```

### C.2 — Route Generation Algorithm

**File:** [scripts/generate_demo_data.mjs:225-280](../scripts/generate_demo_data.mjs#L225-L280)

**Current Algorithm (`walkRoute` function):**

1. **Build Adjacency Graph (lines 204-216):**
   ```javascript
   segments.forEach((seg) => {
     const a = nodeKey(coords[0]);        // Start node
     const b = nodeKey(coords[coords.length - 1]);  // End node
     adjacency.get(a).push(seg);
     adjacency.get(b).push(seg);
   });
   ```
   - Creates graph from ALL segments (no geographic filter)

2. **Pick Random Start (line 229):**
   ```javascript
   const startKey = keys[Math.floor(rand() * keys.length)];
   ```
   - **Problem:** Picks from ALL 144k segments (includes NJ)

3. **Random Walk (lines 234-245):**
   ```javascript
   for (let i = 0; i < maxSegments; i += 1) {
     const neighbors = adjacency.get(currentKey) || [];
     const pool = unvisited.length ? unvisited : neighbors;
     const nextSeg = pool[Math.floor(rand() * pool.length)];
     // ... walk until length >= 2.2-4.2 km
   }
   ```
   - Walks graph randomly until target length
   - No geographic constraints
   - Can cross state lines, rivers, etc.

4. **No Philly Constraint:**
   - No bbox filter for route start/end points
   - No landmark anchoring
   - No "stay west of Delaware River" logic

**Why Routes End Up in NJ:**
- Network includes 144k segments spanning PA + NJ
- Random start picks from entire region
- With 50/50 chance, routes can start in NJ
- Once in NJ, random walk stays connected to NJ roads

### C.3 — Proposed Fix Algorithm

**Objective:** Constrain all routes to Philadelphia proper (west of Delaware River).

**Strategy 1: Geographic Bbox Filter (Simplest)**

```javascript
// In generate_demo_data.mjs, before walkRoute():

const PHILLY_BBOX = [-75.28, 39.90, -75.135, 40.05];  // West of Delaware River

function isInPhilly(segment) {
  const coords = segment.geometry?.coordinates || [];
  if (!coords.length) return false;
  const [lng, lat] = coords[0];
  return lng >= PHILLY_BBOX[0] && lng <= PHILLY_BBOX[2]
      && lat >= PHILLY_BBOX[1] && lat <= PHILLY_BBOX[3];
}

// Filter segments BEFORE building adjacency graph:
const phillySegments = segments.filter(isInPhilly);
// ... then build adjacency from phillySegments only
```

**Result:** Routes can only start/traverse Philadelphia segments.

**Strategy 2: Landmark Anchoring (More Realistic)**

```javascript
// Define 5 anchor points for route origins:
const ROUTE_ANCHORS = [
  { name: '30th St Station', center: [-75.1815, 39.9559], radius: 0.003 },
  { name: 'Rittenhouse Sq', center: [-75.1720, 39.9495], radius: 0.003 },
  { name: 'Penn Campus', center: [-75.1950, 39.9525], radius: 0.004 },
  { name: 'City Hall', center: [-75.1635, 39.9524], radius: 0.003 },
  { name: 'South Philly', center: [-75.1710, 39.9350], radius: 0.004 },
];

function findNearestSegment(anchor, segments) {
  let best = null;
  let minDist = Infinity;
  segments.forEach(seg => {
    const [lng, lat] = seg.geometry.coordinates[0];
    const dist = Math.sqrt((lng - anchor.center[0])**2 + (lat - anchor.center[1])**2);
    if (dist < minDist && dist < anchor.radius) {
      minDist = dist;
      best = seg;
    }
  });
  return best;
}

// For each route, start from specific anchor:
for (let i = 0; i < routeCount; i++) {
  const anchor = ROUTE_ANCHORS[i % ROUTE_ANCHORS.length];
  const startSeg = findNearestSegment(anchor, phillySegments);
  const startKey = nodeKey(startSeg.geometry.coordinates[0]);

  // ... then walk from startKey (with bbox constraint to stay in Philly)
}
```

**Acceptance Criteria (Route Fix):**
- [ ] All routes start west of -75.13 longitude (Philadelphia side)
- [ ] Routes stay within Philadelphia bbox (no NJ segments)
- [ ] Route lengths still realistic (1.5-4.5 km)
- [ ] Routes follow connected network (no gaps)

---

## D. Five Realistic Philly Demo Routes (Target Scenarios)

### Route A: University City Commute
- **From:** 30th Street Station (30th & Market, regional rail entrance)
- **To:** Clark Park (43rd & Chester, West Philly)
- **Distance:** ~2.0 km (1.2 miles)
- **Corridor:** Market St west to 36th, then Spruce or Baltimore Ave to 43rd
- **Mode:** Walk or bike
- **Anchor Start:** `[-75.1815, 39.9559]` (30th St Station entrance)
- **Anchor End:** `[-75.2075, 39.9485]` (Clark Park vicinity)

**Implementation Notes:**
- Find segment nearest to 30th St Station start point
- Walk graph generally west along major east-west streets
- Target end within 0.003° radius of Clark Park
- Length target: 1,800-2,400m

### Route B: Station to Rittenhouse
- **From:** 30th Street Station
- **To:** Rittenhouse Square (18th & Walnut)
- **Distance:** ~2.2 km (1.4 miles)
- **Corridor:** Cross Schuylkill via Market St Bridge, then Walnut or Chestnut to Rittenhouse
- **Mode:** Walk
- **Anchor Start:** `[-75.1815, 39.9559]` (30th St Station)
- **Anchor End:** `[-75.1720, 39.9495]` (Rittenhouse Square)

**Implementation Notes:**
- Route must cross Schuylkill River (verify bridge segments exist)
- Prefer class 2-3 streets (arterials/collectors, not highways)
- Length target: 2,000-2,600m

### Route C: Campus to Italian Market
- **From:** Penn Campus Core (Locust Walk near 36th-38th St)
- **To:** Italian Market (9th & Christian, South Philly)
- **Distance:** ~4.5 km (2.8 miles)
- **Corridor:** Use Pine or Spruce St east, then south on 9th or 10th
- **Mode:** Bike
- **Anchor Start:** `[-75.1950, 39.9525]` (Penn campus Locust Walk)
- **Anchor End:** `[-75.1585, 39.9390]` (9th & Christian)

**Implementation Notes:**
- Longest route (suitable for bike mode)
- Use protected bike lanes if available (Pine/Spruce)
- Length target: 4,000-5,000m

### Route D: City Hall to Penn Campus
- **From:** Philadelphia City Hall (Broad & Market)
- **To:** Penn Campus Gateway (34th & Walnut)
- **Distance:** ~2.5 km (1.6 miles)
- **Corridor:** Market St or JFK Blvd west to 34th, then into campus
- **Mode:** Walk or bike
- **Anchor Start:** `[-75.1635, 39.9524]` (City Hall courtyard)
- **Anchor End:** `[-75.1925, 39.9540]` (34th & Walnut)

**Implementation Notes:**
- Major commuter route (high realism)
- Prefer Market St (class 2, wide sidewalks)
- Length target: 2,200-3,000m

### Route E: Rittenhouse to East Passyunk
- **From:** Rittenhouse Square
- **To:** East Passyunk Avenue (around Tasker St, South Philly)
- **Distance:** ~3.2 km (2.0 miles)
- **Corridor:** South on Broad St, then diagonal along East Passyunk Ave
- **Mode:** Bike
- **Anchor Start:** `[-75.1720, 39.9495]` (Rittenhouse Square)
- **Anchor End:** `[-75.1640, 39.9265]` (Passyunk & Tasker)

**Implementation Notes:**
- Use East Passyunk Ave diagonal for character
- Mix of class 1 (Broad St) and class 3 (local streets)
- Length target: 2,800-3,800m

### Anchor Implementation Pseudocode

```javascript
// In generate_demo_data.mjs, replace ROUTE_NAMES array:

const ROUTE_SCENARIOS = [
  {
    name: 'University City Commute',
    from: '30th St Station',
    to: 'Clark Park',
    startAnchor: [-75.1815, 39.9559],
    endAnchor: [-75.2075, 39.9485],
    targetLength: [1800, 2400],
    mode: 'walk',
  },
  {
    name: 'Station to Rittenhouse',
    from: '30th St Station',
    to: 'Rittenhouse Square',
    startAnchor: [-75.1815, 39.9559],
    endAnchor: [-75.1720, 39.9495],
    targetLength: [2000, 2600],
    mode: 'walk',
  },
  {
    name: 'Campus to Italian Market',
    from: 'Penn Campus',
    to: 'Italian Market',
    startAnchor: [-75.1950, 39.9525],
    endAnchor: [-75.1585, 39.9390],
    targetLength: [4000, 5000],
    mode: 'bike',
  },
  {
    name: 'City Hall to Penn',
    from: 'City Hall',
    to: 'Penn Campus',
    startAnchor: [-75.1635, 39.9524],
    endAnchor: [-75.1925, 39.9540],
    targetLength: [2200, 3000],
    mode: 'walk',
  },
  {
    name: 'Rittenhouse to East Passyunk',
    from: 'Rittenhouse Square',
    to: 'East Passyunk Ave',
    startAnchor: [-75.1720, 39.9495],
    endAnchor: [-75.1640, 39.9265],
    targetLength: [2800, 3800],
    mode: 'bike',
  },
];

// Modified walkRoute to accept startKey parameter:
function walkRoute({ startKey, minLen, maxLen, maxSegments, bbox } = {}) {
  // If no startKey, pick random (but within bbox if provided)
  if (!startKey) {
    const keys = Array.from(adjacency.keys());
    if (bbox) {
      // Filter keys to only those within bbox
      startKey = keys.filter(key => {
        const coords = parseNodeKey(key);
        return coords && isInBbox(coords, bbox);
      })[Math.floor(rand() * filtered.length)];
    } else {
      startKey = keys[Math.floor(rand() * keys.length)];
    }
  }

  // ... rest of walk logic, but check bbox constraint before adding segments
}

// Route generation loop:
for (let i = 0; i < routeCount; i++) {
  const scenario = ROUTE_SCENARIOS[i % ROUTE_SCENARIOS.length];

  // Find start segment near anchor
  const startSeg = findNearestSegment(scenario.startAnchor, phillySegments);
  const startKey = nodeKey(startSeg.geometry.coordinates[0]);

  // Walk with bbox constraint
  const primarySegments = walkRoute({
    startKey,
    minLen: scenario.targetLength[0],
    maxLen: scenario.targetLength[1],
    bbox: PHILLY_BBOX,
  });

  // Alt route from different nearby start
  const altSeg = findNearestSegment(scenario.startAnchor, phillySegments, { exclude: startSeg });
  const altKey = nodeKey(altSeg.geometry.coordinates[0]);
  const altSegments = walkRoute({
    startKey: altKey,
    minLen: scenario.targetLength[0] * 0.85,
    maxLen: scenario.targetLength[1] * 0.95,
    bbox: PHILLY_BBOX,
  });

  // ... build route feature with scenario.name, from, to, mode
}
```

---

## E. Missing UI Toggle

### Current State
- No "Show road network" checkbox in Diary panel
- Network layer always visible (when it renders)
- Users cannot toggle background grid on/off

### Specification (from ROAD_NETWORK_NOTES.md)

**File:** [docs/ROAD_NETWORK_NOTES.md:280-305](../docs/ROAD_NETWORK_NOTES.md#L280-L305)

**Functionality Required:**
```javascript
// In src/routes_diary/index.js (panel controls section)
function buildNetworkToggle() {
  return `
    <div class="diary-control-row">
      <label class="diary-control-label">
        <input type="checkbox" id="diary-network-toggle" checked />
        <span>Show road network</span>
      </label>
      <span class="diary-control-hint">Background street grid for context</span>
    </div>
  `;
}

// Event listener:
document.getElementById('diary-network-toggle')?.addEventListener('change', (e) => {
  const visible = e.target.checked;
  setNetworkLayerVisibility(mapInstance, visible);
});
```

**Implementation:** Requires `setNetworkLayerVisibility()` function in network_layer.js (does not currently exist).

**Status:** Not yet implemented. Assign to Codex for next packet.

---

## F. Summary of Findings

| Issue | Root Cause | Impact | Priority |
|-------|-----------|--------|----------|
| **Network invisible** | Color/width similar to basemap | Users cannot see background grid | P1 |
| **Routes in NJ** | Random start from 144k segments (no bbox filter) | Demo looks unrealistic | P0 |
| **No UI toggle** | Not implemented | Cannot control visibility | P2 |
| **Overpass bbox too wide** | Eastern boundary at -75.00 includes NJ | Network includes wrong geography | P0 |
| **No minzoom** | Renders at all zoom levels | Lines too thin at low zoom | P2 |

---

## G. Recommended Implementation Plan

### Packet 1: Fix Route Geography (P0 — Critical)

**Owner:** Codex (Agent-I)

**Tasks:**
1. Update Overpass bbox eastern boundary from -75.00 to -75.135
2. Add PHILLY_BBOX filter in generate_demo_data.mjs
3. Filter segments to Philadelphia-only before building adjacency graph
4. Regenerate routes and verify all are west of Delaware River

**Files to Modify:**
- `scripts/fetch_streets_phl.mjs:14-16` — Narrow Overpass query bbox
- `scripts/segment_streets_phl.mjs:14` — Update STUDY_BBOX
- `scripts/generate_demo_data.mjs:204-216` — Add bbox filter before adjacency graph
- `scripts/generate_demo_data.mjs:225-280` — Add bbox constraint to walkRoute()

**Acceptance Criteria:**
- [ ] All routes start longitude >= -75.135 (west of Delaware River)
- [ ] Route bbox fully within Philadelphia
- [ ] `npm run data:check` passes
- [ ] Routes still 1.8-4.5 km length

### Packet 2: Make Network Visible (P1 — High)

**Owner:** Agent-M (small hotfix) or Codex

**Tasks:**
1. Increase line color contrast (darker gray)
2. Increase opacity from 0.4 to 0.6
3. Add minzoom: 11
4. Increase line width by 15-20%

**File to Modify:**
- `src/map/network_layer.js:50-70` — Update paint properties

**Hotfix Ready:** These are 4-5 line changes, safe for Agent-M to apply now.

### Packet 3: Add Realistic Route Scenarios (P1 — High)

**Owner:** Codex

**Tasks:**
1. Replace ROUTE_NAMES with ROUTE_SCENARIOS array (5 entries from Section D)
2. Implement findNearestSegment() anchor function
3. Modify walkRoute() to accept startKey parameter
4. Update route generation loop to use anchors + target lengths

**File to Modify:**
- `scripts/generate_demo_data.mjs:193-280` — Replace random walks with anchored routes

**Acceptance Criteria:**
- [ ] 5 routes match target scenarios (Station→Clark Park, etc.)
- [ ] Routes start/end near specified landmarks
- [ ] Route names include descriptive labels ("University City Commute")
- [ ] Lengths match targets (±300m tolerance)

### Packet 4: Add UI Toggle (P2 — Medium)

**Owner:** Codex

**Tasks:**
1. Add setNetworkLayerVisibility() function to network_layer.js
2. Add checkbox HTML to Diary panel controls
3. Wire event listener to toggle function
4. Persist state in sessionStorage (optional)

**Files to Modify:**
- `src/map/network_layer.js` — Add visibility toggle function
- `src/routes_diary/index.js` — Add panel control HTML + event listener

**Acceptance Criteria:**
- [ ] Checkbox appears in Diary panel (below route picker)
- [ ] Checking/unchecking toggles network layer visibility
- [ ] Default state: checked (network visible)
- [ ] State persists during session (optional)

---

## H. Proposed Small Hotfix (Agent-M)

**Scope:** Make network layer visible without breaking anything.

**File:** `src/map/network_layer.js`

**Changes (lines 50-62):**
```javascript
paint: {
  'line-color': '#94a3b8',    // Change from #cbd5e1 (lighter) to #94a3b8 (darker slate-400)
  'line-opacity': 0.6,        // Change from 0.4 to 0.6
  'line-width': [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    ['case',
      ['==', ['get', 'class'], 1], 4.0,   // Was 3.4
      ['==', ['get', 'class'], 2], 3.2,   // Was 2.8
      ['==', ['get', 'class'], 3], 2.4,   // Was 2.0
      1.8],                               // Was 1.5
    14,
    ['case',
      ['==', ['get', 'class'], 1], 5.0,   // Was 4.2
      ['==', ['get', 'class'], 2], 4.0,   // Was 3.4
      ['==', ['get', 'class'], 3], 2.8,   // Was 2.4
      2.0],                               // Was 1.6
  ],
},
```

**Add minzoom (line 49):**
```javascript
layout: {
  'line-cap': 'round',
  'line-join': 'round',
  'minzoom': 11,   // NEW: only show at neighborhood zoom or closer
}
```

**Risk Assessment:** Low risk
- Only changes style properties (no logic changes)
- Color/opacity/width adjustments are reversible
- Minzoom prevents clutter at low zoom
- No impact on Crime mode (Diary-only layer)

**Expected Result:** Network layer becomes clearly visible as subtle gray grid beneath demo segments.

---

## I. Verification Steps (After Fixes)

### After Route Fix:
```bash
npm run data:gen
node scripts/inspect_roadnet.mjs data/routes_phl.demo.geojson
# Verify bbox shows longitude >= -75.135
```

### After Network Visibility Fix:
1. Start app in Diary mode: `npm run dev` → http://localhost:3000/?mode=diary
2. Zoom to Philadelphia (zoom 12-14)
3. Verify gray network grid is clearly visible
4. Check developer console: `map.getStyle().layers.find(l => l.id === 'diary-network-line')`

### After Route Scenarios:
```bash
npm run data:gen
cat data/routes_phl.demo.geojson | grep '"name"'
# Should see: "University City Commute", "Station to Rittenhouse", etc.
```

---

**Audit Complete**
**Agent:** Agent-M
**Next:** Apply network visibility hotfix, then document route fix for Codex
**Timestamp:** 2025-11-18T03:00:00Z
