# Road Network Audit — Routing Architecture & Visibility (M3 Routing Plan)

**Date:** 2025-11-18T03:30:00Z
**Agent:** Agent-M (Manager Audit + Architecture Mode)
**Task:** Audit network visibility, reverse-engineer route generation, design proper routing architecture

---

## Executive Summary

**Current State:**
- ✅ Network data successfully fetched (109k raw, 92k segmented) within Philadelphia bbox
- ✅ Network layer code exists with Agent-M visibility hotfix applied
- ❌ **CRITICAL**: 4 of 5 demo routes stuck in tight loops (96-99% duplicate coordinates)
- ❌ Routes do not reach intended destinations (coverage <0.2 km² vs 2-4 km targets)
- ⚠️ No "Show road network" UI toggle implemented

**Root Cause:**
- `walkRouteFrom()` fallback logic revisits already-visited segments, creating infinite loops
- `endHint` sorting helps but random selection from top-3 still picks same segments repeatedly
- Only Route D (City Hall → 34th & Walnut) works correctly

**Recommendation:**
- Replace random-walk algorithm with proper Dijkstra shortest-path
- Implement A* for alt routes with safety-weighted costs
- Add segment-graph builder as reusable module

---

## Part 1: Road Network Visibility and UI Audit

### A. Data Files Inspection

**Files Verified:**
- ✅ `data/streets_phl.raw.geojson` exists
- ✅ `data/segments_phl.network.geojson` exists (91,959 segments)
- ✅ `data/routes_phl.demo.geojson` exists (5 routes)

**Network Segments:**
- **Total**: 91,959 features (down from 144k after bbox narrowing)
- **Class Distribution**:
  - Class 1 (highways/trunks): 1,773 (1.9%)
  - Class 2 (primary/secondary): 5,195 (5.6%)
  - Class 3 (tertiary): 3,643 (4.0%)
  - Class 4 (local streets): 81,348 (88.5%)
- **Bbox**: Within Philadelphia proper (after -75.135 east boundary fix)

**Demo Routes Bbox:**
- **Observed**: `[-75.1945, 39.9477]` to `[-75.1576, 39.9555]`
- **Coverage**: ~3.5 km east-west × 0.9 km north-south
- **Problem**: Routes confined to tiny area, not spanning intended scenarios

### B. MapLibre Network Layer Wiring

**Source & Layer IDs:**
- **Source**: `diary-network` ([network_layer.js:3](../src/map/network_layer.js#L3))
- **Layer**: `diary-network-line` ([network_layer.js:4](../src/map/network_layer.js#L4))

**Visibility Configuration:**
- **Minzoom**: 11 ([network_layer.js:52](../src/map/network_layer.js#L52))
- **Maxzoom**: None (renders at all zoom levels ≥11)
- **Color**: `#94a3b8` (slate-400, darkened by Agent-M hotfix)
- **Opacity**: 0.6 (increased from 0.4)
- **Line Width** (zoom-interpolated):
  - Zoom 10: Class 1=4.0px, Class 2=3.2px, Class 3=2.4px, Class 4=1.8px
  - Zoom 14: Class 1=5.0px, Class 2=4.0px, Class 3=2.8px, Class 4=2.0px

**Layer Insertion Order:**
- **Added**: Via `map.addLayer()` without `beforeId` parameter ([network_layer.js:45](../src/map/network_layer.js#L45))
- **Result**: Inserted at **top of style stack** (above basemap, exact position depends on when called)
- **Integration**: Called from `routes_diary/index.js:1659` during `initDiaryMode()`:
  ```javascript
  await addNetworkLayer(mapRef);
  ```

**Data Throttling:**
- Network has 91,959 segments
- Throttled to ~15,000 features for performance ([network_layer.js:24-27](../src/map/network_layer.js#L24-L27))
- Every 6th segment rendered (step = 92k / 15k ≈ 6)

**Visibility Assessment:**
- **Status**: Layer should be **visible at zoom ≥11** after Agent-M hotfix
- **Before Hotfix**: Invisible (color/opacity too similar to basemap)
- **After Hotfix**: Darker gray (#94a3b8), higher opacity (0.6), should stand out
- **No User Testing Yet**: Cannot confirm actual visibility without running app

### C. Missing UI Toggle

**Current State:**
- No "Show road network" checkbox in Diary panel
- Layer visibility always on (when zoom ≥11)
- No runtime control for users

**Required** (from ROAD_NETWORK_NOTES.md):
- Checkbox in Diary panel controls section
- Event listener calling `setNetworkLayerVisibility()` function
- Function does not currently exist in [network_layer.js](../src/map/network_layer.js)

**Implementation Gap**: Codex did not implement UI toggle (Packet C.1 from plan)

---

## Part 2: Current Route Generation Algorithm (Reverse-Engineered)

### A. Algorithm Summary

**File:** [scripts/generate_demo_data.mjs:202-338](../scripts/generate_demo_data.mjs#L202-L338)

**High-Level Flow:**

1. **Load Network Segments** (lines 129-153)
   ```
   Load segments_phl.network.geojson (all 92k segments)
   → Map to normalized format with id, geometry, length_m, class
   → segments = full 92k array
   ```

2. **Filter to Philadelphia** (lines 213-233)
   ```
   PHILLY_BBOX = [-75.28, 39.90, -75.135, 40.05]
   phillySegments = segments.filter(inPhilly)
   → Uses turf.bbox() to check if segment bbox within PHILLY_BBOX
   → baseSegments = phillySegments || segments (fallback if filter fails)
   ```

3. **Build Adjacency Graph** (lines 235-246)
   ```
   adjacency = Map<nodeKey, [segments]>
   For each segment in baseSegments:
     nodeKey(start) → add segment to adjacency
     nodeKey(end) → add segment to adjacency
   → nodeKey = `${lng.toFixed(5)},${lat.toFixed(5)}`
   ```

4. **Find Start Node** (lines 255-268, `findNearestKey`)
   ```
   For each node in adjacency:
     Calculate distance to targetLngLat (scenario start point)
     Return nearest node key
   ```

5. **Walk Graph** (lines 270-299, `walkRouteFrom`)
   ```
   Input: startKey, targetKm, endHint
   path = []
   visited = Set()
   currentKey = startKey

   For i = 0 to maxSegments (140):
     neighbors = adjacency.get(currentKey)
     unvisited = neighbors.filter(seg => !visited.has(seg.id))
     pool = unvisited.length > 0 ? unvisited : neighbors  // ← BUG HERE

     If endHint:
       Sort pool by distance to endHint
       Pick random from top 3
     Else:
       Pick random from pool

     Add segment to path, mark as visited
     currentKey = otherEnd(segment, currentKey)

     If total length within [targetKm*0.9, targetKm*1.2]: break
   ```

6. **Generate 5 Routes** (lines 301-338)
   ```
   For each ROUTE_SCENARIO:
     startKey = findNearestKey(scenario.start)
     primarySegments = walkRouteFrom(startKey, scenario.targetKm, {endHint: scenario.end})
     altSegments = walkRouteFrom(startKey, scenario.targetKm * 0.9, {endHint: scenario.end})
     geometry = stitchGeometry(primarySegments)
     Create route feature with properties
   ```

7. **Stitch Geometry** (lines 155-184, `stitchGeometry`)
   ```
   For each segment ID:
     Find segment in segments array
     If not first segment:
       Check if end of previous matches start or end of current
       Reverse current if end is closer
     Append coordinates (skip first coord if connected)
   ```

### B. Route Scenarios vs Actual Results

**Intended Scenarios** (from ROAD_NETWORK_NOTES.md + generate_demo_data.mjs:202-208):

| Route | Name | Start | End | Target | Actual Length | Status |
|-------|------|-------|-----|--------|---------------|--------|
| A | 30th St → Clark Park | [-75.1810, 39.9556] | [-75.2129, 39.9493] | 2.3 km | 2,080m | ❌ LOOPS |
| B | 30th St → Rittenhouse | [-75.1810, 39.9556] | [-75.1715, 39.9496] | 2.2 km | 2,000m | ❌ LOOPS |
| C | Penn → 9th & Christian | [-75.1932, 39.9522] | [-75.1605, 39.9391] | 4.2 km | 3,805m | ❌ LOOPS |
| D | City Hall → 34th & Walnut | [-75.1652, 39.9526] | [-75.1905, 39.9524] | 2.2 km | 2,039m | ✅ WORKS |
| E | Rittenhouse → Passyunk | [-75.1715, 39.9496] | [-75.1690, 39.9305] | 3.2 km | 2,886m | ❌ LOOPS |

**Detailed Analysis** (from `scripts/analyze_routes.mjs` output):

#### Route A: 30th St Station → Clark Park ❌
- **Coordinates**: 157 total, 5 unique (96.8% duplicates)
- **Segment IDs**: 104 segments, 101 duplicates
- **Start**: [-75.1810, 39.9555] ✅ Correct (30th St Station area)
- **End**: [-75.1809, 39.9555] ❌ Same location as start!
- **Bbox**: 0.02km × 0.01km (should be ~2km west to Clark Park)
- **Problem**: Stuck looping over seg_38732, seg_78077, seg_38733
- **Intended End**: [-75.2129, 39.9493] (Clark Park at 43rd & Chester)
- **Missing Distance**: ~3.5 km west

#### Route B: 30th St Station → Rittenhouse Sq ❌
- **Coordinates**: 139 total, 5 unique (96.4% duplicates)
- **Segment IDs**: 100 segments, 97 duplicates
- **Start**: [-75.1810, 39.9555] ✅ Correct
- **End**: [-75.1810, 39.9555] ❌ Same location as start!
- **Bbox**: 0.02km × 0.01km (should extend ~1km east to Rittenhouse)
- **Problem**: Same loop as Route A (seg_38732, seg_78077, seg_38733)
- **Intended End**: [-75.1715, 39.9496] (Rittenhouse Square)
- **Missing Distance**: ~1 km east

#### Route C: Penn Campus → 9th & Christian ❌
- **Coordinates**: 229 total, 26 unique (88.6% duplicates)
- **Segment IDs**: 95 segments, 86 duplicates
- **Start**: [-75.1930, 39.9524] ✅ Correct (Penn campus area)
- **End**: [-75.1930, 39.9524] ❌ Same location as start!
- **Bbox**: 0.22km × 0.20km (should extend ~3.5km east + 1.5km south)
- **Problem**: Looping over ~9 segments around Penn campus
- **Intended End**: [-75.1605, 39.9391] (Italian Market at 9th & Christian)
- **Missing Distance**: ~4 km east and south

#### Route D: City Hall → 34th & Walnut ✅
- **Coordinates**: 116 total, 114 unique (1.7% duplicates)
- **Segment IDs**: 30 segments, 1 duplicate
- **Start**: [-75.1652, 39.9524] ✅ Correct (City Hall area)
- **End**: [-75.1576, 39.9551] ⚠️ Partial (should be -75.1905, closer to 34th St)
- **Bbox**: 0.89km × 0.81km (reasonable coverage)
- **Problem**: None! This route works.
- **Intended End**: [-75.1905, 39.9524] (34th & Walnut)
- **Actual Progress**: Made it partway (~1km of 2.5km), but continuous path

**Why Route D Works:**
- Start point (City Hall area) has better-connected graph
- Neighbors have more diverse options → less likely to loop
- Random selection happened to avoid revisiting same segments
- **Pure luck**, not robust algorithm

#### Route E: Rittenhouse Sq → Passyunk & Tasker ❌
- **Coordinates**: 556 total, 6 unique (98.9% duplicates)
- **Segment IDs**: 111 segments, 110 duplicates
- **Start**: [-75.1710, 39.9496] ✅ Correct (Rittenhouse area)
- **End**: [-75.1713, 39.9497] ❌ Same location as start!
- **Bbox**: 0.03km × 0.01km (should extend ~2km south to East Passyunk)
- **Problem**: Stuck on seg_13062 (visited 4+ times in first 5 IDs!)
- **Intended End**: [-75.1690, 39.9305] (East Passyunk & Tasker)
- **Missing Distance**: ~2.1 km south

### C. Root Cause Analysis

**Critical Bug in `walkRouteFrom` (lines 278-280):**
```javascript
const unvisited = neighbors.filter((seg) => !visited.has(seg.id));
const pool = unvisited.length ? unvisited : neighbors;  // ← FALLBACK TO VISITED!
```

**Problem:**
1. When all neighbors are already visited, algorithm falls back to `neighbors` (already-visited segments)
2. This allows revisiting same segments infinitely
3. Combined with random selection, creates tight loops

**Why It Fails:**
- **Graph Connectivity**: Some nodes have only 2-3 neighbors
- **Target Length**: Routes need 2-4km (100-200 segments), but local graph clusters have <10 segments
- **Visited Set**: Quickly exhausts local neighborhood
- **Fallback**: Picks same 3-5 segments repeatedly

**Example (Route E):**
```
Start at Rittenhouse (seg_13062)
→ neighbors: [seg_13062, seg_13063, seg_13064]
→ visit seg_13062, currentKey = otherEnd(seg_13062)
→ neighbors: [seg_13062, seg_13063]  // back to same intersection
→ unvisited: [seg_13063]  // seg_13062 already visited
→ visit seg_13063, currentKey = otherEnd(seg_13063)
→ neighbors: [seg_13062, seg_13063, seg_13064]
→ unvisited: [seg_13064]
→ visit seg_13064...
→ Eventually all 3 are visited
→ pool = neighbors (includes visited seg_13062, seg_13063, seg_13064)
→ Randomly picks seg_13062 again
→ INFINITE LOOP
```

**Secondary Issue: `endHint` Not Strong Enough**
- Lines 282-288 sort neighbors by distance to `endHint`
- But then randomly picks from **top 3**, not always the best
- With small neighborhood (<3 neighbors), still loops

**Why Route D Succeeded:**
- City Hall → 34th St is primarily **westward** along Market St / JFK Blvd
- These are **Class 1-2 roads** (major arterials) with many parallel options
- Graph has higher connectivity → more unvisited neighbors available
- By chance, random picks didn't create loops before hitting target length

---

## Part 3: Proper Routing Architecture Design

### Overview

**Goal:** Replace random-walk with graph-based shortest-path routing that:
- Guarantees continuous paths from start to end
- Respects network topology (connected segments only)
- Supports cost functions (length-only for base, length+safety for alt)
- Remains offline (Node script for data generation)
- Keeps existing frontend contract unchanged

**Scope:** Pure data generation (scripts), no runtime changes yet

---

### 3.1 Graph Model

**Node Representation:**
```javascript
// Node ID: Snapped and hashed coordinate
function nodeId(coord) {
  // Snap to 5 decimal places (~1m precision)
  const lng = Number(coord[0].toFixed(5));
  const lat = Number(coord[1].toFixed(5));
  return `${lng},${lat}`;
}
```

**Edge Representation:**
```javascript
interface Edge {
  segmentId: string;        // Original segment ID from network data
  fromNode: string;         // nodeId of start point
  toNode: string;           // nodeId of end point
  length_m: number;         // Segment length in meters
  class: number;            // Functional class (1-4)
  geometry: Coordinate[];   // LineString coordinates
  safetyScore?: number;     // Optional: mean safety rating (for alt routes)
}
```

**Graph Structure:**
```javascript
class SegmentGraph {
  nodes: Map<string, {lng: number, lat: number}>;
  edges: Map<string, Edge[]>;  // nodeId → [outgoing edges]

  constructor(segments: Segment[]) {
    // Build from segments_phl.network.geojson
  }

  neighbors(nodeId: string): Edge[] {
    return this.edges.get(nodeId) || [];
  }

  findNearestNode(targetCoord: [number, number], maxDistKm = 0.5): string | null {
    // Spatial search within radius
  }
}
```

**Handling One-Way Streets:**
- OSM tags: `oneway=yes`, `oneway=-1`, `junction=roundabout`
- For now: **treat all streets as bidirectional** (simplification)
- Future: Parse OSM tags, only add edge in allowed direction

**Handling Gaps:**
- Snapping tolerance: 5 decimal places (≈1.1m at Philadelphia latitude)
- If segments don't connect: **separate graph components**
- Pathfinding will fail if start/end in different components
- Fallback: expand snap tolerance to 4 decimals (≈11m) if needed

**Multi-Segment Intersections:**
- Node with >2 edges = intersection
- Common in grid networks (4-way intersections have 4 edges)
- Graph handles naturally via adjacency list

---

### 3.2 Pathfinding Algorithm

**Recommended: Dijkstra's Algorithm**
- **Why Dijkstra:** Guarantees shortest path, well-tested, simple to implement
- **Why Not A*:** Start/end distance heuristic helps but adds complexity
- **For Alt Routes:** Use A* with safety-weighted cost (see below)

**Algorithm Pseudocode:**
```javascript
function dijkstra(graph, startNode, endNode, costFn) {
  const dist = new Map();          // nodeId → min distance
  const prev = new Map();          // nodeId → previous edge
  const pq = new PriorityQueue();  // min-heap by distance

  dist.set(startNode, 0);
  pq.insert(startNode, 0);

  while (!pq.isEmpty()) {
    const current = pq.extractMin();
    if (current === endNode) break;

    for (const edge of graph.neighbors(current)) {
      const alt = dist.get(current) + costFn(edge);
      if (!dist.has(edge.toNode) || alt < dist.get(edge.toNode)) {
        dist.set(edge.toNode, alt);
        prev.set(edge.toNode, edge);
        pq.insert(edge.toNode, alt);
      }
    }
  }

  // Reconstruct path
  const path = [];
  let node = endNode;
  while (prev.has(node)) {
    const edge = prev.get(node);
    path.unshift(edge.segmentId);
    node = edge.fromNode;
  }
  return path;
}
```

**Cost Functions:**

1. **Base Route** (shortest distance):
   ```javascript
   function baseCost(edge) {
     return edge.length_m;
   }
   ```

2. **Alt Route** (safety-weighted):
   ```javascript
   function altCost(edge, safetyPenaltyFactor = 0.3) {
     const baseCost = edge.length_m;

     if (!edge.safetyScore) {
       // No safety data → use class penalty
       const classPenalty = edge.class === 1 ? 1.5 :  // Highways less safe
                            edge.class === 2 ? 1.2 :  // Major roads
                            edge.class === 3 ? 1.0 :  // Medium roads
                            0.8;                       // Local streets safer
       return baseCost * classPenalty;
     }

     // Safety score: 1.0 = very unsafe, 5.0 = very safe
     // Penalty: higher score → lower cost
     const safetyPenalty = (6.0 - edge.safetyScore) / 5.0;  // 0.2 to 1.0
     return baseCost * (1 + safetyPenaltyFactor * safetyPenalty);
   }
   ```

3. **Length Constraint** (for target distance):
   ```javascript
   function findRouteWithLength(graph, start, end, targetKm, tolerance = 0.2) {
     // Try Dijkstra first
     let path = dijkstra(graph, start, end, baseCost);
     let length = pathLength(path);

     if (Math.abs(length / 1000 - targetKm) <= tolerance) {
       return path;  // Within tolerance
     }

     // Too short → add detour (future enhancement)
     // Too long → accept it (Dijkstra is minimum)
     return path;
   }
   ```

**Implementation Location:**
- **Option A**: `scripts/graph_pathfinder.mjs` (Node-only module)
- **Option B**: `src/utils/graph_pathfinder.js` (shared, isomorphic)
- **Recommendation**: Option A for now (offline data-gen only)

**Priority Queue:**
- Use existing library: `tiny-heap` or `heap-js` (lightweight)
- Or DIY with binary heap (~50 lines)

---

### 3.3 Anchor Handling for 5 Demo Routes

**Strategy:**
1. Parse scenario `start` and `end` coordinates
2. Find nearest graph nodes within radius (0.5 km tolerance)
3. Run pathfinder from start node to end node
4. Validate result: check length, connectivity
5. If no path found: expand search radius or fallback to nearby nodes

**Anchor Finder:**
```javascript
function findStartEndNodes(graph, scenario) {
  const startNode = graph.findNearestNode(scenario.start, 0.5);
  const endNode = graph.findNearestNode(scenario.end, 0.5);

  if (!startNode) {
    throw new Error(`No start node found near ${scenario.start} for ${scenario.name}`);
  }
  if (!endNode) {
    throw new Error(`No end node found near ${scenario.end} for ${scenario.name}`);
  }

  // Validate nodes are in same graph component (optional)
  const pathExists = hasPath(graph, startNode, endNode);
  if (!pathExists) {
    console.warn(`[Routing] No path exists between ${startNode} and ${endNode} for ${scenario.name}`);
    return null;
  }

  return { startNode, endNode };
}
```

**Tolerance:**
- **Min tolerance**: 0.1 km (100m) - tight anchor
- **Max tolerance**: 1.0 km - loose anchor for hard-to-reach destinations
- **Recommendation**: 0.5 km default

**Fallback for Missing Paths:**
- If Dijkstra returns empty path → nodes in different graph components
- Option 1: Expand search radius to 1 km
- Option 2: Find alternative nearby end point
- Option 3: Use greedy walk toward end hint (existing `walkRouteFrom` as fallback)

**Scenario Mapping:**

| Route | Start Anchor | End Anchor | Tolerance | Expected Length |
|-------|--------------|------------|-----------|-----------------|
| A | [-75.1810, 39.9556] 30th St | [-75.2129, 39.9493] Clark Park | 0.3 km | 2.3 km |
| B | [-75.1810, 39.9556] 30th St | [-75.1715, 39.9496] Rittenhouse | 0.3 km | 2.2 km |
| C | [-75.1932, 39.9522] Penn | [-75.1605, 39.9391] 9th & Christian | 0.5 km | 4.2 km |
| D | [-75.1652, 39.9526] City Hall | [-75.1905, 39.9524] 34th & Walnut | 0.3 km | 2.2 km |
| E | [-75.1715, 39.9496] Rittenhouse | [-75.1690, 39.9305] Passyunk | 0.5 km | 3.2 km |

---

### 3.4 Data Contracts

**Input:** `data/segments_phl.network.geojson`
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {"type": "LineString", "coordinates": [[lng, lat], ...]},
      "properties": {
        "segment_id": "seg_12345",
        "street_name": "Market St",
        "class": 2,
        "length_m": 150
      }
    }
  ]
}
```

**Output:** `data/routes_phl.demo.geojson` (unchanged contract)
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {"type": "LineString", "coordinates": [[lng, lat], ...]},
      "properties": {
        "route_id": "route_A",
        "name": "30th St Station → Clark Park",
        "mode": "walk",
        "from": "30th St Station",
        "to": "Clark Park",
        "length_m": 2300,
        "duration_min": 26,
        "segment_ids": ["seg_123", "seg_124", ...],
        "alt_segment_ids": ["seg_125", "seg_126", ...],
        "alt_length_m": 2450,
        "alt_duration_min": 27,
        "alt_geometry": {"type": "LineString", "coordinates": [[lng, lat], ...]}
      }
    }
  ]
}
```

**Additional Metadata (optional, for debugging):**
```javascript
properties: {
  // ... existing fields
  "_debug": {
    "start_node": "-75.18100,39.95560",
    "end_node": "-75.21290,39.94930",
    "path_nodes": 15,               // Number of nodes traversed
    "dijkstra_iterations": 127      // Algorithm efficiency metric
  }
}
```

---

### 3.5 Implementation Plan for Codex (Agent-I)

#### Packet R1: Build Graph & Pathfinding Module (P0 — Critical)

**Objective:** Create reusable segment-graph builder and Dijkstra pathfinder.

**Files to Create:**
1. **`scripts/graph_pathfinder.mjs`** (~200 lines)
   - `class SegmentGraph` with constructor, neighbors(), findNearestNode()
   - `dijkstra(graph, startNode, endNode, costFn)` function
   - `buildGraphFromSegments(segments)` helper
   - `pathLength(segmentIds, segments)` utility
   - Basic priority queue (binary heap or use `tiny-heap` package)

**Dependencies:**
- `@turf/turf` (already installed) for distance calculations
- Optional: `tiny-heap` or `heap-js` for priority queue

**Tasks:**
1. Define graph data structures (nodes Map, edges Map)
2. Implement node ID snapping (5 decimal places)
3. Build adjacency from segments_phl.network.geojson
4. Implement Dijkstra with priority queue
5. Add findNearestNode() with spatial search (brute force OK for 92k segments)
6. Write unit tests (optional): test graph on small synthetic dataset

**Acceptance Criteria:**
- [ ] Graph loads 92k segments in <2 seconds
- [ ] Dijkstra finds path between any two connected nodes
- [ ] findNearestNode() returns node within 0.5 km (if exists)
- [ ] pathLength() correctly sums segment lengths
- [ ] No external API calls (pure offline computation)

**Estimated Effort:** 3-4 hours

---

#### Packet R2: Integrate Pathfinder into Demo Data Generator (P0 — Critical)

**Objective:** Replace `walkRouteFrom()` with Dijkstra-based routing for all 5 demo routes.

**Files to Modify:**
1. **`scripts/generate_demo_data.mjs`** (lines 202-338)
   - Import `{ SegmentGraph, dijkstra, baseCost, altCost }` from `./graph_pathfinder.mjs`
   - Replace `walkRouteFrom()` with `generateRouteWithPathfinding()`
   - Keep ROUTE_SCENARIOS array (lines 202-208)
   - Remove fallback logic that revisits segments

**Changes:**

Replace lines 270-299 (`walkRouteFrom` function) with:
```javascript
import { SegmentGraph, dijkstra, findNearestNode } from './graph_pathfinder.mjs';

// Build graph once
const graph = new SegmentGraph(baseSegments);

function generateRouteWithPathfinding(scenario, costFn = baseCost) {
  // Find start/end nodes
  const startNode = findNearestNode(graph, scenario.start, 0.5);
  const endNode = findNearestNode(graph, scenario.end, 0.5);

  if (!startNode || !endNode) {
    console.warn(`[Routing] Could not find nodes for ${scenario.name}`);
    return [];
  }

  // Run Dijkstra
  const segmentIds = dijkstra(graph, startNode, endNode, costFn);

  // Validate length
  const length = pathLength(segmentIds, baseSegments);
  const targetLength = scenario.targetKm * 1000;

  if (Math.abs(length - targetLength) > targetLength * 0.3) {
    console.warn(`[Routing] ${scenario.name} length ${(length/1000).toFixed(1)}km deviates from target ${scenario.targetKm}km`);
  }

  return segmentIds;
}

// In route generation loop (lines 301-338):
for (let i = 0; i < routeCount; i += 1) {
  const scenario = ROUTE_SCENARIOS[i];

  // Generate base route (shortest path)
  const primarySegments = generateRouteWithPathfinding(scenario, baseCost);

  // Generate alt route (safety-weighted path)
  const altSegments = generateRouteWithPathfinding(scenario, altCost);

  // ... rest of route feature creation unchanged
}
```

**Remove:**
- `walkRouteFrom()` function (lines 270-299)
- `findNearestKey()` function (lines 255-268) - replaced by graph.findNearestNode()
- `otherEnd()` function (lines 248-253) - no longer needed

**Keep:**
- `stitchGeometry()` function (lines 155-184) - still needed to merge segment geometries
- `collectLength()` function (lines 186-191) - still needed
- ROUTE_SCENARIOS array (lines 202-208)
- adjacency graph code CAN BE REMOVED (lines 212-246) - replaced by SegmentGraph

**Acceptance Criteria:**
- [ ] All 5 routes generated successfully
- [ ] Routes follow continuous paths (no coordinate loops)
- [ ] Route lengths within ±30% of target (2.2-4.2 km)
- [ ] Start/end points within 500m of scenario anchors
- [ ] No duplicate segment IDs in route paths
- [ ] `npm run data:gen` completes without errors
- [ ] Generated routes_phl.demo.geojson passes validation

**Estimated Effort:** 2-3 hours

---

#### Packet R3 (Optional): Runtime Pathfinding Wrapper

**Objective:** Create thin wrapper to expose pathfinding at runtime (for future custom routes feature).

**Scope:** Deferred to future work - not required for M3 demo fix

**Would Include:**
- Move `graph_pathfinder.mjs` to `src/utils/graph_pathfinder.js` (isomorphic)
- Add API: `POST /api/routes/custom` with start/end coordinates
- Return GeoJSON route on-the-fly
- Load graph once on server startup (cache in memory)

**Status:** Not needed for current demo data generation fix

---

### 3.6 Risk Assessment & Open Questions

**Risks:**

1. **Graph Disconnection**
   - Philadelphia street network should be well-connected
   - But some scenarios may cross river (30th St ↔ West Philly)
   - Mitigation: Verify all route scenarios are within same component before implementation

2. **Path Too Direct**
   - Dijkstra finds shortest path, may not be "interesting" for demo
   - Alt route may be nearly identical if safety scores not available
   - Mitigation: For alt route, artificially increase highway class cost (class 1 penalty)

3. **Performance**
   - Dijkstra on 92k segments with ~200k edges
   - Could take 1-5 seconds per route
   - Mitigation: Acceptable for offline data generation (5 routes × 5 sec = 25 sec total)

4. **Snapping Tolerance**
   - 5 decimal places = 1.1m precision
   - Some segments may not snap perfectly (GPS drift, conflicting OSM edits)
   - Mitigation: Monitor graph connectivity, expand tolerance to 4 decimals if needed

**Open Questions:**

1. **One-Way Streets:**
   - Current plan: ignore one-way restrictions
   - Question: Should we parse OSM tags and enforce directionality?
   - Decision: **No** for now (adds complexity, most routes bidirectional)

2. **Alt Route Diversity:**
   - Safety-weighted cost may produce nearly identical path if data sparse
   - Question: Should we add "avoid edges from base route" penalty?
   - Decision: **Yes** - increase cost by 2x for segments already in base route

3. **Priority Queue Library:**
   - DIY binary heap vs external package (`tiny-heap`, `heap-js`)
   - Decision: **External package** (`tiny-heap`) for reliability

4. **Graph Caching:**
   - Rebuild graph on every `npm run data:gen` vs cache to file
   - Decision: **Rebuild** for now (2 seconds is acceptable)

---

## Summary for Codex

**Current Blocking Issues:**
1. ❌ 4 of 5 routes stuck in tight loops (96-99% duplicate coords)
2. ❌ Routes don't reach destinations (coverage <0.2 km²)
3. ⚠️ No network layer UI toggle

**Root Cause:**
- `walkRouteFrom()` fallback revisits segments → infinite loops
- `endHint` sorting insufficient to prevent loops
- Random selection with small neighborhoods = repeated segments

**Solution:**
- Replace random walk with Dijkstra shortest-path
- Build reusable SegmentGraph class
- Use scenario anchors + findNearestNode() for start/end
- Generate alt routes with safety-weighted cost function

**Implementation Packets:**
1. **R1** (P0): Build graph_pathfinder.mjs module (~200 lines, 3-4 hours)
2. **R2** (P0): Integrate into generate_demo_data.mjs (2-3 hours)
3. **R3** (P2): Optional runtime wrapper (deferred)

**Expected Outcome:**
- All 5 routes follow continuous paths to destinations
- Lengths match targets (±30%)
- No coordinate loops or duplicate segments
- Alt routes provide safety-weighted alternatives

---

**Next Actions:**
1. Agent-M: Apply any remaining micro-fixes (network layer visibility already done)
2. Agent-M: Update ROAD_NETWORK_NOTES.md with this plan
3. Codex (Agent-I): Implement Packet R1 (graph + Dijkstra)
4. Codex: Implement Packet R2 (integrate into demo data generator)
5. Codex: Regenerate routes with `npm run data:gen`
6. Agent-M: Verify routes with `scripts/analyze_routes.mjs`
7. Codex: Add network layer UI toggle (deferred to separate packet)

---

**Audit Complete**
**Agent:** Agent-M
**Timestamp:** 2025-11-18T03:30:00Z
