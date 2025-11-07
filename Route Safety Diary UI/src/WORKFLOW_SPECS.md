# Route Safety Diary - Workflow Specifications

## Overview
A minimal, desktop-focused crime dashboard with community interaction features for the Route Safety Diary mode.

## Workflow States

### 1. Initial State (Ready to Begin)
- **Location**: `/App.tsx` with `isPostSubmit={false}`, `showRatingModal={false}`
- **Features**:
  - Clean three-panel layout (Left: Diary Controls, Center: Map Canvas, Right: Insights)
  - Top bar with mode switches (Crime | Route Safety Diary | Tracts)
  - Time window selector and filter chips
  - Legend chip visible on map
  - Recorder Dock with Start button enabled
  - Placeholder state for Insights panel

### 2. Recording Complete - Rating Modal
- **Location**: `/App.tsx` with `showRatingModal={true}`
- **Component**: `RatingModal.tsx`
- **Features**:
  - Centered modal form with dimmed map background
  - Overall route rating (1-5 stars)
  - Tag selection (up to 3 from predefined list + custom "other" input)
  - Per-segment override selector (max 2 segments)
  - Travel mode picker (walk/bike)
  - "Save as My Route" toggle
  - Privacy note about data storage
  - Submit/Cancel actions

### 3. Post-Submit State
- **Location**: `/App.tsx` with `isPostSubmit={true}`
- **Features**:
  - Brief snackbar: "Thanks — updating map."
  - Map undims with visible segment updates (improved color + width/glow)
  - "Safer alternative now" strip in top-right with:
    - Route improvement details (+2 min, avoids low-rated segments)
    - Thumb-up button for feedback
    - Dismiss (×) button
  - Right Insights panel populates with:
    - Trend sparkline showing rating history
    - Top Tags mini bar chart
    - 7×24 heatmap matrix
  - Legend chip remains visible

### 4. Community Interaction State (Current)
- **Location**: `/App.tsx` with `isPostSubmit={true}` + segment interaction handlers
- **Components**: `SegmentCard.tsx`, `CommunityDetailsModal.tsx`
- **Features**:

#### Map Interactions
- Clickable street segments with hover highlight
- Hover state: increased glow and line width
- Selected state: blue glow highlight to show active segment
- Floating segment card appears on click showing:
  - **Header**: "Segment Details" with prominent "View community insights" link
  - **Stats Grid** (3 columns, centered):
    - Current decayed mean rating (larger text)
    - Δ30d trend with direction icon and color
    - n_eff confidence score (larger text)
  - **Top Tags** (2-3 items): Badge pills in neutral styling
  - **Action Pills** (tactile, rounded-full):
    - 👍 Agree - "Agree" button with hover state changing to dark bg
    - ✨ Feels safer - "Feels safer" button with same interaction
    - Active scale animation on click
  - **Community Link**: Blue underlined text with Users icon
  - Close (×) button in top-right
- Card positioning: Floats above clicked point with transform offset

#### Community Actions
- **Agree Action**:
  - Increments community agrees counter
  - Shows toast: "Thanks — confidence updated"
  - Closes segment card
  - Subtly increases confidence in Insights panel

- **Improvement Action**:
  - Increments improvements counter
  - Shows toast: "Thanks — improvement noted"
  - Closes segment card
  - Subtly adjusts trend data upward

- **Alternative Route Feedback**:
  - Thumb-up on safer alternative strip
  - Shows toast: "Thanks for the feedback"

#### Community Details Modal
- **Trigger**: "View community insights" link in SegmentCard
- **Visual Design**: 
  - Full-screen modal with backdrop blur
  - z-index 100 to appear above all elements
  - Smooth fade-in and zoom animation
  - Sticky header with close button
  - Scrollable content area
- **Content**:
  - **Overview Section**: 4 gradient stat cards (Total Reports, Avg Rating, Confidence, 30d Trend)
  - **30-Day Trend**: Bar chart showing weekly progression
  - **Rating Distribution**: Horizontal bar chart with gradient fills
  - **Tag Frequency**: 2-column grid of tag cards with trend indicators (+/- badges)
  - **Recent Activity**: Timeline of community interactions with action icons
  - **Privacy Note**: Blue info box with Users icon explaining anonymization
- **Interactions**:
  - Click backdrop to close
  - Hover effects on all interactive elements
  - Smooth transitions on data visualization elements

#### UI Hints
- Top bar: "Click segments for insights" with Users icon
- Left panel: Community actions info box showing Agree and Safer icons

## Design Specifications

### Layout
- **8px spacing rhythm** throughout
- **Top bar**: 56px height (h-14)
- **Left panel**: 320px width (w-80)
- **Right panel**: 360px width (w-[360px])
- **Bottom recorder dock**: Floating, bottom-right position

### Typography
- **Headers**: Default (no size classes)
- **Body text**: 14-16px (text-sm, no explicit classes)
- **Helper text**: 12px (text-xs)
- Quiet, AA contrast standards

### Colors
- **Neutral palette**: neutral-50 to neutral-900
- **Rating colors**:
  - 5: #10b981 (green)
  - 4: #84cc16 (lime)
  - 3: #fbbf24 (amber)
  - 2: #f97316 (orange)
  - 1: #ef4444 (red)

### Interactions
- **No celebratory animations** - quick, modest updates only
- **Hover states**: Subtle color transitions and shadows
- **Focus states**: Ring-2, ring-neutral-400 with offset-2
- **Pills/Chips**: Rounded-full, compact padding
- **Toasts**: 2-3 second duration, top-center position

### Accessibility
- All interactive elements keyboard-navigable
- Clear focus indicators
- Meaningful alt text for icons
- AA contrast standards maintained

## Data Flow

### State Management
- App-level state for:
  - Mode selection
  - Modal visibility
  - Community interaction counters
  - Selected segment data
  - Snackbar messages

### Props Cascade
```
App.tsx
├── TopBar (mode)
├── LeftPanel (legend visibility)
├── MapCanvas (segment interactions, post-submit state)
│   ├── SegmentCard
│   └── CommunityDetailsModal
├── RightPanel (insights data, community counters)
├── RecorderDock (finished state)
├── RatingModal (submission)
└── Snackbar (messages)
```

## Privacy & Moderation
- **No free-text input** in community actions (except rating modal "other" tag)
- **Anonymous contributions** - no user identifiers
- **Segment-level aggregation** - raw GPS not retained
- **Privacy notes** visible in modal and details view

## Future Considerations
- Route planning integration
- Historical trip review
- Comparative route analysis
- Community reputation system (lightweight)
- Time-based filtering for community data
