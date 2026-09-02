import { createHash } from 'node:crypto';

export const KNOWN_ROUTE_EVIDENCE_READINESS_SCHEMA = 'KnownRouteEvidenceReadiness/v1';

const DIMENSION_IDS = Object.freeze([
  'reported-incidents',
  'raw-crash',
  'crash-centerline-match',
  'accessibility-sidewalk',
  'accessibility-crossing',
  'accessibility-curb-ramp',
  'walking-legality',
  'cycling-legality',
  'driving-legality',
  'transit-legality',
  'manual-calibration',
  'match-error-distribution',
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const IDENTITIES = Object.freeze({
  route_identity: /^route:[a-f0-9]{16}$/,
  corridor_identity: /^known-route-corridor:[a-f0-9]{16}$/,
  centerline_identity: /^(?:centerline-catalog|sha256):[a-f0-9]{16,64}$/,
  catalog_identity: /^(?:centerline-catalog|sha256):[a-f0-9]{16,64}$/,
  crash_accessibility_producer_identity: SHA256,
  mode_legality_producer_identity: SHA256,
});
const AUTHORITY = Object.freeze({
  route_choice: false,
  routing: false,
  safety: false,
  crash: false,
  accessibility: false,
  mode_legality: false,
  calibration: false,
});
const PRIVACY = Object.freeze({
  aggregate_only: true,
  route_geometry_included: false,
  route_endpoints_included: false,
  event_rows_included: false,
  event_coordinates_included: false,
  source_record_ids_included: false,
});

export function buildKnownRouteEvidenceReadiness({
  observed_at: observedAt,
  bindings,
  dimensions,
  sensitivity,
} = {}) {
  const core = normalizeReadiness({
    schema: KNOWN_ROUTE_EVIDENCE_READINESS_SCHEMA,
    observed_at: observedAt,
    status: computedStatus(dimensions, sensitivity),
    bindings,
    incidents_crash_separated: true,
    dimensions,
    sensitivity,
    cross_dimension_combination: 'forbidden',
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
  });
  return admitKnownRouteEvidenceReadiness({ ...core, readiness_identity: identity(core) });
}

export function admitKnownRouteEvidenceReadiness(value) {
  exactKeys(value, [
    'schema', 'observed_at', 'status', 'bindings', 'incidents_crash_separated',
    'dimensions', 'sensitivity', 'cross_dimension_combination', 'authority',
    'privacy', 'readiness_identity',
  ], 'Known Route evidence readiness');
  const core = normalizeReadiness(value);
  requireDigest(value.readiness_identity, 'readiness_identity');
  if (value.readiness_identity !== identity(core)) {
    throw new TypeError('Known Route evidence readiness identity drifted.');
  }
  return deepFreeze(structuredClone(value));
}

export function unavailableKnownRouteEvidenceReadiness(observedAt, reason) {
  if (!nonempty(reason)) throw new TypeError('Unavailable Known Route reason is required.');
  return buildKnownRouteEvidenceReadiness({
    observed_at: observedAt,
    bindings: Object.fromEntries(Object.keys(IDENTITIES).map((key) => [key, null])),
    dimensions: DIMENSION_IDS.map((dimensionId) => ({
      dimension_id: dimensionId,
      status: 'unavailable',
      receipt_identity: null,
      producer_identity: null,
      reason,
    })),
    sensitivity: {
      status: 'unavailable',
      receipt_identity: null,
      approved_scenarios: [],
      stable_under_approved_scenarios: null,
      reason,
    },
  });
}

export function knownRouteEvidenceDimensionIds() {
  return [...DIMENSION_IDS];
}

function normalizeReadiness(value) {
  if (value.schema !== KNOWN_ROUTE_EVIDENCE_READINESS_SCHEMA
    || !['available', 'partial', 'unavailable'].includes(value.status)
    || value.incidents_crash_separated !== true
    || value.cross_dimension_combination !== 'forbidden'
    || stable(value.authority) !== stable(AUTHORITY)
    || stable(value.privacy) !== stable(PRIVACY)) {
    throw new TypeError('Known Route readiness schema or authority boundary drifted.');
  }
  timestamp(value.observed_at, 'observed_at');
  exactKeys(value.bindings, Object.keys(IDENTITIES), 'Known Route bindings');
  const bindingValues = Object.values(value.bindings);
  const bindingsAvailable = bindingValues.every((entry) => entry !== null);
  const bindingsUnavailable = bindingValues.every((entry) => entry === null);
  if (!bindingsAvailable && !bindingsUnavailable) {
    throw new TypeError('Known Route bindings must be complete or wholly unavailable.');
  }
  if (bindingsAvailable) {
    for (const [key, pattern] of Object.entries(IDENTITIES)) {
      if (!pattern.test(value.bindings[key] || '')) {
        throw new TypeError(`Known Route ${key} is invalid.`);
      }
    }
  }
  const dimensions = normalizeDimensions(value.dimensions, bindingsAvailable);
  const sensitivity = normalizeSensitivity(value.sensitivity, bindingsAvailable);
  const expectedStatus = computedStatus(dimensions, sensitivity);
  if (value.status !== expectedStatus) throw new TypeError('Known Route readiness status drifted.');
  if (!bindingsAvailable && expectedStatus !== 'unavailable') {
    throw new TypeError('Known Route evidence cannot be available without exact cross-bindings.');
  }
  return {
    schema: KNOWN_ROUTE_EVIDENCE_READINESS_SCHEMA,
    observed_at: value.observed_at,
    status: expectedStatus,
    bindings: structuredClone(value.bindings),
    incidents_crash_separated: true,
    dimensions,
    sensitivity,
    cross_dimension_combination: 'forbidden',
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
  };
}

function normalizeDimensions(value, bindingsAvailable) {
  if (!Array.isArray(value) || value.length !== DIMENSION_IDS.length) {
    throw new TypeError('Known Route readiness requires every evidence dimension.');
  }
  const dimensions = value.map((entry, index) => {
    exactKeys(entry, [
      'dimension_id', 'status', 'receipt_identity', 'producer_identity', 'reason',
    ], `dimensions[${index}]`);
    if (entry.dimension_id !== DIMENSION_IDS[index]
      || !['available', 'unavailable'].includes(entry.status)
      || !nonempty(entry.reason)) {
      throw new TypeError('Known Route readiness dimension vocabulary drifted.');
    }
    if (entry.status === 'available') {
      if (!bindingsAvailable) throw new TypeError('Available Known Route dimension lacks bindings.');
      requireDigest(entry.receipt_identity, 'dimension receipt_identity');
      requireDigest(entry.producer_identity, 'dimension producer_identity');
    } else if (entry.receipt_identity !== null || entry.producer_identity !== null) {
      throw new TypeError('Unavailable Known Route dimension cannot infer receipt or producer identity.');
    }
    return structuredClone(entry);
  });
  if (dimensions[0].dimension_id === dimensions[1].dimension_id) {
    throw new TypeError('Reported incidents and raw crash evidence must remain separate.');
  }
  return dimensions;
}

function normalizeSensitivity(value, bindingsAvailable) {
  exactKeys(value, [
    'status', 'receipt_identity', 'approved_scenarios',
    'stable_under_approved_scenarios', 'reason',
  ], 'Known Route sensitivity');
  if (!['available', 'unavailable'].includes(value.status)
    || !Array.isArray(value.approved_scenarios) || !nonempty(value.reason)) {
    throw new TypeError('Known Route sensitivity vocabulary drifted.');
  }
  const scenarios = new Set();
  for (const scenario of value.approved_scenarios) {
    if (!nonempty(scenario) || scenarios.has(scenario)) {
      throw new TypeError('Known Route sensitivity scenarios are invalid or duplicated.');
    }
    scenarios.add(scenario);
  }
  if (value.status === 'available') {
    if (!bindingsAvailable || value.approved_scenarios.length < 2
      || typeof value.stable_under_approved_scenarios !== 'boolean') {
      throw new TypeError('Available Known Route sensitivity lacks bindings or approved scenarios.');
    }
    requireDigest(value.receipt_identity, 'sensitivity receipt_identity');
  } else if (value.receipt_identity !== null || value.approved_scenarios.length !== 0
    || value.stable_under_approved_scenarios !== null) {
    throw new TypeError('Unavailable Known Route sensitivity cannot infer stability.');
  }
  return structuredClone(value);
}

function computedStatus(dimensions, sensitivity) {
  if (!Array.isArray(dimensions) || !sensitivity) return 'unavailable';
  const statuses = [...dimensions.map(({ status }) => status), sensitivity.status];
  return statuses.every((status) => status === 'available')
    ? 'available'
    : statuses.every((status) => status === 'unavailable') ? 'unavailable' : 'partial';
}

function identity(value) {
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new TypeError(`${label} keys drifted.`);
  }
}

function requireDigest(value, label) {
  if (!SHA256.test(value || '')) throw new TypeError(`${label} must be a SHA-256 identity.`);
}

function timestamp(value, label) {
  if (!CLOCK.test(value || '') || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an exact UTC timestamp.`);
  }
  return value;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
