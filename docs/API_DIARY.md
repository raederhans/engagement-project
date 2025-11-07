# Route Safety Diary - API Contract Specification

**Date:** 2025-11-07
**Status:** M1 - Mock Implementation (501 stubs)
**Backend:** M2 (PostgreSQL + PostGIS + serverless functions)

---

## Overview

This document defines the API contracts for the Route Safety Diary feature. For M1, all endpoints return mock data with 500ms simulated latency. For M2, these will be implemented as serverless functions (Vercel/Netlify) with PostgreSQL + PostGIS backend.

---

## Base URL

```
Development:  http://localhost:5173/api/diary
Production:   https://yourdomain.com/api/diary
```

---

## Authentication

**M1:** No authentication (anonymous submissions)
**M2:** Optional JWT-based authentication for saved routes and personalization

Headers (M2):
```
Authorization: Bearer <jwt_token>  (optional)
X-User-Hash: <anonymous_hash>      (for tracking without accounts)
```

---

## Endpoints

### 1. POST /api/diary/submit

Submit a new trip rating with segment-level data.

#### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "overall_rating": 4,
  "tags": ["poor lighting", "low foot traffic"],
  "travel_mode": "walk",
  "segment_overrides": [
    {
      "segment_id": "seg_002",
      "rating": 2
    }
  ],
  "save_as_route": true,
  "route_name": "Morning commute",
  "matched_segments": ["seg_001", "seg_002", "seg_003"],
  "timestamp": 1699305600000
}
```

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "overall_rating": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5,
      "description": "Overall trip rating (1=unsafe, 5=very safe)"
    },
    "tags": {
      "type": "array",
      "maxItems": 3,
      "items": {
        "type": "string",
        "maxLength": 30
      },
      "description": "User-selected concern tags"
    },
    "travel_mode": {
      "type": "string",
      "enum": ["walk", "bike"],
      "description": "Mode of travel"
    },
    "segment_overrides": {
      "type": "array",
      "maxItems": 2,
      "items": {
        "type": "object",
        "properties": {
          "segment_id": { "type": "string" },
          "rating": { "type": "integer", "minimum": 1, "maximum": 5 }
        },
        "required": ["segment_id", "rating"]
      },
      "description": "Per-segment rating overrides (for segments that differ from overall)"
    },
    "save_as_route": {
      "type": "boolean",
      "description": "Whether to save this route for future reference"
    },
    "route_name": {
      "type": "string",
      "maxLength": 100,
      "description": "Name for saved route (if save_as_route=true)"
    },
    "matched_segments": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1,
      "description": "List of segment IDs traversed (from GPS matching)"
    },
    "timestamp": {
      "type": "integer",
      "description": "Unix timestamp (ms) of rating submission"
    }
  },
  "required": ["overall_rating", "travel_mode", "matched_segments", "timestamp"]
}
```

#### Response (Success)

**Status:** 200 OK
```json
{
  "ok": true,
  "submission_id": "sub_abc123",
  "updated_segments": [
    {
      "segment_id": "seg_001",
      "rating": 4.1,
      "n_eff": 23.4,
      "trend_30d": 0.2
    },
    {
      "segment_id": "seg_002",
      "rating": 2.8,
      "n_eff": 18.7,
      "trend_30d": -0.3
    }
  ],
  "saved_route_id": "route_xyz789"
}
```

#### Response (Validation Error)

**Status:** 400 Bad Request
```json
{
  "ok": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "overall_rating",
      "message": "must be integer between 1 and 5"
    }
  ]
}
```

#### M1 Mock Implementation

```javascript
// server/api/diary/submit.js
export default async function handler(req, ctx) {
  // TODO: Real implementation in M2
  return new Response(
    JSON.stringify({
      ok: true,
      submission_id: 'mock_' + Date.now(),
      updated_segments: req.body.matched_segments.map(id => ({
        segment_id: id,
        rating: req.body.overall_rating + Math.random() * 0.5 - 0.25,
        n_eff: Math.random() * 50 + 10,
        trend_30d: Math.random() * 0.8 - 0.4
      })),
      saved_route_id: req.body.save_as_route ? 'route_' + Date.now() : null
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}
```

---

### 2. GET /api/diary/segments

Retrieve segment data with aggregated ratings.

#### Request

**Query Parameters:**
```
bbox:  -75.20,39.94,-75.15,39.96  (optional, bounding box: west,south,east,north)
start: 1699305600000                (optional, timestamp start filter)
end:   1699392000000                (optional, timestamp end filter)
ids:   seg_001,seg_002,seg_003      (optional, specific segment IDs)
```

**Example:**
```
GET /api/diary/segments?bbox=-75.20,39.94,-75.15,39.96&start=1699305600000
```

#### Response (Success)

**Status:** 200 OK
```json
{
  "ok": true,
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "seg_001",
      "geometry": {
        "type": "LineString",
        "coordinates": [[-75.1900, 39.9520], [-75.1890, 39.9525]]
      },
      "properties": {
        "segment_id": "seg_001",
        "name": "Main St",
        "length_m": 120,
        "rating": 3.8,
        "n_eff": 45.2,
        "trend_30d": 0.4,
        "top_tags": [
          { "tag": "poor lighting", "count": 12 },
          { "tag": "low foot traffic", "count": 8 }
        ],
        "total_reports": 44,
        "last_updated": 1699305600000
      }
    }
  ]
}
```

#### Response (No Data)

**Status:** 200 OK
```json
{
  "ok": true,
  "type": "FeatureCollection",
  "features": []
}
```

#### M1 Mock Implementation

```javascript
// server/api/diary/segments.js
export default async function handler(req, ctx) {
  // TODO: Real implementation in M2
  // Return seed data from data/segments_phl.dev.geojson with mock ratings
  return new Response(
    JSON.stringify({ ok: false, status: 501, message: "Diary endpoint stub — to be implemented in M1." }),
    { status: 501, headers: { 'content-type': 'application/json' } }
  );
}
```

---

### 3. GET /api/diary/segments/:id

Get detailed summary for a single segment (for SegmentCard).

#### Request

**Path Parameter:**
```
:id  - Segment ID (e.g., seg_001)
```

**Example:**
```
GET /api/diary/segments/seg_001
```

#### Response (Success)

**Status:** 200 OK
```json
{
  "ok": true,
  "segment_id": "seg_001",
  "name": "Main St",
  "rating": 3.8,
  "n_eff": 45.2,
  "confidence": 87,
  "trend_30d": 0.4,
  "top_tags": ["poor lighting", "low foot traffic"],
  "total_reports": 44,
  "last_updated": 1699305600000
}
```

#### Response (Not Found)

**Status:** 404 Not Found
```json
{
  "ok": false,
  "error": "Segment not found",
  "segment_id": "seg_999"
}
```

#### M1 Mock Implementation

```javascript
// src/api/diary.js (client-side)
export async function getSegmentDetails(segmentId) {
  // Mock data for M1
  return {
    ok: true,
    segment_id: segmentId,
    name: 'Main St',
    rating: 3.8,
    n_eff: 45.2,
    confidence: 87,
    trend_30d: 0.4,
    top_tags: ['poor lighting', 'low foot traffic'],
    total_reports: 44,
    last_updated: Date.now() - 7200000 // 2 hours ago
  };
}
```

---

### 4. GET /api/diary/segments/:id/analytics

Get full analytics for a segment (for CommunityDetailsModal).

#### Request

**Path Parameter:**
```
:id  - Segment ID
```

**Example:**
```
GET /api/diary/segments/seg_001/analytics
```

#### Response (Success)

**Status:** 200 OK
```json
{
  "ok": true,
  "segment_id": "seg_001",
  "name": "Main St",
  "total_reports": 44,
  "avg_rating": 3.8,
  "confidence": 87,
  "trend_30d": 0.4,
  "weekly_trend": [
    { "week": "W1", "rating": 3.2, "count": 8, "start_date": "2025-10-01" },
    { "week": "W2", "rating": 3.4, "count": 11, "start_date": "2025-10-08" },
    { "week": "W3", "rating": 3.6, "count": 12, "start_date": "2025-10-15" },
    { "week": "W4", "rating": 3.8, "count": 14, "start_date": "2025-10-22" }
  ],
  "rating_distribution": [
    { "stars": 1, "count": 8, "percentage": 18 },
    { "stars": 2, "count": 15, "percentage": 34 },
    { "stars": 3, "count": 12, "percentage": 27 },
    { "stars": 4, "count": 6, "percentage": 14 },
    { "stars": 5, "count": 3, "percentage": 7 }
  ],
  "tag_frequency": [
    { "tag": "poor lighting", "count": 18, "trend": 2 },
    { "tag": "low foot traffic", "count": 12, "trend": -1 },
    { "tag": "cars too close", "count": 8, "trend": 0 },
    { "tag": "construction blockage", "count": 4, "trend": 4 }
  ],
  "recent_activity": [
    {
      "type": "improve",
      "timestamp": 1699305600000,
      "display": "Anonymous noted improvement",
      "relative_time": "2 hours ago"
    },
    {
      "type": "agree",
      "timestamp": 1699291200000,
      "display": "Anonymous agreed with rating",
      "relative_time": "5 hours ago"
    }
  ]
}
```

#### M1 Mock Implementation

```javascript
// src/api/diary.js (client-side)
export async function getSegmentAnalytics(segmentId) {
  // Mock data for M1
  return {
    ok: true,
    segment_id: segmentId,
    name: 'Main St',
    total_reports: 44,
    avg_rating: 3.8,
    confidence: 87,
    trend_30d: 0.4,
    weekly_trend: [
      { week: 'W1', rating: 3.2, count: 8, start_date: '2025-10-01' },
      { week: 'W2', rating: 3.4, count: 11, start_date: '2025-10-08' },
      { week: 'W3', rating: 3.6, count: 12, start_date: '2025-10-15' },
      { week: 'W4', rating: 3.8, count: 14, start_date: '2025-10-22' }
    ],
    rating_distribution: [
      { stars: 1, count: 8, percentage: 18 },
      { stars: 2, count: 15, percentage: 34 },
      { stars: 3, count: 12, percentage: 27 },
      { stars: 4, count: 6, percentage: 14 },
      { stars: 5, count: 3, percentage: 7 }
    ],
    tag_frequency: [
      { tag: 'poor lighting', count: 18, trend: 2 },
      { tag: 'low foot traffic', count: 12, trend: -1 },
      { tag: 'cars too close', count: 8, trend: 0 }
    ],
    recent_activity: [
      { type: 'improve', timestamp: Date.now() - 7200000, display: 'Anonymous noted improvement', relative_time: '2 hours ago' },
      { type: 'agree', timestamp: Date.now() - 18000000, display: 'Anonymous agreed with rating', relative_time: '5 hours ago' }
    ]
  };
}
```

---

### 5. POST /api/diary/agree

Increment "agree" counter for a segment (community action).

#### Request

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "segment_id": "seg_001"
}
```

#### Response (Success)

**Status:** 200 OK
```json
{
  "ok": true,
  "segment_id": "seg_001",
  "new_n_eff": 46.2,
  "message": "Thanks — confidence updated"
}
```

#### Rate Limiting

**M2:** Max 10 agrees per segment per user per day (tracked by IP or user hash)

**Response (Rate Limited):**
**Status:** 429 Too Many Requests
```json
{
  "ok": false,
  "error": "Rate limit exceeded",
  "retry_after": 3600
}
```

#### M1 Mock Implementation

```javascript
// src/api/diary.js (client-side)
export async function submitAgree(segmentId) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        segment_id: segmentId,
        new_n_eff: Math.random() * 10 + 40,
        message: 'Thanks — confidence updated'
      });
    }, 500);
  });
}
```

---

### 6. POST /api/diary/improve

Record "feels safer" improvement note for a segment.

#### Request

**Body:**
```json
{
  "segment_id": "seg_001"
}
```

#### Response (Success)

**Status:** 200 OK
```json
{
  "ok": true,
  "segment_id": "seg_001",
  "improvement_count": 13,
  "message": "Thanks — improvement noted"
}
```

#### M1 Mock Implementation

```javascript
// src/api/diary.js (client-side)
export async function submitImprove(segmentId) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ok: true,
        segment_id: segmentId,
        improvement_count: Math.floor(Math.random() * 20) + 5,
        message: 'Thanks — improvement noted'
      });
    }, 500);
  });
}
```

---

### 7. POST /api/diary/route

Compute safer alternative route using A* with safety penalties.

#### Request

**Body:**
```json
{
  "from": [-75.1900, 39.9520],
  "to": [-75.1850, 39.9550],
  "time": "2025-11-07T14:00:00Z"
}
```

#### Response (Success - Alternative Found)

**Status:** 200 OK
```json
{
  "ok": true,
  "route": {
    "type": "Feature",
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [-75.1900, 39.9520],
        [-75.1895, 39.9525],
        [-75.1890, 39.9530],
        [-75.1850, 39.9550]
      ]
    },
    "properties": {
      "segments": ["seg_001", "seg_003", "seg_005"],
      "total_length_m": 450,
      "avg_rating": 4.2,
      "total_time_s": 360
    }
  },
  "direct_route": {
    "segments": ["seg_001", "seg_002", "seg_004"],
    "total_length_m": 380,
    "avg_rating": 2.8,
    "total_time_s": 240
  },
  "comparison": {
    "time_diff_s": 120,
    "time_diff_display": "+2 min",
    "safety_gain": 1.4,
    "avoided_segments": 2
  }
}
```

#### Response (No Alternative)

**Status:** 200 OK
```json
{
  "ok": true,
  "route": null,
  "message": "No safer alternative found within acceptable time limit"
}
```

#### M1 Mock Implementation

```javascript
// src/api/diary.js (client-side)
export async function getSaferRoute(params) {
  // Always return null for M1 (A* not implemented)
  console.warn('[Diary] A* routing not implemented yet (M1 stub)');
  return {
    ok: true,
    route: null,
    message: 'No safer alternative found within acceptable time limit'
  };
}
```

---

## Error Handling

### Standard Error Response

All errors follow this format:
```json
{
  "ok": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {} // Optional
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `RATE_LIMIT` | 429 | Too many requests from this IP/user |
| `NOT_FOUND` | 404 | Segment ID not found |
| `SERVER_ERROR` | 500 | Internal server error |
| `NOT_IMPLEMENTED` | 501 | Endpoint stub (M1 only) |

---

## Rate Limiting

**M1:** No rate limiting (local dev only)

**M2 Limits:**

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /submit` | 20 requests | 1 hour |
| `POST /agree` | 10 requests per segment | 24 hours |
| `POST /improve` | 10 requests per segment | 24 hours |
| `GET /segments` | 100 requests | 1 minute |
| `POST /route` | 20 requests | 1 minute |

**Rate Limit Headers (M2):**
```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 15
X-RateLimit-Reset: 1699392000
```

---

## Caching Strategy

### Client-Side (M1)

```javascript
// src/utils/http.js (extend existing cache)
const CACHE_TTL = {
  segments: 300000,      // 5 minutes
  segmentDetails: 60000, // 1 minute
  analytics: 120000      // 2 minutes
};
```

### Server-Side (M2)

- **Segments GeoJSON:** Cache for 5 minutes (updated on new submissions)
- **Analytics:** Cache for 2 minutes per segment
- **Route computation:** No cache (depends on real-time ratings)

**Cache Headers:**
```
Cache-Control: public, max-age=300
ETag: "abc123"
Last-Modified: Wed, 07 Nov 2025 14:00:00 GMT
```

---

## Throttling & Deduplication

### Client-Side Debouncing

```javascript
// src/routes_diary/index.js
let submitTimeout = null;

function handleSubmit(data) {
  // Prevent double-submit
  if (submitTimeout) {
    console.warn('[Diary] Submission already in progress');
    return;
  }

  submitTimeout = setTimeout(() => {
    submitTimeout = null;
  }, 2000); // 2-second cooldown

  submitDiary(data);
}
```

### Server-Side Deduplication (M2)

```sql
-- Check for duplicate submission within 5 minutes
SELECT id FROM ratings
WHERE user_hash = $1
  AND timestamp > NOW() - INTERVAL '5 minutes'
  AND matched_segments = $2
LIMIT 1;
```

If duplicate found, return existing `submission_id` with `201 Created` (idempotent).

---

## Data Retention & Privacy

### M1
- No server storage (all mock data client-side)
- GPS traces never leave browser (deleted after submission)

### M2
- **Ratings:** Retained indefinitely (anonymized, no GPS coords)
- **GPS Traces:** NEVER stored (only matched segment IDs)
- **User Hashes:** Anonymized (SHA256 of IP + user agent)
- **Saved Routes:** Segment ID lists only (no GPS paths)

### GDPR Compliance (M2)

Users can request data deletion:
```
DELETE /api/diary/user/:user_hash
```

This removes:
- All ratings submitted by this user hash
- Saved routes
- Community actions (agree/improve)

Aggregated segment statistics are NOT deleted (anonymized contribution).

---

## Testing Endpoints (M1)

### Mock Data Generation

```javascript
// scripts/generate_mock_diary_data.js
function generateMockSegmentData(segmentId) {
  return {
    segment_id: segmentId,
    rating: Math.random() * 4 + 1, // 1-5
    n_eff: Math.random() * 80 + 10, // 10-90
    trend_30d: Math.random() * 1.6 - 0.8, // -0.8 to +0.8
    top_tags: sampleTags(3),
    total_reports: Math.floor(Math.random() * 100) + 5
  };
}
```

### Test Scenarios

1. **Submit rating with all fields:** Should return 200 with updated segments
2. **Submit with invalid rating (0):** Should return 400 with validation error
3. **Get segments with bbox filter:** Should return FeatureCollection
4. **Get segment details for non-existent ID:** Should return 404
5. **Submit 3 "agree" actions rapidly:** Should succeed (no rate limit in M1)

---

## Migration Path (M1 → M2)

### Phase 1: Mock Endpoints (Current)
- All endpoints return static/generated mock data
- 500ms simulated latency
- No server required

### Phase 2: Real Backend
1. **Database Schema:** Create PostgreSQL tables (segments, ratings, actions, routes)
2. **Import Segments:** Load full `data/segments_phl.geojson` into PostGIS
3. **API Implementation:** Replace mock functions with real database queries
4. **Aggregation:** Implement time-decay + Bayesian shrinkage in SQL
5. **Caching:** Add Redis for segment aggregate caching
6. **Rate Limiting:** Add rate limiter middleware

### Breaking Changes (None Expected)
- JSON schemas remain identical
- Endpoint URLs unchanged
- Client code works without modification

---

**Status:** API contract finalized for M1 mock implementation
**Next Step:** Implement client-side mock functions in `src/api/diary.js`
