export const EVIDENCE_BUNDLE_SCHEMA_VERSION = 'engagement-evidence-bundle/v1';

const SOURCE_STATUSES = new Set(['available', 'fallback', 'stale', 'unavailable']);
const RESULT_STATUSES = new Set(['available', 'partial', 'stale', 'unavailable']);
const SENSITIVE_KEY_PATTERN = /(?:^raw|^incidents?$|^rows$|^features$|incident(?:rows?|records?|features?)|address|^label$|^location$|gps|trace|diarynotes?|^notes?$|^route$|routegeometry|mediaurls?|(?:photo|image|video)urls?|attachments?|^geometry$|coordinates?|center(?:3857|lonlat)|^bbox$|^(?:lat|lng|latitude|longitude)$)/;

function fail(message) {
  throw new TypeError(`Invalid Evidence Bundle: ${message}`);
}

function boundedText(value, label, { nullable = false, maxLength = 2048 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    fail(`${label} must be ${nullable ? 'null or ' : ''}non-empty bounded text`);
  }
  return value;
}

function timestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = boundedText(value, label, { maxLength: 64 });
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    fail(`${label} must be an ISO timestamp`);
  }
  return text;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactObject(value, label, allowedKeys, requiredKeys = allowedKeys) {
  const object = plainObject(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${label}.${key} is not allowed by schema v1`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(object, key)) fail(`${label} is missing ${key}`);
  }
  return object;
}

function admittedAggregateCount(value, label) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return normalized;
}

function sensitiveFieldName(key) {
  const normalized = String(key).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

function assertNoSensitiveFields(value, path = 'bundle', seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') fail(`${path} contains unsupported data`);
  if (seen.has(value)) fail(`${path} contains circular data`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (sensitiveFieldName(key)) fail(`${path}.${key} is a prohibited sensitive field`);
      assertNoSensitiveFields(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function canonicalValue(value, path = 'section', seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== 'object') fail(`${path} contains unsupported data`);
  if (seen.has(value)) fail(`${path} contains circular data`);
  seen.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item, index) => canonicalValue(item, `${path}[${index}]`, seen));
  } else {
    plainObject(value, path);
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) fail(`${path}.${key} must not be undefined`);
      normalized[key] = canonicalValue(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return normalized;
}

export function canonicalSerialize(value) {
  return JSON.stringify(canonicalValue(value));
}

function validateCoverage(coverage, sourceLabel) {
  const label = `${sourceLabel}.coverage`;
  exactObject(coverage, label, ['start', 'end', 'geography']);
  boundedText(coverage.start, `${label}.start`, { nullable: true, maxLength: 64 });
  boundedText(coverage.end, `${label}.end`, { nullable: true, maxLength: 64 });
  boundedText(coverage.geography, `${label}.geography`, { maxLength: 240 });
}

function validateSource(source, index) {
  const label = `provenance.sources[${index}]`;
  const sourceFields = [
    'id', 'dataset', 'status', 'url', 'provider', 'vintage', 'asOf', 'retrievedAt',
    'revisionPolicy', 'coverage', 'snapshotIdentity',
  ];
  exactObject(source, label, sourceFields);
  boundedText(source.id, `${label}.id`, { maxLength: 160 });
  boundedText(source.dataset, `${label}.dataset`, { maxLength: 240 });
  if (!SOURCE_STATUSES.has(source.status)) fail(`provenance source ${index} has an invalid status`);
  const url = boundedText(source.url, `${label}.url`);
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    fail(`provenance source ${index} URL is invalid`);
  }
  boundedText(source.provider, `${label}.provider`, { maxLength: 240 });
  boundedText(source.vintage, `${label}.vintage`, { nullable: true, maxLength: 160 });
  boundedText(source.asOf, `${label}.asOf`, { nullable: true, maxLength: 160 });
  timestamp(source.retrievedAt, `${label}.retrievedAt`, { nullable: true });
  boundedText(source.revisionPolicy, `${label}.revisionPolicy`);
  validateCoverage(source.coverage, label);
  boundedText(source.snapshotIdentity, `${label}.snapshotIdentity`, { nullable: true, maxLength: 512 });
}

function validateQuery(query) {
  exactObject(query, 'query', [
    'type', 'timeRange', 'offenseCodes', 'geography', 'comparisonRequested', 'display',
  ]);
  if (query.type !== 'crime-analysis') fail('query.type is invalid');
  exactObject(query.timeRange, 'query.timeRange', ['start', 'endExclusive', 'timeZone']);
  boundedText(query.timeRange.start, 'query.timeRange.start', { maxLength: 64 });
  boundedText(query.timeRange.endExclusive, 'query.timeRange.endExclusive', { maxLength: 64 });
  if (query.timeRange.timeZone !== 'America/New_York') fail('query.timeRange.timeZone is invalid');
  if (!Array.isArray(query.offenseCodes)) fail('query.offenseCodes must be an array');
  query.offenseCodes.forEach((code, index) => boundedText(code, `query.offenseCodes[${index}]`, { maxLength: 240 }));
  if (typeof query.comparisonRequested !== 'boolean') fail('query.comparisonRequested must be boolean');
  exactObject(query.display, 'query.display', ['adminLevel', 'per10k']);
  if (!['districts', 'tracts'].includes(query.display.adminLevel)) fail('query.display.adminLevel is invalid');
  if (typeof query.display.per10k !== 'boolean') fail('query.display.per10k must be boolean');

  const mode = query.geography?.mode;
  if (mode === 'buffer') {
    exactObject(query.geography, 'query.geography', ['mode', 'radiusM', 'exactSelection']);
    if (!Number.isFinite(query.geography.radiusM) || query.geography.radiusM <= 0) {
      fail('query.geography.radiusM must be positive and finite');
    }
    if (query.geography.exactSelection !== 'omitted-for-privacy') {
      fail('query.geography.exactSelection is invalid');
    }
  } else if (mode === 'district') {
    exactObject(query.geography, 'query.geography', ['mode', 'districtCode']);
    if (!/^\d{1,2}$/.test(query.geography.districtCode)) fail('query.geography.districtCode is invalid');
  } else if (mode === 'tract') {
    exactObject(query.geography, 'query.geography', ['mode', 'tractGEOID']);
    if (!/^\d{11}$/.test(query.geography.tractGEOID)) fail('query.geography.tractGEOID is invalid');
  } else {
    fail('query.geography.mode is invalid');
  }
}

function validateTopOffense(row, path) {
  exactObject(row, path, ['offenseCode', 'count']);
  boundedText(row.offenseCode, `${path}.offenseCode`, { maxLength: 240 });
  admittedAggregateCount(row.count, `${path}.count`);
}

function validateAggregatePoint(point, path) {
  exactObject(point, path, ['point', 'status', 'total', 'per10k', 'topOffenses'], ['point', 'status', 'total']);
  if (!['A', 'B'].includes(point.point)) fail(`${path}.point is invalid`);
  if (point.status !== 'available') fail(`${path}.status is invalid`);
  admittedAggregateCount(point.total, `${path}.total`);
  if (Object.hasOwn(point, 'per10k') && (!Number.isFinite(point.per10k) || point.per10k < 0)) {
    fail(`${path}.per10k must be non-negative and finite`);
  }
  if (Object.hasOwn(point, 'topOffenses')) {
    if (!Array.isArray(point.topOffenses)) fail(`${path}.topOffenses must be an array`);
    point.topOffenses.forEach((row, index) => validateTopOffense(row, `${path}.topOffenses[${index}]`));
  }
}

function validateResult(result) {
  exactObject(result, 'result', ['status', 'comparison'], ['status']);
  if (!RESULT_STATUSES.has(result.status)) fail('result.status is invalid');
  if (result.status === 'unavailable') {
    if (Object.hasOwn(result, 'comparison')) fail('unavailable result must not contain comparison data');
    return;
  }
  if (!Object.hasOwn(result, 'comparison')) fail('available result requires comparison data');
  exactObject(result.comparison, 'result.comparison', ['a', 'b'], ['a']);
  validateAggregatePoint(result.comparison.a, 'result.comparison.a');
  if (Object.hasOwn(result.comparison, 'b')) validateAggregatePoint(result.comparison.b, 'result.comparison.b');
}

function validateModel({ query, result, provenance, limitations, privacy }) {
  validateQuery(query);
  validateResult(result);
  exactObject(provenance, 'provenance', ['sources']);
  exactObject(privacy, 'privacy', ['mode', 'excludedFields']);
  if (!Array.isArray(provenance.sources) || provenance.sources.length === 0) {
    fail('provenance.sources must contain at least one explicit source');
  }
  provenance.sources.forEach(validateSource);
  if (provenance.sources.every(({ status }) => status === 'unavailable') && result.status !== 'unavailable') {
    fail('unavailable sources cannot produce an available or zero result');
  }
  if (!Array.isArray(limitations) || limitations.length === 0) fail('limitations must be a non-empty array');
  limitations.forEach((item, index) => boundedText(item, `limitations[${index}]`));
  boundedText(privacy.mode, 'privacy.mode', { maxLength: 120 });
  if (!Array.isArray(privacy.excludedFields) || privacy.excludedFields.length === 0) {
    fail('privacy.excludedFields must be a non-empty array');
  }
  privacy.excludedFields.forEach((item, index) => boundedText(item, `privacy.excludedFields[${index}]`));
}

function aggregatePoint(point, pointId) {
  if (!point) return null;
  const total = typeof point.total === 'string' && /^\d+$/.test(point.total)
    ? Number(point.total)
    : point.total;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new TypeError(`Evidence Bundle point ${pointId} requires an admitted aggregate count.`);
  }
  const normalized = {
    point: pointId,
    status: 'available',
    total,
  };
  if (Number.isFinite(point.per10k)) normalized.per10k = point.per10k;
  const topOffenses = Array.isArray(point.top3)
    ? point.top3.flatMap((row) => {
        const count = typeof row?.n === 'string' && /^\d+$/.test(row.n) ? Number(row.n) : row?.n;
        return typeof row?.text_general_code === 'string' && row.text_general_code.trim()
          && Number.isSafeInteger(count) && count >= 0
          ? [{ offenseCode: row.text_general_code, count }]
          : [];
      })
    : [];
  if (topOffenses.length) normalized.topOffenses = topOffenses;
  return normalized;
}

export function buildEvidenceBundleSections({ filters = {}, comparison = null, source } = {}) {
  const queryMode = ['buffer', 'district', 'tract'].includes(filters.queryMode)
    ? filters.queryMode
    : 'buffer';
  const geography = queryMode === 'district'
    ? { mode: 'district', districtCode: String(filters.selectedDistrictCode || '') }
    : queryMode === 'tract'
      ? { mode: 'tract', tractGEOID: String(filters.selectedTractGEOID || '') }
      : {
          mode: 'buffer',
          radiusM: Number(filters.radiusM),
          exactSelection: 'omitted-for-privacy',
        };
  const query = {
    type: 'crime-analysis',
    timeRange: {
      start: String(filters.start || ''),
      endExclusive: String(filters.end || ''),
      timeZone: 'America/New_York',
    },
    offenseCodes: [...new Set((filters.resolvedOffenseCodes || filters.types || []).map(String))].sort(),
    geography,
    comparisonRequested: Boolean(filters.centerB3857),
    display: {
      adminLevel: String(filters.adminLevel || ''),
      per10k: Boolean(filters.per10k),
    },
  };
  const sourceUnavailable = source?.status === 'unavailable';
  const a = sourceUnavailable ? null : aggregatePoint(comparison?.a, 'A');
  const b = sourceUnavailable ? null : aggregatePoint(comparison?.b, 'B');
  const result = a
    ? {
        status: 'available',
        comparison: { a, ...(b ? { b } : {}) },
      }
    : { status: 'unavailable' };

  return {
    query,
    result,
    provenance: { sources: [structuredClone(source)] },
    limitations: [
      'Counts use historical source records; one record is not guaranteed to equal one unique incident.',
      'Incident locations are generalized by the source and are not exported in this bundle.',
      'This bundle is not real-time, predictive, a safety score, or a complete record.',
    ],
    privacy: {
      mode: 'aggregate-only',
      excludedFields: [
        'raw incident rows',
        'exact addresses and coordinates',
        'GPS traces',
        'Diary notes and route geometry',
        '311 media URLs',
      ],
    },
  };
}

export async function composeEvidenceBundle(input = {}) {
  exactObject(input, 'input', [
    'schemaVersion', 'generatedAt', 'query', 'result', 'provenance', 'limitations', 'privacy',
  ]);
  if (input.schemaVersion !== EVIDENCE_BUNDLE_SCHEMA_VERSION) {
    fail(`unsupported schema version ${String(input.schemaVersion || '')}`);
  }
  const generatedAt = timestamp(input.generatedAt, 'generatedAt');
  const sections = {
    query: input.query,
    result: input.result,
    provenance: input.provenance,
    limitations: input.limitations,
    privacy: input.privacy,
  };
  assertNoSensitiveFields(sections);
  validateModel(sections);

  const query = canonicalValue(sections.query, 'query');
  const result = canonicalValue(sections.result, 'result');
  const provenance = canonicalValue(sections.provenance, 'provenance');
  const limitations = canonicalValue(sections.limitations, 'limitations');
  const privacy = canonicalValue(sections.privacy, 'privacy');
  const { sha256CanonicalValue } = await import('./evidence_bundle_hash.js');
  const checksums = {
    algorithm: 'SHA-256',
    canonicalization: 'sorted-json-keys/v1',
    excludedVolatileFields: ['exportedAt', 'generatedAt', 'retrievedAt'],
    query: await sha256CanonicalValue(query),
    result: await sha256CanonicalValue(result),
    provenance: await sha256CanonicalValue(provenance),
  };
  const snapshotIdentity = `sha256:${await sha256CanonicalValue({
    provenance: checksums.provenance,
    query: checksums.query,
    result: checksums.result,
  })}`;

  return {
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    generatedAt,
    snapshotIdentity,
    query,
    result,
    provenance,
    limitations,
    privacy,
    checksums,
  };
}
