import {
  evaluateRouteAlternativesM5Core,
  M5_SCHEMA_VERSIONS,
} from '../route_alternatives_m5/index.js';

export const PUBLIC_ROUTE_SCENARIO_SCHEMA =
  'engagement-public-route-scenarios/v1';

const ARTIFACT_CLASS = 'illustrative-precomputed-public-scenario';
const MAX_CANDIDATES = 4;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,159})$/;
const METRIC_KEYS = Object.freeze([
  'travelTime',
  'distance',
  'historicalReportedIncidentExposure',
  'crash',
  'highInjuryNetwork',
  'accessibility',
  'mapMatchQuality',
  'freshness',
  'uncertainty',
]);
const METRIC_SPECS = Object.freeze({
  travelTime: Object.freeze({
    type: 'number', units: ['seconds'], min: 1, max: 86_400, source: 'required',
  }),
  distance: Object.freeze({
    type: 'number', units: ['meters'], min: 1, max: 100_000, source: 'required',
  }),
  historicalReportedIncidentExposure: Object.freeze({
    type: 'number',
    units: [
      'historical-reported-incident-exposure-units',
      'reported-incidents-per-kilometer',
    ],
    min: 0,
    max: 1_000_000,
    source: 'required',
  }),
  crash: Object.freeze({
    type: 'number', units: ['historical-crashes'], min: 0, max: 100_000, integer: true,
    source: 'required',
  }),
  highInjuryNetwork: Object.freeze({
    type: 'number', units: ['route-share'], min: 0, max: 1, source: 'required',
  }),
  accessibility: Object.freeze({
    type: 'enum', values: ['meets', 'does-not-meet'], units: [null], source: 'required',
  }),
  mapMatchQuality: Object.freeze({
    type: 'number', units: ['matched-edge-share'], min: 0, max: 1, source: 'required',
  }),
  freshness: Object.freeze({
    type: 'number', units: ['days-at-artifact-build'], min: 0, max: 36_600,
    integer: true, source: 'required',
  }),
  uncertainty: Object.freeze({
    type: 'enum', values: ['illustrative-only'], units: [null], source: 'forbidden',
  }),
});
const EVIDENCE_METRIC_KEYS = Object.freeze([
  'historicalReportedIncidentExposure',
  'crash',
  'highInjuryNetwork',
  'accessibility',
  'freshness',
]);
const RUNTIME_BOUNDARY_KEYS = Object.freeze([
  'privateInputAccepted',
  'arbitraryOdAccepted',
  'networkRoutingAllowed',
  'candidateGenerationAllowed',
  'routingAuthority',
  'safetyAuthority',
]);
const SCENARIO_ALLOWLIST = Object.freeze({
  'city-hall-to-art-museum-complete': Object.freeze({
    origin: 'philadelphia-city-hall',
    destination: 'philadelphia-museum-of-art',
  }),
  'independence-hall-to-reading-terminal-single': Object.freeze({
    origin: 'independence-hall',
    destination: 'reading-terminal-market',
  }),
  'rittenhouse-square-to-30th-street-degraded': Object.freeze({
    origin: 'rittenhouse-square',
    destination: '30th-street-station',
  }),
});
const ADMISSION_STATES = Object.freeze({
  candidateSet: new Set(['complete', 'single', 'degraded']),
  evidence: new Set(['complete', 'partial', 'unavailable']),
  mapMatch: new Set(['complete', 'low-quality', 'unavailable']),
  sensitivity: new Set(['complete', 'unstable', 'unavailable']),
});
const PROHIBITED_COPY = Object.freeze([
  /\bsafest\b/i,
  /\bbest route\b/i,
  /\brisk score\b/i,
  /\bsafety score\b/i,
  /最安全/,
  /最佳路线/,
  /风险评分/,
  /安全评分/,
]);
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail(message) {
  throw new TypeError(`public route scenarios contract: ${message}`);
}

function exactObject(raw, keys, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.getPrototypeOf(raw) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.some((key) => typeof key !== 'string')
    || ownKeys.length !== keys.length
    || keys.some((key) => !Object.hasOwn(raw, key))) {
    fail(`${label} must contain exactly ${keys.join(', ')}`);
  }
  return raw;
}

function strictArray(raw, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    fail(`${label} must contain ${min}-${max} entries`);
  }
  return raw;
}

function id(raw, label) {
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) fail(`${label} is invalid`);
  return raw;
}

function boundedText(raw, label, max = 500) {
  if (typeof raw !== 'string') fail(`${label} must be text`);
  const value = raw.trim();
  if (!value || value.length > max) fail(`${label} is empty or too long`);
  if (PROHIBITED_COPY.some((pattern) => pattern.test(value))) {
    fail(`${label} crosses the public copy boundary`);
  }
  return value;
}

function localizedText(raw, label) {
  const value = exactObject(raw, ['en', 'zh-CN'], label);
  return {
    en: boundedText(value.en, `${label}.en`),
    'zh-CN': boundedText(value['zh-CN'], `${label}.zh-CN`),
  };
}

function nullableText(raw, label, max = 160) {
  if (raw === null) return null;
  return boundedText(raw, label, max);
}

function availableMetricValue(raw, spec, label) {
  if (spec.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)
      || raw < spec.min || raw > spec.max || (spec.integer && !Number.isInteger(raw))) {
      fail(`${label} is outside its admitted numeric domain`);
    }
    return raw;
  }
  if (typeof raw !== 'string' || !spec.values.includes(raw)) {
    fail(`${label} is outside its admitted categorical domain`);
  }
  return raw;
}

function admitMetric(raw, spec, label) {
  const value = exactObject(
    raw,
    ['status', 'value', 'unit', 'sourceAsOf', 'note'],
    label,
  );
  if (value.status === 'unavailable') {
    if (value.value !== null || value.unit !== null || value.sourceAsOf !== null) {
      fail(`${label} unavailable values must remain null`);
    }
    return {
      status: 'unavailable',
      value: null,
      unit: null,
      sourceAsOf: null,
      note: localizedText(value.note, `${label}.note`),
    };
  }
  if (value.status !== 'available') fail(`${label}.status is unsupported`);
  if (!spec.units.includes(value.unit)) fail(`${label}.unit is unsupported`);
  const sourceAsOf = nullableText(value.sourceAsOf, `${label}.sourceAsOf`);
  if (spec.source === 'required'
    && (!sourceAsOf || !ISO_INSTANT_PATTERN.test(sourceAsOf)
      || Number.isNaN(Date.parse(sourceAsOf)))) {
    fail(`${label}.sourceAsOf must be an ISO instant`);
  }
  if (spec.source === 'forbidden' && sourceAsOf !== null) {
    fail(`${label}.sourceAsOf must remain null`);
  }
  return {
    status: 'available',
    value: availableMetricValue(value.value, spec, `${label}.value`),
    unit: value.unit,
    sourceAsOf,
    note: localizedText(value.note, `${label}.note`),
  };
}

function admitMetrics(raw, label) {
  const value = exactObject(raw, METRIC_KEYS, label);
  return Object.fromEntries(METRIC_KEYS.map((key) => [
    key,
    admitMetric(value[key], METRIC_SPECS[key], `${label}.${key}`),
  ]));
}

function assertAdmissionConsistency(admission, candidates, label) {
  const mapMatchAvailable = candidates.map(
    ({ metrics }) => metrics.mapMatchQuality.status === 'available',
  );
  if (admission.mapMatch === 'complete' && !mapMatchAvailable.every(Boolean)) {
    fail(`${label}.mapMatch complete conflicts with candidate metrics`);
  }
  if (admission.mapMatch === 'low-quality' && !mapMatchAvailable.every(Boolean)) {
    fail(`${label}.mapMatch low-quality requires assessed candidate metrics`);
  }
  if (admission.mapMatch === 'unavailable' && mapMatchAvailable.some(Boolean)) {
    fail(`${label}.mapMatch unavailable conflicts with candidate metrics`);
  }

  const evidenceStates = candidates.flatMap(({ metrics }) => (
    EVIDENCE_METRIC_KEYS.map((key) => metrics[key].status === 'available')
  ));
  if (admission.evidence === 'complete' && !evidenceStates.every(Boolean)) {
    fail(`${label}.evidence complete conflicts with candidate metrics`);
  }
  if (admission.evidence === 'partial'
    && (!evidenceStates.some(Boolean) || evidenceStates.every(Boolean))) {
    fail(`${label}.evidence partial must contain available and unavailable metrics`);
  }
  if (admission.evidence === 'unavailable' && evidenceStates.some(Boolean)) {
    fail(`${label}.evidence unavailable conflicts with candidate metrics`);
  }

  const comparisonReady = admission.candidateSet === 'complete'
    && admission.evidence === 'complete'
    && admission.mapMatch === 'complete';
  if (admission.sensitivity !== 'unavailable' && !comparisonReady) {
    fail(`${label}.sensitivity requires a complete comparison admission`);
  }
  if (admission.candidateSet !== 'complete' && admission.sensitivity !== 'unavailable') {
    fail(`${label}.sensitivity conflicts with candidate-set admission`);
  }
  if (admission.candidateSet === 'complete') {
    const exposureUnits = new Set(candidates.map(
      ({ metrics }) => metrics.historicalReportedIncidentExposure.unit,
    ));
    if (exposureUnits.size !== 1) fail(`${label} comparison exposure units must match`);
  }
}

function admitCandidate(raw, index, scenarioId) {
  const label = `scenario ${scenarioId}.candidates[${index}]`;
  const value = exactObject(raw, ['candidateId', 'label', 'edgeIds', 'metrics'], label);
  const candidateId = id(value.candidateId, `${label}.candidateId`);
  const edgeIds = strictArray(value.edgeIds, `${label}.edgeIds`, { min: 1, max: 200 })
    .map((edgeId, edgeIndex) => id(edgeId, `${label}.edgeIds[${edgeIndex}]`));
  if (new Set(edgeIds).size !== edgeIds.length) fail(`${label}.edgeIds must be unique`);
  return {
    candidateId,
    label: localizedText(value.label, `${label}.label`),
    edgeIds,
    metrics: admitMetrics(value.metrics, `${label}.metrics`),
  };
}

function admitLandmark(raw, label) {
  const value = exactObject(raw, ['landmarkId', 'label'], label);
  return {
    landmarkId: id(value.landmarkId, `${label}.landmarkId`),
    label: localizedText(value.label, `${label}.label`),
  };
}

function admitAdmission(raw, label) {
  const value = exactObject(raw, ['candidateSet', 'evidence', 'mapMatch', 'sensitivity'], label);
  for (const [key, allowed] of Object.entries(ADMISSION_STATES)) {
    if (!allowed.has(value[key])) fail(`${label}.${key} is unsupported`);
  }
  return { ...value };
}

function admitScenario(raw, index) {
  const label = `scenarios[${index}]`;
  const value = exactObject(
    raw,
    ['scenarioId', 'label', 'origin', 'destination', 'mode', 'admission', 'candidates'],
    label,
  );
  const scenarioId = id(value.scenarioId, `${label}.scenarioId`);
  const allowlisted = SCENARIO_ALLOWLIST[scenarioId];
  if (!allowlisted) fail(`${label}.scenarioId is not allowlisted`);
  const origin = admitLandmark(value.origin, `${label}.origin`);
  const destination = admitLandmark(value.destination, `${label}.destination`);
  if (origin.landmarkId !== allowlisted.origin
    || destination.landmarkId !== allowlisted.destination) {
    fail(`${label} landmark pair does not match the allowlist`);
  }
  if (value.mode !== 'walking') fail(`${label}.mode must be walking`);
  const admission = admitAdmission(value.admission, `${label}.admission`);
  const candidates = strictArray(value.candidates, `${label}.candidates`, {
    min: 1,
    max: MAX_CANDIDATES,
  }).map((candidate, candidateIndex) => admitCandidate(candidate, candidateIndex, scenarioId));
  if (new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length) {
    fail(`${label}.candidateId values must be unique`);
  }
  if (admission.candidateSet === 'single' && candidates.length !== 1) {
    fail(`${label} single admission requires exactly one candidate`);
  }
  if (admission.candidateSet === 'complete' && candidates.length < 2) {
    fail(`${label} complete admission requires multiple candidates`);
  }
  assertAdmissionConsistency(admission, candidates, label);
  return {
    scenarioId,
    label: localizedText(value.label, `${label}.label`),
    origin,
    destination,
    mode: 'walking',
    admission,
    candidates,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function admitPublicRouteScenarioArtifact(raw) {
  const value = exactObject(
    raw,
    [
      'schemaVersion',
      'artifactId',
      'artifactClass',
      'generatedAt',
      'walkingOnly',
      'runtimeBoundary',
      'scenarios',
    ],
    'artifact',
  );
  if (value.schemaVersion !== PUBLIC_ROUTE_SCENARIO_SCHEMA) {
    fail('artifact.schemaVersion is unsupported');
  }
  if (value.artifactClass !== ARTIFACT_CLASS || value.walkingOnly !== true) {
    fail('artifact class or walking-only boundary is invalid');
  }
  const runtimeBoundary = exactObject(
    value.runtimeBoundary,
    RUNTIME_BOUNDARY_KEYS,
    'artifact.runtimeBoundary',
  );
  for (const key of RUNTIME_BOUNDARY_KEYS) {
    if (runtimeBoundary[key] !== false) fail(`artifact.runtimeBoundary.${key} must be false`);
  }
  const scenarios = strictArray(value.scenarios, 'artifact.scenarios', { min: 1, max: 3 })
    .map(admitScenario);
  if (new Set(scenarios.map(({ scenarioId }) => scenarioId)).size !== scenarios.length) {
    fail('artifact.scenarioId values must be unique');
  }
  if (scenarios.length !== Object.keys(SCENARIO_ALLOWLIST).length
    || Object.keys(SCENARIO_ALLOWLIST).some(
      (scenarioId) => !scenarios.some((scenario) => scenario.scenarioId === scenarioId),
    )) {
    fail('artifact must contain the complete public scenario allowlist');
  }
  return deepFreeze({
    schemaVersion: PUBLIC_ROUTE_SCENARIO_SCHEMA,
    artifactId: id(value.artifactId, 'artifact.artifactId'),
    artifactClass: ARTIFACT_CLASS,
    generatedAt: boundedText(value.generatedAt, 'artifact.generatedAt', 64),
    walkingOnly: true,
    runtimeBoundary: Object.fromEntries(RUNTIME_BOUNDARY_KEYS.map((key) => [key, false])),
    scenarios,
  });
}

function localized(value, locale) {
  return value[locale === 'zh-CN' ? 'zh-CN' : 'en'];
}

function numericMetric(candidate, key) {
  const metric = candidate.metrics[key];
  return metric.status === 'available' && typeof metric.value === 'number'
    ? metric.value
    : null;
}

function fullAdmissionAvailable(scenario) {
  if (scenario.admission.candidateSet !== 'complete'
    || scenario.admission.evidence !== 'complete'
    || scenario.admission.mapMatch !== 'complete'
    || !['complete', 'unstable'].includes(scenario.admission.sensitivity)) return false;
  return scenario.candidates.every((candidate) => (
    numericMetric(candidate, 'travelTime') > 0
    && numericMetric(candidate, 'distance') > 0
    && numericMetric(candidate, 'historicalReportedIncidentExposure') !== null
  ));
}

function accessibilityState(candidate) {
  const metric = candidate.metrics.accessibility;
  if (metric.status !== 'available') return 'unavailable';
  return metric.value === 'meets' ? 'complete-meets' : 'complete-does-not-meet';
}

function coreInputFor(scenario) {
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.coreInput,
    searchState: 'complete',
    candidates: scenario.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      edgeIds: candidate.edgeIds,
      travelDurationMs: Math.round(
        numericMetric(candidate, 'travelTime')
          * (candidate.metrics.travelTime.unit === 'seconds' ? 1_000 : 60_000),
      ),
      modeledExposureMicrounits: Math.round(
        numericMetric(candidate, 'historicalReportedIncidentExposure') * 1_000_000,
      ),
      accessibilityEvidenceState: accessibilityState(candidate),
      metricEvidenceIdentity: id(
        `m7:${scenario.scenarioId}:${candidate.candidateId}`,
        'metricEvidenceIdentity',
      ),
    })),
  };
}

function candidateRoleSelections(core) {
  const selections = [
    ['fastest', core.minima.durationMinimumCandidateIds[0]],
    ['lower-historical-exposure', core.minima.exposureMinimumCandidateIds[0]],
    ['balanced', core.balanced.rankedCandidateIds[0]],
  ];
  if (core.accessibility.status === 'available') {
    selections.push(['accessibility-oriented', core.accessibility.candidateIds[0]]);
  }
  return selections.filter(([, candidateId]) => candidateId);
}

function metricForLocale(metric, locale) {
  return {
    status: metric.status,
    value: metric.value,
    unit: metric.unit,
    sourceAsOf: metric.sourceAsOf,
    note: localized(metric.note, locale),
  };
}

function cardMetrics(candidate, fastestDistance, locale) {
  const distance = numericMetric(candidate, 'distance');
  const detour = distance === null || !fastestDistance
    ? {
      status: 'unavailable', value: null, unit: null, sourceAsOf: null,
      note: locale === 'zh-CN' ? '无法从已准入距离计算。' : 'Cannot be derived from admitted distance.',
    }
    : {
      status: 'available',
      value: Math.round(((distance / fastestDistance) - 1) * 1_000) / 10,
      unit: 'percent-vs-fastest-distance',
      sourceAsOf: null,
      note: locale === 'zh-CN' ? '相对于最快候选路线距离的机械计算。' : 'Mechanical calculation against the fastest candidate distance.',
    };
  return {
    travelTime: metricForLocale(candidate.metrics.travelTime, locale),
    distance: metricForLocale(candidate.metrics.distance, locale),
    detour,
    historicalReportedIncidentExposure: metricForLocale(
      candidate.metrics.historicalReportedIncidentExposure,
      locale,
    ),
    crash: metricForLocale(candidate.metrics.crash, locale),
    highInjuryNetwork: metricForLocale(candidate.metrics.highInjuryNetwork, locale),
    accessibility: metricForLocale(candidate.metrics.accessibility, locale),
    mapMatchQuality: metricForLocale(candidate.metrics.mapMatchQuality, locale),
    freshness: metricForLocale(candidate.metrics.freshness, locale),
    uncertainty: metricForLocale(candidate.metrics.uncertainty, locale),
  };
}

function card(candidate, role, roles, fastestDistance, locale, paretoCandidateIds) {
  return {
    candidateId: candidate.candidateId,
    label: localized(candidate.label, locale),
    role,
    roles,
    pareto: paretoCandidateIds.includes(candidate.candidateId),
    metrics: cardMetrics(candidate, fastestDistance, locale),
  };
}

function ordinaryViewModel(artifact, scenario, locale, reasonCode) {
  const candidate = scenario.candidates[0];
  const distance = numericMetric(candidate, 'distance');
  return deepFreeze({
    status: 'limited',
    scenarioId: scenario.scenarioId,
    label: localized(scenario.label, locale),
    origin: localized(scenario.origin.label, locale),
    destination: localized(scenario.destination.label, locale),
    mode: 'walking',
    artifactId: artifact.artifactId,
    generatedAt: artifact.generatedAt,
    cards: [card(candidate, 'route', ['route'], distance, locale, [])],
    paretoCandidateIds: [],
    sensitivity: {
      status: 'unavailable',
      reasonCode,
      changedScenarioIds: [],
    },
    notices: [
      'illustrative-static-fixture',
      reasonCode,
      'no-routing-or-safety-authority',
    ],
  });
}

export function buildPublicRouteScenarioViewModel(admittedArtifact, scenarioId, locale = 'en') {
  if (!admittedArtifact || admittedArtifact.schemaVersion !== PUBLIC_ROUTE_SCENARIO_SCHEMA
    || !Object.isFrozen(admittedArtifact)) {
    fail('view model requires an admitted artifact');
  }
  const scenario = admittedArtifact.scenarios.find((entry) => entry.scenarioId === scenarioId);
  if (!scenario) fail('scenarioId is not present in the admitted artifact');
  if (scenario.candidates.length === 1) {
    return ordinaryViewModel(admittedArtifact, scenario, locale, 'only-one-route-admitted');
  }
  if (!fullAdmissionAvailable(scenario)) {
    return ordinaryViewModel(admittedArtifact, scenario, locale, 'route-evidence-gate-not-admitted');
  }

  const core = evaluateRouteAlternativesM5Core(coreInputFor(scenario));
  if (core.status !== 'available' || core.authority !== 'none'
    || core.productPromotionAuthorized !== false) {
    return ordinaryViewModel(admittedArtifact, scenario, locale, 'mechanical-analysis-unavailable');
  }

  const candidatesById = new Map(
    scenario.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const roleGroups = new Map();
  for (const [role, candidateId] of candidateRoleSelections(core)) {
    if (!roleGroups.has(candidateId)) roleGroups.set(candidateId, []);
    roleGroups.get(candidateId).push(role);
  }
  const fastestId = core.minima.durationMinimumCandidateIds[0];
  const fastestDistance = numericMetric(candidatesById.get(fastestId), 'distance');
  const cards = [...roleGroups.entries()].slice(0, MAX_CANDIDATES).map(([candidateId, roles]) => (
    card(
      candidatesById.get(candidateId),
      roles[0],
      roles,
      fastestDistance,
      locale,
      core.pareto.candidateIds,
    )
  ));
  const changedScenarioIds = core.sensitivity.scenarios
    .filter(({ rankingChangedFromBaseline }) => rankingChangedFromBaseline)
    .map(({ scenarioId: sensitivityScenarioId }) => sensitivityScenarioId);
  const sensitivityStatus = changedScenarioIds.length
    || scenario.admission.sensitivity === 'unstable'
    ? 'unstable'
    : 'stable';
  return deepFreeze({
    status: 'available',
    scenarioId: scenario.scenarioId,
    label: localized(scenario.label, locale),
    origin: localized(scenario.origin.label, locale),
    destination: localized(scenario.destination.label, locale),
    mode: 'walking',
    artifactId: admittedArtifact.artifactId,
    generatedAt: admittedArtifact.generatedAt,
    cards,
    paretoCandidateIds: [...core.pareto.candidateIds],
    sensitivity: {
      status: sensitivityStatus,
      reasonCode: changedScenarioIds.length
        ? 'role-order-changes-under-admitted-sensitivity-scenarios'
        : 'role-order-stable-under-admitted-sensitivity-scenarios',
      changedScenarioIds,
    },
    notices: [
      'illustrative-static-fixture',
      sensitivityStatus === 'unstable'
        ? 'tradeoffs-change-with-explicit-weights'
        : 'tradeoffs-remain-non-authoritative',
      'no-routing-or-safety-authority',
    ],
  });
}
