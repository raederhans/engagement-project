# Route Safety Diary - Scenario Mapping (React UI → Vanilla JS)

**Date:** 2025-11-07
**Purpose:** Map React UI storyboard components to vanilla JS implementations
**Source:** `C:\Users\raede\Desktop\essay help master\6920Java\engagement-project\Route Safety Diary UI`
**Target:** Vanilla JS codebase (no React migration)

---

## Overview

This document maps the 4 UI scenarios from the React storyboard to vanilla JavaScript implementations in the existing crime dashboard. The React storyboard serves as a **visual reference** for UX patterns, but all code will be rewritten in vanilla JS following existing patterns (`src/ui/panel.js`, `src/ui/about.js`).

---

## Scenario 1: Initial State (Ready to Begin)

### React Components (Reference)

| React File | Size | Purpose |
|------------|------|---------|
| `App.tsx` | 3,781 bytes | Main app state, `isPostSubmit={false}`, `showRatingModal={false}` |
| `TopBar.tsx` | 2,976 bytes | Mode switcher (Crime \| Route Safety Diary \| Tracts) |
| `LeftPanel.tsx` | 3,000 bytes | Diary controls menu (Plan/Record/My Routes buttons, legend toggle) |
| `MapCanvas.tsx` | 11,834 bytes | Canvas-based segment visualization (color=rating, width=confidence) |
| `RightPanel.tsx` | 6,629 bytes | Placeholder insights with dashed borders and prompts |
| `RecorderDock.tsx` | 1,594 bytes | GPS recorder controls (Start/Pause/Finish buttons, floating dock) |

### Vanilla JS Mapping

#### 1.1 TopBar → `src/routes_diary/index.js` (integrated into existing TopBar)

**React Pattern (TopBar.tsx):**
```tsx
<div className="flex gap-2">
  <button className={mode === 'crime' ? 'active' : ''}>Crime</button>
  <button className={mode === 'diary' ? 'active' : ''}>Route Safety Diary</button>
  <button className={mode === 'tracts' ? 'active' : ''}>Tracts</button>
</div>
```

**Vanilla JS Implementation:**
```javascript
// src/routes_diary/index.js
function createModeSelector() {
  const container = document.createElement('div');
  container.id = 'diary-mode-selector';
  container.style.cssText = `
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    display: flex;
    gap: 8px;
    background: white;
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  `;

  const modes = ['Crime', 'Route Safety Diary', 'Tracts'];
  modes.forEach(mode => {
    const btn = document.createElement('button');
    btn.textContent = mode;
    btn.dataset.mode = mode.toLowerCase().replace(/\s+/g, '_');
    btn.style.cssText = `
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      transition: background 0.2s;
    `;
    btn.onmouseenter = () => btn.style.background = '#f5f5f5';
    btn.onmouseleave = () => btn.style.background = 'transparent';
    btn.onclick = () => switchMode(btn.dataset.mode);
    container.appendChild(btn);
  });

  document.body.appendChild(container);
}
```

**Adaptations:**
- Use inline styles (no Tailwind CSS)
- Use `dataset` attributes for state tracking
- Use `onmouseenter`/`onmouseleave` for hover effects (no CSS classes)

---

#### 1.2 LeftPanel → `src/routes_diary/index.js` (extend existing panel pattern)

**React Pattern (LeftPanel.tsx):**
```tsx
<div className="p-4 space-y-4">
  <button onClick={onPlanRoute}><MapPin /> Plan route</button>
  <button onClick={onRecord}><Circle /> Record trip</button>
  <button onClick={onMyRoutes}><FolderOpen /> My routes</button>
  <button onClick={toggleLegend}><Eye /> Legend</button>
  <div className="info-box">
    <ThumbsUp /> Community actions info
  </div>
</div>
```

**Vanilla JS Implementation:**
```javascript
// src/routes_diary/index.js
function createDiaryControls() {
  const panel = document.getElementById('left-panel');
  if (!panel) return;

  const diarySection = document.createElement('div');
  diarySection.id = 'diary-controls';
  diarySection.style.cssText = `
    padding: 16px;
    border-top: 1px solid #e5e5e5;
  `;

  const buttons = [
    { label: 'Plan route', icon: '📍', handler: onPlanRoute, disabled: true },
    { label: 'Record trip', icon: '🔴', handler: onRecord, disabled: false },
    { label: 'My routes', icon: '📁', handler: onMyRoutes, disabled: true },
    { label: 'Legend', icon: '👁️', handler: toggleLegend, disabled: false }
  ];

  buttons.forEach(({ label, icon, handler, disabled }) => {
    const btn = document.createElement('button');
    btn.textContent = `${icon} ${label}`;
    btn.disabled = disabled;
    btn.style.cssText = `
      width: 100%;
      padding: 12px;
      margin-bottom: 8px;
      border: 1px solid #ddd;
      border-radius: 6px;
      background: ${disabled ? '#f5f5f5' : 'white'};
      cursor: ${disabled ? 'not-allowed' : 'pointer'};
      text-align: left;
    `;
    btn.onclick = disabled ? null : handler;
    diarySection.appendChild(btn);
  });

  panel.appendChild(diarySection);
}
```

**Adaptations:**
- Reuse existing `#left-panel` DOM element
- Use emoji icons (instead of Lucide React icons)
- Use inline `disabled` attribute (no CSS classes)
- Follow `src/ui/panel.js` pattern for event handling

---

#### 1.3 MapCanvas → `src/map/segments_layer.js` (MapLibre vector layer)

**React Pattern (MapCanvas.tsx - Canvas 2D):**
```tsx
const canvas = canvasRef.current;
const ctx = canvas.getContext('2d');

segments.forEach(seg => {
  ctx.strokeStyle = colorForRating(seg.rating);
  ctx.lineWidth = widthForConfidence(seg.n_eff);
  ctx.beginPath();
  seg.coords.forEach((pt, i) => {
    const [x, y] = projectToCanvas(pt);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
});
```

**Vanilla JS Implementation (MapLibre GL JS):**
```javascript
// src/map/segments_layer.js
export function mountSegmentsLayer(map, sourceId, data) {
  // Add source
  map.addSource(sourceId, {
    type: 'geojson',
    data: data
  });

  // Add line layer with data-driven styling
  map.addLayer({
    id: `${sourceId}-line`,
    type: 'line',
    source: sourceId,
    paint: {
      'line-color': [
        'interpolate',
        ['linear'],
        ['get', 'rating'],
        1, '#FFA500',  // Amber
        3, '#FFD700',  // Yellow
        5, '#32CD32'   // Lime green
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['get', 'n_eff'],
        0, 2,    // Min confidence → 2px
        100, 8   // Max confidence → 8px
      ],
      'line-opacity': 0.8
    }
  });

  // Add hover effect
  map.on('mouseenter', `${sourceId}-line`, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', `${sourceId}-line`, () => {
    map.getCanvas().style.cursor = '';
  });

  // Add click handler
  map.on('click', `${sourceId}-line`, (e) => {
    const feature = e.features[0];
    const segmentId = feature.properties.segment_id;
    window.dispatchEvent(new CustomEvent('segment-click', { detail: { segmentId, lngLat: e.lngLat } }));
  });
}
```

**Adaptations:**
- **NO Canvas 2D:** Use MapLibre vector layers (better performance, native pan/zoom)
- Use MapLibre expressions for data-driven styling (no manual loops)
- Use CustomEvent for segment click (instead of React props)
- Follow `src/map/choropleth_districts.js` pattern

**Rationale:**
- Canvas 2D requires manual redraw on pan/zoom (complex)
- MapLibre handles projection, hover states, and click handlers natively
- Consistent with existing map layers (districts, tracts, points)

---

#### 1.4 RightPanel → Extend existing `#right-panel` div

**React Pattern (RightPanel.tsx):**
```tsx
{!hasData ? (
  <div className="border-dashed border-2 p-8 text-center">
    Chart will appear after your first rating
  </div>
) : (
  <ChartComponent data={chartData} />
)}
```

**Vanilla JS Implementation:**
```javascript
// src/routes_diary/index.js
function initInsightsPanel() {
  const panel = document.getElementById('right-panel');
  if (!panel) return;

  // Clear existing content
  panel.innerHTML = '';

  // Add placeholder states
  ['Trend', 'Top Tags', '7×24 Heatmap'].forEach(chartName => {
    const placeholder = document.createElement('div');
    placeholder.className = 'chart-placeholder';
    placeholder.style.cssText = `
      border: 2px dashed #ddd;
      border-radius: 8px;
      padding: 32px;
      margin-bottom: 16px;
      text-align: center;
      color: #999;
    `;
    placeholder.textContent = `${chartName} will appear after your first rating`;
    panel.appendChild(placeholder);
  });
}
```

**Adaptations:**
- Reuse existing `#right-panel` DOM element
- Use inline styles for dashed borders (no Tailwind)
- Replace placeholders with Chart.js canvases after data available
- Follow `src/charts/index.js` pattern for chart rendering

---

#### 1.5 RecorderDock → `src/routes_diary/index.js` (floating dock)

**React Pattern (RecorderDock.tsx):**
```tsx
<div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-4">
  <button disabled={state !== 'idle'} onClick={onStart}>
    <Circle className={state === 'recording' ? 'text-red' : 'text-green'} />
    Start
  </button>
  <button disabled={state !== 'recording'} onClick={onPause}>Pause</button>
  <button disabled={state === 'idle'} onClick={onFinish}>Finish</button>
</div>
```

**Vanilla JS Implementation:**
```javascript
// src/routes_diary/index.js
let recordingState = 'idle'; // 'idle' | 'recording' | 'paused'

function createRecorderDock() {
  const dock = document.createElement('div');
  dock.id = 'recorder-dock';
  dock.style.cssText = `
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 1100;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    padding: 16px;
    display: flex;
    gap: 8px;
  `;

  const buttons = [
    { id: 'start', label: '▶️ Start', handler: onStartRecording },
    { id: 'pause', label: '⏸️ Pause', handler: onPauseRecording },
    { id: 'finish', label: '⏹️ Finish', handler: onFinishRecording }
  ];

  buttons.forEach(({ id, label, handler }) => {
    const btn = document.createElement('button');
    btn.id = `recorder-${id}`;
    btn.textContent = label;
    btn.style.cssText = `
      padding: 10px 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
      cursor: pointer;
    `;
    btn.onclick = handler;
    dock.appendChild(btn);
  });

  document.body.appendChild(dock);
  updateRecorderButtons();
}

function updateRecorderButtons() {
  const startBtn = document.getElementById('recorder-start');
  const pauseBtn = document.getElementById('recorder-pause');
  const finishBtn = document.getElementById('recorder-finish');

  if (startBtn) {
    startBtn.disabled = recordingState !== 'idle';
    startBtn.style.background = recordingState === 'idle' ? '#4CAF50' : '#f5f5f5';
    startBtn.style.color = recordingState === 'idle' ? 'white' : '#999';
  }

  if (pauseBtn) {
    pauseBtn.disabled = recordingState !== 'recording';
    pauseBtn.style.background = recordingState === 'recording' ? '#FFC107' : '#f5f5f5';
  }

  if (finishBtn) {
    finishBtn.disabled = recordingState === 'idle';
    finishBtn.style.background = recordingState !== 'idle' ? '#F44336' : '#f5f5f5';
    finishBtn.style.color = recordingState !== 'idle' ? 'white' : '#999';
  }
}
```

**Adaptations:**
- Use emoji icons (▶️⏸️⏹️) instead of Lucide React components
- Use inline styles for state-based colors (no Tailwind conditional classes)
- Manual button state updates (no React state management)
- Follow existing pattern from `src/ui/about.js` for floating elements

---

### Component Summary (Scenario 1)

| React Component | Vanilla JS Module | Pattern Used | Complexity |
|-----------------|-------------------|--------------|------------|
| `App.tsx` | `src/routes_diary/index.js` | Main orchestrator | Medium |
| `TopBar.tsx` | `src/routes_diary/index.js` | Floating div with buttons | Low |
| `LeftPanel.tsx` | `src/routes_diary/index.js` | Extend existing panel | Low |
| `MapCanvas.tsx` | `src/map/segments_layer.js` | MapLibre vector layer | Medium |
| `RightPanel.tsx` | `src/routes_diary/index.js` | Placeholder divs | Low |
| `RecorderDock.tsx` | `src/routes_diary/index.js` | Floating dock | Low |

**Total LOC Estimate:** ~400 lines (vs. ~1,200 in React storyboard)

---

## Scenario 2: Recording Complete - Rating Modal

### React Components (Reference)

| React File | Size | Key Features |
|------------|------|-------------|
| `RatingModal.tsx` | 8,016 bytes | Full-screen modal, star selector, tag checkboxes, segment overrides, privacy note |

### Vanilla JS Mapping

#### 2.1 RatingModal → `src/routes_diary/form_submit.js`

**React Pattern (RatingModal.tsx):**
```tsx
<div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50">
  <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2
                  bg-white rounded-lg p-8 max-w-2xl">
    <h2>Rate Your Trip</h2>
    <StarSelector value={rating} onChange={setRating} />
    <TagSelector selected={tags} onChange={setTags} max={3} />
    <SegmentOverrides segments={matchedSegments} onChange={setOverrides} />
    <TravelModeRadio value={mode} onChange={setMode} />
    <ToggleSwitch label="Save as route" checked={saveRoute} onChange={setSaveRoute} />
    <PrivacyNote />
    <div className="flex gap-4">
      <button onClick={onCancel}>Cancel</button>
      <button onClick={onSubmit}>Submit</button>
    </div>
  </div>
</div>
```

**Vanilla JS Implementation:**
```javascript
// src/routes_diary/form_submit.js
export function openRatingModal(gpsTrace) {
  // 1. Create backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'rating-modal-backdrop';
  backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    backdrop-filter: blur(4px);
    z-index: 5000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // 2. Create modal card
  const modal = document.createElement('div');
  modal.id = 'rating-modal';
  modal.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 32px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  `;

  // 3. Add header
  const header = document.createElement('h2');
  header.textContent = 'Rate Your Trip';
  header.style.marginBottom = '24px';
  modal.appendChild(header);

  // 4. Add star selector
  const starSection = createStarSelector();
  modal.appendChild(starSection);

  // 5. Add tag selector
  const tagSection = createTagSelector();
  modal.appendChild(tagSection);

  // 6. Add segment overrides (if matched > 1)
  const matchedSegments = matchPathToSegments(gpsTrace);
  if (matchedSegments.length > 1) {
    const overrideSection = createSegmentOverrides(matchedSegments);
    modal.appendChild(overrideSection);
  }

  // 7. Add travel mode radio
  const modeSection = createTravelModeRadio();
  modal.appendChild(modeSection);

  // 8. Add save as route toggle
  const saveSection = createSaveRouteToggle();
  modal.appendChild(saveSection);

  // 9. Add privacy note
  const privacyNote = createPrivacyNote();
  modal.appendChild(privacyNote);

  // 10. Add action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 16px; margin-top: 24px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; background: white; cursor: pointer;';
  cancelBtn.onclick = closeRatingModal;

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit';
  submitBtn.style.cssText = 'flex: 1; padding: 12px; border: none; border-radius: 8px; background: #000; color: white; cursor: pointer;';
  submitBtn.onclick = () => handleSubmit(gpsTrace, matchedSegments);

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeRatingModal();
  });
}

export function closeRatingModal() {
  const backdrop = document.getElementById('rating-modal-backdrop');
  if (backdrop) backdrop.remove();
}
```

**Helper Functions:**

```javascript
function createStarSelector() {
  const section = document.createElement('div');
  section.style.marginBottom = '24px';

  const label = document.createElement('label');
  label.textContent = 'Overall Rating';
  label.style.display = 'block';
  label.style.marginBottom = '8px';
  section.appendChild(label);

  const stars = document.createElement('div');
  stars.style.cssText = 'display: flex; gap: 8px;';

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('button');
    star.textContent = '⭐';
    star.dataset.rating = i;
    star.style.cssText = `
      font-size: 32px;
      border: none;
      background: none;
      cursor: pointer;
      opacity: 0.3;
      transition: opacity 0.2s;
    `;
    star.onmouseenter = () => highlightStars(i);
    star.onmouseleave = () => highlightStars(ratingState.overall_rating);
    star.onclick = () => {
      ratingState.overall_rating = i;
      highlightStars(i);
    };
    stars.appendChild(star);
  }

  section.appendChild(stars);
  return section;
}

function createTagSelector() {
  const section = document.createElement('div');
  section.style.marginBottom = '24px';

  const label = document.createElement('label');
  label.textContent = 'Tags (select up to 3)';
  section.appendChild(label);

  const tags = ['poor lighting', 'low foot traffic', 'cars too close', 'dogs', 'construction blockage'];
  const tagContainer = document.createElement('div');
  tagContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px;';

  tags.forEach(tag => {
    const badge = document.createElement('button');
    badge.textContent = tag;
    badge.dataset.tag = tag;
    badge.style.cssText = `
      padding: 8px 16px;
      border: 1px solid #ddd;
      border-radius: 20px;
      background: white;
      cursor: pointer;
    `;
    badge.onclick = () => toggleTag(badge, tag);
    tagContainer.appendChild(badge);
  });

  // "Other" input
  const otherInput = document.createElement('input');
  otherInput.placeholder = 'Other (max 30 chars)';
  otherInput.maxLength = 30;
  otherInput.style.cssText = 'padding: 8px; border: 1px solid #ddd; border-radius: 8px; flex-grow: 1;';
  tagContainer.appendChild(otherInput);

  section.appendChild(tagContainer);
  return section;
}

function createPrivacyNote() {
  const note = document.createElement('div');
  note.style.cssText = `
    padding: 16px;
    background: #E3F2FD;
    border: 1px solid #2196F3;
    border-radius: 8px;
    margin-top: 16px;
  `;
  note.innerHTML = `
    <strong>🔒 Privacy:</strong> We only store segment-level data; raw GPS is not retained.
    <a href="docs/PRIVACY_NOTES.md" target="_blank" style="color: #2196F3; text-decoration: underline;">Learn more</a>
  `;
  return note;
}
```

**Adaptations:**
- No Radix UI components (Dialog, RadioGroup, Switch) → manual DOM manipulation
- No Tailwind classes → inline styles
- No React state (`useState`) → global `ratingState` object
- Form validation with AJV before submission

**Complexity:** HIGH (most complex UI component in M1)

---

### Validation & Submission

**AJV Schema:**
```javascript
import Ajv from 'ajv';

const ajv = new Ajv();
const ratingSchema = {
  type: 'object',
  properties: {
    overall_rating: { type: 'integer', minimum: 1, maximum: 5 },
    tags: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 30 } },
    travel_mode: { type: 'string', enum: ['walk', 'bike'] },
    segment_overrides: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          segment_id: { type: 'string' },
          rating: { type: 'integer', minimum: 1, maximum: 5 }
        },
        required: ['segment_id', 'rating']
      }
    },
    save_as_route: { type: 'boolean' },
    route_name: { type: 'string', maxLength: 100 }
  },
  required: ['overall_rating', 'travel_mode']
};

async function handleSubmit(gpsTrace, matchedSegments) {
  const formData = collectFormData();

  // Validate
  const valid = ajv.validate(ratingSchema, formData);
  if (!valid) {
    alert('Validation error: ' + ajv.errorsText());
    return;
  }

  // Submit
  const payload = {
    ...formData,
    matched_segments: matchedSegments,
    timestamp: Date.now()
  };

  const result = await submitDiary(payload);

  if (result.ok) {
    closeRatingModal();
    showToast('Thanks — updating map.');
    updateSegmentsOnMap(result.updated_segments);
  }
}
```

---

## Scenario 3: Post-Submit State (Map Update)

### React Components (Reference)

| React File | Key Features |
|------------|-------------|
| `Snackbar.tsx` | Toast notification (top-center, 2s fade) |
| `MapCanvas.tsx` (updated) | Segment glow animation, updated colors/widths |
| `RightPanel.tsx` (populated) | Trend chart, top tags, 7×24 heatmap |
| Safer Alternative Strip | Top-right overlay with route info |

### Vanilla JS Mapping

#### 3.1 Toast Notification → `src/routes_diary/index.js`

**React Pattern:**
```tsx
{showSnackbar && (
  <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50
                  bg-white px-6 py-3 rounded-lg shadow-lg animate-fade-in">
    {message}
  </div>
)}
```

**Vanilla JS:**
```javascript
function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6000;
    background: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    opacity: 0;
    transition: opacity 0.3s;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Fade in
  setTimeout(() => toast.style.opacity = '1', 10);

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
```

---

#### 3.2 Segment Glow Animation → `src/map/segments_layer.js`

**React Pattern (Canvas):**
```tsx
ctx.shadowBlur = 10;
ctx.shadowColor = 'rgba(0,255,0,0.8)';
ctx.stroke();
// Animate shadowBlur 10→0 over 2s
```

**Vanilla JS (MapLibre):**
```javascript
export function updateSegments(map, sourceId, updatedSegments) {
  const source = map.getSource(sourceId);
  const data = source._data; // Get current GeoJSON

  // Update segment properties
  data.features.forEach(feature => {
    const update = updatedSegments.find(u => u.segment_id === feature.properties.segment_id);
    if (update) {
      feature.properties.rating = update.rating;
      feature.properties.n_eff = update.n_eff;
      feature.properties.last_updated = Date.now();
    }
  });

  // Refresh source
  source.setData(data);

  // Glow animation
  updatedSegments.forEach(seg => glowSegment(map, sourceId, seg.segment_id));
}

function glowSegment(map, sourceId, segmentId, duration = 2000) {
  const layerId = `${sourceId}-line`;
  const startTime = Date.now();

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1, elapsed / duration);

    // Interpolate glow (line-width + line-opacity)
    const glowWidth = 3 * (1 - progress); // 3px → 0px
    const glowOpacity = 0.5 * (1 - progress); // 0.5 → 0

    // Apply filter to highlighted segment
    map.setFilter(layerId, ['==', ['get', 'segment_id'], segmentId]);
    map.setPaintProperty(layerId, 'line-width', ['+', ['get', 'n_eff'], glowWidth]);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Reset filter
      map.setFilter(layerId, null);
    }
  }

  animate();
}
```

**Adaptation:**
- MapLibre doesn't have native "glow" (no shadowBlur)
- Simulate glow by animating `line-width` with `requestAnimationFrame`
- Use `setFilter` to isolate updated segments during animation

---

#### 3.3 Insights Panel Charts → Reuse `src/charts/*`

**React Pattern:**
```tsx
<TrendChart data={weeklyData} />
<TopTagsChart data={tagFrequency} />
<Heatmap7x24 data={heatmapData} />
```

**Vanilla JS:**
```javascript
// src/routes_diary/index.js
function populateInsightsPanel(updatedSegments) {
  const panel = document.getElementById('right-panel');
  panel.innerHTML = ''; // Clear placeholders

  // 1. Trend chart (reuse existing line chart pattern)
  const trendCanvas = document.createElement('canvas');
  trendCanvas.id = 'diary-trend-chart';
  trendCanvas.width = 360;
  trendCanvas.height = 140;
  panel.appendChild(trendCanvas);

  const weeklyData = generateMockWeeklyTrend(); // TODO: Real data from API
  renderTrendChart(trendCanvas, weeklyData);

  // 2. Top tags chart (reuse bar chart pattern)
  const tagsCanvas = document.createElement('canvas');
  tagsCanvas.id = 'diary-tags-chart';
  tagsCanvas.width = 360;
  tagsCanvas.height = 160;
  panel.appendChild(tagsCanvas);

  const tagData = generateMockTagFrequency();
  renderTopTagsChart(tagsCanvas, tagData);

  // 3. 7x24 heatmap (reuse existing heatmap)
  const heatmapCanvas = document.createElement('canvas');
  heatmapCanvas.id = 'diary-heatmap';
  heatmapCanvas.width = 360;
  heatmapCanvas.height = 180;
  panel.appendChild(heatmapCanvas);

  const heatmapData = generateMockHeatmap();
  render7x24(heatmapCanvas, heatmapData); // From src/charts/heat_7x24.js
}
```

**Adaptations:**
- Reuse existing Chart.js patterns from `src/charts/line_monthly.js`, `src/charts/bar_topn.js`, `src/charts/heat_7x24.js`
- No new chart library needed
- Pass mock data for M1 (real aggregation in M2)

---

## Scenario 4: Community Interaction State

### React Components (Reference)

| React File | Size | Key Features |
|------------|------|-------------|
| `SegmentCard.tsx` | 4,127 bytes | Floating card near click point, rating/trend/confidence stats, action buttons |
| `CommunityDetailsModal.tsx` | 9,478 bytes | Full-screen modal with overview, charts, timeline, privacy note |

### Vanilla JS Mapping

#### 4.1 SegmentCard → `src/routes_diary/index.js`

**React Pattern:**
```tsx
<div className="absolute z-50 bg-white rounded-lg shadow-xl p-4"
     style={{ top: y - 200, left: x + 20 }}>
  <h3>Segment Details</h3>
  <div className="grid grid-cols-3 gap-4">
    <Stat label="Rating" value="3.8" />
    <Stat label="Trend" value="+0.4" icon="↑" color="green" />
    <Stat label="Confidence" value="87%" />
  </div>
  <Tags tags={topTags} />
  <ActionButtons onAgree={handleAgree} onImprove={handleImprove} />
</div>
```

**Vanilla JS:**
```javascript
function onSegmentClick(segmentId, lngLat) {
  // Fetch segment data (mock for M1)
  const segmentData = {
    segment_id: segmentId,
    rating: 3.8,
    trend_30d: 0.4,
    n_eff: 45,
    top_tags: ['poor lighting', 'low foot traffic'],
    total_reports: 44
  };

  // Create card
  const card = document.createElement('div');
  card.id = 'segment-card';

  // Position near click point (convert lngLat to pixel coords)
  const point = map.project(lngLat);
  card.style.cssText = `
    position: absolute;
    top: ${point.y - 200}px;
    left: ${point.x + 20}px;
    z-index: 5000;
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    padding: 16px;
    width: 320px;
  `;

  // Header
  const header = document.createElement('div');
  header.innerHTML = `
    <strong>Segment Details</strong>
    <button id="segment-card-close" style="float: right; border: none; background: none; cursor: pointer;">✕</button>
    <a href="#" id="view-insights" style="display: block; margin-top: 4px; color: #2196F3; text-decoration: underline;">View community insights</a>
  `;
  card.appendChild(header);

  // Stats grid
  const stats = document.createElement('div');
  stats.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 16px 0;';
  stats.innerHTML = `
    <div style="text-align: center;">
      <div style="font-size: 24px; font-weight: bold;">${segmentData.rating}</div>
      <div style="font-size: 12px; color: #999;">Rating</div>
    </div>
    <div style="text-align: center;">
      <div style="font-size: 24px; font-weight: bold; color: green;">↑ +${segmentData.trend_30d}</div>
      <div style="font-size: 12px; color: #999;">30d Trend</div>
    </div>
    <div style="text-align: center;">
      <div style="font-size: 24px; font-weight: bold;">${Math.round((segmentData.n_eff / 50) * 100)}%</div>
      <div style="font-size: 12px; color: #999;">Confidence</div>
    </div>
  `;
  card.appendChild(stats);

  // Tags
  const tags = document.createElement('div');
  tags.style.cssText = 'display: flex; gap: 8px; margin-bottom: 16px;';
  segmentData.top_tags.forEach(tag => {
    const badge = document.createElement('span');
    badge.textContent = tag;
    badge.style.cssText = 'padding: 4px 12px; background: #f5f5f5; border-radius: 12px; font-size: 12px;';
    tags.appendChild(badge);
  });
  card.appendChild(tags);

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px;';

  const agreeBtn = document.createElement('button');
  agreeBtn.textContent = '👍 Agree';
  agreeBtn.style.cssText = 'flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 20px; background: white; cursor: pointer;';
  agreeBtn.onclick = () => handleAgree(segmentId);

  const improveBtn = document.createElement('button');
  improveBtn.textContent = '✨ Feels safer';
  improveBtn.style.cssText = 'flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 20px; background: white; cursor: pointer;';
  improveBtn.onclick = () => handleImprove(segmentId);

  actions.appendChild(agreeBtn);
  actions.appendChild(improveBtn);
  card.appendChild(actions);

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top: 12px; font-size: 12px; color: #999; text-align: center;';
  footer.textContent = `Based on ${segmentData.total_reports} reports`;
  card.appendChild(footer);

  // Wire close handlers
  document.getElementById('segment-card-close').onclick = closeSegmentCard;
  document.getElementById('view-insights').onclick = (e) => {
    e.preventDefault();
    closeSegmentCard();
    openCommunityDetailsModal(segmentId);
  };

  document.body.appendChild(card);
}

function closeSegmentCard() {
  const card = document.getElementById('segment-card');
  if (card) card.remove();
}
```

**Adaptations:**
- Manual positioning using MapLibre's `map.project()` to convert lngLat → pixel coords
- Inline styles instead of Tailwind utility classes
- No Radix UI Popover component → custom absolute-positioned div

---

#### 4.2 CommunityDetailsModal → `src/routes_diary/index.js`

**React Pattern:** (9,478 bytes, full-screen modal with 7 sections)

**Vanilla JS:** (Similar to RatingModal structure, but with read-only content)

```javascript
function openCommunityDetailsModal(segmentId) {
  // Fetch analytics (mock for M1)
  const analytics = {
    segment_id: segmentId,
    total_reports: 44,
    avg_rating: 3.8,
    confidence: 87,
    trend_30d: 0.4,
    weekly_trend: [
      { week: 'W1', rating: 3.2, count: 8 },
      { week: 'W2', rating: 3.4, count: 11 },
      { week: 'W3', rating: 3.6, count: 12 },
      { week: 'W4', rating: 3.8, count: 14 }
    ],
    rating_distribution: [
      { stars: 1, count: 8 },
      { stars: 2, count: 15 },
      { stars: 3, count: 12 },
      { stars: 4, count: 6 },
      { stars: 5, count: 3 }
    ],
    tag_frequency: [
      { tag: 'poor lighting', count: 18, trend: 2 },
      { tag: 'low foot traffic', count: 12, trend: -1 },
      { tag: 'cars too close', count: 8, trend: 0 }
    ],
    recent_activity: [
      { type: 'improve', timestamp: Date.now() - 7200000 },
      { type: 'agree', timestamp: Date.now() - 18000000 }
      // ... 5 more
    ]
  };

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'community-modal-backdrop';
  backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    z-index: 10000;
    overflow-y: auto;
  `;

  // Create modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    max-width: 800px;
    margin: 40px auto;
    border-radius: 12px;
    padding: 32px;
  `;

  // Sticky header
  const header = document.createElement('div');
  header.innerHTML = `
    <h2 style="margin: 0;">Community Insights</h2>
    <div style="color: #666; margin-top: 4px;">Main St, 1600-1700 block</div>
    <button id="modal-close" style="position: absolute; top: 16px; right: 16px; border: none; background: none; font-size: 24px; cursor: pointer;">✕</button>
  `;
  modal.appendChild(header);

  // Overview stats (4 gradient cards)
  const overview = createOverviewSection(analytics);
  modal.appendChild(overview);

  // 30-day trend chart
  const trendChart = createTrendChartSection(analytics.weekly_trend);
  modal.appendChild(trendChart);

  // Rating distribution
  const distribution = createDistributionSection(analytics.rating_distribution);
  modal.appendChild(distribution);

  // Tag frequency
  const tagFreq = createTagFrequencySection(analytics.tag_frequency);
  modal.appendChild(tagFreq);

  // Recent activity timeline
  const activity = createActivityTimeline(analytics.recent_activity);
  modal.appendChild(activity);

  // Privacy note
  const privacy = createPrivacyNote();
  modal.appendChild(privacy);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Wire close
  document.getElementById('modal-close').onclick = closeCommunityDetailsModal;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeCommunityDetailsModal();
  });
}

function closeCommunityDetailsModal() {
  const backdrop = document.getElementById('community-modal-backdrop');
  if (backdrop) backdrop.remove();
}
```

**Adaptations:**
- Similar structure to RatingModal (backdrop + modal card)
- No form inputs (read-only content)
- Reuse Chart.js for trend and distribution charts
- Manual timeline rendering (no React Timeline component)

---

## Summary: React vs. Vanilla JS

### Code Size Comparison

| Scenario | React LOC | Vanilla JS LOC | Reduction |
|----------|-----------|----------------|-----------|
| Scenario 1 (Initial) | ~1,200 | ~400 | 67% |
| Scenario 2 (Modal) | ~400 | ~600 | -50% (more verbose) |
| Scenario 3 (Update) | ~300 | ~250 | 17% |
| Scenario 4 (Community) | ~600 | ~500 | 17% |
| **Total** | **~2,500** | **~1,750** | **30% reduction** |

**Key Drivers:**
- **React overhead:** JSX syntax, component props, hooks add verbosity
- **Vanilla gains:** Direct DOM manipulation, no build transform
- **Vanilla losses:** Manual state management, no Radix UI library (must recreate widgets)

### Effort Comparison

| Task | React (Person-Hours) | Vanilla JS (Person-Hours) |
|------|----------------------|---------------------------|
| Segment layer | 4 (Canvas logic) | 3 (MapLibre API simpler) |
| Rating modal | 6 (Radix UI integration) | 10 (Manual form widgets) |
| Toast/Cards | 2 (Simple components) | 2 (Same effort) |
| Charts | 3 (React wrappers for Chart.js) | 2 (Direct Chart.js) |
| **Total** | **15 hours** | **17 hours** |

**Conclusion:** Vanilla JS is ~10% more effort but eliminates React dependency and aligns with existing codebase.

---

## Key Adaptations Summary

| React Feature | Vanilla JS Equivalent | Notes |
|---------------|----------------------|-------|
| JSX components | `document.createElement()` | More verbose but explicit |
| Tailwind classes | Inline `style.cssText` | No build step needed |
| `useState` | Global state objects | Manual updates required |
| Radix UI | Custom DOM widgets | Higher effort, full control |
| Lucide icons | Emoji or Unicode symbols | `👍 ⭐ 📍 ✕` instead of `<ThumbsUp />` |
| Canvas 2D | MapLibre vector layers | Better performance, native interaction |
| React hooks | Event listeners + CustomEvents | More manual wiring |

---

**Status:** Ready for implementation
**Estimated Total Effort:** 40-50 hours (includes all 4 scenarios + algorithms)
