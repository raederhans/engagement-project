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
const EN_WORD = '[a-z0-9][a-z0-9-]*';
const EN_DIRECT_SUBJECT = `(?:(?:the|this|that|your|a|an|no|neither) (?:${EN_WORD} ){1,4}|not every (?:${EN_WORD} ){1,4}|(?:${EN_WORD} ){1,2})`;
const EN_RESIDENTIAL_SUBJECT = '(?:(?:the|this|that|your|a|an) )?(?:home|property|route|area|neighbou?rhood|community|street|block|residence)(?: [0-9]+)?';
const EN_EFFECT = '(?:reduc|increas|lower|rais|prevent|caus|decreas|stop)\\w*';
const EN_HARM = '(?:crime|incidents?|risk|harm|victimization)';
const ZH_SUBJECT = '(?:[该这本])?(?:住宅|房[屋产]|路线|区域|社区|小区|街道|街区)';
const ZH_EFFECT = '(?:降低|减少|增加|提高|预防|防止|导致|造成|阻止)';
const ZH_HARM = '(?:犯罪|事件|风险|伤害|受害(?:事件)?)';
const DIRECT_SAFETY_EN = new RegExp(`\\b(?<subject>${EN_DIRECT_SUBJECT})(?:is|has|remains|offers|poses) (?:the )?(?<claim>safe(?:r|st)?|(?:low(?:er|est)?|no)[- ]risk)\\b`, 'gi');
const DIRECT_RISK_EN = new RegExp(`\\b(?<subject>${EN_DIRECT_SUBJECT})risk (?:is|remains) (?:the )?(?:low(?:er|est)?)\\b`, 'gi');
const DIRECT_SAFETY_ZH = new RegExp(`(?<subject>${ZH_SUBJECT})(?:是|属于)?(?<claim>(?:最|更)?安全|没有风险|风险(?:为)?最低|(?:最低|低|无)风险)`, 'g');
const DOUBLE_NEGATED_SAFETY_EN = new RegExp(`\\b${EN_DIRECT_SUBJECT}(?:is|remains) not unsafe\\b`, 'i');
const DOUBLE_NEGATED_SAFETY_ZH = new RegExp(`${ZH_SUBJECT}(?:不是|并非)不安全(?:[，,](?:而是)?(?:最|更)?安全)?`);
const ACTIVE_CAUSAL_EN = new RegExp(`\\b${EN_RESIDENTIAL_SUBJECT} (?:(?<negation>does not|cannot|can't) )?${EN_EFFECT} (?:not ${EN_WORD} but )?${EN_HARM}\\b`, 'gi');
const PASSIVE_CAUSAL_EN = new RegExp(`\\b${EN_HARM} (?:is|are|was|were) (?:(?<negation>not) )?${EN_EFFECT} by ${EN_RESIDENTIAL_SUBJECT}\\b`, 'gi');
const MASKED_CAUSAL_EN = new RegExp(`\\b(?:${EN_RESIDENTIAL_SUBJECT} (?:does not|cannot|can't) ${EN_EFFECT} ${EN_HARM} but (?:does |is )?${EN_EFFECT} ${EN_HARM}|${EN_HARM} (?:is|are|was|were) not ${EN_EFFECT} but (?:is|are|was|were) ${EN_EFFECT} by ${EN_RESIDENTIAL_SUBJECT})\\b`, 'i');
const ACTIVE_CAUSAL_ZH = new RegExp(`${ZH_SUBJECT}(?<negation>不|不能|没有)?${ZH_EFFECT}${ZH_HARM}`, 'g');
const REVERSE_CAUSAL_ZH = new RegExp(`${ZH_HARM}(?<negation>没有)?(?:被|由|因)${ZH_SUBJECT}(?:而)?${ZH_EFFECT}`, 'g');
const MASKED_CAUSAL_ZH = new RegExp(`${ZH_HARM}没有${ZH_EFFECT}反而因${ZH_SUBJECT}而${ZH_EFFECT}`);
const EVIDENCE_ASSERTION_EN = /\b(?:(?<negation>do(?:es)? not|cannot(?: be)?|can't(?: be)?) )?(?:prov|establish|show|indicat|mean|convert)\w*.{0,40}\b(?:safe(?:r|st)?|safety|risk|victim[- ]probability|caus\w*)\b/gi;
const EVIDENCE_ASSERTION_ZH = /(?:(?<negation>不能|没有(?:可靠)?证据))?(?:证明|表明|说明).{0,24}(?:安全|风险|因果|受害(?:者)?概率)/g;
const QUANTIFIED_DENIAL_EN = /^(?:(?:no|neither) [a-z0-9-]+|not every [a-z0-9-]+)$/i;
const METADATA_SUBJECT = /^(?:the )?(?:source|product|dataset)$/i;
const METADATA_TAIL = /^(?:-route label| (?:fields?|labels?|categories?|contexts?|trends?|counts?)\b| and (?:high|low)[- ]risk categor(?:y|ies) labels?\b)/i;
const OPERATIONAL_SUBJECT = /\b(?:parser|loader|request|operation)$/i;
const OPERATIONAL_METADATA_TAIL = /^ to (?:retry|parse|load)\b/i;
const EVIDENCE_DENIAL_EN = /(?:(?:there is )?no (?:(?:reliable|currently admitted) )?(?:evidence|proof)(?: (?:that|shows?|proves?|indicates?) (?:the )?)?|(?:do(?:es)? not|cannot|can't) (?:prove|establish|show|mean|indicate)(?: that)? )$/i;
const EVIDENCE_DENIAL_ZH = /(?:没有(?:可靠)?证据(?:表明|证明)|不能(?:证明|表明|说明))[该这本]?$/;
const QUANTIFIED_DENIAL_ZH = /没有(?:一个)?$/;
const PRIVATE_TOKEN = /^(?:address(?:es)?|coordinates?|latitude|longitude|lat|lon|lng(?:lat)?|geometry|parcels?|destinations?|owners?|grantors?|grantees?)$/;

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
    if (profile.status !== inferHomeProfileStatus(profile.evidence)) {
      fail('status mismatch');
    }
    conclusionTextArray(profile.limitations, `profiles[${index}].limitations`);
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
    boundedConclusionText(source.coverage, 600, `sources[${index}].coverage`);
    boundedConclusionText(source.precision, 600, `sources[${index}].precision`);
    if (source.status === 'unavailable' || source.status === 'unknown') {
      if (source.recordCount !== null) fail(`sources[${index}].recordCount must be null when unavailable or unknown`);
    } else if (source.recordCount !== null
      && (!Number.isSafeInteger(source.recordCount) || source.recordCount < 0)) {
      fail(`sources[${index}].recordCount must be a non-negative safe integer`);
    }
    conclusionTextArray(source.limitations, `sources[${index}].limitations`);
  });
  if (value.status !== inferProjectionStatus(value.profiles, value.sources)) {
    fail('status mismatch');
  }
  validateAreaIntelligence(value.areaIntelligence);
  validateCommute(value.commute);
  validateSensitivity(value.sensitivity);
  exactObject(value.privacy, ['classification', 'containsPersonalData', 'excludedFields'], 'privacy');
  if (value.privacy.classification !== 'public-aggregate' || value.privacy.containsPersonalData !== false) {
    fail('privacy must declare a public aggregate without personal data');
  }
  stringArray(value.privacy.excludedFields, 'privacy.excludedFields');
  conclusionTextArray(value.limitations, 'limitations');
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
} = {}) {
  const profileList = Array.isArray(profiles) ? profiles : [];
  const sourceList = Array.isArray(sources) ? sources : [];
  return validateHomeCompareProjection({
    schema: HOME_COMPARE_SCHEMA,
    generatedAt,
    status: inferProjectionStatus(profileList, sourceList),
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

export function inferHomeProfileStatus(evidence) {
  const statuses = HOME_COMPARE_EVIDENCE_KEYS.map((key) => evidence[key].status);
  return statuses.every((status) => status === 'available')
    ? 'available'
    : statuses.some((status) => status && status !== 'unavailable') ? 'partial' : 'unavailable';
}

function inferProjectionStatus(profiles, sources) {
  if (profiles.every((profile) => profile?.status === 'available')
    && sources.every((source) => source?.status === 'current')) {
    return 'available';
  }
  return profiles.some((profile) => profile?.status !== 'unavailable') ? 'partial' : 'unavailable';
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
  const normalizedWeights = normalizeWeights(admitted, total);
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
  boundedConclusionText(metric.coverage, 600, `${label}.coverage`);
  boundedConclusionText(metric.precision, 600, `${label}.precision`);
  if (!Array.isArray(metric.sourceIds) || !metric.sourceIds.length || metric.sourceIds.length > 4) fail(`${label}.sourceIds are invalid`);
  metric.sourceIds.forEach((sourceId, index) => boundedText(sourceId, 80, `${label}.sourceIds[${index}]`));
  conclusionTextArray(metric.limitations, `${label}.limitations`);
  validateJsonValue(metric.value, `${label}.value`, 0);
}

function validateAreaIntelligence(value) {
  exactObject(value, ['status', 'historicalEvidence', 'forecast'], 'areaIntelligence');
  if (value.status !== 'not-promoted') fail('areaIntelligence.status must remain not-promoted');
  exactObject(value.historicalEvidence, ['status', 'measure', 'coverage', 'limitations'], 'areaIntelligence.historicalEvidence');
  if (value.historicalEvidence.status !== 'available' || value.historicalEvidence.measure !== 'PPD reported incidents') {
    fail('areaIntelligence historical evidence contract is invalid');
  }
  boundedConclusionText(value.historicalEvidence.coverage, 600, 'areaIntelligence.historicalEvidence.coverage');
  conclusionTextArray(value.historicalEvidence.limitations, 'areaIntelligence.historicalEvidence.limitations');
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
  boundedConclusionText(value.reason, 600, 'commute.reason');
}

export function validateHomeCompareAreaIntelligenceBoundary(value) {
  validateAreaIntelligence(value);
  return structuredClone(value);
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
  boundedConclusionText(value.interpretation, 400, 'sensitivity.interpretation');
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

function normalizeWeights(weights, total) {
  const allocations = HOME_COMPARE_DIMENSIONS.map((key, index) => {
    const exactTenths = (weights[key] / total) * 1000;
    const tenths = Math.floor(exactTenths);
    return { key, index, tenths, remainder: exactTenths - tenths };
  });
  const remaining = 1000 - allocations.reduce((sum, allocation) => sum + allocation.tenths, 0);
  const byRemainder = [...allocations].sort((left, right) => (
    right.remainder - left.remainder || left.index - right.index
  ));
  for (let index = 0; index < remaining; index += 1) byRemainder[index].tenths += 1;
  return Object.freeze(Object.fromEntries(allocations.map(({ key, tenths }) => [key, tenths / 10])));
}

function rejectUnsafeConclusion(value, label) {
  const text = value.normalize('NFKC').replace(/\s+/g, ' ');
  if (hasDirectAssertion(text) || hasCausalAssertion(text) || hasEvidenceAssertion(text)) {
    fail(`${label} has an unsafe conclusion`);
  }
}

function hasDirectAssertion(text) {
  if (DOUBLE_NEGATED_SAFETY_EN.test(text) || DOUBLE_NEGATED_SAFETY_ZH.test(text)) return true;
  for (const pattern of [DIRECT_SAFETY_EN, DIRECT_RISK_EN]) {
    for (const match of text.matchAll(pattern)) {
      const subject = match.groups.subject.trim();
      const tail = text.slice(match.index + match[0].length);
      if (QUANTIFIED_DENIAL_EN.test(subject)
        || hasEvidenceDenial(text, match.index)
        || (METADATA_SUBJECT.test(subject) && METADATA_TAIL.test(tail))
        || (OPERATIONAL_SUBJECT.test(subject) && OPERATIONAL_METADATA_TAIL.test(tail))) continue;
      return true;
    }
  }
  for (const match of text.matchAll(DIRECT_SAFETY_ZH)) {
    if (hasEvidenceDenial(text, match.index) || QUANTIFIED_DENIAL_ZH.test(text.slice(0, match.index))) continue;
    return true;
  }
  return false;
}

function hasCausalAssertion(text) {
  if (MASKED_CAUSAL_EN.test(text) || MASKED_CAUSAL_ZH.test(text)) return true;
  for (const pattern of [ACTIVE_CAUSAL_EN, PASSIVE_CAUSAL_EN, ACTIVE_CAUSAL_ZH, REVERSE_CAUSAL_ZH]) {
    for (const match of text.matchAll(pattern)) {
      if (match.groups.negation || hasEvidenceDenial(text, match.index)) continue;
      return true;
    }
  }
  return false;
}

function hasEvidenceAssertion(text) {
  for (const pattern of [EVIDENCE_ASSERTION_EN, EVIDENCE_ASSERTION_ZH]) {
    for (const match of text.matchAll(pattern)) {
      if (match.groups.negation || hasEvidenceDenial(text, match.index)) continue;
      return true;
    }
  }
  return false;
}

function hasEvidenceDenial(text, index) {
  const prefix = text.slice(0, index).slice(-120);
  return EVIDENCE_DENIAL_EN.test(prefix) || EVIDENCE_DENIAL_ZH.test(prefix);
}

function normalizeKeyTokens(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

function hasAny(tokenSet, ...tokens) {
  return tokens.some((token) => tokenSet.has(token));
}

function isPrivateFieldKey(key) {
  const tokens = normalizeKeyTokens(key);
  const tokenSet = new Set(tokens);
  if (tokens.some((token) => PRIVATE_TOKEN.test(token))) return true;
  if (tokenSet.has('opa') && hasAny(tokenSet, 'account', 'acct', 'id', 'identifier')) return true;
  if (tokenSet.has('source') && tokenSet.has('record') && hasAny(tokenSet, 'id', 'identifier')) return true;
  if (hasAny(tokenSet, 'case', 'document') && hasAny(tokenSet, 'id', 'identifier')) return true;
  if (tokenSet.has('point') && hasAny(tokenSet, 'x', 'y')) return true;
  if (tokenSet.has('location') && (tokens.length === 1 || hasAny(tokenSet, 'normalized', 'generalized', 'block'))) return true;
  return false;
}

function isForbiddenFieldKey(key) {
  const tokenSet = new Set(normalizeKeyTokens(key));
  return (tokenSet.has('safety') && tokenSet.has('score'))
    || (tokenSet.has('victim') && tokenSet.has('probability'))
    || (tokenSet.has('safest') && hasAny(tokenSet, 'area', 'route'))
    || (tokenSet.has('route') && tokenSet.has('recommendation'))
    || (tokenSet.has('automatic') && tokenSet.has('recommendation'));
}

function exactObject(value, keys, label, namespace = 'artifact') {
  const prefix = namespace === 'share' ? 'Invalid Home Compare share state' : 'Invalid Home Compare artifact';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${prefix}: ${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${prefix}: ${label} fields are invalid.`);
  }
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} is invalid`);
}

function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\p{Cc}\p{Cf}]/u.test(value)) fail(`${label} is invalid`);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length > 20) fail(`${label} must be a bounded array`);
  value.forEach((item, index) => boundedText(item, 800, `${label}[${index}]`));
}

function boundedConclusionText(value, maximum, label) {
  boundedText(value, maximum, label);
  rejectUnsafeConclusion(value, label);
}

function conclusionTextArray(value, label) {
  stringArray(value, label);
  value.forEach((item, index) => rejectUnsafeConclusion(item, `${label}[${index}]`));
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
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    boundedConclusionText(value, 800, label);
    return;
  }
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
    if (isForbiddenFieldKey(key) || isPrivateFieldKey(key)) fail(`${label} contains forbidden field ${key}`);
    validateJsonValue(value[key], `${label}.${key}`, depth + 1);
  }
}

function scanKeys(value, path) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenFieldKey(key) || isPrivateFieldKey(key)) fail(`${path} contains forbidden field ${key}`);
    scanKeys(child, `${path}.${key}`);
  }
}
