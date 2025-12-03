# Changelog

All notable changes to the Philadelphia Crime Dashboard + Route Safety Diary project.

## [Unreleased]

### 2025-11-18 - Map & Network Layer Audit (Agent-M Session)

#### Fixed
- **Network Layer Visibility:** Improved road network visibility in Diary mode
  - Darkened network color from `#94a3b8` (slate-400) to `#64748b` (slate-500) for better contrast with OSM basemap
  - Increased opacity from 0.6 to 0.7
  - Lowered minzoom from 11 to 10 (network now visible at typical route-viewing zoom levels)
  - Increased line widths by 10-15% across all zoom levels and road classes
  - Added diagnostic console logging to confirm network layer loads successfully
  - Files modified: [src/map/network_layer.js](src/map/network_layer.js)

#### Added
- **Comprehensive Documentation (Design Phase - Implementation for Codex):**
  - [logs/AGENTM_MAP_AND_NETWORK_AUDIT_20251118T040000.md](logs/AGENTM_MAP_AND_NETWORK_AUDIT_20251118T040000.md) - Network visibility audit with root cause analysis
  - [docs/M3_MAP_STYLE_AND_LAYERS.md](docs/M3_MAP_STYLE_AND_LAYERS.md) - Light basemap strategy for Diary mode
  - [docs/M3_ROUTE_BOUNDARY_INTEGRATION.md](docs/M3_ROUTE_BOUNDARY_INTEGRATION.md) - Police district and census tract integration design
  - [docs/M3_ROUTING_NOTES.md](docs/M3_ROUTING_NOTES.md) - Routing architecture and safer-path requirements

#### Documentation Highlights

**Part A: Network Visibility (Audit Complete)**
- Verified network data: 91,959 segments present and valid (Philadelphia bbox correct)
- Identified root causes:
  - OSM raster basemap too colorful/busy (blends with network layer)
  - Network color too light (#94a3b8 gray on OSM white/gray roads)
  - Minzoom 11 too high (routes viewed at zoom 11-13, network not always visible)
  - No diagnostic logging (user couldn't confirm network loaded)
- Applied surgical fixes (see Fixed section above)
- Documented limitation: OSM basemap fundamentally incompatible with safety visualization (strategic solution: light vector basemap)

**Part B: Light Basemap Design (Design Complete)**
- Proposed MapTiler Light vector basemap for Diary mode (with free Positron fallback)
- Designed configuration strategy: `VITE_MAPTILER_API_KEY` env variable + `MAP_STYLES` object in config.js
- Specified 7-layer visual hierarchy: basemap → network → safety segments → districts → labels
- Crime Explorer unchanged (keeps OSM raster basemap)
- Color discipline: Reserve color for safety ratings only; basemap uses grays/whites
- Layer insertion strategy: `beforeId: 'road_label'` to place Diary layers above basemap but below labels

**Part C: District/Tract Integration Design (Design Complete)**
- Inventoried boundary data: 21 police districts (364 KB), 408 census tracts (1.4 MB)
- Designed spatial join algorithm using Turf.js `booleanIntersects()` with bbox pre-filter optimization
- Proposed UI: "Geographic Context" section in Insights panel showing crossed districts/tracts
- Enhanced route GeoJSON schema with `geography.districts` and `geography.tracts` properties
- Distance calculation algorithm: Point sampling method to compute km traveled per district
- Map overlay: Translucent blue polygons for districts, orange for tracts (user-toggleable)
- Performance: 2-5ms per route with boundary caching

**Part D: Routing Architecture (Documentation Complete)**
- Documented current Dijkstra implementation in [scripts/graph_pathfinder.mjs](scripts/graph_pathfinder.mjs)
- Listed 5 demo route scenarios:
  1. Route A: 30th St Station → Clark Park (walk, 2-3.5 km)
  2. Route B: 30th St Station → Rittenhouse Sq (walk, 2-3.5 km)
  3. Route C: Penn Campus → 9th & Christian (bike, 3-4.5 km)
  4. Route D: City Hall → 34th & Walnut (walk, 2-3.5 km)
  5. Route E: Rittenhouse Sq → Passyunk & Tasker (bike, 2.5-3.8 km)
- Explained safety-weighted cost function: `length_m * (1 + penalty * (6 - score) / 5)`
- Outlined safer alternative routing requirements:
  - Distance overhead constraint (e.g., max +20% vs. shortest route)
  - Path diversity validation (min 30% different segments)
  - Multiple alternatives (base, +10%, +20% overhead)
- Proposed Yen's K-shortest paths algorithm for multi-alternative generation
- Designed route comparison UI (tab selector, comparison table, tradeoff chart)

#### Known Issues
- **Loop Routes (Critical):** 4 out of 5 demo routes stuck in loops with 96-99% duplicate coordinates
  - Root cause: Likely node snapping errors or disconnected graph components
  - Workaround: Use only route_A for testing
  - Fix required: Debug graph construction and node snapping in [scripts/graph_pathfinder.mjs](scripts/graph_pathfinder.mjs)

#### Next Steps for Codex
1. **Basemap Switch (Part B):** Implement light vector basemap for Diary mode
   - Add `MAP_STYLES` to config.js, update initMap.js to accept `mode` parameter
   - Obtain MapTiler API key, add to .env
2. **District Integration (Part C):** Implement spatial join and UI
   - Create boundary_utils.js with Turf.js intersection functions
   - Update generate_demo_data.mjs to add `geography` property to routes
   - Add "Geographic Context" section to Insights panel
3. **Routing Fixes (Part D):** Debug and enhance pathfinding
   - Fix loop bug in demo routes (validate graph connectivity)
   - Implement distance overhead constraint and diversity validation
   - Generate 3 alternatives per route (base, +10%, +20%)
4. **Route Comparison UI (Part D):** Add tab selector and comparison table
   - Allow user to switch between base and safer alternatives
   - Show tradeoff metrics (distance, safety, duration)

---

## Template for Future Entries

### YYYY-MM-DD - Brief Description

#### Added
- New features

#### Changed
- Updates to existing features

#### Fixed
- Bug fixes

#### Removed
- Deprecated features
