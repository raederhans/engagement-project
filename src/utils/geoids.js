/**
 * Build full 11-digit GEOID for tract.
 * @param {string} state
 * @param {string} county
 * @param {string} tract6
 */
export function toGEOID(state = '42', county = '101', tract6) {
  return `${state}${county}${String(tract6 ?? '').padStart(6, '0')}`;
}

/**
 * Derive GEOID from an Esri-style tract feature with STATE_FIPS, COUNTY_FIPS, TRACT_FIPS.
 * @param {any} f
 */
export function tractFeatureGEOID(f) {
  const p = f?.properties || {};
  const explicit = p.GEOID ?? p.GEOID20 ?? p.TRACT_GEOID ?? p.FIPS;
  if (explicit != null && /^\d{11}$/.test(String(explicit))) {
    return String(explicit);
  }

  const state = p.STATE_FIPS ?? p.STATE ?? p.STATEFP;
  const county = p.COUNTY_FIPS ?? p.COUNTY ?? p.COUNTYFP;
  const tract = p.TRACT_FIPS ?? p.TRACT ?? p.TRACTCE;
  if (state == null || county == null || tract == null) return '';
  return toGEOID(state, county, tract);
}

