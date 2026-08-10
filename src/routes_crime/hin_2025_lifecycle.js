import { publicUrl } from '../utils/public_url.js';
import { admitSourceHealthObservation } from '../source_health/source_health_read_model.js';

export const HIN_2025_RECEIPT_URL = publicUrl('data/hin_2025.receipt.json');
export const HIN_2025_SOURCE_ID = 'hin-2025';
export const HIN_2025_EVIDENCE_CONTRIBUTION_SCHEMA = 'hin-2025-evidence-contribution/v1';
export const HIN_2025_ADMITTED_SNAPSHOT_IDENTITY = 'sha256:b518f8b370c6375f5d3188ec2ec487ed834b7b7c25cb51f5f5e554285749e250';

const ADMITTED_FIELDS = Object.freeze([
  { name: 'objectid', type: 'esriFieldTypeOID' },
  { name: 'stname', type: 'esriFieldTypeString' },
  { name: 'length_ft', type: 'esriFieldTypeDouble' },
  { name: 'Shape__Length', type: 'esriFieldTypeDouble' },
]);

const EMPTY_CLOCKS = Object.freeze({
  sourceAsOf: null,
  retrievedAt: null,
  builtAt: null,
  observedAt: null,
});

export async function loadHin2025LifecycleReceipt({
  request = fetch,
  url = HIN_2025_RECEIPT_URL,
} = {}) {
  const response = await request(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'force-cache',
    headers: { accept: 'application/json' },
  });
  if (!response?.ok) throw new Error(`HIN 2025 lifecycle receipt failed (${response?.status || 'unknown'}).`);
  return validateRuntimeHin2025Receipt(await response.json());
}

export function validateRuntimeHin2025Receipt(receipt) {
  const source = receipt?.source;
  const artifact = receipt?.artifact;
  const review = receipt?.review;
  if (receipt?.schema !== 'phl-hin-2025-receipt-v1'
    || source?.sourceId !== HIN_2025_SOURCE_ID
    || source.itemId !== '7e416319784a463fa0d8b528d7ccf511'
    || source.itemUrl !== 'https://www.arcgis.com/sharing/rest/content/items/7e416319784a463fa0d8b528d7ccf511'
    || source.layerId !== 0
    || source.layerUrl !== 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/high_injury_network_2025/FeatureServer/0'
    || source.layerName !== 'high_injury_network_2025'
    || source.geometryType !== 'esriGeometryPolyline'
    || JSON.stringify(source.fields) !== JSON.stringify(ADMITTED_FIELDS)
    || JSON.stringify(source.crashDataPeriod) !== JSON.stringify([2019, 2023])
    || source.networkVintage !== 2025
    || source.officialContext !== 'https://www.phila.gov/2025-11-25-city-of-philadelphia-releases-vision-zero-action-plan-2030/'
    || !/not the crash-data period, retrieval, build, or observation time/i.test(source.sourceAsOfMeaning || '')
    || !exactTimestamp(source.sourceAsOf)
    || artifact?.schema !== 'phl-hin-2025-v1'
    || artifact.identity !== HIN_2025_ADMITTED_SNAPSHOT_IDENTITY
    || artifact.bytes !== 270_811
    || artifact.retrievedAt !== '2026-08-10T10:29:36.678Z'
    || (artifact.builtAt !== null && !exactTimestamp(artifact.builtAt))
    || artifact.featureCount !== 162
    || JSON.stringify(artifact.geometryTypes) !== JSON.stringify(['LineString', 'MultiLineString'])
    || JSON.stringify(artifact.geometryCounts) !== JSON.stringify({ LineString: 6, MultiLineString: 156 })
    || artifact.coordinatePrecision !== 6
    || !['legacy-admitted', 'admitted-after-review'].includes(review?.status)) {
    throw new Error('HIN 2025 lifecycle receipt contract is invalid.');
  }
  if ((artifact.builtAt === null) !== (artifact.buildClockStatus === 'not-recorded-in-legacy-snapshot')) {
    throw new Error('HIN 2025 lifecycle build-clock semantics are invalid.');
  }
  if (review.status === 'legacy-admitted'
    && (review.reviewedAt !== null || review.reviewedBy !== null || artifact.builtAt !== null)) {
    throw new Error('HIN 2025 legacy lifecycle receipt invents review or build clocks.');
  }
  if (review.status === 'admitted-after-review'
    && (!exactTimestamp(review.reviewedAt) || typeof review.reviewedBy !== 'string'
      || !review.reviewedBy.trim() || !exactTimestamp(artifact.builtAt))) {
    throw new Error('HIN 2025 reviewed lifecycle receipt is incomplete.');
  }
  return receipt;
}

/**
 * Feature-owned adapter for P0's registeredSourceHealthObservations seam.
 * `partial` means a bundled historical planning snapshot is admitted; it never
 * claims live road conditions, present danger, or a complete safety measure.
 */
export function adaptHin2025SourceHealthObservation({
  receipt = null,
  observedAt,
  unavailableReason = null,
} = {}) {
  const observed = exactObservedAt(observedAt);
  if (unavailableReason) {
    return unavailableObservation('lifecycle-receipt-unavailable', observed);
  }
  let admitted;
  try {
    admitted = validateRuntimeHin2025Receipt(receipt);
  } catch {
    return unavailableObservation('lifecycle-receipt-schema-drift', observed);
  }
  return admitSourceHealthObservation({
    sourceId: HIN_2025_SOURCE_ID,
    status: 'partial',
    statusReason: 'bundled-historical-planning-snapshot',
    clocks: {
      sourceAsOf: admitted.source.sourceAsOf,
      retrievedAt: admitted.artifact.retrievedAt,
      builtAt: admitted.artifact.builtAt,
      observedAt: observed,
    },
    snapshot: {
      version: `${admitted.artifact.schema}@${admitted.source.networkVintage}`,
      identity: admitted.artifact.identity,
    },
    boundaryVintage: null,
    coverage: {
      geography: 'Philadelphia High Injury Network historical planning geometry',
      temporalStart: '2019-01-01',
      temporalEnd: '2023-12-31',
    },
    transport: {
      endpointUrl: HIN_2025_RECEIPT_URL,
      lastModified: null,
      etag: null,
    },
    recordCount: admitted.artifact.featureCount,
  });
}

/**
 * Aggregate-only handoff for P8. The contribution deliberately excludes exact
 * route geometry, matched street names, snapshot rows, and feature identities.
 */
export function createHin2025EvidenceContribution({
  result,
  sourceHealthObservation,
} = {}) {
  const observation = admitSourceHealthObservation(sourceHealthObservation);
  if (observation.sourceId !== HIN_2025_SOURCE_ID) {
    throw new TypeError('HIN 2025 evidence requires the HIN source observation.');
  }
  const status = ['ready', 'no-associated-streets', 'unavailable'].includes(result?.status)
    ? result.status : 'unavailable';
  const admittedZero = status === 'no-associated-streets';
  const count = status === 'ready' && Array.isArray(result.matches)
    ? result.matches.length : admittedZero ? 0 : null;
  const contribution = {
    schema: HIN_2025_EVIDENCE_CONTRIBUTION_SCHEMA,
    source: {
      sourceId: observation.sourceId,
      status: observation.status,
      statusReason: observation.statusReason,
      clocks: { ...observation.clocks },
      snapshot: { ...observation.snapshot },
      coverage: {
        start: observation.coverage.temporalStart,
        end: observation.coverage.temporalEnd,
        geography: observation.coverage.geography,
      },
      recordCount: observation.recordCount,
    },
    context: {
      status,
      admittedZero,
      associatedStreetNameCount: count,
      relation: result?.relation || 'known-route-near-or-intersects-hin-snapshot',
      toleranceM: Number.isFinite(result?.toleranceM) ? result.toleranceM : 20,
      method: result?.method || 'inclusive 20 m local segment-distance approximation',
    },
    officialHandoff: {
      label: 'City of Philadelphia Vision Zero Action Plan 2030',
      url: 'https://www.phila.gov/2025-11-25-city-of-philadelphia-releases-vision-zero-action-plan-2030/',
    },
    limitations: [
      'This is a historical planning network based on 2019–2023 crash data, not a live condition, prediction, certification, risk score, or safer-route recommendation.',
      'Known Route is not GPS map matching. Near or intersects does not mean the route belongs to the HIN or that a crash occurred on the route.',
      'Association uses an inclusive 20 m local equirectangular segment-distance approximation.',
    ],
  };
  return deepFreeze(contribution);
}

function unavailableObservation(reason, observedAt) {
  return admitSourceHealthObservation({
    sourceId: HIN_2025_SOURCE_ID,
    status: 'unavailable',
    statusReason: reason,
    clocks: { ...EMPTY_CLOCKS, observedAt },
    snapshot: { version: null, identity: null },
    boundaryVintage: null,
    coverage: { geography: null, temporalStart: null, temporalEnd: null },
    transport: { endpointUrl: HIN_2025_RECEIPT_URL, lastModified: null, etag: null },
    recordCount: null,
  });
}

function exactObservedAt(value) {
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (!exactTimestamp(candidate)) throw new TypeError('HIN 2025 observedAt must be an exact ISO timestamp.');
  return candidate;
}

function exactTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
