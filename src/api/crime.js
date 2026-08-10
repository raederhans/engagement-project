import { CARTO_SQL_BASE } from "../config.js";
import { fetchJson, logQuery } from "../utils/http.js";
import * as Q from "../utils/sql.js";
import { expandGroupsToCodes } from "../utils/types.js";
import { fetchTractsCachedFirst } from "./boundaries.js";
import { getTractPolygonAndBboxByGEOID } from "../utils/tract_geom.js";

function invalidCrimeResponse(kind, detail) {
  throw new TypeError(`Invalid Crime ${kind} response: ${detail}`);
}

function admittedCount(value, kind) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    invalidCrimeResponse(kind, 'count must be a non-negative safe integer');
  }
  return normalized;
}

function admittedInteger(value, { min, max, kind, field }) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    invalidCrimeResponse(kind, `${field} is outside the admitted range`);
  }
  return normalized;
}

function admittedText(value, kind, field, maxLength = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    invalidCrimeResponse(kind, `${field} must be non-empty bounded text`);
  }
  return value;
}

function admittedMonth(value, kind) {
  if (typeof value !== 'string') invalidCrimeResponse(kind, 'month must be a string');
  const match = /^(\d{4})-(\d{2})-01(?:T.*)?$/.exec(value);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12 || Number.isNaN(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value))) {
    invalidCrimeResponse(kind, 'month must identify the first day of a valid calendar month');
  }
  return value;
}

function admittedRows(payload, kind, validateRow) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.rows)) {
    invalidCrimeResponse(kind, 'rows must be present as an array');
  }
  payload.rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      invalidCrimeResponse(kind, `row ${index} must be an object`);
    }
    validateRow(row, index);
  });
  return payload;
}

function admitPointResponse(payload) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    invalidCrimeResponse('points', 'a FeatureCollection with features is required');
  }
  payload.features.forEach((feature, index) => {
    if (!feature || feature.type !== 'Feature' || feature.geometry?.type !== 'Point'
      || !Array.isArray(feature.geometry.coordinates)
      || feature.geometry.coordinates.length < 2
      || !feature.geometry.coordinates.slice(0, 2).every(Number.isFinite)) {
      invalidCrimeResponse('points', `feature ${index} must have finite Point coordinates`);
    }
    if (!feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)) {
      invalidCrimeResponse('points', `feature ${index} properties must be an object`);
    }
  });
  return payload;
}

/**
 * Admit a CARTO Crime response according to the schema of the originating query.
 * Group-by queries may contain an empty rows array; missing/malformed rows fail closed.
 */
export function admitCrimeResponse(kind, payload) {
  switch (kind) {
    case 'points':
      return admitPointResponse(payload);
    case 'monthly':
      return admittedRows(payload, kind, (row) => {
        admittedMonth(row.m, kind);
        admittedCount(row.n, kind);
      });
    case 'top':
      return admittedRows(payload, kind, (row) => {
        admittedText(row.text_general_code, kind, 'offense code');
        admittedCount(row.n, kind);
      });
    case 'heat':
      return admittedRows(payload, kind, (row) => {
        admittedInteger(row.dow, { min: 0, max: 6, kind, field: 'day-of-week' });
        admittedInteger(row.hr, { min: 0, max: 23, kind, field: 'hour' });
        admittedCount(row.n, kind);
      });
    case 'district':
      return admittedRows(payload, kind, (row) => {
        const district = admittedText(String(row.dc_dist ?? ''), kind, 'district', 2);
        if (!/^\d{1,2}$/.test(district) || Number(district) < 1 || Number(district) > 99) {
          invalidCrimeResponse(kind, 'district must be a one- or two-digit positive code');
        }
        admittedCount(row.n, kind);
      });
    case 'count': {
      admittedRows(payload, kind, (row) => admittedCount(row.n, kind));
      if (payload.rows.length !== 1) invalidCrimeResponse(kind, 'count query must return exactly one row');
      return payload;
    }
    case 'codes':
      return admittedRows(payload, kind, (row) => {
        admittedText(row.text_general_code, kind, 'offense code');
      });
    default:
      invalidCrimeResponse(String(kind || 'unknown'), 'query type is not admitted');
  }
}

/**
 * Fetch crime point features for Map A.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {xmin:number, ymin:number, xmax:number, ymax:number}} [params.bbox] - Map bounding box in EPSG:3857.
 * @param {number[] | {x:number,y:number}} [params.center3857] - Buffer center in EPSG:3857.
 * @param {number} [params.radiusM] - Buffer radius in metres.
 * @returns {Promise<object>} GeoJSON FeatureCollection.
 */
export async function fetchPoints({
  start,
  end,
  types,
  bbox,
  center3857,
  radiusM,
  dc_dist,
  drilldownCodes,
  tractGeometry,
  signal,
}) {
  const sql = Q.buildCrimePointsSQL({
    start, end, types, bbox, center3857, radiusM, dc_dist, drilldownCodes, tractGeometry,
  });
  await logQuery('fetchPoints', sql);
  return admitCrimeResponse('points', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `format=GeoJSON&q=${encodeURIComponent(sql)}`,
    cacheTTL: 30_000,
    signal,
  }));
}

/**
 * Fetch citywide monthly totals.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @returns {Promise<object>} Aggregated results keyed by month.
 */
export async function fetchMonthlySeriesCity({ start, end, types, dc_dist, signal }) {
  const sql = Q.buildMonthlyCitySQL({ start, end, types, dc_dist });
  await logQuery('fetchMonthlySeriesCity', sql);
  return admitCrimeResponse('monthly', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 300_000,
    signal,
  }));
}

/**
 * Fetch buffer-based monthly totals for comparison.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {x:number, y:number}} params.center3857 - Buffer center in EPSG:3857.
 * @param {number} params.radiusM - Buffer radius in meters.
 * @returns {Promise<object>} Aggregated results keyed by month.
 */
export async function fetchMonthlySeriesBuffer({
  start,
  end,
  types,
  center3857,
  radiusM,
  signal,
}) {
  const sql = Q.buildMonthlyBufferSQL({
    start,
    end,
    types,
    center3857,
    radiusM,
  });
  await logQuery('fetchMonthlySeriesBuffer', sql);
  return admitCrimeResponse('monthly', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
    signal,
  }));
}

/**
 * Fetch top-N offense categories within buffer A.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {number[] | {x:number, y:number}} params.center3857 - Buffer center in EPSG:3857.
 * @param {number} params.radiusM - Buffer radius in meters.
 * @param {number} [params.limit] - Optional limit override.
 * @returns {Promise<object>} Aggregated offense counts.
 */
export async function fetchTopTypesBuffer({
  start,
  end,
  types,
  center3857,
  radiusM,
  limit,
  signal,
}) {
  const sql = Q.buildTopTypesSQL({
    start,
    end,
    types,
    center3857,
    radiusM,
    limit,
  });
  await logQuery('fetchTopTypesBuffer', sql);
  return admitCrimeResponse('top', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
    signal,
  }));
}

/**
 * Fetch 7x24 heatmap aggregates for buffer A.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {x:number, y:number}} params.center3857 - Buffer center in EPSG:3857.
 * @param {number} params.radiusM - Buffer radius in meters.
 * @returns {Promise<object>} Aggregated hour/day buckets.
 */
export async function fetch7x24Buffer({
  start,
  end,
  types,
  center3857,
  radiusM,
  signal,
}) {
  const sql = Q.buildHeatmap7x24SQL({
    start,
    end,
    types,
    center3857,
    radiusM,
  });
  await logQuery('fetch7x24Buffer', sql);
  return admitCrimeResponse('heat', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
    signal,
  }));
}

/**
 * Fetch crime counts aggregated by police district.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @returns {Promise<object>} Aggregated district totals.
 */
export async function fetchByDistrict({ start, end, types, signal }) {
  const sql = Q.buildByDistrictSQL({ start, end, types });
  await logQuery('fetchByDistrict', sql);
  return admitCrimeResponse('district', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 120_000,
    signal,
  }));
}

/**
 * Top offense types within a district code.
 */
export async function fetchTopTypesByDistrict({ start, end, types, dc_dist, limit = 5, signal }) {
  const sql = Q.buildTopTypesDistrictSQL({ start, end, types, dc_dist, limit });
  await logQuery('fetchTopTypesByDistrict', sql);
  return admitCrimeResponse('top', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 60_000, signal,
  }));
}

/**
 * Fetch 7x24 heat aggregates filtered by a police district.
 */
export async function fetch7x24District({ start, end, types, dc_dist, signal }) {
  const sql = Q.buildHeatmap7x24DistrictSQL({ start, end, types, dc_dist });
  await logQuery('fetch7x24District', sql);
  return admitCrimeResponse('heat', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 60_000, signal,
  }));
}

/**
 * Count incidents within a buffer A for the given time window and optional types.
 * @param {{start:string,end:string,types?:string[],center3857:[number,number]|{x:number,y:number},radiusM:number}} params
 * @returns {Promise<number>} total count
 */
export async function fetchCountBuffer({ start, end, types, center3857, radiusM, signal }) {
  const sql = Q.buildCountBufferSQL({ start, end, types, center3857, radiusM });
  await logQuery('fetchCountBuffer', sql);
  const json = await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 30_000,
    signal,
  });
  const admitted = admitCrimeResponse('count', json);
  return admittedCount(admitted.rows[0].n, 'count');
}

/**
 * Fetch available offense codes for selected groups within time window.
 * Only returns codes that have at least 1 incident in [start, end).
 * @param {{start:string,end:string,groups:string[]}} params
 * @returns {Promise<string[]>} Alphabetized array of available codes
 */
export async function fetchAvailableCodesForGroups({ start, end, groups, signal }) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return [];
  }

  // Expand group keys to offense codes
  const expandedCodes = expandGroupsToCodes(groups);
  if (expandedCodes.length === 0) {
    return [];
  }

  // Build SQL to get distinct codes with incidents in time window
  const startIso = Q.dateFloorGuard(start);
  const endIso = end; // FIX: use the computed end (was: start, creating zero-length window)
  const sanitized = Q.sanitizeTypes(expandedCodes);
  const codeList = sanitized.map((c) => `'${c}'`).join(', ');

  const sql = [
    'SELECT DISTINCT text_general_code',
    'FROM incidents_part1_part2',
    `WHERE dispatch_date_time >= '${startIso}'`,
    `  AND dispatch_date_time < '${endIso}'`,
    `  AND text_general_code IN (${codeList})`,
    'ORDER BY text_general_code',
  ].join('\n');

  await logQuery('fetchAvailableCodesForGroups', sql);
  const json = await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000, // 60s cache
    signal,
  });

  const admitted = admitCrimeResponse('codes', json);
  return admitted.rows.map((row) => row.text_general_code);
}

/**
 * Fetch monthly time series for a census tract (STUB).
 * @param {object} params
 * @param {string} params.start - ISO date
 * @param {string} params.end - ISO date
 * @param {string[]} params.types - Offense codes
 * @param {string} params.tractGEOID - 11-digit census tract GEOID
 * @returns {Promise<{rows: Array<{m: string, n: number}>}>}
 * @throws {Error} Not yet implemented
 */
export async function fetchMonthlySeriesTract({ start, end, types, tractGEOID, signal }) {
  const tracts = await fetchTractsCachedFirst({ signal });
  const pb = getTractPolygonAndBboxByGEOID(tracts, tractGEOID, { decimals: 6 });
  if (!pb) throw new Error(`Tract ${tractGEOID} not found`);
  const sql = Q.buildMonthlyTractSQL({ start, end, types, tractGEOID, tractGeometry: pb.geojsonPolygon4326 });
  await logQuery('fetchMonthlySeriesTract', sql);
  return admitCrimeResponse('monthly', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 90_000, signal,
  }));
}

/**
 * Fetch top N offense types for a census tract (STUB).
 * @param {object} params
 * @param {string} params.start - ISO date
 * @param {string} params.end - ISO date
 * @param {string} params.tractGEOID - 11-digit census tract GEOID
 * @param {number} [params.limit=12] - Max results
 * @returns {Promise<{rows: Array<{text_general_code: string, n: number}>}>}
 * @throws {Error} Not yet implemented
 */
export async function fetchTopTypesTract({ start, end, types, tractGEOID, limit = 12, signal }) {
  const tracts = await fetchTractsCachedFirst({ signal });
  const pb = getTractPolygonAndBboxByGEOID(tracts, tractGEOID, { decimals: 6 });
  if (!pb) throw new Error(`Tract ${tractGEOID} not found`);
  const sql = Q.buildTopTypesTractSQL({ start, end, types, tractGEOID, tractGeometry: pb.geojsonPolygon4326, limit });
  await logQuery('fetchTopTypesTract', sql);
  return admitCrimeResponse('top', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 90_000, signal,
  }));
}

/**
 * Fetch 7x24 heatmap (day-of-week × hour) for a census tract (STUB).
 * @param {object} params
 * @param {string} params.start - ISO date
 * @param {string} params.end - ISO date
 * @param {string[]} params.types - Offense codes
 * @param {string} params.tractGEOID - 11-digit census tract GEOID
 * @returns {Promise<{rows: Array<{dow: number, hr: number, n: number}>}>}
 * @throws {Error} Not yet implemented
 */
export async function fetch7x24Tract({ start, end, types, tractGEOID, signal }) {
  const tracts = await fetchTractsCachedFirst({ signal });
  const pb = getTractPolygonAndBboxByGEOID(tracts, tractGEOID, { decimals: 6 });
  if (!pb) throw new Error(`Tract ${tractGEOID} not found`);
  const sql = Q.buildHeatmap7x24TractSQL({ start, end, types, tractGEOID, tractGeometry: pb.geojsonPolygon4326 });
  await logQuery('fetch7x24Tract', sql);
  return admitCrimeResponse('heat', await fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 90_000, signal,
  }));
}

// Aliases matching request naming
export async function fetchMonthlyTract({ start, end, geoid, codes, signal }) {
  return fetchMonthlySeriesTract({ start, end, types: codes, tractGEOID: geoid, signal });
}
