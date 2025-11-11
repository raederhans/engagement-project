# Route Safety Diary — M2 Visual Specification

**Version:** M2
**Status:** Agent-I implementation spec
**Audience:** Implementing developers (Agent-I), QA, stakeholders

---

## 1. Purpose

This document specifies the **visual encoding, UI copy, interaction semantics, and accessibility** requirements for the Route Safety Diary M2 release. All criteria are testable and tied to acceptance tests in [TEST_PLAN_M2.md](./TEST_PLAN_M2.md).

---

## 2. Segment Visual Encoding

### 2.1 Confidence Metric

**Formula:**
```javascript
confidence = Math.min(1, n_eff / 10)
```

- `n_eff`: Effective sample size (sum of time-decayed weights)
- Range: [0, 1]
- Full confidence reached at n_eff ≥ 10

**Purpose:** Modulates opacity to signal data reliability.

### 2.2 Stability Metric (30-Day Trend)

**Source:** `delta_30d` property (recent_mean - older_mean)

**Classification:**
```javascript
if (delta_30d <= -0.5) return 'improving'      // △ ≤ -0.5
if (delta_30d >= 0.5)  return 'worsening'      // △ ≥ +0.5
return 'stable'                                // -0.5 < △ < +0.5
```

**Visual Indicators:**
- **Improving:** Green chevron-up icon (↗) in hover card, subtle green tint on segment stroke
- **Worsening:** Red chevron-down icon (↘) in hover card, subtle red tint on segment stroke
- **Stable:** No icon, neutral stroke color

### 2.3 Stroke Width (Effective Samples)

**Mapping:**
```javascript
const baseWidth = 3
const maxWidth = 8
const scaleFactor = 0.5
width = baseWidth + Math.min(maxWidth - baseWidth, n_eff * scaleFactor)
```

**Behavior:**
- n_eff = 1 → width = 3.5px
- n_eff = 5 → width = 5.5px
- n_eff = 10+ → width = 8px (capped)

**Rationale:** Visually emphasize well-sampled segments without overwhelming the map.

### 2.4 Color Mapping (Safety Rating)

**Source:** `decayed_mean` property (Bayesian-shrunk mean after time-decay)

**Scale:** Diverging red-yellow-green with middle at 3.0

**Color Stops (RGB Hex):**
```javascript
const colorScale = [
  { value: 1.0, color: '#dc2626' },  // Red (very unsafe)
  { value: 2.0, color: '#f97316' },  // Orange-red
  { value: 3.0, color: '#fbbf24' },  // Yellow (neutral, prior)
  { value: 4.0, color: '#84cc16' },  // Lime
  { value: 5.0, color: '#22c55e' },  // Green (very safe)
]
```

**Interpolation:** Linear RGB between stops.

**Implementation:**
```javascript
function getRatingColor(decayed_mean) {
  const clamped = Math.max(1, Math.min(5, decayed_mean))
  // Linear interpolation between adjacent stops
  // Return RGB hex string
}
```

**Accessibility:**
- WCAG AA contrast maintained on white/light gray basemap
- Color must not be sole encoding (width + icons also convey information)
- Colorblind-safe palette tested with deuteranopia/protanopia simulators

### 2.5 Opacity (Confidence)

**Base Opacity:**
```javascript
const baseOpacity = 0.4
const maxOpacity = 1.0
opacity = baseOpacity + (maxOpacity - baseOpacity) * confidence
```

**Behavior:**
- n_eff = 0 → opacity = 0.4 (faded, uncertain)
- n_eff = 5 → opacity = 0.7
- n_eff ≥ 10 → opacity = 1.0 (solid, reliable)

**Hover State:**
- Opacity increases by +0.2 (capped at 1.0)
- Stroke width increases by +2px

---

## 3. Hover Card UI

### 3.1 Layout Specification

**Structure:**
```
┌─────────────────────────────────┐
│ [Street Name] · [Length]        │  ← Header (bold, 14px)
├─────────────────────────────────┤
│ Safety: [★★★☆☆] [3.2]          │  ← Rating row
│ [Trend Icon] [Trend Text]       │  ← Stability row (conditional)
│ Confidence: [7/10]              │  ← Confidence row
│ Top tags: [tag1, tag2]          │  ← Tags row (conditional)
├─────────────────────────────────┤
│ [Agree 👍] [Feels safer ✨]     │  ← Action buttons (U7)
└─────────────────────────────────┘
```

### 3.2 Content Specifications

**Header:**
- Format: `{street} · {length_m}m`
- Example: "Market St · 233m"
- Font: 14px bold, color: #1f2937 (gray-800)

**Safety Rating Row:**
- Stars: Unicode ★ (filled) and ☆ (empty), color: #fbbf24 (yellow-400)
- Numeric: `{decayed_mean}` formatted to 1 decimal, color: #6b7280 (gray-500)
- Format: `Safety: ★★★☆☆ 3.2`

**Stability Row (conditional):**
- Show only if |delta_30d| ≥ 0.3
- Icon:
  - Improving: ↗ (green #22c55e)
  - Worsening: ↘ (red #dc2626)
- Text:
  - Improving: "Getting safer (+{delta})"
  - Worsening: "Getting riskier ({delta})"
  - Stable: (omitted)
- Example: "↗ Getting safer (+0.6)"

**Confidence Row:**
- Format: `Confidence: {n_eff}/10`
- Show confidence bar:
  - Width: `{confidence * 100}%`
  - Color: #3b82f6 (blue-500) if confidence ≥ 0.7, else #9ca3af (gray-400)
- Example: "Confidence: 7/10" with 70% blue bar

**Tags Row (conditional):**
- Show only if top_tags.length > 0
- Format: `Top tags: {tag1}, {tag2}, {tag3}`
- Max 3 tags, comma-separated
- Font: 12px, color: #6b7280 (gray-500)
- Example: "Top tags: well-lit, busy, bike lane"

**Action Buttons (U7):**
- Two buttons side by side, equal width
- Style:
  - Background: #f3f4f6 (gray-100) default, #e5e7eb (gray-200) hover
  - Border: 1px solid #d1d5db (gray-300)
  - Border-radius: 6px
  - Padding: 8px 12px
  - Font: 13px medium
  - Cursor: pointer
- Disabled state:
  - Background: #f9fafb (gray-50)
  - Color: #9ca3af (gray-400)
  - Cursor: not-allowed
  - Border: 1px solid #e5e7eb (gray-200)
- Text: "Agree 👍" and "Feels safer ✨"

### 3.3 Accessibility

**Keyboard Navigation:**
- Hover card must be focusable (tabindex="0")
- Action buttons receive focus in tab order
- Enter/Space triggers button action
- Escape dismisses hover card

**Screen Reader:**
- Header: `<h3>` with aria-label="Segment: {street}, {length_m} meters"
- Rating: aria-label="Safety rating {decayed_mean} out of 5 stars"
- Buttons: aria-label="Agree with this rating" / "Mark as feeling safer"
- Disabled buttons: aria-disabled="true"

**Visual:**
- Minimum text contrast: 4.5:1 (WCAG AA)
- Focus indicator: 2px solid blue ring (offset 2px)
- Touch targets: minimum 44x44px (iOS/Android guideline)

---

## 4. Route Picker UI

### 4.1 Layout

**Location:** Left panel, below map controls

**Structure:**
```
┌─────────────────────────────────┐
│ Choose a route to record        │  ← Label (12px)
├─────────────────────────────────┤
│ [▼ My commute to work     ]     │  ← Dropdown
│     Primary: 2.3 km · 18 min    │  ← Primary route info
│     Alt: 2.5 km · 19 min        │  ← Alt route info (conditional)
└─────────────────────────────────┘
```

### 4.2 Dropdown Options

**Format:**
```
{route_name}
  Primary: {length_m} km · {duration_min} min
  Alt: {alt_length_m} km · {alt_duration_min} min (if available)
```

**Example:**
```
My commute to work
  Primary: 2.3 km · 18 min
  Alt: 2.5 km · 19 min
```

**Empty State:**
- Text: "No saved routes. Record your first route!"
- Style: Italic, color #9ca3af (gray-400)

### 4.3 Accessibility

- Dropdown: Semantic `<select>` element with label association
- Keyboard: Arrow keys navigate, Enter selects
- Screen reader: Announces option count and current selection

---

## 5. Alternative Route Toggle

### 5.1 UI Copy

**Button Label:** "Show alternative route"

**Toggle States:**
- OFF: "Show alternative route" (default)
- ON: "Hide alternative route"

### 5.2 Visual Style

**Button:**
- Type: Secondary button
- Background: white, border: 1px solid #d1d5db (gray-300)
- Hover: background #f9fafb (gray-50)
- Active (ON): background #dbeafe (blue-100), border #3b82f6 (blue-500)
- Font: 13px medium, color #374151 (gray-700)

**Icon:**
- OFF state: ⭯ (route-alt icon)
- ON state: ✕ (close icon)

### 5.3 Map Overlay Specification

**Primary Route:**
- Color: #3b82f6 (blue-500)
- Width: 4px
- Opacity: 0.8
- Dash: None (solid line)

**Alternative Route:**
- Color: #10b981 (green-500)
- Width: 4px
- Opacity: 0.6
- Dash: [8, 4] (8px line, 4px gap)
- Z-index: Below primary route

**Benefit Summary (when alt shown):**
- Position: Top-right overlay, absolute positioned
- Background: white with 80% opacity, border: 1px solid #e5e7eb (gray-200)
- Shadow: 0 2px 8px rgba(0,0,0,0.1)
- Padding: 12px 16px
- Border-radius: 8px

**Benefit Summary Content:**
```
Alternative route
Distance: +{delta_dist}m ({pct_diff}%)
Safety gain: +{delta_safety} points
```

**Example:**
```
Alternative route
Distance: +183m (+8%)
Safety gain: +0.4 points
```

**Color Coding:**
- Distance delta:
  - Green if < +10%
  - Yellow if +10% to +20%
  - Red if > +20%
- Safety gain:
  - Green if positive
  - Red if negative

### 5.4 Accessibility

- Button: aria-pressed="true|false" to indicate toggle state
- Overlay: aria-live="polite" announces benefit summary when shown
- Screen reader: "Alternative route shown. Distance increase: {delta}, Safety improvement: {gain}"

---

## 6. Recording Simulator UI (U6)

### 6.1 Controls Layout

**Location:** Bottom-center overlay (fixed position)

**Structure:**
```
┌─────────────────────────────────┐
│ Recording your route...         │  ← Status text
│ [▶ Play] [⏸ Pause] [⏹ Finish]  │  ← Control buttons
│ Progress: [████░░░░░░] 42%      │  ← Progress bar
└─────────────────────────────────┘
```

### 6.2 Button Specifications

**Play Button:**
- Icon: ▶
- Enabled states: Initial, Paused
- Disabled states: Playing, Finished
- Action: Start/resume simulation
- aria-label: "Start route recording"

**Pause Button:**
- Icon: ⏸
- Enabled states: Playing
- Disabled states: Initial, Paused, Finished
- Action: Pause simulation
- aria-label: "Pause route recording"

**Finish Button:**
- Icon: ⏹
- Enabled states: All except Finished
- Action: Complete recording, show rating modal
- Style: Destructive/primary color (#dc2626 red)
- aria-label: "Finish and rate route"

### 6.3 Simulator Point Rendering

**Marker Style:**
- Shape: Circle
- Radius: 6px
- Color: #22d3ee (cyan-400)
- Stroke: 1px solid white
- Opacity: 0.9
- Shadow: 0 2px 4px rgba(0,0,0,0.2)

**Animation:**
- Movement: Smooth linear interpolation between coordinates
- Frame rate: 60fps target
- Speed: ~2 seconds per segment (configurable)

**Progress Bar:**
- Width: 200px
- Height: 6px
- Background: #e5e7eb (gray-200)
- Fill color: #3b82f6 (blue-500)
- Border-radius: 3px

### 6.4 Finish Modal

**Trigger:** User clicks "Finish" or simulator reaches end of route

**Layout:**
```
┌────────────────────────────────────────┐
│            Rate your route             │  ← Title
├────────────────────────────────────────┤
│ How safe did you feel?                 │  ← Question
│                                        │
│ [★] [★] [★] [★] [★]                  │  ← Rating stars
│                                        │
│ Tags (optional):                       │  ← Tags section
│ [x] Well-lit  [ ] Busy  [ ] Bike lane │
│                                        │
│ Comments (optional):                   │  ← Textarea
│ [________________________]             │
│                                        │
│       [Cancel]  [Submit]               │  ← Actions
└────────────────────────────────────────┘
```

**Specifications:**
- Modal width: 480px (max), responsive below 600px
- Background: white, shadow: 0 4px 24px rgba(0,0,0,0.15)
- Title: 18px bold, color #111827 (gray-900)
- Star rating: 40px interactive stars, color #fbbf24 (yellow-400)
- Tag checkboxes: Multi-select, 8 predefined options
- Comments: Textarea, max 500 characters, placeholder "Share more details (optional)"
- Cancel: Secondary button (gray)
- Submit: Primary button (blue), disabled until rating selected

**Validation:**
- Rating: Required (1-5 stars)
- Tags: Optional, max 5 selected
- Comments: Optional, max 500 chars
- Submit disabled until rating provided

**Accessibility:**
- Modal: role="dialog", aria-labelledby="modal-title", aria-modal="true"
- Focus trap: Tab cycles within modal
- Escape key: Close modal (same as Cancel)
- Screen reader: Announces "Rate your route dialog opened"

---

## 7. Community Interaction Buttons (U7)

### 7.1 Actions

**Agree 👍:**
- Semantic: "I agree with the current average rating"
- Effect: Contributes one implicit vote at `decayed_mean` value
- Weight: 1.0 (full weight, recent timestamp)

**Feels safer ✨:**
- Semantic: "This segment feels safer than the current rating suggests"
- Effect: Contributes one implicit vote at `decayed_mean + 1` (capped at 5)
- Weight: 1.0

### 7.2 Session Throttling

**Rule:** One vote per action per segment per session

**Implementation:**
- Storage: sessionStorage keyed by `diary_votes_{segment_id}_{action}`
- Value: timestamp of last vote
- Check: On button click, check if key exists
- If exists: Disable button, show tooltip "Already voted this session"
- If not: Allow vote, store timestamp, disable button

**Visual Feedback:**
- Button becomes disabled (gray, not-allowed cursor)
- Tooltip on hover: "You've already voted on this segment"
- Icon change: 👍 → ✓ (checkmark)

**Session Persistence:**
- Votes persist across page refreshes (sessionStorage)
- Votes reset when browser tab closes or user logs out
- No server persistence in M2 (client-side only)

### 7.3 Optimistic Updates

**Flow:**
1. User clicks "Agree 👍"
2. Immediately update localAgg map in memory
3. Re-aggregate segment's decayed_mean
4. Update map layer paint properties (color, opacity)
5. Refresh hover card content
6. Store vote in sessionStorage
7. Disable button

**Rollback:** None (client-side only, no server errors to handle in M2)

### 7.4 Accessibility

- Buttons: Semantic `<button>` elements with aria-label
- Disabled state: aria-disabled="true", tabindex="-1"
- Tooltip: aria-describedby references tooltip element
- Screen reader: "Agree button, already voted this session, disabled"

---

## 8. Error States & Empty States

### 8.1 No Routes Available

**Context:** Route picker dropdown when routes_phl.demo.geojson is empty or fails to load

**UI:**
- Dropdown shows: "No saved routes available"
- Disabled state (gray, not-allowed cursor)
- Below dropdown:
  ```
  No routes found. Check your data file or create a new route.
  ```
- Style: 12px, color #6b7280 (gray-500)

### 8.2 Segment Data Load Failure

**Context:** segments_phl.demo.geojson fails to load or parse

**UI:**
- Map overlay (center, absolute positioned):
  ```
  ┌──────────────────────────────────┐
  │ ⚠ Unable to load segment data    │
  │                                  │
  │ Please check your connection     │
  │ and refresh the page.            │
  │                                  │
  │       [Retry]                    │
  └──────────────────────────────────┘
  ```
- Retry button: Calls `loadSegmentsData()` again
- Style: Yellow background (#fef3c7), border #f59e0b (amber-500)

### 8.3 Invalid Alt Route Metadata

**Context:** Route has alt_segment_ids but missing alt_length_m or alt_duration_min

**Behavior:**
- Log warning to console: "Alt route metadata incomplete for route {route_id}"
- Do not show "Show alternative route" button
- Proceed with primary route only

### 8.4 Simulator Finish Without Route

**Context:** User clicks Finish before selecting a route (edge case)

**Behavior:**
- Show toast notification: "Please select a route first"
- Do not open rating modal
- Keep simulator in initial state

---

## 9. Responsive Behavior

### 9.1 Breakpoints

- **Desktop:** ≥ 1024px (full layout)
- **Tablet:** 768px - 1023px (condensed panel)
- **Mobile:** < 768px (stacked layout)

### 9.2 Mobile Adaptations

**Hover Card:**
- Full-width modal instead of tooltip
- Larger touch targets (48x48px minimum)
- Scrollable if content overflows

**Route Picker:**
- Full-width dropdown
- Stacked info (primary and alt on separate lines)

**Simulator Controls:**
- Stacked buttons (vertical layout)
- Full-width progress bar

**Benefit Summary:**
- Move to bottom overlay (above simulator controls)
- Full-width, compressed padding

---

## 10. Animation & Transitions

### 10.1 Map Layer Transitions

**Segment color/opacity changes:**
- Transition duration: 300ms
- Easing: ease-in-out
- Properties: line-color, line-opacity, line-width

**Hover effects:**
- Transition duration: 150ms
- Easing: ease-out
- Properties: line-width, line-opacity

### 10.2 UI Transitions

**Modal open/close:**
- Animation: Fade + scale (0.95 → 1.0)
- Duration: 200ms
- Easing: cubic-bezier(0.16, 1, 0.3, 1) (spring)

**Button hover/active:**
- Duration: 100ms
- Easing: ease-out
- Properties: background-color, border-color

**Tooltip appearance:**
- Duration: 150ms
- Easing: ease-out
- Animation: Fade in

---

## 11. Acceptance Criteria Summary

All criteria are testable and documented in [TEST_PLAN_M2.md](./TEST_PLAN_M2.md). Key checkpoints:

1. **Confidence opacity:** Segments with n_eff < 5 have opacity < 0.7
2. **Stability icons:** Trend icons appear only when |delta_30d| ≥ 0.3
3. **Color contrast:** All text meets WCAG AA (4.5:1)
4. **Keyboard navigation:** All interactive elements reachable via Tab
5. **Session throttling:** Duplicate votes disabled within same session
6. **Optimistic updates:** Map refreshes <500ms after community action
7. **Responsive:** UI adapts correctly at 768px and 375px widths
8. **Error states:** All error scenarios show user-friendly messages

---

## 12. Open Questions (to resolve before M2 implementation)

- [ ] Should colorblind mode offer alternative palettes (beyond color+width+icons)?
- [ ] Should mobile users see reduced segment density (filter by n_eff threshold)?
- [ ] Should simulator speed be user-configurable or fixed?
- [ ] Should "Feels safer ✨" boost be +1 or configurable?

---

**Document Status:** ✅ Complete, ready for Agent-I implementation
**Last Updated:** 2025-11-11
**Related:** [TEST_PLAN_M2.md](./TEST_PLAN_M2.md), [API_BACKEND_DIARY_M2.md](./API_BACKEND_DIARY_M2.md)
