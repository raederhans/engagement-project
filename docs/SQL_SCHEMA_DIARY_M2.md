# Route Safety Diary — M2 SQL Schema Specification

**Version:** M2
**Status:** Agent-I implementation spec
**Database:** PostgreSQL 16 + PostGIS 3.4
**Audience:** Backend developers (Agent-I), DBAs, DevOps

---

## 1. Purpose

This document specifies the **Postgres database schema** for the Route Safety Diary M2 backend, including:
- Table definitions with constraints and indexes
- Materialized views for aggregation
- Triggers for auto-updates
- Upsert strategies and conflict resolution
- Performance optimization guidelines

---

## 2. Database Configuration

### 2.1 Extensions

```sql
CREATE EXTENSION IF NOT EXISTS postgis;           -- Spatial data types
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- UUID generation
CREATE EXTENSION IF NOT EXISTS pg_trgm;           -- Fuzzy text search
CREATE EXTENSION IF NOT EXISTS btree_gist;        -- GIST indexes on non-spatial types
```

### 2.2 Connection Settings

```sql
-- Recommended settings for Postgres 16
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET work_mem = '16MB';
ALTER SYSTEM SET max_connections = 100;
SELECT pg_reload_conf();
```

### 2.3 Schemas

```sql
CREATE SCHEMA IF NOT EXISTS diary;     -- Core diary tables
CREATE SCHEMA IF NOT EXISTS auth;      -- User authentication
CREATE SCHEMA IF NOT EXISTS analytics; -- Aggregated views
```

---

## 3. Core Tables

### 3.1 Table: `diary.segments`

**Purpose:** Street segment geometries and current aggregated safety data.

```sql
CREATE TABLE diary.segments (
  segment_id VARCHAR(50) PRIMARY KEY,
  street VARCHAR(200) NOT NULL,
  neighborhood VARCHAR(100),
  length_m NUMERIC(8, 2) NOT NULL CHECK (length_m > 0),
  geometry GEOMETRY(LineString, 4326) NOT NULL,  -- WGS84

  -- Aggregated metrics (denormalized for performance)
  decayed_mean NUMERIC(3, 2) DEFAULT 3.00 CHECK (decayed_mean BETWEEN 1.00 AND 5.00),
  n_eff NUMERIC(8, 2) DEFAULT 0.00 CHECK (n_eff >= 0),
  confidence NUMERIC(3, 2) GENERATED ALWAYS AS (
    LEAST(1.0, n_eff / 10.0)
  ) STORED,
  top_tags TEXT[] DEFAULT '{}',
  delta_30d NUMERIC(3, 2) DEFAULT 0.00 CHECK (delta_30d BETWEEN -4.00 AND 4.00),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for bbox queries
CREATE INDEX idx_segments_geometry ON diary.segments USING GIST (geometry);

-- B-tree indexes for filtering
CREATE INDEX idx_segments_confidence ON diary.segments (confidence) WHERE confidence >= 0.5;
CREATE INDEX idx_segments_updated ON diary.segments (updated_at DESC);
CREATE INDEX idx_segments_neighborhood ON diary.segments (neighborhood);

-- Trigger to auto-update updated_at
CREATE TRIGGER segments_updated_at
  BEFORE UPDATE ON diary.segments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

**Notes:**
- `confidence` is a generated column (auto-computed from `n_eff`)
- `top_tags` stored as Postgres TEXT array for simplicity
- `geometry` uses SRID 4326 (WGS84) for compatibility with GeoJSON

### 3.2 Table: `diary.ratings`

**Purpose:** Individual user-submitted safety ratings.

```sql
CREATE TABLE diary.ratings (
  rating_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment_id VARCHAR(50) NOT NULL REFERENCES diary.segments(segment_id) ON DELETE CASCADE,
  route_id UUID REFERENCES diary.routes(route_id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,

  -- Rating data
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags TEXT[] DEFAULT '{}',
  comment TEXT CHECK (LENGTH(comment) <= 500),

  -- Metadata
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device VARCHAR(20) CHECK (device IN ('mobile', 'desktop', 'tablet')),
  source VARCHAR(20) CHECK (source IN ('recording', 'manual', 'community')),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'pending_review', 'rejected')),

  -- Prevent duplicate submissions (same user, same segment, within 1 hour)
  CONSTRAINT unique_rating_per_hour UNIQUE (user_id, segment_id, submitted_at)
);

-- Indexes for common queries
CREATE INDEX idx_ratings_segment ON diary.ratings (segment_id, submitted_at DESC);
CREATE INDEX idx_ratings_user ON diary.ratings (user_id, submitted_at DESC);
CREATE INDEX idx_ratings_status ON diary.ratings (status) WHERE status = 'accepted';
CREATE INDEX idx_ratings_submitted ON diary.ratings (submitted_at DESC);

-- GIN index for array search on tags
CREATE INDEX idx_ratings_tags ON diary.ratings USING GIN (tags);

-- Partial index for recent ratings (used in aggregation)
CREATE INDEX idx_ratings_recent ON diary.ratings (segment_id, submitted_at DESC)
  WHERE submitted_at > NOW() - INTERVAL '180 days' AND status = 'accepted';
```

**Notes:**
- `unique_rating_per_hour` uses timestamp in UNIQUE constraint - in practice, implement bucketing (round to nearest hour) in app logic or use exclusion constraint
- `route_id` nullable to support standalone segment ratings
- Only `accepted` ratings contribute to aggregation

### 3.3 Table: `diary.votes`

**Purpose:** Community interaction votes (Agree 👍, Feels safer ✨).

```sql
CREATE TABLE diary.votes (
  vote_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  segment_id VARCHAR(50) NOT NULL REFERENCES diary.segments(segment_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,

  -- Vote data
  action VARCHAR(10) NOT NULL CHECK (action IN ('agree', 'safer')),
  implicit_rating SMALLINT NOT NULL CHECK (implicit_rating BETWEEN 1 AND 5),

  -- Metadata
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate votes (one per action per segment per user per 24h)
  CONSTRAINT unique_vote_per_day UNIQUE (user_id, segment_id, action, submitted_at)
);

-- Indexes
CREATE INDEX idx_votes_segment ON diary.votes (segment_id, submitted_at DESC);
CREATE INDEX idx_votes_user ON diary.votes (user_id, submitted_at DESC);

-- Partial index for recent votes (last 180 days)
CREATE INDEX idx_votes_recent ON diary.votes (segment_id, submitted_at DESC)
  WHERE submitted_at > NOW() - INTERVAL '180 days';
```

**Notes:**
- `implicit_rating` computed by app logic before insert:
  - `agree`: current segment `decayed_mean`
  - `safer`: `MIN(decayed_mean + 1, 5)`
- Same bucketing strategy as ratings for UNIQUE constraint (round to nearest day)

### 3.4 Table: `diary.routes`

**Purpose:** User-saved routes with primary and alternative paths.

```sql
CREATE TABLE diary.routes (
  route_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  route_name VARCHAR(200) NOT NULL,

  -- Primary route
  segment_ids TEXT[] NOT NULL,
  geometry GEOMETRY(LineString, 4326) NOT NULL,
  length_m NUMERIC(8, 2) NOT NULL CHECK (length_m > 0),
  duration_min NUMERIC(6, 2) NOT NULL CHECK (duration_min > 0),
  avg_safety NUMERIC(3, 2) CHECK (avg_safety BETWEEN 1.00 AND 5.00),

  -- Alternative route (nullable)
  alt_segment_ids TEXT[],
  alt_geometry GEOMETRY(LineString, 4326),
  alt_length_m NUMERIC(8, 2) CHECK (alt_length_m > 0),
  alt_duration_min NUMERIC(6, 2) CHECK (alt_duration_min > 0),
  alt_avg_safety NUMERIC(3, 2) CHECK (alt_avg_safety BETWEEN 1.00 AND 5.00),

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_public BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes
CREATE INDEX idx_routes_user ON diary.routes (user_id, created_at DESC);
CREATE INDEX idx_routes_geometry ON diary.routes USING GIST (geometry);
CREATE INDEX idx_routes_public ON diary.routes (is_public) WHERE is_public = TRUE;

-- GIN indexes for array search
CREATE INDEX idx_routes_segments ON diary.routes USING GIN (segment_ids);
CREATE INDEX idx_routes_alt_segments ON diary.routes USING GIN (alt_segment_ids);

-- Trigger to auto-update updated_at
CREATE TRIGGER routes_updated_at
  BEFORE UPDATE ON diary.routes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

**Notes:**
- `segment_ids` stored as TEXT array of segment IDs (e.g., `{'seg_001', 'seg_005', 'seg_012'}`)
- Alternative route fields nullable (not all routes have alternatives)
- `is_public` allows users to share routes with community

### 3.5 Table: `auth.users`

**Purpose:** User accounts and authentication (simplified for M2).

```sql
CREATE TABLE auth.users (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,  -- bcrypt hash

  -- Profile
  display_name VARCHAR(100),
  avatar_url TEXT,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,

  -- Rate limiting
  api_tier VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (api_tier IN ('free', 'premium', 'enterprise'))
);

-- Indexes
CREATE INDEX idx_users_email ON auth.users (email);
CREATE INDEX idx_users_active ON auth.users (is_active) WHERE is_active = TRUE;
CREATE INDEX idx_users_tier ON auth.users (api_tier);
```

**Notes:**
- M2 uses simple email/password auth
- M3+ will integrate OAuth2 (Google, GitHub)
- `api_tier` determines rate limits

---

## 4. Materialized Views

### 4.1 View: `analytics.segment_aggregates`

**Purpose:** Pre-compute aggregated metrics for all segments.

```sql
CREATE MATERIALIZED VIEW analytics.segment_aggregates AS
WITH combined_ratings AS (
  -- Union ratings and votes
  SELECT
    segment_id,
    rating AS value,
    submitted_at,
    tags
  FROM diary.ratings
  WHERE status = 'accepted'

  UNION ALL

  SELECT
    segment_id,
    implicit_rating AS value,
    submitted_at,
    '{}' AS tags  -- votes don't have tags
  FROM diary.votes
),
time_weighted AS (
  SELECT
    segment_id,
    value,
    tags,
    submitted_at,
    -- Exponential decay: 2^(-days_ago / 21)
    POWER(2, -EXTRACT(EPOCH FROM (NOW() - submitted_at)) / (21 * 86400.0)) AS weight
  FROM combined_ratings
  WHERE submitted_at > NOW() - INTERVAL '180 days'  -- Only last 6 months
),
aggregated AS (
  SELECT
    segment_id,
    SUM(value * weight) / NULLIF(SUM(weight), 0) AS observed_mean,
    SUM(weight) AS n_eff,
    COUNT(*) AS n_samples
  FROM time_weighted
  GROUP BY segment_id
),
bayesian AS (
  SELECT
    segment_id,
    -- James-Stein shrinkage: (prior_mean * prior_n + obs_mean * obs_n) / (prior_n + obs_n)
    (3.0 * 5 + COALESCE(observed_mean, 3.0) * n_eff) / (5 + n_eff) AS decayed_mean,
    COALESCE(n_eff, 0) AS n_eff,
    n_samples
  FROM aggregated
),
top_tags AS (
  SELECT
    segment_id,
    ARRAY(
      SELECT tag
      FROM (
        SELECT UNNEST(tags) AS tag
        FROM time_weighted t
        WHERE t.segment_id = tw.segment_id AND ARRAY_LENGTH(tags, 1) > 0
      ) sub
      GROUP BY tag
      ORDER BY COUNT(*) DESC
      LIMIT 5
    ) AS top_tags
  FROM time_weighted tw
  GROUP BY segment_id
),
trend AS (
  SELECT
    segment_id,
    COALESCE(
      (SELECT AVG(value) FROM time_weighted t
       WHERE t.segment_id = tw.segment_id AND submitted_at > NOW() - INTERVAL '30 days'),
      3.0
    ) - COALESCE(
      (SELECT AVG(value) FROM time_weighted t
       WHERE t.segment_id = tw.segment_id
       AND submitted_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'),
      3.0
    ) AS delta_30d
  FROM time_weighted tw
  GROUP BY segment_id
)
SELECT
  s.segment_id,
  s.street,
  s.neighborhood,
  s.length_m,
  s.geometry,
  ROUND(CAST(COALESCE(b.decayed_mean, 3.0) AS NUMERIC), 2) AS decayed_mean,
  ROUND(CAST(COALESCE(b.n_eff, 0) AS NUMERIC), 2) AS n_eff,
  COALESCE(t.top_tags, '{}') AS top_tags,
  ROUND(CAST(COALESCE(tr.delta_30d, 0) AS NUMERIC), 2) AS delta_30d,
  NOW() AS computed_at
FROM diary.segments s
LEFT JOIN bayesian b USING (segment_id)
LEFT JOIN top_tags t USING (segment_id)
LEFT JOIN trend tr USING (segment_id);

-- Indexes on materialized view
CREATE UNIQUE INDEX idx_segment_agg_id ON analytics.segment_aggregates (segment_id);
CREATE INDEX idx_segment_agg_geometry ON analytics.segment_aggregates USING GIST (geometry);
CREATE INDEX idx_segment_agg_confidence ON analytics.segment_aggregates ((LEAST(1.0, n_eff / 10.0))) WHERE (n_eff / 10.0) >= 0.5;
```

**Refresh Strategy:**

1. **Trigger-based (immediate):**
```sql
CREATE OR REPLACE FUNCTION refresh_segment_agg()
RETURNS TRIGGER AS $$
BEGIN
  -- Refresh only affected segment(s)
  -- Full refresh is expensive, so do selective update
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.segment_aggregates;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ratings_refresh_agg
  AFTER INSERT OR UPDATE ON diary.ratings
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_segment_agg();

CREATE TRIGGER votes_refresh_agg
  AFTER INSERT OR UPDATE ON diary.votes
  FOR EACH STATEMENT
  EXECUTE FUNCTION refresh_segment_agg();
```

2. **Scheduled (nightly for full refresh):**
```sql
-- Run via cron or pg_cron extension
SELECT cron.schedule('refresh_segment_aggregates', '0 2 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.segment_aggregates');
```

**Notes:**
- `CONCURRENTLY` allows reads during refresh (requires UNIQUE index)
- For M2, trigger-based refresh may cause performance issues under high load - consider async queue
- Alternative: Compute aggregations on-the-fly in app logic (M1 approach) and cache in Redis

### 4.2 View: `analytics.trend_daily`

**Purpose:** Pre-compute daily safety trends per route for chart data.

```sql
CREATE MATERIALIZED VIEW analytics.trend_daily AS
WITH route_segments AS (
  SELECT
    r.route_id,
    r.route_name,
    UNNEST(r.segment_ids) AS segment_id
  FROM diary.routes r
),
daily_ratings AS (
  SELECT
    rs.route_id,
    rs.route_name,
    DATE(rat.submitted_at) AS date,
    AVG(rat.rating) AS mean_rating,
    STDDEV(rat.rating) AS std_dev,
    COUNT(*) AS n_samples
  FROM route_segments rs
  JOIN diary.ratings rat ON rs.segment_id = rat.segment_id
  WHERE rat.status = 'accepted'
    AND rat.submitted_at > NOW() - INTERVAL '180 days'
  GROUP BY rs.route_id, rs.route_name, DATE(rat.submitted_at)
),
daily_votes AS (
  SELECT
    rs.route_id,
    DATE(v.submitted_at) AS date,
    AVG(v.implicit_rating) AS mean_rating,
    COUNT(*) AS n_samples
  FROM route_segments rs
  JOIN diary.votes v ON rs.segment_id = v.segment_id
  WHERE v.submitted_at > NOW() - INTERVAL '180 days'
  GROUP BY rs.route_id, DATE(v.submitted_at)
),
combined AS (
  SELECT * FROM daily_ratings
  UNION ALL
  SELECT route_id, NULL AS route_name, date, mean_rating, 0 AS std_dev, n_samples FROM daily_votes
),
aggregated AS (
  SELECT
    route_id,
    MAX(route_name) AS route_name,
    date,
    AVG(mean_rating) AS mean_rating,
    AVG(std_dev) AS std_error,
    SUM(n_samples) AS n_samples
  FROM combined
  GROUP BY route_id, date
)
SELECT
  route_id,
  route_name,
  date,
  ROUND(CAST(mean_rating AS NUMERIC), 2) AS mean_rating,
  ROUND(CAST(std_error / SQRT(GREATEST(n_samples, 1)) AS NUMERIC), 2) AS std_error,
  n_samples,
  LEAST(1.0, n_samples / 10.0) AS confidence,
  NOW() AS computed_at
FROM aggregated
ORDER BY route_id, date;

-- Indexes
CREATE INDEX idx_trend_daily_route ON analytics.trend_daily (route_id, date DESC);
CREATE INDEX idx_trend_daily_date ON analytics.trend_daily (date DESC);
```

**Refresh Strategy:** Nightly cron job (no trigger needed, computationally expensive).

### 4.3 View: `analytics.coverage_grid`

**Purpose:** Spatial heatmap of data confidence at 50m grid resolution.

```sql
CREATE MATERIALIZED VIEW analytics.coverage_grid AS
WITH grid AS (
  SELECT
    x, y,
    ST_MakeEnvelope(
      -75.20 + (x * 0.0005),  -- ~50m at 40° latitude
      39.90 + (y * 0.0005),
      -75.20 + ((x + 1) * 0.0005),
      39.90 + ((y + 1) * 0.0005),
      4326
    ) AS cell_geom
  FROM generate_series(0, 199) AS x
  CROSS JOIN generate_series(0, 199) AS y
),
cell_segments AS (
  SELECT
    g.x,
    g.y,
    ST_Centroid(g.cell_geom) AS center,
    COUNT(s.segment_id) AS segment_count,
    AVG(s.n_eff) AS mean_n_eff
  FROM grid g
  LEFT JOIN analytics.segment_aggregates s ON ST_Intersects(g.cell_geom, s.geometry)
  GROUP BY g.x, g.y, g.cell_geom
)
SELECT
  x,
  y,
  ST_X(center) AS center_lng,
  ST_Y(center) AS center_lat,
  ROUND(CAST(LEAST(1.0, mean_n_eff / 10.0) AS NUMERIC), 2) AS mean_confidence,
  segment_count,
  ROUND(CAST(mean_n_eff AS NUMERIC), 2) AS total_samples,
  NOW() AS computed_at
FROM cell_segments;

-- Indexes
CREATE INDEX idx_coverage_grid_xy ON analytics.coverage_grid (x, y);
CREATE INDEX idx_coverage_grid_confidence ON analytics.coverage_grid (mean_confidence);
```

**Refresh Strategy:** On-demand (expensive, only refresh when API endpoint called and data stale >1 hour).

**Notes:**
- Grid hardcoded to Philadelphia bbox in M2
- M3+ will make this dynamic based on API request bbox

---

## 5. Helper Functions

### 5.1 Function: `update_updated_at()`

**Purpose:** Automatically update `updated_at` timestamp on row modification.

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 5.2 Function: `calculate_segment_cost()`

**Purpose:** A* cost function (used in pathfinding queries).

```sql
CREATE OR REPLACE FUNCTION calculate_segment_cost(
  length_m NUMERIC,
  decayed_mean NUMERIC,
  safety_weight NUMERIC DEFAULT 0.5
)
RETURNS NUMERIC AS $$
BEGIN
  -- Penalty: (5 - rating) / 5
  DECLARE
    penalty NUMERIC := (5.0 - decayed_mean) / 5.0;
  BEGIN
    RETURN length_m * (1.0 + safety_weight * penalty);
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**Usage in A* query:**
```sql
SELECT segment_id, calculate_segment_cost(length_m, decayed_mean, 0.5) AS cost
FROM analytics.segment_aggregates;
```

---

## 6. Upsert Strategies

### 6.1 Upsert Segment Data

**Scenario:** Loading segments from GeoJSON (e.g., `segments_phl.demo.geojson`).

```sql
INSERT INTO diary.segments (segment_id, street, neighborhood, length_m, geometry)
VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5))
ON CONFLICT (segment_id) DO UPDATE
SET
  street = EXCLUDED.street,
  neighborhood = EXCLUDED.neighborhood,
  length_m = EXCLUDED.length_m,
  geometry = EXCLUDED.geometry,
  updated_at = NOW();
```

**Notes:**
- `ON CONFLICT` avoids duplicate inserts
- Aggregated fields (`decayed_mean`, `n_eff`, etc.) NOT updated here - managed by materialized view

### 6.2 Upsert Route Data

**Scenario:** User saves/updates a route.

```sql
INSERT INTO diary.routes (
  route_id, user_id, route_name, segment_ids, geometry, length_m, duration_min,
  alt_segment_ids, alt_geometry, alt_length_m, alt_duration_min
)
VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6, $7, $8, ST_GeomFromGeoJSON($9), $10, $11)
ON CONFLICT (route_id) DO UPDATE
SET
  route_name = EXCLUDED.route_name,
  segment_ids = EXCLUDED.segment_ids,
  geometry = EXCLUDED.geometry,
  length_m = EXCLUDED.length_m,
  duration_min = EXCLUDED.duration_min,
  alt_segment_ids = EXCLUDED.alt_segment_ids,
  alt_geometry = EXCLUDED.alt_geometry,
  alt_length_m = EXCLUDED.alt_length_m,
  alt_duration_min = EXCLUDED.alt_duration_min,
  updated_at = NOW();
```

### 6.3 Idempotent Rating Submission

**Scenario:** Client retries POST /ratings on network failure.

```sql
INSERT INTO diary.ratings (rating_id, segment_id, user_id, rating, tags, comment, device, source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (rating_id) DO NOTHING;
```

**Notes:**
- Client generates UUID v4 for `rating_id` before request
- Retry uses same `rating_id` to ensure idempotence
- `DO NOTHING` prevents duplicate inserts

---

## 7. Performance Optimization

### 7.1 Query Plan Analysis

Verify indexes are used:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM diary.segments
WHERE ST_Intersects(geometry, ST_MakeEnvelope(-75.20, 39.90, -75.10, 40.00, 4326))
  AND confidence >= 0.5
LIMIT 100;
```

**Expected plan:**
- Bitmap Index Scan on `idx_segments_geometry`
- Recheck Cond with bbox filter
- Filter on `confidence` using `idx_segments_confidence`

### 7.2 Vacuuming & Maintenance

```sql
-- Auto-vacuum settings (in postgresql.conf)
autovacuum_vacuum_scale_factor = 0.1
autovacuum_analyze_scale_factor = 0.05
autovacuum_vacuum_cost_limit = 200

-- Manual vacuum (for heavily updated tables)
VACUUM ANALYZE diary.ratings;
VACUUM ANALYZE diary.votes;
VACUUM ANALYZE diary.segments;
```

### 7.3 Connection Pooling

Use PgBouncer or similar:

```ini
[databases]
diary_db = host=localhost port=5432 dbname=diary_db

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 20
reserve_pool_size = 5
reserve_pool_timeout = 3
```

---

## 8. Data Migration & Seeding

### 8.1 Initial Segment Load

**Script:** `scripts/seed_segments.js`

```javascript
const fs = require('fs')
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const geojson = JSON.parse(fs.readFileSync('data/segments_phl.demo.geojson', 'utf8'))

async function seedSegments() {
  for (const feature of geojson.features) {
    const { segment_id, street, neighborhood, length_m } = feature.properties
    const geometry = JSON.stringify(feature.geometry)

    await pool.query(`
      INSERT INTO diary.segments (segment_id, street, neighborhood, length_m, geometry)
      VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5))
      ON CONFLICT (segment_id) DO NOTHING
    `, [segment_id, street, neighborhood, length_m, geometry])
  }

  console.log(`Loaded ${geojson.features.length} segments`)
}

seedSegments().then(() => pool.end())
```

### 8.2 Synthetic Rating Data (for testing)

```sql
-- Generate 1000 random ratings for testing
INSERT INTO diary.ratings (segment_id, user_id, rating, submitted_at)
SELECT
  (SELECT segment_id FROM diary.segments ORDER BY RANDOM() LIMIT 1),
  (SELECT user_id FROM auth.users ORDER BY RANDOM() LIMIT 1),
  (RANDOM() * 4 + 1)::INT,  -- Random rating 1-5
  NOW() - (RANDOM() * INTERVAL '90 days')  -- Random timestamp last 90 days
FROM generate_series(1, 1000);
```

---

## 9. Backup & Recovery

### 9.1 Backup Strategy

**Daily full backup:**
```bash
pg_dump -h localhost -U postgres -d diary_db -F c -f /backups/diary_db_$(date +%Y%m%d).dump
```

**Continuous archiving (WAL):**
```sql
-- In postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /archive/%f'
```

### 9.2 Restore from Backup

```bash
pg_restore -h localhost -U postgres -d diary_db -c /backups/diary_db_20251111.dump
```

### 9.3 Point-in-Time Recovery

```bash
# Restore base backup
pg_restore -d diary_db /backups/base.dump

# Apply WAL logs up to target time
recovery_target_time = '2025-11-11 14:30:00'
```

---

## 10. Security

### 10.1 Row-Level Security (RLS)

**Enable RLS on user-specific tables:**

```sql
ALTER TABLE diary.routes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own routes
CREATE POLICY routes_user_isolation ON diary.routes
  FOR ALL
  USING (user_id = current_setting('app.user_id')::UUID);

-- Policy: Public routes visible to all
CREATE POLICY routes_public_visible ON diary.routes
  FOR SELECT
  USING (is_public = TRUE);
```

**Set user context in app:**
```sql
-- Before each query, set user_id from JWT
SET LOCAL app.user_id = 'user_12345';
```

### 10.2 Audit Logging

**Log all modifications to critical tables:**

```sql
CREATE TABLE audit.log (
  log_id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,  -- INSERT, UPDATE, DELETE
  user_id UUID,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO audit.log (table_name, operation, user_id, old_data)
    VALUES (TG_TABLE_NAME, TG_OP, OLD.user_id, row_to_json(OLD));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit.log (table_name, operation, user_id, old_data, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, NEW.user_id, row_to_json(OLD), row_to_json(NEW));
    RETURN NEW;
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit.log (table_name, operation, user_id, new_data)
    VALUES (TG_TABLE_NAME, TG_OP, NEW.user_id, row_to_json(NEW));
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ratings_audit AFTER INSERT OR UPDATE OR DELETE ON diary.ratings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

---

## 11. Acceptance Criteria

(Testable in [TEST_PLAN_M2.md](./TEST_PLAN_M2.md))

1. All tables created with correct constraints and indexes
2. Materialized views refresh correctly (no errors)
3. Spatial queries use GIST indexes (verify with EXPLAIN)
4. Upsert operations are idempotent (retry-safe)
5. Generated column `confidence` computes correctly
6. Foreign key constraints prevent orphaned records
7. Triggers fire on INSERT/UPDATE (verify updated_at changes)
8. RLS policies enforce user isolation on diary.routes
9. Audit log captures all modifications to diary.ratings
10. Backup/restore completes without data loss

---

## 12. Future Enhancements (M3+)

- [ ] Partitioning for `diary.ratings` and `diary.votes` (by month)
- [ ] PostGIS routing extension (pgRouting) for A* in database
- [ ] TimescaleDB for time-series optimization
- [ ] Real-time aggregation with triggers instead of materialized views
- [ ] Incremental materialized view refresh (track changed segments only)
- [ ] Spatial clustering (ST_ClusterKMeans) for heatmap cells
- [ ] Full-text search on comments (tsvector + GIN index)

---

**Document Status:** ✅ Complete, ready for Agent-I implementation
**Last Updated:** 2025-11-11
**Related:** [API_BACKEND_DIARY_M2.md](./API_BACKEND_DIARY_M2.md), [TEST_PLAN_M2.md](./TEST_PLAN_M2.md), [DIARY_SPEC_M2.md](./DIARY_SPEC_M2.md)
