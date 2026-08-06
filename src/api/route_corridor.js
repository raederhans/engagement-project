import { CARTO_SQL_BASE } from '../config.js';
import { fetchJson } from '../utils/http.js';
import { buildRouteCorridorEnvelopeSQL } from '../utils/sql.js';

/**
 * Fetch one internally consistent candidate envelope. Route-derived requests
 * deliberately bypass query logging, cache, inflight sharing, and retry logs.
 */
export async function fetchRouteCorridorEnvelope({
  start,
  end,
  types,
  drilldownCodes,
  bbox,
  signal,
}, { request = fetchJson } = {}) {
  const sql = buildRouteCorridorEnvelopeSQL({ start, end, types, drilldownCodes, bbox });
  const json = await request(CARTO_SQL_BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `q=${encodeURIComponent(sql)}`,
    cacheTTL: 0,
    retries: 0,
    signal,
  });
  if (!Array.isArray(json?.rows) || json.rows.length !== 1
    || !json.rows[0]?.envelope || typeof json.rows[0].envelope !== 'object') {
    throw new Error('Route corridor source returned an invalid envelope.');
  }
  return json.rows[0].envelope;
}
