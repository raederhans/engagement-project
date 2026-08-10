import { sha256CanonicalValue } from './evidence_bundle_hash.js';

export const EVIDENCE_BUNDLE_V2_SCHEMA_VERSION = 'engagement-evidence-bundle/v2';
export const EVIDENCE_BUNDLE_PUBLIC_SCOPE = Object.freeze({
  product: 'engagement-project',
  domain: 'public-crime-analysis',
  geography: 'Philadelphia',
});

const SECTION_NAMES = Object.freeze([
  'activity', 'compatibility', 'scope', 'query', 'result', 'provenance',
  'transform', 'uncertainty', 'limitations', 'privacy',
]);
const TRANSFORM_STEPS = new Set([
  'omit-sensitive-location',
  'project-public-query',
  'project-aggregate-result',
  'canonicalize-sorted-json-keys',
]);
const UNCERTAINTY_STATUSES = new Set(['available', 'partial', 'unavailable', 'unknown']);
const RESULT_STATUSES = new Set(['available', 'partial', 'stale', 'unavailable']);
const SENSITIVE_KEY_PATTERN = /(?:^raw|^incidents?$|^rows$|^features$|incident(?:rows?|records?|features?)|address|^label$|^location$|gps|trace|diarynotes?|^notes?$|^route$|routegeometry|mediaurls?|(?:photo|image|video)urls?|attachments?|^geometry$|coordinates?|center(?:3857|lonlat)|^bbox$|^(?:lat|lng|latitude|longitude)$)/;

function fail(message) {
  throw new TypeError(`Invalid Evidence Bundle v2: ${message}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactObject(value, label, keys) {
  const object = plainObject(value, label);
  const allowed = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${label}.${key} is not allowed by schema v2`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(object, key)) fail(`${label} is missing ${key}`);
  }
  return object;
}

function boundedText(value, label, maxLength = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    fail(`${label} must be non-empty bounded text`);
  }
  return value;
}

function calendarDate(value, label) {
  const text = boundedText(value, label, 10);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)
    || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`${label} must be a calendar date`);
  }
  return text;
}

function canonicalValue(value, path = 'content', seen = new WeakSet()) {
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

function assertNoSensitiveFields(value, path = 'bundle', seen = new WeakSet()) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') fail(`${path} contains unsupported data`);
  if (seen.has(value)) fail(`${path} contains circular data`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (SENSITIVE_KEY_PATTERN.test(normalized)) fail(`${path}.${key} is a prohibited sensitive field`);
      assertNoSensitiveFields(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    fail(`${label} must be an ISO timestamp`);
  }
  return text;
}

function textArray(value, label, { allowed, maxItems = 32 } = {}) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    fail(`${label} must be a non-empty bounded array`);
  }
  return value.map((item, index) => {
    const text = boundedText(item, `${label}[${index}]`);
    if (allowed && !allowed.has(text)) fail(`${label}[${index}] is unsupported`);
    return text;
  });
}

function validateActivity(value) {
  exactObject(value, 'activity', ['type', 'occurredAt', 'analysisGeneratedAt']);
  if (value.type !== 'analysis-export') fail('activity.type is unsupported');
  timestamp(value.occurredAt, 'activity.occurredAt');
  if (value.analysisGeneratedAt !== null) {
    timestamp(value.analysisGeneratedAt, 'activity.analysisGeneratedAt');
    if (value.analysisGeneratedAt > value.occurredAt) {
      fail('activity analysis time must not be after export activity');
    }
  }
}

function validateCompatibility(value) {
  exactObject(value, 'compatibility', [
    'minimumReaderMajor', 'contentVersion', 'recoveryVersion', 'readablePreviousMajors',
  ]);
  if (value.minimumReaderMajor !== 2) fail('compatibility.minimumReaderMajor is unsupported');
  if (value.contentVersion !== 'public-crime-analysis/v1') fail('compatibility.contentVersion is unsupported');
  if (value.recoveryVersion !== 'analysis-artifact/v2') fail('compatibility.recoveryVersion is unsupported');
  if (!Array.isArray(value.readablePreviousMajors)
    || value.readablePreviousMajors.length !== 1 || value.readablePreviousMajors[0] !== 1) {
    fail('compatibility.readablePreviousMajors is invalid');
  }
}

function validateScope(value) {
  exactObject(value, 'scope', ['product', 'domain', 'geography']);
  if (value.product !== EVIDENCE_BUNDLE_PUBLIC_SCOPE.product
    || value.domain !== EVIDENCE_BUNDLE_PUBLIC_SCOPE.domain
    || value.geography !== EVIDENCE_BUNDLE_PUBLIC_SCOPE.geography) {
    fail('scope is unsupported');
  }
}

function validateSourceAdapter(sourceAdapter, contractVersion) {
  if (!sourceAdapter || typeof sourceAdapter !== 'object'
    || typeof sourceAdapter.validateSources !== 'function'
    || typeof sourceAdapter.validateEvidenceAdmission !== 'function') {
    fail('a sourceAdapter with validateSources and validateEvidenceAdmission is required');
  }
  if (sourceAdapter.contractVersion !== contractVersion) {
    fail(`source contract ${String(contractVersion || '')} is unsupported`);
  }
  return sourceAdapter;
}

function validateProvenance(value, sourceAdapter) {
  exactObject(value, 'provenance', ['sourceContractVersion', 'sources']);
  const contractVersion = boundedText(value.sourceContractVersion, 'provenance.sourceContractVersion', 160);
  const adapter = validateSourceAdapter(sourceAdapter, contractVersion);
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 32) {
    fail('provenance.sources must be a non-empty bounded array');
  }
  let normalized;
  try {
    normalized = adapter.validateSources(structuredClone(value.sources));
  } catch (error) {
    fail(`provenance.sources failed its source contract: ${error?.message || error}`);
  }
  if (!Array.isArray(normalized) || normalized.length !== value.sources.length) {
    fail('sourceAdapter must return one validated source per input source');
  }
  assertNoSensitiveFields(normalized, 'provenance.sources');
  return canonicalValue(normalized, 'provenance.sources');
}

function validateTransform(value) {
  exactObject(value, 'transform', ['type', 'version', 'steps']);
  if (value.type !== 'aggregate-public-projection' || value.version !== 1) {
    fail('transform type or version is unsupported');
  }
  const steps = textArray(value.steps, 'transform.steps', { allowed: TRANSFORM_STEPS, maxItems: 8 });
  if (new Set(steps).size !== steps.length) fail('transform.steps must not contain duplicates');
  for (const required of TRANSFORM_STEPS) {
    if (!steps.includes(required)) fail(`transform.steps is missing ${required}`);
  }
}

function validateUncertainty(value) {
  exactObject(value, 'uncertainty', ['status', 'statements']);
  if (!UNCERTAINTY_STATUSES.has(value.status)) fail('uncertainty.status is invalid');
  textArray(value.statements, 'uncertainty.statements');
}

function validatePrivacy(value) {
  exactObject(value, 'privacy', ['classification', 'containsPersonalData', 'excludedFields']);
  if (value.classification !== 'public-aggregate') fail('privacy.classification is unsupported');
  if (value.containsPersonalData !== false) fail('privacy.containsPersonalData must be false');
  textArray(value.excludedFields, 'privacy.excludedFields');
}

function aggregateCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
}

function validateQuery(query) {
  exactObject(query, 'query', [
    'type', 'timeRange', 'offenseCodes', 'geography', 'comparisonRequested', 'display',
  ]);
  if (query.type !== 'crime-analysis') fail('query.type is invalid');
  exactObject(query.timeRange, 'query.timeRange', ['start', 'endExclusive', 'timeZone']);
  const start = calendarDate(query.timeRange.start, 'query.timeRange.start');
  const endExclusive = calendarDate(query.timeRange.endExclusive, 'query.timeRange.endExclusive');
  if (start >= endExclusive) fail('query.timeRange has an invalid time range');
  if (query.timeRange.timeZone !== 'America/New_York') fail('query.timeRange.timeZone is invalid');
  if (!Array.isArray(query.offenseCodes) || query.offenseCodes.length > 64) {
    fail('query.offenseCodes must be a bounded array');
  }
  query.offenseCodes.forEach((code, index) => boundedText(code, `query.offenseCodes[${index}]`, 240));
  if (typeof query.comparisonRequested !== 'boolean') fail('query.comparisonRequested must be boolean');
  exactObject(query.display, 'query.display', ['adminLevel', 'per10k']);
  if (!['districts', 'tracts'].includes(query.display.adminLevel)) fail('query.display.adminLevel is invalid');
  if (typeof query.display.per10k !== 'boolean') fail('query.display.per10k must be boolean');
  if (query.geography?.mode === 'buffer') {
    exactObject(query.geography, 'query.geography', ['mode', 'radiusM', 'exactSelection']);
    if (!Number.isFinite(query.geography.radiusM) || query.geography.radiusM <= 0) {
      fail('query.geography.radiusM must be positive and finite');
    }
    if (query.geography.exactSelection !== 'omitted-for-privacy') {
      fail('query.geography.exactSelection is invalid');
    }
  } else if (query.geography?.mode === 'district') {
    exactObject(query.geography, 'query.geography', ['mode', 'districtCode']);
    if (!/^\d{1,2}$/.test(query.geography.districtCode)) fail('query.geography.districtCode is invalid');
  } else if (query.geography?.mode === 'tract') {
    exactObject(query.geography, 'query.geography', ['mode', 'tractGEOID']);
    if (!/^\d{11}$/.test(query.geography.tractGEOID)) fail('query.geography.tractGEOID is invalid');
  } else {
    fail('query.geography.mode is invalid');
  }
}

function validatePoint(point, path) {
  const allowedKeys = ['point', 'status', 'total', 'per10k', 'topOffenses'];
  const requiredKeys = new Set(['point', 'status', 'total']);
  const object = plainObject(point, path);
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) fail(`${path}.${key} is not allowed by schema v2`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(object, key)) fail(`${path} is missing ${key}`);
  }
  if (!['A', 'B'].includes(point.point) || point.status !== 'available') fail(`${path} status or point is invalid`);
  aggregateCount(point.total, `${path}.total`);
  if (Object.hasOwn(point, 'per10k') && (!Number.isFinite(point.per10k) || point.per10k < 0)) {
    fail(`${path}.per10k must be non-negative and finite`);
  }
  if (Object.hasOwn(point, 'topOffenses')) {
    if (!Array.isArray(point.topOffenses) || point.topOffenses.length > 32) {
      fail(`${path}.topOffenses must be a bounded array`);
    }
    point.topOffenses.forEach((row, index) => {
      const rowPath = `${path}.topOffenses[${index}]`;
      exactObject(row, rowPath, ['offenseCode', 'count']);
      boundedText(row.offenseCode, `${rowPath}.offenseCode`, 240);
      aggregateCount(row.count, `${rowPath}.count`);
    });
  }
}

function validateResult(result) {
  const object = plainObject(result, 'result');
  for (const key of Object.keys(object)) {
    if (!['status', 'comparison'].includes(key)) fail(`result.${key} is not allowed by schema v2`);
  }
  if (!Object.hasOwn(result, 'status') || !RESULT_STATUSES.has(result.status)) fail('result.status is invalid');
  if (result.status === 'unavailable') {
    if (Object.hasOwn(result, 'comparison')) fail('unavailable result must not contain comparison data');
    return;
  }
  if (!Object.hasOwn(result, 'comparison')) fail('available result requires comparison data');
  const comparison = plainObject(result.comparison, 'result.comparison');
  for (const key of Object.keys(comparison)) {
    if (!['a', 'b'].includes(key)) fail(`result.comparison.${key} is not allowed by schema v2`);
  }
  if (!Object.hasOwn(comparison, 'a')) fail('result.comparison is missing a');
  validatePoint(comparison.a, 'result.comparison.a');
  if (Object.hasOwn(comparison, 'b')) validatePoint(comparison.b, 'result.comparison.b');
}

function validateCore({ query, result, limitations }) {
  validateQuery(query);
  validateResult(result);
  textArray(limitations, 'limitations');
}

function validateContent(input, { sourceAdapter } = {}) {
  validateActivity(input.activity);
  validateCompatibility(input.compatibility);
  validateScope(input.scope);
  validateCore(input);
  const sources = validateProvenance(input.provenance, sourceAdapter);
  try {
    sourceAdapter.validateEvidenceAdmission({
      sources: structuredClone(sources),
      result: structuredClone(input.result),
    });
  } catch (error) {
    fail(`source/result admission failed: ${error?.message || error}`);
  }
  validateTransform(input.transform);
  validateUncertainty(input.uncertainty);
  validatePrivacy(input.privacy);
  const sensitiveContent = Object.fromEntries(
    SECTION_NAMES.map((name) => [name, input[name]]),
  );
  assertNoSensitiveFields(sensitiveContent);
  return {
    ...canonicalValue(sensitiveContent, 'content'),
    provenance: {
      sourceContractVersion: input.provenance.sourceContractVersion,
      sources,
    },
  };
}

function validateChecksumShape(checksums) {
  exactObject(checksums, 'checksums', [
    'algorithm', 'canonicalization', 'excludedVolatileFields', 'sections', 'content',
  ]);
  if (checksums.algorithm !== 'SHA-256'
    || checksums.canonicalization !== 'sorted-json-keys/v1') {
    fail('checksums algorithm or canonicalization is unsupported');
  }
  if (!Array.isArray(checksums.excludedVolatileFields)
    || checksums.excludedVolatileFields.length !== 0) {
    fail('checksums.excludedVolatileFields is invalid');
  }
  exactObject(checksums.sections, 'checksums.sections', SECTION_NAMES);
  for (const name of [...SECTION_NAMES, 'content']) {
    const digest = name === 'content' ? checksums.content : checksums.sections[name];
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
      fail(`checksums.${name === 'content' ? 'content' : `sections.${name}`} is invalid`);
    }
  }
}

async function contentChecksums(content) {
  const sections = {};
  for (const name of SECTION_NAMES) {
    sections[name] = await sha256CanonicalValue(content[name], { excludeVolatileFields: false });
  }
  return {
    algorithm: 'SHA-256',
    canonicalization: 'sorted-json-keys/v1',
    excludedVolatileFields: [],
    sections,
    content: await sha256CanonicalValue(sections, { excludeVolatileFields: false }),
  };
}

export async function composeEvidenceBundleV2(input, { sourceAdapter } = {}) {
  exactObject(input, 'input', [
    'schemaVersion', 'generatedAt', ...SECTION_NAMES,
  ]);
  if (input.schemaVersion !== EVIDENCE_BUNDLE_V2_SCHEMA_VERSION) {
    fail(`unsupported schema version ${String(input.schemaVersion || '')}`);
  }
  const generatedAt = timestamp(input.generatedAt, 'generatedAt');
  if (input.activity.occurredAt !== generatedAt) {
    fail('activity.occurredAt must equal generatedAt');
  }
  const content = validateContent(input, { sourceAdapter });
  const checksums = await contentChecksums(content);
  return {
    schemaVersion: EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
    generatedAt,
    snapshotIdentity: `sha256:${checksums.content}`,
    ...content,
    checksums,
  };
}

export async function validateEvidenceBundleV2(bundle, { sourceAdapter } = {}) {
  exactObject(bundle, 'bundle', [
    'schemaVersion', 'generatedAt', 'snapshotIdentity', ...SECTION_NAMES, 'checksums',
  ]);
  if (bundle.schemaVersion !== EVIDENCE_BUNDLE_V2_SCHEMA_VERSION) {
    fail(`unsupported schema version ${String(bundle.schemaVersion || '')}`);
  }
  const generatedAt = timestamp(bundle.generatedAt, 'generatedAt');
  if (bundle.activity?.occurredAt !== generatedAt) {
    fail('activity.occurredAt must equal generatedAt');
  }
  const content = validateContent(bundle, { sourceAdapter });
  validateChecksumShape(bundle.checksums);
  const expected = await contentChecksums(content);
  for (const name of SECTION_NAMES) {
    if (bundle.checksums.sections[name] !== expected.sections[name]) {
      fail(`checksum mismatch for ${name}`);
    }
  }
  if (bundle.checksums.content !== expected.content
    || bundle.snapshotIdentity !== `sha256:${expected.content}`) {
    fail('checksum mismatch for content or snapshotIdentity');
  }
  return canonicalValue({
    schemaVersion: EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
    generatedAt,
    snapshotIdentity: bundle.snapshotIdentity,
    ...content,
    checksums: expected,
  }, 'bundle');
}

export function buildEvidenceBundleV2Sections({
  generatedAt,
  query,
  result,
  sourceContractVersion,
  sourceReadModels,
  analysisGeneratedAt = null,
  transformSteps = [...TRANSFORM_STEPS],
  uncertainty,
  limitations,
} = {}) {
  return {
    schemaVersion: EVIDENCE_BUNDLE_V2_SCHEMA_VERSION,
    generatedAt,
    activity: { type: 'analysis-export', occurredAt: generatedAt, analysisGeneratedAt },
    compatibility: {
      minimumReaderMajor: 2,
      contentVersion: 'public-crime-analysis/v1',
      recoveryVersion: 'analysis-artifact/v2',
      readablePreviousMajors: [1],
    },
    scope: structuredClone(EVIDENCE_BUNDLE_PUBLIC_SCOPE),
    query: structuredClone(query),
    result: structuredClone(result),
    provenance: {
      sourceContractVersion,
      sources: structuredClone(sourceReadModels),
    },
    transform: {
      type: 'aggregate-public-projection',
      version: 1,
      steps: [...transformSteps],
    },
    uncertainty: structuredClone(uncertainty),
    limitations: structuredClone(limitations),
    privacy: {
      classification: 'public-aggregate',
      containsPersonalData: false,
      excludedFields: [
        'raw incident rows',
        'exact addresses and coordinates',
        'GPS traces',
        'Diary notes and route geometry',
        'media URLs and attachments',
        'account, credential, and shared-link data',
      ],
    },
  };
}
