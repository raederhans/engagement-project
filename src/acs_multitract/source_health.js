import { admitSourceHealthObservation } from '../source_health/source_health_read_model.js';

export const ACS_VRE_SOURCE_HEALTH_ID = 'acs-tract-population-vre';

function emptyObservation(status, statusReason, observedAt) {
  return {
    sourceId: ACS_VRE_SOURCE_HEALTH_ID,
    status,
    statusReason,
    clocks: { sourceAsOf: null, retrievedAt: null, builtAt: null, observedAt },
    snapshot: { version: null, identity: null },
    boundaryVintage: null,
    coverage: { geography: null, temporalStart: null, temporalEnd: null },
    transport: { endpointUrl: null, lastModified: null, etag: null },
    recordCount: null,
  };
}

function exactTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('ACS VRE observation time is invalid');
  return date.toISOString();
}

/**
 * Feature-owned adapter for the P0 registered-observation seam. It describes
 * the admitted bundled VRE artifact, never the availability of the upstream ZIP.
 */
export function adaptAcsVreSourceHealthObservation(source, { now = new Date() } = {}) {
  const observedAt = exactTimestamp(now);
  if (source?.status !== 'available' || !source.snapshot) {
    return admitSourceHealthObservation(
      emptyObservation('unavailable', 'vre-source-unavailable', observedAt),
    );
  }
  try {
    const { schemaVersion, manifest } = source.snapshot;
    return admitSourceHealthObservation({
      ...emptyObservation('partial', 'bundled-vre-snapshot', observedAt),
      clocks: {
        sourceAsOf: '2024-12-31',
        retrievedAt: manifest.retrievedAt,
        builtAt: null,
        observedAt,
      },
      snapshot: {
        version: `${schemaVersion}:${manifest.release}`,
        identity: manifest.rowsSha256,
      },
      boundaryVintage: '2020 Census tract geography',
      coverage: {
        geography: manifest.geography,
        temporalStart: '2020-01-01',
        temporalEnd: '2024-12-31',
      },
      recordCount: manifest.rowCount,
    });
  } catch {
    return admitSourceHealthObservation(
      emptyObservation('unavailable', 'vre-source-schema-drift', observedAt),
    );
  }
}
