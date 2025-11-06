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
  return toGEOID(p.STATE_FIPS, p.COUNTY_FIPS, p.TRACT_FIPS);
}

