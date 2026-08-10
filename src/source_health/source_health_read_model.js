export const SOURCE_HEALTH_SCHEMA_VERSION = 'engagement-source-health/v1';
export const SOURCE_HEALTH_STATUSES = Object.freeze([
  'current',
  'partial',
  'stale',
  'unavailable',
  'unknown',
]);

const STATUS_SET = new Set(SOURCE_HEALTH_STATUSES);
const OBSERVATION_KEYS = new Set([
  'sourceId',
  'status',
  'statusReason',
  'clocks',
  'snapshot',
  'boundaryVintage',
  'coverage',
  'transport',
  'recordCount',
]);
const CLOCK_KEYS = new Set(['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt']);
const SNAPSHOT_KEYS = new Set(['version', 'identity']);
const COVERAGE_KEYS = new Set(['geography', 'temporalStart', 'temporalEnd']);
const TRANSPORT_KEYS = new Set(['endpointUrl', 'lastModified', 'etag']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, allowed, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be an object`);
  const keys = Object.keys(value);
  const missing = [...allowed].filter((key) => !Object.hasOwn(value, key));
  const unknown = keys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    throw new TypeError(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
}

function textOrNull(value, label, max = 500) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${label} must be null or bounded text`);
  }
  return value.trim();
}

function dateOrTimestamp(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be null or a date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value) return value;
  throw new TypeError(`${label} must be an exact calendar date or ISO timestamp`);
}

function timestampOrNull(value, label) {
  if (value === null) return null;
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be null or an exact ISO timestamp`);
  }
  return value;
}

function urlOrNull(value, label) {
  const text = textOrNull(value, label, 2048);
  if (text === null) return null;
  const url = new URL(text, 'https://local.invalid/');
  if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) {
    throw new TypeError(`${label} uses an unsupported URL scheme`);
  }
  return text;
}

function freezeObservation(value) {
  return Object.freeze({
    ...value,
    clocks: Object.freeze(value.clocks),
    snapshot: Object.freeze(value.snapshot),
    coverage: Object.freeze(value.coverage),
    transport: Object.freeze(value.transport),
  });
}

export function admitSourceHealthObservation(value) {
  exactObject(value, OBSERVATION_KEYS, 'source health observation');
  exactObject(value.clocks, CLOCK_KEYS, 'source health clocks');
  exactObject(value.snapshot, SNAPSHOT_KEYS, 'source health snapshot');
  exactObject(value.coverage, COVERAGE_KEYS, 'source health coverage');
  exactObject(value.transport, TRANSPORT_KEYS, 'source health transport');

  const sourceId = textOrNull(value.sourceId, 'sourceId', 120);
  if (!sourceId) throw new TypeError('sourceId is required');
  if (!STATUS_SET.has(value.status)) throw new TypeError('source health status is unsupported');
  const recordCount = value.recordCount;
  if (recordCount !== null && (!Number.isSafeInteger(recordCount) || recordCount < 0)) {
    throw new TypeError('recordCount must be null or a non-negative safe integer');
  }
  if (['unknown', 'unavailable'].includes(value.status) && recordCount !== null) {
    throw new TypeError(`${value.status} must not coerce recordCount to a number`);
  }

  const admitted = {
    sourceId,
    status: value.status,
    statusReason: textOrNull(value.statusReason, 'statusReason', 240),
    clocks: {
      sourceAsOf: dateOrTimestamp(value.clocks.sourceAsOf, 'sourceAsOf'),
      retrievedAt: timestampOrNull(value.clocks.retrievedAt, 'retrievedAt'),
      builtAt: timestampOrNull(value.clocks.builtAt, 'builtAt'),
      observedAt: timestampOrNull(value.clocks.observedAt, 'observedAt'),
    },
    snapshot: {
      version: textOrNull(value.snapshot.version, 'snapshot.version', 240),
      identity: textOrNull(value.snapshot.identity, 'snapshot.identity', 240),
    },
    boundaryVintage: textOrNull(value.boundaryVintage, 'boundaryVintage', 240),
    coverage: {
      geography: textOrNull(value.coverage.geography, 'coverage.geography', 500),
      temporalStart: dateOrTimestamp(value.coverage.temporalStart, 'coverage.temporalStart'),
      temporalEnd: dateOrTimestamp(value.coverage.temporalEnd, 'coverage.temporalEnd'),
    },
    transport: {
      endpointUrl: urlOrNull(value.transport.endpointUrl, 'transport.endpointUrl'),
      lastModified: textOrNull(value.transport.lastModified, 'transport.lastModified', 240),
      etag: textOrNull(value.transport.etag, 'transport.etag', 240),
    },
    recordCount,
  };
  if (admitted.coverage.temporalStart && admitted.coverage.temporalEnd
    && admitted.coverage.temporalStart > admitted.coverage.temporalEnd) {
    throw new TypeError('source health temporal coverage is reversed');
  }
  return freezeObservation(admitted);
}

function unavailableForSchemaDrift(base) {
  return Object.freeze({
    ...base,
    status: 'unavailable',
    statusReason: 'schema-drift',
    recordCount: null,
    clocks: Object.freeze({ ...base.clocks }),
    snapshot: Object.freeze({ ...base.snapshot }),
    coverage: Object.freeze({ ...base.coverage }),
    transport: Object.freeze({ ...base.transport }),
  });
}

function mergeSource(base, observation) {
  return Object.freeze({
    ...base,
    status: observation.status,
    statusReason: observation.statusReason,
    recordCount: observation.recordCount,
    boundaryVintage: observation.boundaryVintage ?? base.boundaryVintage,
    clocks: Object.freeze({ ...base.clocks, ...observation.clocks }),
    snapshot: Object.freeze({ ...base.snapshot, ...observation.snapshot }),
    coverage: Object.freeze({
      geography: observation.coverage.geography ?? base.coverage.geography,
      temporalStart: observation.coverage.temporalStart ?? base.coverage.temporalStart,
      temporalEnd: observation.coverage.temporalEnd ?? base.coverage.temporalEnd,
    }),
    transport: Object.freeze({ ...base.transport, ...observation.transport }),
  });
}

/** Build a deterministic, immutable view. Invalid or duplicate evidence fails closed per source. */
export function buildSourceHealthReadModel({ catalog, observations = [] } = {}) {
  if (!Array.isArray(catalog) || !Array.isArray(observations)) {
    throw new TypeError('source health catalog and observations must be arrays');
  }
  const catalogById = new Map();
  for (const entry of catalog) {
    if (!entry?.id || catalogById.has(entry.id)) throw new TypeError('source health catalog ids must be unique');
    catalogById.set(entry.id, entry);
  }

  const admitted = new Map();
  const rejectedSourceIds = new Set();
  let rejectedObservationCount = 0;
  for (const raw of observations) {
    const hintedId = typeof raw?.sourceId === 'string' ? raw.sourceId : null;
    try {
      const observation = admitSourceHealthObservation(raw);
      if (!catalogById.has(observation.sourceId) || admitted.has(observation.sourceId)) {
        throw new TypeError('source health observation is unknown or duplicated');
      }
      admitted.set(observation.sourceId, observation);
    } catch {
      rejectedObservationCount += 1;
      if (hintedId && catalogById.has(hintedId)) rejectedSourceIds.add(hintedId);
    }
  }

  const sources = catalog.map((entry) => {
    if (rejectedSourceIds.has(entry.id)) return unavailableForSchemaDrift(entry);
    const observation = admitted.get(entry.id);
    return observation ? mergeSource(entry, observation) : entry;
  });
  return Object.freeze({
    schemaVersion: SOURCE_HEALTH_SCHEMA_VERSION,
    sources: Object.freeze(sources),
    rejectedObservationCount,
  });
}
