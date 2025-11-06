import { PD_GEOJSON, TRACTS_GEOJSON } from "../config.js";
import { fetchGeoJson } from "../utils/http.js";

/**
 * Retrieve police district boundaries.
 * @returns {Promise<object>} GeoJSON FeatureCollection.
 */
export async function fetchPoliceDistricts() {
  return fetchGeoJson(PD_GEOJSON);
}

/**
 * Retrieve census tract boundaries filtered to Philadelphia.
 * @returns {Promise<object>} GeoJSON FeatureCollection.
 */
export async function fetchTracts() {
  return fetchGeoJson(TRACTS_GEOJSON);
}

/**
 * Cache-first loader for police districts: tries local cached copy
 * at "/data/police_districts.geojson" before falling back to remote.
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export async function fetchPoliceDistrictsCachedFirst() {
  // Try cached file served by Vite or static hosting
  try {
    const local = await fetchGeoJson("/data/police_districts.geojson");
    if (
      local &&
      local.type === "FeatureCollection" &&
      Array.isArray(local.features) &&
      local.features.length > 0
    ) {
      return local;
    }
  } catch (_) {
    // swallow and fallback to remote
  }

  // Fallback to live endpoint
  return fetchGeoJson(PD_GEOJSON);
}

/**
 * Cache-first loader for census tracts: tries local cached copy
 * at "/data/tracts_phl.geojson" before falling back to remote.
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export async function fetchTractsCachedFirst() {
  // memoize for session
  if (fetchTractsCachedFirst._cache) return fetchTractsCachedFirst._cache;

  // 1) Try local cache under /public
  try {
    const local = await fetchGeoJson("/data/tracts_phl.geojson", { cacheTTL: 5 * 60_000 });
    if (isValidTracts(local)) {
      fetchTractsCachedFirst._cache = local;
      return local;
    }
  } catch {}

  // 2) Try endpoints in order, normalize props
  const ENDPOINTS = [
    // PASDA - Philadelphia Census Tracts 2020 (preferred - stable, full coverage)
    "https://mapservices.pasda.psu.edu/server/rest/services/pasda/CityPhilly/MapServer/28/query?where=1%3D1&outFields=*&f=geojson",
    // TIGERweb Tracts_Blocks - 2025 vintage (federal, always current)
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=STATE%3D%2742%27%20AND%20COUNTY%3D%27101%27&outFields=STATE,COUNTY,GEOID,NAME,BASENAME,ALAND,AWATER&returnGeometry=true&f=geojson",
  ];
  for (const url of ENDPOINTS) {
    try {
      const raw = await fetchGeoJson(url, { cacheTTL: 10 * 60_000 });
      if (isValidTracts(raw)) {
        const normalized = { type: 'FeatureCollection', features: raw.features.map(normalizeTractFeature) };
        fetchTractsCachedFirst._cache = normalized;
        return normalized;
      }
    } catch {}
  }

  // 3) Fallback to canonical TRACTS_GEOJSON
  const fallback = await fetchGeoJson(TRACTS_GEOJSON, { cacheTTL: 10 * 60_000 });
  fetchTractsCachedFirst._cache = fallback;
  return fallback;
}

function isValidTracts(geo) {
  return geo && geo.type === 'FeatureCollection' && Array.isArray(geo.features) && geo.features.length >= 300;
}

function normalizeTractFeature(f) {
  const p = { ...(f.properties || {}) };

  // Extract components (handle various field names)
  const state = p.STATE_FIPS ?? p.STATE ?? p.STATEFP ?? '42';
  const county = p.COUNTY_FIPS ?? p.COUNTY ?? p.COUNTYFP ?? '101';
  const tract = p.TRACT_FIPS ?? p.TRACT ?? p.TRACTCE ?? null;

  // Derive GEOID (11-digit: STATE(2) + COUNTY(3) + TRACT(6))
  let geoid = p.GEOID ?? null;
  if (!geoid && state && county && tract) {
    const statePad = String(state).padStart(2, '0');
    const countyPad = String(county).padStart(3, '0');
    const tractPad = String(tract).padStart(6, '0');
    geoid = `${statePad}${countyPad}${tractPad}`;
  }

  return {
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      GEOID: geoid,
      STATE: state,
      COUNTY: county,
      TRACT: tract,
      NAME: p.NAME ?? p.NAMELSAD ?? p.BASENAME ?? '',
      ALAND: p.ALAND ?? null,
      AWATER: p.AWATER ?? null,
    },
  };
}
