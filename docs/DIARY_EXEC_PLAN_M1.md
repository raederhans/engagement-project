# Route Safety Diary - M1 Execution Plan

**Date:** 2025-11-07
**Status:** Scaffolding Complete - Ready for Codex Implementation
**Architecture:** Vanilla JS port of React UI scenarios (no React migration)
**Feature Flag:** `VITE_FEATURE_DIARY` (OFF by default)

---

## Objective

Implement Route Safety Diary MVP (M1) by porting the 4 UI scenarios from the React storyboard to vanilla JavaScript, integrating with the existing crime dashboard infrastructure. All features must be behind the `VITE_FEATURE_DIARY` flag and additive-only (no breaking changes to existing features).

---

## Constraints

### Technical
- **No React:** Port UI concepts to vanilla JS (DOM manipulation, event listeners)
- **Additive Only:** Existing buffer/district/tract features must remain unchanged
- **Feature Flagged:** All diary code behind `VITE_FEATURE_DIARY=1` check
- **Reversible:** Can be disabled or removed without affecting core dashboard
- **No Server:** M1 uses mock APIs (501 stubs); real backend in M2

### Architectural
- **Reuse Infrastructure:** Leverage existing `src/state/store.js`, `src/map/initMap.js`, `src/utils/http.js`
- **Consistent Patterns:** Follow existing panel/modal patterns from `src/ui/panel.js`, `src/ui/about.js`
- **MapLibre Integration:** Use vector layers (not Canvas 2D) for segment visualization
- **Chart.js Reuse:** Use existing `src/charts/` modules for insights panel

### Data
- **Seed Data:** Use `data/segments_phl.dev.geojson` (3 segments) for M1 development
- **Mock Ratings:** Generate synthetic rating data client-side for testing
- **No GPS:** M1 simulates GPS traces with mock coordinates; real recording in M2

---

## End-to-End Task List (M1)

### Phase 0: Environment Verification (Prerequisites)
- [x] Scaffolding created (`src/routes_diary/`, `src/map/`, `src/api/`, `src/utils/`, `server/api/diary/`)
- [x] Dependencies added (`ajv`, `dayjs`, `@turf/turf`)
- [x] Seed data present (`data/segments_phl.dev.geojson`)
- [x] Setup scripts executable (`scripts/setup_diary_env.sh`, `.ps1`)
- [x] Feature flag anchor in `src/main.js`
- [ ] **Codex verifies:** `npm run build` succeeds with `VITE_FEATURE_DIARY=0`

---

### Phase 1: Segment Visualization (Scenario 1 - Initial State)

**Goal:** Display 3 seed segments on map with rating colors and confidence-based widths.

#### Files to Implement

**1.1 `src/map/segments_layer.js`**
```javascript
// TODO: Implement segment layer rendering
export function mountSegmentsLayer(map, sourceId, data) {
  // Load segments GeoJSON as MapLibre source
  // Add line layer with data-driven styling:
  //   - color: interpolate based on 'rating' property (1=amber, 5=green)
  //   - width: interpolate based on 'n_eff' property (0-100 → 2-8px)
  // Add hover handlers (change cursor, show tooltip)
  // Add click handlers (emit 'segment-click' event)
}

export function colorForMean(mean) {
  // TODO: Return RGB color for rating 1-5
  // 1: #FFA500 (amber), 3: #FFD700 (yellow), 5: #32CD32 (lime)
}

export function widthForNEff(n_eff) {
  // TODO: Map n_eff (0-100) → line width (2-8px)
  // Use Math.min(8, 2 + (n_eff / 100) * 6)
}

export function removeSegmentsLayer(map, sourceId) {
  // TODO: Clean up layers and sources
}
```

**Acceptance:**
- [ ] 3 segments visible on map (lines with different colors based on mock ratings)
- [ ] Line widths vary based on mock confidence values
- [ ] Hover changes cursor to pointer
- [ ] Click logs segment ID to console

**Data Requirements:**
- Extend `data/segments_phl.dev.geojson` with properties: `{ rating: 3.5, n_eff: 45, top_tags: ["poor lighting"] }`

---

**1.2 `src/routes_diary/index.js`**
```javascript
// TODO: Main diary orchestrator
import { mountSegmentsLayer, removeSegmentsLayer } from '../map/segments_layer.js';
import { getStore } from '../state/store.js';

export function initDiaryMode(map) {
  // TODO: Check feature flag
  if (import.meta?.env?.VITE_FEATURE_DIARY !== '1') return;

  console.info('[Diary] Initializing Route Safety Diary mode...');

  // TODO: Load seed segments data
  // TODO: Mount segments layer
  // TODO: Wire segment click → show SegmentCard (Phase 4)
  // TODO: Add RecorderDock UI (Phase 2)
  // TODO: Add mode switcher to TopBar (if needed)
}

export function teardownDiaryMode(map) {
  // TODO: Remove segments layer
  // TODO: Clean up event listeners
  // TODO: Remove UI elements
}
```

**Acceptance:**
- [ ] `initDiaryMode()` called from `src/main.js` when flag is ON
- [ ] Segments layer mounted successfully
- [ ] No errors when flag is OFF

---

**1.3 `src/main.js` (Integration)**
```javascript
// [EXISTING CODE]
map.on('load', () => {
  // ... existing initialization ...

  // [DIARY_FLAG] Initialize diary mode if enabled
  if (import.meta?.env?.VITE_FEATURE_DIARY === '1') {
    import('./routes_diary/index.js').then(({ initDiaryMode }) => {
      initDiaryMode(map);
    });
  }
});
```

**Acceptance:**
- [ ] Build succeeds with flag OFF
- [ ] Build succeeds with flag ON
- [ ] Segments visible when flag ON, hidden when OFF

---

### Phase 2: GPS Recording Simulation (Scenario 1 → 2 Transition)

**Goal:** Mock GPS recording with RecorderDock UI and synthetic trace data.

#### Files to Implement

**2.1 `src/routes_diary/index.js` (extend)**
```javascript
// TODO: Add RecorderDock UI
function createRecorderDock() {
  // TODO: Create floating div (bottom-right, position: fixed)
  // TODO: Add 3 buttons: Start (green), Pause (gray), Finish (gray)
  // TODO: Wire event handlers
  // TODO: Inject CSS for styling
  return dockElement;
}

let recordingState = 'idle'; // 'idle' | 'recording' | 'paused' | 'finished'
let mockGPSTrace = [];

function onStartRecording() {
  // TODO: Set state to 'recording'
  // TODO: Start mock GPS generation (interval: 1s, add point)
  // TODO: Update button states
  recordingState = 'recording';
}

function onPauseRecording() {
  // TODO: Set state to 'paused'
  // TODO: Stop mock GPS generation
  recordingState = 'paused';
}

function onFinishRecording() {
  // TODO: Set state to 'finished'
  // TODO: Stop mock GPS generation
  // TODO: Open RatingModal with mockGPSTrace
  recordingState = 'finished';
  openRatingModal(mockGPSTrace);
}

function generateMockGPSPoint() {
  // TODO: Return { lat, lng, timestamp }
  // Use segments from seed data, interpolate along LineStrings
  // Add random noise (±5m)
}
```

**Acceptance:**
- [ ] RecorderDock visible in bottom-right corner
- [ ] Start button generates mock GPS points (1/sec)
- [ ] Pause button stops generation
- [ ] Finish button opens RatingModal (Phase 3)

---

### Phase 3: Rating Form & Submission (Scenario 2)

**Goal:** Collect user ratings via modal, match GPS to segments, submit to mock API.

#### Files to Implement

**3.1 `src/routes_diary/form_submit.js`**
```javascript
// TODO: Rating modal UI and submission logic
import Ajv from 'ajv';

const ajv = new Ajv();
const ratingSchema = {
  type: 'object',
  properties: {
    overall_rating: { type: 'integer', minimum: 1, maximum: 5 },
    tags: { type: 'array', maxItems: 3, items: { type: 'string' } },
    travel_mode: { type: 'string', enum: ['walk', 'bike'] },
    segment_overrides: { type: 'array', items: { type: 'object' } },
    save_as_route: { type: 'boolean' },
    route_name: { type: 'string', maxLength: 100 }
  },
  required: ['overall_rating', 'travel_mode']
};

export function openRatingModal(gpsTrace) {
  // TODO: Create modal overlay (full-screen, backdrop blur)
  // TODO: Create modal content (centered, white card)
  // TODO: Render form fields:
  //   - Star selector (1-5)
  //   - Tag checkboxes (predefined + Other input)
  //   - Segment override list (from matchedSegments)
  //   - Travel mode radio (walk/bike)
  //   - Save as route toggle
  //   - Privacy note (link to docs/PRIVACY_NOTES.md)
  // TODO: Wire Cancel button → close modal
  // TODO: Wire Submit button → validate & submit
}

export function closeRatingModal() {
  // TODO: Remove modal from DOM
}

async function handleSubmit(formData, matchedSegments) {
  // TODO: Validate with AJV
  const valid = ajv.validate(ratingSchema, formData);
  if (!valid) {
    alert('Validation error: ' + ajv.errorsText());
    return;
  }

  // TODO: Call submitDiary() from src/api/diary.js
  const payload = {
    ...formData,
    matched_segments: matchedSegments,
    timestamp: Date.now()
  };

  // TODO: Show loading state
  const result = await submitDiary(payload);

  // TODO: Close modal
  // TODO: Show toast "Thanks — updating map."
  // TODO: Trigger Phase 4 (map update)
}
```

**Acceptance:**
- [ ] Modal opens after "Finish" clicked
- [ ] Form fields rendered and interactive
- [ ] Star selector works (hover states)
- [ ] Tag selection limited to 3
- [ ] Submit validates and calls API
- [ ] Cancel closes modal without submission

---

**3.2 `src/utils/match.js`**
```javascript
// TODO: GPS trace to segment matching algorithm
import * as turf from '@turf/turf';

export function matchPathToSegments(points, segmentsGeoJSON, opts = {}) {
  const {
    maxGapM = 50,          // Max gap between points to consider same segment
    dirThreshold = 0.7,    // Minimum direction cosine (dot product)
    snapBufferM = 10       // Snap tolerance in meters
  } = opts;

  // TODO: For each GPS point:
  //   1. Find nearest segment within snapBufferM (use turf.nearestPointOnLine)
  //   2. Check direction cosine (user heading vs segment bearing)
  //   3. Group consecutive points by segment ID
  //   4. Filter segments with < 3 points (noise)
  //   5. Return array of segment IDs with traversal order

  // STUB: Return first segment for now
  return ['seg_001'];
}

function calculateBearing(pointA, pointB) {
  // TODO: Use turf.bearing(pointA, pointB)
}

function directionCosine(bearing1, bearing2) {
  // TODO: Calculate dot product of unit vectors
  // cos(θ) = cos(b1 - b2)
}
```

**Acceptance:**
- [ ] `matchPathToSegments()` returns array of segment IDs
- [ ] Works with 3-segment seed data
- [ ] Handles GPS noise (±5m)
- [ ] Filters out segments with < 3 points

---

**3.3 `src/api/diary.js`**
```javascript
// TODO: Diary API integration
import { http } from '../utils/http.js';

export async function submitDiary(payload) {
  // TODO: POST /api/diary/submit
  // For M1: Mock response (simulate 500ms delay)
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        updated_segments: payload.matched_segments,
        new_ratings: payload.matched_segments.map(id => ({
          segment_id: id,
          rating: payload.overall_rating,
          n_eff: 1 // First rating
        }))
      });
    }, 500);
  });
}

export async function getSegments(params) {
  // TODO: GET /api/diary/segments
  // M1: Return seed data with mock aggregates
}

export async function getSaferRoute(params) {
  // TODO: POST /api/diary/route
  // M1: Return null (no alternative found)
}
```

**Acceptance:**
- [ ] `submitDiary()` returns after 500ms
- [ ] Response includes updated_segments array
- [ ] No actual server call (mock only)

---

### Phase 4: Map Updates & Insights (Scenario 3)

**Goal:** Update segment colors/widths after submission, show safer route strip, populate insights panel.

#### Files to Implement

**4.1 `src/map/segments_layer.js` (extend)**
```javascript
export function updateSegments(map, sourceId, updatedSegments) {
  // TODO: Update segment data in MapLibre source
  // TODO: Trigger glow animation (2-second pulse)
  // TODO: Update tooltip data
}

function glowSegment(map, segmentId, duration = 2000) {
  // TODO: Animate line-width and line-opacity for visual feedback
}
```

**Acceptance:**
- [ ] Updated segments glow briefly (2 seconds)
- [ ] Colors/widths reflect new ratings
- [ ] Tooltip shows "Updated X min ago"

---

**4.2 `src/utils/decay.js`**
```javascript
// TODO: Time-decay and Bayesian shrinkage calculations
import dayjs from 'dayjs';

export function decayedMean(samples, now, halfLifeDays = 90) {
  // TODO: Exponential decay formula
  // weight = exp(-λ * days_ago)
  // λ = ln(2) / halfLifeDays
  // decayed_mean = Σ(rating_i * weight_i) / Σ(weight_i)

  const lambda = Math.log(2) / halfLifeDays;
  let weightedSum = 0;
  let weightSum = 0;

  for (const sample of samples) {
    const daysAgo = dayjs(now).diff(dayjs(sample.timestamp), 'day');
    const weight = Math.exp(-lambda * daysAgo);
    weightedSum += sample.rating * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 3.0; // Prior mean
}

export function bayesianShrinkage(observedMean, observedN, priorMean = 3.0, priorN = 5) {
  // TODO: Bayesian shrinkage (James-Stein estimator)
  // shrunk_mean = (priorMean * priorN + observedMean * observedN) / (priorN + observedN)
  return (priorMean * priorN + observedMean * observedN) / (priorN + observedN);
}

export function effectiveN(samples, now, halfLifeDays = 90) {
  // TODO: Effective sample size (sum of weights)
  const lambda = Math.log(2) / halfLifeDays;
  let weightSum = 0;

  for (const sample of samples) {
    const daysAgo = dayjs(now).diff(dayjs(sample.timestamp), 'day');
    weightSum += Math.exp(-lambda * daysAgo);
  }

  return weightSum;
}

export function delta30d(samples, now) {
  // TODO: 30-day trend (current avg - 30d ago avg)
  const cutoff30d = dayjs(now).subtract(30, 'day');
  const recent = samples.filter(s => dayjs(s.timestamp).isAfter(cutoff30d));
  const older = samples.filter(s => dayjs(s.timestamp).isBefore(cutoff30d));

  const recentMean = recent.reduce((sum, s) => sum + s.rating, 0) / recent.length;
  const olderMean = older.reduce((sum, s) => sum + s.rating, 0) / older.length;

  return recentMean - olderMean;
}
```

**Acceptance:**
- [ ] `decayedMean()` returns correct weighted average
- [ ] `bayesianShrinkage()` shrinks toward prior (3.0) for small N
- [ ] `effectiveN()` returns sum of time-decayed weights
- [ ] `delta30d()` returns positive/negative trend

---

**4.3 `src/map/routing_overlay.js`**
```javascript
// TODO: Safer alternative route display
import * as turf from '@turf/turf';

export function drawSaferRoute(map, geojsonLine, meta) {
  // TODO: Add route line layer (blue, animated)
  // TODO: Show "Safer alternative" strip (top-right)
  // TODO: Display meta: { timeDiff: "+2 min", avoidedSegments: 2 }
  // TODO: Wire "Show route" button → zoom to fit
  // TODO: Wire Dismiss (X) button → remove overlay
}

export function removeSaferRoute(map) {
  // TODO: Remove route layer and strip UI
}

// TODO: A* pathfinding with safety penalties (stub for M1)
export function findSaferRoute(origin, destination, segments) {
  // TODO: Implement A* with cost = length_m * (1 + penalty(rating))
  // penalty(rating) = (5 - rating) / 5  → 0.0 (rating=5) to 0.8 (rating=1)
  //
  // For M1: Return null (no alternative found)
  return null;
}

function aStar(start, goal, graph, costFn) {
  // TODO: Standard A* implementation
  // Open set: priority queue (min-heap)
  // Closed set: Set of visited nodes
  // Heuristic: Euclidean distance (turf.distance)
}
```

**Acceptance:**
- [ ] `drawSaferRoute()` shows blue line on map
- [ ] Strip displays time difference and avoided segments
- [ ] "Show route" button zooms to fit route bounds
- [ ] Dismiss button removes route
- [ ] `findSaferRoute()` returns null for M1 (stub)

---

**4.4 Insights Panel (RightPanel)**

**TODO in `src/routes_diary/index.js`:**
```javascript
function populateInsightsPanel(updatedSegments, allRatings) {
  // TODO: Reuse existing RightPanel div
  // TODO: Clear existing content
  // TODO: Render 3 charts using src/charts/* modules:
  //   1. Trend chart (8-week sparkline) - use renderMonthly() pattern
  //   2. Top tags (horizontal bars) - use renderTopN() pattern
  //   3. 7x24 heatmap - use render7x24() pattern

  // TODO: Generate mock data:
  //   - Trend: [3.2, 3.4, 3.6, 3.5, 3.8, 3.9, 4.0, 4.1]
  //   - Tags: [{ tag: "poor lighting", count: 12 }, { tag: "low foot traffic", count: 8 }]
  //   - Heatmap: 7x24 grid with mock values 0-5
}
```

**Acceptance:**
- [ ] Trend chart shows 8-week progression
- [ ] Top tags chart shows 3 most common tags
- [ ] 7x24 heatmap renders with color gradient
- [ ] Charts update after rating submission

---

**4.5 Toast Notification**

**TODO in `src/routes_diary/index.js`:**
```javascript
function showToast(message, duration = 2000) {
  // TODO: Create toast div (top-center, position: fixed)
  // TODO: Style: white card, shadow, fade-in animation
  // TODO: Auto-dismiss after duration
  // TODO: Remove from DOM after animation
}
```

**Acceptance:**
- [ ] Toast appears at top-center
- [ ] Message: "Thanks — updating map."
- [ ] Fades out after 2 seconds

---

### Phase 5: Community Interaction (Scenario 4)

**Goal:** Show SegmentCard on click, display CommunityDetailsModal.

#### Files to Implement

**5.1 SegmentCard (click handler)**

**TODO in `src/routes_diary/index.js`:**
```javascript
function onSegmentClick(segmentId, clickPoint) {
  // TODO: Fetch segment details (mock data for M1)
  const segmentData = {
    segment_id: segmentId,
    rating: 3.8,
    n_eff: 45,
    trend_30d: 0.4,
    top_tags: ["poor lighting", "low foot traffic"],
    total_reports: 44,
    last_updated: Date.now() - 7200000 // 2 hours ago
  };

  // TODO: Create floating card (absolute position near click point)
  // TODO: Render card content:
  //   - Header: "Segment Details" + close button
  //   - Stats grid: rating, trend (icon + color), confidence %
  //   - Top tags (2-3 badges)
  //   - Action buttons: "Agree" (ThumbsUp), "Feels safer" (Sparkles)
  //   - Footer: "Based on X reports", timestamp
  //   - Link: "View community insights" → opens CommunityDetailsModal

  // TODO: Wire actions:
  //   - Close (X) → remove card
  //   - Agree → call submitAgree(), show toast, close card
  //   - Feels safer → call submitImprove(), show toast, close card
  //   - View insights → open CommunityDetailsModal
}

function closeSegmentCard() {
  // TODO: Remove card from DOM
}
```

**Acceptance:**
- [ ] Card appears near clicked segment
- [ ] Shows rating, trend, confidence, tags
- [ ] "Agree" button increments confidence (mock)
- [ ] "Feels safer" button records improvement (mock)
- [ ] Close button removes card
- [ ] "View insights" opens modal

---

**5.2 CommunityDetailsModal**

**TODO in `src/routes_diary/index.js`:**
```javascript
function openCommunityDetailsModal(segmentId) {
  // TODO: Fetch full analytics (mock data for M1)
  const analytics = {
    segment_id: segmentId,
    total_reports: 44,
    avg_rating: 3.8,
    confidence: 87,
    trend_30d: 0.4,
    weekly_trend: [
      { week: 1, rating: 3.2, count: 8 },
      { week: 2, rating: 3.4, count: 11 },
      { week: 3, rating: 3.6, count: 12 },
      { week: 4, rating: 3.8, count: 14 }
    ],
    rating_distribution: [
      { stars: 1, count: 8 },
      { stars: 2, count: 15 },
      { stars: 3, count: 12 },
      { stars: 4, count: 6 },
      { stars: 5, count: 3 }
    ],
    tag_frequency: [
      { tag: "poor lighting", count: 18, trend: 2 },
      { tag: "low foot traffic", count: 12, trend: -1 },
      { tag: "cars too close", count: 8, trend: 0 }
    ],
    recent_activity: [
      { type: "improve", timestamp: Date.now() - 7200000 },
      { type: "agree", timestamp: Date.now() - 18000000 },
      // ... 5 more
    ]
  };

  // TODO: Create full-screen modal (z-index 100, backdrop blur)
  // TODO: Render modal content:
  //   - Sticky header: title + segment name + close button
  //   - Overview section: 4 stat cards (gradient backgrounds)
  //   - 30-day trend chart: 4 weekly bars (use Chart.js)
  //   - Rating distribution: 5 horizontal bars
  //   - Tag frequency: 2-column grid with trend badges
  //   - Recent activity timeline: 7 items with icons
  //   - Privacy note at bottom (blue info box)

  // TODO: Wire close actions:
  //   - Close (X) button → close modal
  //   - Click backdrop → close modal
}

function closeCommunityDetailsModal() {
  // TODO: Remove modal from DOM
}
```

**Acceptance:**
- [ ] Modal opens full-screen with backdrop blur
- [ ] Overview stats render correctly
- [ ] 30-day trend chart shows 4 weekly bars
- [ ] Rating distribution shows 5 horizontal bars
- [ ] Tag frequency grid displays with trend badges
- [ ] Recent activity timeline shows 7 items
- [ ] Privacy note displayed at bottom
- [ ] Close button and backdrop click close modal

---

**5.3 Community Action APIs**

**TODO in `src/api/diary.js`:**
```javascript
export async function submitAgree(segmentId) {
  // TODO: POST /api/diary/agree
  // M1: Mock response (500ms delay)
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ ok: true, new_n_eff: 46 });
    }, 500);
  });
}

export async function submitImprove(segmentId) {
  // TODO: POST /api/diary/improve
  // M1: Mock response (500ms delay)
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({ ok: true, improvement_count: 13 });
    }, 500);
  });
}

export async function getSegmentDetails(segmentId) {
  // TODO: GET /api/diary/segments/:id
  // M1: Return mock data from seed
}

export async function getSegmentAnalytics(segmentId) {
  // TODO: GET /api/diary/segments/:id/analytics
  // M1: Return mock analytics data
}
```

**Acceptance:**
- [ ] `submitAgree()` returns after 500ms
- [ ] `submitImprove()` returns after 500ms
- [ ] `getSegmentDetails()` returns mock data
- [ ] `getSegmentAnalytics()` returns mock analytics

---

## Function Signatures Reference

### `src/api/diary.js`
```javascript
async submitDiary(payload: {
  overall_rating: number,
  tags: string[],
  travel_mode: 'walk' | 'bike',
  segment_overrides: Array<{segment_id: string, rating: number}>,
  save_as_route: boolean,
  route_name?: string,
  matched_segments: string[],
  timestamp: number
}): Promise<{ok: boolean, updated_segments: string[], new_ratings: Array}>

async getSegments(params: {
  bbox?: [number, number, number, number],
  start?: number,
  end?: number,
  ids?: string[]
}): Promise<FeatureCollection>

async getSaferRoute(params: {
  from: [number, number],
  to: [number, number],
  time?: string
}): Promise<{route: LineString, meta: {timeDiff: string, avoidedSegments: number}} | null>

async submitAgree(segmentId: string): Promise<{ok: boolean, new_n_eff: number}>

async submitImprove(segmentId: string): Promise<{ok: boolean, improvement_count: number}>

async getSegmentDetails(segmentId: string): Promise<SegmentSummary>

async getSegmentAnalytics(segmentId: string): Promise<SegmentAnalytics>
```

### `src/utils/match.js`
```javascript
matchPathToSegments(
  points: Array<{lat: number, lng: number, timestamp: number}>,
  segmentsGeoJSON: FeatureCollection,
  opts?: {
    maxGapM?: number,         // Default: 50
    dirThreshold?: number,    // Default: 0.7
    snapBufferM?: number      // Default: 10
  }
): string[]
```

### `src/utils/decay.js`
```javascript
decayedMean(
  samples: Array<{rating: number, timestamp: number}>,
  now: number,
  halfLifeDays?: number     // Default: 90
): number

bayesianShrinkage(
  observedMean: number,
  observedN: number,
  priorMean?: number,       // Default: 3.0
  priorN?: number           // Default: 5
): number

effectiveN(
  samples: Array<{timestamp: number}>,
  now: number,
  halfLifeDays?: number     // Default: 90
): number

delta30d(
  samples: Array<{rating: number, timestamp: number}>,
  now: number
): number
```

### `src/map/segments_layer.js`
```javascript
mountSegmentsLayer(
  map: MapLibreMap,
  sourceId: string,
  data: FeatureCollection
): void

updateSegments(
  map: MapLibreMap,
  sourceId: string,
  updatedSegments: Array<{segment_id: string, rating: number, n_eff: number}>
): void

colorForMean(mean: number): string  // RGB hex

widthForNEff(n_eff: number): number  // 2-8px

removeSegmentsLayer(map: MapLibreMap, sourceId: string): void
```

### `src/map/routing_overlay.js`
```javascript
drawSaferRoute(
  map: MapLibreMap,
  geojsonLine: Feature<LineString>,
  meta: {timeDiff: string, avoidedSegments: number}
): void

removeSaferRoute(map: MapLibreMap): void

findSaferRoute(
  origin: [number, number],
  destination: [number, number],
  segments: FeatureCollection
): {route: Feature<LineString>, meta: object} | null
```

---

## Algorithm Requirements Checklist

See [docs/ALGO_REQUIREMENTS_M1.md](./ALGO_REQUIREMENTS_M1.md) for detailed specifications.

- [ ] GPS Map-Matching: Nearest segment + direction cosine filter
- [ ] Time-Decay: Exponential decay with 90-day half-life
- [ ] Bayesian Shrinkage: Prior mean=3.0, prior N=5
- [ ] Effective N: Sum of time-decayed weights
- [ ] A* Pathfinding: Cost = length × (1 + penalty), penalty = (5-rating)/5
- [ ] Color Scale: 1 (amber) → 5 (green), interpolated
- [ ] Width Scale: n_eff (0-100) → line width (2-8px)

---

## Acceptance Criteria (M1 Complete)

### Build & Deployment
- [ ] `npm run build` succeeds with `VITE_FEATURE_DIARY=0` (flag OFF)
- [ ] `npm run build` succeeds with `VITE_FEATURE_DIARY=1` (flag ON)
- [ ] `npm run dev` works with both flag states
- [ ] No console errors when flag is OFF
- [ ] Existing features (buffer/district/tract) unaffected

### Scenario 1: Initial State
- [ ] 3 seed segments visible on map (different colors)
- [ ] Line widths vary by confidence (mock data)
- [ ] Hover changes cursor and shows tooltip
- [ ] Click logs segment ID
- [ ] RecorderDock visible (bottom-right)
- [ ] Start button enabled, Pause/Finish disabled

### Scenario 2: Rating Modal
- [ ] Start button generates mock GPS points (1/sec)
- [ ] Finish button opens RatingModal
- [ ] Modal shows all form fields (stars, tags, travel mode, etc.)
- [ ] Star selector interactive with hover states
- [ ] Tag selection limited to 3
- [ ] Submit validates with AJV
- [ ] Cancel closes modal without submission
- [ ] Mock API call returns after 500ms

### Scenario 3: Post-Submit
- [ ] Toast notification appears ("Thanks — updating map.")
- [ ] Updated segments glow briefly (2s)
- [ ] Segment colors/widths updated
- [ ] Safer route strip shows (if alternative found) - stub returns null for M1
- [ ] Insights panel populated with 3 charts (mock data)

### Scenario 4: Community Interaction
- [ ] Click segment shows SegmentCard (floating)
- [ ] Card displays rating, trend, confidence, tags
- [ ] "Agree" button shows toast and closes card
- [ ] "Feels safer" button shows toast and closes card
- [ ] "View insights" opens CommunityDetailsModal
- [ ] Modal shows all sections (overview, charts, timeline, privacy note)
- [ ] Modal closes via X button or backdrop click

### Code Quality
- [ ] All TODOs have clear implementation notes
- [ ] Function signatures match specifications
- [ ] Error handling present (try/catch, validation)
- [ ] No hardcoded credentials or secrets
- [ ] Console logs use `[Diary]` prefix for clarity
- [ ] CSS injected dynamically (no external stylesheet)

---

## Evidence Plan

For each phase completion, capture:
1. **Screenshot:** UI element rendered (RecorderDock, modal, chart, etc.)
2. **Console Log:** Successful API calls, validation results
3. **Code Snippet:** Key function implementation (5-10 lines)
4. **Test Result:** Acceptance criteria checklist (✅ all passed)

Store evidence in `logs/M1_IMPL_PHASE<N>_<timestamp>.md`

---

## Next Steps for Codex

1. **Verify Environment:**
   ```bash
   npm run build  # Should succeed with VITE_FEATURE_DIARY=0
   ```

2. **Enable Feature Flag:**
   ```bash
   echo "VITE_FEATURE_DIARY=1" > .env.local
   ```

3. **Start Implementation:**
   - Begin with Phase 1 (Segment Visualization)
   - Follow task list sequentially
   - Mark TODOs as complete
   - Run acceptance tests after each phase

4. **Reference Documentation:**
   - [SCENARIO_MAPPING.md](./SCENARIO_MAPPING.md) - UI element mapping
   - [ALGO_REQUIREMENTS_M1.md](./ALGO_REQUIREMENTS_M1.md) - Algorithm specs
   - [API_DIARY.md](./API_DIARY.md) - API contracts
   - [DEV_ENV_README.md](./DEV_ENV_README.md) - Environment setup

---

**Status:** Scaffolding complete, ready for implementation
**Estimated Effort:** 40-50 hours (5-7 days full-time)
**Blockers:** None (all prerequisites met)
