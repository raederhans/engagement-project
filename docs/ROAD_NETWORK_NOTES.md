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

---

## Implementation Plan — Realistic Road Network (M3+)

**Goal:** Transform the road network from a 4-block sample to a realistic citywide street grid with proper functional class hierarchy, background network layer, and plausible demo routes.

**Current Issues (from audit 2025-11-18):**
1. **Tiny Coverage:** Only 10 hardcoded streets covering ~4 city blocks (using fallback sample)
2. **No Background Layer:** Only 64 rated demo segments shown, no contextual street grid
3. **No Realistic Routes:** Routes are 1-1.5km but confined to same 4 blocks
4. **Root Cause:** `STREETS_PHL_URL` environment variable not set → always uses fallback

See full diagnosis: `logs/ROADNET_AUDIT_M3_20251118T015821.md`

---

### Packet A: Data Source & Ingestion (P0 — Critical)

**Objective:** Replace 10-street fallback sample with real OpenDataPhilly street centerlines covering entire Philadelphia or multi-neighborhood area (5-10 km²).

#### A.1 — Find Working Data Source

**Task:** Locate current OpenDataPhilly Streets dataset URL

**Options:**
1. **OpenDataPhilly Portal:** Search for "Street Centerlines" at https://opendataphilly.org
2. **ArcGIS REST API:** City of Philadelphia Streets Department endpoint
3. **Static Download:** Pre-exported GeoJSON from recent data dump
4. **Fallback:** Use OSM extract for Philadelphia (Overpass API or Geofabrik)

**Expected Fields:**
- `SEG_ID` or unique identifier
- `STNAME` / `name` (street name)
- `FUNC_CLASS` / `CLASS` (functional classification: 1-4)
- `Shape_Length` or geometry length
- `geometry` (LineString coordinates in EPSG:4326)

**Deliverable:** Working URL or static file path for full city streets (50,000-100,000 segments expected)

#### A.2 — Update fetch_streets_phl.mjs

**File:** [scripts/fetch_streets_phl.mjs](../scripts/fetch_streets_phl.mjs)

**Changes:**
1. Update `STREETS_PHL_URL` default value with working endpoint (lines 12-14)
2. If using static file, update logic to copy from `data/raw/` instead of fetch
3. Update field mapping if source schema differs (lines 72-78 likely)
4. Verify output is valid GeoJSON with expected properties

**Test:** Run `node -e "import('./scripts/fetch_streets_phl.mjs').then(m => m.fetchStreetsPhl())"` and verify `data/streets_phl.raw.geojson` contains 50k+ features (not 10).

#### A.3 — Expand Study Area Bbox

**File:** [scripts/segment_streets_phl.mjs:12](../scripts/segment_streets_phl.mjs#L12)

**Current:** `const STUDY_BBOX = [-75.25, 39.90, -75.13, 39.97];` (Center City only)

**Change:** Expand to multi-neighborhood coverage:
```javascript
// Option 1: Entire Philadelphia
const STUDY_BBOX = [-75.28, 39.87, -75.00, 40.14]; // ~100 km²

// Option 2: Center + adjacent neighborhoods (recommended for demo)
const STUDY_BBOX = [-75.22, 39.92, -75.14, 39.98]; // ~5-10 km²
```

**Rationale:** Larger bbox provides:
- Realistic route start/end pairs across neighborhoods
- Visible functional class hierarchy (highways, arterials, local streets)
- Better demo context (not confined to tiny cluster)

**Test:** After regeneration, verify `data/segments_phl.network.geojson` has 1,000-5,000 segments (not 185).

#### A.4 — Create Setup Documentation

**Files to Create/Update:**
1. **`.env.example`** (create if missing):
   ```bash
   # Feature flags
   VITE_FEATURE_DIARY=1

   # Road network data source (optional override)
   # If not set, uses fallback 10-street sample
   STREETS_PHL_URL=https://example.com/path/to/streets.geojson
   ```

2. **`docs/DATA_SETUP.md`** (create):
   - Document where to find OpenDataPhilly dataset
   - Instructions for setting `STREETS_PHL_URL`
   - Alternative: downloading static file to `data/raw/`
   - Expected data regeneration workflow

**Acceptance Criteria (Packet A):**
- [ ] Real OpenDataPhilly streets loaded (50k+ features) OR expanded study area with OSM data
- [ ] `data/streets_phl.raw.geojson` contains realistic citywide coverage
- [ ] `data/segments_phl.network.geojson` has 1,000+ segments across multiple neighborhoods
- [ ] Study bbox expanded from 4 blocks to 5+ km²
- [ ] Setup documentation created (`.env.example`, `DATA_SETUP.md`)
- [ ] `npm run data:check` passes with new dataset

---

### Packet B: Background Network Layer (P1 — High)

**Objective:** Render full `segments_phl.network.geojson` as subtle gray background layer beneath colored safety ratings, showing functional class hierarchy.

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
