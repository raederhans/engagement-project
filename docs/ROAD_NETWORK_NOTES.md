# Road Network Notes — Philadelphia Street Centerlines (prep)

## Dataset
- Source: OSM via Overpass API (default) or OpenDataPhilly Street Centerlines via `STREETS_PHL_URL`.
- Default endpoint (Overpass POST): `https://overpass-api.de/api/interpreter` with query `[out:json];way["highway"](39.90,-75.30,40.05,-75.00);out geom;`
- CRS: WGS84 (EPSG:4326) lon/lat.
- Fields of interest: `name`, `highway` (used to derive functional class), plus geometry.
- Env/config: `STREETS_PHL_URL` can point to a direct GeoJSON/ArcGIS endpoint; otherwise the Overpass query is used. If fetch fails, a small Center City fallback sample (10 features) is written.

## Pipeline (current)
1. `scripts/fetch_streets_phl.mjs` — fetches OSM highways (default Overpass query) to `data/streets_phl.raw.geojson` (fallback: baked sample).
2. `scripts/segment_streets_phl.mjs` — clips to bbox [-75.28, 39.90, -75.00, 40.05], splits lines into ~150 m chunks, assigns `segment_id`, `class` (1–4 via highway mapping), `street_name`, `length_m`, writes `data/segments_phl.network.geojson` (≈144k segments for full bbox).
3. `scripts/generate_demo_data.mjs` — consumes `segments_phl.network.geojson` when present; builds demo artifacts with real geometry and longer, connected routes.

## Notes
- Network layer display throttles to ~15k features for performance; full file kept for routing/demo data.
- Class mapping: `motorway/trunk` → 1, `primary/secondary` → 2, `tertiary` → 3, others → 4. Numeric FUNC_CLASS/CLASS honored when present.
- Demo routes now follow connected network walks targeting ~2–4 km length; alt routes picked from separate walks.

## Current Issues (2025-11-18 Audit)

### Issue 1: Routes Appearing in New Jersey
**Problem:** All 5 demo routes currently render in New Jersey (Palmyra, Camden, Cherry Hill) instead of Philadelphia.

**Root Cause:**
- Overpass bbox eastern boundary extends to -75.00 longitude (includes NJ)
- `walkRoute()` picks random start from entire 144k segment network
- No geographic constraints → routes can start/traverse anywhere in region

**Evidence:**
- Routes bbox: [-75.0307, 39.9947] to [-74.9990, 40.0089]
- Philadelphia City Hall: -75.16 longitude
- Delaware River: ~-75.13 longitude
- **Conclusion:** Routes are 0.13-0.16° east of Philadelphia (across river)

**Fix Required:**
1. Narrow Overpass bbox from -75.00 to -75.135 (exclude NJ)
2. Add PHILLY_BBOX filter in generate_demo_data.mjs
3. Constrain walkRoute() to only traverse Philadelphia segments

### Issue 2: Background Network Invisible
**Problem:** Users report not seeing gray network grid despite layer rendering.

**Root Cause:**
- Line color #cbd5e1 too similar to basemap roads
- Opacity 0.4 too subtle
- Line widths similar to basemap
- No minzoom → too thin at low zoom

**Fix Applied (2025-11-18):**
- Darkened color to #94a3b8 (slate-400)
- Increased opacity to 0.6
- Increased line widths by 15-20%
- Added minzoom: 11

**Status:** Small hotfix applied by Agent-M in src/map/network_layer.js

### Issue 3: No UI Toggle
**Status:** Not yet implemented. Requires Codex packet (see Implementation Plan below).

---

## Target Demo Route Scenarios (Philadelphia-Only)

### Geographic Constraints for All Routes
- **Primary Bbox:** `[-75.28, 39.90, -75.135, 40.05]` (west of Delaware River)
- **Rationale:** Exclude New Jersey (east of -75.13), focus on Philadelphia proper
- **Coverage:** University City, Center City, Rittenhouse, South Philly, Old City

### Route A: University City Commute
- **From:** 30th Street Station (30th & Market St)
- **To:** Clark Park (43rd & Chester Ave, West Philly)
- **Distance:** ~2.0 km (1.2 miles)
- **Mode:** Walk or bike
- **Corridor:** Market St west to 36th, then Spruce or Baltimore Ave to 43rd
- **Start Anchor:** `[-75.1815, 39.9559]` (30th St Station entrance)
- **End Anchor:** `[-75.2075, 39.9485]` (Clark Park)
- **Target Length:** 1,800-2,400m

### Route B: Station to Rittenhouse
- **From:** 30th Street Station
- **To:** Rittenhouse Square (18th & Walnut)
- **Distance:** ~2.2 km (1.4 miles)
- **Mode:** Walk
- **Corridor:** Market St Bridge across Schuylkill, then Walnut/Chestnut to Rittenhouse
- **Start Anchor:** `[-75.1815, 39.9559]` (30th St Station)
- **End Anchor:** `[-75.1720, 39.9495]` (Rittenhouse Square)
- **Target Length:** 2,000-2,600m

### Route C: Campus to Italian Market
- **From:** Penn Campus Core (Locust Walk, 36th-38th St)
- **To:** Italian Market (9th & Christian, South Philly)
- **Distance:** ~4.5 km (2.8 miles)
- **Mode:** Bike
- **Corridor:** Pine or Spruce St east (protected bike lanes), then south on 9th/10th
- **Start Anchor:** `[-75.1950, 39.9525]` (Penn Locust Walk)
- **End Anchor:** `[-75.1585, 39.9390]` (9th & Christian)
- **Target Length:** 4,000-5,000m

### Route D: City Hall to Penn Campus
- **From:** Philadelphia City Hall (Broad & Market)
- **To:** Penn Campus Gateway (34th & Walnut)
- **Distance:** ~2.5 km (1.6 miles)
- **Mode:** Walk or bike
- **Corridor:** Market St or JFK Blvd west to 34th, into campus
- **Start Anchor:** `[-75.1635, 39.9524]` (City Hall)
- **End Anchor:** `[-75.1925, 39.9540]` (34th & Walnut)
- **Target Length:** 2,200-3,000m

### Route E: Rittenhouse to East Passyunk
- **From:** Rittenhouse Square
- **To:** East Passyunk Avenue (Passyunk & Tasker, South Philly)
- **Distance:** ~3.2 km (2.0 miles)
- **Mode:** Bike
- **Corridor:** Broad St south, then diagonal on East Passyunk Ave
- **Start Anchor:** `[-75.1720, 39.9495]` (Rittenhouse Square)
- **End Anchor:** `[-75.1640, 39.9265]` (Passyunk & Tasker)
- **Target Length:** 2,800-3,800m

---

## Implementation Plan — Realistic Road Network (M3+)

**Goal:** Transform the road network from a 4-block sample to a realistic citywide street grid with proper functional class hierarchy, background network layer, and plausible demo routes.

**Status Update (2025-11-18):**
- ✅ **Network Data:** Successfully fetched 109k raw streets, 144k network segments (Overpass OSM)
- ✅ **Background Layer:** Implemented but initially invisible (fixed with style adjustments)
- ❌ **Routes Location:** All 5 demo routes appearing in New Jersey instead of Philadelphia
- ❌ **Route Anchoring:** Routes use random starts instead of realistic landmarks

See audit logs:
- Initial diagnosis: `logs/ROADNET_AUDIT_M3_20251118T015821.md`
- Visibility & location audit: `logs/ROADNET_M3_VISIBILITY_AND_ROUTES_20251118T030000.md`

---

### Packet A: Fix Route Geography (P0 — Critical)

**Objective:** Constrain demo routes to Philadelphia proper (currently all 5 routes are in New Jersey).

**Current Problem:**
- Routes bbox: [-75.03, 39.99] to [-74.99, 40.01] (Palmyra/Camden, NJ)
- Overpass bbox extends to -75.00 longitude (includes NJ)
- `walkRoute()` picks random start from entire 144k segment network
- No geographic constraints

#### A.1 — Narrow Overpass Bbox to Exclude New Jersey

**File:** [scripts/fetch_streets_phl.mjs:14-16](../scripts/fetch_streets_phl.mjs#L14-L16)

**Current:**
```javascript
const DEFAULT_OVERPASS_URL =
  'https://overpass-api.de/api/interpreter?data=[out:json];way["highway"](39.90,-75.30,40.05,-75.00);out geom;';
```

**Change:**
```javascript
const DEFAULT_OVERPASS_URL =
  'https://overpass-api.de/api/interpreter?data=[out:json];way["highway"](39.90,-75.30,40.05,-75.135);out geom;';
  // Changed east boundary from -75.00 to -75.135 (west of Delaware River)
```

**Rationale:** Delaware River is at approximately -75.13 longitude. Eastern boundary of -75.135 keeps data within Philadelphia.

#### A.2 — Update Segmentation Bbox

**File:** [scripts/segment_streets_phl.mjs:14](../scripts/segment_streets_phl.mjs#L14)

**Current:** `const STUDY_BBOX = [-75.28, 39.90, -75.00, 40.05];`

**Change:**
```javascript
const STUDY_BBOX = [-75.28, 39.90, -75.135, 40.05];  // Exclude NJ
```

#### A.3 — Add Philadelphia Bbox Filter in Route Generator

**File:** [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs)

**Add before adjacency graph construction (line 204):**
```javascript
// Philadelphia-only bbox (west of Delaware River)
const PHILLY_BBOX = [-75.28, 39.90, -75.135, 40.05];

function isInPhilly(segment) {
  const coords = segment.geometry?.coordinates || [];
  if (!coords.length) return false;
  const [lng, lat] = coords[0];
  return lng >= PHILLY_BBOX[0] && lng <= PHILLY_BBOX[2]
      && lat >= PHILLY_BBOX[1] && lat <= PHILLY_BBOX[3];
}

// Filter segments to Philadelphia only
const phillySegments = segments.filter(isInPhilly);
console.info(`[Diary] Filtered to ${phillySegments.length} Philadelphia segments (of ${segments.length} total)`);

// Use phillySegments for adjacency graph and route generation
const adjacency = new Map();
phillySegments.forEach((seg) => {
  // ... existing adjacency building code
});
```

#### A.4 — Update walkRoute to Stay Within Bbox

**File:** [scripts/generate_demo_data.mjs:225-249](../scripts/generate_demo_data.mjs#L225-L249)

**Modify walkRoute to check bbox before adding segments:**
```javascript
function walkRoute({ minLen = 1800, maxLen = 3600, maxSegments = 80 } = {}) {
  const keys = Array.from(adjacency.keys());
  if (!keys.length) return [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const startKey = keys[Math.floor(rand() * keys.length)];
    let currentKey = startKey;
    const path = [];
    const visited = new Set();
    let total = 0;
    for (let i = 0; i < maxSegments; i += 1) {
      const neighbors = adjacency.get(currentKey) || [];
      const unvisited = neighbors.filter((seg) => {
        // ADDED: Bbox check
        if (!isInPhilly(seg)) return false;
        return !visited.has(seg.id);
      });
      const pool = unvisited.length ? unvisited : neighbors.filter(isInPhilly);
      if (!pool.length) break;
      const nextSeg = pool[Math.floor(rand() * pool.length)];
      // ... rest unchanged
    }
  }
}
```

**Acceptance Criteria (Packet A):**
- [ ] Overpass bbox eastern boundary changed to -75.135
- [ ] Segmentation bbox updated to match
- [ ] PHILLY_BBOX filter added to generate_demo_data.mjs
- [ ] Routes regenerated with `npm run data:gen`
- [ ] All routes have longitude >= -75.135 (verified with inspect script)
- [ ] Routes bbox entirely within Philadelphia
- [ ] `npm run data:check` passes

---

### Packet B: Background Network Layer Visibility (P1 — Completed with Hotfix)

**Status:** ✅ Layer implemented by Codex, visibility fixed by Agent-M (2025-11-18)

**Original Objective:** Render full `segments_phl.network.geojson` as subtle gray background layer beneath colored safety ratings, showing functional class hierarchy.

**Issue Found:** Layer rendered but was invisible due to color/opacity too similar to basemap.

**Hotfix Applied (src/map/network_layer.js:49-74):**
- Darkened color from #cbd5e1 to #94a3b8 (slate-400)
- Increased opacity from 0.4 to 0.6
- Increased line widths by 15-20%
- Added minzoom: 11 to prevent clutter at low zoom

**Result:** Network layer now clearly visible as gray grid beneath demo segments.

#### B.1 — Create Network Layer Module

**File to Create:** `src/map/network_layer.js`

**Functionality:**
```javascript
// Export functions:
// - loadNetworkSegments() → fetch segments_phl.network.geojson
// - mountNetworkLayer(map) → add source + layers to MapLibre
// - setNetworkVisibility(map, visible) → toggle layer on/off

export async function loadNetworkSegments() {
  const candidates = [
    '/data/segments_phl.network.geojson',
    new URL('../../data/segments_phl.network.geojson', import.meta.url).href,
  ];

  for (const url of candidates) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const geojson = await resp.json();
      return geojson; // FeatureCollection
    } catch (err) {
      console.warn(`[Network] Failed to load ${url}:`, err.message);
    }
  }

  console.warn('[Network] No network segments found, background layer disabled');
  return null;
}

export function mountNetworkLayer(map, geojson) {
  if (!geojson || !geojson.features) return;

  map.addSource('road-network', {
    type: 'geojson',
    data: geojson,
  });

  // Background layer: class-based width, subtle gray
  map.addLayer({
    id: 'road-network-bg',
    type: 'line',
    source: 'road-network',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#cbd5e1', // gray-300
      'line-width': [
        'match',
        ['get', 'class'],
        1, 4.5, // Major arterials (highways)
        2, 3.5, // Arterials
        3, 2.5, // Collectors
        4, 1.5, // Local streets
        2.0,    // Default
      ],
      'line-opacity': 0.35, // Subtle background
    },
  }, 'diary-segments-hit'); // Insert below demo segments layer
}

export function setNetworkVisibility(map, visible) {
  if (map.getLayer('road-network-bg')) {
    map.setLayoutProperty('road-network-bg', 'visibility', visible ? 'visible' : 'none');
  }
}
```

**Integration:** Call from `src/routes_diary/index.js` during map initialization (after basemap loads, before demo segments).

#### B.2 — Adjust Demo Segment Styling

**File:** [src/map/segments_layer.js:27-46](../src/map/segments_layer.js#L27-L46)

**Changes:**
1. Increase line width slightly to stand out from background network
2. Add subtle outline/halo for contrast
3. Ensure demo segments layer renders above network layer (already correct if network layer inserted below)

**Example:**
```javascript
// In mountSegmentsLayer(), update paint properties:
paint: {
  'line-color': [...safetyColorExpression...],
  'line-width': ['+',
    ['call', 'widthForNEff', ['get', 'n_eff']],
    ['call', 'classWidth', ['get', 'class']],
    1.5, // ← Increase from -1.5 to +1.5 for more prominence
  ],
  'line-opacity': 0.85, // Slightly transparent to show network beneath
}

// Optional: Add halo layer for contrast
map.addLayer({
  id: 'diary-segments-halo',
  type: 'line',
  source: 'diary-segments',
  paint: {
    'line-color': '#ffffff',
    'line-width': [...sameWidthExpression...],
    'line-opacity': 0.5,
    'line-blur': 2,
  },
}, 'diary-segments-line');
```

#### B.3 — Load Network in Diary Route

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js)

**Changes:**
```javascript
// Near lines 23-30 (after SEGMENT_URL_CANDIDATES)
import { loadNetworkSegments, mountNetworkLayer, setNetworkVisibility } from '../map/network_layer.js';

// In initDiary() or map load callback:
async function setupNetworkLayer(map) {
  const networkData = await loadNetworkSegments();
  if (networkData) {
    mountNetworkLayer(map, networkData);
    console.info(`[Diary] Mounted road network layer: ${networkData.features.length} segments`);
  }
}

// Call after map loads, before demo segments:
map.on('load', async () => {
  await setupNetworkLayer(map);
  await loadDemoSegments(); // Existing demo segment load
  // ... rest of setup
});
```

**Acceptance Criteria (Packet B):**
- [ ] New `src/map/network_layer.js` module created
- [ ] Full `segments_phl.network.geojson` loaded and rendered
- [ ] Background layer shows subtle gray streets with class-based width differences
- [ ] Demo segments (colored ratings) render above background network
- [ ] Class hierarchy visually apparent: class 1 (wide) → class 4 (narrow)
- [ ] No performance degradation (1,000-5,000 segments should render smoothly)

---

### Packet C: UI Toggle & Route Generation (P2 — Medium)

**Objective:** Add "Show road network" toggle to Diary panel, improve route generation to use realistic start/end pairs across neighborhoods.

#### C.1 — Add Road Network Toggle

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js) (panel controls section)

**Functionality:**
```javascript
// In buildControlsHTML() or similar:
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

// In panel mount logic, add event listener:
document.getElementById('diary-network-toggle')?.addEventListener('change', (e) => {
  const visible = e.target.checked;
  setNetworkVisibility(mapInstance, visible);
  console.log(`[Diary] Road network layer: ${visible ? 'visible' : 'hidden'}`);
});
```

**Styling:** Match existing Diary panel control styles (align with playback speed, demo period controls per `DIARY_UI_FIX_PLAN_M3.md`).

**Default:** Checked (network visible by default for context).

#### C.2 — Improve Route Generation

**File:** [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs)

**Current Issue:** Routes pick random start/end segments from same 4-block area → looks unrealistic.

**Improvements:**

1. **Realistic Start/End Pairs:**
   ```javascript
   // Define plausible trip endpoints (after full city network loaded)
   const TRIP_PAIRS = [
     { from: 'University City', to: 'Center City', distance: '3km' },
     { from: 'South Philly', to: 'Old City', distance: '5km' },
     { from: 'North Philly', to: 'Temple University', distance: '2km' },
     { from: 'Fishtown', to: 'City Hall', distance: '4km' },
     { from: 'West Philly', to: 'Penn', distance: '2.5km' },
   ];

   // For each trip, find segments near labeled areas (use bbox or landmark matching)
   function findSegmentsNear(segments, areaName) {
     const AREA_BBOXES = {
       'University City': [-75.20, 39.94, -75.19, 39.96],
       'Center City': [-75.17, 39.95, -75.16, 39.96],
       // ... etc
     };
     const bbox = AREA_BBOXES[areaName];
     return segments.filter(seg => {
       const [lng, lat] = seg.geometry.coordinates[0];
       return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
     });
   }
   ```

2. **Graph Traversal for Plausible Paths:**
   ```javascript
   // Build adjacency graph from segments (segment endpoints → connected segments)
   function buildGraph(segments) {
     const graph = new Map(); // endpoint_key → [segment_ids]
     segments.forEach(seg => {
       const start = coordKey(seg.geometry.coordinates[0]);
       const end = coordKey(seg.geometry.coordinates[seg.geometry.coordinates.length - 1]);
       if (!graph.has(start)) graph.set(start, []);
       if (!graph.has(end)) graph.set(end, []);
       graph.get(start).push(seg.properties.segment_id);
       graph.get(end).push(seg.properties.segment_id);
     });
     return graph;
   }

   // Use Dijkstra or A* to find shortest path between start/end segments
   function findRoute(graph, segments, startSegId, endSegId, targetLength) {
     // ... implement pathfinding (use turf.distance for heuristic)
     // Return array of segment_ids forming connected path
   }
   ```

3. **Fallback:** If pathfinding is complex, use simpler heuristic:
   - Pick start segment in area A
   - Walk graph greedily toward area B (direction heuristic)
   - Stop when within target length (1.5-5km)

**Test:** Verify generated routes in `data/routes_phl.demo.geojson`:
- Start/end points are in different neighborhoods (>2km apart)
- Paths follow connected segments (no gaps)
- Route lengths are realistic (1.5-5km, not 1km in same 4 blocks)

**Acceptance Criteria (Packet C):**
- [ ] "Show road network" toggle added to Diary panel
- [ ] Toggle controls `road-network-bg` layer visibility
- [ ] Routes span realistic trip pairs across neighborhoods (2-5km)
- [ ] Routes follow connected segment graph (no disconnected jumps)
- [ ] Demo routes look like plausible cycling/walking trips
- [ ] UI controls styled consistently with existing Diary panel

---

### Resources & References

**Data Sources:**
- OpenDataPhilly: https://opendataphilly.org (search "Street Centerlines")
- OSM Overpass API: https://overpass-api.de (query for highways in Philadelphia bbox)
- Geofabrik OSM extracts: https://download.geofabrik.de/north-america/us.html

**Turf.js Functions (already in dependencies):**
- `turf.lineChunk()` — segment splitting (already used)
- `turf.distance()` — great-circle distance for pathfinding heuristic
- `turf.length()` — total route length
- `turf.booleanPointInPolygon()` — area-based segment filtering

**Graph Pathfinding Libraries (optional):**
- `graphology` + `graphology-shortest-path` (lightweight, good for Dijkstra)
- `ngraph.path` (A* implementation)
- DIY: Simple Dijkstra in ~50 lines for connected segment graph

**Testing Tools:**
- `scripts/inspect_roadnet.mjs` — diagnostic tool (already created)
- `npm run data:check` — validation script (already exists)

---

### Estimated Effort

- **Packet A (Data Source):** 2-3 hours (finding URL, testing, expanding bbox, docs)
- **Packet B (Network Layer):** 3-4 hours (new module, styling, integration, testing)
- **Packet C (UI + Routes):** 3-5 hours (toggle UI, route logic, pathfinding or heuristic, testing)

**Total:** 8-12 hours across 3-4 work sessions

**Dependencies:**
- Packet B depends on Packet A (need full network data to render)
- Packet C.2 (routes) depends on Packet A (need citywide network for realistic trips)
- Packet C.1 (toggle) can be done independently once Packet B is complete

---

### Acceptance Criteria (Overall)

When implementation is complete, the Diary demo should show:

- [x] **Pipeline Working:** Scripts fetch real data or expanded sample (not 10-street fallback)
- [ ] **Geographic Scope:** Multi-neighborhood coverage (5+ km², not 4 blocks)
- [ ] **Background Grid:** Light gray street network visible beneath safety ratings
- [ ] **Class Hierarchy:** Visibly wider lines for major roads (class 1) vs local streets (class 4)
- [ ] **Plausible Routes:** Demo routes span realistic trips (2-5km, different neighborhoods)
- [ ] **UI Control:** "Show road network" toggle in Diary panel
- [ ] **Data Quality:** Real or realistic street data, not synthetic fallback
- [ ] **Validation:** `npm run data:check` passes with larger dataset
- [ ] **Performance:** No lag when rendering 1,000-5,000 network segments
- [ ] **Documentation:** `.env.example` and `DATA_SETUP.md` guide setup

---

**Next Steps:** Implement Packet A first (critical path), then B, then C. See audit log for detailed diagnosis: `logs/ROADNET_AUDIT_M3_20251118T015821.md`
