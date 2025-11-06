/**
 * Sample SQL queries for census tract-based analytics (NOT executable stubs).
 * These demonstrate the pattern for implementing tract-level chart queries.
 *
 * Usage: node scripts/tract_sql_samples.mjs
 * Output: Logs 3 sample SQL queries to console and logs/TRACT_SQL_<timestamp>.log
 */

import { writeFile, mkdir } from 'node:fs/promises';

const SAMPLE_TRACT_GEOID = '42101000100'; // Example Philadelphia tract
const SAMPLE_START = '2024-01-01';
const SAMPLE_END = '2025-01-01';
const SAMPLE_TYPES = ['Motor Vehicle Theft', 'Theft from Vehicle'];

/**
 * Sample 1: Monthly time series for a single tract
 * Equivalent to fetchMonthlySeriesBuffer but using ST_Intersects with tract geometry
 */
function sampleMonthlyTractSQL(geoid, start, end, types) {
  const typesClause = types.length > 0
    ? `AND text_general_code IN (${types.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')})`
    : '';

  return `
-- Monthly time series for tract ${geoid}
-- Pattern: ST_Intersects with tract polygon from public/data/tracts_phl.geojson

SELECT
  TO_CHAR(DATE_TRUNC('month', dispatch_date_time), 'YYYY-MM') AS m,
  COUNT(*) AS n
FROM incidents_part1_part2
WHERE dispatch_date_time >= '${start}'
  AND dispatch_date_time < '${end}'
  ${typesClause}
  AND ST_Intersects(
    the_geom,
    (SELECT ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326)
     FROM tracts_geojson_table
     WHERE properties->>'GEOID' = '${geoid}')
  )
GROUP BY 1
ORDER BY 1;

-- Note: tracts_geojson_table would need to be loaded from public/data/tracts_phl.geojson
-- Alternative: Send GeoJSON polygon in ST_GeomFromGeoJSON() directly in query
`.trim();
}

/**
 * Sample 2: Top N offense types within a tract
 * Equivalent to fetchTopTypesBuffer but for tract geometry
 */
function sampleTopTypesTractSQL(geoid, start, end, limit = 12) {
  return `
-- Top ${limit} offense types for tract ${geoid}

SELECT
  text_general_code,
  COUNT(*) AS n
FROM incidents_part1_part2
WHERE dispatch_date_time >= '${start}'
  AND dispatch_date_time < '${end}'
  AND ST_Intersects(
    the_geom,
    (SELECT ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326)
     FROM tracts_geojson_table
     WHERE properties->>'GEOID' = '${geoid}')
  )
GROUP BY text_general_code
ORDER BY n DESC
LIMIT ${limit};

-- Note: This query assumes tract geometry lookup. In practice, may need to:
-- 1. Load tracts_phl.geojson into CARTO as a table, OR
-- 2. Fetch tract GeoJSON client-side and embed polygon in ST_GeomFromGeoJSON()
`.trim();
}

/**
 * Sample 3: 7x24 heatmap (day-of-week × hour) for a tract
 * Equivalent to fetch7x24Buffer but for tract geometry
 */
function sampleHeatmap7x24TractSQL(geoid, start, end, types) {
  const typesClause = types.length > 0
    ? `AND text_general_code IN (${types.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')})`
    : '';

  return `
-- 7x24 heatmap for tract ${geoid}
-- Returns: dow (0=Sunday, 6=Saturday), hr (0-23), n (count)

SELECT
  EXTRACT(DOW FROM dispatch_date_time)::INTEGER AS dow,
  EXTRACT(HOUR FROM dispatch_date_time)::INTEGER AS hr,
  COUNT(*) AS n
FROM incidents_part1_part2
WHERE dispatch_date_time >= '${start}'
  AND dispatch_date_time < '${end}'
  ${typesClause}
  AND ST_Intersects(
    the_geom,
    (SELECT ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326)
     FROM tracts_geojson_table
     WHERE properties->>'GEOID' = '${geoid}')
  )
GROUP BY dow, hr
ORDER BY dow, hr;

-- Note: Client-side implementation would:
-- 1. Load tract geometry from public/data/tracts_phl.geojson
-- 2. Extract feature matching GEOID = '${geoid}'
-- 3. Embed geometry.coordinates in ST_GeomFromGeoJSON() or use ST_MakePolygon
`.trim();
}

/**
 * Implementation notes for actual API functions
 */
const IMPLEMENTATION_NOTES = `
## Implementation Strategy for Tract Charts

### Option 1: Client-Side Geometry Embedding (Recommended for MVP)
1. Load public/data/tracts_phl.geojson once in main.js (already done)
2. Find feature where properties.GEOID matches selectedTractGEOID
3. Extract feature.geometry (GeoJSON polygon)
4. Embed in SQL: ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[...]]]}')
5. Wrap in ST_SetSRID(..., 4326) to set coordinate system
6. Use in ST_Intersects(the_geom, ST_SetSRID(ST_GeomFromGeoJSON(...), 4326))

### Option 2: Server-Side Tract Table (Future Enhancement)
1. Upload public/data/tracts_phl.geojson to CARTO as "phila_tracts_2020"
2. JOIN or subquery: WHERE ST_Intersects(i.the_geom, (SELECT t.the_geom FROM phila_tracts_2020 t WHERE t.geoid = '42101000100'))
3. Pros: Cleaner SQL, server-side indexing
4. Cons: Requires CARTO account with write access, table upload

### SQL Builder Signatures (Stubs to Add)

// src/utils/sql.js
export function buildMonthlyTractSQL({ start, end, types, tractGEOID, tractGeometry }) {
  // TODO: Implement using ST_Intersects pattern from sample 1
  throw new Error('Tract charts not yet implemented (stub)');
}

export function buildTopTypesTractSQL({ start, end, tractGEOID, tractGeometry, limit = 12 }) {
  // TODO: Implement using pattern from sample 2
  throw new Error('Tract charts not yet implemented (stub)');
}

export function buildHeatmap7x24TractSQL({ start, end, types, tractGEOID, tractGeometry }) {
  // TODO: Implement using pattern from sample 3
  throw new Error('Tract charts not yet implemented (stub)');
}

// src/api/crime.js
export async function fetchMonthlySeriesTract({ start, end, types, tractGEOID }) {
  // TODO: Load tract geometry from tracts_phl.geojson, call buildMonthlyTractSQL, fetchJson
  throw new Error('Tract charts not yet implemented (stub)');
}

export async function fetchTopTypesTract({ start, end, tractGEOID, limit = 12 }) {
  // TODO: Similar pattern
  throw new Error('Tract charts not yet implemented (stub)');
}

export async function fetch7x24Tract({ start, end, types, tractGEOID }) {
  // TODO: Similar pattern
  throw new Error('Tract charts not yet implemented (stub)');
}

### Estimated Implementation Effort
- SQL builders: 30-45 minutes (adapt from buffer/district patterns)
- API wrappers: 20-30 minutes (geometry loading, error handling)
- Chart integration: 15-20 minutes (update charts/index.js, wire to tract mode)
- Testing: 30 minutes (verify 3 charts render correctly)
- **Total**: ~2 hours

### Known Issues to Handle
1. **Large polygons**: Some tracts have complex boundaries → ST_Simplify() may help
2. **No data edge case**: Small tracts may have 0 incidents → show empty state
3. **GEOID mismatch**: Ensure GEOID format matches between store and GeoJSON (12 digits)
`.trim();

// Main execution
async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const logPath = `logs/TRACT_SQL_${ts}.log`;

  const sample1 = sampleMonthlyTractSQL(SAMPLE_TRACT_GEOID, SAMPLE_START, SAMPLE_END, SAMPLE_TYPES);
  const sample2 = sampleTopTypesTractSQL(SAMPLE_TRACT_GEOID, SAMPLE_START, SAMPLE_END, 12);
  const sample3 = sampleHeatmap7x24TractSQL(SAMPLE_TRACT_GEOID, SAMPLE_START, SAMPLE_END, SAMPLE_TYPES);

  const output = `
# Census Tract SQL Samples — Chart Queries

**Generated**: ${new Date().toISOString()}
**Purpose**: Demonstrate SQL patterns for tract-level chart data (monthly, topN, 7x24)
**Status**: Stubs only — NOT executable without tract geometry loading

---

## Sample 1: Monthly Time Series

${sample1}

---

## Sample 2: Top N Offense Types

${sample2}

---

## Sample 3: 7x24 Heatmap (Day-of-Week × Hour)

${sample3}

---

${IMPLEMENTATION_NOTES}
`.trim();

  console.log(output);

  try {
    await mkdir('logs', { recursive: true });
    await writeFile(logPath, output);
    console.log(`\n✅ Saved to ${logPath}`);
  } catch (err) {
    console.warn('Failed to write log file:', err);
  }
}

main().catch(console.error);
