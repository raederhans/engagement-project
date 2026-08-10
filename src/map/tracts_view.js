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
export async function getTractsMerged({
  per10k = false,
  windowStart,
  windowEnd,
  types = [],
  signal,
  onSourceResolved,
} = {}) {
  const [gj, stats] = await Promise.all([
    fetchTractsCachedFirst({ signal, onSourceResolved }),
    fetchTractStatsCachedFirst({ signal, onSourceResolved }),
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

function geographyIdentity(geoids) {
  const value = [...geoids].sort().join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${geoids.length}:${hash.toString(16).padStart(8, '0')}`;
}

function boundedText(value, maxLength) {
  return typeof value === 'string' && value.trim() && value.length <= maxLength ? value : null;
}

function boundedDate(value) {
  const text = boundedText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return null;
  try {
    return new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text ? text : null;
  } catch {
    return null;
  }
}

function snapshotProvenance(meta, geoids) {
  const generatedAt = boundedText(meta?.generated_at, 64);
  const coverageDate = boundedDate(meta?.coverage_date);
  const start = boundedDate(meta?.start);
  const end = boundedDate(meta?.end);
  const rowCount = meta?.row_count;
  const sourceDataset = boundedText(meta?.source_dataset, 160);
  const tractSource = boundedText(meta?.tract_source, 240);
  const parsedGeneratedAt = new Date(generatedAt || '');
  if (
    !generatedAt || Number.isNaN(parsedGeneratedAt.getTime()) || parsedGeneratedAt.toISOString() !== generatedAt
    || !coverageDate || !start || !end
    || start >= end || coverageDate < start || coverageDate >= end
    || generatedAt.slice(0, 10) < coverageDate
    || !Number.isInteger(rowCount) || rowCount < 1 || rowCount > 100_000
    || !sourceDataset || !tractSource
  ) return null;
  return {
    schemaVersion: meta.schema_version,
    start,
    end,
    generatedAt,
    coverageDate,
    rowCount,
    sourceDataset,
    tractSource,
    geographyIdentity: geographyIdentity(geoids),
  };
}

function snapshotCount(value) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function snapshotRowsAreAdmitted(rows) {
  if (!Array.isArray(rows)) return false;
  return rows.every((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.geoid !== 'string' || !/^\d{11}$/.test(row.geoid)
      || snapshotCount(row.total) == null || !Array.isArray(row.offenses)) return false;
    const offenseCodes = new Set();
    return row.offenses.every((offense) => {
      if (!offense || typeof offense !== 'object' || Array.isArray(offense)
        || typeof offense.code !== 'string' || !offense.code.trim() || offense.code.length > 240
        || offenseCodes.has(offense.code) || snapshotCount(offense.n) == null) return false;
      offenseCodes.add(offense.code);
      return true;
    });
  });
}

export function mergeTractSnapshotData({ tracts, stats, snapshot, start, end, types = [], per10k = false }) {
  const populationByGeoid = new Map(stats.map((row) => [row.geoid, row]));
  const tractFeatures = Array.isArray(tracts?.features) ? tracts.features : [];
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
  const provenance = snapshotProvenance(snapshot?.meta, tractGeoids);
  const matches = snapshot?.meta?.schema_version === 2
    && snapshot?.meta?.start === start
    && snapshot?.meta?.end === end
    && Array.isArray(snapshot?.rows)
    && snapshot?.meta?.row_count === snapshot.rows.length
    && provenance != null
    && exactGeography
    && snapshotRowsAreAdmitted(snapshot.rows);
  const selectedTypes = new Set(types || []);
  const rowByGeoid = matches
    ? new Map(snapshot.rows.map((row) => [row.geoid, row]))
    : new Map();
  const values = [];

  const enrichedFeatures = tractFeatures.map((ft) => {
    const g = tractFeatureGEOID(ft);
    const populationRow = populationByGeoid.get(g);
    const crimeRow = rowByGeoid.get(g);
    const rawValue = matches && crimeRow
      ? (selectedTypes.size
        ? crimeRow.offenses.reduce(
          (sum, offense) => sum + (selectedTypes.has(offense.code) ? snapshotCount(offense.n) : 0),
          0,
        )
        : snapshotCount(crimeRow.total))
      : null;
    const properties = { ...(ft?.properties || {}) };
    properties.__geoid = g;
    const population = populationRow?.population ?? null;
    properties.__population = population ? structuredClone(population) : null;
    properties.__pop = population?.estimate ?? populationRow?.pop ?? null;
    properties.__popMoe90 = population?.moe90 ?? null;
    properties.__popVintage = population?.vintage ?? null;
    properties.__popSource = population?.source ?? null;
    properties.__popRetrievedAt = population?.retrievedAt ?? null;
    properties.__popStatus = population?.status ?? (properties.__pop == null ? 'unavailable' : 'partial');
    properties.value = rawValue == null
      ? null
      : (per10k
        ? (properties.__pop > 0 ? Math.round((rawValue / properties.__pop) * 10000) : null)
        : rawValue);
    if (properties.__pop === null || properties.__pop < 500) properties.__mask = true;
    else delete properties.__mask;
    if (properties.value != null) values.push(properties.value);
    return { ...ft, properties };
  });

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
    geojson: { ...tracts, features: enrichedFeatures },
    values: dataStatus === 'available' ? values : [],
    dataStatus,
    provenance: matches ? provenance : null,
    statusMessage,
    legendSubtitle: matches
      ? `Citywide tract crime: ${snapshot.meta.start} to ${snapshot.meta.end}${filterLabel} (validated snapshot)`
      : '',
  };
}
