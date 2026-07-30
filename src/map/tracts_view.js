import { fetchTractsCachedFirst } from "../api/boundaries.js";
import { fetchTractStatsCachedFirst } from "../api/acs.js";
import { tractFeatureGEOID } from "../utils/geoids.js";
import { fetchJson } from "../utils/http.js";
import { publicUrl } from "../utils/public_url.js";
import { TRACT_CRIME_SNAPSHOT_ENABLED } from "../config.js";

/**
 * Merge tract features with ACS stats. Currently uses population as placeholder value,
 * with optional per-10k conversion and masking for population < 500.
 * @param {{per10k?:boolean}} opts
 * @returns {Promise<{geojson: object, values: number[]}>}
 */
export async function getTractsMerged({ per10k = false, windowStart, windowEnd, signal } = {}) {
  const [gj, stats] = await Promise.all([
    fetchTractsCachedFirst({ signal }),
    fetchTractStatsCachedFirst({ signal }),
  ]);
  const map = new Map(stats.map((r) => [r.geoid, r]));
  const values = [];

  // Try to load precomputed tract crime counts if present (new preferred name), fallback to legacy
  let countsMap = null;
  let legendSubtitle = '';
  if (TRACT_CRIME_SNAPSHOT_ENABLED) {
    try {
      let counts = null;
      try {
        counts = await fetchJson(publicUrl('data/tract_crime_counts_last12m.json'), { cacheTTL: 10 * 60_000, retries: 1, timeoutMs: 8000, signal });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw signal?.reason ?? error;
      }
      if (!counts) {
        counts = await fetchJson(publicUrl('data/tract_counts_last12m.json'), { cacheTTL: 10 * 60_000, retries: 1, timeoutMs: 8000, signal });
      }
      if (counts?.rows) {
        const meta = counts.meta || {};
        const matches = windowStart && windowEnd && meta.start === windowStart && meta.end === windowEnd;
        if (matches) {
          countsMap = new Map(counts.rows.map((r) => [r.geoid, Number(r.n) || 0]));
          legendSubtitle = `Citywide tract crime — Last 12 months: ${meta.start} to ${meta.end} (snapshot)`;
        }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw signal?.reason ?? error;
    }
  }

  for (const ft of gj.features || []) {
    const g = tractFeatureGEOID(ft);
    const row = map.get(g);
    let value = 0;
    if (countsMap && countsMap.has(g)) {
      value = countsMap.get(g) || 0;
    } else {
      // No snapshot match → outlines only (keep value at 0)
      value = 0;
    }
    ft.properties.__geoid = g;
    ft.properties.__pop = row?.pop ?? null;
    ft.properties.value = per10k && row?.pop > 0 ? Math.round((value / row.pop) * 10000) : value;
    if (ft.properties.__pop === null || ft.properties.__pop < 500) ft.properties.__mask = true;
    values.push(ft.properties.value ?? 0);
  }

  return { geojson: gj, values, legendSubtitle };
}
