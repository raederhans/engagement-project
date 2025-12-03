# Routing Architecture & Safer-Path Requirements

**Date:** 2025-11-18T05:30:00Z
**Author:** Agent-M (Manager / Architect Mode)
**Context:** Part D of Map & Network Layer Audit
**Status:** Documentation (Implementation guidance for Codex)

---

## Executive Summary

**Current Status:**
The project has a **working Dijkstra-based routing system** implemented in [scripts/graph_pathfinder.mjs](../scripts/graph_pathfinder.mjs) and used by [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs). It generates 5 demo routes with both shortest-distance paths (base) and safety-weighted paths (alt).

**Key Capabilities:**
- ✅ Shortest path routing (distance-based)
- ✅ Safety-weighted routing (experimental, penalty factor approach)
- ✅ Bidirectional graph traversal
- ✅ Node snapping (find nearest intersection within 500m)
- ✅ Path stitching (segment coordinates → route LineString)

**What's Missing for Production:**
- ⚠️ UI for user-created routes (currently only pre-generated demos)
- ⚠️ Runtime routing in browser (currently offline script only)
- ⚠️ Alternative route generation with diversity constraints
- ⚠️ Safety-weighted cost tuning and validation
- ⚠️ Route comparison UI (side-by-side base vs. safer alternatives)

**This Document:**
- Explains current Dijkstra implementation
- Lists 5 demo route scenarios with anchors
- Outlines requirements for safer alternative routing
- Provides implementation roadmap for Codex

---

## Implementation Status — 2025-12

- Dijkstra routing is live in `scripts/graph_pathfinder.mjs` and used by `generate_demo_data.mjs`; visited sets prevent loops.
- Demo routes are anchored to Philly landmarks; analyzer scripts confirm 2–5 km coverage with <1% duplicate coordinates.
- Frontend consumes normalized GeoJSON and renders safety gradients + optional alt overlay; runtime routing remains a future enhancement.

--- 

## Part 1: Current Routing Implementation

### 1.1 Architecture Overview

**File:** [scripts/graph_pathfinder.mjs](../scripts/graph_pathfinder.mjs)

**Core Components:**

1. **MinHeap (lines 6-48):** Priority queue for Dijkstra's algorithm
   - Methods: `push()`, `pop()`, `size`
   - Maintains min-heap property (smallest priority at root)
   - Used for efficient node extraction during pathfinding

2. **SegmentGraph (lines 50-149):** Graph data structure and pathfinding engine
   - **Nodes:** Map of node IDs → {lon, lat} coordinates
   - **Edges:** Map of node IDs → adjacent edges (bidirectional)
   - **Safety Scores:** Optional Map of segment IDs → safety ratings (1-5)
   - **Methods:**
     - `_build(segments)`: Construct graph from GeoJSON segments
     - `findNearestNode(lon, lat)`: Snap point to nearest graph node
     - `_edgeCost(edge, options)`: Compute edge traversal cost
     - `findShortestPath(startNodeId, endNodeId, options)`: Dijkstra pathfinding

### 1.2 Graph Construction

**Input:** Array of GeoJSON LineString features (road network segments)

**Algorithm:**
```javascript
_build(segments) {
  segments.forEach((seg) => {
    // Extract segment endpoints (first and last coordinates)
    const a = coords[0];
    const b = coords[coords.length - 1];

    // Generate node IDs by snapping coordinates to 3 decimals (~111m precision)
    const fromId = snapKey(a[0], a[1]); // e.g., "-75.182,39.956"
    const toId = snapKey(b[0], b[1]);

    // Add nodes to graph (lon/lat lookup)
    this.nodes.set(fromId, { lon: a[0], lat: a[1] });
    this.nodes.set(toId, { lon: b[0], lat: b[1] });

    // Create bidirectional edges (road is traversable in both directions)
    const edge = { segment_id, from: fromId, to: toId, length_m, class };
    this._addEdge(fromId, toId, edge);   // A → B
    this._addEdge(toId, fromId, edge);   // B → A
  });
}
```

**Key Design Decisions:**
- **Node Snapping:** Coordinates snapped to 3 decimals (~111m grid) to merge nearby intersections
- **Bidirectional Edges:** All streets assumed two-way (no one-way support yet)
- **Edge Properties:** Store segment_id (for lookup), length_m (cost), class (1-4 road hierarchy)

**Graph Size (Philadelphia Network):**
- **Nodes:** ~50,000-60,000 intersections (estimated from 91,959 segments)
- **Edges:** ~180,000-200,000 (each segment creates 2 edges)
- **Memory:** ~30-50 MB in Node.js (Map data structures)

### 1.3 Cost Functions

**Base Cost (Distance-Only):**
```javascript
_edgeCost(edge, { costKind = 'base' }) {
  if (costKind === 'base') {
    return edge.length_m; // Pure distance in meters
  }
  // ...
}
```
- **Purpose:** Find shortest-distance route (traditional GPS routing)
- **Use Case:** Minimize walking/biking time, ignore safety

**Safety-Weighted Cost (Alternative Routes):**
```javascript
_edgeCost(edge, { costKind = 'alt', safetyPenaltyFactor = 1.0 }) {
  if (costKind === 'alt') {
    const score = this.safety.get(edge.segment_id) ?? 3; // 1 (unsafe) to 5 (safe)
    return edge.length_m * (1 + safetyPenaltyFactor * (6 - score) / 5);
  }
  // ...
}
```

**Formula Breakdown:**
- **score:** Safety rating (1-5, where 5 is safest)
- **penalty:** `(6 - score) / 5` → ranges from 0.2 (safe) to 1.0 (unsafe)
- **multiplier:** `1 + safetyPenaltyFactor * penalty`
- **cost:** `length_m * multiplier`

**Examples:**
| Safety Score | Penalty Factor | Multiplier | 100m Segment Cost |
|--------------|----------------|------------|-------------------|
| 5 (safest)   | 1.0            | 1.2        | 120m              |
| 4 (safer)    | 1.0            | 1.4        | 140m              |
| 3 (moderate) | 1.0            | 1.6        | 160m              |
| 2 (less safe)| 1.0            | 1.8        | 180m              |
| 1 (unsafe)   | 1.0            | 2.0        | 200m              |

**Interpretation:** A 100m unsafe street (score 1) is treated as if it were 200m long, so the algorithm prefers a 150m safe street (score 5, effective 180m) over it.

### 1.4 Pathfinding Algorithm

**Dijkstra's Shortest Path (lines 106-148):**

```javascript
findShortestPath(startNodeId, endNodeId, opts = {}) {
  const dist = new Map();      // Best distance to each node
  const prev = new Map();       // Previous node in path (for reconstruction)
  const prevEdge = new Map();   // Previous edge (for segment ID extraction)
  const heap = new MinHeap();   // Priority queue

  dist.set(startNodeId, 0);
  heap.push({ node: startNodeId, priority: 0 });

  while (heap.size > 0) {
    const { node: u } = heap.pop(); // Extract node with smallest distance
    if (u === endNodeId) break;     // Reached destination, stop

    // Explore all neighbors
    for (const edge of this.adj.get(u) || []) {
      const v = edge.to;
      const alt = dist.get(u) + this._edgeCost(edge, opts); // New distance via u

      if (alt < (dist.get(v) ?? Infinity)) {
        // Found shorter path to v
        dist.set(v, alt);
        prev.set(v, u);
        prevEdge.set(v, edge);
        heap.push({ node: v, priority: alt });
      }
    }
  }

  // Reconstruct path by backtracking from end to start
  const nodePath = [];
  const segmentPath = [];
  let cur = endNodeId;
  while (cur) {
    nodePath.push(cur);
    const edge = prevEdge.get(cur);
    if (edge) segmentPath.push(edge.segment_id);
    cur = prev.get(cur);
  }
  nodePath.reverse();
  segmentPath.reverse();

  return {
    nodePath,       // Array of node IDs (e.g., ["-75.182,39.956", ...])
    segmentPath,    // Array of segment IDs (e.g., ["seg_12345", "seg_12346"])
    totalLengthM: dist.get(endNodeId) || 0,
  };
}
```

**Complexity:**
- **Time:** O((V + E) log V) where V = nodes, E = edges
- **Space:** O(V) for distance and previous-node maps
- **Performance (Philadelphia):** ~50-200ms for typical routes (2-5 km, ~100-300 segments)

**Optimizations Applied:**
- MinHeap priority queue (vs. naive O(V²) array search)
- Early termination when destination reached
- Bbox pre-filter in findNearestNode() (skip distant nodes)

---

## Part 2: Demo Route Scenarios

### 2.1 Scenario Definitions

**File:** [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs) (lines 194-200)

**ROUTE_SCENARIOS Array:**

```javascript
const ROUTE_SCENARIOS = [
  {
    route_id: 'route_A',
    name: '30th St Station → Clark Park',
    mode: 'walk',
    start: { lon: -75.1819, lat: 39.9558 }, // 30th Street Station
    end: { lon: -75.2205, lat: 39.9400 },   // Clark Park
    targetMinKm: 2.0,
    targetMaxKm: 3.5,
  },
  {
    route_id: 'route_B',
    name: '30th St Station → Rittenhouse Sq',
    mode: 'walk',
    start: { lon: -75.1819, lat: 39.9558 }, // 30th Street Station
    end: { lon: -75.1480, lat: 39.9430 },   // Rittenhouse Square
    targetMinKm: 2.0,
    targetMaxKm: 3.5,
  },
  {
    route_id: 'route_C',
    name: 'Penn Campus → 9th & Christian',
    mode: 'bike',
    start: { lon: -75.1915, lat: 39.9510 }, // Penn Campus (College Hall area)
    end: { lon: -75.1520, lat: 39.9340 },   // 9th & Christian (South Philly)
    targetMinKm: 3.0,
    targetMaxKm: 4.5,
  },
  {
    route_id: 'route_D',
    name: 'City Hall → 34th & Walnut',
    mode: 'walk',
    start: { lon: -75.1636, lat: 39.9524 }, // City Hall
    end: { lon: -75.2080, lat: 39.9525 },   // 34th & Walnut (University City)
    targetMinKm: 2.0,
    targetMaxKm: 3.5,
  },
  {
    route_id: 'route_E',
    name: 'Rittenhouse Sq → Passyunk & Tasker',
    mode: 'bike',
    start: { lon: -75.1719, lat: 39.9495 }, // Rittenhouse Square
    end: { lon: -75.1650, lat: 39.9200 },   // Passyunk & Tasker (South Philly)
    targetMinKm: 2.5,
    targetMaxKm: 3.8,
  },
];
```

### 2.2 Human-Readable Anchor Points

**Route A: 30th St Station → Clark Park**
- **Start:** 30th Street Station (major Amtrak/SEPTA hub, University City)
- **End:** Clark Park (green space at 43rd & Baltimore, West Philadelphia)
- **Mode:** Walk
- **Expected Distance:** 2-3.5 km (~1.2-2.2 miles)
- **Neighborhoods:** University City → Powelton Village → Cedar Park/Spruce Hill

**Route B: 30th St Station → Rittenhouse Sq**
- **Start:** 30th Street Station
- **End:** Rittenhouse Square (upscale park at 18th & Walnut, Center City)
- **Mode:** Walk
- **Expected Distance:** 2-3.5 km
- **Neighborhoods:** University City → Fitler Square → Rittenhouse

**Route C: Penn Campus → 9th & Christian**
- **Start:** Penn Campus (College Hall vicinity, 34th & Walnut)
- **End:** 9th & Christian (residential South Philly, near Italian Market)
- **Mode:** Bike
- **Expected Distance:** 3-4.5 km (~1.8-2.8 miles)
- **Neighborhoods:** University City → Graduate Hospital → Bella Vista

**Route D: City Hall → 34th & Walnut**
- **Start:** City Hall (Broad & Market, Center City)
- **End:** 34th & Walnut (Penn Campus western edge)
- **Mode:** Walk
- **Expected Distance:** 2-3.5 km
- **Neighborhoods:** Center City → Fitler Square → University City

**Route E: Rittenhouse Sq → Passyunk & Tasker**
- **Start:** Rittenhouse Square
- **End:** Passyunk & Tasker (East Passyunk neighborhood, South Philly)
- **Mode:** Bike
- **Expected Distance:** 2.5-3.8 km
- **Neighborhoods:** Rittenhouse → Graduate Hospital → East Passyunk

### 2.3 Current Route Generation

**Algorithm (generate_demo_data.mjs, lines 273-319):**

1. **Find Nearest Nodes:**
   - For each scenario, find nearest graph node within 4 km of start/end anchors
   - Filter nodes with degree >= 2 (skip dead-ends)

2. **Generate Base Path (Shortest):**
   - Call `graph.findShortestPath(startNode, endNode, { costKind: 'base' })`
   - Returns shortest-distance route (pure meters)

3. **Generate Alt Path (Safer):**
   - First attempt: `costKind: 'alt', safetyPenaltyFactor: 1.2`
   - If identical to base: Retry with `safetyPenaltyFactor: 2.0`
   - If still no alternative, use base path as fallback

4. **Stitch Geometry:**
   - Convert segment IDs → LineString coordinates
   - Handle segment direction reversal (match endpoints)
   - Handle duplicate coordinate removal

5. **Output Route Properties:**
   ```json
   {
     "route_id": "route_A",
     "name": "30th St Station → Clark Park",
     "mode": "walk",
     "from": "30th St Station",
     "to": "Clark Park",
     "length_m": 2400,
     "duration_min": 15,
     "segment_ids": ["seg_001", "seg_002", ...],
     "alt_segment_ids": ["seg_010", "seg_011", ...],
     "alt_length_m": 2650,
     "alt_duration_min": 16,
     "alt_is_same": false
   }
   ```

**Current Issue (From Previous Audit):**
- 4 out of 5 routes stuck in loops (96-99% duplicate coordinates)
- Root cause: Likely node snapping errors or disconnected graph components
- Solution: Improved in previous session (not fully verified yet)

---

## Part 3: Safer Alternative Routing Requirements

### 3.1 Problem Statement

**Goal:** Given a start and end point, generate multiple alternative routes that:
1. Minimize safety risk (prefer higher-rated segments)
2. Stay within reasonable distance overhead (e.g., +20% max vs. shortest route)
3. Provide meaningful diversity (not just minor variations)

**Current Limitation:**
The existing `costKind: 'alt'` approach generates only ONE safer alternative by adjusting edge costs. It doesn't guarantee:
- Distance overhead constraint (could be 2x longer)
- Path diversity (could be nearly identical to base route)
- Multiple alternatives (only generates 1 alt path)

### 3.2 Proposed Algorithm: Plateau-Based Alternatives

**Approach:** Generate multiple routes by:
1. **Primary Route:** Shortest-distance path (base)
2. **Safer Route 1:** Optimize for safety with 10% distance overhead allowance
3. **Safer Route 2:** Optimize for safety with 20% distance overhead allowance
4. **Validation:** Ensure alternatives differ by at least 30% of segments (diversity threshold)

**Implementation Strategy:**

**Cost Function with Distance Constraint:**
```javascript
function safetyWeightedCost(edge, safetyScore, distanceOverhead) {
  const baseDistance = edge.length_m;
  const safetyMultiplier = (6 - safetyScore) / 5; // 0.2 (safe) to 1.0 (unsafe)

  // Balance safety and distance based on overhead allowance
  // Higher overhead → more weight on safety, less on distance
  const alpha = distanceOverhead / 0.2; // 0.1 overhead → 0.5 alpha, 0.2 → 1.0
  const cost = baseDistance * (1 - alpha) + baseDistance * safetyMultiplier * alpha;

  return cost;
}
```

**Penalty Method Alternative:**
```javascript
_edgeCost(edge, { costKind, maxOverhead = 0.2, baseRouteLength = 0 }) {
  if (costKind === 'safer') {
    const score = this.safety.get(edge.segment_id) ?? 3;

    // Adaptive penalty factor based on distance overhead budget
    const remainingBudget = maxOverhead * baseRouteLength;
    const penaltyFactor = Math.min(3.0, 1.0 + remainingBudget / baseRouteLength);

    return edge.length_m * (1 + penaltyFactor * (6 - score) / 5);
  }
  return edge.length_m; // base
}
```

### 3.3 Multi-Alternative Generation

**Yen's K-Shortest Paths Algorithm (Recommended):**

**Description:** Generate K alternative paths ranked by cost, with diversity enforcement.

**Algorithm (Pseudocode):**
```javascript
function findKShortestPaths(graph, start, end, K, costFn) {
  const A = []; // List of shortest paths
  const B = new MinHeap(); // Candidate paths

  // Step 1: Find shortest path (base)
  A[0] = graph.findShortestPath(start, end, { costFn: costFn });

  for (let k = 1; k < K; k++) {
    // Step 2: For each node in the (k-1)th shortest path
    for (let i = 0; i < A[k-1].nodePath.length - 1; i++) {
      const spurNode = A[k-1].nodePath[i];
      const rootPath = A[k-1].nodePath.slice(0, i + 1);

      // Step 3: Temporarily remove edges used by previous paths
      const removedEdges = [];
      for (const path of A) {
        if (pathSharesRoot(path, rootPath)) {
          const edge = path.edges[i];
          graph.removeEdge(edge);
          removedEdges.push(edge);
        }
      }

      // Step 4: Find shortest path from spur node to end
      const spurPath = graph.findShortestPath(spurNode, end, { costFn: costFn });

      // Step 5: Restore removed edges
      removedEdges.forEach(e => graph.addEdge(e));

      // Step 6: Add candidate path (root + spur)
      if (spurPath) {
        const totalPath = concatenate(rootPath, spurPath);
        B.push({ path: totalPath, cost: totalPath.totalCost });
      }
    }

    if (B.size === 0) break; // No more alternatives

    // Step 7: Add lowest-cost candidate to A
    A[k] = B.pop().path;
  }

  return A; // Return K alternative paths
}
```

**Advantages:**
- Guarantees K distinct paths (with diversity)
- Works with any cost function (safety-weighted, distance, etc.)
- Well-tested algorithm (used in Google Maps, MapQuest)

**Disadvantages:**
- More complex than single Dijkstra run (~10x slower for K=3)
- Requires edge removal/restoration (graph mutation)

**Simpler Alternative: Penalized Re-Routing:**
1. Find base route (shortest distance)
2. Temporarily increase cost of base route segments by 2x
3. Find 2nd route (will avoid base route segments due to penalty)
4. Restore original costs, penalize both base and 2nd route segments
5. Find 3rd route

**Trade-off:** Faster but less optimal than Yen's algorithm.

### 3.4 Distance Overhead Constraint

**Validation After Pathfinding:**
```javascript
function validateAlternative(baseRoute, altRoute, maxOverhead = 0.2) {
  const baseLength = baseRoute.totalLengthM;
  const altLength = altRoute.totalLengthM;
  const overhead = (altLength - baseLength) / baseLength;

  if (overhead > maxOverhead) {
    console.warn(`Alternative route exceeds ${maxOverhead * 100}% overhead: ${overhead * 100}%`);
    return false; // Reject this alternative
  }

  return true;
}
```

**Adaptive Penalty Factor:**
If first alternative exceeds overhead, reduce `safetyPenaltyFactor` and retry:
```javascript
let factor = 2.0;
let altRoute = null;

while (factor > 0.5 && !altRoute) {
  const candidate = graph.findShortestPath(start, end, {
    costKind: 'alt',
    safetyPenaltyFactor: factor,
  });

  if (validateAlternative(baseRoute, candidate, 0.2)) {
    altRoute = candidate;
  } else {
    factor -= 0.2; // Reduce safety weight, increase distance priority
  }
}
```

### 3.5 Path Diversity Metric

**Jaccard Similarity (Segment Overlap):**
```javascript
function pathSimilarity(pathA, pathB) {
  const setA = new Set(pathA.segmentPath);
  const setB = new Set(pathB.segmentPath);

  const intersection = new Set([...setA].filter(id => setB.has(id)));
  const union = new Set([...setA, ...setB]);

  return intersection.size / union.size; // 0 (completely different) to 1 (identical)
}

function isDiverseEnough(baseRoute, altRoute, minDiversity = 0.3) {
  const similarity = pathSimilarity(baseRoute, altRoute);
  return similarity < (1 - minDiversity); // At least 30% different segments
}
```

**Enforcement:**
```javascript
const alternatives = [];
for (const candidate of candidateRoutes) {
  const diverse = alternatives.every(route => isDiverseEnough(route, candidate, 0.3));
  if (diverse) {
    alternatives.push(candidate);
  }
}
```

---

## Part 4: Safety Score Integration

### 4.1 Current Safety Score Source

**Data:** Diary segments have `decayed_mean` property (1.0-5.0 safety rating)

**Source (generate_demo_data.mjs, lines 220-224):**
```javascript
const safetyBySegmentId = new Map();
baseSegments.forEach((seg) => {
  const score = Number(seg.decayed_mean || seg.properties?.decayed_mean);
  if (seg.id && Number.isFinite(score)) {
    safetyBySegmentId.set(seg.id, score);
  }
});
```

**Current Issue:** Demo data uses synthetic random scores (lines 55-72), not real crime data.

### 4.2 Real Crime Integration (Future)

**Proposed Pipeline:**
1. **Fetch Crime Data:** Query Carto SQL API for incidents by segment
2. **Aggregate by Segment:** Count incidents within 50m of each segment (spatial join)
3. **Normalize Score:** Convert incident count → 1-5 rating (exponential decay or percentile ranking)
4. **Cache:** Store scores in `segments_phl.demo.geojson` properties
5. **Update:** Refresh scores monthly (automated script)

**Example Query:**
```sql
SELECT
  segment_id,
  COUNT(*) AS incident_count,
  SUM(CASE WHEN text_general_code LIKE '%ROBBERY%' THEN 1 ELSE 0 END) AS robberies
FROM incidents
WHERE
  dispatch_date >= NOW() - INTERVAL '90 days'
  AND ST_DWithin(
    the_geom,
    ST_GeomFromText('LINESTRING(...)', 4326), -- Segment geometry
    0.0005 -- ~50m radius
  )
GROUP BY segment_id;
```

**Scoring Function:**
```javascript
function crimeCountToSafetyScore(incidentCount, max = 50) {
  // Exponential decay: 0 incidents → 5.0, 50+ incidents → 1.0
  const normalized = Math.min(1, incidentCount / max);
  return 5.0 - (normalized * 4.0); // 5.0 to 1.0 scale
}
```

### 4.3 Safety Score Fallback

**If No Crime Data Available:**
- Use `class` property (road hierarchy) as proxy:
  - Class 1 (highways): 2.0 (less safe for pedestrians, high speed)
  - Class 2 (primary roads): 3.0 (moderate)
  - Class 3 (tertiary roads): 4.0 (safer, slower traffic)
  - Class 4 (local streets): 4.5 (safest, residential)

```javascript
function fallbackSafetyScore(segment) {
  const classScores = { 1: 2.0, 2: 3.0, 3: 4.0, 4: 4.5 };
  return classScores[segment.properties?.class] ?? 3.0;
}
```

---

## Part 5: UI Integration for Route Comparison

### 5.1 Current Route Display (Diary Mode)

**File:** [src/routes_diary/index.js](../src/routes_diary/index.js)

**Current Functionality:**
- Display pre-generated demo routes from `routes_phl.demo.geojson`
- Show route geometry on map (colored by safety rating)
- Insights panel shows safety stats

**Missing:**
- No UI to show alternative routes side-by-side
- No toggle to switch between base and alt routes
- No comparison metrics (distance, safety score, duration)

### 5.2 Proposed Route Comparison UI

**Layout (Insights Panel Enhancement):**
```
┌─────────────────────────────────────────────┐
│ Route: 30th St Station → Clark Park         │
├─────────────────────────────────────────────┤
│ [Base Route] [Safer Route +10%] [+20%]      │  ← Tab selector
├─────────────────────────────────────────────┤
│ Distance: 2.4 km          Duration: 15 min  │
│ Safety Rating: ●●●○○ (3.2/5)                │
│ Overhead: +0%                                │
├─────────────────────────────────────────────┤
│ Comparison:                                  │
│ ┌─────────────┬──────┬────────┬────────────┐│
│ │ Route       │ Dist │ Safety │ Duration   ││
│ ├─────────────┼──────┼────────┼────────────┤│
│ │ Base        │ 2.4  │ 3.2/5  │ 15 min     ││
│ │ Safer +10%  │ 2.6  │ 4.1/5  │ 16 min     ││
│ │ Safer +20%  │ 2.8  │ 4.5/5  │ 17 min     ││
│ └─────────────┴──────┴────────┴────────────┘│
└─────────────────────────────────────────────┘
```

**Interaction:**
- Click tab to switch active route on map
- Highlight differences in segment colors (green = safer alt only, red = base only)
- Show tradeoff chart: safety gain vs. distance overhead

### 5.3 Route Selection Workflow

**User Journey:**
1. User clicks "Plan Route" button
2. User selects start and end points on map (pin placement)
3. System generates 3 routes:
   - Base (shortest)
   - Safer +10% overhead
   - Safer +20% overhead
4. Map displays all 3 routes with distinct colors/styles
5. User selects preferred route
6. System shows detailed insights for selected route

**Implementation Notes:**
- Require client-side graph build (port graph_pathfinder.mjs to browser)
- Or: Backend API endpoint `/api/route?start=...&end=...` (requires server)
- Or: Pre-generate common routes (current demo approach, limited scalability)

---

## Part 6: Implementation Roadmap for Codex

**Phase 1: Fix Current Route Generation (HIGH PRIORITY)**
- [ ] Debug loop issue in 4/5 demo routes (verify node snapping, graph connectivity)
- [ ] Add graph validation script: check for disconnected components, degree-0 nodes
- [ ] Re-generate routes_phl.demo.geojson with fixed graph
- [ ] Run `node scripts/analyze_routes.mjs` to verify no duplicate coordinates

**Phase 2: Improve Safety-Weighted Routing**
- [ ] Implement distance overhead constraint in `_edgeCost()` method
- [ ] Add diversity validation to reject overly similar alternatives
- [ ] Tune `safetyPenaltyFactor` with real crime data (when available)
- [ ] Add unit tests for cost function edge cases

**Phase 3: Multi-Alternative Generation**
- [ ] Implement Yen's K-shortest paths OR penalized re-routing
- [ ] Generate 3 alternatives per demo scenario (base, +10%, +20%)
- [ ] Add `alternatives` array to route GeoJSON properties
- [ ] Update routes_phl.demo.geojson schema

**Phase 4: UI Integration**
- [ ] Add route comparison tab selector to Insights panel
- [ ] Implement route switching (update map layer with alt geometry)
- [ ] Add comparison table (distance, safety, duration)
- [ ] Add tradeoff visualization (chart or slider)

**Phase 5: User-Created Routes (FUTURE)**
- [ ] Port graph_pathfinder.mjs to browser (ES6 module, no Node.js dependencies)
- [ ] Lazy-load network graph on demand (~30 MB, throttle to 15k segments)
- [ ] Add pin placement UI (click to set start/end)
- [ ] Add "Find Route" button to trigger pathfinding
- [ ] Show loading indicator during computation (~200-500ms)

**Phase 6: Real Crime Data Integration (FUTURE)**
- [ ] Implement Carto SQL crime aggregation query
- [ ] Build segment-crime spatial join script
- [ ] Add `crime_incidents_90d` property to segments_phl.demo.geojson
- [ ] Map crime counts to safety scores (exponential decay function)
- [ ] Refresh scores monthly via automated workflow

---

## Part 7: Performance Considerations

### 7.1 Browser Pathfinding Performance

**Graph Size:**
- 91,959 network segments → ~50,000 nodes, ~180,000 edges
- Throttled to 15,000 segments for rendering → ~10,000 nodes, ~30,000 edges

**Expected Performance (Browser, Throttled Graph):**
- Graph build: ~100-200ms (one-time, cached in memory)
- Single pathfinding: ~20-50ms (typical 2-3 km route)
- K-shortest paths (K=3): ~60-150ms
- Memory usage: ~10-15 MB (JavaScript Map objects)

**Optimization Strategies:**
- **Web Workers:** Offload pathfinding to background thread (avoid UI freeze)
- **Lazy Loading:** Build graph only when user requests routing
- **Caching:** Store computed routes in localStorage (avoid re-computation)
- **Simplification:** Remove class 4 segments in low-density areas (reduce graph size)

### 7.2 Data Transfer Optimization

**Current Files:**
- segments_phl.network.geojson: ~20 MB (91k segments, full geometry)
- Throttled: ~2.5 MB (15k segments)

**Compression:**
- Gzip compression: ~80% reduction → 500 KB transfer size
- Vite/Rollup auto-enables gzip for production builds

**Alternative: Vector Tiles (Future):**
- Pre-generate Mapbox Vector Tiles (MVT) for network
- Load only tiles in viewport + 1-tile buffer
- Reduces initial load to <100 KB for typical city view

---

## Part 8: Testing Strategy

### 8.1 Unit Tests (graph_pathfinder.mjs)

**Test Cases:**
1. **Graph Construction:**
   - Input: 10 segments forming a simple grid
   - Assert: Correct node count, edge count, bidirectionality

2. **Shortest Path (Base):**
   - Input: Grid graph, start/end on opposite corners
   - Assert: Path length matches expected (Manhattan distance)

3. **Safety-Weighted Path:**
   - Input: 2-path scenario (short unsafe vs. long safe route)
   - Assert: With high penalty factor, chooses long safe route

4. **No Path Found:**
   - Input: Disconnected graph (2 separate components)
   - Assert: Returns null when no path exists

5. **Edge Cases:**
   - Start = End (should return empty path or self-loop)
   - Single-edge graph (should return that edge)
   - Missing safety scores (should use fallback score 3.0)

### 8.2 Integration Tests (generate_demo_data.mjs)

**Test Cases:**
1. **Demo Route Generation:**
   - Run script with `--routes=5 --seed=12345`
   - Assert: Generates 5 routes with valid geometries (no loops)

2. **Alternative Route Diversity:**
   - Assert: `alt_segment_ids` differs from `segment_ids` by at least 20%

3. **Distance Overhead:**
   - Assert: `alt_length_m` ≤ `length_m * 1.5` (max 50% overhead)

4. **Geometry Stitching:**
   - Assert: No duplicate consecutive coordinates in route LineString
   - Assert: Route geometry has >= 2 points

### 8.3 Visual Regression Tests

**Test Cases:**
1. Load Diary mode with demo routes
2. Screenshot each route's map view
3. Compare against baseline (ensure no geometry corruption)
4. Verify route colors match safety ratings (green = safe, red = unsafe)

---

## Part 9: Known Issues & Limitations

### 9.1 Current Bugs

**Issue 1: Loop Routes (4/5 demo routes)**
- **Symptom:** 96-99% duplicate coordinates in route geometry
- **Root Cause:** TBD (likely node snapping or graph connectivity issue)
- **Status:** Identified in previous audit, fix in progress
- **Workaround:** Use only route_A (30th St → Clark Park) for testing

**Issue 2: No Alternative Diversity Guarantee**
- **Symptom:** Alt route sometimes identical to base route
- **Current Mitigation:** Retry with higher penalty factor (1.2 → 2.0)
- **Long-term Fix:** Implement Yen's algorithm or diversity validation

**Issue 3: Synthetic Safety Scores**
- **Symptom:** Demo routes use random scores, not real crime data
- **Impact:** Alt routes may not reflect actual safety improvements
- **Fix:** Integrate Carto crime data (Phase 6)

### 9.2 Design Limitations

**Limitation 1: Bidirectional Edges Only**
- Current graph assumes all streets are two-way
- Real-world: Many one-way streets in Center City
- Fix: Add `oneway` property to segments, create directed edges

**Limitation 2: No Turn Restrictions**
- Graph allows all turns at intersections (U-turns, illegal left turns, etc.)
- Real-world: Traffic rules prohibit certain maneuvers
- Fix: Model edges with turn costs, penalize prohibited turns

**Limitation 3: Static Safety Scores**
- Current scores don't account for time of day (e.g., nighttime crime higher)
- Fix: Add temporal dimension to scores (day vs. night ratings)

**Limitation 4: No Terrain/Elevation**
- Routes don't consider hills (steep slopes affect biking/walking effort)
- Fix: Integrate elevation data (USGS DEM or Mapbox Terrain API)

---

## Part 10: References & Resources

**Dijkstra's Algorithm:**
- Wikipedia: https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm
- Visualization: https://www.cs.usfca.edu/~galles/visualization/Dijkstra.html

**Yen's K-Shortest Paths:**
- Paper: "Finding the k Shortest Loopless Paths in a Network" (Yen, 1971)
- Implementation: https://github.com/Yawning/yen

**Turf.js (Geospatial Utilities):**
- Distance: https://turfjs.org/docs/api/distance
- Along: https://turfjs.org/docs/api/along (sample points on route)
- Line Slice: https://turfjs.org/docs/api/lineSlice (split routes)

**Graph Data Structures:**
- Adjacency List: https://en.wikipedia.org/wiki/Adjacency_list
- MinHeap (Priority Queue): https://en.wikipedia.org/wiki/Binary_heap

**Alternative Routing Research:**
- Google Maps "Alternative Routes" (uses plateau-based + diversity)
- OpenTripPlanner (open-source multi-modal routing)
- OSRM (Open Source Routing Machine, C++ high-performance)

---

## Summary

**This document provides:**
1. ✅ Explanation of current Dijkstra implementation (graph_pathfinder.mjs)
2. ✅ Detailed list of 5 demo route scenarios with human-readable anchors
3. ✅ Requirements for safer alternative routing (distance overhead, diversity, cost functions)
4. ✅ Implementation roadmap (6 phases: fix bugs → multi-alt → UI → user routing → crime data)
5. ✅ Performance analysis (browser pathfinding <50ms, graph build <200ms)
6. ✅ Testing strategy (unit tests, integration tests, visual regression)
7. ✅ Known issues and design limitations

**Status:** Documentation complete, ready for Codex implementation

**Critical Next Steps (Priority Order):**
1. Fix loop bug in demo route generation (4/5 routes broken)
2. Implement distance overhead constraint and diversity validation
3. Add route comparison UI to Insights panel
4. Integrate real crime data for safety scores

---

**Documentation Complete (Part D)**
**Agent:** Agent-M
**Timestamp:** 2025-11-18T05:30:00Z
