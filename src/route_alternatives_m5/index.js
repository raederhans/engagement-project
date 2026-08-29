const MAX_ID_LENGTH = 160;
const MAX_CANDIDATES = 16;
const MAX_EDGES_PER_CANDIDATE = 100_000;
const MAX_EVIDENCE_ENTRIES = 250_000;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,159})$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const M5_M4_SOURCE_FINAL_COMMIT =
  'b4fcc63c7540f0a5e31844158a0fc853d2c8c0a6';

export const M5_SCHEMA_VERSIONS = Object.freeze({
  input: 'engagement-route-alternatives-m5-input/v1',
  engineResult: 'engagement-route-alternatives-engine-result/v1',
  authorityVerdict: 'engagement-route-engine-authority-verdict/v1',
  m4Evidence: 'engagement-route-m4-edge-evidence/v1',
  m4HandoffVerdict: 'engagement-route-m4-handoff-verdict/v1',
  accessibilityEvidence: 'engagement-route-accessibility-edge-evidence/v1',
  result: 'engagement-route-alternatives-m5-result/v1',
});

const sensitivityPolicy = (scenarioId, durationWeightBasisPoints,
  exposureWeightBasisPoints, maxDurationOverFastestBasisPoints) => Object.freeze({
  scenarioId,
  durationWeightBasisPoints,
  exposureWeightBasisPoints,
  durationReferenceMs: 1_000,
  exposureReferenceMicrounits: 1_000_000,
  maxDurationOverFastestBasisPoints,
});

export const M5_BALANCED_POLICY_V1 = Object.freeze({
  policyId: 'm5-balanced-policy/v1',
  scoringVersion: 'fixed-reference-weighted-loss/v1',
  thresholdVersion: 'duration-over-fastest-basis-points/v1',
  tieBreakVersion: 'score-duration-exposure-candidate-id/v1',
  durationWeightBasisPoints: 6_000,
  exposureWeightBasisPoints: 4_000,
  durationReferenceMs: 1_000,
  exposureReferenceMicrounits: 1_000_000,
  maxDurationOverFastestBasisPoints: 25_000,
  sensitivityScenarios: Object.freeze([
    sensitivityPolicy('duration-heavy', 9_000, 1_000, 25_000),
    sensitivityPolicy('exposure-heavy', 2_000, 8_000, 25_000),
    sensitivityPolicy('duration-threshold-tight', 6_000, 4_000, 12_000),
  ]),
});

const TRAVEL_STATES = new Set(['observed', 'unknown', 'partial', 'unavailable']);
const M4_STATES = new Set(['eligible', 'missing', 'partial', 'ambiguous', 'unavailable']);
const ACCESS_STATES = new Set(['observed', 'unknown', 'partial', 'unavailable']);
const ENGINE_TERMINATIONS = new Set([
  'candidate-set-ready',
  'no-route',
  'disconnected',
  'search-budget-exhausted',
  'engine-unavailable',
]);

function fail(message) {
  throw new TypeError(`route alternatives M5 contract: ${message}`);
}

function exactObject(raw, keys, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`${label} must be a plain object`);
  }
  let prototype;
  let ownKeys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(raw);
    ownKeys = Reflect.ownKeys(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (prototype !== Object.prototype || ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a plain string-keyed object`);
  }
  if (ownKeys.length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key))
    || ownKeys.some((key) => !keys.includes(key) || BLOCKED_KEYS.has(key))) {
    fail(`${label} schema mismatch`);
  }
  const value = {};
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      fail(`${label}.${key} must be a data property`);
    }
    value[key] = descriptors[key].value;
  }
  return value;
}

function strictArray(raw, label, { min = 0, max } = {}) {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) {
    fail(`${label} must be a standard array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const ownKeys = Reflect.ownKeys(raw);
  if (!Number.isSafeInteger(raw.length) || raw.length < min
    || (max !== undefined && raw.length > max)
    || ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} length is outside the supported range`);
  }
  const items = [];
  for (let index = 0; index < raw.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must be dense and contain data properties only`);
    }
    items.push(descriptor.value);
  }
  const extras = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= raw.length));
  if (extras.length) fail(`${label} contains unsupported properties`);
  return items;
}

function id(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_KEYS.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== 'string' || !COMMIT_PATTERN.test(value)) {
    fail(`${label} must be a full lowercase Git commit`);
  }
  return value;
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) {
    fail(`${label} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function nullableId(value, label) {
  return value === null ? null : id(value, label);
}

function uniqueIds(raw, label, options) {
  const values = strictArray(raw, label, options).map((value, index) => (
    id(value, `${label}[${index}]`)
  ));
  if (new Set(values).size !== values.length) fail(`${label} must be unique`);
  return values;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function admitRequest(raw) {
  const value = exactObject(raw, ['requestId', 'mode'], 'request');
  if (value.mode !== 'walk') fail('request.mode must be walk');
  return { requestId: id(value.requestId, 'request.requestId'), mode: 'walk' };
}

function admitEngineBindings(raw) {
  const value = exactObject(raw, [
    'requestId',
    'authorityId',
    'authoritySourceCommit',
    'engineName',
    'engineBuildId',
    'engineOutputId',
    'graphId',
    'graphReceiptId',
    'profileId',
    'profileKind',
    'mode',
    'executionEnvironment',
    'engineMaturity',
    'networkTransport',
    'producedAt',
  ], 'engineResult.bindings');
  if (!['walking', 'osrm-car', 'other'].includes(value.profileKind)) {
    fail('engineResult.bindings.profileKind is unsupported');
  }
  if (!['walk', 'car', 'other'].includes(value.mode)) {
    fail('engineResult.bindings.mode is unsupported');
  }
  if (value.executionEnvironment !== 'local'
    || value.engineMaturity !== 'mature'
    || value.networkTransport !== 'none') {
    fail('engineResult.bindings execution boundary is unsupported');
  }
  return {
    requestId: id(value.requestId, 'engineResult.bindings.requestId'),
    authorityId: id(value.authorityId, 'engineResult.bindings.authorityId'),
    authoritySourceCommit: commit(
      value.authoritySourceCommit,
      'engineResult.bindings.authoritySourceCommit',
    ),
    engineName: id(value.engineName, 'engineResult.bindings.engineName'),
    engineBuildId: id(value.engineBuildId, 'engineResult.bindings.engineBuildId'),
    engineOutputId: id(value.engineOutputId, 'engineResult.bindings.engineOutputId'),
    graphId: id(value.graphId, 'engineResult.bindings.graphId'),
    graphReceiptId: id(value.graphReceiptId, 'engineResult.bindings.graphReceiptId'),
    profileId: id(value.profileId, 'engineResult.bindings.profileId'),
    profileKind: value.profileKind,
    mode: value.mode,
    executionEnvironment: 'local',
    engineMaturity: 'mature',
    networkTransport: 'none',
    producedAt: timestamp(value.producedAt, 'engineResult.bindings.producedAt'),
  };
}

function admitTravelDuration(raw, label) {
  const value = exactObject(raw, [
    'state',
    'valueMs',
    'unit',
    'authorityId',
    'engineOutputId',
    'observedAt',
  ], label);
  if (!TRAVEL_STATES.has(value.state) || value.unit !== 'ms') {
    fail(`${label} state or unit is unsupported`);
  }
  const observed = value.state === 'observed';
  if (observed !== (value.valueMs !== null) || observed !== (value.observedAt !== null)) {
    fail(`${label} observed fields are inconsistent with state`);
  }
  return {
    state: value.state,
    valueMs: observed ? safeInteger(value.valueMs, `${label}.valueMs`, { min: 1 }) : null,
    unit: 'ms',
    authorityId: id(value.authorityId, `${label}.authorityId`),
    engineOutputId: id(value.engineOutputId, `${label}.engineOutputId`),
    observedAt: observed ? timestamp(value.observedAt, `${label}.observedAt`) : null,
  };
}

function admitCandidate(raw, index) {
  const label = `engineResult.candidates[${index}]`;
  const value = exactObject(raw, [
    'candidateId',
    'edgeIds',
    'travelDuration',
  ], label);
  return {
    candidateId: id(value.candidateId, `${label}.candidateId`),
    edgeIds: uniqueIds(value.edgeIds, `${label}.edgeIds`, {
      min: 1,
      max: MAX_EDGES_PER_CANDIDATE,
    }),
    travelDuration: admitTravelDuration(value.travelDuration, `${label}.travelDuration`),
  };
}

function admitBudget(raw) {
  const value = exactObject(raw, [
    'state',
    'maxCandidates',
    'examinedCandidates',
  ], 'engineResult.budget');
  if (!['within-budget', 'exhausted'].includes(value.state)) {
    fail('engineResult.budget.state is unsupported');
  }
  return {
    state: value.state,
    maxCandidates: safeInteger(value.maxCandidates, 'engineResult.budget.maxCandidates', {
      min: 1,
      max: MAX_CANDIDATES,
    }),
    examinedCandidates: safeInteger(
      value.examinedCandidates,
      'engineResult.budget.examinedCandidates',
      { max: Number.MAX_SAFE_INTEGER },
    ),
  };
}

function assertEngineTerminalConsistency(engineResult) {
  const count = engineResult.candidates.length;
  if (count > engineResult.budget.maxCandidates) {
    fail('engineResult candidates exceed the declared budget maximum');
  }
  if (engineResult.budget.examinedCandidates < count) {
    fail('engineResult examined candidate count is below returned candidate count');
  }
  if (engineResult.termination === 'candidate-set-ready'
    && (engineResult.status !== 'completed' || engineResult.budget.state !== 'within-budget'
      || count === 0)) {
    fail('candidate-set-ready terminal is inconsistent');
  }
  if (['no-route', 'disconnected'].includes(engineResult.termination)
    && (engineResult.status !== 'completed' || engineResult.budget.state !== 'within-budget'
      || count !== 0)) {
    fail('no-route terminal is inconsistent');
  }
  if (engineResult.termination === 'search-budget-exhausted'
    && (engineResult.status !== 'stopped' || engineResult.budget.state !== 'exhausted')) {
    fail('search-budget-exhausted terminal is inconsistent');
  }
  if (engineResult.termination === 'engine-unavailable'
    && (engineResult.status !== 'unavailable' || count !== 0)) {
    fail('engine-unavailable terminal is inconsistent');
  }
}

function admitEngineResult(raw) {
  const value = exactObject(raw, [
    'schemaVersion',
    'status',
    'termination',
    'bindings',
    'budget',
    'candidates',
  ], 'engineResult');
  if (value.schemaVersion !== M5_SCHEMA_VERSIONS.engineResult
    || !['completed', 'stopped', 'unavailable'].includes(value.status)
    || !ENGINE_TERMINATIONS.has(value.termination)) {
    fail('engineResult version, status, or termination is unsupported');
  }
  const candidates = strictArray(value.candidates, 'engineResult.candidates', {
    max: MAX_CANDIDATES,
  }).map(admitCandidate);
  const candidateIds = candidates.map(({ candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    fail('engineResult candidate IDs must be unique');
  }
  const admitted = {
    schemaVersion: M5_SCHEMA_VERSIONS.engineResult,
    status: value.status,
    termination: value.termination,
    bindings: admitEngineBindings(value.bindings),
    budget: admitBudget(value.budget),
    candidates,
  };
  assertEngineTerminalConsistency(admitted);
  return admitted;
}

function admitM4Binding(raw) {
  const value = exactObject(raw, [
    'handoffSchema',
    'sourceFinalCommit',
    'handoffId',
    'artifactIdentity',
  ], 'm4Evidence.binding');
  if (value.handoffSchema !== 'engagement-known-route-evidence-handoff/v2') {
    fail('m4Evidence.binding.handoffSchema is unsupported');
  }
  return {
    handoffSchema: value.handoffSchema,
    sourceFinalCommit: commit(value.sourceFinalCommit, 'm4Evidence.binding.sourceFinalCommit'),
    handoffId: id(value.handoffId, 'm4Evidence.binding.handoffId'),
    artifactIdentity: id(value.artifactIdentity, 'm4Evidence.binding.artifactIdentity'),
  };
}

function admitM4Entry(raw, index) {
  const label = `m4Evidence.entries[${index}]`;
  const value = exactObject(raw, [
    'engineEdgeId',
    'state',
    'm4EdgeIds',
    'modeledExposureMicrounits',
    'evidenceId',
    'sourceFinalCommit',
  ], label);
  if (!M4_STATES.has(value.state)) fail(`${label}.state is unsupported`);
  const m4EdgeIds = uniqueIds(value.m4EdgeIds, `${label}.m4EdgeIds`, { max: 16 });
  if (value.state === 'eligible') {
    if (m4EdgeIds.length !== 1 || value.modeledExposureMicrounits === null
      || value.evidenceId === null) {
      fail(`${label} eligible evidence must bind one M4 edge and one value`);
    }
  } else if (value.state === 'ambiguous') {
    if (m4EdgeIds.length < 2 || value.modeledExposureMicrounits !== null
      || value.evidenceId !== null) {
      fail(`${label} ambiguous evidence must bind multiple M4 edges and no value`);
    }
  } else if (m4EdgeIds.length !== 0 || value.modeledExposureMicrounits !== null
    || value.evidenceId !== null) {
    fail(`${label} unresolved evidence must not carry a value`);
  }
  return {
    engineEdgeId: id(value.engineEdgeId, `${label}.engineEdgeId`),
    state: value.state,
    m4EdgeIds,
    modeledExposureMicrounits: value.state === 'eligible'
      ? safeInteger(
        value.modeledExposureMicrounits,
        `${label}.modeledExposureMicrounits`,
      )
      : null,
    evidenceId: nullableId(value.evidenceId, `${label}.evidenceId`),
    sourceFinalCommit: commit(value.sourceFinalCommit, `${label}.sourceFinalCommit`),
  };
}

function admitM4Evidence(raw) {
  const value = exactObject(raw, [
    'schemaVersion',
    'binding',
    'crosswalkVersion',
    'entries',
  ], 'm4Evidence');
  if (value.schemaVersion !== M5_SCHEMA_VERSIONS.m4Evidence
    || value.crosswalkVersion !== 'engine-edge-to-m4-edge/v1') {
    fail('m4Evidence schema or crosswalk version is unsupported');
  }
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.m4Evidence,
    binding: admitM4Binding(value.binding),
    crosswalkVersion: value.crosswalkVersion,
    entries: strictArray(value.entries, 'm4Evidence.entries', {
      max: MAX_EVIDENCE_ENTRIES,
    }).map(admitM4Entry),
  };
}

function admitAccessibilityEntry(raw, index) {
  const label = `accessibilityEvidence.entries[${index}]`;
  const value = exactObject(raw, [
    'engineEdgeId',
    'state',
    'mode',
    'stepFree',
    'curbRampPresent',
    'pavedSurface',
    'evidenceId',
    'authorityId',
  ], label);
  if (!ACCESS_STATES.has(value.state)) fail(`${label}.state is unsupported`);
  const observed = value.state === 'observed';
  if (observed) {
    if (!['walk', 'car', 'other'].includes(value.mode)
      || typeof value.stepFree !== 'boolean'
      || typeof value.curbRampPresent !== 'boolean'
      || typeof value.pavedSurface !== 'boolean'
      || value.evidenceId === null) {
      fail(`${label} observed evidence is incomplete`);
    }
  } else if (value.mode !== null || value.stepFree !== null
    || value.curbRampPresent !== null || value.pavedSurface !== null
    || value.evidenceId !== null) {
    fail(`${label} unresolved evidence must not carry observed values`);
  }
  return {
    engineEdgeId: id(value.engineEdgeId, `${label}.engineEdgeId`),
    state: value.state,
    mode: observed ? value.mode : null,
    stepFree: observed ? value.stepFree : null,
    curbRampPresent: observed ? value.curbRampPresent : null,
    pavedSurface: observed ? value.pavedSurface : null,
    evidenceId: nullableId(value.evidenceId, `${label}.evidenceId`),
    authorityId: id(value.authorityId, `${label}.authorityId`),
  };
}

function admitAccessibilityEvidence(raw) {
  const value = exactObject(raw, ['schemaVersion', 'entries'], 'accessibilityEvidence');
  if (value.schemaVersion !== M5_SCHEMA_VERSIONS.accessibilityEvidence) {
    fail('accessibilityEvidence.schemaVersion is unsupported');
  }
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.accessibilityEvidence,
    entries: strictArray(value.entries, 'accessibilityEvidence.entries', {
      max: MAX_EVIDENCE_ENTRIES,
    }).map(admitAccessibilityEntry),
  };
}

function admitInput(raw) {
  const value = exactObject(raw, [
    'schemaVersion',
    'request',
    'engineResult',
    'm4Evidence',
    'accessibilityEvidence',
  ], 'input');
  if (value.schemaVersion !== M5_SCHEMA_VERSIONS.input) {
    fail('input.schemaVersion is unsupported');
  }
  return deepFreeze({
    schemaVersion: M5_SCHEMA_VERSIONS.input,
    request: admitRequest(value.request),
    engineResult: admitEngineResult(value.engineResult),
    m4Evidence: admitM4Evidence(value.m4Evidence),
    accessibilityEvidence: admitAccessibilityEvidence(value.accessibilityEvidence),
  });
}

function admitEngineAuthorityVerdict(raw) {
  const value = exactObject(raw, [
    'schemaVersion',
    'status',
    'requestId',
    'authorityId',
    'authoritySourceCommit',
    'engineName',
    'engineBuildId',
    'engineOutputId',
    'graphId',
    'graphReceiptId',
    'profileId',
    'profileKind',
    'mode',
    'executionEnvironment',
    'engineMaturity',
    'networkTransport',
    'travelDurationAuthority',
    'accessibilityAuthority',
    'producedAt',
    'verifiedAt',
  ], 'engine authority verdict');
  if (value.schemaVersion !== M5_SCHEMA_VERSIONS.authorityVerdict
    || value.status !== 'admitted'
    || value.travelDurationAuthority !== 'admitted'
    || !['admitted', 'unavailable'].includes(value.accessibilityAuthority)
    || !['walking', 'osrm-car', 'other'].includes(value.profileKind)
    || !['walk', 'car', 'other'].includes(value.mode)
    || value.executionEnvironment !== 'local'
    || value.engineMaturity !== 'mature'
    || value.networkTransport !== 'none') {
    fail('engine authority verdict is unsupported');
  }
  const admitted = {
    schemaVersion: M5_SCHEMA_VERSIONS.authorityVerdict,
    status: 'admitted',
    requestId: id(value.requestId, 'engine authority verdict.requestId'),
    authorityId: id(value.authorityId, 'engine authority verdict.authorityId'),
    authoritySourceCommit: commit(
      value.authoritySourceCommit,
      'engine authority verdict.authoritySourceCommit',
    ),
    engineName: id(value.engineName, 'engine authority verdict.engineName'),
    engineBuildId: id(value.engineBuildId, 'engine authority verdict.engineBuildId'),
    engineOutputId: id(value.engineOutputId, 'engine authority verdict.engineOutputId'),
    graphId: id(value.graphId, 'engine authority verdict.graphId'),
    graphReceiptId: id(value.graphReceiptId, 'engine authority verdict.graphReceiptId'),
    profileId: id(value.profileId, 'engine authority verdict.profileId'),
    profileKind: value.profileKind,
    mode: value.mode,
    executionEnvironment: 'local',
    engineMaturity: 'mature',
    networkTransport: 'none',
    travelDurationAuthority: 'admitted',
    accessibilityAuthority: value.accessibilityAuthority,
    producedAt: timestamp(value.producedAt, 'engine authority verdict.producedAt'),
    verifiedAt: timestamp(value.verifiedAt, 'engine authority verdict.verifiedAt'),
  };
  if (Date.parse(admitted.verifiedAt) < Date.parse(admitted.producedAt)) {
    fail('engine authority verifiedAt precedes producedAt');
  }
  return admitted;
}

function sameEngineBinding(binding, verdict) {
  return Object.keys(binding).every((key) => binding[key] === verdict[key]);
}

function verifyEngineAuthority(input, verifier) {
  if (typeof verifier !== 'function') return null;
  try {
    const verdict = admitEngineAuthorityVerdict(verifier(input.engineResult));
    if (!sameEngineBinding(input.engineResult.bindings, verdict)
      || verdict.requestId !== input.request.requestId
      || verdict.mode !== input.request.mode
      || verdict.profileKind !== 'walking') {
      return null;
    }
    return deepFreeze(verdict);
  } catch {
    return null;
  }
}

function admitM4HandoffVerdict(raw) {
  const value = exactObject(raw, [
    'schemaVersion',
    'status',
    'handoffSchema',
    'sourceFinalCommit',
    'handoffId',
    'artifactIdentity',
  ], 'M4 handoff verdict');
  if (value.schemaVersion !== M5_SCHEMA_VERSIONS.m4HandoffVerdict
    || value.status !== 'admitted'
    || value.handoffSchema !== 'engagement-known-route-evidence-handoff/v2') {
    fail('M4 handoff verdict is unsupported');
  }
  return {
    schemaVersion: M5_SCHEMA_VERSIONS.m4HandoffVerdict,
    status: 'admitted',
    handoffSchema: value.handoffSchema,
    sourceFinalCommit: commit(value.sourceFinalCommit, 'M4 handoff verdict.sourceFinalCommit'),
    handoffId: id(value.handoffId, 'M4 handoff verdict.handoffId'),
    artifactIdentity: id(value.artifactIdentity, 'M4 handoff verdict.artifactIdentity'),
  };
}

function verifyM4Handoff(input, verifier) {
  if (typeof verifier !== 'function') return null;
  try {
    const verdict = admitM4HandoffVerdict(verifier(input.m4Evidence));
    const binding = input.m4Evidence.binding;
    if (binding.sourceFinalCommit !== M5_M4_SOURCE_FINAL_COMMIT
      || Object.keys(binding).some((key) => binding[key] !== verdict[key])) {
      return null;
    }
    return deepFreeze(verdict);
  } catch {
    return null;
  }
}

function unavailableObjective(reasonCode) {
  return { status: 'unavailable', reasonCode, selectedCandidateId: null, candidateIds: [] };
}

function unavailableDimensions(reasonCode) {
  return {
    travelDuration: { status: 'unavailable', reasonCode },
    modeledExposure: { status: 'unavailable', reasonCode },
    accessibility: { status: 'unavailable', reasonCode },
  };
}

function unavailableObjectives(reasonCode) {
  return {
    fastest: unavailableObjective(reasonCode),
    balanced: unavailableObjective(reasonCode),
    lowerModeledExposure: unavailableObjective(reasonCode),
    accessible: unavailableObjective(reasonCode),
  };
}

function resultEnvelope(value) {
  return deepFreeze({
    schemaVersion: M5_SCHEMA_VERSIONS.result,
    limitations: [
      'candidate-set-only',
      'modeled-exposure-is-historical-evidence',
      'no-personal-outcome-claim',
      'no-runtime-ui-binding',
    ],
    ...value,
  });
}

function unavailableResult(termination, reasonCode) {
  return resultEnvelope({
    status: 'unavailable',
    termination,
    authority: {
      engine: { status: 'unavailable', reasonCode },
      m4Handoff: { status: 'unavailable', reasonCode: 'not-evaluated' },
    },
    candidateSet: null,
    dimensions: unavailableDimensions(reasonCode),
    pareto: { status: 'unavailable', reasonCode, dimensions: [], candidateIds: [] },
    objectives: unavailableObjectives(reasonCode),
    sensitivity: { status: 'unavailable', reasonCode, scenarios: [] },
  });
}

function compareIds(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deduplicateCandidates(candidates) {
  const sorted = [...candidates].sort((left, right) => compareIds(
    left.candidateId,
    right.candidateId,
  ));
  const canonicalByRoute = new Map();
  const canonical = [];
  const duplicates = [];
  let conflict = false;
  for (const candidate of sorted) {
    const routeIdentity = JSON.stringify(candidate.edgeIds);
    const prior = canonicalByRoute.get(routeIdentity);
    if (prior) {
      if (JSON.stringify(prior.travelDuration) !== JSON.stringify(candidate.travelDuration)) {
        conflict = true;
      }
      duplicates.push({
        duplicateCandidateId: candidate.candidateId,
        canonicalCandidateId: prior.candidateId,
        reasonCode: 'same-ordered-directed-edge-sequence',
      });
    } else {
      canonicalByRoute.set(routeIdentity, candidate);
      canonical.push(candidate);
    }
  }
  return { canonical, duplicates, conflict };
}

function invalidCandidateSetResult(engineVerdict, reasonCode) {
  return resultEnvelope({
    status: 'unavailable',
    termination: 'candidate-set-invalid',
    authority: {
      engine: engineVerdict,
      m4Handoff: { status: 'unavailable', reasonCode: 'not-evaluated' },
    },
    candidateSet: null,
    dimensions: unavailableDimensions(reasonCode),
    pareto: { status: 'unavailable', reasonCode, dimensions: [], candidateIds: [] },
    objectives: unavailableObjectives(reasonCode),
    sensitivity: { status: 'unavailable', reasonCode, scenarios: [] },
  });
}

function basicCandidateSet(input, candidates, duplicates, completeness) {
  return {
    status: completeness === 'complete' ? 'complete' : 'partial',
    completeness,
    candidateIds: candidates.map(({ candidateId }) => candidateId),
    candidates: candidates.map(({ candidateId, edgeIds, travelDuration }) => ({
      candidateId,
      edgeIds: [...edgeIds],
      travelDurationState: travelDuration.state,
    })),
    duplicates,
    metricEquivalenceGroups: [],
    evidenceEquivalenceGroups: [],
    bindings: {
      requestId: input.request.requestId,
      graphId: input.engineResult.bindings.graphId,
      graphReceiptId: input.engineResult.bindings.graphReceiptId,
      engineOutputId: input.engineResult.bindings.engineOutputId,
      producedAt: input.engineResult.bindings.producedAt,
    },
  };
}

function travelDurationDimension(candidates, bindings) {
  for (const candidate of candidates) {
    const metric = candidate.travelDuration;
    if (metric.state !== 'observed') {
      return { status: 'unavailable', reasonCode: `travel-duration-${metric.state}` };
    }
    if (metric.authorityId !== bindings.authorityId
      || metric.engineOutputId !== bindings.engineOutputId
      || metric.observedAt !== bindings.producedAt) {
      return { status: 'unavailable', reasonCode: 'travel-duration-binding-mismatch' };
    }
  }
  return {
    status: 'available',
    reasonCode: 'admitted-engine-travel-duration-complete',
    unit: 'ms',
    provenance: {
      authorityId: bindings.authorityId,
      engineOutputId: bindings.engineOutputId,
      graphReceiptId: bindings.graphReceiptId,
      observedAt: bindings.producedAt,
    },
  };
}

function entriesByEdge(entries) {
  const byEdge = new Map();
  for (const entry of entries) {
    const current = byEdge.get(entry.engineEdgeId) ?? [];
    current.push(entry);
    byEdge.set(entry.engineEdgeId, current);
  }
  return byEdge;
}

function m4Unavailable(reasonCode) {
  return { dimension: { status: 'unavailable', reasonCode }, metrics: null };
}

function modeledExposureDimension(input, candidates, verdict) {
  if (!verdict) return m4Unavailable('m4-handoff-authority-unavailable');
  const byEdge = entriesByEdge(input.m4Evidence.entries);
  const metrics = new Map();
  for (const candidate of candidates) {
    let total = 0;
    const evidenceIds = [];
    for (const edgeId of candidate.edgeIds) {
      const entries = byEdge.get(edgeId) ?? [];
      if (entries.length === 0) return m4Unavailable('m4-crosswalk-missing');
      if (entries.length > 1) return m4Unavailable('m4-crosswalk-ambiguous');
      const entry = entries[0];
      if (entry.state !== 'eligible') {
        const reason = entry.state === 'ambiguous'
          ? 'm4-crosswalk-ambiguous'
          : `m4-crosswalk-${entry.state}`;
        return m4Unavailable(reason);
      }
      if (entry.sourceFinalCommit !== M5_M4_SOURCE_FINAL_COMMIT) {
        return m4Unavailable('m4-source-final-binding-mismatch');
      }
      if (!Number.isSafeInteger(total + entry.modeledExposureMicrounits)) {
        return m4Unavailable('modeled-exposure-total-unsafe');
      }
      total += entry.modeledExposureMicrounits;
      evidenceIds.push(entry.evidenceId);
    }
    metrics.set(candidate.candidateId, { value: total, evidenceIds });
  }
  return {
    dimension: {
      status: 'available',
      reasonCode: 'exact-m4-crosswalk-and-eligible-evidence-complete',
      unit: 'modeled-exposure-microunits',
      provenance: {
        sourceFinalCommit: M5_M4_SOURCE_FINAL_COMMIT,
        handoffId: verdict.handoffId,
        artifactIdentity: verdict.artifactIdentity,
        crosswalkVersion: input.m4Evidence.crosswalkVersion,
      },
    },
    metrics,
  };
}

function accessibilityUnavailable(reasonCode) {
  return { dimension: { status: 'unavailable', reasonCode }, metrics: null };
}

function accessibilityDimension(input, candidates, engineVerdict) {
  if (engineVerdict.accessibilityAuthority !== 'admitted') {
    return accessibilityUnavailable('accessibility-authority-unavailable');
  }
  const byEdge = entriesByEdge(input.accessibilityEvidence.entries);
  const metrics = new Map();
  for (const candidate of candidates) {
    let meetsEvidence = true;
    const evidenceIds = [];
    for (const edgeId of candidate.edgeIds) {
      const entries = byEdge.get(edgeId) ?? [];
      if (entries.length === 0) return accessibilityUnavailable('accessibility-evidence-missing');
      if (entries.length > 1) return accessibilityUnavailable('accessibility-evidence-ambiguous');
      const entry = entries[0];
      if (entry.state !== 'observed') {
        return accessibilityUnavailable(`accessibility-evidence-${entry.state}`);
      }
      if (entry.authorityId !== engineVerdict.authorityId || entry.mode !== 'walk') {
        return accessibilityUnavailable('accessibility-mode-or-authority-mismatch');
      }
      meetsEvidence = meetsEvidence
        && entry.stepFree && entry.curbRampPresent && entry.pavedSurface;
      evidenceIds.push(entry.evidenceId);
    }
    metrics.set(candidate.candidateId, { meetsEvidence, evidenceIds });
  }
  return {
    dimension: {
      status: 'available',
      reasonCode: 'edge-level-walking-accessibility-evidence-complete',
      provenance: {
        authorityId: engineVerdict.authorityId,
        profileId: engineVerdict.profileId,
        mode: 'walk',
      },
    },
    metrics,
  };
}

function groupsByKey(records, keyFor) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFor(record);
    const group = groups.get(key) ?? [];
    group.push(record.candidateId);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort(compareIds))
    .sort((left, right) => compareIds(left[0], right[0]));
}

function dominates(left, right) {
  return left.durationMs <= right.durationMs
    && left.exposure <= right.exposure
    && (left.durationMs < right.durationMs || left.exposure < right.exposure);
}

function paretoCandidateIds(records) {
  return records
    .filter((right) => !records.some((left) => (
      left.candidateId !== right.candidateId && dominates(left, right)
    )))
    .map(({ candidateId }) => candidateId)
    .sort(compareIds);
}

function scoreNumerator(record, policy) {
  return BigInt(record.durationMs)
      * BigInt(policy.durationWeightBasisPoints)
      * BigInt(policy.exposureReferenceMicrounits)
    + BigInt(record.exposure)
      * BigInt(policy.exposureWeightBasisPoints)
      * BigInt(policy.durationReferenceMs);
}

function compareBalanced(left, right, policy) {
  const leftScore = scoreNumerator(left, policy);
  const rightScore = scoreNumerator(right, policy);
  if (leftScore < rightScore) return -1;
  if (leftScore > rightScore) return 1;
  if (left.durationMs !== right.durationMs) return left.durationMs - right.durationMs;
  if (left.exposure !== right.exposure) return left.exposure - right.exposure;
  return compareIds(left.candidateId, right.candidateId);
}

function balancedRanking(records, policy) {
  const fastest = Math.min(...records.map(({ durationMs }) => durationMs));
  const admitted = records.filter(({ durationMs }) => (
    BigInt(durationMs) * 10_000n
      <= BigInt(fastest) * BigInt(policy.maxDurationOverFastestBasisPoints)
  ));
  admitted.sort((left, right) => compareBalanced(left, right, policy));
  const denominator = BigInt(policy.durationReferenceMs)
    * BigInt(policy.exposureReferenceMicrounits);
  return {
    rankedCandidateIds: admitted.map(({ candidateId }) => candidateId),
    scores: admitted.map((record) => ({
      candidateId: record.candidateId,
      scoreNumerator: scoreNumerator(record, policy).toString(),
      scoreDenominator: denominator.toString(),
    })),
  };
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function availableObjective(reasonCode, candidateIds, extra = {}) {
  return {
    status: 'available',
    reasonCode,
    selectedCandidateId: candidateIds[0],
    candidateIds,
    ...extra,
  };
}

function completeResult(input, engineVerdict, m4Verdict, candidates, duplicates) {
  const candidateSet = basicCandidateSet(input, candidates, duplicates, 'complete');
  const travel = travelDurationDimension(candidates, input.engineResult.bindings);
  if (travel.status !== 'available') {
    return resultEnvelope({
      status: 'unavailable',
      termination: 'metric-unavailable',
      authority: {
        engine: engineVerdict,
        m4Handoff: m4Verdict ?? {
          status: 'unavailable',
          reasonCode: 'm4-handoff-authority-unavailable',
        },
      },
      candidateSet,
      dimensions: {
        travelDuration: travel,
        modeledExposure: { status: 'unavailable', reasonCode: 'not-evaluated' },
        accessibility: { status: 'unavailable', reasonCode: 'not-evaluated' },
      },
      pareto: {
        status: 'unavailable',
        reasonCode: 'travel-duration-unavailable',
        dimensions: [],
        candidateIds: [],
      },
      objectives: unavailableObjectives('travel-duration-unavailable'),
      sensitivity: {
        status: 'unavailable',
        reasonCode: 'travel-duration-unavailable',
        scenarios: [],
      },
    });
  }

  const modeledExposure = modeledExposureDimension(input, candidates, m4Verdict);
  const accessibility = accessibilityDimension(input, candidates, engineVerdict);
  const durationById = new Map(candidates.map((candidate) => [
    candidate.candidateId,
    candidate.travelDuration.valueMs,
  ]));
  const fastestDuration = Math.min(...durationById.values());
  const fastestIds = candidates
    .filter((candidate) => durationById.get(candidate.candidateId) === fastestDuration)
    .map(({ candidateId }) => candidateId)
    .sort(compareIds);
  const fastest = availableObjective(
    'minimum-admitted-travel-duration-in-complete-candidate-set',
    fastestIds,
  );

  let pareto = {
    status: 'unavailable',
    reasonCode: modeledExposure.dimension.reasonCode,
    dimensions: [],
    candidateIds: [],
  };
  let balanced = unavailableObjective(modeledExposure.dimension.reasonCode);
  let lowerModeledExposure = unavailableObjective(modeledExposure.dimension.reasonCode);
  let sensitivity = {
    status: 'unavailable',
    reasonCode: modeledExposure.dimension.reasonCode,
    scenarios: [],
  };
  let records = [];

  if (modeledExposure.dimension.status === 'available') {
    records = candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      durationMs: durationById.get(candidate.candidateId),
      exposure: modeledExposure.metrics.get(candidate.candidateId).value,
      m4EvidenceIds: modeledExposure.metrics.get(candidate.candidateId).evidenceIds,
      accessEvidenceIds: accessibility.metrics?.get(candidate.candidateId)?.evidenceIds ?? [],
      accessibilityDisposition: accessibility.metrics?.get(candidate.candidateId)?.meetsEvidence
        ?? null,
    }));
    candidateSet.metricEquivalenceGroups = groupsByKey(
      records,
      (record) => `${record.durationMs}\u0000${record.exposure}`,
    );
    candidateSet.evidenceEquivalenceGroups = groupsByKey(records, (record) => JSON.stringify([
      record.durationMs,
      record.exposure,
      record.m4EvidenceIds,
      record.accessEvidenceIds,
      record.accessibilityDisposition,
    ]));
    pareto = {
      status: 'available',
      reasonCode: 'non-dominated-on-complete-common-metrics',
      dimensions: ['travel-duration-ms', 'modeled-exposure-microunits'],
      candidateIds: paretoCandidateIds(records),
    };

    const minimumExposure = Math.min(...records.map(({ exposure }) => exposure));
    const lowerIds = records
      .filter(({ exposure }) => exposure === minimumExposure)
      .sort((left, right) => left.durationMs - right.durationMs
        || compareIds(left.candidateId, right.candidateId))
      .map(({ candidateId }) => candidateId);
    lowerModeledExposure = availableObjective(
      'minimum-complete-modeled-exposure-in-candidate-set',
      lowerIds,
    );

    const baseline = balancedRanking(records, M5_BALANCED_POLICY_V1);
    balanced = availableObjective(
      'explicit-fixed-policy-score-minimum',
      baseline.rankedCandidateIds,
      {
        rankedCandidateIds: baseline.rankedCandidateIds,
        scores: baseline.scores,
        policy: M5_BALANCED_POLICY_V1,
      },
    );
    sensitivity = {
      status: 'available',
      reasonCode: 'frozen-weight-and-threshold-scenarios-evaluated',
      baselinePolicyId: M5_BALANCED_POLICY_V1.policyId,
      scenarios: M5_BALANCED_POLICY_V1.sensitivityScenarios.map((policy) => {
        const ranking = balancedRanking(records, policy);
        return {
          ...policy,
          selectedCandidateId: ranking.rankedCandidateIds[0] ?? null,
          rankedCandidateIds: ranking.rankedCandidateIds,
          scores: ranking.scores,
          rankingChangedFromBaseline: !sameSequence(
            ranking.rankedCandidateIds,
            baseline.rankedCandidateIds,
          ),
        };
      }),
    };
  }

  let accessible = unavailableObjective(accessibility.dimension.reasonCode);
  if (accessibility.dimension.status === 'available') {
    const accessibleIds = candidates
      .filter(({ candidateId }) => accessibility.metrics.get(candidateId).meetsEvidence)
      .sort((left, right) => durationById.get(left.candidateId)
        - durationById.get(right.candidateId)
        || compareIds(left.candidateId, right.candidateId))
      .map(({ candidateId }) => candidateId);
    accessible = accessibleIds.length > 0
      ? availableObjective('complete-edge-level-walking-evidence', accessibleIds)
      : unavailableObjective('no-candidate-meets-complete-accessibility-evidence');
  }

  const objectives = { fastest, balanced, lowerModeledExposure, accessible };
  const status = Object.values(objectives).every((objective) => objective.status === 'available')
    ? 'available'
    : 'partial';
  return resultEnvelope({
    status,
    termination: 'candidate-set-ready',
    authority: {
      engine: engineVerdict,
      m4Handoff: m4Verdict ?? {
        status: 'unavailable',
        reasonCode: 'm4-handoff-authority-unavailable',
      },
    },
    candidateSet,
    dimensions: {
      travelDuration: travel,
      modeledExposure: modeledExposure.dimension,
      accessibility: accessibility.dimension,
    },
    pareto,
    objectives,
    sensitivity,
  });
}

function stoppedResult(input, engineVerdict, candidates, duplicates) {
  const reasonCode = input.engineResult.termination === 'search-budget-exhausted'
    ? 'candidate-search-budget-exhausted'
    : 'candidate-search-incomplete';
  return resultEnvelope({
    status: 'partial',
    termination: input.engineResult.termination,
    authority: {
      engine: engineVerdict,
      m4Handoff: { status: 'unavailable', reasonCode: 'not-evaluated-incomplete-search' },
    },
    candidateSet: basicCandidateSet(input, candidates, duplicates, 'not-proven'),
    dimensions: unavailableDimensions(reasonCode),
    pareto: { status: 'unavailable', reasonCode, dimensions: [], candidateIds: [] },
    objectives: unavailableObjectives(reasonCode),
    sensitivity: { status: 'unavailable', reasonCode, scenarios: [] },
  });
}

function noRouteResult(input, engineVerdict, termination) {
  const reasonCode = termination === 'disconnected'
    ? 'engine-reported-disconnected'
    : 'engine-reported-no-route';
  return resultEnvelope({
    status: 'unavailable',
    termination,
    authority: {
      engine: engineVerdict,
      m4Handoff: { status: 'unavailable', reasonCode: 'not-evaluated-without-candidates' },
    },
    candidateSet: basicCandidateSet(input, [], [], 'complete'),
    dimensions: unavailableDimensions(reasonCode),
    pareto: { status: 'unavailable', reasonCode, dimensions: [], candidateIds: [] },
    objectives: unavailableObjectives(reasonCode),
    sensitivity: { status: 'unavailable', reasonCode, scenarios: [] },
  });
}

/**
 * Admit and compare a private, local engine candidate result. Positive engine
 * and M4 authority must come from caller-owned trusted verifiers; input fields
 * are bindings only and can never self-promote.
 */
export function evaluateRouteAlternativesM5(rawInput, options = {}) {
  let input;
  try {
    input = admitInput(rawInput);
  } catch {
    return unavailableResult('invalid-input', 'input-contract-invalid');
  }

  const engineVerdict = verifyEngineAuthority(input, options.verifyEngineAuthority);
  if (!engineVerdict || input.engineResult.termination === 'engine-unavailable') {
    return unavailableResult(
      'engine-authority-unavailable',
      'trusted-engine-authority-not-admitted',
    );
  }

  const { canonical, duplicates, conflict } = deduplicateCandidates(
    input.engineResult.candidates,
  );
  if (conflict) {
    return invalidCandidateSetResult(
      engineVerdict,
      'duplicate-route-travel-duration-conflict',
    );
  }
  if (['no-route', 'disconnected'].includes(input.engineResult.termination)) {
    return noRouteResult(input, engineVerdict, input.engineResult.termination);
  }
  if (input.engineResult.termination === 'search-budget-exhausted') {
    return stoppedResult(input, engineVerdict, canonical, duplicates);
  }

  const m4Verdict = verifyM4Handoff(input, options.verifyM4Handoff);
  return completeResult(input, engineVerdict, m4Verdict, canonical, duplicates);
}
