# Route Safety Diary — M2 Test Plan & Acceptance Criteria

**Version:** M2
**Status:** Agent-I implementation spec
**Audience:** QA engineers, Agent-I (implementation verification), stakeholders

---

## 1. Purpose

This document provides **measurable acceptance criteria** for all Route Safety Diary M2 features. Each test is:
- **Testable:** Can be verified objectively (manual or automated)
- **Specific:** Clear pass/fail conditions
- **Traceable:** Links to spec documents

**Related Specifications:**
- [DIARY_SPEC_M2.md](./DIARY_SPEC_M2.md) - Visual encoding, UI copy, interactions
- [CHARTS_SPEC_M2.md](./CHARTS_SPEC_M2.md) - Data visualization charts
- [API_BACKEND_DIARY_M2.md](./API_BACKEND_DIARY_M2.md) - REST API contracts
- [SQL_SCHEMA_DIARY_M2.md](./SQL_SCHEMA_DIARY_M2.md) - Database schema

---

## 2. Test Categories

### 2.1 Scope

- **In Scope:** M2 features (visual encoding, charts, API, database, U6-U7 enhancements)
- **Out of Scope:** M1 features (already verified in M1 audit), M3+ future features

### 2.2 Test Types

- **UT:** Unit tests (automated, Jest/Mocha)
- **IT:** Integration tests (API + DB, automated)
- **E2E:** End-to-end tests (browser, Playwright/Cypress)
- **MT:** Manual tests (visual inspection, accessibility)
- **PT:** Performance tests (load testing, benchmarks)

---

## 3. Visual Encoding Tests (DIARY_SPEC_M2.md)

### T-VIS-001: Confidence Opacity Mapping

**Spec:** Section 2.1, 2.5

**Test Steps:**
1. Load segments with n_eff = [0, 2, 5, 10, 15]
2. Measure rendered opacity values

**Expected:**
```
n_eff=0  → opacity ≈ 0.40
n_eff=2  → opacity ≈ 0.52
n_eff=5  → opacity ≈ 0.70
n_eff=10 → opacity = 1.00
n_eff=15 → opacity = 1.00 (capped)
```

**Type:** E2E
**Pass Criteria:** Opacity within ±0.05 of expected

---

### T-VIS-002: Stability Icon Display

**Spec:** Section 2.2

**Test Steps:**
1. Load segments with delta_30d = [-0.8, -0.5, -0.2, 0.2, 0.5, 0.8]
2. Open hover card for each segment
3. Verify icon presence and color

**Expected:**
```
delta_30d = -0.8 → Green chevron-up ↗
delta_30d = -0.5 → Green chevron-up ↗
delta_30d = -0.2 → No icon (stable)
delta_30d = 0.2  → No icon (stable)
delta_30d = 0.5  → Red chevron-down ↘
delta_30d = 0.8  → Red chevron-down ↘
```

**Type:** E2E
**Pass Criteria:** Icons appear correctly for |delta| ≥ 0.5, hidden for |delta| < 0.5

---

### T-VIS-003: Stroke Width Scaling

**Spec:** Section 2.3

**Test Steps:**
1. Load segments with n_eff = [1, 5, 10, 20]
2. Measure rendered stroke width (px)

**Expected:**
```
n_eff=1  → width ≈ 3.5px
n_eff=5  → width ≈ 5.5px
n_eff=10 → width = 8.0px (capped)
n_eff=20 → width = 8.0px (capped)
```

**Type:** E2E
**Pass Criteria:** Width within ±0.5px of expected, respects 8px cap

---

### T-VIS-004: Color Mapping Accuracy

**Spec:** Section 2.4

**Test Steps:**
1. Load segments with decayed_mean = [1.0, 2.0, 3.0, 4.0, 5.0]
2. Extract rendered RGB color values

**Expected (hex):**
```
1.0 → #dc2626 (red)
2.0 → #f97316 (orange-red)
3.0 → #fbbf24 (yellow)
4.0 → #84cc16 (lime)
5.0 → #22c55e (green)
```

**Type:** E2E
**Pass Criteria:** RGB values match spec within ±5 per channel (interpolation tolerance)

---

### T-VIS-005: Color Contrast Compliance

**Spec:** Section 2.4 (Accessibility)

**Test Steps:**
1. Use WAVE or axe DevTools to scan map view
2. Measure contrast ratios for all segment colors against basemap

**Expected:** All colors meet WCAG AA (3:1 for graphics)

**Type:** MT (manual with tools)
**Pass Criteria:** No WCAG AA failures reported

---

### T-VIS-006: Hover State Interaction

**Spec:** Section 2.5

**Test Steps:**
1. Hover over segment with opacity 0.7
2. Measure opacity and stroke width during hover

**Expected:**
- Opacity increases by +0.2 (0.7 → 0.9)
- Stroke width increases by +2px (e.g., 5.5px → 7.5px)

**Type:** E2E
**Pass Criteria:** Hover effects apply within 150ms, values match spec

---

## 4. Hover Card UI Tests (DIARY_SPEC_M2.md)

### T-CARD-001: Header Content Format

**Spec:** Section 3.2 (Header)

**Test Steps:**
1. Hover segment with street="Market St", length_m=233
2. Inspect header text

**Expected:** "Market St · 233m"

**Type:** E2E
**Pass Criteria:** Text matches format exactly

---

### T-CARD-002: Rating Stars Display

**Spec:** Section 3.2 (Safety Rating Row)

**Test Steps:**
1. Hover segment with decayed_mean=3.2
2. Inspect stars and numeric value

**Expected:** "★★★☆☆ 3.2"

**Type:** E2E
**Pass Criteria:** 3 filled stars, 2 empty stars, numeric displays 1 decimal

---

### T-CARD-003: Conditional Stability Row

**Spec:** Section 3.2 (Stability Row)

**Test Steps:**
1. Load 3 segments:
   - seg_A: delta_30d = 0.6 (improving)
   - seg_B: delta_30d = -0.6 (worsening)
   - seg_C: delta_30d = 0.2 (stable)
2. Open hover card for each

**Expected:**
- seg_A: "↗ Getting safer (+0.6)" (green)
- seg_B: "↘ Getting riskier (-0.6)" (red)
- seg_C: Row hidden

**Type:** E2E
**Pass Criteria:** Stability row shows/hides correctly, text matches format

---

### T-CARD-004: Confidence Bar Visual

**Spec:** Section 3.2 (Confidence Row)

**Test Steps:**
1. Hover segment with n_eff=7
2. Inspect confidence bar width and color

**Expected:**
- Text: "Confidence: 7/10"
- Bar width: 70% of container
- Bar color: #3b82f6 (blue-500) since 7/10 = 0.7 ≥ 0.7

**Type:** E2E
**Pass Criteria:** Bar width matches confidence percentage, color correct

---

### T-CARD-005: Action Buttons Enabled State

**Spec:** Section 3.2 (Action Buttons)

**Test Steps:**
1. Hover segment (not yet voted)
2. Inspect buttons

**Expected:**
- Both buttons enabled
- Background: #f3f4f6 (gray-100)
- Cursor: pointer

**Type:** E2E
**Pass Criteria:** Buttons are clickable and styled correctly

---

### T-CARD-006: Action Buttons Disabled State

**Spec:** Section 3.2 (Action Buttons)

**Test Steps:**
1. Click "Agree 👍" button
2. Refresh page (session persists)
3. Hover same segment again

**Expected:**
- "Agree 👍" button disabled
- Background: #f9fafb (gray-50)
- Cursor: not-allowed
- aria-disabled="true"

**Type:** E2E
**Pass Criteria:** Button disabled, visual feedback correct

---

### T-CARD-007: Keyboard Navigation

**Spec:** Section 3.3 (Accessibility)

**Test Steps:**
1. Open hover card
2. Press Tab repeatedly
3. Verify focus moves through buttons
4. Press Escape

**Expected:**
- Tab moves focus to "Agree" → "Feels safer" → (next element)
- Enter/Space on button triggers action
- Escape closes hover card

**Type:** E2E
**Pass Criteria:** All keyboard interactions work as specified

---

### T-CARD-008: Screen Reader Announcement

**Spec:** Section 3.3 (Accessibility)

**Test Steps:**
1. Enable screen reader (NVDA/JAWS)
2. Hover segment
3. Listen to announcement

**Expected:** Reads header, rating, confidence, buttons with aria-labels

**Type:** MT (manual with screen reader)
**Pass Criteria:** All content announced correctly

---

## 5. Route Picker & Alt Route Tests (DIARY_SPEC_M2.md)

### T-ROUTE-001: Dropdown Options Format

**Spec:** Section 4.2

**Test Steps:**
1. Load route with:
   - route_name: "My commute"
   - length_m: 2300, duration_min: 18
   - alt_length_m: 2483, alt_duration_min: 19
2. Open dropdown

**Expected:**
```
My commute
  Primary: 2.3 km · 18 min
  Alt: 2.5 km · 19 min
```

**Type:** E2E
**Pass Criteria:** Text format matches spec (km conversion, rounding)

---

### T-ROUTE-002: Alt Route Toggle Functionality

**Spec:** Section 5.1, 5.3

**Test Steps:**
1. Select route with alternative
2. Click "Show alternative route" button
3. Verify map overlay
4. Click "Hide alternative route"

**Expected:**
- OFF→ON: Button text changes, alt route renders (green dashed), benefit summary appears
- ON→OFF: Alt route hidden, benefit summary removed

**Type:** E2E
**Pass Criteria:** Toggle works both directions, map updates correctly

---

### T-ROUTE-003: Benefit Summary Content

**Spec:** Section 5.3

**Test Steps:**
1. Primary: length_m=2100, avg_safety=3.4
2. Alt: length_m=2283, avg_safety=3.8
3. Show alt route

**Expected:**
```
Alternative route
Distance: +183m (+8%)
Safety gain: +0.4 points
```

**Type:** E2E
**Pass Criteria:** Calculations correct, formatting matches spec

---

### T-ROUTE-004: Alt Route Color Coding

**Spec:** Section 5.3 (Color Coding)

**Test Steps:**
1. Test 3 scenarios:
   - Alt delta: +5% (green)
   - Alt delta: +15% (yellow)
   - Alt delta: +25% (red)

**Expected:**
- Distance delta text color: green, yellow, red respectively

**Type:** E2E
**Pass Criteria:** Color logic matches thresholds (<10%, 10-20%, >20%)

---

## 6. Simulator Tests (DIARY_SPEC_M2.md)

### T-SIM-001: Play Button State Machine

**Spec:** Section 6.2

**Test Steps:**
1. Initial state: Verify Play enabled, Pause/Finish disabled
2. Click Play: Verify Play disabled, Pause enabled
3. Click Pause: Verify Play enabled, Pause disabled
4. Click Finish: Open modal

**Expected:** State transitions match spec

**Type:** E2E
**Pass Criteria:** Button states update correctly on each action

---

### T-SIM-002: Simulator Point Rendering

**Spec:** Section 6.3

**Test Steps:**
1. Start simulator
2. Inspect simulator point on map

**Expected:**
- Shape: Circle, radius 6px
- Color: #22d3ee (cyan-400)
- Stroke: 1px white
- Opacity: 0.9

**Type:** E2E
**Pass Criteria:** Visual matches spec

---

### T-SIM-003: Progress Bar Accuracy

**Spec:** Section 6.3

**Test Steps:**
1. Start simulator on 3-segment route
2. Wait until halfway through segment 2
3. Measure progress bar width

**Expected:** ~50% width (1.5/3 segments)

**Type:** E2E
**Pass Criteria:** Progress within ±5% of actual

---

### T-SIM-004: Finish Modal Opens

**Spec:** Section 6.4

**Test Steps:**
1. Click Finish button during simulation

**Expected:**
- Modal opens with title "Rate your route"
- 5-star rating input visible
- Submit button disabled (no rating yet)

**Type:** E2E
**Pass Criteria:** Modal structure matches spec

---

### T-SIM-005: Modal Validation

**Spec:** Section 6.4 (Validation)

**Test Steps:**
1. Open finish modal
2. Attempt submit without rating
3. Select 4 stars
4. Select 6 tags (exceeds max 5)

**Expected:**
- Submit disabled until rating selected
- Tag selection capped at 5
- Comment length capped at 500 chars

**Type:** E2E
**Pass Criteria:** All validations enforce correctly

---

### T-SIM-006: Modal Accessibility

**Spec:** Section 6.4 (Accessibility)

**Test Steps:**
1. Open modal
2. Verify focus trap (Tab cycles within modal)
3. Press Escape

**Expected:**
- Tab doesn't leave modal
- Escape closes modal (same as Cancel)
- role="dialog", aria-modal="true"

**Type:** E2E
**Pass Criteria:** Modal is accessible via keyboard, ARIA correct

---

## 7. Community Interaction Tests (DIARY_SPEC_M2.md)

### T-COMM-001: Agree Vote Logic

**Spec:** Section 7.1

**Test Steps:**
1. Segment has decayed_mean=3.2
2. Click "Agree 👍"
3. Verify implicit rating stored

**Expected:** Implicit rating = 3.2 (matches current mean)

**Type:** IT (API + DB)
**Pass Criteria:** Vote record has implicit_rating=3.2

---

### T-COMM-002: Safer Vote Logic

**Spec:** Section 7.1

**Test Steps:**
1. Segment has decayed_mean=4.5
2. Click "Feels safer ✨"

**Expected:** Implicit rating = 5.0 (min(4.5+1, 5) = 5)

**Type:** IT
**Pass Criteria:** Vote record has implicit_rating=5.0

---

### T-COMM-003: Session Throttling

**Spec:** Section 7.2

**Test Steps:**
1. Click "Agree 👍" on seg_001
2. Attempt to click "Agree 👍" again on seg_001 (same session)

**Expected:**
- Second click prevented
- Button shows disabled state
- Tooltip: "Already voted this session"

**Type:** E2E
**Pass Criteria:** Duplicate vote blocked, feedback shown

---

### T-COMM-004: Session Persistence

**Spec:** Section 7.2

**Test Steps:**
1. Vote on seg_001
2. Refresh page (F5)
3. Hover seg_001 again

**Expected:** Button still disabled (sessionStorage persists)

**Type:** E2E
**Pass Criteria:** Vote state survives page refresh

---

### T-COMM-005: Optimistic Update Performance

**Spec:** Section 7.3

**Test Steps:**
1. Click "Agree 👍"
2. Measure time until map layer updates

**Expected:** Map refresh <500ms

**Type:** PT
**Pass Criteria:** 95th percentile <500ms over 100 trials

---

### T-COMM-006: Screen Reader Disabled Button

**Spec:** Section 7.4

**Test Steps:**
1. Vote on segment
2. Hover again with screen reader enabled

**Expected:** Announces "Agree button, already voted this session, disabled"

**Type:** MT
**Pass Criteria:** Disabled state announced correctly

---

## 8. Chart Tests (CHARTS_SPEC_M2.md)

### T-CHART-001: Trend Chart Data Points

**Spec:** Section 2.3

**Test Steps:**
1. Fetch /api/diary/trend for route_001
2. Render chart
3. Verify data points plotted

**Expected:**
- X-axis shows dates formatted "MMM DD"
- Y-axis fixed scale [1, 5]
- Line color: #3b82f6 (blue-500)

**Type:** E2E
**Pass Criteria:** Chart renders all data points correctly

---

### T-CHART-002: Confidence Bands

**Spec:** Section 2.3

**Test Steps:**
1. Load data point with mean=3.5, std_error=0.3
2. Verify confidence band

**Expected:**
- Upper bound: 3.8
- Lower bound: 3.2
- Fill color: rgba(59, 130, 246, 0.1)

**Type:** E2E
**Pass Criteria:** Bands render correctly, clamped to [1, 5]

---

### T-CHART-003: Trend Chart Empty State

**Spec:** Section 2.4

**Test Steps:**
1. Request trend for route with no data
2. Verify empty state

**Expected:**
- Gray dashed line at y=3.0
- Text: "No data yet for this route"

**Type:** E2E
**Pass Criteria:** Empty state displays as specified

---

### T-CHART-004: Tag Chart Sorting

**Spec:** Section 3.3

**Test Steps:**
1. Fetch /api/diary/tags
2. Verify tag order

**Expected:** Tags sorted descending by count (top 10)

**Type:** IT
**Pass Criteria:** Order matches count desc, max 10 tags

---

### T-CHART-005: Tag Chart Bar Labels

**Spec:** Section 3.3

**Test Steps:**
1. Render tag chart
2. Inspect bar label for tag with count=45, percentage=32.1

**Expected:** Label text "45 (32.1%)"

**Type:** E2E
**Pass Criteria:** Label format matches spec

---

### T-CHART-006: Heatmap Color Scale

**Spec:** Section 4.3

**Test Steps:**
1. Load coverage data with confidence values [0, 0.3, 0.6, 0.9, 1.0]
2. Inspect cell colors

**Expected (hex):**
```
0.0 → #fee2e2 (red-50)
0.3 → #fde68a (yellow-200)
0.6 → #bfdbfe (blue-200)
0.9 → #86efac (green-300)
1.0 → #22c55e (green-500)
```

**Type:** E2E
**Pass Criteria:** Colors match 5-stop gradient

---

### T-CHART-007: Chart Loading State

**Spec:** Section 5.3

**Test Steps:**
1. Trigger chart data fetch
2. Observe loading state

**Expected:**
- Gray skeleton with shimmer animation
- Skeleton height matches final chart height

**Type:** E2E
**Pass Criteria:** Loading state displays before data arrives

---

### T-CHART-008: Chart Error State

**Spec:** Section 5.4

**Test Steps:**
1. Simulate API failure (network offline)
2. Observe error state

**Expected:**
- Yellow background (#fef3c7)
- Text: "⚠ Unable to load chart data"
- Retry button present

**Type:** E2E
**Pass Criteria:** Error state displays, retry works

---

### T-CHART-009: Responsive Breakpoints

**Spec:** Section 2.6, 3.6, 4.7

**Test Steps:**
1. Resize viewport to 375px (mobile)
2. Verify all 3 charts adapt

**Expected:**
- Charts resize to 100% width
- Height adjusts per spec (200-250px)
- X-axis labels rotate or thin out

**Type:** E2E
**Pass Criteria:** Charts remain readable at mobile size

---

### T-CHART-010: Chart Performance

**Spec:** Section 6.1

**Test Steps:**
1. Load trend chart with 1000 data points
2. Measure render time

**Expected:** Render completes <500ms

**Type:** PT
**Pass Criteria:** 95th percentile <500ms

---

## 9. API Tests (API_BACKEND_DIARY_M2.md)

### T-API-001: GET /segments with bbox

**Spec:** Section 3.1

**Test Steps:**
```bash
curl "http://localhost:3000/api/v1/diary/segments?bbox=-75.20,39.90,-75.10,40.00&limit=10"
```

**Expected:**
- HTTP 200
- Response JSON matches schema (segments array, total, limit, offset)
- Only segments within bbox returned

**Type:** IT
**Pass Criteria:** Schema valid, spatial filter works

---

### T-API-002: POST /ratings validation

**Spec:** Section 3.2

**Test Steps:**
1. POST rating with rating=7 (invalid)
2. POST rating without segment_id (missing required)

**Expected:**
- HTTP 400 for both
- Error JSON: `{"error": "validation_error", "message": "...", "field": "..."}`

**Type:** IT
**Pass Criteria:** Validation rejects invalid inputs with clear errors

---

### T-API-003: POST /ratings idempotence

**Spec:** Section 3.2 (Idempotent)

**Test Steps:**
1. POST rating with rating_id=uuid1
2. POST same request again (network retry simulation)

**Expected:**
- First request: HTTP 201, rating created
- Second request: HTTP 201 or 200, no duplicate created

**Type:** IT
**Pass Criteria:** Database contains only 1 rating with uuid1

---

### T-API-004: POST /votes throttling

**Spec:** Section 3.3

**Test Steps:**
1. POST vote: seg_001, action=agree
2. Immediately POST same vote again (within 24h)

**Expected:**
- First: HTTP 201
- Second: HTTP 409 (Conflict)

**Type:** IT
**Pass Criteria:** Duplicate vote rejected with 409

---

### T-API-005: POST /routing/calculate performance

**Spec:** Section 3.4

**Test Steps:**
1. POST routing request with origin/destination 5km apart
2. Measure response time

**Expected:** Response <2 seconds (95th percentile)

**Type:** PT
**Pass Criteria:** A* completes within 2s for 95% of requests

---

### T-API-006: A* Cost Function Correctness

**Spec:** Section 4.1

**Test Steps:**
1. Segment A: length=200, mean=5.0, mode=balanced
2. Segment B: length=200, mean=1.0, mode=balanced
3. Calculate costs

**Expected:**
- Segment A: cost = 200 * (1 + 0.5 * 0) = 200
- Segment B: cost = 200 * (1 + 0.5 * 0.8) = 280

**Type:** UT
**Pass Criteria:** Cost calculations match formula

---

### T-API-007: Alternative Route Validation

**Spec:** Section 4.4

**Test Steps:**
1. Calculate route with alt
2. Verify overlap and delta constraints

**Expected:**
- Overlap <70% with primary
- Distance delta <30%

**Type:** IT
**Pass Criteria:** Alt route meets validation criteria

---

### T-API-008: Rate Limiting

**Spec:** Section 2.5

**Test Steps:**
1. Send 101 requests to GET /segments (anonymous, limit=100/hour)
2. Observe 101st response

**Expected:**
- HTTP 429
- JSON: `{"error": "rate_limit_exceeded", "retry_after": ...}`
- Headers: X-RateLimit-* present

**Type:** IT
**Pass Criteria:** Rate limit enforced correctly

---

### T-API-009: Authentication Enforcement

**Spec:** Section 2.4

**Test Steps:**
1. POST /ratings without Authorization header
2. POST /ratings with invalid token

**Expected:**
- HTTP 401 for both
- JSON: `{"error": "unauthorized", "message": "..."}`

**Type:** IT
**Pass Criteria:** Auth required on protected endpoints

---

### T-API-010: Health Check Endpoint

**Spec:** Section 9.1

**Test Steps:**
```bash
curl http://localhost:3000/api/health
```

**Expected:**
- HTTP 200
- JSON: `{"status": "healthy", "database": "connected", "redis": "connected"}`

**Type:** IT
**Pass Criteria:** Health check returns correct status

---

## 10. Database Tests (SQL_SCHEMA_DIARY_M2.md)

### T-DB-001: Segment Table Constraints

**Spec:** Section 3.1

**Test Steps:**
1. INSERT segment with length_m=-100 (invalid)
2. INSERT segment with decayed_mean=6.0 (invalid)

**Expected:** Both violate CHECK constraints, INSERT fails

**Type:** IT
**Pass Criteria:** Constraints prevent invalid data

---

### T-DB-002: Generated Column `confidence`

**Spec:** Section 3.1

**Test Steps:**
1. INSERT segment with n_eff=5
2. SELECT confidence

**Expected:** confidence = 0.5 (LEAST(1.0, 5/10))

**Type:** IT
**Pass Criteria:** Generated column computes correctly

---

### T-DB-003: Spatial Index Usage

**Spec:** Section 7.1

**Test Steps:**
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM diary.segments
WHERE ST_Intersects(geometry, ST_MakeEnvelope(-75.20, 39.90, -75.10, 40.00, 4326));
```

**Expected:** Query plan uses `idx_segments_geometry` (GIST index)

**Type:** IT
**Pass Criteria:** EXPLAIN shows index scan, not seq scan

---

### T-DB-004: Materialized View Refresh

**Spec:** Section 4.1

**Test Steps:**
1. INSERT rating into diary.ratings
2. Trigger refresh: `REFRESH MATERIALIZED VIEW analytics.segment_aggregates`
3. Verify aggregated data updated

**Expected:** segment's decayed_mean reflects new rating

**Type:** IT
**Pass Criteria:** Materialized view updates correctly

---

### T-DB-005: Upsert Idempotence

**Spec:** Section 6.1

**Test Steps:**
1. INSERT segment seg_001
2. INSERT same segment (conflict)

**Expected:** Second insert updates row (ON CONFLICT DO UPDATE)

**Type:** IT
**Pass Criteria:** No duplicate, existing row updated

---

### T-DB-006: Foreign Key Cascade

**Spec:** Section 3.2, 3.3

**Test Steps:**
1. DELETE segment seg_001
2. Verify associated ratings and votes deleted

**Expected:** CASCADE deletes ratings and votes for seg_001

**Type:** IT
**Pass Criteria:** No orphaned records remain

---

### T-DB-007: Row-Level Security

**Spec:** Section 10.1

**Test Steps:**
1. Enable RLS on diary.routes
2. Set app.user_id = user_A
3. SELECT from diary.routes

**Expected:** Only returns routes where user_id = user_A

**Type:** IT
**Pass Criteria:** RLS policy enforces user isolation

---

### T-DB-008: Audit Log Trigger

**Spec:** Section 10.2

**Test Steps:**
1. INSERT rating
2. UPDATE rating
3. DELETE rating
4. SELECT from audit.log

**Expected:** 3 log entries with operation=INSERT/UPDATE/DELETE

**Type:** IT
**Pass Criteria:** All operations logged correctly

---

### T-DB-009: Backup & Restore

**Spec:** Section 9.1, 9.2

**Test Steps:**
1. Create pg_dump backup
2. DROP database
3. Restore from dump
4. Verify data integrity

**Expected:** All tables and data restored

**Type:** IT
**Pass Criteria:** No data loss after restore

---

### T-DB-010: Time-Decay Calculation

**Spec:** Section 4.1 (WITH time_weighted)

**Test Steps:**
1. Rating submitted 21 days ago (1 half-life)
2. Verify weight = 0.5 (2^(-21/21) = 0.5)

**Expected:** Weight calculation matches formula

**Type:** UT
**Pass Criteria:** Time-decay formula correct

---

## 11. Acceptance Checklist Summary

**M2 Ready-to-Merge Criteria:**

### 11.1 Visual Encoding (10 tests)
- [ ] T-VIS-001: Confidence opacity mapping
- [ ] T-VIS-002: Stability icon display
- [ ] T-VIS-003: Stroke width scaling
- [ ] T-VIS-004: Color mapping accuracy
- [ ] T-VIS-005: Color contrast compliance
- [ ] T-VIS-006: Hover state interaction

### 11.2 UI Components (14 tests)
- [ ] T-CARD-001 to T-CARD-008: Hover card
- [ ] T-ROUTE-001 to T-ROUTE-004: Route picker & alt routes
- [ ] T-SIM-001 to T-SIM-006: Simulator

### 11.3 Community Interactions (6 tests)
- [ ] T-COMM-001 to T-COMM-006: Agree/Safer votes

### 11.4 Charts (10 tests)
- [ ] T-CHART-001 to T-CHART-010: Trend, tags, heatmap

### 11.5 API (10 tests)
- [ ] T-API-001 to T-API-010: REST endpoints

### 11.6 Database (10 tests)
- [ ] T-DB-001 to T-DB-010: Schema, views, triggers

**Total Tests:** 60
**Pass Threshold:** 100% (all tests must pass for M2 merge)

---

## 12. Test Automation Strategy

### 12.1 Unit Tests (UT)

**Framework:** Jest
**Location:** `src/**/*.test.js`
**Coverage Target:** 80% line coverage

**Example:**
```javascript
// src/utils/decay.test.js
import { weightFor } from './decay.js'

test('weightFor calculates exponential decay correctly', () => {
  const now = Date.now()
  const sample21DaysAgo = now - (21 * 86400000)
  const weight = weightFor(sample21DaysAgo, now, 21)
  expect(weight).toBeCloseTo(0.5, 2)  // 2 decimal precision
})
```

### 12.2 Integration Tests (IT)

**Framework:** Mocha + Supertest + pg-mem (in-memory Postgres)
**Location:** `test/integration/**/*.test.js`

**Example:**
```javascript
// test/integration/api.test.js
import request from 'supertest'
import app from '../../src/app.js'

describe('POST /api/v1/diary/ratings', () => {
  it('should reject rating > 5', async () => {
    const res = await request(app)
      .post('/api/v1/diary/ratings')
      .send({ segment_id: 'seg_001', rating: 7 })
      .expect(400)

    expect(res.body.error).toBe('validation_error')
  })
})
```

### 12.3 End-to-End Tests (E2E)

**Framework:** Playwright
**Location:** `test/e2e/**/*.spec.js`

**Example:**
```javascript
// test/e2e/hover-card.spec.js
import { test, expect } from '@playwright/test'

test('hover card shows stability icon for delta >= 0.5', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.hover('[data-segment-id="seg_001"]')
  const icon = await page.locator('.stability-icon')
  await expect(icon).toBeVisible()
  await expect(icon).toHaveCSS('color', 'rgb(34, 197, 94)')  // green
})
```

### 12.4 Performance Tests (PT)

**Framework:** Artillery
**Location:** `test/perf/load-test.yml`

**Example:**
```yaml
config:
  target: "http://localhost:3000"
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "Routing requests"
    flow:
      - post:
          url: "/api/v1/routing/calculate"
          json:
            origin: [-75.1652, 39.9526]
            destination: [-75.1580, 39.9500]
          expect:
            - statusCode: 200
            - contentType: json
            - hasProperty: "primary"
```

### 12.5 Continuous Integration

**Pipeline (GitHub Actions):**
```yaml
name: M2 Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:e2e
      - run: npm run test:perf
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## 13. Test Reporting

### 13.1 Report Format

**Deliverable:** `logs/TEST_REPORT_M2_<timestamp>.md`

**Structure:**
```markdown
# M2 Test Report

**Date:** 2025-11-11
**Branch:** feat/diary-m2
**Commit:** abc1234

## Summary
- Total Tests: 60
- Passed: 58
- Failed: 2
- Skipped: 0
- Pass Rate: 96.7%

## Failed Tests

### T-API-005: POST /routing/calculate performance
**Expected:** <2 seconds
**Actual:** 2.3 seconds (98th percentile)
**Severity:** Medium
**Action:** Optimize A* heuristic function

### T-CHART-010: Chart performance
**Expected:** <500ms render
**Actual:** 620ms for 1000 points
**Severity:** Low
**Action:** Enable dataset decimation in Chart.js

## Coverage
- Unit: 82% (target: 80%) ✅
- Integration: 75% (target: 70%) ✅
- E2E: 90% of user flows ✅
```

### 13.2 Evidence Artifacts

Store in `logs/` directory:
- Screenshots: `logs/screenshots/T-VIS-004-color-mapping.png`
- Performance traces: `logs/traces/T-API-005-routing-perf.json`
- Network logs: `logs/network/T-API-001-segments-request.har`

---

## 14. Blockers & Risks

### 14.1 Known Risks

**RISK-001: A* Performance on Large Networks**
- **Impact:** Routing may exceed 2s SLA for distant origin/destination
- **Mitigation:** Implement bidirectional A*, spatial indexing for neighbors
- **Fallback:** Return 503 if computation exceeds 5s hard timeout

**RISK-002: Materialized View Refresh Latency**
- **Impact:** Segment aggregates may be stale during high traffic
- **Mitigation:** Use Redis cache for reads, async queue for refresh
- **Fallback:** Display "Data as of {timestamp}" in UI

**RISK-003: Mobile Performance for Charts**
- **Impact:** Chart.js may struggle on older mobile devices
- **Mitigation:** Lazy-load charts, reduce data points on mobile
- **Fallback:** Show static images or summary stats instead

### 14.2 Blocking Issues

**Issue resolved in M1:**
- None currently (M1 audit passed all checks)

**New M2 issues:**
- To be identified during implementation

---

## 15. Post-M2 Verification

**After M2 merge, verify:**
1. All 60 tests pass on `main` branch
2. Production deployment succeeds
3. Monitoring dashboards show no regressions
4. User acceptance testing (UAT) completes successfully
5. Documentation updated (README, API docs)

**Sign-off required from:**
- [ ] Agent-I (implementation complete)
- [ ] Agent-M (acceptance criteria verified)
- [ ] QA Lead (test report approved)
- [ ] Product Owner (UAT passed)

---

**Document Status:** ✅ Complete, ready for Agent-I implementation verification
**Last Updated:** 2025-11-11
**Related:** [DIARY_SPEC_M2.md](./DIARY_SPEC_M2.md), [CHARTS_SPEC_M2.md](./CHARTS_SPEC_M2.md), [API_BACKEND_DIARY_M2.md](./API_BACKEND_DIARY_M2.md), [SQL_SCHEMA_DIARY_M2.md](./SQL_SCHEMA_DIARY_M2.md)
