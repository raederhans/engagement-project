import {
  SOURCE_HEALTH_SCHEMA_VERSION,
  SOURCE_HEALTH_STATUSES,
} from '../source_health/source_health_read_model.js';

const SOURCE_KEYS = new Set([
  'id', 'dataset', 'provider', 'canonicalUrl', 'status', 'statusReason',
  'coverage', 'clocks', 'snapshot', 'boundaryVintage', 'revisionPolicy', 'limitations',
]);
const COVERAGE_KEYS = new Set(['geography', 'start', 'end']);
const CLOCK_KEYS = new Set(['sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt']);
const SNAPSHOT_KEYS = new Set(['version', 'identity']);
const STATUS_SET = new Set(SOURCE_HEALTH_STATUSES);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function exactObject(value, keys, label) {
  const object = plainObject(value, label);
  const actual = Object.keys(object);
  const missing = [...keys].filter((key) => !Object.hasOwn(object, key));
  const unknown = actual.filter((key) => !keys.has(key));
  if (missing.length || unknown.length) {
    throw new TypeError(`${label} exact keys mismatch`);
  }
  return object;
}

function boundedText(value, label, { nullable = false, maxLength = 2048 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} must be ${nullable ? 'null or ' : ''}bounded text`);
  }
  return value;
}

function dateOrTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = boundedText(value, label, { maxLength: 64 });
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text) return text;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === text) return text;
  throw new TypeError(`${label} must be a calendar date or ISO timestamp`);
}

function timestampOrNull(value, label) {
  if (value === null) return null;
  const text = boundedText(value, label, { maxLength: 64 });
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new TypeError(`${label} must be null or an ISO timestamp`);
  }
  return text;
}

function validateSource(raw, index) {
  const label = `source[${index}]`;
  const source = exactObject(raw, SOURCE_KEYS, label);
  const coverage = exactObject(source.coverage, COVERAGE_KEYS, `${label}.coverage`);
  const clocks = exactObject(source.clocks, CLOCK_KEYS, `${label}.clocks`);
  const snapshot = exactObject(source.snapshot, SNAPSHOT_KEYS, `${label}.snapshot`);
  boundedText(source.id, `${label}.id`, { maxLength: 120 });
  boundedText(source.dataset, `${label}.dataset`, { maxLength: 500 });
  boundedText(source.provider, `${label}.provider`, { maxLength: 500 });
  const canonicalUrl = boundedText(source.canonicalUrl, `${label}.canonicalUrl`);
  const url = new URL(canonicalUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`${label}.canonicalUrl is unsupported`);
  if (!STATUS_SET.has(source.status)) throw new TypeError(`${label}.status is unsupported`);
  boundedText(source.statusReason, `${label}.statusReason`, { nullable: true, maxLength: 240 });
  boundedText(coverage.geography, `${label}.coverage.geography`, { nullable: true, maxLength: 500 });
  dateOrTimestamp(coverage.start, `${label}.coverage.start`, { nullable: true });
  dateOrTimestamp(coverage.end, `${label}.coverage.end`, { nullable: true });
  if (coverage.start && coverage.end && coverage.start > coverage.end) {
    throw new TypeError(`${label}.coverage is reversed`);
  }
  dateOrTimestamp(clocks.sourceAsOf, `${label}.clocks.sourceAsOf`, { nullable: true });
  timestampOrNull(clocks.retrievedAt, `${label}.clocks.retrievedAt`);
  timestampOrNull(clocks.builtAt, `${label}.clocks.builtAt`);
  timestampOrNull(clocks.observedAt, `${label}.clocks.observedAt`);
  boundedText(snapshot.version, `${label}.snapshot.version`, { nullable: true, maxLength: 240 });
  boundedText(snapshot.identity, `${label}.snapshot.identity`, { nullable: true, maxLength: 240 });
  boundedText(source.boundaryVintage, `${label}.boundaryVintage`, { nullable: true, maxLength: 240 });
  boundedText(source.revisionPolicy, `${label}.revisionPolicy`);
  if (!Array.isArray(source.limitations) || source.limitations.length === 0 || source.limitations.length > 32) {
    throw new TypeError(`${label}.limitations must be a non-empty bounded array`);
  }
  source.limitations.forEach((item, itemIndex) => boundedText(
    item,
    `${label}.limitations[${itemIndex}]`,
  ));
  return structuredClone(source);
}

function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 32) {
    throw new TypeError('sources must be a non-empty bounded array');
  }
  const normalized = sources.map(validateSource);
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length) {
    throw new TypeError('source ids must be unique');
  }
  return normalized;
}

function validateEvidenceAdmission({ sources, result } = {}) {
  const admitted = validateSources(sources);
  const hasObservedEvidence = admitted.some(({ status }) => ['current', 'partial', 'stale'].includes(status));
  if (!hasObservedEvidence && result?.status !== 'unavailable') {
    throw new TypeError('unavailable sources cannot admit an available result');
  }
}

function toArtifactProvenance(sources) {
  const admitted = validateSources(sources);
  const starts = admitted.map(({ coverage }) => coverage.start).filter(Boolean).sort();
  const ends = admitted.map(({ coverage }) => coverage.end).filter(Boolean).sort();
  return {
    sources: admitted.map(({ id }) => id),
    ...(starts.length || ends.length ? {
      coverage: { min: starts[0] || null, max: ends.at(-1) || null },
    } : {}),
  };
}

export const evidenceBundleSourceAdapter = Object.freeze({
  contractVersion: SOURCE_HEALTH_SCHEMA_VERSION,
  validateSources,
  validateEvidenceAdmission,
  toArtifactProvenance,
});

export function projectSourceHealthEvidence(readModel, sourceIds) {
  if (readModel?.schemaVersion !== SOURCE_HEALTH_SCHEMA_VERSION || !Array.isArray(readModel.sources)) {
    throw new TypeError('an admitted Source Health read model is required');
  }
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    throw new TypeError('at least one Source Health source id is required');
  }
  const byId = new Map(readModel.sources.map((source) => [source.id, source]));
  const projected = sourceIds.map((sourceId) => {
    const source = byId.get(sourceId);
    if (!source) throw new TypeError(`Source Health does not contain ${sourceId}`);
    return {
      id: source.id,
      dataset: source.dataset,
      provider: source.provider,
      canonicalUrl: source.canonicalUrl,
      status: source.status,
      statusReason: source.statusReason,
      coverage: {
        geography: source.coverage.geography,
        start: source.coverage.temporalStart,
        end: source.coverage.temporalEnd,
      },
      clocks: structuredClone(source.clocks),
      snapshot: structuredClone(source.snapshot),
      boundaryVintage: source.boundaryVintage,
      revisionPolicy: source.revisionPolicy,
      limitations: [...source.limitations],
    };
  });
  return evidenceBundleSourceAdapter.validateSources(projected);
}
