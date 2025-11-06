import { fetchJson, logQuery } from "../utils/http.js";

const SQL = "SELECT MIN(dispatch_date_time)::date AS min_dt, MAX(dispatch_date_time)::date AS max_dt FROM incidents_part1_part2";

export async function fetchCoverage({ ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const url = "https://phl.carto.com/api/v2/sql";
  const body = new URLSearchParams({ q: SQL }).toString();
  const t0 = Date.now();
  const json = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cacheTTL: ttlMs,
  });
  await logQuery?.("coverage_sql", `${Date.now() - t0}ms ${url} :: ${SQL}`);
  const row = json?.rows?.[0] || {};
  return { min: row.min_dt, max: row.max_dt };
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

