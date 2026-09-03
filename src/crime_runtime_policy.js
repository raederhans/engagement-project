export const CRIME_RUNTIME_KINDS = Object.freeze({
  PUBLIC_AREA: 'public-area',
  TRANSIENT_BUFFER: 'transient-buffer',
  IDLE_BUFFER: 'idle-buffer',
});

export function containsPrivateCrimeLocation(source) {
  if (!source || typeof source !== 'object') return false;
  return Boolean(source.centerLonLat)
    || Boolean(source.centerBLonLat)
    || Boolean(source.center3857)
    || Boolean(source.centerB3857)
    || Boolean(String(source.addressA || '').trim())
    || Boolean(String(source.addressB || '').trim());
}

/**
 * Crime buffer locations are usable only for the current runtime session.
 * They remain excluded from URL/history/artifacts/export by their owning ports.
 */
export function classifyCrimeRuntime(source) {
  if (source?.queryMode === 'district' || source?.queryMode === 'tract') {
    return Object.freeze({
      kind: CRIME_RUNTIME_KINDS.PUBLIC_AREA,
      hasSelection: Boolean(source.queryMode === 'district'
        ? source.selectedDistrictCode
        : source.selectedTractGEOID),
      transientLocation: false,
    });
  }
  const hasSelection = containsPrivateCrimeLocation(source);
  return Object.freeze({
    kind: hasSelection ? CRIME_RUNTIME_KINDS.TRANSIENT_BUFFER : CRIME_RUNTIME_KINDS.IDLE_BUFFER,
    hasSelection,
    transientLocation: hasSelection,
  });
}

/**
 * Requests containing a precise buffer center must not enter query logs or the
 * in-memory/session cache. Public-area requests retain their existing TTL.
 */
export function crimeTransportPolicy({ transientLocation = false, publicCacheTTL = 0 } = {}) {
  return Object.freeze({
    cacheTTL: transientLocation ? 0 : publicCacheTTL,
    logQuery: !transientLocation,
  });
}
