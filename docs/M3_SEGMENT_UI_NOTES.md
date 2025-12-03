# Segment Override UX Design - Spatial Grouping Strategy

**Date:** 2025-11-26
**Author:** Agent-M
**Status:** Design Spec for Codex (M3+ Implementation) — core popup copy/flow now implemented; grouping/aggregation remains future work.
**Context:** Follow-up to AGENTM_DIARY_UI_TUNING_20251126T003318Z.md

---

## Problem Statement

**Current Implementation (Post-Fix):**
- Segment override list shows **3 worst segments** by default, rest collapsible
- Still displays **20-40 individual segment rows** for typical routes
- Users must understand segment-level granularity (cognitively demanding)

**User Mental Model:**
- Users think in **spatial chunks**: "the start was fine, but the middle felt sketchy"
- Street names provide spatial anchors: "Walnut St was okay, but 45th near Baltimore was rough"
- Distance markers help: "First mile was good, last half-mile felt unsafe"

**Goal:**
Aggregate consecutive segments into **4-6 human-scale blocks** along the route, reducing cognitive load while preserving override functionality.

---

## Design Approach: Route Blocks

### Block Definition

**Divide route into equal spatial blocks:**

- **Block count:** 4-6 blocks (optimal UX testing sweet spot)
- **Block size:** Route length / block count (e.g., 2.4 km route → 6 blocks of 400m each)
- **Naming strategy:**
  - Option A: Distance markers (0-0.4 km, 0.4-0.8 km, ...)
  - Option B: Ordinal (Start, Early, Middle, Late, End)
  - Option C: Street names (S 33rd St area, Walnut St area, ...)

**Block Properties:**

```javascript
{
  blockId: 'block_1',          // Unique ID
  label: 'Start (S 33rd St)',  // Display name
  distanceStart: 0,            // Meters from route origin
  distanceEnd: 400,            // Meters from route origin
  segmentIds: ['seg_001', 'seg_002', ...], // Segments in this block
  avgSafety: 3.2,              // Mean of segment decayed_means
  dominantStreet: 'S 33rd St', // Most common street name (if available)
  lengthMeters: 400,           // Block length
}
```

### UI Mockup

**Modal: "Rate this route" → Segment overrides section**

```
┌─────────────────────────────────────────────────┐
│ Segment overrides (optional, max 2)             │
├─────────────────────────────────────────────────┤
│ Override safety rating for specific areas:      │
│                                                  │
│ ☐ Start · S 33rd St (0.4 km, avg 3.2★)        │
│                                                  │
│ ☐ Early · Walnut St (0.5 km, avg 2.8★) ⚠️      │
│   └─ Lowest-rated area on route                 │
│                                                  │
│ ☐ Middle · 45th & Baltimore (0.6 km, avg 3.5★) │
│                                                  │
│ ☐ Late · Baltimore Ave (0.5 km, avg 3.9★)      │
│                                                  │
│ ☐ End · Clark Park (0.4 km, avg 4.1★)          │
│                                                  │
│ ▾ Advanced: Override individual segments        │
│   (collapse by default, show 40 segments)       │
└─────────────────────────────────────────────────┘
```

**Key Features:**
- Blocks sorted by route order (Start → End)
- Avg safety shown for context
- **Lowest-rated block highlighted** (⚠️ indicator)
- Checkbox + dropdown (same as current segment rows)
- **Advanced** disclosure for segment-level overrides (power users)

### Block Labeling Strategy

**Hybrid Approach (Recommended):**

```javascript
function labelBlock(block, routeProps) {
  const ordinals = ['Start', 'Early', 'Middle', 'Late', 'End'];
  const position = Math.floor(block.distanceStart / routeProps.length_m * (ordinals.length - 1));
  const ordinal = ordinals[position];

  const distanceKm = (block.lengthMeters / 1000).toFixed(1);
  const safetyIcon = block.avgSafety < 2.8 ? '⚠️' : '';

  // If dominant street is known and meaningful
  if (block.dominantStreet && block.dominantStreet !== 'Unknown') {
    return `${ordinal} · ${block.dominantStreet} (${distanceKm} km, avg ${block.avgSafety.toFixed(1)}★) ${safetyIcon}`;
  }

  // Fallback to distance range
  const startKm = (block.distanceStart / 1000).toFixed(1);
  const endKm = (block.distanceEnd / 1000).toFixed(1);
  return `${ordinal} · ${startKm}-${endKm} km (avg ${block.avgSafety.toFixed(1)}★) ${safetyIcon}`;
}
```

**Examples:**
- Good case: `"Start · S 33rd St (0.4 km, avg 3.2★)"`
- Missing street: `"Middle · 1.2-1.8 km (avg 2.8★) ⚠️"`
- Low safety: `"Early · Walnut St (0.5 km, avg 2.1★) ⚠️"`

---

## Implementation Plan

### Phase 1: Block Computation (Server-Side / Build-Time)

**File:** [scripts/generate_demo_data.mjs](../scripts/generate_demo_data.mjs)

**Workflow:**

1. **After generating route coordinates** (Dijkstra pathfinding):

```javascript
const route = {
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: routeCoords,
  },
  properties: {
    route_id: 'route_A',
    segment_ids: ['seg_001', 'seg_002', ...],
    length_m: 2400,
    // NEW: Add blocks
    blocks: computeRouteBlocks(routeCoords, segmentIds, segmentLookup),
  },
};
```

2. **Compute blocks function:**

```javascript
import * as turf from '@turf/turf';

function computeRouteBlocks(routeCoords, segmentIds, segmentLookup, numBlocks = 5) {
  const line = turf.lineString(routeCoords);
  const totalLength = turf.length(line, { units: 'meters' });
  const blockLength = totalLength / numBlocks;

  const blocks = [];
  let distAlong = 0;

  for (let i = 0; i < numBlocks; i++) {
    const startDist = i * blockLength;
    const endDist = Math.min((i + 1) * blockLength, totalLength);

    // Find segments within this block
    const segmentsInBlock = findSegmentsInDistanceRange(
      segmentIds,
      segmentLookup,
      routeCoords,
      startDist,
      endDist
    );

    // Aggregate safety scores
    const safetyScores = segmentsInBlock.map(id => {
      const seg = segmentLookup.get(id);
      return seg?.properties?.decayed_mean || 3;
    });
    const avgSafety = safetyScores.length > 0
      ? safetyScores.reduce((a, b) => a + b) / safetyScores.length
      : 3;

    // Find dominant street name
    const streets = segmentsInBlock.map(id => {
      const seg = segmentLookup.get(id);
      return seg?.properties?.street || 'Unknown';
    });
    const dominantStreet = findMostCommon(streets);

    blocks.push({
      blockId: `block_${i + 1}`,
      label: labelBlock({
        distanceStart: startDist,
        distanceEnd: endDist,
        lengthMeters: endDist - startDist,
        avgSafety,
        dominantStreet,
      }, { length_m: totalLength }),
      distanceStart: Math.round(startDist),
      distanceEnd: Math.round(endDist),
      segmentIds: segmentsInBlock,
      avgSafety: Number(avgSafety.toFixed(2)),
      dominantStreet,
      lengthMeters: Math.round(endDist - startDist),
    });
  }

  return blocks;
}

function findSegmentsInDistanceRange(segmentIds, segmentLookup, routeCoords, startDist, endDist) {
  // Walk along route, accumulate distance, assign segments to blocks
  // This requires walking the route and tracking which segments are traversed
  // between startDist and endDist meters along the route.

  // Simplified approach: Use segment bounding boxes and check if they overlap with
  // the distance range (approximation, good enough for UX purposes).

  // TODO: Implement precise distance tracking using turf.along() and turf.lineSlice()
  return segmentIds; // Placeholder - refine in actual implementation
}

function findMostCommon(arr) {
  const counts = {};
  arr.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  let max = 0;
  let result = arr[0];
  for (const [key, count] of Object.entries(counts)) {
    if (count > max && key !== 'Unknown') {
      max = count;
      result = key;
    }
  }
  return result;
}
```

3. **Output to routes_phl.demo.geojson:**

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[...]] },
  "properties": {
    "route_id": "route_A",
    "segment_ids": ["seg_001", "seg_002", ...],
    "length_m": 2400,
    "blocks": [
      {
        "blockId": "block_1",
        "label": "Start · S 33rd St (0.4 km, avg 3.2★)",
        "distanceStart": 0,
        "distanceEnd": 480,
        "segmentIds": ["seg_001", "seg_002", "seg_003"],
        "avgSafety": 3.2,
        "dominantStreet": "S 33rd St",
        "lengthMeters": 480
      },
      {
        "blockId": "block_2",
        "label": "Early · Walnut St (0.5 km, avg 2.8★) ⚠️",
        "distanceStart": 480,
        "distanceEnd": 980,
        "segmentIds": ["seg_004", "seg_005", "seg_006", "seg_007"],
        "avgSafety": 2.8,
        "dominantStreet": "Walnut St",
        "lengthMeters": 500
      },
      // ... 3 more blocks ...
    ]
  }
}
```

### Phase 2: Modal UI Update (Client-Side)

**File:** [src/routes_diary/form_submit.js](../src/routes_diary/form_submit.js)

**Update `createSegmentOverrideSection()`:**

```javascript
function createSegmentOverrideSection(state) {
  const wrapper = document.createElement('div');
  const label = document.createElement('div');
  label.textContent = 'Segment overrides (optional, max 2)';
  label.style.fontWeight = '600';
  wrapper.appendChild(label);

  const hint = document.createElement('div');
  hint.textContent = 'Override safety rating for specific areas:';
  hint.style.fontSize = '12px';
  hint.style.color = '#64748b';
  hint.style.marginTop = '4px';
  hint.style.marginBottom = '8px';
  wrapper.appendChild(hint);

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';

  // Check if route has blocks (new format)
  const blocks = state.route.properties?.blocks;
  if (blocks && blocks.length > 0) {
    // Use block-based UI
    renderBlockRows(list, blocks, state);
  } else {
    // Fallback to segment-based UI (current implementation)
    renderSegmentRows(list, state);
  }

  wrapper.appendChild(list);

  // Add "Advanced" disclosure for segment-level overrides
  if (blocks && blocks.length > 0) {
    const advanced = createAdvancedSegmentDisclosure(state);
    wrapper.appendChild(advanced);
  }

  return wrapper;
}

function renderBlockRows(list, blocks, state) {
  // Sort blocks by avg safety (lowest first)
  const sortedBlocks = blocks.slice().sort((a, b) => a.avgSafety - b.avgSafety);

  sortedBlocks.forEach(block => {
    const row = createBlockRow(block, state);
    list.appendChild(row);
  });
}

function createBlockRow(block, state) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.justifyContent = 'space-between';
  row.style.alignItems = 'center';
  row.style.border = '1px solid #e2e8f0';
  row.style.borderRadius = '10px';
  row.style.padding = '10px 12px';

  // Highlight lowest-rated block
  if (block.avgSafety < 2.8) {
    row.style.borderColor = '#fbbf24';
    row.style.background = '#fffbeb';
  }

  const labelWrap = document.createElement('div');
  labelWrap.style.display = 'flex';
  labelWrap.style.flexDirection = 'column';
  labelWrap.style.fontSize = '12px';
  labelWrap.style.color = '#475569';
  labelWrap.innerHTML = `<strong style="color:#0f172a;">${block.label}</strong>`;

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '6px';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.style.cursor = 'pointer';

  const select = document.createElement('select');
  for (let rating = 1; rating <= 5; rating++) {
    const option = document.createElement('option');
    option.value = rating;
    option.textContent = `${rating}★`;
    select.appendChild(option);
  }
  select.disabled = true;
  select.style.borderRadius = '8px';
  select.style.border = '1px solid #e2e8f0';
  select.style.padding = '6px';

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      if (state.blockOverrides.size >= 2) {
        checkbox.checked = false;
        setError('Only two overrides are supported.');
        return;
      }
      select.disabled = false;
      state.blockOverrides.set(block.blockId, {
        blockId: block.blockId,
        segmentIds: block.segmentIds, // All segments in block get this rating
        rating: Number(select.value),
      });
    } else {
      select.disabled = true;
      state.blockOverrides.delete(block.blockId);
    }
    setError('');
  });

  select.addEventListener('change', () => {
    if (state.blockOverrides.has(block.blockId)) {
      state.blockOverrides.get(block.blockId).rating = Number(select.value);
    }
  });

  controls.appendChild(checkbox);
  controls.appendChild(select);
  row.appendChild(labelWrap);
  row.appendChild(controls);

  return row;
}

function createAdvancedSegmentDisclosure(state) {
  const details = document.createElement('details');
  details.style.marginTop = '12px';

  const summary = document.createElement('summary');
  summary.textContent = 'Advanced: Override individual segments';
  summary.style.fontSize = '12px';
  summary.style.color = '#475569';
  summary.style.cursor = 'pointer';
  summary.style.padding = '6px 0';
  summary.style.borderTop = '1px solid #e2e8f0';
  summary.style.paddingTop = '12px';
  details.appendChild(summary);

  const segmentList = document.createElement('div');
  segmentList.style.display = 'flex';
  segmentList.style.flexDirection = 'column';
  segmentList.style.gap = '8px';
  segmentList.style.marginTop = '8px';

  // Render all segments (current implementation)
  renderSegmentRows(segmentList, state);

  details.appendChild(segmentList);
  return details;
}
```

**State Management Update:**

```javascript
// In openRatingModal()
currentState = {
  route: routeFeature,
  segmentLookup: segmentLookup || new Map(),
  userHash,
  tags: new Set(),
  overrides: new Map(),       // Segment-level overrides (existing)
  blockOverrides: new Map(),  // NEW: Block-level overrides
  overallRating: 3,
  noteInput: null,
  onSuccess,
};
```

**Payload Construction:**

```javascript
// In handleSubmit()
const payload = {
  route_id: route.properties.route_id,
  segment_ids: route.properties.segment_ids,
  overall_rating: state.overallRating,
  tags: Array.from(state.tags),
  mode: route.properties.mode || 'walk',
  user_hash: state.userHash,
  notes: state.noteInput?.value?.trim() || '',
  timestamp: new Date().toISOString(),

  // NEW: Flatten block overrides into segment overrides
  segment_overrides: flattenBlockOverrides(state.blockOverrides, state.overrides),
};

function flattenBlockOverrides(blockOverrides, segmentOverrides) {
  const result = [];

  // Add segment-level overrides first (higher priority)
  for (const [segmentId, rating] of segmentOverrides) {
    result.push({ segment_id: segmentId, rating });
  }

  // Add block-level overrides (expanded to all segments in block)
  for (const block of blockOverrides.values()) {
    block.segmentIds.forEach(segmentId => {
      // Skip if already overridden at segment level
      if (!segmentOverrides.has(segmentId)) {
        result.push({ segment_id: segmentId, rating: block.rating });
      }
    });
  }

  return result.slice(0, 20); // Backend limit (adjust as needed)
}
```

---

## Data Schema Changes

### Route GeoJSON (Enhanced)

```json
{
  "type": "Feature",
  "geometry": { "type": "LineString", "coordinates": [[...]] },
  "properties": {
    "route_id": "route_A",
    "name": "30th St Station → Clark Park",
    "from": "30th Street Station",
    "to": "Clark Park",
    "mode": "walk",
    "length_m": 2400,
    "duration_min": 15,
    "segment_ids": ["seg_001", "seg_002", ...],

    "blocks": [
      {
        "blockId": "block_1",
        "label": "Start · S 33rd St (0.4 km, avg 3.2★)",
        "distanceStart": 0,
        "distanceEnd": 480,
        "segmentIds": ["seg_001", "seg_002", "seg_003"],
        "avgSafety": 3.2,
        "dominantStreet": "S 33rd St",
        "lengthMeters": 480
      },
      // ... more blocks ...
    ]
  }
}
```

### Submission Payload (Unchanged, Backward Compatible)

```json
{
  "route_id": "route_A",
  "segment_ids": ["seg_001", "seg_002", ...],
  "overall_rating": 4,
  "tags": ["poor_lighting", "low_foot_traffic"],
  "mode": "walk",
  "user_hash": "abc123",
  "notes": "Great route overall, but block_2 felt sketchy",
  "timestamp": "2025-11-26T00:00:00Z",

  "segment_overrides": [
    { "segment_id": "seg_004", "rating": 2 },
    { "segment_id": "seg_005", "rating": 2 },
    { "segment_id": "seg_006", "rating": 2 },
    { "segment_id": "seg_007", "rating": 2 }
  ]
}
```

**Note:** Backend doesn't need to know about blocks - they're expanded to segment-level overrides on submission.

---

## Testing Strategy

### Unit Tests

**Block Computation:**
```javascript
// Test: 2.4 km route, 5 blocks → 480m per block
const blocks = computeRouteBlocks(routeCoords, segmentIds, segmentLookup, 5);
assert.equal(blocks.length, 5);
assert.equal(blocks[0].lengthMeters, 480);
assert.equal(blocks[4].distanceEnd, 2400);
```

**Segment Assignment:**
```javascript
// Test: Segment at 600m belongs to block_2 (480-960m range)
const block2 = blocks.find(b => b.distanceStart <= 600 && b.distanceEnd > 600);
assert.equal(block2.blockId, 'block_2');
```

### Integration Tests

**Modal Rendering:**
```javascript
// Test: Route with blocks shows block rows, not segment rows
const route = { properties: { blocks: [/* ... */] } };
openRatingModal({ routeFeature: route, segmentLookup, userHash, onSuccess });

const blockRows = document.querySelectorAll('[data-block-id]');
assert.equal(blockRows.length, 5); // Should have 5 block rows

const advancedDisclosure = document.querySelector('details');
assert.ok(advancedDisclosure); // Should have "Advanced" disclosure
```

**Payload Flattening:**
```javascript
// Test: Block override expands to all segments in block
state.blockOverrides.set('block_2', {
  blockId: 'block_2',
  segmentIds: ['seg_004', 'seg_005'],
  rating: 2,
});

const payload = buildPayload(state);
assert.equal(payload.segment_overrides.length, 2);
assert.deepEqual(payload.segment_overrides, [
  { segment_id: 'seg_004', rating: 2 },
  { segment_id: 'seg_005', rating: 2 },
]);
```

---

## Fallback & Compatibility

**Backward Compatibility:**

- Routes **without** `blocks` property fall back to current segment-based UI
- Existing `segment_overrides` in payloads continue to work (no schema change)
- Old route files don't break (graceful degradation)

**Migration Path:**

1. Deploy client-side code (block UI + fallback)
2. Regenerate demo routes with blocks (`npm run data:gen`)
3. Verify both old and new routes work in modal
4. (Optional) Backfill blocks for old route files via script

---

## Future Enhancements

### A) Interactive Block Selection

- User clicks map to select block (highlight block segments on hover)
- Map interaction replaces modal checkbox for override selection

### B) Dynamic Block Count

- Slider: "Group into 3-7 blocks" (user configures granularity)
- Longer routes (> 5 km) default to more blocks; short routes (< 1 km) default to fewer

### C) Time-Based Blocks

- For commuter routes: "Morning segment" vs. "Evening segment" based on time of day
- Requires temporal data integration (not in M3 scope)

---

## Implementation Checklist

- [ ] **Phase 1: Block Computation**
  - [ ] Add `computeRouteBlocks()` to generate_demo_data.mjs
  - [ ] Implement `findSegmentsInDistanceRange()` (distance tracking)
  - [ ] Implement `labelBlock()` (ordinal + street + distance)
  - [ ] Add `blocks` array to route properties in GeoJSON
  - [ ] Regenerate demo routes: `npm run data:gen`
  - [ ] Verify block count, labels, segment assignments

- [ ] **Phase 2: Modal UI**
  - [ ] Update `createSegmentOverrideSection()` to check for blocks
  - [ ] Implement `renderBlockRows()` (block-based UI)
  - [ ] Implement `createBlockRow()` (block checkbox + select)
  - [ ] Add `blockOverrides` to modal state
  - [ ] Implement `flattenBlockOverrides()` for payload
  - [ ] Add "Advanced: Override individual segments" disclosure
  - [ ] Style lowest-rated block (yellow border + background)

- [ ] **Phase 3: Testing**
  - [ ] Unit tests for block computation
  - [ ] Unit tests for payload flattening
  - [ ] Integration test: Block UI renders correctly
  - [ ] Integration test: Fallback to segment UI for old routes
  - [ ] Manual test: Submit block override, verify backend receives segment overrides

- [ ] **Phase 4: Documentation**
  - [ ] Update README.md with new route schema
  - [ ] Update API docs (if applicable) to note segment_overrides can be bulk-assigned
  - [ ] Add screenshot to CHANGELOG showing new block UI

---

**Design Complete**
**Ready for Codex Implementation (M3+)**
