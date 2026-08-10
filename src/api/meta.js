import { CARTO_SQL_BASE } from '../config.js';
import { fetchJson, logQuery } from "../utils/http.js";

export const COVERAGE_SQL = [
  "SELECT MIN(dispatch_date_time AT TIME ZONE 'America/New_York')::date AS min_dt,",
  "       MAX(dispatch_date_time AT TIME ZONE 'America/New_York')::date AS max_dt",
  'FROM incidents_part1_part2',
].join('\n');

function admittedCoverageDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  const date = match?.[1];
  const parsedDate = new Date(`${date || ''}T00:00:00.000Z`);
  const invalidTimestamp = value.includes('T') && Number.isNaN(Date.parse(value));
  return date && !invalidTimestamp && !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === date
    ? date
    : null;
}

export function admitCoverageResponse(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    throw new TypeError('Invalid Crime coverage response: rows must be present as an array');
  }
  if (payload.rows.length !== 1 || !payload.rows[0] || typeof payload.rows[0] !== 'object') {
    throw new TypeError('Invalid Crime coverage response: exactly one coverage row is required');
  }
  const min = admittedCoverageDate(payload.rows[0].min_dt);
  const max = admittedCoverageDate(payload.rows[0].max_dt);
  if (!min || !max || min > max) {
    throw new TypeError('Invalid Crime coverage response: coverage dates are invalid');
  }
  return { min, max };
}

export async function fetchCoverage({ ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const url = CARTO_SQL_BASE;
  const body = new URLSearchParams({ q: COVERAGE_SQL }).toString();
  const t0 = Date.now();
  const json = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cacheTTL: ttlMs,
  });
  await logQuery?.("coverage_sql", `${Date.now() - t0}ms ${url} :: ${COVERAGE_SQL}`);
  return admitCoverageResponse(json);
}

export function clampToCoverage({ start, end }, { min, max }) {
  const s = new Date(start);
  const e = new Date(end);
  const minD = new Date(min);
  const maxD = new Date(max);
  if (e > new Date(maxD.getTime() + 24 * 3600 * 1000)) e.setTime(maxD.getTime() + 24 * 3600 * 1000);
  if (s < minD) s.setTime(minD.getTime());
  return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
}

