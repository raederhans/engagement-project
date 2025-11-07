# Route Safety Diary - Algorithm Requirements (M1)

**Date:** 2025-11-07
**Purpose:** Mathematical specifications and implementation requirements for M1 algorithms
**Status:** Ready for implementation

---

## 1. GPS Map-Matching Algorithm

### Objective
Match a GPS trace (100-500 points) to street segments, returning an ordered list of segment IDs traversed by the user.

### Inputs
- `points`: Array of GPS coordinates `[{lat, lng, timestamp}, ...]`
- `segmentsGeoJSON`: FeatureCollection of LineString features with `segment_id` property
- `opts`:
  - `maxGapM`: Maximum gap between consecutive points on same segment (default: 50m)
  - `dirThreshold`: Minimum direction cosine for segment assignment (default: 0.7)
  - `snapBufferM`: Snap tolerance radius (default: 10m)

### Outputs
- Array of segment IDs: `['seg_001', 'seg_002', 'seg_003']`
- Ordered by traversal sequence
- Filtered: Only segments with ≥3 GPS points

### Algorithm Steps

1. **Spatial Index (Preprocessing)**
   ```javascript
   // Build R-tree or grid index for fast nearest-segment lookup
   // For M1: Linear search acceptable (3-10 segments)
   // For production: Use turf.featureCollection + spatial index
   ```

2. **For Each GPS Point:**
   ```javascript
   for (const point of points) {
     // a) Find nearest segment
     const nearest = findNearestSegment(point, segmentsGeoJSON, snapBufferM);

     // b) Check snap tolerance
     if (nearest.distance > snapBufferM) {
       // Point too far from any segment (noise or off-street)
       continue;
     }

     // c) Calculate direction cosine
     const userBearing = calculateBearing(prevPoint, point);
     const segmentBearing = getSegmentBearing(nearest.segment);
     const cosine = directionCosine(userBearing, segmentBearing);

     // d) Assign if direction matches
     if (cosine >= dirThreshold) {
       assignPointToSegment(point, nearest.segment);
     }
   }
   ```

3. **Group Consecutive Points by Segment:**
   ```javascript
   const segmentGroups = [];
   let currentGroup = { segment_id: null, points: [] };

   for (const assignment of assignments) {
     if (assignment.segment_id !== currentGroup.segment_id) {
       if (currentGroup.points.length >= 3) {
         segmentGroups.push(currentGroup);
       }
       currentGroup = { segment_id: assignment.segment_id, points: [assignment.point] };
     } else {
       currentGroup.points.push(assignment.point);
     }
   }

   // Push final group
   if (currentGroup.points.length >= 3) {
     segmentGroups.push(currentGroup);
   }
   ```

4. **Check Gaps Between Segments:**
   ```javascript
   // If gap between last point of segment A and first point of segment B > maxGapM,
   // they are not consecutive (user teleported or turned off GPS)
   const filtered = [];
   for (let i = 0; i < segmentGroups.length; i++) {
     if (i === 0) {
       filtered.push(segmentGroups[i]);
     } else {
       const gapDist = turf.distance(
         segmentGroups[i-1].points[segmentGroups[i-1].points.length-1],
         segmentGroups[i].points[0],
         { units: 'meters' }
       );
       if (gapDist <= maxGapM) {
         filtered.push(segmentGroups[i]);
       }
     }
   }
   ```

5. **Return Segment IDs:**
   ```javascript
   return filtered.map(group => group.segment_id);
   ```

### Helper Functions

**findNearestSegment(point, segments, maxDist)**
```javascript
import * as turf from '@turf/turf';

function findNearestSegment(point, segmentsGeoJSON, maxDist) {
  let nearest = null;
  let minDist = Infinity;

  for (const feature of segmentsGeoJSON.features) {
    const snapped = turf.nearestPointOnLine(feature, turf.point([point.lng, point.lat]));
    const dist = snapped.properties.dist * 1000; // Convert km to meters

    if (dist < minDist && dist <= maxDist) {
      minDist = dist;
      nearest = { segment: feature, distance: dist, snapped: snapped };
    }
  }

  return nearest;
}
```

**calculateBearing(pointA, pointB)**
```javascript
function calculateBearing(pointA, pointB) {
  if (!pointA || !pointB) return 0;
  return turf.bearing(
    turf.point([pointA.lng, pointA.lat]),
    turf.point([pointB.lng, pointB.lat])
  );
}
```

**getSegmentBearing(segment)**
```javascript
function getSegmentBearing(segment) {
  const coords = segment.geometry.coordinates;
  const start = turf.point(coords[0]);
  const end = turf.point(coords[coords.length - 1]);
  return turf.bearing(start, end);
}
```

**directionCosine(bearing1, bearing2)**
```javascript
function directionCosine(bearing1, bearing2) {
  // Convert bearings to radians
  const b1 = bearing1 * Math.PI / 180;
  const b2 = bearing2 * Math.PI / 180;

  // Unit vectors
  const v1 = [Math.cos(b1), Math.sin(b1)];
  const v2 = [Math.cos(b2), Math.sin(b2)];

  // Dot product
  return v1[0] * v2[0] + v1[1] * v2[1];
}
```

### Edge Cases

| Case | Handling |
|------|----------|
| **No segments within snap tolerance** | Skip point (noise or off-street) |
| **User doubles back** | Direction cosine will be negative → create new group |
| **GPS frozen (stationary)** | Multiple points on same segment, but only counts as 1 traversal |
| **Segment traversed twice** | Counted twice (valid for round trips) |
| **GPS jumps (tunnels)** | Gap check filters out discontinuous segments |

### Performance
- **Naive (M1):** O(n × m) where n = points, m = segments
  - 200 points × 10 segments = 2,000 operations (~1ms)
- **Optimized (Production):** O(n × log m) with R-tree spatial index
  - 200 points × log(25,000) ≈ 2,900 operations (~2ms)

---

## 2. Time-Decay & Bayesian Shrinkage

### Objective
Aggregate multiple ratings over time, giving more weight to recent ratings and shrinking toward a prior mean when sample size is small.

### Exponential Time-Decay

**Formula:**
```
weight_i = e^(-λ * days_ago_i)
λ = ln(2) / halfLifeDays
```

**Parameters:**
- `halfLifeDays`: Time for weight to decay to 50% (default: 90 days)
- Rating from 90 days ago has weight = 0.5
- Rating from 180 days ago has weight = 0.25
- Rating from today has weight = 1.0

**Implementation:**
```javascript
export function decayedMean(samples, now, halfLifeDays = 90) {
  const lambda = Math.log(2) / halfLifeDays;
  let weightedSum = 0;
  let weightSum = 0;

  for (const sample of samples) {
    const daysAgo = (now - sample.timestamp) / (1000 * 60 * 60 * 24);
    const weight = Math.exp(-lambda * daysAgo);
    weightedSum += sample.rating * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 3.0; // Fallback to prior
}
```

**Example:**
```javascript
const samples = [
  { rating: 4, timestamp: now - 0 * 86400000 },      // Today
  { rating: 3, timestamp: now - 30 * 86400000 },     // 30 days ago
  { rating: 2, timestamp: now - 90 * 86400000 },     // 90 days ago
  { rating: 5, timestamp: now - 180 * 86400000 }     // 180 days ago
];

const mean = decayedMean(samples, now, 90);
// weights: [1.0, 0.79, 0.5, 0.25]
// weighted_sum = 4*1.0 + 3*0.79 + 2*0.5 + 5*0.25 = 4 + 2.37 + 1 + 1.25 = 8.62
// weight_sum = 1.0 + 0.79 + 0.5 + 0.25 = 2.54
// mean = 8.62 / 2.54 ≈ 3.39
```

### Bayesian Shrinkage (James-Stein Estimator)

**Formula:**
```
shrunk_mean = (prior_mean × prior_N + observed_mean × observed_N) / (prior_N + observed_N)
```

**Parameters:**
- `prior_mean`: Global average rating (default: 3.0)
- `prior_N`: Prior strength (default: 5 "pseudo-samples")
- `observed_mean`: Segment's time-decayed mean
- `observed_N`: Segment's effective sample size (sum of weights)

**Purpose:**
- Prevent overconfidence from small samples
- Segment with 1 rating of 5 → shrinks toward 3.0
- Segment with 100 ratings of 5 → barely shrinks (high confidence)

**Implementation:**
```javascript
export function bayesianShrinkage(observedMean, observedN, priorMean = 3.0, priorN = 5) {
  const numerator = priorMean * priorN + observedMean * observedN;
  const denominator = priorN + observedN;
  return numerator / denominator;
}
```

**Example:**
```javascript
// New segment with 1 rating of 5.0
bayesianShrinkage(5.0, 1, 3.0, 5);
// = (3.0*5 + 5.0*1) / (5 + 1) = (15 + 5) / 6 = 3.33
// Heavily shrunk toward prior

// Established segment with 50 ratings, mean 4.5
bayesianShrinkage(4.5, 50, 3.0, 5);
// = (3.0*5 + 4.5*50) / (5 + 50) = (15 + 225) / 55 = 4.36
// Barely shrunk (high confidence)
```

### Effective Sample Size (n_eff)

**Formula:**
```
n_eff = Σ weight_i
```

**Purpose:**
- Represents "equivalent number of fresh ratings" after time-decay
- Used for confidence scoring (line width) and Bayesian shrinkage
- 10 ratings all from today: n_eff = 10
- 10 ratings all from 90 days ago: n_eff = 5 (each has weight 0.5)

**Implementation:**
```javascript
export function effectiveN(samples, now, halfLifeDays = 90) {
  const lambda = Math.log(2) / halfLifeDays;
  let weightSum = 0;

  for (const sample of samples) {
    const daysAgo = (now - sample.timestamp) / (1000 * 60 * 60 * 24);
    weightSum += Math.exp(-lambda * daysAgo);
  }

  return weightSum;
}
```

### Confidence Percentage

**Formula:**
```
confidence = Math.min(100, (n_eff / 50) * 100)
```

**Rationale:**
- n_eff = 50 is considered "very high confidence" (100%)
- n_eff = 25 is 50% confidence
- n_eff = 5 is 10% confidence (just above prior)

**Map to Line Width:**
```javascript
export function widthForNEff(n_eff) {
  const confidence = Math.min(100, (n_eff / 50) * 100);
  // Map 0-100% → 2-8px
  return 2 + (confidence / 100) * 6;
}
```

---

## 3. 30-Day Trend (Δ30d)

### Objective
Show whether a segment is improving, worsening, or stable over the last 30 days.

### Formula
```
Δ30d = mean(ratings in last 30 days) - mean(ratings 31-90 days ago)
```

**Interpretation:**
- **Positive Δ30d:** Segment improving (green up-arrow)
- **Negative Δ30d:** Segment worsening (red down-arrow)
- **Δ30d ≈ 0:** Segment stable (neutral dash)

**Implementation:**
```javascript
export function delta30d(samples, now) {
  const cutoff30d = now - 30 * 86400000; // 30 days in ms
  const cutoff90d = now - 90 * 86400000; // 90 days in ms

  const recent = samples.filter(s => s.timestamp >= cutoff30d);
  const older = samples.filter(s => s.timestamp < cutoff30d && s.timestamp >= cutoff90d);

  if (recent.length === 0 || older.length === 0) {
    return 0; // Insufficient data
  }

  const recentMean = recent.reduce((sum, s) => sum + s.rating, 0) / recent.length;
  const olderMean = older.reduce((sum, s) => sum + s.rating, 0) / older.length;

  return recentMean - olderMean;
}
```

**Example:**
```javascript
const samples = [
  { rating: 4, timestamp: now - 5 * 86400000 },   // 5 days ago
  { rating: 5, timestamp: now - 10 * 86400000 },  // 10 days ago
  { rating: 4, timestamp: now - 15 * 86400000 },  // 15 days ago
  { rating: 3, timestamp: now - 45 * 86400000 },  // 45 days ago
  { rating: 2, timestamp: now - 60 * 86400000 },  // 60 days ago
];

const trend = delta30d(samples, now);
// recent_mean = (4 + 5 + 4) / 3 = 4.33
// older_mean = (3 + 2) / 2 = 2.5
// trend = 4.33 - 2.5 = +1.83  → Improving!
```

**UI Display:**
```javascript
function trendIcon(delta) {
  if (delta > 0.2) return { icon: '↑', color: 'green', text: `+${delta.toFixed(1)}` };
  if (delta < -0.2) return { icon: '↓', color: 'red', text: delta.toFixed(1) };
  return { icon: '—', color: 'gray', text: '0.0' };
}
```

---

## 4. A* Pathfinding with Safety Penalties

### Objective
Find an alternative route between origin and destination that balances time (distance) and safety (segment ratings).

### Cost Function

**Formula:**
```
cost(segment) = length_m × (1 + penalty(rating))

penalty(rating) = (5 - rating) / 5

Examples:
  rating = 5 (safest)  → penalty = 0.0  → cost = length × 1.0
  rating = 4           → penalty = 0.2  → cost = length × 1.2
  rating = 3 (neutral) → penalty = 0.4  → cost = length × 1.4
  rating = 2           → penalty = 0.6  → cost = length × 1.6
  rating = 1 (unsafe)  → penalty = 0.8  → cost = length × 1.8
```

**Interpretation:**
- A 100m segment with rating 1 costs as much as 180m of rating-5 segment
- User will accept 20% longer distance to avoid rating-1 segments

### A* Algorithm

**Data Structures:**
```javascript
const openSet = new PriorityQueue(); // Min-heap ordered by f_score
const closedSet = new Set();         // Visited nodes
const cameFrom = new Map();          // Parent pointers for path reconstruction
const g_score = new Map();           // Cost from start to node
const f_score = new Map();           // g_score + heuristic
```

**Pseudocode:**
```javascript
function aStar(start, goal, segments, costFn) {
  // 1. Initialize
  g_score.set(start, 0);
  f_score.set(start, heuristic(start, goal));
  openSet.push(start, f_score.get(start));

  // 2. Main loop
  while (!openSet.isEmpty()) {
    const current = openSet.pop(); // Node with lowest f_score

    if (current === goal) {
      return reconstructPath(cameFrom, current);
    }

    closedSet.add(current);

    // 3. Explore neighbors
    for (const neighbor of getNeighbors(current, segments)) {
      if (closedSet.has(neighbor)) continue;

      const tentative_g = g_score.get(current) + costFn(getSegment(current, neighbor));

      if (!g_score.has(neighbor) || tentative_g < g_score.get(neighbor)) {
        cameFrom.set(neighbor, current);
        g_score.set(neighbor, tentative_g);
        f_score.set(neighbor, tentative_g + heuristic(neighbor, goal));

        if (!openSet.contains(neighbor)) {
          openSet.push(neighbor, f_score.get(neighbor));
        }
      }
    }
  }

  return null; // No path found
}
```

**Heuristic (Euclidean Distance):**
```javascript
function heuristic(nodeA, nodeB) {
  return turf.distance(
    turf.point(nodeA),
    turf.point(nodeB),
    { units: 'meters' }
  );
}
```

**Path Reconstruction:**
```javascript
function reconstructPath(cameFrom, current) {
  const path = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    path.unshift(current);
  }
  return path;
}
```

### Alternative Route Criteria

Only show "Safer alternative" if:
1. **Alternative exists:** A* found a path
2. **Safety gain:** `alt_avg_rating - direct_avg_rating > 0.5`
3. **Time acceptable:** `alt_time - direct_time < 900s` (15 minutes)

**Example:**
```javascript
function shouldShowAlternative(altRoute, directRoute) {
  const timeDiff = altRoute.totalTime - directRoute.totalTime;
  const safetyGain = altRoute.avgRating - directRoute.avgRating;

  return safetyGain > 0.5 && timeDiff < 900;
}
```

### M1 Stub Behavior

For M1, `findSaferRoute()` returns `null` (no alternative). This allows UI testing without implementing full A*.

```javascript
export function findSaferRoute(origin, destination, segments) {
  // TODO: Implement A* with safety penalties in M2
  console.warn('[Diary] A* routing not implemented yet (M1 stub)');
  return null;
}
```

---

## 5. Color Scale for Segment Ratings

### Objective
Map rating (1-5) to color gradient (amber → yellow → lime green).

### Color Stops

| Rating | Color | Hex |
|--------|-------|-----|
| 1.0 (lowest) | Amber | `#FFA500` |
| 2.0 | Orange-Yellow | `#FFB833` |
| 3.0 (neutral) | Yellow | `#FFD700` |
| 4.0 | Yellow-Green | `#9ACD32` |
| 5.0 (highest) | Lime Green | `#32CD32` |

### Implementation (Linear Interpolation)

```javascript
export function colorForMean(mean) {
  // Clamp to 1-5
  mean = Math.max(1, Math.min(5, mean));

  const stops = [
    { value: 1, color: [255, 165, 0] },   // Amber
    { value: 2, color: [255, 184, 51] },  // Orange-Yellow
    { value: 3, color: [255, 215, 0] },   // Yellow
    { value: 4, color: [154, 205, 50] },  // Yellow-Green
    { value: 5, color: [50, 205, 50] }    // Lime Green
  ];

  // Find surrounding stops
  let lower, upper;
  for (let i = 0; i < stops.length - 1; i++) {
    if (mean >= stops[i].value && mean <= stops[i + 1].value) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }

  // Interpolate
  const t = (mean - lower.value) / (upper.value - lower.value);
  const r = Math.round(lower.color[0] + t * (upper.color[0] - lower.color[0]));
  const g = Math.round(lower.color[1] + t * (upper.color[1] - lower.color[1]));
  const b = Math.round(lower.color[2] + t * (upper.color[2] - lower.color[2]));

  return `rgb(${r}, ${g}, ${b})`;
}
```

**MapLibre Expression (Data-Driven Styling):**
```javascript
'line-color': [
  'interpolate',
  ['linear'],
  ['get', 'rating'],
  1, '#FFA500',
  2, '#FFB833',
  3, '#FFD700',
  4, '#9ACD32',
  5, '#32CD32'
]
```

---

## 6. Size Estimates & Performance Targets

### Data Sizes

| Item | M1 (Dev) | Production |
|------|----------|------------|
| Segments | 3-10 | 15,000-25,000 |
| GPS points per trip | 50-100 (mock) | 200-500 |
| Ratings per segment | 1-5 (mock) | 5-100 |
| Map file size | 5 KB | 5-10 MB |

### Performance Targets

| Operation | M1 Target | Production Target |
|-----------|-----------|-------------------|
| Load segments | < 100ms | < 500ms |
| Match GPS trace | < 50ms | < 200ms |
| Calculate decayed mean | < 10ms | < 50ms |
| Render segment layer | < 100ms | < 1000ms |
| A* pathfinding | N/A (stub) | < 2000ms |

### Memory Estimates

- **Segments GeoJSON:** 300 bytes/segment × 20,000 = 6 MB
- **Rating history:** 50 bytes/rating × 100 ratings/segment × 20,000 = 100 MB (server-side only)
- **Client-side cache:** < 10 MB (only visible segments + recent ratings)

---

## 7. Dependencies

### Required (add to package.json)

```json
{
  "dependencies": {
    "ajv": "^8.12.0",
    "dayjs": "^1.11.10",
    "@turf/turf": "^7.0.0"
  }
}
```

**Justifications:**
- **ajv:** JSON schema validation for rating submissions (120 KB)
- **dayjs:** Timestamp parsing and date math (2 KB, lighter than Luxon)
- **@turf/turf:** Geospatial operations (nearestPointOnLine, bearing, distance) (already present)

### Optional (for production)

- **rbush:** R-tree spatial index for fast segment lookup (14 KB)
- **pako:** GZip compression for large GeoJSON files (45 KB)
- **@sentry/browser:** Error tracking (if not already present)

---

## 8. Testing Requirements

### Unit Tests (for M2)

```javascript
// src/utils/match.test.js
test('matchPathToSegments filters by direction cosine', () => {
  const points = [
    { lat: 39.9520, lng: -75.1900, timestamp: 1000 },
    { lat: 39.9525, lng: -75.1890, timestamp: 2000 }
  ];
  const matched = matchPathToSegments(points, segments, { dirThreshold: 0.7 });
  expect(matched).toEqual(['seg_001']);
});

// src/utils/decay.test.js
test('decayedMean gives more weight to recent ratings', () => {
  const samples = [
    { rating: 5, timestamp: now },
    { rating: 1, timestamp: now - 90 * 86400000 }
  ];
  const mean = decayedMean(samples, now, 90);
  expect(mean).toBeGreaterThan(3); // Should be closer to 5 than 1
});

// src/utils/decay.test.js
test('bayesianShrinkage shrinks small samples toward prior', () => {
  const shrunk = bayesianShrinkage(5.0, 1, 3.0, 5);
  expect(shrunk).toBeCloseTo(3.33, 1);
});
```

### Integration Tests (M1)

- [ ] Load segments layer → 3 segments visible
- [ ] Click segment → SegmentCard appears
- [ ] Submit rating → Toast shows, map updates
- [ ] Hover segment → Tooltip shows rating

---

## 9. Open Questions & Future Enhancements

### M1 Deferred
- **Real GPS recording:** Geolocation API integration (M2)
- **A* routing:** Full pathfinding implementation (M2)
- **Server-side persistence:** PostgreSQL + PostGIS backend (M2)
- **Full street network:** 25,000 segments for Philadelphia (M2)

### Research Needed
- **Optimal half-life:** Should we use 90 days or 60/120 days?
- **Prior strength:** Is N=5 appropriate or should it be higher?
- **Direction threshold:** Is cosine=0.7 too strict for winding streets?
- **Snap tolerance:** Should it vary by speed (walking vs. biking)?

---

**Status:** Ready for implementation
**Estimated Complexity:** Medium-High (map-matching and A* are non-trivial)
**Estimated Effort:** 15-20 hours for all 6 algorithms
