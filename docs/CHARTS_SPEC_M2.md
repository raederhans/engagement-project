# Route Safety Diary — M2 Charts Specification

**Version:** M2
**Status:** Agent-I implementation spec
**Audience:** Implementing developers (Agent-I), QA

---

## 1. Purpose

This document specifies **three data visualization charts** for the Route Safety Diary M2 release:
1. **Safety Trend Line Chart** - Temporal evolution of route safety ratings
2. **Tag Distribution Bar Chart** - Most common safety/infrastructure tags
3. **Confidence Heatmap** - Spatial coverage of reliable ratings across the network

All charts use **Chart.js v4** and include JSON schema specifications for data exchange.

---

## 2. Chart 1: Safety Trend Line Chart

### 2.1 Purpose

Visualize how the aggregated safety rating for a selected route has changed over time, showing:
- Historical trend (30-day rolling average)
- Data confidence (via error bands)
- Significant events (annotations)

### 2.2 Data Schema

**Endpoint:** `/api/diary/trend` (future M2 backend, see [API_BACKEND_DIARY_M2.md](./API_BACKEND_DIARY_M2.md))

**Request:**
```json
{
  "route_id": "route_001",
  "start_date": "2024-10-01",
  "end_date": "2025-11-11",
  "window_days": 30
}
```

**Response:**
```json
{
  "route_id": "route_001",
  "route_name": "My commute to work",
  "data_points": [
    {
      "date": "2024-10-01",
      "mean_rating": 3.2,
      "confidence": 0.6,
      "n_samples": 8,
      "std_error": 0.4
    },
    {
      "date": "2024-10-08",
      "mean_rating": 3.4,
      "confidence": 0.7,
      "n_samples": 12,
      "std_error": 0.3
    }
  ],
  "annotations": [
    {
      "date": "2024-10-15",
      "label": "New bike lane added",
      "type": "infrastructure"
    }
  ]
}
```

**JSON Schema (TypeScript types):**
```typescript
interface TrendDataPoint {
  date: string;              // ISO 8601 date (YYYY-MM-DD)
  mean_rating: number;       // [1.0, 5.0]
  confidence: number;        // [0, 1]
  n_samples: number;         // integer ≥ 0
  std_error: number;         // ≥ 0
}

interface Annotation {
  date: string;              // ISO 8601 date
  label: string;             // max 100 chars
  type: 'infrastructure' | 'incident' | 'community';
}

interface TrendResponse {
  route_id: string;
  route_name: string;
  data_points: TrendDataPoint[];
  annotations: Annotation[];
}
```

### 2.3 Visual Encoding

**Chart Type:** Line chart with confidence bands

**Axes:**
- **X-axis:** Time (date), format: "MMM DD" (e.g., "Oct 15")
- **Y-axis:** Safety rating [1.0, 5.0], fixed scale
- Y-axis label: "Average Safety Rating"
- Y-axis ticks: 1, 2, 3, 4, 5 (integer labels)

**Main Line:**
- Color: #3b82f6 (blue-500)
- Width: 2px
- Point style: Circle, radius 4px
- Point hover: Radius 6px, show tooltip

**Confidence Band:**
- Upper bound: mean_rating + std_error
- Lower bound: mean_rating - std_error
- Fill: rgba(59, 130, 246, 0.1) (blue with 10% opacity)
- Border: None
- Clamped to [1, 5] range

**Annotations:**
- Style: Vertical dashed line at date
- Color:
  - Infrastructure: #10b981 (green-500)
  - Incident: #ef4444 (red-500)
  - Community: #8b5cf6 (purple-500)
- Label: Positioned above line, 12px font, rotated -45°

**Tooltip:**
```
Date: Oct 15, 2024
Safety: 3.4 ★★★☆☆
Confidence: 70% (12 samples)
```

### 2.4 Empty State

**Condition:** data_points.length === 0

**Display:**
- Gray dashed line at y = 3.0 (prior mean)
- Text overlay (center):
  ```
  No data yet for this route
  Record a trip to see your safety trend
  ```
- Style: 14px, color #9ca3af (gray-400)

### 2.5 Accessibility

- Chart container: role="img", aria-label="Safety trend chart for {route_name}"
- Tooltip: aria-live="polite" announces data on point hover
- Legend: Keyboard navigable (Tab), Enter to toggle series visibility
- Color contrast: All lines meet WCAG AA against white background

### 2.6 Responsive Behavior

**Desktop (≥1024px):**
- Width: 600px
- Height: 300px
- X-axis labels: Every 7 days

**Tablet (768-1023px):**
- Width: 100% (container width)
- Height: 250px
- X-axis labels: Every 14 days

**Mobile (<768px):**
- Width: 100%
- Height: 200px
- X-axis labels: Every 30 days, rotated -45°

---

## 3. Chart 2: Tag Distribution Bar Chart

### 3.1 Purpose

Show the most common tags across all segments of a route, helping users understand qualitative safety factors.

### 3.2 Data Schema

**Endpoint:** `/api/diary/tags` (future M2 backend)

**Request:**
```json
{
  "route_id": "route_001"
}
```

**Response:**
```json
{
  "route_id": "route_001",
  "tags": [
    {
      "tag": "well-lit",
      "count": 45,
      "percentage": 32.1
    },
    {
      "tag": "busy",
      "count": 38,
      "percentage": 27.1
    },
    {
      "tag": "bike lane",
      "count": 30,
      "percentage": 21.4
    },
    {
      "tag": "quiet",
      "count": 15,
      "percentage": 10.7
    },
    {
      "tag": "crosswalk",
      "count": 12,
      "percentage": 8.6
    }
  ],
  "total_ratings": 140
}
```

**JSON Schema (TypeScript):**
```typescript
interface TagCount {
  tag: string;               // max 50 chars
  count: number;             // integer ≥ 0
  percentage: number;        // [0, 100]
}

interface TagDistributionResponse {
  route_id: string;
  tags: TagCount[];          // sorted by count desc
  total_ratings: number;     // integer ≥ 0
}
```

### 3.3 Visual Encoding

**Chart Type:** Horizontal bar chart

**Axes:**
- **Y-axis:** Tag names (categorical), left-aligned
- **X-axis:** Count (integer), label: "Number of mentions"
- X-axis range: [0, max(count) * 1.1] (10% padding)

**Bars:**
- Color: Single color #3b82f6 (blue-500)
- Height: 24px
- Border-radius: 4px (right side only)
- Spacing: 8px between bars

**Bar Labels:**
- Position: Inside bar (right-aligned) if width > 50px, else outside
- Format: `{count} ({percentage}%)`
- Example: "45 (32.1%)"
- Font: 12px medium, color: white (inside) or #374151 (outside)

**Sorting:**
- Descending by count
- Show top 10 tags max

**Tooltip:**
```
Tag: well-lit
Mentions: 45 (32.1% of 140 ratings)
```

### 3.4 Empty State

**Condition:** tags.length === 0

**Display:**
- Gray placeholder bars (3 bars at 100%, 60%, 40% width)
- Opacity: 0.2
- Text overlay (center):
  ```
  No tags recorded yet
  Rate segments to build tag insights
  ```

### 3.5 Accessibility

- Chart container: role="img", aria-label="Tag distribution chart for {route_name}"
- Screen reader: Table alternative (hidden visually):
  ```html
  <table aria-label="Tag distribution data">
    <tr><th>Tag</th><th>Count</th><th>Percentage</th></tr>
    <tr><td>well-lit</td><td>45</td><td>32.1%</td></tr>
    ...
  </table>
  ```

### 3.6 Responsive Behavior

**Desktop:**
- Width: 400px
- Height: 300px
- Show top 10 tags

**Tablet:**
- Width: 100%
- Height: 250px
- Show top 8 tags

**Mobile:**
- Width: 100%
- Height: 200px
- Show top 5 tags
- Font size: 11px for labels

---

## 4. Chart 3: Confidence Heatmap

### 4.1 Purpose

Visualize spatial coverage and data confidence across the entire segment network, identifying gaps in reliable data.

### 4.2 Data Schema

**Endpoint:** `/api/diary/coverage` (future M2 backend)

**Request:**
```json
{
  "bbox": [-75.20, 39.90, -75.10, 40.00],  // [west, south, east, north]
  "grid_size": 50                           // meters per cell
}
```

**Response:**
```json
{
  "grid_size_m": 50,
  "bbox": [-75.20, 39.90, -75.10, 40.00],
  "cells": [
    {
      "x": 0,
      "y": 0,
      "center_lng": -75.1995,
      "center_lat": 39.9005,
      "mean_confidence": 0.8,
      "segment_count": 5,
      "total_samples": 42
    },
    {
      "x": 1,
      "y": 0,
      "center_lng": -75.1990,
      "center_lat": 39.9005,
      "mean_confidence": 0.3,
      "segment_count": 2,
      "total_samples": 3
    }
  ]
}
```

**JSON Schema (TypeScript):**
```typescript
interface GridCell {
  x: number;                 // integer grid column
  y: number;                 // integer grid row
  center_lng: number;        // longitude [-180, 180]
  center_lat: number;        // latitude [-90, 90]
  mean_confidence: number;   // [0, 1]
  segment_count: number;     // integer ≥ 0
  total_samples: number;     // integer ≥ 0
}

interface CoverageResponse {
  grid_size_m: number;       // meters
  bbox: [number, number, number, number];  // [west, south, east, north]
  cells: GridCell[];
}
```

### 4.3 Visual Encoding

**Chart Type:** 2D heatmap (grid of colored rectangles)

**Implementation:** Chart.js Matrix plugin OR custom canvas rendering

**Color Scale:**
```javascript
const confidenceColors = [
  { value: 0.0, color: '#fee2e2' },  // Red-50 (no data)
  { value: 0.3, color: '#fde68a' },  // Yellow-200 (low confidence)
  { value: 0.6, color: '#bfdbfe' },  // Blue-200 (medium confidence)
  { value: 0.9, color: '#86efac' },  // Green-300 (high confidence)
  { value: 1.0, color: '#22c55e' },  // Green-500 (full confidence)
]
```

**Cell Size:**
- Calculated based on container dimensions and grid count
- Minimum: 4x4px
- Maximum: 20x20px
- Maintain aspect ratio of bbox

**Cell Border:**
- Width: 1px
- Color: #f3f4f6 (gray-100)
- Only shown when cell size ≥ 10px

**Legend:**
- Position: Bottom or right side
- Type: Continuous gradient bar
- Labels: 0%, 30%, 60%, 90%, 100%
- Title: "Data Confidence"

**Tooltip:**
```
Grid cell (12, 5)
Confidence: 80%
Segments: 5
Total samples: 42
```

### 4.4 Empty State

**Condition:** cells.length === 0

**Display:**
- Uniform gray grid (all cells #f3f4f6)
- Text overlay:
  ```
  No coverage data available
  Zoom to a neighborhood to see details
  ```

### 4.5 Interaction

**Click cell:**
- Zoom map to cell bounds
- Highlight segments within cell
- Update sidebar with cell details

**Hover cell:**
- Show tooltip
- Increase cell opacity by 0.2
- Show cell border (if hidden)

### 4.6 Accessibility

- Chart container: role="img", aria-label="Coverage heatmap showing data confidence across network"
- Tooltip: aria-live="polite"
- Screen reader alternative: Summary text
  ```
  Coverage summary: 127 grid cells analyzed.
  42 cells have high confidence (≥0.7),
  58 cells have medium confidence (0.3-0.7),
  27 cells have low confidence (<0.3).
  ```

### 4.7 Responsive Behavior

**Desktop:**
- Width: 600px
- Height: 400px
- Cell size: Auto (based on grid dimensions)

**Tablet:**
- Width: 100%
- Height: 300px
- Reduce grid resolution (aggregate cells 2x2)

**Mobile:**
- Width: 100%
- Height: 250px
- Reduce grid resolution (aggregate cells 4x4)
- Legend position: Bottom (horizontal)

---

## 5. Chart Container Specifications

### 5.1 Common Layout

All charts share a common container structure:

```html
<div class="chart-container">
  <div class="chart-header">
    <h3 class="chart-title">{Title}</h3>
    <button class="chart-info-btn" aria-label="Chart information">ℹ️</button>
  </div>
  <div class="chart-body">
    <canvas id="{chart-id}" role="img" aria-label="{description}"></canvas>
  </div>
  <div class="chart-footer">
    <span class="chart-metadata">{metadata}</span>
  </div>
</div>
```

### 5.2 Styling

**Container:**
- Background: white
- Border: 1px solid #e5e7eb (gray-200)
- Border-radius: 8px
- Padding: 16px
- Box-shadow: 0 1px 3px rgba(0,0,0,0.1)

**Header:**
- Display: flex, justify-content: space-between
- Margin-bottom: 12px

**Title:**
- Font: 16px bold, color #111827 (gray-900)
- Line-height: 1.2

**Info Button:**
- Size: 24x24px
- Background: transparent, hover: #f3f4f6 (gray-100)
- Border-radius: 4px
- Cursor: pointer
- Opens modal with chart explanation

**Footer:**
- Font: 11px, color #6b7280 (gray-500)
- Margin-top: 8px
- Format: "Last updated: {timestamp} · {data_point_count} points"

### 5.3 Loading State

**Display while data fetching:**
- Gray skeleton (shimmer animation)
- Skeleton height matches final chart height
- Animation: 1.5s linear infinite gradient shift

```css
@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}

.chart-skeleton {
  background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
  background-size: 1000px 100%;
  animation: shimmer 1.5s linear infinite;
}
```

### 5.4 Error State

**Display on API failure:**
```
┌──────────────────────────────────┐
│ ⚠ Unable to load chart data      │
│                                  │
│ [Retry]                          │
└──────────────────────────────────┘
```

- Background: #fef3c7 (yellow-100)
- Border: 1px solid #f59e0b (amber-500)
- Icon: ⚠ #f59e0b (amber-500)
- Retry button: Secondary style

---

## 6. Chart.js Configuration

### 6.1 Common Options

All charts use these shared Chart.js options:

```javascript
const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: {
    duration: 500,
    easing: 'easeInOutQuart'
  },
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        boxWidth: 12,
        font: { size: 12, family: 'Inter, sans-serif' },
        color: '#374151'
      }
    },
    tooltip: {
      enabled: true,
      mode: 'index',
      intersect: false,
      backgroundColor: 'rgba(17, 24, 39, 0.9)',
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: '#374151',
      borderWidth: 1,
      cornerRadius: 6,
      padding: 12,
      displayColors: true,
      callbacks: {
        // Custom formatting per chart
      }
    }
  }
}
```

### 6.2 Performance Optimizations

**Dataset Decimation:**
- Enable for line charts with >500 points
- Algorithm: 'lttb' (Largest Triangle Three Buckets)

**Animation:**
- Disable on mobile (<768px) to improve performance
- Use CSS transitions for hover effects instead

**Canvas Resolution:**
- Set devicePixelRatio to 2 for crisp rendering on retina displays
- Use offscreen canvas for heatmap rendering

---

## 7. Data Update Strategy

### 7.1 Polling vs Push

**M2 Approach:** Client-side polling

**Interval:**
- Active tab: Poll every 60 seconds
- Inactive tab: Pause polling (use Page Visibility API)
- Resume on focus

**Implementation:**
```javascript
let pollInterval = null

function startPolling(chartId, apiEndpoint) {
  if (pollInterval) clearInterval(pollInterval)

  pollInterval = setInterval(() => {
    if (!document.hidden) {
      fetchChartData(apiEndpoint).then(data => updateChart(chartId, data))
    }
  }, 60000)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(pollInterval)
  } else {
    startPolling(currentChartId, currentEndpoint)
  }
})
```

### 7.2 Cache Strategy

**Client-side Cache:**
- Store fetched data in memory with timestamp
- Reuse if age < 60 seconds
- Invalidate on user action (e.g., new rating submitted)

**HTTP Cache:**
- Set `Cache-Control: max-age=60` on API responses
- Use `ETag` for conditional requests (M3+)

---

## 8. Acceptance Criteria

All criteria testable in [TEST_PLAN_M2.md](./TEST_PLAN_M2.md):

1. **Trend chart:** Shows 30-day rolling average with confidence bands
2. **Tag chart:** Displays top 10 tags sorted by count descending
3. **Heatmap:** Grid cells colored by confidence, 5-stop gradient
4. **Tooltips:** All charts show formatted tooltips on hover
5. **Empty states:** Graceful display when data_points.length === 0
6. **Error handling:** Retry button appears on API failure
7. **Responsive:** Charts resize correctly at 768px and 375px breakpoints
8. **Accessibility:** Screen reader alternatives provided for all charts
9. **Performance:** Chart render time <500ms for datasets up to 1000 points
10. **Color contrast:** All text/lines meet WCAG AA (4.5:1 for text, 3:1 for graphics)

---

## 9. Future Enhancements (M3+)

- [ ] Export chart as PNG/SVG
- [ ] Interactive brush/zoom for trend chart
- [ ] Tag filtering in bar chart (click to filter map)
- [ ] Animated transitions on data updates
- [ ] Dark mode color palettes
- [ ] WebSocket push updates (replace polling)
- [ ] Client-side data aggregation (reduce API calls)

---

**Document Status:** ✅ Complete, ready for Agent-I implementation
**Last Updated:** 2025-11-11
**Related:** [DIARY_SPEC_M2.md](./DIARY_SPEC_M2.md), [API_BACKEND_DIARY_M2.md](./API_BACKEND_DIARY_M2.md), [TEST_PLAN_M2.md](./TEST_PLAN_M2.md)
