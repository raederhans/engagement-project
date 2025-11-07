# Route Safety Diary - Discovery & Gap Analysis Report

**Date:** 2025-11-07
**Agent:** Agent-M (Monitor/Reviewer/Auditor)
**Mode:** Discovery & Specification Intake
**Status:** ✅ Complete

---

## Executive Summary

This discovery report analyzes the existing engagement-project repository and inventories the Route Safety Diary UI scenarios to prepare for M1 Task Packet implementation. The repository contains a mature crime dashboard built with vanilla JavaScript, Vite, MapLibre GL JS, and Chart.js. A separate "Route Safety Diary UI" folder contains React-based prototypes demonstrating 4 workflow states for the planned diary feature.

**Key Findings:**

- **Current State:** 3-panel crime dashboard with district/tract choropleth visualization, point clustering, and time-series analysis
- **Technology Stack:** Vanilla JS + Vite + MapLibre + Chart.js (no UI framework)
- **UI Scenarios:** React 18 + TypeScript + Radix UI + Tailwind CSS (446 KB, 10 core components + 61 Radix UI wrappers)
- **Architecture Gap:** ⚠️ **HIGH RISK** - UI scenarios use React while repository uses vanilla JS
- **Missing Paths:** 13 diary-specific modules/files not present in repository
- **Reusable Infrastructure:** State store, map initialization, API patterns, Turf.js utilities available

**Critical Decision Required:** Choose integration strategy (React migration, vanilla JS port, or hybrid approach) before M1 implementation.

---

## 1. Current Dashboard Architecture

### Overview

The engagement-project repository is a **crime data dashboard** for Philadelphia that visualizes police incident data overlaid on census demographics. Users can query by buffer radius, police district, or census tract, with choropleth rendering and detailed charts.

**Repository Path:** `c:\Users\raede\Desktop\essay help master\6920Java\engagement-project`

### Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Build System** | Vite | (minimal config) |
| **Language** | JavaScript | ES modules |
| **Map Library** | MapLibre GL JS | 4.5.0 |
| **Charts** | Chart.js | 4.5.1 |
| **Geospatial** | Turf.js | 6.5.0 |
| **Date/Time** | Day.js + Luxon | 1.11.13 + 3.4.4 |
| **State** | Custom store | Observer pattern |
| **Styling** | Plain CSS | No framework |
| **UI Framework** | None | Vanilla DOM |

### Application Structure

```
engagement-project/
├── index.html               (11.8 KB - entry with 3-panel layout)
├── src/
│   ├── main.js             (11.7 KB - entry point, 271 lines)
│   ├── config.js           (867 bytes - API endpoints)
│   ├── style.css           (512 bytes - global styles)
│   ├── state/              (store.js, index.js)
│   ├── map/                (15 modules, ~1,290 lines)
│   ├── charts/             (4 modules - line, bar, heatmap)
│   ├── api/                (4 modules - crime, acs, boundaries, meta)
│   ├── utils/              (11 modules - http, geoids, classify, etc.)
│   ├── ui/                 (panel.js, about.js)
│   ├── compare/            (card.js)
│   └── data/               (acs_tracts_2023_pa101.json, offense_groups.json)
├── public/data/            (police_districts.geojson, tracts_phl.geojson)
├── docs/                   (22 documentation files)
└── scripts/                (13 build/data processing scripts)
```

### Current Features

**Query Modes:**
1. **Buffer Mode** - Radius-based search from center point
2. **District Mode** - Police district boundary aggregation
3. **Tract Mode** - Census tract boundary aggregation

**Visualizations:**
- Choropleth maps (district/tract fill colors by crime density)
- Point clustering (incident locations)
- Time series line chart (monthly trends)
- Top-N bar chart (offense types)
- 7×24 heatmap (hour-of-day × day-of-week)

**Controls:**
- Time window selector (3/6/12/24 months)
- Offense group filter (multi-select)
- Admin level toggle (districts ↔ tracts)
- Per-10k population rate toggle (raw counts ↔ rates)
- Compare A/B mode

### Shared Utilities (Reusable for Diary)

**State Management:**
- `src/state/store.js` - Centralized store with getters/setters, observer pattern for reactive updates
- Manages: filters (start, end, types), center, radius, query mode, admin level

**Map Infrastructure:**
- `src/map/initMap.js` - MapLibre initialization, basemap configuration
- `src/map/style_helpers.js` - Layer styling utilities (paint, layout properties)
- `src/map/ui_tooltip.js` - Hover tooltip system (reusable for segments)
- `src/map/selection_layers.js` - Highlight pattern for selected features

**API Utilities:**
- `src/utils/http.js` - Fetch wrapper with error handling and timeouts
- `src/api/boundaries.js` - GeoJSON loading with caching (reusable for segments)

**Geospatial:**
- `src/utils/tract_geom.js` - Turf.js geometry operations (bbox, centroid, area)
- `src/utils/classify.js` - Quantile/equal interval classification for color scales

**UI Patterns:**
- `src/ui/panel.js` - Collapsible side panel (left/right)
- `src/ui/about.js` - Modal overlay pattern
- `src/map/legend.js` - Legend control (customizable)

---

## 2. Planned Paths vs. Existing Paths

### ✅ Existing Paths (Available Infrastructure)

| Path | Status | Purpose |
|------|--------|---------|
| `src/` | ✅ | Main source directory |
| `src/api/` | ✅ | API integration layer (4 modules) |
| `src/map/` | ✅ | Map-related modules (15 files, MapLibre infrastructure) |
| `src/utils/` | ✅ | Utility functions (11 modules: http, geoids, classify, etc.) |
| `src/state/` | ✅ | State management (centralized store) |
| `src/data/` | ✅ | Static data files (ACS, offense groups) |
| `public/data/` | ✅ | Public GeoJSON files (districts, tracts) |
| `docs/` | ✅ | Documentation (22 files) |
| `scripts/` | ✅ | Build and data processing (13 files) |

### ❌ Missing Planned Paths (To Be Implemented)

| Path | Priority | Complexity | Notes |
|------|----------|------------|-------|
| **Feature Modules** ||||
| `src/routes_diary/` | **HIGH** | MEDIUM | Feature directory (not present) |
| `src/routes_diary/index.js` | **HIGH** | MEDIUM | Main orchestrator, mode switching logic |
| `src/routes_diary/form_submit.js` | **HIGH** | MEDIUM | Rating form, validation, submission |
| `src/routes_diary/my_routes.js` | MEDIUM | LOW | Saved routes list view |
| **Map Integrations** ||||
| `src/map/segments_layer.js` | **HIGH** | HIGH | Street segment visualization layer with rating colors |
| `src/map/routing_overlay.js` | **HIGH** | HIGH | Route planning, safer alternative display |
| **API Integration** ||||
| `src/api/diary.js` | **HIGH** | LOW | Diary API calls (submit, segments, route) |
| **Utilities** ||||
| `src/utils/match.js` | **HIGH** | **VERY HIGH** | GPS trace → segment matching algorithm |
| `src/utils/decay.js` | MEDIUM | MEDIUM | Time-decay calculations, confidence scoring |
| **Server-Side** ||||
| `server/` | **HIGH** | HIGH | Server directory (none exists) |
| `server/api/diary/` | **HIGH** | HIGH | Diary endpoints (submit, segments, route) |
| **Data Files** ||||
| `data/segments_phl.geojson` | **HIGH** | **VERY HIGH** | Pre-segmented Philadelphia street network |
| **Documentation** ||||
| `docs/DIARY_SPEC.md` | MEDIUM | LOW | Feature specification |
| `docs/PRIVACY_NOTES.md` | MEDIUM | LOW | Privacy policy for diary |

**Summary:**
- **Total Missing:** 13 paths
- **High Priority:** 10 paths
- **Medium Priority:** 3 paths
- **Very High Complexity:** 2 paths (match.js, segments_phl.geojson)

---

## 3. Route Safety Diary UI Scenarios Inventory

### Overview

**Location:** `C:\Users\raede\Desktop\essay help master\6920Java\engagement-project\Route Safety Diary UI`
**Total Size:** 446 KB
**Last Modified:** 2025-11-07 10:17
**Structure:** Single cohesive React application demonstrating **4 workflow states** (not 4 separate apps)

### Technology Stack (UI Scenarios)

| Layer | Technology | Version |
|-------|------------|---------|
| **Build System** | Vite | (TypeScript config) |
| **Language** | TypeScript | (tsx files) |
| **UI Framework** | React | 18.3.1 |
| **Component Library** | Radix UI + shadcn/ui | (61 components) |
| **Styling** | Tailwind CSS | 3.x |
| **Icons** | Lucide React | - |
| **Map** | Custom Canvas 2D | (not MapLibre) |
| **Charts** | Custom React | (not Chart.js) |
| **State** | React hooks | useState, useEffect |

### UI Components Breakdown

| Component | Size | Lines | Purpose |
|-----------|------|-------|---------|
| `App.tsx` | 3,781 bytes | ~95 | Main app state, orchestrates 4 scenarios |
| `TopBar.tsx` | 2,976 bytes | ~75 | Mode switcher (Crime \| Route Safety Diary \| Tracts) |
| `LeftPanel.tsx` | 3,000 bytes | ~80 | Diary controls (Plan/Record/My Routes buttons, legend toggle) |
| `MapCanvas.tsx` | 11,834 bytes | ~300 | Canvas-based segment visualization (color=rating, width=confidence) |
| `RightPanel.tsx` | 6,629 bytes | ~175 | Insights panel (trend chart, tag bars, 7×24 heatmap) |
| `RecorderDock.tsx` | 1,594 bytes | ~40 | GPS recorder controls (Start/Pause/Finish floating dock) |
| `RatingModal.tsx` | 8,016 bytes | ~210 | Post-trip rating form (stars, tags, segment overrides, privacy note) |
| `SegmentCard.tsx` | 4,127 bytes | ~110 | Segment detail popup (rating, trend, confidence, Agree/Feels safer actions) |
| `CommunityDetailsModal.tsx` | 9,478 bytes | ~250 | Full segment analytics (charts, distribution, timeline, privacy note) |
| `Snackbar.tsx` | 388 bytes | ~10 | Toast notification ("Thanks — updating map") |
| **Radix UI library** | ~95,000 bytes | ~4,000 | 61 component files (button, card, dialog, modal, select, slider, switch, etc.) |

**Total UI LOC:** ~6,500 lines (including Radix UI components)

### Documentation in UI Folder

| File | Size | Description |
|------|------|-------------|
| `WORKFLOW_SPECS.md` | 6,537 bytes | Detailed 4-state workflow specification |
| `Attributions.md` | 289 bytes | Icon and component library credits |
| `README.md` | 314 bytes | Setup instructions |

---

## 4. The 4 Scenarios: Detailed Analysis & Mapping

The UI scenarios demonstrate **4 sequential workflow states** that users progress through when using the Route Safety Diary feature. Below is a detailed breakdown of each scenario with mapping to planned modules.

### Scenario 1: Initial State (Ready to Begin)

**Trigger:** User enters Route Safety Diary mode for the first time or after completing a trip.

**UI State in `App.tsx`:**
```tsx
isPostSubmit = false
showRatingModal = false
```

#### Components Displayed

**TopBar** (`TopBar.tsx`)
- Mode selector with 3 options: Crime | **Route Safety Diary** (active) | Tracts
- Rounded-full button group with hover states

**LeftPanel** (`LeftPanel.tsx`)
- **Plan route** button (MapPin icon) - Disabled in this scenario
- **Record trip** button (Circle icon, red when active) - **Primary CTA**
- **My routes** button (FolderOpen icon) - Disabled or empty state
- **Legend toggle** button (Eye icon)
- **Community actions info box** (ThumbsUp, Sparkles icons with descriptions)

**MapCanvas** (`MapCanvas.tsx`)
- Grid background (neutral-100)
- Faint incident clusters (dots, size proportional to count)
- **Color-coded street segments:**
  - Rating 1 (lowest): Light amber
  - Rating 2: Medium amber
  - Rating 3: Dark amber
  - Rating 4: Lime green
  - Rating 5 (highest): Bright green
- **Line width:** Proportional to confidence (n_eff)
  - Thin lines = low confidence (few ratings)
  - Thick lines = high confidence (many ratings)
- **Legend chip** (top-left, white card):
  - "Color = rating, Width = confidence"

**RightPanel** (`RightPanel.tsx`)
- **Placeholder insights:**
  - Dashed border boxes with neutral-200 background
  - Text prompts:
    - "Trend chart will appear after your first rating"
    - "Top tags will show common concerns in this area"
    - "Heatmap shows when incidents occur most frequently"

**RecorderDock** (`RecorderDock.tsx`)
- Floating dock (bottom-right, absolute positioning)
- **Start button** (green, enabled)
- **Pause button** (gray, disabled)
- **Finish button** (gray, disabled)

#### Interactions

1. **Hover segment** → Show tooltip with rating and confidence
2. **Click segment** → Open SegmentCard popup (Scenario 4)
3. **Click "Record trip"** → GPS recording begins:
   - Button turns red ("Recording...")
   - Pause/Finish buttons become enabled
   - GPS dots appear on map in real-time

#### Planned Module Mapping

| UI Component | Planned Module | Implementation Notes |
|--------------|----------------|----------------------|
| `App.tsx` mode state | `src/routes_diary/index.js` | Mode switching logic, feature flag check |
| `TopBar.tsx` | `src/routes_diary/index.js` | Add mode selector to existing dashboard TopBar or create new |
| `LeftPanel.tsx` | `src/routes_diary/index.js` | Integrate with existing `src/ui/panel.js` pattern |
| `MapCanvas.tsx` segments | `src/map/segments_layer.js` | Load segments GeoJSON, render with MapLibre or Canvas, color scale by rating |
| `MapCanvas.tsx` legend | `src/map/legend.js` | Extend existing legend control with segment-specific legend |
| `RecorderDock.tsx` | `src/routes_diary/index.js` | GPS recording state machine, Geolocation API integration |
| `RightPanel.tsx` placeholders | `src/routes_diary/index.js` | Empty state templates |

**Data Requirements:**
- `data/segments_phl.geojson` with properties: `segment_id`, `rating` (1-5), `n_eff` (confidence), `geometry` (LineString)

---

### Scenario 2: Recording Complete - Rating Modal

**Trigger:** User clicks "Finish" button on RecorderDock after recording a GPS trace.

**UI State in `App.tsx`:**
```tsx
showRatingModal = true
gpsTrace = [...coordinates]
matchedSegments = [4, 6, 8, 12] // IDs from match.js
```

#### Components Displayed

**RatingModal** (`RatingModal.tsx`) - **Centered, full-screen overlay**

**Modal Structure:**

1. **Overall Rating** (top section)
   - Star selector (1-5 stars)
   - Large, interactive with hover states (gold fill on hover)
   - Required field

2. **Tags** (multi-select, max 3)
   - Predefined badge pills:
     - "poor lighting"
     - "low foot traffic"
     - "cars too close"
     - "dogs"
     - "construction blockage"
   - **Custom "Other" input** (text field, max 30 characters)
   - Selected tags show primary background color

3. **Segment Overrides** (optional, max 2 selections)
   - List of matched segments from GPS trace:
     - "Main St (0.3 mi)" - Segment 4
     - "Oak Ave (0.5 mi)" - Segment 6
     - "Park Way (0.4 mi)" - Segment 8
     - "River Rd (0.6 mi)" - Segment 12
   - Checkbox multi-select
   - Purpose: Allow user to rate specific segments differently than overall rating
   - If selected: Opens secondary star picker for that segment

4. **Travel Mode** (required)
   - Radio buttons: **Walk** | **Bike**

5. **Save as Route** (toggle)
   - Switch control (default: OFF)
   - If ON: User can name the route and access it later in "My routes"

6. **Privacy Note** (info box, blue border)
   - Users icon (blue)
   - Text: "We only store segment-level data; raw GPS is not retained."
   - Link: "Learn more" → Opens docs/PRIVACY_NOTES.md

7. **Actions** (bottom)
   - **Cancel** button (outline, gray) → Discard GPS trace, close modal
   - **Submit** button (solid black, primary) → Submit rating data

**Background:**
- Map dimmed with 40% opacity overlay
- Backdrop blur effect (blur-sm in Tailwind)
- Modal animates in with smooth scale + fade

#### Interactions

1. **Select stars** → Update overall rating (visual feedback)
2. **Click tag** → Toggle selection (max 3, show error if exceeded)
3. **Type in "Other"** → Custom tag added to submission
4. **Select segment override** → Show secondary star picker for that segment
5. **Toggle "Save as route"** → Show text input for route name
6. **Click "Submit"** →
   - Validate form (rating required)
   - Call `src/api/diary.js` → POST `/api/diary/submit`
   - Close modal
   - Transition to Scenario 3

#### Planned Module Mapping

| UI Component | Planned Module | Implementation Notes |
|--------------|----------------|----------------------|
| `RatingModal.tsx` | `src/routes_diary/form_submit.js` | Modal state, validation, form submission logic |
| Rating data submission | `src/api/diary.js` | `submitRating(ratingData)` → POST to server |
| GPS trace → segments | `src/utils/match.js` | **CRITICAL:** Snap GPS coordinates to nearest segment IDs |
| Segment override logic | `src/routes_diary/form_submit.js` | Handle per-segment rating overrides |
| Privacy note link | `docs/PRIVACY_NOTES.md` | Privacy policy document (to be created) |

**Data Flow:**
```javascript
// GPS trace from Geolocation API
const gpsTrace = [
  { lat: 39.9526, lng: -75.1652, timestamp: 1699305600000 },
  { lat: 39.9528, lng: -75.1654, timestamp: 1699305605000 },
  // ... 100-500 points
];

// Match to segments (src/utils/match.js)
const matchedSegments = matchGPSToSegments(gpsTrace, segmentsGeoJSON);
// Returns: [4, 6, 8, 12]

// User submission
const ratingData = {
  overall_rating: 4,
  tags: ["poor lighting", "low foot traffic"],
  travel_mode: "walk",
  segment_overrides: [
    { segment_id: 6, rating: 2 }, // Oak Ave was worse
  ],
  save_as_route: true,
  route_name: "Morning commute to work",
  timestamp: Date.now(),
};

// Submit via API
await submitRating(ratingData, matchedSegments);
```

**GPS Matching Algorithm (High-Risk Item):**

`src/utils/match.js` must implement:
1. For each GPS point, find nearest segment within snap tolerance (10m)
2. Group consecutive points by segment ID
3. Filter out segments with < 3 GPS points (noise)
4. Return list of segment IDs traversed

Possible implementations:
- **Option A:** Turf.js `nearestPointOnLine()` for each GPS point
- **Option B:** Mapbox Map Matching API (external service, requires API key)
- **Option C:** PostGIS `ST_ClosestPoint()` if using server-side processing

---

### Scenario 3: Post-Submit State (Map Update)

**Trigger:** Rating modal "Submit" clicked and API call succeeds.

**UI State in `App.tsx`:**
```tsx
isPostSubmit = true
showRatingModal = false
updatedSegments = [4, 6, 8] // Segments affected by new rating
```

#### Components Displayed

**Snackbar** (`Snackbar.tsx`)
- Toast notification (top-center)
- Message: "Thanks — updating map."
- Duration: 2-3 seconds
- Fade-in → hold → fade-out animation

**MapCanvas** (`MapCanvas.tsx`) - **Updated**
- Segments 4, 6, 8 visually updated:
  - **Rating increased** (color shifts toward greener)
  - **Confidence increased** (line width thicker)
  - **Glow effect** briefly applied to updated segments (2-second pulse)
- Hover states:
  - Increased glow intensity (drop shadow)
  - Line width +2px
  - Tooltip shows new rating and "Updated 1 min ago"
- Click handlers enabled for all segments

**Safer Alternative Strip** (`MapCanvas.tsx` - top-right overlay)
- White card with border and shadow
- Slide-in animation from right
- **Content:**
  - Icon: ThumbsUp (green)
  - Title: "Safer alternative now"
  - Description: "+2 min, avoids two low-rated segments"
  - **Action button:** "Show route" → Highlights alternative route on map
  - **Dismiss button:** X icon → Hides strip
- **Logic:**
  - Triggered by `src/map/routing_overlay.js`
  - A* pathfinding with safety penalties applied to low-rated segments
  - Only shown if alternative exists and is < 15% longer time

**RightPanel** (`RightPanel.tsx`) - **Populated**

1. **Trend Card** (time-series sparkline)
   - 8 vertical bars representing last 8 weeks
   - Values: 3.2 → 3.4 → 3.6 → 3.5 → 3.8 → 3.9 → 4.0 → **4.1** (latest)
   - Color gradient: amber (low) → green (high)
   - Tooltip on hover: "Week of Oct 15: 4.0 avg rating"

2. **Top Tags Card** (horizontal bar chart)
   - 3 most common tags in user's rated segments:
     - "poor lighting" (12 mentions, longest bar)
     - "low foot traffic" (8 mentions)
     - "cars too close" (6 mentions)
   - Bar color: amber-500
   - Hover: Show count

3. **7×24 Heatmap** (hour-of-day × day-of-week)
   - 7 rows (Mon-Sun) × 24 columns (12am-11pm)
   - Cell color: 0 (neutral-50) → 5 (orange-600)
   - Purpose: Show when low-rated segments are most concerning
   - Based on timestamps of all ratings in visible area
   - Hover: "Mon 8am: 3.2 avg rating (14 trips)"

**RecorderDock** (`RecorderDock.tsx`)
- Reset to initial state:
  - Start button enabled
  - Pause/Finish buttons disabled

#### Interactions

1. **Hover updated segment** → Enhanced glow, tooltip shows "Updated 1 min ago"
2. **Click "Show route" on safer alternative** →
   - Highlight alternative route (blue line, animated)
   - Show estimated time savings/additions
   - Zoom map to fit route bounds
3. **Hover trend chart** → Show weekly rating breakdown
4. **Hover heatmap cell** → Show time-specific rating data
5. **Click dismiss on safer alternative** → Hide strip, can be re-opened from menu

#### Planned Module Mapping

| UI Component | Planned Module | Implementation Notes |
|--------------|----------------|----------------------|
| `Snackbar.tsx` | `src/routes_diary/index.js` | Toast notification system (or use existing if present) |
| Segment visual update | `src/map/segments_layer.js` | Re-render segments with new rating data, glow animation |
| Safer alternative strip | `src/map/routing_overlay.js` | A* routing with safety penalties, alternative route display |
| Trend chart | `src/routes_diary/index.js` or chart module | Time-series aggregation, Chart.js line chart |
| Top tags chart | `src/routes_diary/index.js` | Tag frequency aggregation, Chart.js bar chart |
| 7×24 heatmap | `src/charts/heat_7x24.js` | Reuse existing heatmap, adapt for segment ratings |
| Time-decay calculation | `src/utils/decay.js` | Exponential decay: `rating_decayed = Σ(rating_i * e^(-λ * days_ago_i))` |

**Time-Decay Algorithm (src/utils/decay.js):**

```javascript
// Bayesian shrinkage + exponential time decay
function calculateSegmentRating(segment, ratings, decayDays = 90) {
  const lambda = Math.log(2) / decayDays; // Half-life = 90 days
  const globalMean = 3.0; // Prior mean
  const globalN = 5; // Prior strength

  let weightedSum = globalMean * globalN;
  let weightedCount = globalN;

  for (const rating of ratings) {
    const daysAgo = (Date.now() - rating.timestamp) / (1000 * 60 * 60 * 24);
    const weight = Math.exp(-lambda * daysAgo);
    weightedSum += rating.value * weight;
    weightedCount += weight;
  }

  return {
    rating: weightedSum / weightedCount,
    n_eff: weightedCount, // Effective sample size (confidence)
  };
}
```

**Safer Alternative Routing (src/map/routing_overlay.js):**

```javascript
// A* pathfinding with safety penalties
function findSaferRoute(origin, destination, segments) {
  // Cost function: time + safety penalty
  const getCost = (segment) => {
    const baseTime = segment.length_m / walkSpeed_m_per_s;
    const safetyPenalty = (5 - segment.rating) * 60; // 60s penalty per rating point
    return baseTime + safetyPenalty;
  };

  const route = aStar(origin, destination, segments, getCost);
  const directRoute = aStar(origin, destination, segments, (s) => s.length_m);

  const timeDiff = route.totalTime - directRoute.totalTime;
  const safetyGain = route.avgRating - directRoute.avgRating;

  if (timeDiff < 900 && safetyGain > 0.5) { // < 15 min, +0.5 rating
    return { route, timeDiff, safetyGain };
  }
  return null; // No meaningful alternative
}
```

---

### Scenario 4: Community Interaction State

**Trigger:** User clicks a street segment on the map.

**UI State in `App.tsx`:**
```tsx
selectedSegment = { id: 4, lat: 39.9526, lng: -75.1652 }
showSegmentCard = true
```

#### Components Displayed (Phase 1: Segment Card)

**SegmentCard** (`SegmentCard.tsx`) - **Floating card**
- **Position:** Absolute, translates to clicked point coordinates (above)
- **Size:** 320px width, auto height
- **Elevation:** z-index 50, drop shadow

**Card Structure:**

1. **Header**
   - Title: "Segment Details"
   - Link: "View community insights" (blue, underlined, hover state)
   - Close button (X icon, top-right)

2. **Stats Grid** (3 columns)
   - **Rating:** Large (48px font), 1 decimal (e.g., "3.8")
   - **30d Trend:** Icon + color
     - Green up-arrow: +0.4 (improving)
     - Red down-arrow: -0.2 (worsening)
     - Neutral dash: 0.0 (stable)
   - **Confidence:** Large (48px), percentage (e.g., "87%")
     - Derived from n_eff: `Math.min(100, n_eff / 50 * 100)`

3. **Top Tags** (2-3 badge pills)
   - Most common tags for this segment:
     - "poor lighting"
     - "low foot traffic"
   - Neutral styling (gray background)

4. **Action Pills** (2 rounded-full buttons)
   - **"Agree" button** (ThumbsUp icon)
     - Hover: Dark background (neutral-800)
     - Click: Increment agreement counter, show toast, close card
   - **"Feels safer" button** (Sparkles icon)
     - Hover: Amber background
     - Click: Record improvement note, show toast, close card
     - Active state: Scale animation (pulse)

5. **Footer**
   - Small text: "Based on 44 community reports"
   - Timestamp: "Last updated 2 hours ago"

#### Interactions (Segment Card)

1. **Click "View community insights"** → Open CommunityDetailsModal (Phase 2)
2. **Click "Agree"** →
   - API call: `POST /api/diary/agree` with `{ segment_id: 4 }`
   - Show toast: "Thanks — confidence updated"
   - Increment confidence counter locally
   - Close card
3. **Click "Feels safer"** →
   - API call: `POST /api/diary/improve` with `{ segment_id: 4 }`
   - Show toast: "Thanks — improvement noted"
   - Update 30d trend locally
   - Close card
4. **Click close (X)** → Hide card
5. **Click elsewhere on map** → Hide card

#### Components Displayed (Phase 2: Community Details Modal)

**CommunityDetailsModal** (`CommunityDetailsModal.tsx`) - **Full-screen overlay**

**Trigger:** User clicks "View community insights" from SegmentCard.

**Modal Structure:**

1. **Sticky Header**
   - Title: "Community Insights"
   - Segment name: "Main St, 1600-1700 block"
   - Close button (X icon)

2. **Overview Section** (4 gradient stat cards)
   - **Total Reports:** 44 (blue gradient background)
   - **Avg Rating:** 3.8 (amber gradient)
   - **Confidence:** 87 (green gradient)
   - **30d Trend:** +0.4 (green gradient, up-arrow icon)

3. **30-Day Trend Chart** (bar chart)
   - 4 columns representing weekly aggregations:
     - Week 1: 3.2 (8 reports)
     - Week 2: 3.4 (11 reports)
     - Week 3: 3.6 (12 reports)
     - Week 4: 3.8 (14 reports) ← Latest
   - Bar color: Gradient from amber (low) to green (high)
   - Y-axis: 0-5 rating scale
   - X-axis: Week labels
   - Hover: Show exact rating + report count

4. **Rating Distribution** (horizontal bar chart)
   - 5 rows (1 star → 5 stars)
   - Bar length proportional to count:
     - ⭐ (1 star): 8 reports (18%)
     - ⭐⭐ (2 stars): 15 reports (34%)
     - ⭐⭐⭐ (3 stars): 12 reports (27%)
     - ⭐⭐⭐⭐ (4 stars): 6 reports (14%)
     - ⭐⭐⭐⭐⭐ (5 stars): 3 reports (7%)
   - Color: amber-500
   - Shows distribution skew

5. **Tag Frequency** (2-column grid)
   - 4 most common tags with counts and trends:
     - "poor lighting" → 18 mentions (+2 this week) [green badge]
     - "low foot traffic" → 12 mentions (-1 this week) [red badge]
     - "cars too close" → 8 mentions (0) [neutral]
     - "construction blockage" → 4 mentions (+4) [green badge]
   - Tag name + count + trend badge

6. **Recent Activity Timeline** (7 items)
   - Chronological list of recent community actions:
     - Icon (ThumbsUp = agree, Sparkles = improvement)
     - Action text: "Anonymous agreed with rating"
     - Timestamp: "2 hours ago"
   - Example entries:
     1. 🎉 Sparkles (amber) - "Anonymous noted improvement" - "2 hours ago"
     2. 👍 ThumbsUp (blue) - "Anonymous agreed with rating" - "5 hours ago"
     3. 👍 ThumbsUp - "Anonymous agreed with rating" - "1 day ago"
     4. ⭐ Star - "New rating: 4 stars" - "1 day ago"
     5. 🎉 Sparkles - "Anonymous noted improvement" - "2 days ago"
     6. 👍 ThumbsUp - "Anonymous agreed with rating" - "3 days ago"
     7. ⭐ Star - "New rating: 2 stars" - "3 days ago"
   - Fade effect on older items (reduced opacity)

7. **Privacy Note** (blue info box at bottom)
   - Users icon (blue)
   - Text: "All contributions are anonymous. We aggregate data to protect individual privacy. Raw GPS traces are never stored."
   - Link: "Read full privacy policy" → docs/PRIVACY_NOTES.md

**Modal Behavior:**
- z-index 100 (above everything)
- Backdrop blur + opacity overlay
- Smooth zoom-in animation on open
- Scrollable content area if needed
- Click backdrop or close button → Dismiss modal

#### Interactions (Community Details Modal)

1. **Scroll content** → View all sections
2. **Hover chart bars** → Show exact values in tooltip
3. **Hover timeline item** → Highlight (subtle background change)
4. **Click "Read full privacy policy"** → Open docs/PRIVACY_NOTES.md in new window or modal
5. **Click backdrop or X** → Close modal, return to SegmentCard (or map)

#### Planned Module Mapping

| UI Component | Planned Module | Implementation Notes |
|--------------|----------------|----------------------|
| `SegmentCard.tsx` | `src/routes_diary/index.js` | Segment click handler, card positioning, data fetching |
| Segment data fetch | `src/api/diary.js` | `getSegmentDetails(segmentId)` → GET `/api/diary/segments/:id` |
| "Agree" action | `src/api/diary.js` | `submitAgree(segmentId)` → POST `/api/diary/agree` |
| "Feels safer" action | `src/api/diary.js` | `submitImprove(segmentId)` → POST `/api/diary/improve` |
| `CommunityDetailsModal.tsx` | `src/routes_diary/index.js` | Full segment analytics view, chart rendering |
| Segment analytics fetch | `src/api/diary.js` | `getSegmentAnalytics(segmentId)` → GET `/api/diary/segments/:id/analytics` |
| Trend chart | Chart.js or custom | Weekly aggregation bar chart |
| Rating distribution | Chart.js or custom | Horizontal bar chart (count by star rating) |
| Tag frequency | Simple HTML/CSS | Grid with badges |
| Recent activity timeline | Simple HTML/CSS | List with icons, styled items |

**API Endpoints Required:**

```javascript
// src/api/diary.js

// Get segment summary for SegmentCard
export async function getSegmentDetails(segmentId) {
  return http.get(`/api/diary/segments/${segmentId}`);
  // Returns: { rating, n_eff, trend_30d, top_tags, last_updated, total_reports }
}

// Get full analytics for CommunityDetailsModal
export async function getSegmentAnalytics(segmentId) {
  return http.get(`/api/diary/segments/${segmentId}/analytics`);
  // Returns: {
  //   rating, n_eff, trend_30d, total_reports,
  //   weekly_trend: [{ week, rating, count }, ...],
  //   rating_distribution: [{ stars, count }, ...],
  //   tag_frequency: [{ tag, count, trend }, ...],
  //   recent_activity: [{ type, timestamp }, ...]
  // }
}

// Submit "Agree" action
export async function submitAgree(segmentId) {
  return http.post(`/api/diary/agree`, { segment_id: segmentId });
  // Returns: { success: true, new_n_eff: 45 }
}

// Submit "Feels safer" action
export async function submitImprove(segmentId) {
  return http.post(`/api/diary/improve`, { segment_id: segmentId });
  // Returns: { success: true, improvement_count: 12 }
}
```

---

## 5. Four Scenarios Summary Table

| Scenario | Trigger | Key Components | Primary Interactions | Planned Modules | Data Requirements |
|----------|---------|----------------|---------------------|-----------------|-------------------|
| **1. Initial State** | User enters diary mode | TopBar, LeftPanel, MapCanvas (segments), RightPanel (empty), RecorderDock | Click "Record trip", hover segments, click segment | `routes_diary/index.js`, `map/segments_layer.js` | `segments_phl.geojson` with ratings |
| **2. Rating Modal** | Click "Finish" after recording | RatingModal (stars, tags, segment overrides, privacy note) | Select rating, choose tags, override segments, submit | `routes_diary/form_submit.js`, `api/diary.js`, `utils/match.js` | GPS trace → segment matching |
| **3. Post-Submit** | Modal submitted successfully | Snackbar, MapCanvas (updated segments), Safer Alternative Strip, RightPanel (charts) | View updated map, click "Show route", explore charts | `map/routing_overlay.js`, `utils/decay.js`, chart modules | Time-decay, A* routing |
| **4. Community** | Click any segment on map | SegmentCard (rating, trend, actions), CommunityDetailsModal (charts, timeline) | "Agree", "Feels safer", view full analytics | `routes_diary/index.js`, `api/diary.js` (segment endpoints) | Segment analytics API |

---

## 6. Gaps and Risks Analysis

### 6.1 Architecture Gaps

#### ⚠️ **CRITICAL: Technology Stack Mismatch (HIGH RISK)**

| Aspect | Repository (Current) | UI Scenarios | Risk Level |
|--------|---------------------|--------------|------------|
| **UI Framework** | Vanilla JavaScript | React 18 + TypeScript | 🔴 **HIGH** |
| **Component Model** | DOM manipulation | JSX components | 🔴 **HIGH** |
| **State Management** | Custom store (observer) | React hooks | 🔴 **HIGH** |
| **Styling** | Plain CSS | Tailwind CSS + Radix UI | 🟡 MEDIUM |
| **Map Rendering** | MapLibre GL (vector) | Canvas 2D | 🟡 MEDIUM |
| **Charts** | Chart.js | Custom React | 🟡 MEDIUM |

**Decision Required:**

Three options for integration:

| Option | Pros | Cons | Effort | Recommendation |
|--------|------|------|--------|----------------|
| **A. React Migration** | - Modern framework<br>- Reuse UI scenarios directly<br>- Better maintainability | - Requires refactoring entire dashboard<br>- High risk of bugs<br>- 4-6 week timeline | **VERY HIGH** | ⚠️ Only if team wants full modernization |
| **B. Vanilla JS Port** | - Consistent with existing code<br>- No breaking changes<br>- Reuse map/state infra | - Lose React benefits<br>- Manual DOM manipulation<br>- Rewrite all UI components | **HIGH** | ✅ **RECOMMENDED** if staying vanilla |
| **C. Hybrid (Web Components)** | - Gradual migration path<br>- Coexist both approaches | - Complexity of two systems<br>- State sync challenges<br>- Learning curve | **MEDIUM-HIGH** | ⚠️ Only if planning future React adoption |

**Recommendation:** **Option B (Vanilla JS Port)** for M1, unless stakeholders commit to full React migration (6+ months).

---

### 6.2 Missing Infrastructure Gaps

#### 🔴 **GPS Recording & Matching (VERY HIGH COMPLEXITY)**

**Missing:**
- GPS recording state machine
- Geolocation API integration
- Real-time GPS trace visualization
- Segment matching algorithm (`src/utils/match.js`)

**Complexity Drivers:**
1. **Geolocation API limitations:**
   - Permission prompts (UX friction)
   - Accuracy varies (5-50m error)
   - Battery drain on mobile
   - Not available in insecure contexts (requires HTTPS)

2. **Segment Matching Algorithm:**
   - Must snap GPS points to nearest segment within tolerance (10m)
   - Handle GPS noise (outliers, jumps)
   - Filter out stationary periods (user stopped)
   - Group consecutive points by segment ID
   - Performance: O(n × m) naive (n = GPS points, m = segments)
   - Optimization needed: Spatial index (R-tree, quadtree)

**Estimated Effort:** 2-3 weeks for robust implementation

---

#### 🔴 **Street Network Segmentation (VERY HIGH COMPLEXITY)**

**Missing:**
- `data/segments_phl.geojson`
- Philadelphia OSM street network extraction
- Segmentation algorithm
- Precomputed ratings (seed data)

**Data Pipeline:**

1. **Extract OSM Data:**
   - Download Philadelphia OSM extract (~50 MB)
   - Filter to walkable/bikeable ways (exclude highways, private roads)
   - Extract relevant tags: name, type, surface, lit

2. **Segment Streets:**
   - Break ways into segments (every 100-200m)
   - Generate unique segment IDs
   - Compute midpoint coordinates for each segment
   - Estimate segment count: 15,000-25,000 for Philadelphia

3. **Seed Initial Ratings:**
   - Option A: Use crime data to compute initial ratings (low crime = higher rating)
   - Option B: Start all segments at 3.0 (neutral)
   - Option C: Use external safety datasets (walkability indices)

4. **Output Format:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": 1,
      "geometry": {
        "type": "LineString",
        "coordinates": [[-75.1652, 39.9526], [-75.1654, 39.9528]]
      },
      "properties": {
        "segment_id": 1,
        "name": "Main St",
        "rating": 3.5,
        "n_eff": 12.4,
        "length_m": 180,
        "tags_count": { "poor lighting": 4, "low foot traffic": 2 }
      }
    }
  ]
}
```

**Estimated File Size:** 5-10 MB for Philadelphia

**Estimated Effort:** 1-2 weeks for data pipeline development

---

#### 🔴 **Server-Side Backend (HIGH COMPLEXITY)**

**Missing:**
- Entire `server/` directory
- Database schema (PostgreSQL + PostGIS recommended)
- API endpoints (submit, segments, route, agree, improve)
- Authentication/authorization (if needed)
- Data aggregation logic

**Database Schema (Simplified):**

```sql
-- Segments table (precomputed from GeoJSON)
CREATE TABLE segments (
  segment_id INTEGER PRIMARY KEY,
  name VARCHAR(255),
  geometry GEOMETRY(LineString, 4326),
  length_m REAL
);

-- Ratings table
CREATE TABLE ratings (
  id SERIAL PRIMARY KEY,
  segment_id INTEGER REFERENCES segments(segment_id),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  travel_mode VARCHAR(10), -- 'walk' or 'bike'
  timestamp TIMESTAMP DEFAULT NOW(),
  tags TEXT[] -- Array of tag strings
);

-- Community actions table
CREATE TABLE actions (
  id SERIAL PRIMARY KEY,
  segment_id INTEGER REFERENCES segments(segment_id),
  action_type VARCHAR(20), -- 'agree' or 'improve'
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Saved routes table (optional)
CREATE TABLE routes (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255), -- Anonymous or hashed
  route_name VARCHAR(100),
  segment_ids INTEGER[],
  created_at TIMESTAMP DEFAULT NOW()
);
```

**API Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/diary/submit` | POST | Submit new rating |
| `/api/diary/segments/:id` | GET | Get segment summary |
| `/api/diary/segments/:id/analytics` | GET | Get full segment analytics |
| `/api/diary/agree` | POST | Increment agreement count |
| `/api/diary/improve` | POST | Record improvement note |
| `/api/diary/route` | POST | Compute safer alternative route |

**Estimated Effort:** 2-3 weeks for MVP backend

---

### 6.3 UI/UX Risks

#### 🟡 **Mobile Responsiveness (HIGH PRIORITY)**

**Issue:** GPS recording is primarily a mobile use case, but current dashboard is desktop-focused.

**Gaps:**
- No mobile layout breakpoints
- LeftPanel/RightPanel fixed widths (320px, 360px)
- Map controls too small for touch
- Rating modal not optimized for small screens

**Required:**
- Responsive breakpoints (320px, 768px, 1024px)
- Collapsible panels on mobile
- Touch-optimized controls (larger tap targets)
- Bottom sheet modal for mobile (instead of centered)

**Estimated Effort:** 1 week for mobile optimization

---

#### 🟡 **Performance with Segment Layers (MEDIUM RISK)**

**Issue:** UI scenarios use Canvas 2D rendering, but existing dashboard uses MapLibre vector layers.

**Considerations:**
- Philadelphia: 15,000-25,000 segments
- MapLibre can handle 10,000+ features efficiently with vector tiles
- Canvas requires manual redraw on pan/zoom (more complex)

**Recommendation:** Use MapLibre vector layers instead of Canvas for better performance and integration.

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| **MapLibre Vector Layers** | - Better performance<br>- Native zoom/pan<br>- Hover/click built-in | - Learning curve for styling<br>- Less custom rendering |
| **Canvas 2D** | - Full control over rendering<br>- Custom animations | - Manual pan/zoom handling<br>- No native interactions<br>- Worse performance at scale |

**Estimated Effort:** 3-5 days to implement with MapLibre

---

### 6.4 Data Pipeline Risks

#### 🔴 **Privacy Implementation (MEDIUM-HIGH RISK)**

**Missing:**
- `docs/PRIVACY_NOTES.md`
- Data anonymization logic
- Raw GPS deletion policy
- GDPR/CCPA compliance measures

**Requirements:**
1. **GPS Trace Deletion:**
   - Never store raw GPS coordinates in database
   - Only store matched segment IDs
   - Delete GPS trace from browser after submission

2. **Segment-Level Aggregation:**
   - All ratings aggregated to segment level
   - No per-user rating history exposed
   - "Anonymous" label on all community actions

3. **Data Retention:**
   - Time-decay naturally reduces old rating influence
   - Optional: Hard delete ratings > 1 year old

4. **Legal Compliance:**
   - Privacy policy must be reviewed by legal team
   - GDPR right to deletion (if user IDs stored)
   - CCPA data disclosure requirements

**Estimated Effort:** 1-2 weeks (technical + legal review)

---

### 6.5 Feature Flag Implementation

**Issue:** Prompt mentions `VITE_FEATURE_DIARY` flag, but not found in current code.

**Implementation:**

1. **vite.config.js:**
```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist' },
  define: {
    'import.meta.env.VITE_FEATURE_DIARY': JSON.stringify(process.env.VITE_FEATURE_DIARY || 'false'),
  },
});
```

2. **Usage in code:**
```javascript
// src/routes_diary/index.js
if (import.meta.env.VITE_FEATURE_DIARY !== 'true') {
  console.warn('Diary feature disabled');
  return;
}

// Show TopBar mode switcher only if enabled
if (import.meta.env.VITE_FEATURE_DIARY === 'true') {
  renderModeSelector();
}
```

3. **Environment:**
```bash
# .env.development
VITE_FEATURE_DIARY=true

# .env.production
VITE_FEATURE_DIARY=false  # Until MVP ready
```

**Estimated Effort:** 1 day to implement

---

## 7. Recommended Phased Implementation

### Phase 0: Foundation (Week 1-2)

**Goal:** Architectural decisions and scaffolding

**Tasks:**
1. ✅ Discovery report (this document)
2. 🔲 Schedule architecture decision meeting
   - Invite: Dev team, UX designer, product owner
   - Decide: React vs. vanilla JS vs. hybrid
   - Document decision rationale
3. 🔲 Create missing specifications
   - Port `WORKFLOW_SPECS.md` → `docs/DIARY_SPEC.md`
   - Draft `docs/PRIVACY_NOTES.md`
   - Define API contracts in `docs/API_DIARY.md`
4. 🔲 Create feature directory structure
   - `mkdir src/routes_diary/`
   - `touch src/routes_diary/index.js`
   - `touch src/api/diary.js`
   - `touch src/utils/match.js`
   - `touch src/utils/decay.js`
5. 🔲 Implement feature flag
   - Update `vite.config.js`
   - Add environment variables
   - Add flag checks in code

**Deliverables:**
- Architecture decision document
- `docs/DIARY_SPEC.md`, `docs/PRIVACY_NOTES.md`, `docs/API_DIARY.md`
- Feature flag implementation
- Directory scaffolding

**Risk:** LOW (planning and setup only)

---

### Phase 1: Segment Visualization (Week 3)

**Goal:** Display street segments on map with rating colors

**Tasks:**
1. 🔲 Prototype street network segmentation
   - Download Philadelphia OSM extract
   - Write Python script to segment streets (every 100m)
   - Generate mock `data/segments_phl.geojson` (100 segments for testing)
2. 🔲 Create `src/map/segments_layer.js`
   - Load segments GeoJSON via `src/api/boundaries.js` pattern
   - Render segments as MapLibre line layer
   - Color scale: 1 (amber) → 5 (green)
   - Line width: Proportional to n_eff (confidence)
3. 🔲 Add hover/click handlers
   - Hover: Tooltip with rating and confidence
   - Click: Log segment ID (SegmentCard in Phase 3)
4. 🔲 Add legend
   - Extend `src/map/legend.js` with segment-specific legend
   - "Color = rating, Width = confidence"

**Deliverables:**
- `data/segments_phl.geojson` (mock 100 segments)
- `src/map/segments_layer.js`
- Segment visualization on map
- Legend

**Risk:** MEDIUM (MapLibre layer styling learning curve)

---

### Phase 2: GPS Recording & Matching (Week 4-5)

**Goal:** Record GPS traces and match to segments

**Tasks:**
1. 🔲 Implement GPS recorder UI
   - Add RecorderDock component (vanilla JS or React)
   - Integrate Geolocation API (`navigator.geolocation.watchPosition`)
   - Store GPS trace in memory (array of {lat, lng, timestamp})
   - Display GPS dots on map in real-time
2. 🔲 Implement `src/utils/match.js`
   - For each GPS point, find nearest segment within 10m (Turf.js `nearestPointOnLine`)
   - Group consecutive points by segment ID
   - Filter segments with < 3 points (noise)
   - Return matched segment IDs
3. 🔲 Add GPS recording state machine
   - States: idle → recording → paused → recording → finished
   - Buttons: Start (green) → Pause (yellow) / Finish (red)
   - Store state in `src/state/store.js`

**Deliverables:**
- RecorderDock component
- GPS recording functionality
- `src/utils/match.js` with matching algorithm
- GPS trace visualization on map

**Risk:** HIGH (GPS accuracy, matching algorithm complexity)

---

### Phase 3: Rating Form & Submission (Week 6)

**Goal:** Collect user ratings and submit to API

**Tasks:**
1. 🔲 Create RatingModal component (vanilla JS or React)
   - Overall rating (1-5 stars)
   - Tag multi-select (max 3)
   - Segment overrides (list matched segments)
   - Travel mode (walk/bike)
   - Save as route toggle
   - Privacy note with link to `docs/PRIVACY_NOTES.md`
2. 🔲 Implement `src/routes_diary/form_submit.js`
   - Form validation (rating required)
   - Prepare rating data object
   - Call `src/api/diary.js` → `submitRating()`
3. 🔲 Implement `src/api/diary.js`
   - `submitRating()` → POST `/api/diary/submit`
   - Mock API for now (return success after 500ms delay)
4. 🔲 Add post-submit toast
   - "Thanks — updating map."
   - 2-second duration

**Deliverables:**
- RatingModal component
- `src/routes_diary/form_submit.js`
- `src/api/diary.js` (mock endpoints)
- Form submission flow

**Risk:** MEDIUM (form complexity, validation)

---

### Phase 4: Segment Updates & Insights (Week 7)

**Goal:** Update map after submission and show insights

**Tasks:**
1. 🔲 Implement `src/utils/decay.js`
   - Time-decay function (exponential decay)
   - Bayesian shrinkage (prior mean + observed mean)
   - Calculate n_eff (effective sample size)
2. 🔲 Update segment visualization
   - Re-render segments with new ratings
   - Glow animation on updated segments (2-second pulse)
   - Update tooltip to show "Updated X min ago"
3. 🔲 Add RightPanel insights
   - Trend chart (8-week sparkline)
   - Top tags bar chart (3 most common)
   - 7×24 heatmap (reuse existing `src/charts/heat_7x24.js`)
4. 🔲 Implement safer alternative routing
   - Create `src/map/routing_overlay.js`
   - A* pathfinding with safety penalties
   - Display "Safer alternative" strip if found
   - Highlight alternative route on map

**Deliverables:**
- `src/utils/decay.js`
- Updated segment visualization with glow animation
- RightPanel insights (trend, tags, heatmap)
- `src/map/routing_overlay.js`
- Safer alternative routing

**Risk:** MEDIUM-HIGH (routing algorithm complexity)

---

### Phase 5: Community Features (Week 8)

**Goal:** Segment interaction and community analytics

**Tasks:**
1. 🔲 Create SegmentCard component
   - Click segment → Show floating card
   - Display: rating, trend, confidence, top tags
   - Action buttons: "Agree" (ThumbsUp), "Feels safer" (Sparkles)
   - Link to "View community insights"
2. 🔲 Create CommunityDetailsModal
   - Full-screen modal with segment analytics
   - Overview stats (total reports, avg rating, confidence, trend)
   - 30-day trend chart (4 weekly bars)
   - Rating distribution (5-bar horizontal chart)
   - Tag frequency (2-column grid)
   - Recent activity timeline (7 items)
   - Privacy note at bottom
3. 🔲 Implement community action APIs
   - `submitAgree()` → POST `/api/diary/agree`
   - `submitImprove()` → POST `/api/diary/improve`
   - `getSegmentDetails()` → GET `/api/diary/segments/:id`
   - `getSegmentAnalytics()` → GET `/api/diary/segments/:id/analytics`
   - Mock APIs for now

**Deliverables:**
- SegmentCard component
- CommunityDetailsModal component
- Community action APIs (mock)

**Risk:** MEDIUM (chart rendering, modal complexity)

---

### Phase 6: Backend Implementation (Week 9-10)

**Goal:** Implement server-side API and database

**Tasks:**
1. 🔲 Set up PostgreSQL + PostGIS database
   - Create segments, ratings, actions, routes tables
   - Import `segments_phl.geojson` into segments table
2. 🔲 Implement API endpoints
   - `POST /api/diary/submit` - Submit rating
   - `GET /api/diary/segments/:id` - Get segment summary
   - `GET /api/diary/segments/:id/analytics` - Get full analytics
   - `POST /api/diary/agree` - Increment agreement
   - `POST /api/diary/improve` - Record improvement
   - `POST /api/diary/route` - Compute safer route (optional)
3. 🔲 Implement data aggregation logic
   - Time-decay aggregation (use `src/utils/decay.js` logic on server)
   - Tag frequency counting
   - Rating distribution
   - Recent activity queries
4. 🔲 Add authentication (if needed)
   - Anonymous submissions: No auth required
   - User accounts: JWT or session-based auth

**Deliverables:**
- PostgreSQL database with schema
- API endpoints implementation
- Data aggregation queries
- Authentication system (if needed)

**Risk:** MEDIUM-HIGH (backend complexity, database optimization)

---

### Phase 7: Full Street Network & Data Pipeline (Week 11)

**Goal:** Generate full Philadelphia street network segmentation

**Tasks:**
1. 🔲 Download Philadelphia OSM extract
   - Source: Geofabrik or Overpass API
   - Filter to walkable/bikeable ways
2. 🔲 Run segmentation algorithm
   - Break ways into 100-200m segments
   - Generate segment IDs (1 - 25,000)
   - Compute midpoints and lengths
3. 🔲 Seed initial ratings
   - Option A: Use crime data (aggregate by segment)
   - Option B: Use walkability scores
   - Option C: Start all at 3.0 (neutral)
4. 🔲 Generate `data/segments_phl.geojson`
   - Full 15,000-25,000 segments
   - Estimated size: 5-10 MB
5. 🔲 Import into database
   - Bulk insert into segments table
   - Create spatial index for performance

**Deliverables:**
- Full `data/segments_phl.geojson`
- Segmentation script (Python or Node.js)
- Database import complete

**Risk:** MEDIUM (data processing, OSM complexity)

---

### Phase 8: Mobile Optimization (Week 12)

**Goal:** Optimize for mobile devices

**Tasks:**
1. 🔲 Add responsive breakpoints
   - 320px (mobile portrait)
   - 768px (tablet)
   - 1024px (desktop)
2. 🔲 Optimize panel layouts
   - Collapsible panels on mobile
   - Bottom sheet for RatingModal on mobile
   - Floating dock positioned for thumb reach
3. 🔲 Touch-optimized controls
   - Larger tap targets (44px minimum)
   - Touch-friendly star selector
   - Swipe gestures for panels
4. 🔲 Test GPS recording on mobile
   - Battery drain testing
   - Accuracy testing in urban canyons
   - Permission prompt UX

**Deliverables:**
- Responsive layout
- Mobile-optimized components
- Touch controls
- Mobile testing results

**Risk:** MEDIUM (responsive design complexity)

---

### Phase 9: Testing & Polish (Week 13-14)

**Goal:** E2E testing, performance optimization, accessibility

**Tasks:**
1. 🔲 E2E tests
   - Test all 4 workflow scenarios
   - Test GPS recording → rating → submission flow
   - Test segment interaction → community actions
   - Test safer route computation
2. 🔲 Performance optimization
   - Segment layer rendering optimization (test with 25,000 segments)
   - Map pan/zoom performance
   - Chart rendering optimization
   - API response caching
3. 🔲 Accessibility audit
   - Keyboard navigation
   - Screen reader support (ARIA labels)
   - Color contrast (WCAG AA)
   - Focus indicators
4. 🔲 Cross-browser testing
   - Chrome, Firefox, Safari, Edge
   - iOS Safari (GPS recording)
   - Android Chrome (GPS recording)
5. 🔲 Documentation
   - User guide
   - Developer documentation
   - API documentation

**Deliverables:**
- E2E test suite
- Performance benchmarks
- Accessibility compliance report
- Cross-browser compatibility matrix
- Documentation

**Risk:** LOW (testing and polish)

---

### Timeline Summary

| Phase | Weeks | Effort | Risk | Blockers |
|-------|-------|--------|------|----------|
| 0. Foundation | 1-2 | LOW | LOW | Architecture decision |
| 1. Segment Viz | 3 | MEDIUM | MEDIUM | OSM data extraction |
| 2. GPS & Matching | 4-5 | HIGH | HIGH | Geolocation API limitations |
| 3. Rating Form | 6 | MEDIUM | MEDIUM | - |
| 4. Insights & Routing | 7 | HIGH | MEDIUM-HIGH | A* algorithm complexity |
| 5. Community | 8 | MEDIUM | MEDIUM | - |
| 6. Backend | 9-10 | HIGH | MEDIUM-HIGH | Database setup |
| 7. Full Data Pipeline | 11 | MEDIUM | MEDIUM | OSM processing |
| 8. Mobile | 12 | MEDIUM | MEDIUM | - |
| 9. Testing & Polish | 13-14 | MEDIUM | LOW | - |

**Total Estimated Timeline:** 14 weeks (3.5 months) for full MVP

**Critical Path:**
1. Architecture decision (Phase 0) → Blocks all development
2. GPS matching algorithm (Phase 2) → Blocks rating submission
3. Backend implementation (Phase 6) → Blocks real data flow

---

## 8. Open Questions for Stakeholders

### Architecture

1. **React vs. Vanilla JS:** Which integration strategy should we pursue?
   - React migration (4-6 months, full modernization)
   - Vanilla JS port (3-4 months, consistent with existing code)
   - Hybrid approach (4-5 months, gradual migration)

2. **Feature Flag:** Should diary mode be behind a feature flag in MVP?
   - Yes: Safer rollout, can disable if issues arise
   - No: Full integration from day 1

### Data & Privacy

3. **Street Network Source:** Which OSM data source should we use?
   - Geofabrik extract (easier, updated weekly)
   - Overpass API (real-time, more complex)

4. **Initial Segment Ratings:** How should we seed initial ratings?
   - Crime data aggregation (requires data science work)
   - Walkability scores (requires external data)
   - Neutral 3.0 (simplest, cold start problem)

5. **Privacy Policy:** Who will review and approve `docs/PRIVACY_NOTES.md`?
   - Legal team
   - Compliance officer
   - Product owner

6. **User Authentication:** Do we need user accounts?
   - Anonymous only (simpler, better privacy)
   - Optional accounts (saved routes, personalization)
   - Required accounts (moderation, accountability)

### Features

7. **Saved Routes:** Should MVP include "My routes" feature?
   - Yes: User value, encourages repeat usage
   - No: Simplify MVP, add later

8. **Alternative Routing:** Should MVP compute safer alternatives?
   - Yes: Key value proposition
   - No: Complex algorithm, add in v2

9. **Community Moderation:** How do we handle abusive ratings/tags?
   - No moderation (trust users)
   - Automated filtering (profanity, spam detection)
   - Manual review (requires moderation team)

### Performance

10. **Segment Count:** What's acceptable segment count for Philadelphia?
    - 10,000 (sparse, less granular)
    - 15,000-20,000 (balanced)
    - 25,000+ (dense, better coverage)

11. **Map Rendering:** Canvas 2D or MapLibre vector layers?
    - Canvas 2D (matches UI scenarios, more control)
    - MapLibre (better performance, native integration)

---

## 9. Conclusion

This discovery report provides a comprehensive analysis of the existing engagement-project repository and the Route Safety Diary UI scenarios. The repository contains a solid foundation with reusable map infrastructure, state management, and API patterns. However, significant gaps exist in:

1. **Technology alignment** (React vs. vanilla JS) - **CRITICAL DECISION REQUIRED**
2. **GPS recording and segment matching** - **HIGH COMPLEXITY**
3. **Street network segmentation and data pipeline** - **HIGH COMPLEXITY**
4. **Server-side backend implementation** - **MEDIUM-HIGH COMPLEXITY**
5. **Mobile optimization** - **HIGH PRIORITY**

The 4 UI scenarios provide clear UX direction across the complete user journey:
- **Scenario 1:** Initial state with segment visualization
- **Scenario 2:** Post-recording rating submission
- **Scenario 3:** Map updates and insights
- **Scenario 4:** Community interaction and analytics

**Recommended Next Steps:**
1. Schedule architecture decision meeting within 1 week
2. Create missing specification documents (`DIARY_SPEC.md`, `PRIVACY_NOTES.md`)
3. Prototype segment data pipeline (100 segments for testing)
4. Begin Phase 0: Foundation work (scaffolding, feature flag)

**Estimated Full MVP Timeline:** 14 weeks (3.5 months)

**Primary Risks:**
- Architecture mismatch (HIGH)
- GPS matching algorithm complexity (HIGH)
- Segment data pipeline (HIGH)
- Mobile responsiveness (MEDIUM-HIGH)

The discovery phase is complete. This report and the accompanying evidence log (`logs/DISCOVERY_2025-11-07T140000.md`) provide all necessary information to begin M1 Task Packet planning.

---

**Report Prepared By:** Agent-M (Monitor/Reviewer/Auditor)
**Date:** 2025-11-07
**Status:** ✅ Complete
**Next Action:** Architecture decision meeting
