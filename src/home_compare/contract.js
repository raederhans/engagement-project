export const HOME_COMPARE_SCHEMA = 'engagement-home-neighborhood-compare/v1';
export const HOME_COMPARE_SHARE_SCHEMA = 'engagement-home-compare-share/v1';
export const HOME_COMPARE_DIMENSIONS = Object.freeze([
  'property',
  'costHistory',
  'civicRecords',
  'transportContext',
  'dataQuality',
]);
export const HOME_COMPARE_EVIDENCE_KEYS = Object.freeze([
  'property',
  'assessments',
  'transfers',
  'serviceRequests',
  'liHistory',
  'vacancy',
  'reportedIncidents',
  'hinContext',
]);

const ROOT_KEYS = ['schema', 'generatedAt', 'status', 'profiles', 'sources', 'areaIntelligence', 'commute', 'sensitivity', 'privacy', 'limitations', 'forbiddenClaims'];
const PROFILE_KEYS = ['profileId', 'status', 'evidence', 'limitations'];
const METRIC_KEYS = ['status', 'value', 'dataAsOf', 'coverage', 'precision', 'sourceIds', 'limitations'];
const SOURCE_KEYS = ['sourceId', 'status', 'officialUrl', 'sourceAsOf', 'retrievedAt', 'builtAt', 'observedAt', 'revision', 'coverage', 'precision', 'recordCount', 'limitations'];
const FORBIDDEN_KEY = /(?:^|_)(?:safety[_-]?score|victim[_-]?probability|safest[_-]?(?:area|route)|route[_-]?recommendation|automatic[_-]?recommendation)(?:$|_)/i;
const PRIVATE_KEY = /(?:^|_)(?:address|coordinates?|lnglat|latitude|longitude|parcel(?:id|identifier)?|opa[_-]?(?:id|account)|destination|source[_-]?record[_-]?id|owner|grantor|grantee|case[_-]?identifier|document[_-]?identifier)(?:$|_)/i;

function fail(message) {
  throw new TypeError(`Invalid Home Compare artifact: ${message}`);
}

export function validateHomeCompareProjection(value) {
  exactObject(value, ROOT_KEYS, 'root');
  if (value.schema !== HOME_COMPARE_SCHEMA) fail('unsupported schema');
  iso(value.generatedAt, 'generatedAt');
  enumValue(value.status, ['available', 'partial', 'unavailable'], 'status');
  if (!Array.isArray(value.profiles) || value.profiles.length < 2 || value.profiles.length > 4) {
    fail('profiles must contain two to four entries');
  }
  const profileIds = new Set();
  value.profiles.forEach((profile, index) => {
    exactObject(profile, PROFILE_KEYS, `profiles[${index}]`);
    boundedText(profile.profileId, 32, `profiles[${index}].profileId`);
    if (profileIds.has(profile.profileId)) fail('profileId values must be unique');
    profileIds.add(profile.profileId);
    enumValue(profile.status, ['available', 'partial', 'unavailable'], `profiles[${index}].status`);
    exactObject(profile.evidence, HOME_COMPARE_EVIDENCE_KEYS, `profiles[${index}].evidence`);
    for (const key of HOME_COMPARE_EVIDENCE_KEYS) validateMetric(profile.evidence[key], `profiles[${index}].evidence.${key}`);
    stringArray(profile.limitations, `profiles[${index}].limitations`);
  });
  if (!Array.isArray(value.sources) || !value.sources.length) fail('sources must be a non-empty array');
  const sourceIds = new Set();
  value.sources.forEach((source, index) => {
    exactObject(source, SOURCE_KEYS, `sources[${index}]`);
    boundedText(source.sourceId, 80, `sources[${index}].sourceId`);
    if (sourceIds.has(source.sourceId)) fail('sourceId values must be unique');
    sourceIds.add(source.sourceId);
    enumValue(source.status, ['current', 'partial', 'stale', 'unavailable', 'unknown'], `sources[${index}].status`);
    httpsUrl(source.officialUrl, `sources[${index}].officialUrl`);
    nullableIso(source.sourceAsOf, `sources[${index}].sourceAsOf`);
    nullableIso(source.retrievedAt, `sources[${index}].retrievedAt`);
    nullableIso(source.builtAt, `sources[${index}].builtAt`);
    nullableIso(source.observedAt, `sources[${index}].observedAt`);
    exactObject(source.revision, ['status', 'identity'], `sources[${index}].revision`);
    enumValue(source.revision.status, ['available', 'unavailable'], `sources[${index}].revision.status`);
    if (source.revision.status === 'available') boundedText(source.revision.identity, 240, `sources[${index}].revision.identity`);
    else if (source.revision.identity !== null) fail(`sources[${index}].revision.identity must be null when unavailable`);
    boundedText(source.coverage, 600, `sources[${index}].coverage`);
    boundedText(source.precision, 600, `sources[${index}].precision`);
    if (source.status === 'unavailable' || source.status === 'unknown') {
      if (source.recordCount !== null) fail(`sources[${index}].recordCount must be null when unavailable or unknown`);
    } else if (source.recordCount !== null
      && (!Number.isSafeInteger(source.recordCount) || source.recordCount < 0)) {
      fail(`sources[${index}].recordCount must be a non-negative safe integer`);
    }
    stringArray(source.limitations, `sources[${index}].limitations`);
  });
  validateAreaIntelligence(value.areaIntelligence);
  validateCommute(value.commute);
  validateSensitivity(value.sensitivity);
  exactObject(value.privacy, ['classification', 'containsPersonalData', 'excludedFields'], 'privacy');
  if (value.privacy.classification !== 'public-aggregate' || value.privacy.containsPersonalData !== false) {
    fail('privacy must declare a public aggregate without personal data');
  }
  stringArray(value.privacy.excludedFields, 'privacy.excludedFields');
  stringArray(value.limitations, 'limitations');
  stringArray(value.forbiddenClaims, 'forbiddenClaims');
  const forbidden = new Set(value.forbiddenClaims.map((claim) => claim.toLowerCase()));
  for (const required of ['safety score', 'victim probability', 'safest area', 'safest route', 'automatic recommendation']) {
    if (!forbidden.has(required)) fail(`forbiddenClaims must include ${required}`);
  }
  scanKeys(value, 'root');
  return structuredClone(value);
}

export function createHomeCompareProjection({
  generatedAt = new Date().toISOString(),
  profiles,
  sources,
  areaIntelligence,
  sensitivity,
  status,
} = {}) {
  const profileList = Array.isArray(profiles) ? profiles : [];
  const sourceList = Array.isArray(sources) ? sources : [];
  const hasAdmittedProfile = profileList.some((profile) => profile?.status !== 'unavailable');
  const hasSourceGap = sourceList.some((source) => source?.status !== 'current');
  const inferredStatus = status || (
    profileList.every((profile) => profile?.status === 'available') && !hasSourceGap ? 'available'
      : hasAdmittedProfile ? 'partial' : 'unavailable'
  );
  return validateHomeCompareProjection({
    schema: HOME_COMPARE_SCHEMA,
    generatedAt,
    status: inferredStatus,
    profiles: profileList,
    sources: sourceList,
    areaIntelligence,
    commute: {
      status: 'unavailable',
      authority: null,
      travelTimes: [],
      isochrones: [],
      reason: 'No validated road or public-transit routing authority is installed; straight-line distance and synthetic graphs are not substitutes.',
    },
    sensitivity,
    privacy: {
      classification: 'public-aggregate',
      containsPersonalData: false,
      excludedFields: [
        'input addresses',
        'normalized addresses',
        'coordinates',
        'parcel identifiers',
        'commute destinations',
        'source record identifiers',
        'owners and transaction parties',
      ],
    },
    limitations: [
      'Evidence dimensions describe public records and their coverage; they do not establish property condition, personal risk, causality, value, or suitability.',
      'Missing, partial, stale, and unavailable evidence is never converted to zero or current evidence.',
    ],
    forbiddenClaims: [
      'safety score',
      'victim probability',
      'safest area',
      'safest route',
      'automatic recommendation',
      'causal effect',
    ],
  });
}

export function createEvidenceMetric({
  status,
  value = null,
  dataAsOf = null,
  coverage,
  precision,
  sourceIds,
  limitations = [],
} = {}) {
  const metric = { status, value, dataAsOf, coverage, precision, sourceIds, limitations };
  validateMetric(metric, 'metric');
  return structuredClone(metric);
}

export function buildWeightSensitivity(weights) {
  const admitted = admitWeights(weights);
  const total = Object.values(admitted).reduce((sum, value) => sum + value, 0);
  const normalizedWeights = Object.fromEntries(HOME_COMPARE_DIMENSIONS.map((key) => [
    key,
    Math.round((admitted[key] / total) * 1000) / 10,
  ]));
  const topDimensions = orderedDimensions(admitted).slice(0, 2);
  const scenarioTops = [];
  for (const key of HOME_COMPARE_DIMENSIONS) {
    for (const factor of [0.8, 1.2]) {
      const scenario = { ...admitted, [key]: admitted[key] * factor };
      scenarioTops.push(orderedDimensions(scenario)[0]);
    }
  }
  const stableTopDimensions = topDimensions.filter((key) => scenarioTops.every((candidate) => candidate === key));
  return Object.freeze({
    normalizedWeights: Object.freeze(normalizedWeights),
    topDimensions: Object.freeze(topDimensions),
    stableTopDimensions: Object.freeze(stableTopDimensions),
    perturbationPercent: 20,
    interpretation: 'Weights reorder evidence dimensions only; they do not rank homes or create a recommendation.',
  });
}

export function encodeHomeCompareShareState({ weights, dimensions = HOME_COMPARE_DIMENSIONS } = {}) {
  const value = validateHomeCompareShareState({
    schema: HOME_COMPARE_SHARE_SCHEMA,
    weights: admitWeights(weights),
    dimensions,
  });
  return JSON.stringify(value);
}

export function decodeHomeCompareShareState(text) {
  if (typeof text !== 'string' || text.length < 2 || text.length > 4096) {
    throw new TypeError('Invalid Home Compare share state: bounded JSON text is required.');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('Invalid Home Compare share state: JSON is malformed.');
  }
  return validateHomeCompareShareState(value);
}

export function validateHomeCompareShareState(value) {
  exactObject(value, ['schema', 'weights', 'dimensions'], 'share root', 'share');
  if (value.schema !== HOME_COMPARE_SHARE_SCHEMA) throw new TypeError('Invalid Home Compare share state: unsupported schema.');
  const weights = admitWeights(value.weights);
  if (!Array.isArray(value.dimensions)
    || value.dimensions.length !== HOME_COMPARE_DIMENSIONS.length
    || value.dimensions.some((dimension, index) => dimension !== HOME_COMPARE_DIMENSIONS[index])) {
    throw new TypeError('Invalid Home Compare share state: dimensions are invalid.');
  }
  const dimensions = [...value.dimensions];
  return Object.freeze({ schema: HOME_COMPARE_SHARE_SCHEMA, weights: Object.freeze(weights), dimensions: Object.freeze(dimensions) });
}

function validateMetric(metric, label) {
  exactObject(metric, METRIC_KEYS, label);
  enumValue(metric.status, ['available', 'partial', 'stale', 'unavailable'], `${label}.status`);
  if (metric.status === 'unavailable' && metric.value !== null) fail(`${label}.value must be null when unavailable`);
  if (metric.status !== 'unavailable' && metric.value === null) fail(`${label}.value is required when evidence is admitted`);
  nullableIso(metric.dataAsOf, `${label}.dataAsOf`);
  boundedText(metric.coverage, 600, `${label}.coverage`);
  boundedText(metric.precision, 600, `${label}.precision`);
  if (!Array.isArray(metric.sourceIds) || !metric.sourceIds.length || metric.sourceIds.length > 4) fail(`${label}.sourceIds are invalid`);
  metric.sourceIds.forEach((sourceId, index) => boundedText(sourceId, 80, `${label}.sourceIds[${index}]`));
  stringArray(metric.limitations, `${label}.limitations`);
  validateJsonValue(metric.value, `${label}.value`, 0);
}

function validateAreaIntelligence(value) {
  exactObject(value, ['status', 'historicalEvidence', 'forecast'], 'areaIntelligence');
  if (value.status !== 'not-promoted') fail('areaIntelligence.status must remain not-promoted');
  exactObject(value.historicalEvidence, ['status', 'measure', 'coverage', 'limitations'], 'areaIntelligence.historicalEvidence');
  if (value.historicalEvidence.status !== 'available' || value.historicalEvidence.measure !== 'PPD reported incidents') {
    fail('areaIntelligence historical evidence contract is invalid');
  }
  boundedText(value.historicalEvidence.coverage, 600, 'areaIntelligence.historicalEvidence.coverage');
  stringArray(value.historicalEvidence.limitations, 'areaIntelligence.historicalEvidence.limitations');
  exactObject(value.forecast, ['status', 'reason', 'predictions'], 'areaIntelligence.forecast');
  if (value.forecast.status !== 'unavailable' || value.forecast.reason !== 'model-did-not-exceed-predefined-seasonal-baseline'
    || !Array.isArray(value.forecast.predictions) || value.forecast.predictions.length !== 0) {
    fail('areaIntelligence forecast must remain unavailable with no predictions');
  }
}

function validateCommute(value) {
  exactObject(value, ['status', 'authority', 'travelTimes', 'isochrones', 'reason'], 'commute');
  if (value.status !== 'unavailable' || value.authority !== null
    || !Array.isArray(value.travelTimes) || value.travelTimes.length
    || !Array.isArray(value.isochrones) || value.isochrones.length) {
    fail('commute must remain unavailable without travel times or isochrones');
  }
  boundedText(value.reason, 600, 'commute.reason');
}

function validateSensitivity(value) {
  exactObject(value, ['normalizedWeights', 'topDimensions', 'stableTopDimensions', 'perturbationPercent', 'interpretation'], 'sensitivity');
  exactObject(value.normalizedWeights, HOME_COMPARE_DIMENSIONS, 'sensitivity.normalizedWeights');
  for (const key of HOME_COMPARE_DIMENSIONS) {
    const number = value.normalizedWeights[key];
    if (!Number.isFinite(number) || number < 0 || number > 100) fail(`sensitivity.normalizedWeights.${key} is invalid`);
  }
  dimensionArray(value.topDimensions, 'sensitivity.topDimensions');
  dimensionArray(value.stableTopDimensions, 'sensitivity.stableTopDimensions');
  if (value.perturbationPercent !== 20) fail('sensitivity perturbation must remain 20 percent');
  boundedText(value.interpretation, 400, 'sensitivity.interpretation');
}

function admitWeights(value) {
  exactObject(value, HOME_COMPARE_DIMENSIONS, 'weights', 'share');
  const weights = {};
  let positive = false;
  for (const key of HOME_COMPARE_DIMENSIONS) {
    const number = Number(value[key]);
    if (!Number.isInteger(number) || number < 0 || number > 100) {
      throw new TypeError(`Invalid Home Compare share state: weight ${key} must be an integer from 0 to 100.`);
    }
    weights[key] = number;
    positive ||= number > 0;
  }
  if (!positive) throw new TypeError('Invalid Home Compare share state: at least one weight must be positive.');
  return weights;
}

function orderedDimensions(weights) {
  return [...HOME_COMPARE_DIMENSIONS].sort((left, right) => weights[right] - weights[left] || left.localeCompare(right));
}

function exactObject(value, keys, label, namespace = 'artifact') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const prefix = namespace === 'share' ? 'Invalid Home Compare share state' : 'Invalid Home Compare artifact';
    throw new TypeError(`${prefix}: ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const prefix = namespace === 'share' ? 'Invalid Home Compare share state' : 'Invalid Home Compare artifact';
    throw new TypeError(`${prefix}: ${label} fields are invalid.`);
  }
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} is invalid`);
}

function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) fail(`${label} is invalid`);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length > 20) fail(`${label} must be a bounded array`);
  value.forEach((item, index) => boundedText(item, 800, `${label}[${index}]`));
}

function dimensionArray(value, label) {
  if (!Array.isArray(value) || value.length > HOME_COMPARE_DIMENSIONS.length) fail(`${label} is invalid`);
  value.forEach((item) => { if (!HOME_COMPARE_DIMENSIONS.includes(item)) fail(`${label} contains an unknown dimension`); });
}

function iso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO timestamp`);
}

function nullableIso(value, label) {
  if (value !== null) iso(value, label);
}

function httpsUrl(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error();
  } catch {
    fail(`${label} must be an HTTPS URL`);
  }
}

function validateJsonValue(value, label, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return;
  }
  if (depth > 5) fail(`${label} exceeds the nesting limit`);
  if (Array.isArray(value)) {
    if (value.length > 24) fail(`${label} exceeds the array limit`);
    value.forEach((item, index) => validateJsonValue(item, `${label}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') fail(`${label} contains an unsupported value`);
  const keys = Object.keys(value);
  if (keys.length > 24) fail(`${label} exceeds the property limit`);
  for (const key of keys) {
    if (FORBIDDEN_KEY.test(key) || PRIVATE_KEY.test(key)) fail(`${label} contains forbidden field ${key}`);
    validateJsonValue(value[key], `${label}.${key}`, depth + 1);
  }
}

function scanKeys(value, path) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key) || PRIVATE_KEY.test(key)) fail(`${path} contains forbidden field ${key}`);
    scanKeys(child, `${path}.${key}`);
  }
}
