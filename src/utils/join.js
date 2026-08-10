/**
 * Left-pad a value to two characters with leading zero.
 * @param {string|number} s
 * @returns {string}
 */
export function leftPad2(s) {
  return s?.toString().padStart(2, "0");
}

/**
 * Join district counts to a GeoJSON FeatureCollection in a non-destructive way.
 * rows: [{ dc_dist: '01', n: <int> }]
 * Adds/overwrites feature.properties.value with the matching count (or 0 if missing).
 * @param {object} districts - GeoJSON FeatureCollection with DIST_NUMC property on features.
 * @param {Array<{dc_dist:string|number,n:number}>} rows - Aggregated counts by dc_dist.
 * @returns {object} New FeatureCollection with joined values.
 */
export function joinDistrictCountsToGeoJSON(districts, rows) {
  const out = { ...districts, features: [] };
  const map = new Map();
  if (!Array.isArray(rows)) throw new TypeError('Invalid district rows: rows must be an array');
  for (const row of rows) {
    const rawDistrict = String(row?.dc_dist ?? '');
    if (!/^\d{1,2}$/.test(rawDistrict) || Number(rawDistrict) < 1 || Number(rawDistrict) > 99) {
      throw new TypeError('Invalid district row: district must be a one- or two-digit positive code');
    }
    const key = leftPad2(rawDistrict);
    const rawCount = row?.n;
    const count = typeof rawCount === 'string' && /^\d+$/.test(rawCount) ? Number(rawCount) : rawCount;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError('Invalid district row: count must be a non-negative safe integer');
    }
    if (map.has(key)) throw new TypeError(`Invalid district rows: duplicate district ${key}`);
    map.set(key, count);
  }

  if (!districts || districts.type !== "FeatureCollection" || !Array.isArray(districts.features)) {
    return out;
  }

  out.features = districts.features.map((feat) => {
    const props = { ...(feat?.properties || {}) };
    const key = leftPad2(props.DIST_NUMC);
    const value = key ? (map.get(key) ?? 0) : 0;
    return { ...feat, properties: { ...props, value } };
  });

  return out;
}

