# Charts Panel Responsive Height — Layout Audit + Fix Plan

**Status**: Ready for implementation
**Priority**: P2 (UX enhancement, not blocking)
**Issue**: Top line chart cramped on smaller viewports, charts panel needs self-adjusting heights

---

## Current State Analysis

### Container Structure

**File**: [index.html:132-143](../index.html#L132-L143)

```html
<div id="charts" style="position:fixed; right:12px; top:12px; z-index:15; width:420px; max-height:80vh; overflow:auto; background:rgba(255,255,255,0.95); padding:10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15)">
  <div style="font:600 13px/1.2 system-ui, sans-serif; margin:4px 0 8px;">Charts</div>
  <div style="margin-bottom:10px">
    <canvas id="chart-monthly" height="140"></canvas>
  </div>
  <div style="margin-bottom:10px">
    <canvas id="chart-topn" height="160"></canvas>
  </div>
  <div>
    <canvas id="chart-7x24" height="180"></canvas>
  </div>
</div>
```

**Properties**:
- **Container**: `max-height: 80vh; overflow: auto;`
- **Canvas Heights**: Fixed pixels (140, 160, 180 = 480px total + padding/margins)
- **Width**: Fixed 420px

**Problem**: On a 768p display (1366×768):
- Available height: ~768px × 0.80 = 614px
- Required height: 480px + 60px (padding/margins/title) = 540px
- **Result**: Charts fit, but cramped (no breathing room, scrollbar on smaller screens)

---

### Chart.js Configuration

**Files**:
- [src/charts/line_monthly.js:40](../src/charts/line_monthly.js#L40)
- [src/charts/bar_topn.js:26](../src/charts/bar_topn.js#L26)
- [src/charts/heat_7x24.js:46](../src/charts/heat_7x24.js#L46)

All charts already have:
```javascript
maintainAspectRatio: false,
```

**Status**: ✅ Charts **can** resize dynamically (aspect ratio not locked).

---

## Recommended Solution: CSS Grid with Dynamic Heights

### Strategy

Use CSS Grid to distribute available height proportionally among charts, with sensible min/max constraints.

### Implementation

---

#### A) Refactor Container to CSS Grid

**File**: `index.html` (lines 132-143)

**Before**:
```html
<div id="charts" style="position:fixed; right:12px; top:12px; z-index:15; width:420px; max-height:80vh; overflow:auto; background:rgba(255,255,255,0.95); padding:10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15)">
```

**After**:
```html
<div id="charts" class="charts-panel" style="position:fixed; right:12px; top:12px; z-index:15; width:420px; background:rgba(255,255,255,0.95); padding:10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15)">
```

**Add to `<style>` block** (after legend styles):

```css
/* Charts panel responsive grid */
.charts-panel {
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden; /* No scroll by default */
}

.charts-panel .chart-title {
  font: 600 13px/1.2 system-ui, sans-serif;
  margin: 4px 0 8px;
  flex-shrink: 0; /* Don't compress title */
}

.charts-panel .chart-container {
  flex: 1 1 auto; /* Grow/shrink equally */
  min-height: 120px; /* Minimum usable height */
  max-height: 240px; /* Maximum to prevent overgrowth */
  position: relative;
}

/* Specific constraints for each chart type */
.charts-panel .chart-container.monthly {
  flex-basis: 30%; /* Monthly gets 30% of available space */
  min-height: 140px;
}

.charts-panel .chart-container.topn {
  flex-basis: 28%; /* Top-N gets 28% */
  min-height: 140px;
}

.charts-panel .chart-container.heatmap {
  flex-basis: 32%; /* Heatmap gets 32% (largest) */
  min-height: 160px;
}

/* Canvas fills container */
.charts-panel canvas {
  width: 100% !important;
  height: 100% !important;
}

/* Responsive adjustments */
@media (max-width: 1440px) {
  .charts-panel {
    max-height: 75vh; /* Reduce on smaller screens */
  }
}

@media (max-width: 1024px) {
  .charts-panel {
    max-height: 70vh;
    width: 380px; /* Narrow container */
  }
}

@media (max-width: 768px) {
  .charts-panel {
    max-height: 60vh;
    width: 100%;
    left: 0;
    right: 0;
    top: auto;
    bottom: 0; /* Move to bottom on mobile */
    border-radius: 8px 8px 0 0;
  }

  .charts-panel .chart-container {
    min-height: 100px; /* Smaller minimums on mobile */
  }
}
```

---

#### B) Update HTML Structure

**File**: `index.html` (lines 133-142)

**Before**:
```html
<div style="font:600 13px/1.2 system-ui, sans-serif; margin:4px 0 8px;">Charts</div>
<div style="margin-bottom:10px">
  <canvas id="chart-monthly" height="140"></canvas>
</div>
<div style="margin-bottom:10px">
  <canvas id="chart-topn" height="160"></canvas>
</div>
<div>
  <canvas id="chart-7x24" height="180"></canvas>
</div>
```

**After**:
```html
<div class="chart-title">Charts</div>
<div class="chart-container monthly">
  <canvas id="chart-monthly"></canvas>
</div>
<div class="chart-container topn">
  <canvas id="chart-topn"></canvas>
</div>
<div class="chart-container heatmap">
  <canvas id="chart-7x24"></canvas>
</div>
```

**Key Changes**:
1. Removed `height` attributes from `<canvas>` (CSS controls sizing now)
2. Removed `margin-bottom` inline styles (CSS gap handles spacing)
3. Added semantic class names (`monthly`, `topn`, `heatmap`)

---

#### C) Ensure Chart.js Respects Container Size

**Files**: `src/charts/line_monthly.js`, `bar_topn.js`, `heat_7x24.js`

**Verify** (already present):
```javascript
options: {
  responsive: true,
  maintainAspectRatio: false, // ← Critical for flex sizing
  // ...
}
```

**Add Resize Observer** (optional, for dynamic updates):

**File**: `src/charts/index.js` (after chart render calls)

```javascript
// Optional: Force chart resize on window resize
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    // Chart.js auto-resizes when responsive:true and container changes
    // This timeout prevents excessive reflows during resize
  }, 150);
});
```

**Note**: Chart.js already handles resize automatically when `responsive: true`. No manual `.resize()` call needed.

---

## Alternative: JavaScript Height Calculation (Fallback)

If CSS Grid doesn't provide enough control, use JavaScript to calculate heights dynamically.

### Implementation

**File**: `src/charts/index.js` (at top of `updateAllCharts`)

```javascript
export async function updateAllCharts({ start, end, types = [], drilldownCodes = [], center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID }) {
  // Calculate available height for charts
  const chartsPanel = document.getElementById('charts');
  if (chartsPanel) {
    const availableHeight = window.innerHeight * 0.80; // 80vh
    const titleHeight = 30; // Approximate
    const padding = 40; // Total padding/margins
    const gaps = 20; // 10px × 2 gaps
    const chartableHeight = availableHeight - titleHeight - padding - gaps;

    // Distribute: 30% monthly, 28% topN, 32% heatmap (adjusted for min heights)
    const monthlyHeight = Math.max(140, chartableHeight * 0.30);
    const topnHeight = Math.max(140, chartableHeight * 0.28);
    const heatmapHeight = Math.max(160, chartableHeight * 0.32);

    // Set CSS custom properties
    chartsPanel.style.setProperty('--monthly-height', `${monthlyHeight}px`);
    chartsPanel.style.setProperty('--topn-height', `${topnHeight}px`);
    chartsPanel.style.setProperty('--heatmap-height', `${heatmapHeight}px`);
  }

  try {
    // ... rest of chart rendering
  }
}
```

**CSS Update** (use custom properties):

```css
.chart-container.monthly {
  height: var(--monthly-height, 140px);
}

.chart-container.topn {
  height: var(--topn-height, 160px);
}

.chart-container.heatmap {
  height: var(--heatmap-height, 180px);
}
```

**Pros**:
- Precise control over height distribution
- Can adjust based on content (e.g., if heatmap data is sparse, give more to monthly)

**Cons**:
- More complex than pure CSS
- Requires window resize listener for updates

---

## Recommended Approach

**Primary**: CSS Grid (Option A)
- ✅ Simpler (no JS)
- ✅ Leverages browser layout engine
- ✅ Automatically handles viewport changes

**Fallback**: JavaScript calc (Option B)
- Use only if CSS Grid proves insufficient (e.g., charts need content-aware sizing)

---

## Acceptance Criteria

### AC1: Charts Fit on 768p Display ✅

**Steps**:
1. Open dashboard on 1366×768 screen (or browser window resized to 768px height)
2. Observe charts panel

**Expected**:
- All 3 charts visible **without scrollbar**
- No charts truncated or labels cut off
- Adequate spacing between charts (10px gap)

**Viewport Height Calculation**:
- 768px × 80% = 614px available
- Title: 30px
- Padding: 20px (top/bottom)
- Gaps: 20px (2×10px)
- Chartable: 614 - 70 = 544px
- Distribution: Monthly 163px (30%), Top-N 152px (28%), Heatmap 174px (32%)

**Result**: All charts comfortably fit with room to spare.

---

### AC2: Charts Resize on Window Resize ✅

**Steps**:
1. Open dashboard on desktop (e.g., 1920×1080)
2. Resize browser window to narrower/shorter dimensions
3. Observe charts panel

**Expected**:
- Charts **dynamically adjust** height as window shrinks
- No layout jumps or broken rendering
- Smooth resize (no flickering)

**Mechanism**: Chart.js `responsive: true` + CSS flexbox triggers auto-resize on container size change.

---

### AC3: Mobile Layout (≤768px) ✅

**Steps**:
1. Open dashboard on mobile device or browser dev tools (mobile emulation)
2. Viewport width ≤768px

**Expected**:
- Charts panel moves to **bottom of screen** (full-width)
- Charts stack vertically with reduced heights (100px min)
- Panel becomes scrollable if needed (60vh max-height)
- Border-radius only on top corners (rounded top, flat bottom)

**CSS Rule**: `@media (max-width: 768px)` repositions panel to bottom.

---

### AC4: No Chart Label Truncation ✅

**Steps**:
1. Populate charts with data (any time window/offense filter)
2. Check all chart elements:
   - Monthly line: X-axis month labels, Y-axis counts, legend
   - Top-N bar: X-axis offense names, Y-axis counts
   - 7×24 heatmap: Hour/day labels, color legend

**Expected**:
- All labels readable (not cut off)
- No overlap between chart elements
- Adequate padding around edges

**Chart.js Options** (verify present):
```javascript
options: {
  layout: {
    padding: { left: 10, right: 10, top: 10, bottom: 10 }
  }
}
```

---

### AC5: 1080p Display (Large Viewport) ✅

**Steps**:
1. Open dashboard on 1920×1080 screen
2. Observe charts panel

**Expected**:
- Charts use full 80vh (864px available)
- Heights: Monthly ~260px, Top-N ~240px, Heatmap ~280px
- No excessive white space
- Charts don't exceed `max-height: 240px` constraint (prevents overgrowth)

---

## Files to Modify

| File | Changes | Lines | Effort |
|------|---------|-------|--------|
| **index.html** | Add CSS Grid styles, refactor chart containers | 11-20 (CSS), 132-143 (HTML) | 20 min |
| **src/charts/index.js** | (Optional) Add JS height calc | +20 lines | 15 min (if needed) |

**Total Effort**: ~20-35 minutes (CSS only) or ~35-50 minutes (with JS fallback)

---

## Pseudo-Diff

### Option A: CSS Grid (Recommended)

**index.html** — Add to `<style>` block after legend styles:

```diff
+/* Charts panel responsive grid */
+.charts-panel {
+  max-height: 80vh;
+  display: flex;
+  flex-direction: column;
+  gap: 10px;
+  overflow: hidden;
+}
+
+.charts-panel .chart-title {
+  font: 600 13px/1.2 system-ui, sans-serif;
+  margin: 4px 0 8px;
+  flex-shrink: 0;
+}
+
+.charts-panel .chart-container {
+  flex: 1 1 auto;
+  min-height: 120px;
+  max-height: 240px;
+  position: relative;
+}
+
+.charts-panel .chart-container.monthly { flex-basis: 30%; min-height: 140px; }
+.charts-panel .chart-container.topn { flex-basis: 28%; min-height: 140px; }
+.charts-panel .chart-container.heatmap { flex-basis: 32%; min-height: 160px; }
+
+.charts-panel canvas {
+  width: 100% !important;
+  height: 100% !important;
+}
+
+@media (max-width: 1440px) { .charts-panel { max-height: 75vh; } }
+@media (max-width: 1024px) { .charts-panel { max-height: 70vh; width: 380px; } }
+@media (max-width: 768px) {
+  .charts-panel {
+    max-height: 60vh; width: 100%; left: 0; right: 0; top: auto; bottom: 0; border-radius: 8px 8px 0 0;
+  }
+  .charts-panel .chart-container { min-height: 100px; }
+}
```

**index.html** — Refactor chart containers (lines 132-143):

```diff
- <div id="charts" style="position:fixed; right:12px; top:12px; z-index:15; width:420px; max-height:80vh; overflow:auto; background:rgba(255,255,255,0.95); padding:10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15)">
+ <div id="charts" class="charts-panel" style="position:fixed; right:12px; top:12px; z-index:15; width:420px; background:rgba(255,255,255,0.95); padding:10px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15)">
-   <div style="font:600 13px/1.2 system-ui, sans-serif; margin:4px 0 8px;">Charts</div>
+   <div class="chart-title">Charts</div>
-   <div style="margin-bottom:10px">
-     <canvas id="chart-monthly" height="140"></canvas>
+   <div class="chart-container monthly">
+     <canvas id="chart-monthly"></canvas>
    </div>
-   <div style="margin-bottom:10px">
-     <canvas id="chart-topn" height="160"></canvas>
+   <div class="chart-container topn">
+     <canvas id="chart-topn"></canvas>
    </div>
-   <div>
-     <canvas id="chart-7x24" height="180"></canvas>
+   <div class="chart-container heatmap">
+     <canvas id="chart-7x24"></canvas>
    </div>
  </div>
```

---

### Option B: JavaScript Height Calc (Fallback)

**src/charts/index.js** — Add at top of `updateAllCharts`:

```diff
  export async function updateAllCharts({ start, end, types = [], drilldownCodes = [], center3857, radiusM, queryMode, selectedDistrictCode, selectedTractGEOID }) {
+   // Calculate dynamic heights
+   const chartsPanel = document.getElementById('charts');
+   if (chartsPanel) {
+     const availableHeight = window.innerHeight * 0.80;
+     const chartableHeight = availableHeight - 90; // Title + padding + gaps
+     const monthlyHeight = Math.max(140, chartableHeight * 0.30);
+     const topnHeight = Math.max(140, chartableHeight * 0.28);
+     const heatmapHeight = Math.max(160, chartableHeight * 0.32);
+     chartsPanel.style.setProperty('--monthly-height', `${monthlyHeight}px`);
+     chartsPanel.style.setProperty('--topn-height', `${topnHeight}px`);
+     chartsPanel.style.setProperty('--heatmap-height', `${heatmapHeight}px`);
+   }
+
    try {
      // ... existing code
```

**index.html** — CSS uses custom properties:

```diff
+.chart-container.monthly { height: var(--monthly-height, 140px); }
+.chart-container.topn { height: var(--topn-height, 160px); }
+.chart-container.heatmap { height: var(--heatmap-height, 180px); }
```

---

## Risk Assessment

### CSS Grid Risks ⚠️

- **Browser Compatibility**: Flexbox is universally supported (IE11+), no risk
- **Complex Content**: If chart content varies wildly (e.g., 50-label bar chart), fixed min/max heights may not suffice

**Mitigation**: Test with real data extremes (e.g., 20+ offense types in Top-N). Adjust `max-height` if needed.

### JavaScript Calc Risks ⚠️

- **Complexity**: More code to maintain
- **Resize Performance**: Rapid window resizing could cause jank (mitigate with debounce)

**Mitigation**: Only use if CSS proves inadequate.

---

## Testing Checklist

- [ ] Open on 1366×768 display → Charts fit without scroll
- [ ] Resize window from 1920×1080 to 1024×768 → Charts resize smoothly
- [ ] Open on mobile (375×667) → Panel moves to bottom, charts stack vertically
- [ ] Populate with dense data (20+ labels) → No label truncation
- [ ] Switch between query modes (buffer/district/tract) → Charts re-render correctly

---

## Future Enhancements (Out of Scope)

- **Collapsible Panel**: Allow user to hide/show charts to maximize map area
- **Chart Ordering**: Drag-and-drop to reorder charts (monthly → topN → heatmap)
- **Full-Screen Mode**: Expand charts to modal overlay for detailed analysis
- **Export Charts**: Download as PNG/SVG

---

## Conclusion

**Recommended**: Implement **CSS Grid (Option A)** for clean, maintainable, responsive charts layout.

**Effort**: ~20 minutes for CSS-only solution.

**Fallback**: JavaScript calc (Option B) available if CSS proves insufficient for complex data scenarios.
