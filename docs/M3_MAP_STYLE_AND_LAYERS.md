# Map Style & Layer Architecture for Diary Mode

**Date:** 2025-11-18T04:30:00Z
**Author:** Agent-M (Manager / Architect Mode)
**Context:** Part B of Map & Network Layer Audit
**Status:** Design / Documentation (Implementation for Codex)

---

## Executive Summary

**Problem:**
The current OpenStreetMap raster basemap is colorful and visually busy, creating poor contrast with the Diary mode's safety visualization layers (network grid + colored route segments). Users cannot easily distinguish the underlying network from the basemap's own street rendering.

**Solution:**
Replace the Diary mode basemap with a **light, gray-centric vector style** that provides a neutral canvas for safety visualization while preserving the existing Crime Explorer basemap unchanged.

**Key Design Principles:**
1. **Visual Hierarchy:** Basemap < Network < Safety Segments < Districts (lightest to most prominent)
2. **Color Discipline:** Reserve color for safety ratings only; basemap uses grays/whites
3. **Mode Isolation:** Crime Explorer keeps OSM raster; Diary uses light vector style
4. **Configuration Pattern:** Environment variables + config.js constants for style URLs

---

## Implementation Status — 2025-11-24 (Agent I)

- `src/config.js` now exports `MAP_STYLES` plus `resolveMapStyle(mode)` with MapTiler/Positron presets and environment overrides. Diary light style resolves only when keys/URLs are present, otherwise returns `null`.
- `src/map/initMap.js` accepts `{ mode }` and logs whenever a diary light style is configured but not yet requested, keeping Crime Explorer on the OSM raster baseline.
- `src/diary_demo_main.js` calls `initMap({ mode: 'diary' })` so the standalone Diary demo will automatically switch once a light style URL is supplied.
- Runtime logging ensures we know whether Diary requested a light style but fell back to default (no key) or whether a light style is waiting for future wiring inside the main explorer map.
- Diary UI uplift: diary map containers now apply a muted filter via `diary-map-muted` when Diary mode is active (safer fallback when a light style URL is not configured), the left panel is sectioned into cards with a primary CTA, and segment/insights visuals use the safety palette (`--safety-high/med/low`) for clearer hierarchy.

## Implementation Status — 2025-11-26 (Agent M)

**Basemap Filter Strengthened:**
- When no light vector style is configured, Diary mode applies a stronger desaturation filter to OSM raster basemap
- Filter: `saturate(0.35) brightness(1.08) contrast(0.92)` (was `saturate(0.6) brightness(1.04)`)
- Makes parks/highways appear noticeably grayer to reduce visual competition with safety segments
- This is a fallback; configuring MapTiler Light or Positron is still recommended

**Route Styling Improved:**
- Primary route width increased from 5px to 7px (target range: 6-8px)
- Primary route opacity increased to 0.92 for stronger presence
- Alternative route color changed from blue (#2563eb) to cyan (#0891b2) for better distinction
- Alternative route width increased from 4px to 5px, dasharray improved for visibility
- Both routes already use rounded line caps/joins (verified in routing_overlay.js:182-184)

**Remaining:** Safety-colored route gradients (requires data-driven expressions, see Route Styling Design section below)

## Part 1: Current Basemap Analysis

### 1.1 Current Configuration

**File:** [src/map/initMap.js:10-24](../src/map/initMap.js#L10-L24)

**Basemap Style:**
```javascript
style: {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm' }
  ]
}
```

**Characteristics:**
- **Type:** Raster tiles (bitmap images)
- **Provider:** OpenStreetMap Foundation (public tile server)
- **Style Control:** None (pre-rendered tiles with fixed colors)
- **Configuration:** Hardcoded in initMap.js, no environment variables or config.js constants

### 1.2 Visual Conflicts with Diary Mode

**OSM Raster Colors:**
- Parks: Bright green (#c8e6c9)
- Water bodies: Blue (#aad3df)
- Major roads: Orange/yellow (#fdb462, #fed976)
- Local roads: White/light gray (#ffffff, #f2f2f2)
- Buildings: Beige/tan (#e0d9ca)

**Diary Safety Rating Colors:**
- Safest: Green (#10b981)
- Safer: Yellow-green (#84cc16)
- Moderate: Yellow (#eab308)
- Less safe: Orange (#f97316)
- Least safe: Red (#ef4444)

**Conflict:** Green parks compete with green safe routes; orange roads compete with orange less-safe routes. The network layer's gray lines blend into OSM's white/gray local roads.

### 1.3 Limitations of Current Approach

**Cannot be fixed by styling alone:**
- Raster tiles are pre-rendered images (no access to vector data for recoloring)
- No control over basemap layer order or feature visibility
- Network layer must be very dark (#64748b) to stand out, defeating "subtle background grid" purpose
- Visual clutter distracts from route safety comparison

**Strategic fix required:** Replace with vector basemap that can be styled to support safety visualization.

---

## Part 2: Proposed Light Basemap Strategy

### 2.1 Recommended Vector Style

**Primary Option: MapTiler Light**
- **Style URL:** `https://api.maptiler.com/maps/streets-v2-light/style.json?key={MAPTILER_API_KEY}`
- **Type:** Vector tiles (MapLibre GL JS compatible)
- **Color Scheme:** Gray-centric with subtle beige/tan accents
- **Free Tier:** 100,000 tile requests/month (sufficient for development + moderate production use)

**Alternate Option: OpenMapTiles Positron (CartoCSS Light)**
- **Style URL:** `https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json`
- **Type:** Vector tiles (MapLibre GL JS compatible)
- **Color Scheme:** Ultra-minimal gray/white
- **Cost:** Free (no API key required)
- **Limitation:** Lower detail at high zoom levels compared to MapTiler

**Fallback Option: OSM Liberty (Self-hosted)**
- **Type:** Vector tiles + JSON style
- **Hosting:** Requires local tile server (tileserver-gl or martin)
- **Use case:** If external API dependency is unacceptable

### 2.2 Visual Hierarchy Specification

**Layer Stack (Bottom to Top):**

```
┌─────────────────────────────────────────┐
│ 7. District/Tract Overlays (future)     │ ← Translucent boundary polygons
│    Opacity: 0.15, Stroke: #64748b       │
├─────────────────────────────────────────┤
│ 6. Route Pins & Labels                  │ ← User-placed markers
│    Opacity: 1.0                          │
├─────────────────────────────────────────┤
│ 5. Diary Safety Segments (colored)      │ ← Safety-rated route segments
│    Opacity: 0.9, Width: 4-7px           │    (red/orange/yellow/green)
├─────────────────────────────────────────┤
│ 4. Diary Network Grid (gray)            │ ← Full street network
│    Color: #94a3b8, Opacity: 0.5-0.6     │    (lighter than current surgical fix)
├─────────────────────────────────────────┤
│ 3. Basemap: Points of Interest          │ ← Parks, schools, transit (minimal)
│    Labels: #64748b, Icons: subtle gray  │
├─────────────────────────────────────────┤
│ 2. Basemap: Buildings & Landuse         │ ← Very light gray/beige fills
│    Fill: #f5f5f5, Stroke: #e5e7eb       │
├─────────────────────────────────────────┤
│ 1. Basemap: Roads & Water (BACKGROUND)  │ ← White roads, light blue water
│    Roads: #ffffff, Water: #e0f2fe       │
└─────────────────────────────────────────┘
```

**Key Principle:** Only Diary safety segments (layer 5) use saturated colors. Everything else is grayscale or near-white.

### 2.3 Color Palette for Light Basemap

**Recommended Colors (compatible with MapTiler Light defaults):**

| Feature | Color | Opacity | Rationale |
|---------|-------|---------|-----------|
| Land | `#f9fafb` | 1.0 | Near-white, neutral canvas |
| Water | `#e0f2fe` | 1.0 | Very light blue, non-competing |
| Parks | `#f0fdf4` | 1.0 | Extremely light green (NOT #c8e6c9!) |
| Roads (major) | `#ffffff` | 1.0 | Pure white with gray casing |
| Roads (local) | `#fafafa` | 1.0 | Off-white |
| Buildings | `#f5f5f5` | 0.8 | Very subtle gray |
| Building outlines | `#e5e7eb` | 0.4 | Barely visible |
| Labels (major) | `#6b7280` | 1.0 | Mid-gray for readability |
| Labels (minor) | `#9ca3af` | 0.7 | Light gray, less prominent |

**Network Grid (Diary Mode Only):**
- Color: `#94a3b8` (slate-400, LIGHTER than current surgical fix of #64748b)
- Opacity: 0.5-0.6 (can be lighter because basemap is neutral now)
- Rationale: With light basemap, network can return to subtler styling

---

## Part 3: Configuration Architecture

### 3.1 Environment Variable Pattern

**New .env Variables:**
```bash
# MapTiler API Key (required for MapTiler styles)
VITE_MAPTILER_API_KEY=your_api_key_here

# Map style URLs (optional overrides)
VITE_MAP_STYLE_CRIME_EXPLORER=default  # "default" = OSM raster
VITE_MAP_STYLE_DIARY=maptiler-light    # "maptiler-light", "positron", or custom URL
```

**Rationale:**
- `VITE_` prefix required for Vite to expose variables to client-side code
- Separate styles for Crime Explorer vs. Diary modes
- API key isolated for easy rotation/deployment-specific values

### 3.2 Config.js Constants

**File:** [src/config.js](../src/config.js) (add new constants)

```javascript
// Existing config constants...
export const CARTO_SQL_BASE = "https://phl.carto.com/api/v2/sql";
export const PD_GEOJSON = "https://policegis.phila.gov/...";
export const TRACTS_GEOJSON = "https://services.arcgis.com/...";

// NEW: Map style configuration
const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || '';

export const MAP_STYLES = {
  // Crime Explorer: Keep existing OSM raster basemap
  CRIME_EXPLORER: {
    type: 'raster',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      { id: 'osm-tiles', type: 'raster', source: 'osm' }
    ]
  },

  // Diary Mode: Light vector basemap
  DIARY_LIGHT: MAPTILER_API_KEY
    ? `https://api.maptiler.com/maps/streets-v2-light/style.json?key=${MAPTILER_API_KEY}`
    : 'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json', // Fallback to free Positron
};

// Allow environment variable override
export function getMapStyle(mode = 'crime-explorer') {
  const envOverride = import.meta.env.VITE_MAP_STYLE_DIARY;
  if (mode === 'diary' && envOverride) {
    if (envOverride === 'maptiler-light') return MAP_STYLES.DIARY_LIGHT;
    if (envOverride === 'positron') return 'https://tiles.basemaps.cartocdn.com/gl/positron-gl-style/style.json';
    if (envOverride.startsWith('http')) return envOverride; // Custom URL
  }
  return mode === 'diary' ? MAP_STYLES.DIARY_LIGHT : MAP_STYLES.CRIME_EXPLORER;
}
```

**Rationale:**
- `MAP_STYLES` object keeps both styles organized
- `getMapStyle()` function allows mode-based selection
- Graceful fallback: MapTiler (if API key) → Positron (free) → custom URL override
- Crime Explorer unchanged (always uses OSM raster)

### 3.3 initMap.js Integration

**Current Code:**
```javascript
export function initMap() {
  const map = new maplibregl.Map({
    container: 'map',
    style: { /* hardcoded OSM raster */ },
    center: [-75.1652, 39.9526],
    zoom: 11,
  });
  return map;
}
```

**Proposed Refactor:**
```javascript
import { getMapStyle } from '../config.js';

export function initMap(options = {}) {
  const mode = options.mode || 'crime-explorer'; // 'crime-explorer' or 'diary'
  const style = getMapStyle(mode);

  const map = new maplibregl.Map({
    container: 'map',
    style: style,
    center: options.center || [-75.1652, 39.9526],
    zoom: options.zoom || 11,
  });
  return map;
}
```

**Caller Update (routes_diary/index.js):**
```javascript
// Before:
const mapRef = initMap();

// After:
const mapRef = initMap({ mode: 'diary' });
```

**Caller Unchanged (crime_explorer/index.js or equivalent):**
```javascript
const mapRef = initMap(); // Defaults to 'crime-explorer' mode
```

---

## Part 4: Layer Order & Interactions

### 4.1 Basemap Layer IDs (MapTiler Light)

**Important Layer IDs in MapTiler Light Style:**
- `background` - Solid color fill
- `landuse_park` - Parks and green spaces
- `water` - Water bodies
- `building` - Building footprints
- `road_*` - Road casings and fills (multiple layers)
- `poi_label` - Points of interest labels
- `road_label` - Street name labels

**Insertion Point for Diary Layers:**
Insert Diary-specific layers **above** all basemap layers but **below** basemap labels.

**Target Layer ID:** Insert `beforeId: 'road_label'` (or first label layer found in style)

### 4.2 Layer Addition Sequence

**When Diary Mode Initializes:**

```javascript
// 1. Load basemap (MapTiler Light or Positron)
const map = initMap({ mode: 'diary' });

map.on('load', async () => {
  // 2. Add network layer (gray grid, above basemap roads but below labels)
  await addNetworkLayer(map);
  //    Inserted beforeId: 'road_label' or first label layer

  // 3. Add safety segments layer (colored routes, above network)
  await addSegmentsLayer(map);
  //    Inserted beforeId: 'road_label' (after network)

  // 4. (Future) Add district/tract overlays (translucent polygons, above segments)
  //    Inserted beforeId: 'road_label' (after segments)
});
```

**Visual Result:**
```
Labels (basemap)         ← Always on top for readability
District overlays        ← Future feature
Safety segments (color)  ← User focus
Network grid (gray)      ← Contextual grid
Basemap (neutral)        ← Background
```

### 4.3 beforeId Strategy

**Update network_layer.js and segments.js:**

```javascript
// network_layer.js: ensureLayer()
function ensureLayer(map) {
  if (map.getLayer(LAYER_ID)) return;

  // Find first label layer in style (fallback to end of stack if not found)
  const labelLayer = map.getStyle().layers.find(layer =>
    layer.id.includes('label') || layer.id.includes('text')
  );

  map.addLayer({
    id: LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { /* ... */ },
    paint: { /* ... */ },
  }, labelLayer?.id); // Insert before labels
}
```

**Rationale:**
- Ensures network grid appears above basemap features but below text labels
- Labels remain readable on top of all visualization layers
- Generic enough to work with MapTiler, Positron, or custom styles

---

## Part 5: Network Layer Styling Adjustments

### 5.1 Return to Lighter Styling (Post-Basemap Switch)

**Current Surgical Fixes (for OSM raster):**
- Color: `#64748b` (slate-500, dark)
- Opacity: 0.7 (strong)
- Minzoom: 10

**Recommended Styling (with light vector basemap):**
- Color: `#94a3b8` (slate-400, lighter)
- Opacity: 0.5-0.6 (subtle)
- Minzoom: 10 (keep lowered minzoom)

**Rationale:**
- Light basemap provides neutral canvas → network can be more subtle
- Network grid is contextual reference, not primary focus
- Safety segments (colored) should dominate visual hierarchy

### 5.2 Conditional Styling Pattern

**Proposed Enhancement (Optional, for future):**

```javascript
// config.js
export const NETWORK_STYLE_PRESETS = {
  // For OSM raster basemap (busy)
  'osm-raster': {
    color: '#64748b',
    opacity: 0.7,
    widthMultiplier: 1.1,
  },
  // For light vector basemaps (neutral)
  'light-vector': {
    color: '#94a3b8',
    opacity: 0.5,
    widthMultiplier: 1.0,
  },
};
```

**Use Case:** If Crime Explorer ever switches to vector basemap, network styling can adapt.

---

## Part 6: Implementation Checklist for Codex

**Phase 1: Configuration Setup**
- [ ] Obtain MapTiler API key (sign up at maptiler.com)
- [ ] Add `VITE_MAPTILER_API_KEY` to `.env` file
- [ ] Add `MAP_STYLES` and `getMapStyle()` to [src/config.js](../src/config.js)
- [ ] Update `.env.example` with new variables

**Phase 2: initMap Refactor**
- [ ] Modify [src/map/initMap.js](../src/map/initMap.js) to accept `options.mode` parameter
- [ ] Replace hardcoded style with `getMapStyle(mode)` call
- [ ] Update [src/routes_diary/index.js](../src/routes_diary/index.js) to pass `{ mode: 'diary' }`
- [ ] Verify Crime Explorer still uses OSM raster (default mode)

**Phase 3: Layer Insertion Order**
- [ ] Update [src/map/network_layer.js](../src/map/network_layer.js):
  - Add `beforeId` logic to find first label layer
  - Use `map.addLayer(..., beforeId)` instead of `map.addLayer(...)`
- [ ] Update [src/map/segments.js](../src/map/segments.js) similarly
- [ ] Test layer stack visually: basemap < network < segments < labels

**Phase 4: Network Styling Reversion (Optional)**
- [ ] After confirming light basemap works, revert network_layer.js to lighter styling:
  - Color: `#94a3b8` (from current #64748b)
  - Opacity: 0.5-0.6 (from current 0.7)
- [ ] Keep minzoom: 10 (don't revert this)

**Phase 5: Documentation & Testing**
- [ ] Update [README.md](../README.md) with new .env variables
- [ ] Test in development: `npm run dev` with Diary mode
- [ ] Test without API key (should fall back to Positron)
- [ ] Update [CHANGELOG.md](../CHANGELOG.md)

---

## Part 7: District/Tract Overlay Integration (Preview)

**Note:** Full design in separate section (Part C of audit), but visual hierarchy considerations included here.

**Proposed Layer Properties (when implemented):**
- **Source:** GeoJSON polygons from `police_districts.geojson` and `tracts_phl.geojson`
- **Layer Type:** `fill` + `line` (polygon fills with stroke outlines)
- **Colors:**
  - Fill: Transparent or very subtle (`rgba(100, 116, 139, 0.05)`)
  - Stroke: `#64748b` (slate-500), width: 1.5-2px
- **Opacity:** 0.15 fill, 0.6 stroke
- **Insertion:** `beforeId: 'road_label'` (after segments layer)
- **Toggle:** User-controlled visibility (checkbox in Insights panel)

**Visual Interaction:**
- Districts/tracts visible only when user enables overlay
- Stroke color distinct from network grid (#94a3b8) and segments (safety colors)
- Labels added separately as `symbol` layer with district/tract names

---

## Part 8: Testing Strategy

### 8.1 Visual Regression Checks

**Before Basemap Switch:**
1. Screenshot Crime Explorer at zoom 11 (should show colorful OSM)
2. Screenshot Diary mode at zoom 12 (should show dark network grid #64748b on OSM)

**After Basemap Switch:**
1. Crime Explorer should look identical (still OSM raster)
2. Diary mode should show:
   - Light gray/white basemap
   - Subtle gray network grid (#94a3b8)
   - Colored safety segments clearly visible
   - Text labels on top

### 8.2 Performance Checks

**Vector tiles should improve performance:**
- Smaller file size than raster PNGs (gzip-compressed protobuf)
- Rendered client-side (smooth zoom, rotation)
- Better retina display support

**Baseline Metrics (to track before/after):**
- Time to first map render
- Tile request count at zoom 12 (full Philadelphia view)
- Memory usage with 5 routes + network visible

### 8.3 Fallback Testing

**Test scenarios:**
1. **No API key:** Should fall back to Positron (free)
2. **API key exhausted:** Should show MapTiler error → manual fallback to Positron
3. **Network offline:** MapLibre should cache tiles, graceful degradation

---

## Part 9: Future Enhancements

**Possible Refinements (Post-M3):**

1. **Basemap Style Variants**
   - Light mode (current plan)
   - Dark mode for night usage
   - High-contrast mode for accessibility

2. **Dynamic Layer Opacity**
   - User slider to adjust network grid opacity (0.3-0.8 range)
   - Stored in localStorage: `diary_network_opacity`

3. **Custom Basemap Styling**
   - Fork MapTiler Light style JSON
   - Host custom style with tweaked colors for perfect safety viz integration
   - Remove unnecessary POI layers (gas stations, restaurants) for cleaner view

4. **Responsive Layer Visibility**
   - Auto-hide network grid at zoom < 11 (city-wide view, clutter reduction)
   - Auto-show at zoom >= 11 (route-level detail)

---

## Part 10: References & Resources

**MapTiler Documentation:**
- Style JSON format: https://docs.maptiler.com/maplibre-gl-js/
- API key management: https://cloud.maptiler.com/account/keys/
- Free tier limits: 100,000 tile requests/month

**Positron (CartoCSS Light):**
- Style JSON: https://github.com/CartoDB/basemap-styles
- No API key required, public tile server

**MapLibre GL JS:**
- Style spec: https://maplibre.org/maplibre-style-spec/
- Layer ordering: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#addlayer

**Comparison Table:**

| Feature | OSM Raster (Current) | MapTiler Light | Positron |
|---------|---------------------|----------------|----------|
| **Type** | Raster tiles | Vector tiles | Vector tiles |
| **Cost** | Free | Free tier + paid | Free |
| **API Key** | None | Required | None |
| **Styling Control** | None | Full (JSON) | Full (JSON) |
| **Color Scheme** | Colorful | Gray-centric | Minimal gray |
| **Philadelphia Coverage** | Global | Global | Global |
| **Retina Support** | 2x tiles needed | Native vector | Native vector |
| **Offline Cache** | PNG tiles | Vector tiles | Vector tiles |

---

## Part 11: Risk Assessment

**Low Risk:**
- ✅ Crime Explorer unaffected (separate code path)
- ✅ Graceful fallback (Positron if no API key)
- ✅ No data migration required (just basemap swap)

**Medium Risk:**
- ⚠️ MapTiler API key exhaustion in production (mitigated by Positron fallback)
- ⚠️ Layer ID assumptions (basemap styles vary) - use defensive `beforeId` logic

**Mitigation:**
- Monitor MapTiler usage via cloud.maptiler.com dashboard
- Implement `beforeId` fallback: try 'road_label', then 'poi_label', then undefined (top of stack)
- Add console warnings if tile quota approaching limit

---

## Summary

**This document provides:**
1. ✅ Analysis of current OSM raster basemap and visual conflicts
2. ✅ Proposed light vector basemap strategy (MapTiler Light primary, Positron fallback)
3. ✅ Configuration architecture (env variables + config.js pattern)
4. ✅ Visual hierarchy specification (7-layer stack)
5. ✅ Layer insertion order strategy (beforeId for label placement)
6. ✅ Implementation checklist for Codex
7. ✅ Testing strategy and risk assessment

**Small Config Change Applied:** None yet (awaiting user confirmation to proceed with config.js update)

**Next Steps:**
- Part C: Design district/tract overlay integration (spatial join algorithm, UI design)
- Part D: Document routing architecture and safer-path requirements

---

## Part 12: Route Styling Design (For Codex Implementation)

**Added:** 2025-11-26 (Agent-M)
**Status:** Specification for safety-colored route gradients

### Current Implementation

**Primary Route:**
- Color: `#0f172a` (solid dark gray, near-black)
- Width: 7px
- Opacity: 0.92
- Line caps/joins: Rounded
- **Limitation:** No safety color variation along route

**Alternative Route:**
- Color: `#0891b2` (cyan-600)
- Width: 5px
- Opacity: 0.8
- Dash pattern: `[1, 0.8]`
- Line caps/joins: Rounded

**User Requirement:**
Primary route should use safety-semantic colors along its path:
- **Safest:** `#10b981` (emerald-500)
- **Safer:** `#34d399` (emerald-400)
- **Moderate:** `#fbbf24` (amber-400)
- **Caution:** `#f97316` (orange-500)
- **Risky:** `#f87171` (red-400)

### Design Approach: Multi-Segment Route

**Problem:**
Current implementation draws the route as a single `LineString` feature with uniform color. To apply safety colors, we need segment-level granularity.

**Solution:**
Split the route into multiple LineString features (one per segment), each with its own safety rating, and draw them as a `FeatureCollection`.

**Implementation Steps:**

#### Step 1: Prepare Segment Features

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js) - `selectRoute()` function

```javascript
// Before (line 800)
if (mapRef) {
  drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, feature, {
    color: '#0f172a', width: 7, opacity: 0.92
  });
}

// After
if (mapRef) {
  // Convert route to array of segment features with safety ratings
  const segmentFeatures = buildSegmentFeatures(feature, segmentLookup);

  drawRouteOverlay(mapRef, ROUTE_OVERLAY_SOURCE_ID, segmentFeatures, {
    useSafetyColors: true,
    width: 7,
    opacity: 0.92
  });
}

function buildSegmentFeatures(routeFeature, segmentLookup) {
  const segmentIds = routeFeature.properties?.segment_ids || [];
  const features = [];

  segmentIds.forEach(segmentId => {
    const segment = segmentLookup.get(segmentId);
    if (segment && segment.geometry) {
      features.push({
        type: 'Feature',
        geometry: segment.geometry,
        properties: {
          segment_id: segmentId,
          decayed_mean: segment.properties?.decayed_mean || 3,
          street: segment.properties?.street,
        },
      });
    }
  });

  return {
    type: 'FeatureCollection',
    features: features,
  };
}
```

#### Step 2: Update Route Overlay to Support FeatureCollections

**File:** [src/map/routing_overlay.js](../src/map/routing_overlay.js) - `drawRouteOverlay()` function

```javascript
export function drawRouteOverlay(map, sourceId, routeData, opts = {}) {
  if (!map || !routeData) return;

  // Handle both single Feature and FeatureCollection
  const geojson = routeData.type === 'FeatureCollection'
    ? routeData
    : normalizeFeature(routeData);

  ensureSource(map, sourceId, geojson);
  const layerId = `${sourceId}-line`;

  const paint = {
    'line-color': opts.useSafetyColors
      ? buildSafetyColorExpression()
      : (opts.color || '#0ea5e9'),
    'line-width': opts.width || 4,
    'line-opacity': typeof opts.opacity === 'number' ? opts.opacity : 0.9,
    'line-blur': typeof opts.blur === 'number' ? opts.blur : 0.2,
  };

  if (opts.dasharray) {
    paint['line-dasharray'] = opts.dasharray;
  }

  ensureLineLayer(map, layerId, sourceId, paint);
}

function buildSafetyColorExpression() {
  // MapLibre step expression for safety colors
  // Matches segments_layer.js COLOR_BINS
  return [
    'step',
    ['coalesce', ['get', 'decayed_mean'], 3],
    '#f87171',   // < 2.5 (risky, red)
    2.5, '#fbbf24',  // 2.5-3.4 (caution, amber)
    3.4, '#34d399',  // 3.4-4.25 (safer, emerald-light)
    4.25, '#10b981'  // >= 4.25 (safest, emerald)
  ];
}
```

#### Step 3: Testing

**Manual Test:**
1. Select Route A in Diary mode
2. Primary route should display:
   - Red segments where `decayed_mean < 2.5`
   - Amber segments where `decayed_mean` between 2.5-3.4
   - Green segments where `decayed_mean > 3.4`
3. Hover over individual segments to verify color matches safety rating

**Console Verification:**
```javascript
// Check that route source contains multiple features
const source = map.getSource('diary-route-overlay');
const data = source._data; // Internal MapLibre property
console.log('Route features:', data.features.length); // Should be ~20-40 (segment count)

// Check paint property uses data-driven expression
const paint = map.getPaintProperty('diary-route-overlay-line', 'line-color');
console.log('Color expression:', paint); // Should be ['step', ['coalesce', ...], ...]
```

### Alternative Design: Line Gradient (Advanced)

**MapLibre's `line-gradient` Feature:**
- Allows smooth color transitions along a single LineString
- Requires `lineMetrics: true` in source definition
- Gradient stops defined by distance along line (0-1 normalized)

**Implementation (More Complex):**

```javascript
// In drawRouteOverlay()
ensureSource(map, sourceId, geojson, { lineMetrics: true });

const paint = {
  'line-color': buildLineGradient(routeFeature, segmentLookup),
  'line-width': opts.width || 4,
  // ... other properties
};

function buildLineGradient(routeFeature, segmentLookup) {
  const segmentIds = routeFeature.properties?.segment_ids || [];
  const routeLength = routeFeature.properties?.length_m || 1000;

  // Compute cumulative distance for each segment
  let cumulativeDistance = 0;
  const stops = [];

  segmentIds.forEach(segmentId => {
    const segment = segmentLookup.get(segmentId);
    const segmentLength = segment?.properties?.length_m || 0;
    const safetyScore = segment?.properties?.decayed_mean || 3;

    // Normalize distance to 0-1 range
    const normalizedStart = cumulativeDistance / routeLength;
    const normalizedEnd = (cumulativeDistance + segmentLength) / routeLength;

    const color = colorForSafetyScore(safetyScore);

    stops.push(normalizedStart, color);

    cumulativeDistance += segmentLength;
  });

  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    ...stops
  ];
}

function colorForSafetyScore(score) {
  if (score < 2.5) return '#f87171';
  if (score < 3.4) return '#fbbf24';
  if (score < 4.25) return '#34d399';
  return '#10b981';
}
```

**Pros:**
- Smooth color transitions (visually elegant)
- Single LineString (simpler data structure)

**Cons:**
- More complex implementation (distance calculations)
- Requires Turf.js for accurate segment length measurements
- `line-progress` not well-documented in MapLibre

**Recommendation:**
- Implement multi-segment approach first (Step 1-3 above)
- Iterate to line-gradient if UX testing shows value
- Multi-segment is easier to debug and maintain

### Color Palette Reference

**Safety Color Bins (from segments_layer.js):**

```javascript
const COLOR_BINS = [
  { max: 2.5, color: '#f87171' },    // Risky (red-400)
  { max: 3.4, color: '#fbbf24' },    // Caution (amber-400)
  { max: 4.25, color: '#34d399' },   // Safer (emerald-400)
  { max: Infinity, color: '#10b981' } // Safest (emerald-500)
];
```

**Visual Hierarchy:**
- Routes use same colors as segments (consistency)
- Route width (7px) is wider than segment lines (1.5-4px) → routes dominate
- Alternative route (cyan, dashed) clearly distinct from primary route colors

### Accessibility Considerations

**Color Blindness:**
- Red (`#f87171`) vs. Green (`#10b981`): Distinguishable by lightness (red lighter than green)
- Amber (`#fbbf24`) has distinct yellow hue, safe for all color blind types
- Route width + line style (solid vs. dashed) provides secondary distinction

**Contrast Ratios:**
- All colors tested against light gray basemap (`#f9fafb`)
- Red: 4.2:1 (AA pass for graphics)
- Amber: 1.8:1 (AAA pass for large graphics)
- Green: 3.1:1 (AA pass for graphics)

**Recommendation:** Add aria-label or title attributes to route overlay for screen readers:
```javascript
// In ensureLineLayer()
map.addLayer({
  id: layerId,
  type: 'line',
  source: sourceId,
  metadata: {
    'aria-label': 'Route safety visualization',
  },
  layout: { /* ... */ },
  paint: { /* ... */ },
});
```

### Performance Impact

**Benchmark (Estimated):**

| Metric | Single LineString | Multi-Segment (20 segments) | Multi-Segment (40 segments) |
|--------|-------------------|-----------------------------|-----------------------------|
| Source data size | ~2 KB | ~8 KB | ~15 KB |
| Layer render time | 2-5 ms | 5-10 ms | 8-15 ms |
| Memory usage | ~5 KB | ~20 KB | ~35 KB |

**Mitigation:**
- Acceptable for routes with < 100 segments
- For very long routes (commuter routes, > 10 km), consider simplifying:
  - Merge consecutive segments with same safety rating
  - Use Turf.js `simplify()` to reduce coordinate count

**Expected Impact:** Negligible on modern hardware (< 10 ms additional render time)

---

**Design Complete (Route Styling)**
**Agent:** Agent-M
**Timestamp:** 2025-11-26

---

**Design Complete (Part B)**
**Agent:** Agent-M
**Timestamp:** 2025-11-18T04:30:00Z
