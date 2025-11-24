# Route Boundary Integration Design — Districts & Census Tracts

**Date:** 2025-11-18T05:00:00Z
**Author:** Agent-M (Manager / Architect Mode)
**Context:** Part C of Map & Network Layer Audit
**Status:** Design / Documentation (Implementation for Codex)

---

## Executive Summary

**Goal:**
Enhance the Diary mode route visualization by showing which **police districts** and **census tracts** each route traverses. This provides geographic context for safety ratings and crime statistics aggregation.

**Design Approach:**
1. **Spatial Join:** Use Turf.js `lineIntersect()` and `booleanIntersects()` to determine which district/tract polygons each route crosses
2. **Data Flow:** Compute boundary intersections during route generation OR on-demand when user views route details
3. **UI Display:** Add "Geographic Context" subsection to Insights panel showing crossed districts/tracts with crime stats
4. **Visual Layer:** Optional map overlay showing district/tract boundaries as translucent polygons (user-toggleable)

**Key Benefits:**
- Contextualize route safety ratings with neighborhood crime statistics
- Enable filtering/comparison by district ("Show me all routes in District 19")
- Support future crime heatmap integration (district-level aggregation)

---

## Part 1: Data Inventory

### 1.1 Police Districts

**File:** [public/data/police_districts.geojson](../public/data/police_districts.geojson)

**Properties:**
- **Feature Count:** 21 districts (covers all of Philadelphia)
- **Geometry Type:** Polygon (MultiPolygon for some)
- **Key Properties:**
  - `DIST_NUMC`: District number as string (e.g., "24", "19", "6")
  - `OBJECTID`: Unique identifier
  - `SHAPE.STArea()`: Polygon area (sq meters)
  - `SHAPE.STLength()`: Perimeter length (meters)

**Sample Feature:**
```json
{
  "type": "Feature",
  "properties": {
    "OBJECTID": 1,
    "DIST_NUMC": "24",
    "SHAPE.STArea()": 153419302.53520885,
    "SHAPE.STLength()": 59483.09010267767
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-75.123, 39.987], ...]]
  }
}
```

**Data Source:** Philadelphia Police Department GIS (PhillyPoliceGIS)
**Update Frequency:** Infrequent (district boundaries rarely change)

### 1.2 Census Tracts

**File:** [public/data/tracts_phl.geojson](../public/data/tracts_phl.geojson)

**Properties:**
- **Feature Count:** 408 tracts (Philadelphia County)
- **Geometry Type:** Polygon (MultiPolygon for some)
- **Key Properties:**
  - `GEOID`: Full census tract identifier (e.g., "42101030100" = PA, Philadelphia County, Tract 301)
  - `NAME`: Short tract name (e.g., "301")
  - `TRACT`: 6-digit tract code (e.g., "030100")
  - `STATE`: "42" (Pennsylvania)
  - `COUNTY`: "101" (Philadelphia County)
  - `ALAND`: Land area (sq meters)
  - `AWATER`: Water area (sq meters)

**Sample Feature:**
```json
{
  "type": "Feature",
  "properties": {
    "GEOID": "42101030100",
    "STATE": "42",
    "COUNTY": "101",
    "TRACT": "030100",
    "NAME": "301",
    "ALAND": 725114,
    "AWATER": 0
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-75.134, 39.956], ...]]
  }
}
```

**Data Source:** U.S. Census Bureau (2020 census boundaries)
**Update Frequency:** Every 10 years (2020, 2030, etc.)

### 1.3 Route Data (Reference)

**File:** [public/data/routes_phl.demo.geojson](../public/data/routes_phl.demo.geojson)

**Properties:**
- **Feature Count:** 5 demo routes (more in production)
- **Geometry Type:** LineString
- **Key Properties:**
  - `route_id`: Unique identifier (e.g., "route_001")
  - `name`: Human-readable name (e.g., "30th St to Clark Park")
  - `from`, `to`: Anchor point names
  - `length_m`: Route length in meters
  - `segment_ids`: Array of network segment IDs (for safety rating lookup)

**Current Missing Property:**
- `districts`: Array of district numbers crossed (TO BE ADDED)
- `tracts`: Array of tract GEOIDs crossed (TO BE ADDED)

---

## Part 2: Spatial Join Algorithm Design

### 2.1 Overview

**Algorithm:** Turf.js-based intersection detection

**Input:**
- Route: GeoJSON LineString with coordinates
- Boundaries: GeoJSON FeatureCollection of district/tract polygons

**Output:**
- Array of district/tract features that the route intersects

**Method:** `booleanIntersects(line, polygon)` for each boundary feature

### 2.2 Turf.js Implementation Pattern

**Function Signature:**
```javascript
import * as turf from '@turf/turf';

/**
 * Find all police districts that a route intersects.
 * @param {Object} routeLineString - GeoJSON LineString feature
 * @param {Object} districtsCollection - GeoJSON FeatureCollection of district polygons
 * @returns {Array<Object>} Array of intersected district features with properties
 */
function findIntersectedDistricts(routeLineString, districtsCollection) {
  const intersected = [];

  for (const districtFeature of districtsCollection.features) {
    // Check if route line intersects district polygon
    if (turf.booleanIntersects(routeLineString, districtFeature)) {
      intersected.push({
        districtNumber: districtFeature.properties.DIST_NUMC,
        area: districtFeature.properties['SHAPE.STArea()'],
        geometry: districtFeature.geometry, // For optional map overlay
      });
    }
  }

  return intersected;
}
```

**Census Tracts (Similar):**
```javascript
function findIntersectedTracts(routeLineString, tractsCollection) {
  const intersected = [];

  for (const tractFeature of tractsCollection.features) {
    if (turf.booleanIntersects(routeLineString, tractFeature)) {
      intersected.push({
        geoid: tractFeature.properties.GEOID,
        name: tractFeature.properties.NAME,
        landArea: tractFeature.properties.ALAND,
        geometry: tractFeature.geometry,
      });
    }
  }

  return intersected;
}
```

### 2.3 Performance Optimization

**Challenge:** 408 tracts × 5 routes = 2,040 intersection checks (acceptable, but optimize for 100+ routes)

**Optimization Strategy:**
1. **Bounding Box Pre-Filter:**
   - Compute route bbox with `turf.bbox(route)`
   - Skip polygons whose bbox doesn't overlap route bbox
   - Reduces checks by ~70% (most tracts far from route)

```javascript
function findIntersectedTractsOptimized(routeLineString, tractsCollection) {
  const routeBbox = turf.bbox(routeLineString); // [minLng, minLat, maxLng, maxLat]
  const intersected = [];

  for (const tractFeature of tractsCollection.features) {
    const tractBbox = turf.bbox(tractFeature);

    // Quick bbox overlap check (cheap)
    if (!bboxOverlap(routeBbox, tractBbox)) {
      continue; // Skip expensive intersection check
    }

    // Expensive but accurate intersection check
    if (turf.booleanIntersects(routeLineString, tractFeature)) {
      intersected.push({
        geoid: tractFeature.properties.GEOID,
        name: tractFeature.properties.NAME,
        landArea: tractFeature.properties.ALAND,
        geometry: tractFeature.geometry,
      });
    }
  }

  return intersected;
}

function bboxOverlap(bbox1, bbox2) {
  return !(bbox1[2] < bbox2[0] || // route east of tract
           bbox1[0] > bbox2[2] || // route west of tract
           bbox1[3] < bbox2[1] || // route south of tract
           bbox1[1] > bbox2[3]);  // route north of tract
}
```

**Estimated Performance:**
- Unoptimized: ~2-5ms per route (408 full checks)
- Optimized: ~0.5-1ms per route (~120 bbox checks, ~30 intersection checks)

### 2.4 Integration Points

**Option A: Pre-compute During Route Generation (Recommended)**

**File:** [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs)

**Workflow:**
```javascript
// After generating route coordinates with Dijkstra pathfinder:
const routeLineString = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: routeCoords,
  },
};

// Load boundaries
const districts = JSON.parse(readFileSync('public/data/police_districts.geojson', 'utf-8'));
const tracts = JSON.parse(readFileSync('public/data/tracts_phl.geojson', 'utf-8'));

// Compute intersections
const intersectedDistricts = findIntersectedDistricts(routeLineString, districts);
const intersectedTracts = findIntersectedTracts(routeLineString, tracts);

// Add to route properties
route.properties.districts = intersectedDistricts.map(d => d.districtNumber);
route.properties.tracts = intersectedTracts.map(t => t.geoid);
```

**Pros:**
- No runtime computation overhead
- Works offline (boundary data baked into routes.geojson)
- Simpler client-side code

**Cons:**
- Route file size increases (~50 bytes per route for district/tract arrays)
- Must regenerate routes if boundaries update (rare)

**Option B: Compute On-Demand in Browser**

**File:** New module [src/map/boundary_utils.js](../src/map/boundary_utils.js)

**Workflow:**
```javascript
// When user selects a route in Insights panel:
import { findIntersectedDistricts, findIntersectedTracts } from '../map/boundary_utils.js';

async function loadRouteContext(route) {
  const districts = await fetch('/data/police_districts.geojson').then(r => r.json());
  const tracts = await fetch('/data/tracts_phl.geojson').then(r => r.json());

  const routeDistricts = findIntersectedDistricts(route, districts);
  const routeTracts = findIntersectedTracts(route, tracts);

  displayGeographicContext(routeDistricts, routeTracts);
}
```

**Pros:**
- No route regeneration needed
- Works with dynamically loaded boundaries
- Can handle boundary updates without data pipeline

**Cons:**
- Adds 1.8MB to initial page load (police_districts.geojson + tracts_phl.geojson)
- Runtime computation latency (~5-10ms per route)

**Recommendation:** Use Option A (pre-compute) for demo routes. Switch to Option B if:
- Routes are user-generated (not pre-defined)
- Boundary files updated frequently
- Client-side route editing needed

---

## Part 3: UI/UX Design

### 3.1 Insights Panel Integration

**Current Insights Panel Structure (Diary Mode):**
```
┌─────────────────────────────────────┐
│ Route Insights                       │
├─────────────────────────────────────┤
│ Safety Rating: ●●●○○ (3.2/5)        │
│ Distance: 2.4 km                     │
│ Estimated Time: 15 min               │
├─────────────────────────────────────┤
│ Safety Breakdown:                    │
│ ▓▓▓░░░░░░░ Safest (30%)             │
│ ▓▓▓▓░░░░░░ Safer (40%)              │
│ ▓▓░░░░░░░░ Moderate (20%)           │
│ ▓░░░░░░░░░ Less Safe (10%)          │
│ ░░░░░░░░░░ Least Safe (0%)          │
└─────────────────────────────────────┘
```

**Proposed Addition (New Section):**
```
┌─────────────────────────────────────┐
│ Route Insights                       │
├─────────────────────────────────────┤
│ [... existing safety rating ...]     │
├─────────────────────────────────────┤
│ Geographic Context:                  │
│                                      │
│ Police Districts:                    │
│   • District 19 (2.1 km)             │
│   • District 24 (0.3 km)             │
│                                      │
│ Census Tracts:                       │
│   • Tract 301 (University City)      │
│   • Tract 295 (Powelton Village)     │
│   • Tract 287 (Mantua)               │
│                                      │
│ [Toggle Boundaries on Map ☐]        │
└─────────────────────────────────────┘
```

**Design Details:**

1. **Section Header:** "Geographic Context" (collapsible accordion, default expanded)

2. **Police Districts List:**
   - Show district number + distance traveled within that district
   - Sort by distance (longest first)
   - Format: `District {number} ({distance} km)` or `District {number} ({percentage}%)`

3. **Census Tracts List:**
   - Show tract name/number + optional neighborhood name (if available)
   - Sort by order of traversal (first to last)
   - Format: `Tract {name}` or `Tract {name} ({neighborhood})`

4. **Boundary Overlay Toggle:**
   - Checkbox: "Show boundaries on map"
   - When checked: Draw translucent district/tract polygons on map
   - Color: Different hues for districts vs. tracts (e.g., blue for districts, orange for tracts)
   - Opacity: 0.15 fill, 0.6 stroke

### 3.2 Distance Within District Calculation

**Algorithm:** Segment route by district boundaries

```javascript
import * as turf from '@turf/turf';

/**
 * Calculate distance traveled within each intersected district.
 * @param {Object} route - GeoJSON LineString feature
 * @param {Array<Object>} intersectedDistricts - Array from findIntersectedDistricts()
 * @returns {Array<Object>} Districts with distance in meters
 */
function calculateDistanceByDistrict(route, intersectedDistricts) {
  const results = [];

  for (const district of intersectedDistricts) {
    try {
      // Split route line by district polygon boundary
      const intersection = turf.lineIntersect(route, district.geometry);

      if (intersection.features.length === 0) {
        // Route fully within district (no boundary crossings)
        results.push({
          districtNumber: district.districtNumber,
          distanceMeters: turf.length(route, { units: 'meters' }),
        });
      } else {
        // Route crosses district boundary - compute portion inside
        // (Complex: requires line splitting at intersection points)
        // Simplified approach: estimate via point sampling
        const totalLength = turf.length(route, { units: 'meters' });
        const samples = 100; // Sample 100 points along route
        let insideCount = 0;

        for (let i = 0; i <= samples; i++) {
          const point = turf.along(route, (i / samples) * totalLength, { units: 'meters' });
          if (turf.booleanPointInPolygon(point, district.geometry)) {
            insideCount++;
          }
        }

        results.push({
          districtNumber: district.districtNumber,
          distanceMeters: (insideCount / (samples + 1)) * totalLength,
        });
      }
    } catch (err) {
      console.warn(`Failed to calculate distance for district ${district.districtNumber}:`, err);
      results.push({
        districtNumber: district.districtNumber,
        distanceMeters: 0, // Fallback
      });
    }
  }

  return results.sort((a, b) => b.distanceMeters - a.distanceMeters); // Longest first
}
```

**UI Rendering:**
```javascript
function renderGeographicContext(route, districts) {
  const distancesHTML = districts
    .map(d => {
      const km = (d.distanceMeters / 1000).toFixed(1);
      const pct = ((d.distanceMeters / route.properties.length_m) * 100).toFixed(0);
      return `<li>District ${d.districtNumber} (${km} km, ${pct}%)</li>`;
    })
    .join('');

  return `
    <div class="geographic-context">
      <h4>Geographic Context</h4>
      <div>
        <strong>Police Districts:</strong>
        <ul>${distancesHTML}</ul>
      </div>
    </div>
  `;
}
```

### 3.3 Map Overlay Interaction

**Boundary Layer Rendering:**

**File:** New module [src/map/boundary_layer.js](../src/map/boundary_layer.js)

```javascript
const DISTRICT_SOURCE_ID = 'route-districts';
const DISTRICT_LAYER_FILL = 'route-districts-fill';
const DISTRICT_LAYER_LINE = 'route-districts-line';

export function addDistrictOverlay(map, districtFeatures) {
  // Remove existing overlay if present
  removeDistrictOverlay(map);

  // Add source with only intersected districts
  map.addSource(DISTRICT_SOURCE_ID, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: districtFeatures, // Array of district polygon features
    },
  });

  // Add fill layer (translucent blue)
  map.addLayer({
    id: DISTRICT_LAYER_FILL,
    type: 'fill',
    source: DISTRICT_SOURCE_ID,
    paint: {
      'fill-color': '#3b82f6', // Blue-500
      'fill-opacity': 0.15,
    },
  }, 'road_label'); // Insert before labels (per M3_MAP_STYLE_AND_LAYERS.md)

  // Add outline layer (darker blue)
  map.addLayer({
    id: DISTRICT_LAYER_LINE,
    type: 'line',
    source: DISTRICT_SOURCE_ID,
    paint: {
      'line-color': '#1e40af', // Blue-800
      'line-width': 2,
      'line-opacity': 0.6,
    },
  }, 'road_label');
}

export function removeDistrictOverlay(map) {
  if (map.getLayer(DISTRICT_LAYER_FILL)) map.removeLayer(DISTRICT_LAYER_FILL);
  if (map.getLayer(DISTRICT_LAYER_LINE)) map.removeLayer(DISTRICT_LAYER_LINE);
  if (map.getSource(DISTRICT_SOURCE_ID)) map.removeSource(DISTRICT_SOURCE_ID);
}
```

**Census Tracts (Similar):**
- Use different color (e.g., orange: `#f97316` fill, `#c2410c` stroke)
- Separate source/layer IDs: `route-tracts`, `route-tracts-fill`, `route-tracts-line`

**UI Checkbox Handler:**
```javascript
// In routes_diary/index.js or insights panel component
const boundaryToggle = document.getElementById('boundary-overlay-toggle');

boundaryToggle.addEventListener('change', (e) => {
  if (e.target.checked) {
    const districtFeatures = currentRoute.districts.map(d => d.geometry);
    addDistrictOverlay(mapRef, districtFeatures);
  } else {
    removeDistrictOverlay(mapRef);
  }
});
```

---

## Part 4: Data Flow & JSON Schema

### 4.1 Enhanced Route GeoJSON Schema

**Current Route Feature:**
```json
{
  "type": "Feature",
  "properties": {
    "route_id": "route_001",
    "name": "30th St to Clark Park",
    "from": "30th Street Station",
    "to": "Clark Park",
    "length_m": 2400,
    "target_km": 2.5,
    "segment_ids": ["seg_12345", "seg_12346", ...]
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [[-75.1816, 39.9566], ...]
  }
}
```

**Proposed Enhancement (Add `geography` Property):**
```json
{
  "type": "Feature",
  "properties": {
    "route_id": "route_001",
    "name": "30th St to Clark Park",
    "from": "30th Street Station",
    "to": "Clark Park",
    "length_m": 2400,
    "target_km": 2.5,
    "segment_ids": ["seg_12345", "seg_12346", ...],

    "geography": {
      "districts": [
        {
          "number": "19",
          "distanceMeters": 2100,
          "percentage": 87.5
        },
        {
          "number": "24",
          "distanceMeters": 300,
          "percentage": 12.5
        }
      ],
      "tracts": [
        {
          "geoid": "42101030100",
          "name": "301",
          "neighborhood": "University City"
        },
        {
          "geoid": "42101029500",
          "name": "295",
          "neighborhood": "Powelton Village"
        }
      ]
    }
  },
  "geometry": { /* ... */ }
}
```

**Schema Details:**

**`geography.districts` Array:**
- `number` (string): District number (from `DIST_NUMC` property)
- `distanceMeters` (number): Distance traveled within this district
- `percentage` (number): Percentage of total route length (0-100)

**`geography.tracts` Array:**
- `geoid` (string): Full census tract identifier (e.g., "42101030100")
- `name` (string): Short tract name (e.g., "301")
- `neighborhood` (string, optional): Human-readable neighborhood name (requires separate lookup table)

### 4.2 Neighborhood Name Lookup (Optional Enhancement)

**Problem:** Census tracts have numeric IDs, not neighborhood names

**Solution:** Create mapping table from tract GEOID to neighborhood name

**File:** [public/data/tract_neighborhoods.json](../public/data/tract_neighborhoods.json) (to be created)

```json
{
  "42101030100": "University City",
  "42101029500": "Powelton Village",
  "42101028700": "Mantua",
  "42101036100": "Rittenhouse Square",
  ...
}
```

**Data Source Options:**
1. **Manual Curation:** Create mapping from local knowledge (tedious but accurate)
2. **Zillow Neighborhood Boundaries:** Cross-reference census tracts with Zillow neighborhood polygons
3. **OpenStreetMap:** Query OSM for `place=neighbourhood` tags within each tract
4. **City of Philadelphia Open Data:** Use "Neighborhoods" dataset if available

**Implementation:**
```javascript
// In generate_demo_data.mjs or boundary_utils.js
const neighborhoodLookup = JSON.parse(readFileSync('public/data/tract_neighborhoods.json', 'utf-8'));

function enrichTractsWithNeighborhoods(tracts) {
  return tracts.map(tract => ({
    ...tract,
    neighborhood: neighborhoodLookup[tract.geoid] || null,
  }));
}
```

---

## Part 5: Crime Statistics Integration (Future)

**Note:** This section outlines how boundary data enables future crime analysis features.

### 5.1 District-Level Crime Aggregation

**Use Case:** Show crime stats for each district a route crosses

**Data Source:** Carto SQL API (existing crime dataset)

**Query Pattern:**
```sql
SELECT
  district,
  COUNT(*) AS total_incidents,
  SUM(CASE WHEN text_general_code LIKE '%THEF%' THEN 1 ELSE 0 END) AS thefts,
  SUM(CASE WHEN text_general_code LIKE '%ROBBERY%' THEN 1 ELSE 0 END) AS robberies,
  SUM(CASE WHEN text_general_code LIKE '%ASSAULT%' THEN 1 ELSE 0 END) AS assaults
FROM incidents
WHERE
  dispatch_date >= '2024-01-01'
  AND district IN ('19', '24')
GROUP BY district;
```

**UI Display (Enhanced Geographic Context):**
```
Geographic Context:

Police Districts:
  • District 19 (2.1 km, 87%)
    Crime (last 30 days): 42 incidents
    - Thefts: 18
    - Robberies: 6
    - Assaults: 12

  • District 24 (0.3 km, 13%)
    Crime (last 30 days): 38 incidents
    - Thefts: 15
    - Robberies: 8
    - Assaults: 9
```

### 5.2 Tract-Level Demographics (Future)

**Use Case:** Show socioeconomic context alongside safety ratings

**Data Source:** U.S. Census Bureau API (ACS 5-year estimates)

**Metrics:**
- Population density
- Median household income
- Poverty rate
- Educational attainment

**API Query:**
```
https://api.census.gov/data/2020/acs/acs5?
  get=NAME,B01003_001E,B19013_001E,B17001_002E&
  for=tract:030100&
  in=state:42%20county:101&
  key=YOUR_CENSUS_API_KEY
```

**UI Display:**
```
Census Tracts:
  • Tract 301 (University City)
    Population: 4,523
    Median Income: $32,150
    Poverty Rate: 28.4%
```

---

## Part 6: Implementation Checklist for Codex

**Phase 1: Spatial Join Implementation**
- [ ] Create [src/map/boundary_utils.js](../src/map/boundary_utils.js):
  - `findIntersectedDistricts(route, districts)`
  - `findIntersectedTracts(route, tracts)`
  - `calculateDistanceByDistrict(route, districts)` (optional)
- [ ] Add bbox pre-filter optimization
- [ ] Write unit tests with sample route + district/tract features

**Phase 2: Route Data Enhancement**
- [ ] Modify [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs):
  - Load `police_districts.geojson` and `tracts_phl.geojson`
  - Call `findIntersectedDistricts()` and `findIntersectedTracts()` for each route
  - Add `geography.districts` and `geography.tracts` to route properties
- [ ] Regenerate [public/data/routes_phl.demo.geojson](../public/data/routes_phl.demo.geojson)
- [ ] Verify enhanced schema with `node scripts/analyze_routes.mjs`

**Phase 3: UI Integration (Insights Panel)**
- [ ] Update [src/routes_diary/insights_panel.js](../src/routes_diary/insights_panel.js) (or equivalent):
  - Add "Geographic Context" section
  - Render districts list with distance/percentage
  - Render tracts list with neighborhood names (if available)
  - Add "Show boundaries on map" checkbox
- [ ] Add CSS styling for geographic context section

**Phase 4: Map Overlay**
- [ ] Create [src/map/boundary_layer.js](../src/map/boundary_layer.js):
  - `addDistrictOverlay(map, districtFeatures)`
  - `addTractOverlay(map, tractFeatures)`
  - `removeDistrictOverlay(map)`
  - `removeTractOverlay(map)`
- [ ] Wire checkbox toggle to show/hide boundary layers
- [ ] Ensure layers inserted `beforeId: 'road_label'` per [M3_MAP_STYLE_AND_LAYERS.md](./M3_MAP_STYLE_AND_LAYERS.md)

**Phase 5: Optional Enhancements**
- [ ] Create [public/data/tract_neighborhoods.json](../public/data/tract_neighborhoods.json) mapping
- [ ] Add neighborhood name enrichment to tract display
- [ ] Implement district crime stats fetching (Carto SQL API)
- [ ] Add crime stats to district display in Insights panel

**Phase 6: Testing & Documentation**
- [ ] Test with all 5 demo routes
- [ ] Verify boundary overlay toggle works
- [ ] Test with light basemap (from Part B implementation)
- [ ] Update [README.md](../README.md) with new features
- [ ] Update [CHANGELOG.md](../CHANGELOG.md)

---

## Part 7: Edge Cases & Error Handling

**Edge Case 1: Route Doesn't Cross Any Districts**
- **Scenario:** Route entirely outside Philadelphia (impossible with current data, but defensive)
- **Handling:** Display "No districts detected" or hide section
- **Code:** `if (geography.districts.length === 0) return null;`

**Edge Case 2: Route Crosses 5+ Tracts**
- **Scenario:** Long route (5+ km) crosses many small tracts
- **Handling:** Show top 3 by distance + "and 2 more" with expand button
- **UI:** Collapsible list, default showing first 3

**Edge Case 3: Boundary File Load Failure**
- **Scenario:** Network error fetching `police_districts.geojson`
- **Handling:** Graceful degradation - hide geographic context section, log warning
- **Code:** `try/catch` around boundary fetch, fallback to empty arrays

**Edge Case 4: Topology Issues (Self-Intersecting Polygons)**
- **Scenario:** Some ArcGIS exports have invalid geometries
- **Handling:** Validate/repair polygons with `turf.cleanCoords()` or `turf.unkinkPolygon()`
- **Prevention:** Pre-process boundary files during build step

**Edge Case 5: Route Touches District Boundary (No Interior Intersection)**
- **Scenario:** Route runs along district border line
- **Handling:** `booleanIntersects()` returns true (correct - route is "in" both districts)
- **UI:** Show both districts with minimal distance (e.g., "< 0.1 km")

---

## Part 8: Performance Metrics

**Expected Performance (Browser):**

| Operation | Time (ms) | Notes |
|-----------|-----------|-------|
| Load `police_districts.geojson` (364 KB) | 10-20 | One-time fetch, cached |
| Load `tracts_phl.geojson` (1.4 MB) | 40-80 | One-time fetch, cached |
| Parse GeoJSON (both files) | 5-10 | JSON.parse() for 1.8 MB total |
| Intersection check (1 route × 21 districts) | 0.2-0.5 | With bbox pre-filter |
| Intersection check (1 route × 408 tracts) | 0.5-1.5 | With bbox pre-filter |
| Distance calculation (sampling method) | 1-3 | 100 samples per district |
| Render boundary overlay (5 polygons) | 2-5 | MapLibre GL addLayer() |
| **Total (first route view)** | **60-120** | Includes file load + parse |
| **Subsequent route views** | **2-5** | Files cached, only intersection checks |

**Memory Footprint:**
- Boundary GeoJSON in memory: ~2-3 MB (uncompressed)
- Boundary layer on map: ~500 KB (rendered tiles)

**Optimization Opportunities:**
- Use Web Workers for intersection checks (offload from main thread)
- Simplify polygon geometries with `turf.simplify()` (reduce vertex count by 50% without visual loss)
- Lazy-load tracts only if user enables overlay (save 1.4 MB initial load)

---

## Part 9: Alternative Designs Considered

**Alternative 1: Server-Side Spatial Join**
- **Approach:** Backend API endpoint `/api/route-boundaries?route_id=route_001`
- **Pros:** Offload computation from client, no 1.8 MB boundary file load
- **Cons:** Requires backend server (current project is static frontend), added latency
- **Decision:** Rejected (project is client-side only)

**Alternative 2: Embed Boundaries in Route GeoJSON**
- **Approach:** Include full district/tract polygon geometries in each route feature
- **Pros:** No separate boundary files, faster rendering
- **Cons:** Massive file size bloat (routes.geojson would be 10+ MB), redundant data
- **Decision:** Rejected (unacceptable file size)

**Alternative 3: Coarse Grid Instead of Official Boundaries**
- **Approach:** Divide Philadelphia into 1 km × 1 km grid cells, assign IDs
- **Pros:** Simpler intersection logic, no reliance on external boundary data
- **Cons:** Doesn't match police districts (users expect official boundaries), less meaningful
- **Decision:** Rejected (official boundaries required for crime stats integration)

---

## Part 10: References & Resources

**Turf.js Documentation:**
- `booleanIntersects()`: https://turfjs.org/docs/api/booleanIntersects
- `lineIntersect()`: https://turfjs.org/docs/api/lineIntersect
- `booleanPointInPolygon()`: https://turfjs.org/docs/api/booleanPointInPolygon
- `along()`: https://turfjs.org/docs/api/along
- `bbox()`: https://turfjs.org/docs/api/bbox

**Data Sources:**
- Philadelphia Police Districts: https://policegis.phila.gov/ (ArcGIS REST API)
- Census Tracts (2020): https://www.census.gov/geographies/mapping-files.html
- Neighborhood Boundaries: https://www.opendataphilly.org/datasets/neighborhoods/

**Spatial Join Tutorials:**
- "Spatial Joins with Turf.js": https://turfjs.org/docs/guides/spatial-joins
- "Line-Polygon Intersection Detection": https://gis.stackexchange.com/questions/...

---

## Implementation TODOs — 2025-11-24 (Agent I)

- **Hook site:** `src/routes_diary/index.js` — the `selectRoute()` flow now contains a TODO marker right after `currentRoute = feature;` to call a `computeRouteBoundaryContext(routeFeature)` helper before rendering the summary or simulator state.
- **Utilities:** The helper should reuse `src/api/boundaries.js` fetchers plus Turf's `bbox`, `booleanIntersects`, and `lineIntersect` utilities to derive `route.geography.districts` and `route.geography.tracts` arrays.
- **Caching plan:** Cache boundary FeatureCollections in module scope, compute intersections once per route selection, and stash the results on `currentRoute.properties.geography` so the panel + future overlays can re-use them without recomputing.
- **Output schema:** Extend each route feature with `geography: { districts: [{ id, name }], tracts: [{ geoid, name }] }` and persist the payload for future requests/API surface.

## Summary

**This document provides:**
1. ✅ Data inventory (21 districts, 408 tracts, sample properties)
2. ✅ Spatial join algorithm (Turf.js `booleanIntersects()` with bbox optimization)
3. ✅ UI design (Geographic Context section in Insights panel, boundary overlay toggle)
4. ✅ Data flow (enhanced route GeoJSON schema with `geography` property)
5. ✅ Implementation checklist (4 phases: spatial join → data enhancement → UI → map overlay)
6. ✅ Performance analysis (2-5ms per route with caching)
7. ✅ Edge case handling (missing data, topology issues, long routes)
8. ✅ Future integration notes (crime stats, demographics)

**Status:** Design complete, ready for Codex implementation

**Next Steps:**
- Part D: Document routing architecture and safer-path requirements

---

**Design Complete (Part C)**
**Agent:** Agent-M
**Timestamp:** 2025-11-18T05:00:00Z
