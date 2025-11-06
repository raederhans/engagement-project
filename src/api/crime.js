import { CARTO_SQL_BASE } from "../config.js";
import { fetchJson, logQuery } from "../utils/http.js";
import * as Q from "../utils/sql.js";
import { expandGroupsToCodes } from "../utils/types.js";
import { fetchTractsCachedFirst } from "./boundaries.js";
import { getTractPolygonAndBboxByGEOID } from "../utils/tract_geom.js";

/**
 * Fetch crime point features for Map A.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @param {number[] | {xmin:number, ymin:number, xmax:number, ymax:number}} [params.bbox] - Map bounding box in EPSG:3857.
 * @returns {Promise<object>} GeoJSON FeatureCollection.
 */
export async function fetchPoints({ start, end, types, bbox, dc_dist }) {
  const sql = Q.buildCrimePointsSQL({ start, end, types, bbox, dc_dist });
  await logQuery('fetchPoints', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `format=GeoJSON&q=${encodeURIComponent(sql)}`,
    cacheTTL: 30_000,
  });
}

/**
 * Fetch citywide monthly totals.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @returns {Promise<object>} Aggregated results keyed by month.
 */
export async function fetchMonthlySeriesCity({ start, end, types, dc_dist }) {
  const sql = Q.buildMonthlyCitySQL({ start, end, types, dc_dist });
  await logQuery('fetchMonthlySeriesCity', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 300_000,
  });
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
}) {
  const sql = Q.buildMonthlyBufferSQL({
    start,
    end,
    types,
    center3857,
    radiusM,
  });
  await logQuery('fetchMonthlySeriesBuffer', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
  });
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
  center3857,
  radiusM,
  limit,
}) {
  const sql = Q.buildTopTypesSQL({
    start,
    end,
    center3857,
    radiusM,
    limit,
  });
  await logQuery('fetchTopTypesBuffer', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
  });
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
}) {
  const sql = Q.buildHeatmap7x24SQL({
    start,
    end,
    types,
    center3857,
    radiusM,
  });
  await logQuery('fetch7x24Buffer', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 60_000,
  });
}

/**
 * Fetch crime counts aggregated by police district.
 * @param {object} params
 * @param {string} params.start - Inclusive ISO start datetime.
 * @param {string} params.end - Exclusive ISO end datetime.
 * @param {string[]} [params.types] - Optional offense filters.
 * @returns {Promise<object>} Aggregated district totals.
 */
export async function fetchByDistrict({ start, end, types }) {
  const sql = Q.buildByDistrictSQL({ start, end, types });
  await logQuery('fetchByDistrict', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 120_000,
  });
}

/**
 * Top offense types within a district code.
 */
export async function fetchTopTypesByDistrict({ start, end, types, dc_dist, limit = 5 }) {
  const sql = Q.buildTopTypesDistrictSQL({ start, end, types, dc_dist, limit });
  await logQuery('fetchTopTypesByDistrict', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 60_000,
  });
}

/**
 * Fetch 7x24 heat aggregates filtered by a police district.
 */
export async function fetch7x24District({ start, end, types, dc_dist }) {
  const sql = Q.buildHeatmap7x24DistrictSQL({ start, end, types, dc_dist });
  await logQuery('fetch7x24District', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 60_000,
  });
}

/**
 * Count incidents within a buffer A for the given time window and optional types.
 * @param {{start:string,end:string,types?:string[],center3857:[number,number]|{x:number,y:number},radiusM:number}} params
 * @returns {Promise<number>} total count
 */
export async function fetchCountBuffer({ start, end, types, center3857, radiusM }) {
  const sql = Q.buildCountBufferSQL({ start, end, types, center3857, radiusM });
  await logQuery('fetchCountBuffer', sql);
  const json = await fetchJson(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 30_000,
  });
  const rows = json?.rows;
  const n = Array.isArray(rows) && rows.length > 0 ? Number(rows[0]?.n) || 0 : 0;
  return n;
}

/**
 * Fetch available offense codes for selected groups within time window.
 * Only returns codes that have at least 1 incident in [start, end).
 * @param {{start:string,end:string,groups:string[]}} params
 * @returns {Promise<string[]>} Alphabetized array of available codes
 */
export async function fetchAvailableCodesForGroups({ start, end, groups }) {
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
  });

  const rows = json?.rows || [];
  return rows.map((r) => r.text_general_code).filter(Boolean);
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
export async function fetchMonthlySeriesTract({ start, end, types, tractGEOID }) {
  const tracts = await fetchTractsCachedFirst();
  const pb = getTractPolygonAndBboxByGEOID(tracts, tractGEOID, { decimals: 6 });
  if (!pb) throw new Error(`Tract ${tractGEOID} not found`);
  const sql = Q.buildMonthlyTractSQL({ start, end, types, tractGEOID, tractGeometry: pb.geojsonPolygon4326 });
  await logQuery('fetchMonthlySeriesTract', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 90_000,
  });
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
export async function fetchTopTypesTract({ start, end, types, tractGEOID, limit = 12 }) {
  const tracts = await fetchTractsCachedFirst();
  const pb = getTractPolygonAndBboxByGEOID(tracts, tractGEOID, { decimals: 6 });
  if (!pb) throw new Error(`Tract ${tractGEOID} not found`);
  const sql = Q.buildTopTypesTractSQL({ start, end, types, tractGEOID, tractGeometry: pb.geojsonPolygon4326, limit });
  await logQuery('fetchTopTypesTract', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 90_000,
  });
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
export async function fetch7x24Tract({ start, end, types, tractGEOID }) {
  const tracts = await fetchTractsCachedFirst();
  const pb = getTractPolygonAndBboxByGEOID(tracts, tractGEOID, { decimals: 6 });
  if (!pb) throw new Error(`Tract ${tractGEOID} not found`);
  const sql = Q.buildHeatmap7x24TractSQL({ start, end, types, tractGEOID, tractGeometry: pb.geojsonPolygon4326 });
  await logQuery('fetch7x24Tract', sql);
  return fetchJson(CARTO_SQL_BASE, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `q=${encodeURIComponent(sql)}`, cacheTTL: 90_000,
  });
}

// Aliases matching request naming
export async function fetchMonthlyTract({ start, end, geoid, codes }) {
  return fetchMonthlySeriesTract({ start, end, types: codes, tractGEOID: geoid });
}
