# Route Safety Diary — M2 Backend API Specification

**Version:** M2
**Status:** Agent-I implementation spec
**Audience:** Backend developers (Agent-I), DevOps, QA

---

## 1. Purpose

This document specifies the **REST API contracts** for the Route Safety Diary M2 backend, including:
- Rating submission and retrieval
- Route discovery and pathfinding with A* cost function
- Aggregation endpoints
- Authentication and rate limiting

All endpoints include **JSON schemas, example requests/responses, error codes, and validation rules**.

---

## 2. API Base Configuration

### 2.1 Base URL

**Development:** `http://localhost:3000/api`
**Production:** `https://api.example.com/api` (to be configured)

### 2.2 Versioning

API version is included in the base path:
```
/api/v1/diary/*
```

### 2.3 Content Type

All requests and responses use:
```
Content-Type: application/json
```

### 2.4 Authentication

**Method:** Bearer token (JWT)

**Header:**
```
Authorization: Bearer {token}
```

**Token Structure:**
```json
{
  "sub": "user_12345",
  "email": "user@example.com",
  "iat": 1699900000,
  "exp": 1699986400
}
```

**Unauthenticated Endpoints:**
- GET /segments (read-only)
- GET /routes (read-only)
- GET /diary/trend (read-only)
- GET /diary/tags (read-only)
- GET /diary/coverage (read-only)

**Authenticated Endpoints:**
- POST /diary/ratings (requires valid user token)
- POST /diary/votes (requires valid user token)
- POST /routing/calculate (requires valid user token)

### 2.5 Rate Limiting

**Limits:**
- Anonymous: 100 requests/hour per IP
- Authenticated: 1000 requests/hour per user

**Headers (on all responses):**
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1699900800
```

**429 Response:**
```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Try again in 30 minutes.",
  "retry_after": 1800
}
```

---

## 3. Endpoints

### 3.1 GET /api/v1/diary/segments

**Description:** Retrieve all street segments with aggregated safety ratings.

**Method:** GET

**Query Parameters:**
```typescript
interface GetSegmentsQuery {
  bbox?: string;           // "west,south,east,north" (lng,lat)
  min_confidence?: number; // [0, 1], filter segments
  updated_after?: string;  // ISO 8601 datetime, incremental sync
  limit?: number;          // max 1000, default 100
  offset?: number;         // pagination offset
}
```

**Example Request:**
```
GET /api/v1/diary/segments?bbox=-75.20,39.90,-75.10,40.00&min_confidence=0.5&limit=50
Authorization: Bearer {token}
```

**Response Schema:**
```typescript
interface Segment {
  segment_id: string;              // max 50 chars
  street: string;                  // max 200 chars
  neighborhood?: string;           // max 100 chars
  length_m: number;                // > 0
  geometry: GeoJSON.LineString;   // WGS84 coordinates
  decayed_mean: number;            // [1.0, 5.0]
  n_eff: number;                   // ≥ 0, effective sample size
  top_tags: string[];              // max 5 tags
  delta_30d: number;               // [-4, +4] trend
  last_updated: string;            // ISO 8601 datetime
}

interface GetSegmentsResponse {
  segments: Segment[];
  total: number;                   // total matching segments
  limit: number;
  offset: number;
}
```

**Example Response:**
```json
{
  "segments": [
    {
      "segment_id": "seg_001",
      "street": "Market St",
      "neighborhood": "Center City",
      "length_m": 233,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-75.16907492849998, 39.94517957194987],
          [-75.17175039549124, 39.945610552475316]
        ]
      },
      "decayed_mean": 3.2,
      "n_eff": 8.4,
      "top_tags": ["well-lit", "busy"],
      "delta_30d": 0.3,
      "last_updated": "2025-11-11T14:30:00Z"
    }
  ],
  "total": 64,
  "limit": 50,
  "offset": 0
}
```

**Error Codes:**
- `400`: Invalid bbox format or parameters
- `401`: Missing or invalid authentication token
- `429`: Rate limit exceeded

---

### 3.2 POST /api/v1/diary/ratings

**Description:** Submit a new safety rating for a segment or route.

**Method:** POST

**Authentication:** Required

**Request Schema:**
```typescript
interface RatingSubmission {
  segment_id?: string;           // Either segment_id or route_id required
  route_id?: string;
  rating: number;                // [1, 5], integer
  tags?: string[];               // max 5 tags, each max 50 chars
  comment?: string;              // max 500 chars
  timestamp?: string;            // ISO 8601, defaults to server time
  metadata?: {
    device?: string;             // "mobile" | "desktop" | "tablet"
    source?: string;             // "recording" | "manual" | "community"
  };
}
```

**Validation Rules:**
1. **rating:** Required, integer [1, 5]
2. **segment_id OR route_id:** Exactly one required
3. **tags:** Optional, max 5 tags, each ≤ 50 chars
4. **comment:** Optional, ≤ 500 chars, no profanity (basic filter)
5. **timestamp:** Optional, if provided must be ≤ 24 hours in past (anti-fraud)

**Example Request:**
```json
POST /api/v1/diary/ratings
Authorization: Bearer {token}
Content-Type: application/json

{
  "segment_id": "seg_001",
  "rating": 4,
  "tags": ["well-lit", "bike lane"],
  "comment": "Felt safe riding at night, good visibility",
  "metadata": {
    "device": "mobile",
    "source": "recording"
  }
}
```

**Response Schema:**
```typescript
interface RatingResponse {
  rating_id: string;             // UUID v4
  segment_id?: string;
  route_id?: string;
  rating: number;
  tags: string[];
  timestamp: string;             // ISO 8601
  user_id: string;               // From JWT token
  status: "accepted" | "pending_review";
}
```

**Example Response:**
```json
{
  "rating_id": "550e8400-e29b-41d4-a716-446655440000",
  "segment_id": "seg_001",
  "rating": 4,
  "tags": ["well-lit", "bike lane"],
  "timestamp": "2025-11-11T14:35:22Z",
  "user_id": "user_12345",
  "status": "accepted"
}
```

**Error Codes:**
- `400`: Invalid rating value, missing required fields, or validation failure
- `401`: Missing or invalid authentication token
- `404`: Segment or route not found
- `409`: Duplicate rating (same user, same segment, within 1 hour)
- `429`: Rate limit exceeded (max 20 ratings/hour per user)

**Error Response Example:**
```json
{
  "error": "validation_error",
  "message": "Rating must be between 1 and 5",
  "field": "rating",
  "value": 7
}
```

---

### 3.3 POST /api/v1/diary/votes

**Description:** Submit a community vote (Agree 👍 or Feels safer ✨).

**Method:** POST

**Authentication:** Required

**Request Schema:**
```typescript
interface VoteSubmission {
  segment_id: string;            // Required
  action: "agree" | "safer";     // Required
  timestamp?: string;            // ISO 8601, defaults to server time
}
```

**Vote Logic:**
- **"agree":** Implicit rating at current segment `decayed_mean`
- **"safer":** Implicit rating at `min(decayed_mean + 1, 5)`

**Example Request:**
```json
POST /api/v1/diary/votes
Authorization: Bearer {token}
Content-Type: application/json

{
  "segment_id": "seg_001",
  "action": "agree"
}
```

**Response Schema:**
```typescript
interface VoteResponse {
  vote_id: string;               // UUID v4
  segment_id: string;
  action: "agree" | "safer";
  implicit_rating: number;       // [1, 5]
  timestamp: string;             // ISO 8601
  user_id: string;
  status: "accepted";
}
```

**Example Response:**
```json
{
  "vote_id": "660e8400-e29b-41d4-a716-446655440111",
  "segment_id": "seg_001",
  "action": "agree",
  "implicit_rating": 3,
  "timestamp": "2025-11-11T14:40:10Z",
  "user_id": "user_12345",
  "status": "accepted"
}
```

**Throttling:**
- One vote per action per segment per user per session (backend enforces via user_id)
- Duplicate votes within 24 hours return `409 Conflict`

**Error Codes:**
- `400`: Invalid action or missing segment_id
- `401`: Missing or invalid authentication token
- `404`: Segment not found
- `409`: Duplicate vote within 24 hours
- `429`: Rate limit exceeded (max 50 votes/hour per user)

---

### 3.4 POST /api/v1/routing/calculate

**Description:** Calculate optimal and alternative routes using A* pathfinding with safety cost function.

**Method:** POST

**Authentication:** Required

**Request Schema:**
```typescript
interface RoutingRequest {
  origin: [number, number];      // [lng, lat]
  destination: [number, number]; // [lng, lat]
  mode?: "optimal" | "safest" | "balanced"; // default "balanced"
  include_alternative?: boolean; // default true
  safety_weight?: number;        // [0, 1], default 0.5
}
```

**Cost Function Parameters:**
- **mode:**
  - `"optimal"`: Minimize distance (safety_weight = 0.2)
  - `"safest"`: Maximize safety (safety_weight = 0.8)
  - `"balanced"`: Balance distance and safety (safety_weight = 0.5)

**Example Request:**
```json
POST /api/v1/routing/calculate
Authorization: Bearer {token}
Content-Type: application/json

{
  "origin": [-75.1652, 39.9526],
  "destination": [-75.1580, 39.9500],
  "mode": "balanced",
  "include_alternative": true
}
```

**Response Schema:**
```typescript
interface Route {
  segment_ids: string[];         // Ordered list
  geometry: GeoJSON.LineString;  // WGS84 coordinates
  length_m: number;              // Total distance
  duration_min: number;          // Estimated time (15 km/h walking speed)
  avg_safety: number;            // [1.0, 5.0]
  min_safety: number;            // [1.0, 5.0], worst segment
  cost_score: number;            // A* cost value
}

interface RoutingResponse {
  origin: [number, number];
  destination: [number, number];
  primary: Route;
  alternative?: Route;           // Null if no viable alternative
  computation_time_ms: number;   // Performance metric
}
```

**Example Response:**
```json
{
  "origin": [-75.1652, 39.9526],
  "destination": [-75.1580, 39.9500],
  "primary": {
    "segment_ids": ["seg_001", "seg_005", "seg_012"],
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [-75.1652, 39.9526],
        [-75.1640, 39.9520],
        [-75.1580, 39.9500]
      ]
    },
    "length_m": 2100,
    "duration_min": 18,
    "avg_safety": 3.4,
    "min_safety": 2.8,
    "cost_score": 2347.5
  },
  "alternative": {
    "segment_ids": ["seg_002", "seg_008", "seg_015"],
    "geometry": { /* ... */ },
    "length_m": 2283,
    "duration_min": 19,
    "avg_safety": 4.1,
    "min_safety": 3.6,
    "cost_score": 2404.2
  },
  "computation_time_ms": 142
}
```

**Error Codes:**
- `400`: Invalid coordinates or parameters
- `401`: Missing or invalid authentication token
- `404`: No route found (disconnected graph)
- `422`: Origin and destination too far (>10 km)
- `429`: Rate limit exceeded (max 100 routing requests/hour)
- `503`: Routing service temporarily unavailable

---

### 3.5 GET /api/v1/diary/trend

**Description:** Retrieve historical trend data for a route's safety rating.

**Method:** GET

**Query Parameters:**
```typescript
interface TrendQuery {
  route_id: string;              // Required
  start_date?: string;           // ISO 8601 date, default 90 days ago
  end_date?: string;             // ISO 8601 date, default today
  window_days?: number;          // Rolling window size, default 30
}
```

**Example Request:**
```
GET /api/v1/diary/trend?route_id=route_001&start_date=2024-10-01&window_days=30
Authorization: Bearer {token}
```

**Response Schema:** (See [CHARTS_SPEC_M2.md](./CHARTS_SPEC_M2.md) Section 2.2)

**Error Codes:**
- `400`: Invalid date format or window size
- `404`: Route not found
- `429`: Rate limit exceeded

---

### 3.6 GET /api/v1/diary/tags

**Description:** Retrieve tag distribution for a route.

**Method:** GET

**Query Parameters:**
```typescript
interface TagsQuery {
  route_id: string;              // Required
  top_n?: number;                // Max tags to return, default 10
}
```

**Example Request:**
```
GET /api/v1/diary/tags?route_id=route_001&top_n=10
```

**Response Schema:** (See [CHARTS_SPEC_M2.md](./CHARTS_SPEC_M2.md) Section 3.2)

**Error Codes:**
- `400`: Invalid route_id or top_n
- `404`: Route not found
- `429`: Rate limit exceeded

---

### 3.7 GET /api/v1/diary/coverage

**Description:** Retrieve spatial coverage heatmap data.

**Method:** GET

**Query Parameters:**
```typescript
interface CoverageQuery {
  bbox: string;                  // "west,south,east,north"
  grid_size?: number;            // Meters per cell, default 50
}
```

**Example Request:**
```
GET /api/v1/diary/coverage?bbox=-75.20,39.90,-75.10,40.00&grid_size=50
```

**Response Schema:** (See [CHARTS_SPEC_M2.md](./CHARTS_SPEC_M2.md) Section 4.2)

**Error Codes:**
- `400`: Invalid bbox or grid_size
- `422`: Bbox too large (max 100 km²)
- `429`: Rate limit exceeded

---

## 4. A* Pathfinding Cost Function

### 4.1 Formula

```javascript
function calculateEdgeCost(segment, mode = 'balanced') {
  const distance = segment.length_m
  const safety_rating = segment.decayed_mean  // [1, 5]

  // Penalty factor: higher for unsafe segments
  const penalty = (5 - safety_rating) / 5     // [0, 0.8]

  // Safety weight based on mode
  const safety_weight = {
    'optimal': 0.2,
    'safest': 0.8,
    'balanced': 0.5
  }[mode]

  // Combined cost
  const cost = distance * (1 + safety_weight * penalty)

  return cost
}
```

### 4.2 Examples

**Segment A:**
- length_m = 200
- decayed_mean = 5.0 (very safe)

**Mode: balanced (safety_weight = 0.5)**
```
penalty = (5 - 5) / 5 = 0
cost = 200 * (1 + 0.5 * 0) = 200
```

**Segment B:**
- length_m = 200
- decayed_mean = 1.0 (very unsafe)

**Mode: balanced**
```
penalty = (5 - 1) / 5 = 0.8
cost = 200 * (1 + 0.5 * 0.8) = 200 * 1.4 = 280
```

**Interpretation:** Unsafe segment B is treated as 40% longer than safe segment A.

### 4.3 Heuristic Function

A* requires admissible heuristic (never overestimates):

```javascript
function heuristic(node, destination) {
  const distance = haversineDistance(node.coords, destination)
  // Assume best case: perfectly safe segment (penalty = 0)
  return distance
}
```

### 4.4 Alternative Route Generation

**Strategy:** Penalty method (after finding primary route)

1. Find optimal route (primary)
2. Increase edge costs of primary route segments by 50%
3. Run A* again to find alternative
4. Validate alternative:
   - Overlap < 70% with primary
   - Distance delta < 30%
   - If validation fails, return null

**Pseudocode:**
```javascript
function findAlternative(origin, destination, primary) {
  const penalized_graph = graph.clone()

  for (const seg_id of primary.segment_ids) {
    penalized_graph.edges[seg_id].cost *= 1.5
  }

  const alternative = astar(origin, destination, penalized_graph)

  if (alternative == null) return null

  const overlap = calculateOverlap(primary, alternative)
  const delta_pct = (alternative.length_m - primary.length_m) / primary.length_m

  if (overlap > 0.7 || delta_pct > 0.3) {
    return null  // Too similar or too long
  }

  return alternative
}
```

---

## 5. Database Schema (High-Level)

*Detailed Postgres schema in [SQL_SCHEMA_DIARY_M2.md](./SQL_SCHEMA_DIARY_M2.md)*

**Core Tables:**
- `segments` - Street segment geometries and metadata
- `ratings` - User-submitted safety ratings
- `votes` - Community interaction votes (agree/safer)
- `routes` - Saved user routes
- `users` - User accounts and authentication

**Materialized Views:**
- `segment_aggregates` - Pre-computed decayed_mean, n_eff, top_tags per segment
- `trend_daily` - Daily aggregated safety scores per route
- `coverage_grid` - Spatial heatmap data at 50m resolution

**Refresh Strategy:**
- `segment_aggregates`: Refresh on rating/vote insert (trigger)
- `trend_daily`: Refresh nightly (cron job)
- `coverage_grid`: Refresh on demand (API request triggers if stale)

---

## 6. Performance Requirements

### 6.1 Response Times (95th percentile)

- GET /segments: <500ms
- POST /ratings: <300ms
- POST /votes: <200ms
- POST /routing/calculate: <2 seconds (complex A*)
- GET /diary/trend: <800ms
- GET /diary/tags: <400ms
- GET /diary/coverage: <1.5 seconds (computation-heavy)

### 6.2 Throughput

- Peak traffic: 1000 requests/minute
- Sustained: 500 requests/minute
- Burst capacity: 2000 requests/minute for 2 minutes

### 6.3 Database Queries

- All queries use indexes on primary keys, foreign keys, and bbox columns
- Spatial queries use PostGIS `GIST` indexes on geometry columns
- Aggregation queries use materialized views (not live computation)

---

## 7. Security & Data Privacy

### 7.1 PII Protection

**Stored:**
- User ratings linked to user_id (pseudonymous)
- No GPS trajectories stored (only segment_ids)

**NOT Stored:**
- Exact timestamps (rounded to nearest hour)
- Device identifiers beyond basic type (mobile/desktop)
- IP addresses (rate limiting uses hashed IPs)

### 7.2 Input Validation

All POST endpoints validate:
- SQL injection: Use parameterized queries (pg-promise)
- XSS: Escape HTML in comments before storage
- NoSQL injection: N/A (Postgres only)
- Path traversal: N/A (no file operations)
- CSRF: Require custom header `X-Requested-With: XMLHttpRequest`

### 7.3 Rate Limiting

Implemented via Redis with sliding window algorithm:
```javascript
const key = `ratelimit:${endpoint}:${userId || hashedIp}`
const current = await redis.incr(key)
if (current === 1) await redis.expire(key, 3600) // 1 hour window
if (current > limit) throw new RateLimitError()
```

---

## 8. Deployment & Infrastructure

### 8.1 Architecture

```
[Client] → [API Gateway] → [Node.js App] → [Postgres + PostGIS]
                              ↓
                          [Redis Cache]
```

### 8.2 Dependencies

- **Node.js:** v20 LTS
- **Framework:** Express.js v4.18
- **Database:** Postgres 16 + PostGIS 3.4
- **Cache:** Redis 7.2
- **Authentication:** jsonwebtoken v9.0

### 8.3 Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=production
API_BASE_URL=https://api.example.com

# Database
DATABASE_URL=postgres://user:pass@host:5432/diary_db
DATABASE_POOL_SIZE=20
DATABASE_SSL=true

# Redis
REDIS_URL=redis://host:6379
REDIS_PASSWORD=secret

# Auth
JWT_SECRET=your-secret-key
JWT_EXPIRY=24h

# Rate Limiting
RATE_LIMIT_WINDOW=3600
RATE_LIMIT_MAX_ANONYMOUS=100
RATE_LIMIT_MAX_AUTHENTICATED=1000
```

---

## 9. Testing & Monitoring

### 9.1 Health Check Endpoint

**GET /api/health**

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "database": "connected",
  "redis": "connected",
  "timestamp": "2025-11-11T14:50:00Z"
}
```

### 9.2 Metrics

Expose Prometheus metrics at `/api/metrics`:
- Request count by endpoint and status code
- Response time histogram
- Database query duration
- Active connections pool size
- Rate limit hits

### 9.3 Error Tracking

Integrate Sentry or similar for:
- Uncaught exceptions
- Failed database queries
- API 5xx errors
- Performance degradation alerts

---

## 10. Acceptance Criteria

(Testable in [TEST_PLAN_M2.md](./TEST_PLAN_M2.md))

1. All endpoints return valid JSON matching schemas
2. Authentication enforced on protected endpoints
3. Rate limiting triggers 429 after threshold
4. A* routing completes in <2 seconds for 95% of requests
5. POST /ratings validates all fields per spec
6. Alternative routes differ by <30% distance and <70% overlap
7. Database queries use indexes (verify with EXPLAIN ANALYZE)
8. Response times meet 95th percentile targets
9. Health check endpoint returns 200 when all services healthy
10. Error responses include actionable error codes and messages

---

**Document Status:** ✅ Complete, ready for Agent-I implementation
**Last Updated:** 2025-11-11
**Related:** [SQL_SCHEMA_DIARY_M2.md](./SQL_SCHEMA_DIARY_M2.md), [DIARY_SPEC_M2.md](./DIARY_SPEC_M2.md), [TEST_PLAN_M2.md](./TEST_PLAN_M2.md)
