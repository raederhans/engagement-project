import {
  PD_GEOJSON,
  PROJECT_REGION,
  TRACT_GEOJSON_ENDPOINTS,
  TRACTS_GEOJSON,
} from '../config.js';
import { fetchGeoJson } from '../utils/http.js';
import { publicUrl } from '../utils/public_url.js';

const POLICE_DISTRICTS_FALLBACK = publicUrl('data/police_districts.geojson');
const TRACTS_FALLBACK = publicUrl('data/tracts_phl.geojson');

/** Retrieve live police district boundaries. */
export async function fetchPoliceDistricts({ signal } = {}) {
  const raw = await fetchGeoJson(PD_GEOJSON, {
    cacheTTL: 10 * 60_000,
    retries: 0,
    timeoutMs: 5000,
    signal,
  });
  if (!isValidPoliceDistricts(raw)) {
    throw new Error('Police district API returned an invalid FeatureCollection.');
  }
  return raw;
}

/** Retrieve live census tract boundaries from the canonical configured endpoint. */
export async function fetchTracts({ signal } = {}) {
  const raw = await fetchGeoJson(TRACTS_GEOJSON, {
    cacheTTL: 10 * 60_000,
    retries: 0,
    timeoutMs: 5000,
    signal,
  });
  if (!isValidTracts(raw)) {
    throw new Error('Census tract API returned an invalid FeatureCollection.');
  }
  return normalizeTracts(raw);
}

/**
 * Prefer the live City endpoint and use the bundled copy only when the API is
 * unavailable or malformed.
 */
export async function fetchPoliceDistrictsPreferred({ signal, onSourceResolved } = {}) {
  throwIfAborted(signal);
  try {
    const live = await fetchPoliceDistricts({ signal });
    reportResolvedSource(onSourceResolved, {
      dataset: 'police-districts',
      kind: 'live',
      provider: 'Philadelphia Police GIS',
      url: PD_GEOJSON,
      cacheHit: false,
    });
    return live;
  } catch (liveError) {
    if (isCancellation(liveError, signal)) throw cancellationReason(liveError, signal);
    const local = await fetchGeoJson(POLICE_DISTRICTS_FALLBACK, {
      cacheTTL: 5 * 60_000,
      retries: 0,
      signal,
    });
    if (!isValidPoliceDistricts(local)) {
      throw new AggregateError(
        [liveError],
        'Neither the live nor bundled police district source is valid.',
      );
    }
    reportResolvedSource(onSourceResolved, {
      dataset: 'police-districts',
      kind: 'fallback',
      provider: 'Bundled boundary snapshot',
      url: POLICE_DISTRICTS_FALLBACK,
      cacheHit: false,
    });
    return local;
  }
}

/**
 * Prefer official/current tract APIs, then use the bundled geometry as a
 * resilience fallback. Successful data is memoized for the browser session.
 */
export async function fetchTractsPreferred({ signal, onSourceResolved } = {}) {
  throwIfAborted(signal);
  if (fetchTractsPreferred._cache) {
    if (fetchTractsPreferred._cacheMeta) {
      reportResolvedSource(onSourceResolved, {
        ...fetchTractsPreferred._cacheMeta,
        cacheHit: true,
      });
    }
    return fetchTractsPreferred._cache;
  }

  const errors = [];
  for (const url of TRACT_GEOJSON_ENDPOINTS) {
    try {
      const raw = await fetchGeoJson(url, {
        cacheTTL: 10 * 60_000,
        retries: 0,
        timeoutMs: 5000,
        signal,
      });
      if (!isValidTracts(raw)) {
        throw new Error(`Tract source returned fewer than 300 features: ${url}`);
      }
      const normalized = normalizeTracts(raw);
      const sourceMeta = {
        dataset: 'census-tract-boundaries',
        kind: 'live',
        provider: 'Official tract boundary API',
        url,
        cacheHit: false,
      };
      fetchTractsPreferred._cache = normalized;
      fetchTractsPreferred._cacheMeta = sourceMeta;
      reportResolvedSource(onSourceResolved, sourceMeta);
      return normalized;
    } catch (error) {
      if (isCancellation(error, signal)) throw cancellationReason(error, signal);
      errors.push(error);
    }
  }

  try {
    const local = await fetchGeoJson(TRACTS_FALLBACK, {
      cacheTTL: 5 * 60_000,
      retries: 0,
      signal,
    });
    if (!isValidTracts(local)) {
      throw new Error('Bundled tract fallback is invalid.');
    }
    const normalized = normalizeTracts(local);
    const sourceMeta = {
      dataset: 'census-tract-boundaries',
      kind: 'fallback',
      provider: 'Bundled tract snapshot',
      url: TRACTS_FALLBACK,
      cacheHit: false,
    };
    fetchTractsPreferred._cache = normalized;
    fetchTractsPreferred._cacheMeta = sourceMeta;
    reportResolvedSource(onSourceResolved, sourceMeta);
    return normalized;
  } catch (error) {
    if (isCancellation(error, signal)) throw cancellationReason(error, signal);
    errors.push(error);
    throw new AggregateError(errors, 'No valid census tract source is available.');
  }
}

// Compatibility aliases for existing callers. Their behavior is now API-first.
export const fetchPoliceDistrictsCachedFirst = fetchPoliceDistrictsPreferred;
export const fetchTractsCachedFirst = fetchTractsPreferred;

function isValidPoliceDistricts(geo) {
  return geo?.type === 'FeatureCollection' &&
    Array.isArray(geo.features) &&
    geo.features.length >= 20;
}

function isValidTracts(geo) {
  return geo?.type === 'FeatureCollection' &&
    Array.isArray(geo.features) &&
    geo.features.length >= 300;
}

function normalizeTracts(raw) {
  return {
    type: 'FeatureCollection',
    features: raw.features.map(normalizeTractFeature),
  };
}

function normalizeTractFeature(feature) {
  const properties = { ...(feature.properties || {}) };
  const state = properties.STATE_FIPS ?? properties.STATE ?? properties.STATEFP ?? PROJECT_REGION.stateFips;
  const county = properties.COUNTY_FIPS ?? properties.COUNTY ?? properties.COUNTYFP ?? PROJECT_REGION.countyFips;
  const tract = properties.TRACT_FIPS ?? properties.TRACT ?? properties.TRACTCE ?? null;

  let geoid = properties.GEOID ?? properties.FIPS ?? null;
  if (!geoid && state && county && tract) {
    geoid = `${String(state).padStart(2, '0')}${String(county).padStart(3, '0')}${String(tract).padStart(6, '0')}`;
  }

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      GEOID: geoid,
      STATE: state,
      COUNTY: county,
      TRACT: tract,
      NAME: properties.NAME ?? properties.NAMELSAD ?? properties.BASENAME ?? '',
      ALAND: properties.ALAND ?? properties.AREALAND ?? null,
      AWATER: properties.AWATER ?? properties.AREAWATER ?? null,
    },
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw cancellationReason(undefined, signal);
}

function isCancellation(error, signal) {
  return Boolean(signal?.aborted || error?.name === 'AbortError');
}

function cancellationReason(error, signal) {
  return signal?.reason ?? error ?? new DOMException('The operation was aborted.', 'AbortError');
}

function reportResolvedSource(callback, metadata) {
  if (typeof callback !== 'function') return;
  try {
    callback({ ...metadata });
  } catch {}
}
