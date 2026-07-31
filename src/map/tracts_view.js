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
export async function getTractsMerged({ per10k = false, windowStart, windowEnd, types = [], signal } = {}) {
  const [gj, stats] = await Promise.all([
    fetchTractsCachedFirst({ signal }),
    fetchTractStatsCachedFirst({ signal }),
  ]);
  let snapshot = null;
  if (TRACT_CRIME_SNAPSHOT_ENABLED) {
    try {
      snapshot = await fetchJson(publicUrl('data/tract_crime_counts_last12m.json'), {
        cacheTTL: 10 * 60_000,
        retries: 1,
        timeoutMs: 8000,
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw signal?.reason ?? error;
    }
  }

  return mergeTractSnapshotData({
    tracts: gj,
    stats,
    snapshot,
    start: windowStart,
    end: windowEnd,
    types,
    per10k,
  });
}

export function mergeTractSnapshotData({ tracts, stats, snapshot, start, end, types = [], per10k = false }) {
  const populationByGeoid = new Map(stats.map((row) => [row.geoid, row]));
  const tractFeatures = tracts.features || [];
  const tractGeoids = tractFeatures.map(tractFeatureGEOID);
  const snapshotGeoids = Array.isArray(snapshot?.rows) ? snapshot.rows.map((row) => String(row.geoid || '')) : [];
  const uniqueTractGeoids = new Set(tractGeoids);
  const uniqueSnapshotGeoids = new Set(snapshotGeoids);
  const exactGeography = tractFeatures.length > 0
    && tractGeoids.length === tractFeatures.length
    && tractGeoids.every((geoid) => /^\d{11}$/.test(geoid))
    && uniqueTractGeoids.size === tractFeatures.length
    && snapshotGeoids.length === tractGeoids.length
    && snapshotGeoids.every((geoid) => /^\d{11}$/.test(geoid))
    && uniqueSnapshotGeoids.size === snapshotGeoids.length
    && tractGeoids.every((geoid) => uniqueSnapshotGeoids.has(geoid))
    && snapshotGeoids.every((geoid) => uniqueTractGeoids.has(geoid));
  const matches = snapshot?.meta?.schema_version === 2
    && snapshot?.meta?.start === start
    && snapshot?.meta?.end === end
    && Array.isArray(snapshot?.rows)
    && Number(snapshot?.meta?.row_count) === snapshot.rows.length
    && exactGeography;
  const selectedTypes = new Set(types || []);
  const rowByGeoid = matches
    ? new Map(snapshot.rows.map((row) => [row.geoid, row]))
    : new Map();
  const values = [];

  for (const ft of tracts.features || []) {
    const g = tractFeatureGEOID(ft);
    const populationRow = populationByGeoid.get(g);
    const crimeRow = rowByGeoid.get(g);
    const rawValue = matches && crimeRow
      ? (selectedTypes.size
        ? (crimeRow.offenses || []).reduce(
          (sum, offense) => sum + (selectedTypes.has(offense.code) ? Number(offense.n) || 0 : 0),
          0,
        )
        : Number(crimeRow.total) || 0)
      : null;
    ft.properties.__geoid = g;
    ft.properties.__pop = populationRow?.pop ?? null;
    ft.properties.value = rawValue == null
      ? null
      : (per10k && populationRow?.pop > 0
        ? Math.round((rawValue / populationRow.pop) * 10000)
        : rawValue);
    if (ft.properties.__pop === null || ft.properties.__pop < 500) ft.properties.__mask = true;
    if (ft.properties.value != null) values.push(ft.properties.value);
  }

  const dataStatus = matches ? 'available' : 'unavailable';
  const statusMessage = matches
    ? ''
    : (snapshot
      ? (snapshot?.meta?.start === start && snapshot?.meta?.end === end
        ? 'Tract snapshot geography does not match the current tract boundaries.'
        : `Tract snapshot does not cover [${start}, ${end}).`)
      : 'Tract snapshot is unavailable in this build.');
  const filterLabel = selectedTypes.size ? ` · ${selectedTypes.size} selected offense${selectedTypes.size === 1 ? '' : 's'}` : ' · all offenses';
  return {
    geojson: tracts,
    values: dataStatus === 'available' ? values : [],
    dataStatus,
    statusMessage,
    legendSubtitle: matches
      ? `Citywide tract crime: ${snapshot.meta.start} to ${snapshot.meta.end}${filterLabel} (validated snapshot)`
      : '',
  };
}
