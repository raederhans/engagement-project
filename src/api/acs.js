import { ACS_API_ENDPOINTS, CENSUS_REPORTER_ACS_URL } from '../config.js';
import { fetchJson } from '../utils/http.js';

const ACS_LOCAL_URL = new URL('../data/acs_tracts_2023_pa101.json', import.meta.url).href;

/**
 * Fetch and normalize tract metrics from Census-compatible live endpoints.
 */
export async function fetchTractStats({
  endpoints = ACS_API_ENDPOINTS,
  fetchJsonImpl = fetchJson,
} = {}) {
  if (!endpoints?.population || !endpoints?.poverty) {
    throw new Error('ACS live endpoints are not configured.');
  }

  const [populationRows, povertyRows] = await Promise.all([
    fetchJsonImpl(endpoints.population),
    fetchJsonImpl(endpoints.poverty),
  ]);

  return normalizeAcsRows(populationRows, povertyRows);
}

/**
 * Prefer explicitly configured live ACS endpoints. A bundled 2023 snapshot is
 * retained as the safe fallback because the public Census API now requires a
 * key and GitHub Pages cannot keep that credential private.
 */
export async function fetchTractStatsPreferred({
  endpoints = ACS_API_ENDPOINTS,
  reporterUrl = CENSUS_REPORTER_ACS_URL,
  localUrl = ACS_LOCAL_URL,
  fetchJsonImpl = fetchJson,
} = {}) {
  const liveErrors = [];
  if (endpoints?.population && endpoints?.poverty) {
    try {
      const live = await fetchTractStats({ endpoints, fetchJsonImpl });
      if (isValidNormalizedRows(live)) return live;
      liveErrors.push(new Error('ACS live endpoints returned no valid tract rows.'));
    } catch (error) {
      liveErrors.push(error);
    }
  }

  if (reporterUrl) {
    try {
      const reporterRows = await fetchTractStatsFromCensusReporter({
        url: reporterUrl,
        fetchJsonImpl,
      });
      if (isValidNormalizedRows(reporterRows)) return reporterRows;
      liveErrors.push(new Error('Census Reporter returned no valid tract rows.'));
    } catch (error) {
      liveErrors.push(error);
    }
  }

  try {
    const snapshot = await fetchJsonImpl(localUrl, {
      timeoutMs: 8000,
      retries: 1,
    });
    if (!isValidNormalizedRows(snapshot)) {
      throw new Error('Bundled ACS snapshot is invalid.');
    }
    return snapshot;
  } catch (snapshotError) {
    throw new AggregateError(
      [...liveErrors, snapshotError],
      'No valid ACS tract data source is available.',
    );
  }
}

/** Normalize Census Reporter's keyless ACS table response. */
export async function fetchTractStatsFromCensusReporter({
  url = CENSUS_REPORTER_ACS_URL,
  fetchJsonImpl = fetchJson,
} = {}) {
  if (!url) throw new Error('Census Reporter URL is not configured.');
  const payload = await fetchJsonImpl(url, {
    timeoutMs: 20_000,
    retries: 1,
    cacheTTL: 24 * 60 * 60_000,
  });
  const data = payload?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Census Reporter response is missing tract data.');
  }

  return Object.entries(data).flatMap(([reporterGeoid, tables]) => {
    const geoid = String(reporterGeoid).replace(/^14000US/, '');
    if (!/^\d{11}$/.test(geoid)) return [];

    const population = estimate(tables, 'B01003', 'B01003001');
    const renterTotal = estimate(tables, 'B25003', 'B25003001');
    const renterCount = estimate(tables, 'B25003', 'B25003003');
    const medianIncome = estimate(tables, 'B19013', 'B19013001');
    const povertyUniverse = estimate(tables, 'B17001', 'B17001001');
    const belowPoverty = estimate(tables, 'B17001', 'B17001002');
    const povertyPct = povertyUniverse > 0 && belowPoverty !== null
      ? Number(((belowPoverty / povertyUniverse) * 100).toFixed(1))
      : null;

    return [{
      geoid,
      pop: population,
      renter_total: renterTotal,
      renter_count: renterCount,
      median_income: medianIncome,
      poverty_pct: povertyPct,
    }];
  });
}

// Compatibility alias for existing callers. Its behavior is now explicit.
export const fetchTractStatsCachedFirst = fetchTractStatsPreferred;

function normalizeAcsRows(populationRows, povertyRows) {
  if (!Array.isArray(populationRows) || populationRows.length < 2) {
    throw new Error('ACS population/tenure endpoint returned no rows.');
  }

  const [populationHeader, ...populationRecords] = populationRows;
  const populationIndex = indexLookup(
    populationHeader,
    [
      'B01003_001E',
      'B25003_001E',
      'B25003_003E',
      'B19013_001E',
      'state',
      'county',
      'tract',
    ],
    'ACS population/tenure',
  );

  const povertyByGeoid = new Map();
  if (Array.isArray(povertyRows) && povertyRows.length > 1) {
    const [povertyHeader, ...povertyRecords] = povertyRows;
    const povertyIndex = indexLookup(
      povertyHeader,
      ['S1701_C03_001E', 'state', 'county', 'tract'],
      'ACS poverty',
    );

    for (const row of povertyRecords) {
      const geoid = buildGeoid(
        row[povertyIndex.state],
        row[povertyIndex.county],
        row[povertyIndex.tract],
      );
      const povertyPct = toNumber(row[povertyIndex.S1701_C03_001E]);
      if (geoid && povertyPct !== null) povertyByGeoid.set(geoid, povertyPct);
    }
  }

  return populationRecords.flatMap((row) => {
    const geoid = buildGeoid(
      row[populationIndex.state],
      row[populationIndex.county],
      row[populationIndex.tract],
    );
    if (!geoid) return [];

    return [{
      geoid,
      pop: toNumber(row[populationIndex.B01003_001E]),
      renter_total: toNumber(row[populationIndex.B25003_001E]),
      renter_count: toNumber(row[populationIndex.B25003_003E]),
      median_income: toNumber(row[populationIndex.B19013_001E]),
      poverty_pct: povertyByGeoid.get(geoid) ?? null,
    }];
  });
}

function isValidNormalizedRows(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.every((row) => {
    return typeof row?.geoid === 'string' && /^\d{11}$/.test(row.geoid);
  });
}

function indexLookup(header, keys, label) {
  if (!Array.isArray(header)) {
    throw new Error(`Expected header array for ${label}.`);
  }

  const lookups = {};
  for (const key of keys) {
    const index = header.indexOf(key);
    if (index === -1) throw new Error(`Missing ${key} column in ${label}.`);
    lookups[key] = index;
  }
  return lookups;
}

function buildGeoid(state, county, tract) {
  if (!state || !county || !tract) return '';
  return `${state}${county}${tract}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function estimate(tables, tableId, columnId) {
  return toNumber(tables?.[tableId]?.estimate?.[columnId]);
}
