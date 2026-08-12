import { createHash } from 'node:crypto';

import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitDecisionPolicy,
  admitGraphArtifact,
  admitSourceObservation,
} from './index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CAPACITY_POLICY,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TERMINATIONS,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
  admitRouteCandidateSearchRequest,
  admitRouteCandidateSearchResult,
} from './candidate_search_v2.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  ROUTE_SEARCH_DECISION_VERSION,
  admitRouteSearchDecisionEvaluation,
} from '../evaluator/search_v2.js';

const MAX_ID_LENGTH = 120;
const SNAPSHOT_MAX_DEPTH = 64;
const SNAPSHOT_MAX_NODES = 100_000;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export const S3_SCENARIO_SCHEMA_VERSIONS = Object.freeze({
  configuration: 'engagement-route-s3-configuration/v1',
  syntheticProfile: 'engagement-route-s3-synthetic-profile/v1',
  conformanceProbe: 'engagement-route-s3-conformance-probe/v1',
  edgeFactorEvidence: 'engagement-route-s3-edge-factor-evidence/v1',
  oracleExecutionSpec: 'engagement-route-s3-oracle-execution-spec/v1',
  performanceProtocol: 'engagement-route-s3-performance-protocol/v1',
  cohort: 'engagement-route-s3-scenario-cohort/v1',
  protocol: 'engagement-route-s3-protocol/v1',
  productExecution: 'engagement-route-s3-product-execution/v1',
  independentOracle: 'engagement-route-s3-independent-oracle/v1',
  joinedRunRecord: 'engagement-route-s3-joined-run-record/v1',
  recordCollection: 'engagement-route-s3-record-collection/v1',
  runManifest: 'engagement-route-s3-run-manifest/v1',
  report: 'engagement-route-s3-report/v1',
});

export const S3_SCENARIO_COUNTS = Object.freeze({
  uniqueOdPairs: 1_000,
  configurationGroups: 5,
  scenarioConfigEvaluations: 5_000,
});

export const S3_SCENARIO_GENERATOR_VERSION = 's3-directed-edge-od-generator/v1';
export const S3_SCENARIO_SEED = 0x5eed_3000;
export const S3_ORACLE_ALGORITHM_VERSION = 's3-independent-loopless-oracle/v1';

export const S3_CONFIGURATION_IDS = Object.freeze([
  's3-objective-cost-only',
  's3-distance-ranking-over-objective-candidates',
  's3-distance-objective-equal-weight',
  's3-distance-objective-reweighted-range-capped',
  's3-three-capability-constraint-aware',
]);

export const S3_SYNTHETIC_PROFILE_IDS = Object.freeze(['s3-profile-a', 's3-profile-b']);
export const S3_CONFORMANCE_PROBE_KINDS = Object.freeze([
  'invalid-input',
  'disconnected',
  'source-unavailable',
  'constraint-no-solution',
]);

const CONFIGURATION_KINDS = Object.freeze([
  'objective-cost-only',
  'distance-ranking-over-objective-generated-candidates',
  'distance-objective-equal-weight',
  'distance-objective-reweighted-and-range-capped',
  'three-capability-constraint-aware',
]);
const PROBE_TERMINATIONS = Object.freeze([
  'invalid-input',
  'no-directed-route-in-bounded-scope',
  'unresolved-constraint-evidence',
  'no-eligible-route-in-bounded-scope',
]);
const CLAIMS = new Set([
  'synthetic-engineering-protocol',
  'synthetic-contract-conformance',
  'synthetic-determinism-evidence',
  'bounded-offline-validation',
]);
const SYNTHETIC_DISTANCE_BUCKETS = Object.freeze([
  'synthetic-distance-q1',
  'synthetic-distance-q2',
  'synthetic-distance-q3',
  'synthetic-distance-q4',
  'synthetic-distance-q5',
]);
const CAPABILITY_FACTORS = Object.freeze(['step-free', 'curb-ramp-present', 'paved-surface']);
const ATTEMPT_STATES = new Set(['not-started', 'started-no-terminal', 'terminal']);
const EXECUTION_ROLES = new Set(['primary', 'replay']);
const CONFORMANCE_OUTCOMES = new Set(['not-applicable', 'pass', 'fail', 'not-run']);
const ROUTE_SEARCH_TERMINATION_SET = new Set(ROUTE_SEARCH_TERMINATIONS);
const S3_ZERO_CANDIDATE_REASON_BY_TERMINATION = Object.freeze({
  'invalid-input': 'candidate-search-invalid-input',
  'endpoint-unavailable': 'candidate-search-endpoint-unavailable',
  'no-directed-route-in-bounded-scope': 'candidate-search-no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope': 'candidate-search-no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence': 'candidate-search-unresolved-constraint-evidence',
  'search-budget-exhausted': 'candidate-search-budget-exhausted',
  'search-capacity-exhausted': 'candidate-search-capacity-exhausted',
});
const OBSERVATION_KEYS = Object.freeze([
  'observedBooleanTrue',
  'observedBooleanFalse',
  'observedNumericNonzero',
  'numericZero',
  'missing',
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
]);
const TERMINATION_KEYS = Object.freeze([
  'not-started',
  'started-no-terminal',
  'invalid-input',
  'endpoint-unavailable',
  'requested-candidate-count-reached',
  'bounded-search-space-exhausted',
  'no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence',
  'search-budget-exhausted',
  'search-capacity-exhausted',
]);

function fail(message) {
  throw new TypeError(`route decision S3 protocol contract: ${message}`);
}

function inspectPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) fail(`${label} must not contain symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of ownKeys) {
    if (!Object.hasOwn(descriptors[key], 'value')) fail(`${label} must contain data properties only`);
  }
  return { ownKeys, descriptors };
}

function exactObject(value, label, requiredKeys) {
  const { ownKeys, descriptors } = inspectPlainObject(value, label);
  const allowed = new Set(requiredKeys);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = ownKeys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return Object.fromEntries(ownKeys.map((key) => [key, descriptors[key].value]));
}

function strictArray(value, label, { min = 0, max } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be an array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) fail(`${label} must not contain symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || (max !== undefined && length > max)) {
    fail(`${label} length is outside the supported range`);
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail(`${label} must not contain sparse entries`);
    if (!Object.hasOwn(descriptor, 'value')) fail(`${label} must contain data properties only`);
    items.push(descriptor.value);
  }
  const extra = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
  if (extra.length) fail(`${label} contains unsupported properties`);
  return items;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function snapshotData(value, label, context = null, depth = 0) {
  const state = context ?? { stack: new WeakSet(), nodes: 0 };
  state.nodes += 1;
  if (state.nodes > SNAPSHOT_MAX_NODES) {
    fail(`${label} exceeds the bounded snapshot node budget`);
  }
  if (depth > SNAPSHOT_MAX_DEPTH) {
    fail(`${label} exceeds the bounded snapshot depth`);
  }
  if (!value || typeof value !== 'object') return value;
  if (state.stack.has(value)) fail(`${label} must not contain cycles`);
  state.stack.add(value);
  const isArray = Array.isArray(value);
  const expectedPrototype = isArray ? Array.prototype : Object.prototype;
  if (Object.getPrototypeOf(value) !== expectedPrototype) fail(`${label} must use a supported prototype`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) fail(`${label} must not contain symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = isArray ? [] : {};
  if (isArray) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length)) fail(`${label} array length is invalid`);
    output.length = length;
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label} array must be dense data properties`);
      output[index] = snapshotData(descriptor.value, `${label}[${index}]`, state, depth + 1);
    }
    const extra = keys.filter((key) => key !== 'length'
      && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
    if (extra.length) fail(`${label} array contains unsupported properties`);
  } else {
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) fail(`${label} must contain data properties only`);
      output[key] = snapshotData(descriptor.value, `${label}.${key}`, state, depth + 1);
    }
  }
  state.stack.delete(value);
  return output;
}

function admitPolicy(raw, label) {
  return admitDecisionPolicy(snapshotData(raw, label));
}

function admitSearchRequest(raw, label) {
  return admitRouteCandidateSearchRequest(snapshotData(raw, label));
}

function admitSearchResult(raw, label) {
  return admitRouteCandidateSearchResult(snapshotData(raw, label));
}

function admitSyntheticGraph(raw, label) {
  return admitGraphArtifact(snapshotData(raw, label));
}

function admitDecisionEvaluation(raw, label) {
  return admitRouteSearchDecisionEvaluation(snapshotData(raw, label));
}

function id(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function version(value, label) {
  if (typeof value !== 'string' || value.length > 160
    || !/^[a-z0-9][a-z0-9._:/-]{0,159}$/.test(value) || BLOCKED_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical version`);
  }
  return value;
}

function text(value, label, { max = 500, nonEmpty = true } = {}) {
  if (typeof value !== 'string' || value.length > max || (nonEmpty && value.length === 0)) {
    fail(`${label} must be bounded text`);
  }
  return value;
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) {
    fail(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`);
  return value;
}

function exactVersion(value, expected, label) {
  if (value !== expected) fail(`${label} is unsupported`);
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} is unsupported`);
  return value;
}

function same(left, right, context = null, depth = 0) {
  const state = context ?? {
    leftStack: new WeakSet(),
    rightStack: new WeakSet(),
    nodes: 0,
  };
  state.nodes += 1;
  if (state.nodes > SNAPSHOT_MAX_NODES || depth > SNAPSHOT_MAX_DEPTH) return false;
  if (typeof left === 'function' || typeof right === 'function') return false;
  const leftIsObject = left !== null && typeof left === 'object';
  const rightIsObject = right !== null && typeof right === 'object';
  if (!leftIsObject || !rightIsObject) {
    return !leftIsObject && !rightIsObject && Object.is(left, right);
  }
  if (state.leftStack.has(left) || state.rightStack.has(right)) return false;
  state.leftStack.add(left);
  state.rightStack.add(right);
  try {
    return sameObjects(left, right, state, depth);
  } finally {
    state.leftStack.delete(left);
    state.rightStack.delete(right);
  }
}

function sameObjects(left, right, state, depth) {
  let leftIsArray;
  let rightIsArray;
  let leftPrototype;
  let rightPrototype;
  let leftKeys;
  let rightKeys;
  let leftDescriptors;
  let rightDescriptors;
  try {
    leftIsArray = Array.isArray(left);
    rightIsArray = Array.isArray(right);
    leftPrototype = Object.getPrototypeOf(left);
    rightPrototype = Object.getPrototypeOf(right);
    leftKeys = Reflect.ownKeys(left);
    rightKeys = Reflect.ownKeys(right);
    leftDescriptors = Object.getOwnPropertyDescriptors(left);
    rightDescriptors = Object.getOwnPropertyDescriptors(right);
  } catch {
    return false;
  }

  if (leftIsArray !== rightIsArray) return false;
  const expectedPrototype = leftIsArray ? Array.prototype : Object.prototype;
  if (leftPrototype !== expectedPrototype || rightPrototype !== expectedPrototype) return false;
  if (leftKeys.some((key) => typeof key === 'symbol' || BLOCKED_NAMES.has(key))
    || rightKeys.some((key) => typeof key === 'symbol' || BLOCKED_NAMES.has(key))) {
    return false;
  }

  if (leftIsArray) {
    const leftLength = leftDescriptors.length?.value;
    const rightLength = rightDescriptors.length?.value;
    if (!Number.isSafeInteger(leftLength) || !Number.isSafeInteger(rightLength)
      || leftLength !== rightLength) {
      return false;
    }
    const supportedArrayKey = (key, length) => key === 'length'
      || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < length);
    if (leftKeys.some((key) => !supportedArrayKey(key, leftLength))
      || rightKeys.some((key) => !supportedArrayKey(key, rightLength))) {
      return false;
    }
    for (let index = 0; index < leftLength; index += 1) {
      const key = String(index);
      const leftDescriptor = leftDescriptors[key];
      const rightDescriptor = rightDescriptors[key];
      if (!leftDescriptor || !rightDescriptor
        || !Object.hasOwn(leftDescriptor, 'value')
        || !Object.hasOwn(rightDescriptor, 'value')
        || !same(leftDescriptor.value, rightDescriptor.value, state, depth + 1)) {
        return false;
      }
    }
    return true;
  }

  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const leftDescriptor = leftDescriptors[key];
    if (!Object.hasOwn(rightDescriptors, key)) return false;
    const rightDescriptor = rightDescriptors[key];
    if (!rightDescriptor
      || !Object.hasOwn(leftDescriptor, 'value')
      || !Object.hasOwn(rightDescriptor, 'value')
      || !same(leftDescriptor.value, rightDescriptor.value, state, depth + 1)) {
      return false;
    }
  }
  return true;
}

export function areS3DataTreesEquivalent(left, right) {
  return same(left, right);
}

function exactSequence(value, expected, label) {
  const items = strictArray(value, label, { min: expected.length, max: expected.length });
  if (items.some((item, index) => item !== expected[index])) {
    fail(`${label} must exactly preserve ${expected.join(',')}`);
  }
  return [...items];
}

function admitExactLiteral(raw, expected, label) {
  if (Array.isArray(expected)) {
    return strictArray(raw, label, { min: expected.length, max: expected.length })
      .map((item, index) => admitExactLiteral(item, expected[index], `${label}[${index}]`));
  }
  if (expected && typeof expected === 'object') {
    const keys = Object.keys(expected);
    const value = exactObject(raw, label, keys);
    return Object.fromEntries(keys.map((key) => [
      key,
      admitExactLiteral(value[key], expected[key], `${label}.${key}`),
    ]));
  }
  if (raw !== expected) fail(`${label} drifted from the frozen protocol`);
  return expected;
}

function uniqueIds(value, label, max) {
  const items = strictArray(value, label, { max }).map((item, index) => id(item, `${label}[${index}]`));
  if (new Set(items).size !== items.length) fail(`${label} must be unique`);
  return items;
}

function claimCodes(raw, label) {
  const values = uniqueIds(raw, label, CLAIMS.size);
  for (const value of values) {
    if (!CLAIMS.has(value)) fail(`${label} contains a prohibited or unsupported claim`);
  }
  return values;
}

function assertCounts(value, label) {
  for (const [key, expected] of Object.entries(S3_SCENARIO_COUNTS)) {
    if (value[key] !== expected) fail(`${label}.${key} must be ${expected}`);
  }
}

function softPreference(preferenceId, needTag, factorId, rangeMax, weightBasisPoints) {
  return {
    preferenceId,
    needTag,
    factorId,
    operator: 'minimize',
    rangeMin: 0,
    rangeMax,
    weightBasisPoints,
  };
}

const TIE_BREAK = Object.freeze([
  Object.freeze({ factorId: 'score-units', direction: 'descending' }),
  Object.freeze({ factorId: 'objective-cost-units', direction: 'ascending' }),
  Object.freeze({ factorId: 'distance-mm', direction: 'ascending' }),
  Object.freeze({ factorId: 'candidate-id', direction: 'ascending' }),
]);

function hardConstraint(factorId) {
  return {
    constraintId: `requires-${factorId}`,
    needTag: 'require-capability',
    factorId,
    operator: 'equals',
    expectedValue: true,
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
  };
}

function decisionPolicy(policyId, hardConstraints, softPreferences) {
  return admitPolicy({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
    policyId,
    hardConstraints,
    softPreferences,
    weightBasisPointsTotal: 10_000,
    tieBreak: TIE_BREAK,
  }, 'S3 frozen DecisionPolicy');
}

export const S3_DECISION_POLICIES = Object.freeze([
  decisionPolicy('s3-objective-cost-only-policy-v1', [], [
    softPreference('objective-cost', 'minimize-objective-cost', 'objective-cost-units', 100_000_000, 10_000),
  ]),
  decisionPolicy('s3-distance-ranking-policy-v1', [], [
    softPreference('distance', 'minimize-distance', 'distance-mm', 100_000_000, 10_000),
  ]),
  decisionPolicy('s3-distance-objective-equal-policy-v1', [], [
    softPreference('distance', 'minimize-distance', 'distance-mm', 100_000_000, 5_000),
    softPreference('objective-cost', 'minimize-objective-cost', 'objective-cost-units', 100_000_000, 5_000),
  ]),
  decisionPolicy('s3-distance-objective-reweighted-policy-v1', [], [
    softPreference('distance', 'minimize-distance', 'distance-mm', 50_000_000, 6_500),
    softPreference('objective-cost', 'minimize-objective-cost', 'objective-cost-units', 50_000_000, 3_500),
  ]),
  decisionPolicy('s3-three-capability-policy-v1', [
    hardConstraint('step-free'),
    hardConstraint('curb-ramp-present'),
    hardConstraint('paved-surface'),
  ], [
    softPreference('distance', 'minimize-distance', 'distance-mm', 100_000_000, 5_000),
    softPreference('objective-cost', 'minimize-objective-cost', 'objective-cost-units', 100_000_000, 5_000),
  ]),
]);

function searchConstraint(constraint) {
  return {
    constraintId: constraint.constraintId,
    factorId: constraint.factorId,
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
  };
}

function searchTemplate(policy) {
  return admitSearchRequest({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: 's3-request-placeholder',
    graphId: 's3-graph-placeholder',
    mode: 'walk',
    originNodeId: 's3-origin-placeholder',
    destinationNodeId: 's3-destination-placeholder',
    decisionPolicyId: policy.policyId,
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 5,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: { maxExpandedStates: 100_000, maxRouteEdgeCount: 1_024 },
    hardConstraints: policy.hardConstraints.map(searchConstraint),
  }, 'S3 frozen CandidateSearchRequest');
}

function assertPolicySearchEquality(policy, request, label) {
  const policyConstraints = policy.hardConstraints.map((constraint) => ({
    constraintId: constraint.constraintId,
    factorId: constraint.factorId,
    operator: constraint.operator,
    expectedValue: constraint.expectedValue,
    unresolvedStates: constraint.unresolvedStates,
  }));
  const searchConstraints = request.hardConstraints.map((constraint) => ({
    constraintId: constraint.constraintId,
    factorId: constraint.factorId,
    operator: constraint.operator,
    expectedValue: constraint.expectedValue,
    unresolvedStates: constraint.unresolvedStates,
  }));
  if (!same(policyConstraints, searchConstraints)) {
    fail(`${label} policy hard constraints and search hard constraints must be bidirectionally equal`);
  }
}

export const S3_CONFIGURATION_GROUPS = deepFreeze(
  S3_CONFIGURATION_IDS.map((configurationId, index) => ({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.configuration,
    configurationId,
    ordinal: index,
    configurationKind: CONFIGURATION_KINDS[index],
    definitionScope: 'researcher-defined-synthetic-s3',
    historicalWrtRecovery: 'not-claimed',
    policyArtifactVersion: `${configurationId}-policy-artifact-v1`,
    decisionPolicy: S3_DECISION_POLICIES[index],
    searchRequestTemplate: searchTemplate(S3_DECISION_POLICIES[index]),
    capacityPolicy: { ...ROUTE_SEARCH_CAPACITY_POLICY },
  })),
);

export const S3_SYNTHETIC_PROFILES = deepFreeze([
  {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.syntheticProfile,
    profileId: 's3-profile-a',
    profileKind: 'synthetic-cohort-stratum',
    assignmentTarget: 500,
    pairedStratumLabel: 'paired-a',
    behavioralEffect: 'forbidden',
  },
  {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.syntheticProfile,
    profileId: 's3-profile-b',
    profileKind: 'synthetic-cohort-stratum',
    assignmentTarget: 500,
    pairedStratumLabel: 'paired-b',
    behavioralEffect: 'forbidden',
  },
]);

export const S3_ORACLE_EXECUTION_SPEC = deepFreeze({
  schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.oracleExecutionSpec,
  algorithmVersion: S3_ORACLE_ALGORITHM_VERSION,
  implementationBoundary: 's3-2-separate-module-and-import-boundary-required',
  mainRecordPolicy: {
    terminalProductExecution: 'computed',
    notStartedProductExecution: 'not-run',
    startedNoTerminalProductExecution: 'not-run',
  },
  conformanceRecordPolicy: {
    terminalProductExecution: 'computed',
    notStartedProductExecution: 'not-run',
    startedNoTerminalProductExecution: 'not-run',
  },
  pathUniverse: {
    kind: 'all-loopless-directed-paths-within-frozen-request-bounds',
    graphInput: 'exact-admitted-synthetic-graph-artifact',
    endpointInput: 'exact-preregistered-od-pair',
    maxExpandedStates: 100_000,
    maxRouteEdgeCount: 1_024,
    capacityPolicy: { ...ROUTE_SEARCH_CAPACITY_POLICY },
  },
  candidateGeneration: {
    requestedCandidateCount: 5,
    objectiveFactorId: 'objective-cost-units',
    distinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    returnedOrder: 'objective-cost-units-then-directed-edge-id-sequence',
    candidateIdRule: {
      version: 'finalized-returned-order-one-based-candidate-id/v1',
      prefix: 'candidate:',
      indexBase: 1,
      template: 'candidate:${index+1}',
      semanticIndex: 'one-based-index-in-finalized-returned-order',
      renamingAllowed: false,
      decisionReferenceRule: 'every-provided-set-candidate-id-must-reference-that-exact-generated-id',
    },
  },
  resourceSemantics: {
    version: 's3-loopless-frontier-resource-semantics/v1',
    expandedStateUnit: {
      version: 'loopless-frontier-state-expansion/v1',
      chargedEvent: 'pop-non-destination-label-below-edge-bound-then-inspect-outgoing-adjacency',
      deadEndsCharged: true,
      destinationLabelsCharged: false,
      maxEdgeBoundLabelsCharged: false,
      incrementTiming: 'after-pop-before-outgoing-edge-inspection',
      sharedAcrossClassificationPasses: true,
    },
    frontierOrdering: {
      version: 'objective-cost-then-directed-edge-id-sequence/v1',
      keys: [
        'objective-cost-units-ascending',
        'complete-directed-edge-id-sequence-code-unit-lexicographic',
        'shorter-identical-prefix-first',
      ],
      outgoingEdgeIteration: 'stable-edge-id-code-unit-ascending',
      peekBeforeResourceGate: true,
    },
    eventCharging: {
      destinationPop: 'emit-or-unresolved-discard-with-zero-expanded-state-charge',
      maxEdgeBoundPop: 'discard-with-zero-expanded-state-charge',
      ordinaryPop: 'one-expanded-state-before-adjacency-inspection',
      candidateEmit: 'zero-additional-expanded-state-charge',
      knownFalseEdge: 'skip-child-after-parent-expansion-was-charged',
      unresolvedEdge: 'enqueue-unresolved-label-after-parent-expansion-was-charged',
    },
    frontierCapacityAccounting: {
      initialFrontierStates: 1,
      initialFrontierEdgeReferences: 0,
      edgeReferenceUnit: 'one-reference-per-edge-id-in-every-frontier-label-edge-path',
      decrementTiming: 'subtract-popped-label-full-edge-path-before-discard-emit-or-expand',
      stateCheckTiming: 'before-each-child-push',
      stateFailurePredicate: 'current-frontier-size-greater-than-or-equal-max-frontier-states',
      edgeReferenceCheckTiming: 'before-each-child-push',
      edgeReferenceFailurePredicate: 'current-plus-prospective-child-edge-path-length-greater-than-max',
      incrementTiming: 'after-child-push-add-prospective-child-full-edge-path-length',
      firstViolationStopsEnumeration: true,
    },
    classificationPasses: {
      constrainedPassFirst: true,
      topologyOnlyPassTrigger: 'zero-routes-and-no-unresolved-and-known-false-encountered',
      topologyOnlyPassAppliesConstraints: false,
      topologyOnlyRequestedCandidateCount: 1,
      topologyOnlyRoutesAreNeverPublicCandidates: true,
      expandedStateCounterSharedWithoutReset: true,
      frontierCapacityCountersRestartPerPass: true,
    },
    terminalPrecedence: {
      withinEnumerationLoop: [
        'destination-emit-and-requested-k',
        'max-edge-bound-discard',
        'shared-expanded-state-budget',
        'ordinary-expansion-and-overflow',
        'prospective-child-frontier-capacity',
      ],
      constrainedOutcome: [
        'arithmetic-overflow-invalid-input',
        'requested-candidate-count-reached',
        'search-budget-exhausted',
        'search-capacity-exhausted',
        'returned-routes-with-unresolved-or-bounded-exhaustion',
        'no-constraint-no-directed-route',
        'unresolved-constraint-evidence',
        'no-known-false-no-directed-route',
        'topology-only-second-pass',
      ],
      topologyOutcome: [
        'arithmetic-overflow-invalid-input',
        'search-budget-exhausted',
        'search-capacity-exhausted',
        'topology-route-no-eligible-route',
        'no-topology-route-no-directed-route',
      ],
      conflictRules: {
        requestedKBeforeBudget: 'destination-is-emitted-and-k-checked-before-budget-gate',
        budgetBeforeCapacity: 'budget-is-checked-before-expansion-while-capacity-is-checked-during-child-generation',
        capacityBeforeFutureK: 'capacity-failure-during-child-generation-stops-before-any-future-destination-emit',
        knownFalseSecondPassResource: 'shared-budget-or-capacity-exhaustion-overrides-no-eligible-classification',
      },
    },
    conformanceFixtures: [
      {
        fixtureId: 'same-route-universe-expansion-order-budget-boundary',
        ruleUnderTest: 'objective-cost-frontier-order-is-normative',
        maxExpandedStates: 2,
        expectedExpandedStateCount: 2,
        expectedTermination: 'search-budget-exhausted',
        forbiddenCounterfactual: 'expanding-the-higher-cost-prefix-first-to-reach-a-destination-before-the-budget-gate',
      },
      {
        fixtureId: 'known-false-shared-second-pass-budget',
        ruleUnderTest: 'topology-only-pass-shares-the-constrained-expanded-state-counter',
        maxExpandedStates: 2,
        expectedExpandedStateCount: 2,
        expectedTermination: 'search-budget-exhausted',
        forbiddenCounterfactual: 'resetting-the-budget-and-returning-no-eligible-route',
      },
      {
        fixtureId: 'resource-terminal-conflict-precedence',
        ruleUnderTest: 'k-before-budget-budget-before-capacity-capacity-before-future-k',
        expectedRules: [
          'destination-k-before-budget',
          'budget-before-next-expansion-capacity-check',
          'capacity-during-generation-before-future-destination-k',
        ],
      },
    ],
  },
  constraintEvaluation: {
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    evidenceRequirement: 'complete-per-directed-edge-for-each-hard-constraint',
    knownFalsePrecedence: 'known-false-dominates-unresolved-on-a-route',
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
  },
  searchOutcomeAdmission: {
    terminationEnum: [...ROUTE_SEARCH_TERMINATIONS],
    canonicalMetadataFields: [
      'status', 'requestedCandidateCount', 'candidateCount', 'expandedStateCount',
      'routeSearchCompleteness', 'constraintOutcome', 'budgetOutcome', 'capacityOutcome',
      'unresolvedEvidenceEncountered',
    ],
    candidatefulTerminations: [
      'requested-candidate-count-reached',
      'bounded-search-space-exhausted',
      'unresolved-constraint-evidence',
      'search-budget-exhausted',
      'search-capacity-exhausted',
    ],
    zeroCandidateOnlyTerminations: [
      'invalid-input',
      'endpoint-unavailable',
      'no-directed-route-in-bounded-scope',
      'no-eligible-route-in-bounded-scope',
    ],
    truthTable: {
      invalidInput: 'rejected-null-request-and-candidate-set-zero-candidates-only-for-invalid-input-conformance-probe',
      endpointUnavailable: 'inapplicable-in-s3-v1-because-every-main-and-conformance-endpoint-is-bound-to-an-admitted-graph-node',
      requestedCountReached: 'completed-count-equals-requested-not-proven-within-resources',
      boundedSearchSpaceExhausted: 'completed-zero-less-than-count-less-than-requested-complete-within-resources',
      noDirectedRoute: 'completed-zero-candidates-complete-within-resources',
      noEligibleRoute: 'completed-zero-candidates-constraints-required-proven-complete-within-resources',
      unresolvedConstraintEvidence: 'completed-count-less-than-requested-constraints-required-unresolved-complete-within-resources',
      searchBudgetExhausted: 'stopped-count-less-than-requested-not-proven-budget-exhausted-at-bound-capacity-within-unresolved-flag-binds-constraint-outcome',
      searchCapacityExhausted: 'stopped-count-less-than-requested-not-proven-budget-within-capacity-exhausted-unresolved-flag-binds-constraint-outcome',
    },
    constraintOutcomeRules: {
      noConstraints: 'not-required',
      requestedCountReached: 'eligible-candidates-returned-before-unresolved-flag',
      requestedCountEncounterHistory: 'null-because-public-s2-candidate-set-does-not-expose-an-overridden-internal-encounter-flag',
      unresolvedEvidenceEncountered: 'unresolved-evidence-before-positive-candidate-count-for-unresolved-budget-or-capacity-terminals',
      positiveCandidateCountWithoutUnresolvedEvidence: 'eligible-candidates-returned',
      noDirectedRouteWithConstraints: 'not-evaluated',
      noEligibleRoute: 'no-eligible-route-in-bounded-scope-proven',
      unresolvedConstraintEvidence: 'unresolved-evidence',
      zeroCandidateResourceStopInFullyObservedSyntheticMainCohort: 'no-eligible-route-not-proven',
    },
    terminalApplicability: {
      invalidInput: 'conformance-invalid-input-probe-only',
      endpointUnavailable: 'forbidden-in-s3-v1',
    },
  },
  providedSetEvaluation: {
    policyInput: 'exact-admitted-decision-policy-snapshot',
    envelopeIdentity: {
      evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
      candidateArtifactSchemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchResult,
      decisionSchemaVersion: ROUTE_SEARCH_DECISION_VERSION,
      projectionContractSchemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionResult,
      decisionScope: 'provided-candidate-set',
      evaluationEnvelopeFields: ['schemaVersion', 'policy', 'candidateArtifact', 'evaluation'],
      evaluationFields: ['status', 'reasonCode', 'decision'],
      decisionFields: [
        'schemaVersion', 'scope', 'candidateSetId', 'candidateSetRevision',
        'candidateIds', 'status', 'admittedCandidateIds', 'rankedCandidateIds',
        'rejected', 'unresolved', 'trace',
      ],
    },
    outerMapping: {
      candidatefulStatus: 'evaluated',
      candidatefulReasonCode: 'provided-candidate-set-evaluated',
      zeroCandidateStatus: 'not-evaluated',
      zeroCandidateDecision: null,
      zeroCandidateReasonByTermination: { ...S3_ZERO_CANDIDATE_REASON_BY_TERMINATION },
      unsupportedZeroCandidateTerminations: [
        'requested-candidate-count-reached',
        'bounded-search-space-exhausted',
      ],
    },
    scoring: {
      basisPointsTotal: 10_000,
      preferenceIterationOrder: 'preference-id-code-unit-ascending',
      candidateIterationOrder: 'candidate-id-code-unit-ascending',
      factorRawValue: {
        'distance-mm': 'candidate-distance-mm',
        'objective-cost-units': 'candidate-objective-cost-units',
      },
      supportedDirection: 'minimize',
      clamp: 'min-range-max-of-max-range-min-and-raw-value',
      rangeSpan: 'range-max-minus-range-min',
      utilityDistance: 'range-max-minus-clamped-value',
      utilityNumerator: 'utility-distance-times-10000',
      utilityBasisPoints: 'floor-utility-numerator-divided-by-range-span',
      weightedScoreUnits: 'utility-basis-points-times-weight-basis-points-without-post-division',
      totalScoreUnits: 'safe-integer-sum-of-weighted-score-units',
      unsafeArithmeticDisposition: 'fail-closed-no-computed-oracle-outcome',
    },
    ranking: {
      rule: 'policy-tie-break-in-declared-order',
      numericComparison: 'integer-ascending-or-descending-per-policy',
      candidateIdComparison: 'code-unit-lexicographic-per-policy',
      requiredFirstKey: { factorId: 'score-units', direction: 'descending' },
      requiredLastKey: { factorId: 'candidate-id', direction: 'ascending' },
      admittedCandidateIdsOrder: 'exact-ranked-candidate-id-order',
      rankedCandidateIdsOrder: 'exact-ranked-candidate-id-order',
      rankBase: 1,
      decidingFactorId: null,
      reasonCode: 'candidate-ranked',
    },
    dispositions: {
      hardKnownFalseBeforeUnresolved: true,
      hardFailure: {
        outcome: 'rejected',
        reasonCode: 'candidate-hard-constraint-rejected',
      },
      hardUnresolved: {
        outcome: 'unresolved',
        reasonCode: 'candidate-hard-constraint-unresolved',
      },
      softUnresolved: {
        outcome: 'unresolved',
        reasonCode: 'candidate-soft-preference-unresolved',
      },
      scored: {
        outcome: 'admitted',
        reasonCode: 'candidate-admitted',
      },
      decisionStatusPrecedence: {
        atLeastOneAdmitted: 'ranked-in-provided-set',
        noAdmittedAndAtLeastOneUnresolved: 'candidate-search-incomplete',
        noAdmittedNoUnresolvedAndAtLeastOneRejected: 'no-eligible-candidate-in-provided-set',
        noDisposition: 'candidate-search-incomplete',
      },
      admittedCandidateIdsSource: 'ranked-candidates-after-complete-policy-tie-break',
      rankedCandidateIdsSource: 'ranked-candidates-after-complete-policy-tie-break',
      rejectedCandidateIdsSource: 'first-occurrence-order-of-public-rejected-trace',
      unresolvedCandidateIdsSource: 'first-occurrence-order-of-public-unresolved-trace',
      candidateEvaluationOrder: 'candidate-id-code-unit-ascending',
      hardConstraintOrder: 'constraint-id-code-unit-ascending-per-candidate',
      softPreferenceOrder: 'preference-id-code-unit-ascending-per-hard-admitted-candidate',
      tracePhaseOrder: [
        'all-hard-constraint-and-immediate-hard-disposition-records',
        'all-soft-preference-and-immediate-soft-disposition-records',
        'all-ranking-records-in-rank-order',
      ],
    },
    publicExplanation: {
      canonicalization: 's3-provided-set-public-explanation/v1',
      topLevelFields: [
        'hardConstraintTrace', 'softPreferenceTrace', 'candidateDispositions', 'rankingTrace',
      ],
      hardConstraintTraceFields: [
        'candidateId', 'stage', 'constraintId', 'factorId', 'observationState',
        'actualValue', 'operator', 'expectedValue', 'outcome', 'reasonCode',
      ],
      softPreferenceTraceFields: [
        'candidateId', 'stage', 'preferenceId', 'factorId', 'observationState',
        'rawValue', 'unit', 'direction', 'rangeMin', 'rangeMax', 'rangeSpan',
        'utilityNumerator', 'utilityBasisPoints', 'weightBasisPoints',
        'weightedScoreUnits', 'outcome', 'reasonCode',
      ],
      candidateDispositionFields: [
        'candidateId', 'stage', 'outcome', 'constraintIds', 'preferenceIds',
        'totalScoreUnits', 'reasonCode',
      ],
      rankingTraceFields: [
        'candidateId', 'stage', 'outcome', 'totalScoreUnits', 'rank',
        'tieBreakValues', 'decidingFactorId', 'reasonCode',
      ],
      tieBreakValueFields: ['factorId', 'direction', 'value'],
      hardConstraintReasonCodes: {
        pass: 'hard-constraint-passed',
        reject: 'hard-constraint-failed',
        unresolvedTemplate: 'hard-constraint-${observationState}-unresolved',
      },
      softPreferenceReasonCodes: {
        scored: 'soft-preference-scored',
        unresolvedTemplate: 'soft-preference-${observationState}-unresolved',
      },
      candidateDispositionReasonCodes: [
        'candidate-admitted',
        'candidate-hard-constraint-rejected',
        'candidate-hard-constraint-unresolved',
        'candidate-soft-preference-unresolved',
      ],
      rankingReasonCode: 'candidate-ranked',
      canonicalOutcomeFields: [
        'evaluationSchemaVersion', 'evaluationStatus', 'reasonCode',
        'decisionSchemaVersion', 'scope', 'decisionStatus',
        'admittedCandidateIds', 'rankedCandidateIds', 'rejectedCandidateIds',
        'unresolvedCandidateIds', 'publicExplanation',
      ],
    },
    differentialFixtures: [
      {
        fixtureId: 'clamp-floor-weight-and-candidate-id-tie-break',
        preference: {
          preferenceId: 'objective-cost', factorId: 'objective-cost-units',
          rangeMin: 0, rangeMax: 3, weightBasisPoints: 10_000,
        },
        candidates: [
          { candidateId: 'candidate:1', rawValue: 1 },
          { candidateId: 'candidate:2', rawValue: 1 },
          { candidateId: 'candidate:3', rawValue: 4 },
        ],
        expectedScores: [
          {
            candidateId: 'candidate:1', clampedValue: 1, utilityNumerator: 20_000,
            utilityBasisPoints: 6_666, weightedScoreUnits: 66_660_000,
          },
          {
            candidateId: 'candidate:2', clampedValue: 1, utilityNumerator: 20_000,
            utilityBasisPoints: 6_666, weightedScoreUnits: 66_660_000,
          },
          {
            candidateId: 'candidate:3', clampedValue: 3, utilityNumerator: 0,
            utilityBasisPoints: 0, weightedScoreUnits: 0,
          },
        ],
        expectedRankedCandidateIds: ['candidate:1', 'candidate:2', 'candidate:3'],
        expectedDispositionReasonCode: 'candidate-admitted',
        expectedRankingReasonCode: 'candidate-ranked',
        expectedOuterReasonCode: 'provided-candidate-set-evaluated',
      },
    ],
  },
  independenceEvidence: {
    comparatorAloneProvesIndependence: false,
    evaluatorOracleBoundary: 's3-2-separate-evaluator-oracle-module-required',
    forbiddenEvaluatorOracleImports: [
      'product-route-search-decision-evaluator',
      'product-route-candidate-search',
      'product-route-enrichment',
    ],
    allowedEvaluatorOracleImports: [
      'public-s0-s2-contract-constants',
      'frozen-s3-fixture-data',
    ],
    requiredS3_2Evidence: [
      'separate-oracle-module',
      'product-implementation-import-boundary-test',
      'evaluator-oracle-static-import-boundary-test',
      'differential-fixture-tests',
    ],
  },
});

export const S3_PERFORMANCE_PROTOCOL = deepFreeze({
  schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.performanceProtocol,
  protocolVersion: 's3-optional-diagnostic-performance/v1',
  executionOrder: ['primary-cold', 'warmup-1', 'warmup-2', 'replay-warm'],
  warmupRuns: 2,
  warmupDenominatorPolicy: 'excluded-from-record-and-performance-denominators',
  primaryCacheState: 'cold',
  replayCacheState: 'warm',
  coldDefinition: 'first-execution-after-fixture-load-before-any-warmup',
  warmDefinition: 'replay-after-two-unrecorded-warmups-of-the-same-scenario-config',
  timerScope: 'product-adapter-call-through-admitted-search-and-evaluation-result',
  monotonicClock: 'runtime-monotonic-clock-integer-microseconds',
  latencyMethod: 'ceiling-of-monotonic-elapsed-microseconds',
  memoryMethod: 'absolute-runtime-heap-used-bytes-after-execution',
  concurrency: 1,
  requiredSampleCoverage: 'none-because-no-performance-claim-is-eligible-in-v1',
  notMeasuredReasons: [
    'measurement-not-enabled',
    'measurement-failure',
    'execution-not-started',
    'execution-nonterminal',
  ],
  notMeasuredReasonConditions: {
    measurementNotEnabled: 'any-record-when-performance-sampling-is-disabled',
    measurementFailure: 'attempted-or-terminal-record-whose-measurement-operation-failed',
    executionNotStarted: 'not-started-attempt',
    executionNonterminal: 'started-no-terminal-attempt',
  },
  measurementFailureDisposition: 'not-measured-with-explicit-reason',
  partialAndStoppedPolicy: 'include-if-measured-and-disclose-record-status-separately',
  zeroSamplePolicy: {
    boundedOfflineValidationAllowed: true,
    boundedOfflineValidationIncludesPerformanceClaim: false,
    performanceClaimEligible: false,
  },
  thresholdPolicy: 'no-post-hoc-threshold',
});

function admitCapacityPolicy(raw, label) {
  const value = exactObject(raw, label, ['version', 'maxFrontierStates', 'maxFrontierEdgeReferences']);
  const admitted = {
    version: version(value.version, `${label}.version`),
    maxFrontierStates: integer(value.maxFrontierStates, `${label}.maxFrontierStates`, { min: 1 }),
    maxFrontierEdgeReferences: integer(value.maxFrontierEdgeReferences, `${label}.maxFrontierEdgeReferences`, { min: 1 }),
  };
  if (!same(admitted, ROUTE_SEARCH_CAPACITY_POLICY)) fail(`${label} must match the frozen S2 capacity policy`);
  return admitted;
}

export function admitS3ConfigurationGroup(raw) {
  const value = exactObject(raw, 'S3ConfigurationGroup', [
    'schemaVersion', 'configurationId', 'ordinal', 'configurationKind', 'definitionScope',
    'historicalWrtRecovery', 'policyArtifactVersion', 'decisionPolicy',
    'searchRequestTemplate', 'capacityPolicy',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.configuration, 'S3ConfigurationGroup.schemaVersion');
  const configurationId = id(value.configurationId, 'S3ConfigurationGroup.configurationId');
  const index = S3_CONFIGURATION_IDS.indexOf(configurationId);
  if (index < 0) fail('S3ConfigurationGroup.configurationId is unsupported');
  const policy = admitPolicy(value.decisionPolicy, 'S3ConfigurationGroup.decisionPolicy');
  const request = admitSearchRequest(value.searchRequestTemplate, 'S3ConfigurationGroup.searchRequestTemplate');
  assertPolicySearchEquality(policy, request, 'S3ConfigurationGroup');
  const admitted = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.configuration,
    configurationId,
    ordinal: integer(value.ordinal, 'S3ConfigurationGroup.ordinal', { max: 4 }),
    configurationKind: value.configurationKind,
    definitionScope: value.definitionScope,
    historicalWrtRecovery: value.historicalWrtRecovery,
    policyArtifactVersion: id(value.policyArtifactVersion, 'S3ConfigurationGroup.policyArtifactVersion'),
    decisionPolicy: policy,
    searchRequestTemplate: request,
    capacityPolicy: admitCapacityPolicy(value.capacityPolicy, 'S3ConfigurationGroup.capacityPolicy'),
  };
  if (!same(admitted, S3_CONFIGURATION_GROUPS[index])) fail('S3ConfigurationGroup drifted from the frozen current-primitive configuration');
  return deepFreeze(admitted);
}

export function admitS3SyntheticProfile(raw) {
  const value = exactObject(raw, 'S3SyntheticProfile', [
    'schemaVersion', 'profileId', 'profileKind', 'assignmentTarget',
    'pairedStratumLabel', 'behavioralEffect',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.syntheticProfile, 'S3SyntheticProfile.schemaVersion');
  const profileId = id(value.profileId, 'S3SyntheticProfile.profileId');
  const index = S3_SYNTHETIC_PROFILE_IDS.indexOf(profileId);
  if (index < 0) fail('S3SyntheticProfile.profileId is unsupported');
  const admitted = {
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.syntheticProfile,
    profileId,
    profileKind: value.profileKind,
    assignmentTarget: integer(value.assignmentTarget, 'S3SyntheticProfile.assignmentTarget', { min: 500, max: 500 }),
    pairedStratumLabel: id(value.pairedStratumLabel, 'S3SyntheticProfile.pairedStratumLabel'),
    behavioralEffect: value.behavioralEffect,
  };
  if (!same(admitted, S3_SYNTHETIC_PROFILES[index])) fail('S3SyntheticProfile must be a non-behavioral paired cohort stratum');
  return deepFreeze(admitted);
}

function admitGraphScope(raw) {
  const value = exactObject(raw, 'S3GraphScope', [
    'scopeKind', 'graphArtifact', 'graphContentIdentity',
  ]);
  if (value.scopeKind !== 'admitted-synthetic-graph') {
    fail('S3GraphScope v1 only admits a complete synthetic GraphArtifact/v1');
  }
  const graphArtifact = admitSyntheticGraph(value.graphArtifact, 'S3GraphScope.graphArtifact');
  const graphContentIdentity = admitGraphContentIdentity(
    value.graphContentIdentity,
    graphArtifact,
    'S3GraphScope.graphContentIdentity',
  );
  return deepFreeze({
    scopeKind: 'admitted-synthetic-graph',
    graphArtifact,
    graphContentIdentity,
  });
}

function graphIdentityOf(scope) {
  return graphIdentityOfArtifact(scope.graphArtifact);
}

function graphIdentityOfArtifact(graphArtifact) {
  return {
    scopeKind: 'admitted-synthetic-graph',
    graphId: graphArtifact.graphId,
    artifactVersion: graphArtifact.receipt.artifactVersion,
    graphContentIdentity: graphContentIdentityOfAdmitted(graphArtifact),
  };
}

function graphContentIdentityOfAdmitted(graphArtifact) {
  const canonicalGraphArtifact = JSON.stringify(graphArtifact);
  return {
    canonicalization: 'json-stringify-admitted-graph-artifact/v1',
    digestAlgorithm: 'sha256',
    canonicalUtf8Bytes: new TextEncoder().encode(canonicalGraphArtifact).length,
    digest: `sha256:${createHash('sha256').update(canonicalGraphArtifact, 'utf8').digest('hex')}`,
  };
}

function admitGraphContentIdentity(raw, graphArtifact, label) {
  const value = exactObject(raw, label, [
    'canonicalization', 'digestAlgorithm', 'canonicalUtf8Bytes', 'digest',
  ]);
  const admitted = {
    canonicalization: version(value.canonicalization, `${label}.canonicalization`),
    digestAlgorithm: id(value.digestAlgorithm, `${label}.digestAlgorithm`),
    canonicalUtf8Bytes: integer(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`),
    digest: version(value.digest, `${label}.digest`),
  };
  const expected = graphContentIdentityOfAdmitted(graphArtifact);
  if (!same(admitted, expected)) fail(`${label} must be recomputed from the complete admitted GraphArtifact`);
  return admitted;
}

export function buildS3GraphContentIdentity(rawGraphArtifact) {
  const graphArtifact = admitSyntheticGraph(rawGraphArtifact, 'S3 graph content identity input');
  return deepFreeze(graphContentIdentityOfAdmitted(graphArtifact));
}

function admitEdgeFactorEvidence(raw, graphArtifact, label) {
  const value = exactObject(raw, label, [
    'schemaVersion', 'evidenceId', 'fixtureVersion', 'graphId',
    'graphArtifactVersion', 'graphContentIdentity', 'factorIds', 'edgeEvidence',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence, `${label}.schemaVersion`);
  if (value.graphId !== graphArtifact.graphId
    || value.graphArtifactVersion !== graphArtifact.receipt.artifactVersion) {
    fail(`${label} graph revision drifted`);
  }
  exactSequence(value.factorIds, CAPABILITY_FACTORS, `${label}.factorIds`);
  const graphContentIdentity = admitGraphContentIdentity(
    value.graphContentIdentity,
    graphArtifact,
    `${label}.graphContentIdentity`,
  );
  const expectedEdges = new Map(graphArtifact.edges.map((edge) => [edge.edgeId, edge]));
  const edgeEvidence = strictArray(value.edgeEvidence, `${label}.edgeEvidence`, {
    min: graphArtifact.edges.length,
    max: graphArtifact.edges.length,
  }).map((rawEntry, index) => {
    const entryLabel = `${label}.edgeEvidence[${index}]`;
    const entry = exactObject(rawEntry, entryLabel, ['edgeId', 'observations']);
    const edgeId = id(entry.edgeId, `${entryLabel}.edgeId`);
    if (!expectedEdges.has(edgeId)) fail(`${entryLabel} references an unknown directed edge`);
    const observations = exactObject(entry.observations, `${entryLabel}.observations`, CAPABILITY_FACTORS);
    const admittedObservations = {};
    for (const factorId of CAPABILITY_FACTORS) {
      const observation = admitSourceObservation(snapshotData(observations[factorId], `${entryLabel}.observations.${factorId}`));
      if (observation.factorId !== factorId) fail(`${entryLabel} observation factor drifted`);
      admittedObservations[factorId] = observation;
    }
    return { edgeId, observations: admittedObservations };
  });
  if (new Set(edgeEvidence.map(({ edgeId }) => edgeId)).size !== expectedEdges.size) {
    fail(`${label} must bind every directed edge exactly once`);
  }
  const byEdge = new Map(edgeEvidence.map((entry) => [entry.edgeId, entry]));
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence,
    evidenceId: id(value.evidenceId, `${label}.evidenceId`),
    fixtureVersion: version(value.fixtureVersion, `${label}.fixtureVersion`),
    graphId: graphArtifact.graphId,
    graphArtifactVersion: graphArtifact.receipt.artifactVersion,
    graphContentIdentity,
    factorIds: [...CAPABILITY_FACTORS],
    edgeEvidence: graphArtifact.edges.map(({ edgeId }) => byEdge.get(edgeId)),
  });
}

function evidenceIdentityOf(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    evidenceId: evidence.evidenceId,
    fixtureVersion: evidence.fixtureVersion,
    graphId: evidence.graphId,
    graphArtifactVersion: evidence.graphArtifactVersion,
    graphContentIdentity: evidence.graphContentIdentity,
  };
}

function admitEvidenceIdentity(raw, label) {
  const value = exactObject(raw, label, [
    'schemaVersion', 'evidenceId', 'fixtureVersion', 'graphId', 'graphArtifactVersion',
    'graphContentIdentity',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.edgeFactorEvidence, `${label}.schemaVersion`);
  return {
    schemaVersion: value.schemaVersion,
    evidenceId: id(value.evidenceId, `${label}.evidenceId`),
    fixtureVersion: version(value.fixtureVersion, `${label}.fixtureVersion`),
    graphId: id(value.graphId, `${label}.graphId`),
    graphArtifactVersion: version(value.graphArtifactVersion, `${label}.graphArtifactVersion`),
    graphContentIdentity: admitGraphContentIdentityShape(
      value.graphContentIdentity,
      `${label}.graphContentIdentity`,
    ),
  };
}

function admitGraphContentIdentityShape(raw, label) {
  const value = exactObject(raw, label, [
    'canonicalization', 'digestAlgorithm', 'canonicalUtf8Bytes', 'digest',
  ]);
  if (value.canonicalization !== 'json-stringify-admitted-graph-artifact/v1') {
    fail(`${label}.canonicalization is unsupported`);
  }
  if (value.digestAlgorithm !== 'sha256' || !/^sha256:[0-9a-f]{64}$/.test(value.digest)) {
    fail(`${label} digest contract is unsupported`);
  }
  return {
    canonicalization: value.canonicalization,
    digestAlgorithm: value.digestAlgorithm,
    canonicalUtf8Bytes: integer(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`),
    digest: value.digest,
  };
}

function admitRecordGraphIdentity(raw, label) {
  const value = exactObject(raw, label, [
    'scopeKind', 'graphId', 'artifactVersion', 'graphContentIdentity',
  ]);
  if (value.scopeKind !== 'admitted-synthetic-graph') {
    fail(`${label}.scopeKind is unsupported`);
  }
  return {
    scopeKind: value.scopeKind,
    graphId: id(value.graphId, `${label}.graphId`),
    artifactVersion: version(value.artifactVersion, `${label}.artifactVersion`),
    graphContentIdentity: admitGraphContentIdentityShape(
      value.graphContentIdentity,
      `${label}.graphContentIdentity`,
    ),
  };
}

function syntheticPartitionId(seed, index, originNodeId, destinationNodeId) {
  let hash = seed >>> 0;
  const input = `${index}:${originNodeId}:${destinationNodeId}`;
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(cursor), 16_777_619) >>> 0;
  }
  return `synthetic-partition-${hash % 10}`;
}

export function buildS3ScenarioOdPairs(
  rawGraphArtifact,
  scenarioGeneratorVersion = S3_SCENARIO_GENERATOR_VERSION,
  seed = S3_SCENARIO_SEED,
) {
  exactVersion(
    scenarioGeneratorVersion,
    S3_SCENARIO_GENERATOR_VERSION,
    'S3 scenario generator version',
  );
  if (seed !== S3_SCENARIO_SEED) fail(`S3 scenario seed must be ${S3_SCENARIO_SEED}`);
  const graphArtifact = admitSyntheticGraph(rawGraphArtifact, 'S3 scenario generator graph');
  const seenEndpointPairs = new Set();
  const selectedEdges = [];
  for (const edge of graphArtifact.edges) {
    const endpointKey = `${edge.fromNodeId}\0${edge.toNodeId}`;
    if (seenEndpointPairs.has(endpointKey)) continue;
    seenEndpointPairs.add(endpointKey);
    selectedEdges.push(edge);
    if (selectedEdges.length === S3_SCENARIO_COUNTS.uniqueOdPairs) break;
  }
  if (selectedEdges.length !== S3_SCENARIO_COUNTS.uniqueOdPairs) {
    fail('S3 scenario generator requires 1000 unique directed edge endpoint pairs');
  }
  let shuffleState = seed >>> 0;
  for (let index = selectedEdges.length - 1; index > 0; index -= 1) {
    shuffleState = (Math.imul(shuffleState, 1_664_525) + 1_013_904_223) >>> 0;
    const swapIndex = shuffleState % (index + 1);
    [selectedEdges[index], selectedEdges[swapIndex]] = [selectedEdges[swapIndex], selectedEdges[index]];
  }
  const ranked = selectedEdges.map((edge, selectionIndex) => ({ edge, selectionIndex }));
  ranked.sort((left, right) => (
    left.edge.distanceMm - right.edge.distanceMm
      || (left.edge.edgeId < right.edge.edgeId ? -1 : left.edge.edgeId > right.edge.edgeId ? 1 : 0)
      || left.selectionIndex - right.selectionIndex
  ));
  const bucketBySelectionIndex = new Map(ranked.map(({ selectionIndex }, rank) => [
    selectionIndex,
    SYNTHETIC_DISTANCE_BUCKETS[Math.floor((rank * SYNTHETIC_DISTANCE_BUCKETS.length) / selectedEdges.length)],
  ]));
  return deepFreeze(selectedEdges.map((edge, index) => ({
    odPairId: `od-${String(index).padStart(4, '0')}`,
    originNodeId: edge.fromNodeId,
    destinationNodeId: edge.toNodeId,
    profileId: index < 500 ? S3_SYNTHETIC_PROFILE_IDS[0] : S3_SYNTHETIC_PROFILE_IDS[1],
    configurationIds: [...S3_CONFIGURATION_IDS],
    stratum: {
      weakComponentId: graphArtifact.components.byNodeId[edge.fromNodeId],
      syntheticPartitionId: syntheticPartitionId(seed, index, edge.fromNodeId, edge.toNodeId),
      syntheticDistanceBucket: bucketBySelectionIndex.get(index),
    },
  })));
}

function admitOdPair(raw, index, scope) {
  const label = `S3ScenarioCohort.odPairs[${index}]`;
  const value = exactObject(raw, label, ['odPairId', 'originNodeId', 'destinationNodeId', 'profileId', 'configurationIds', 'stratum']);
  const originNodeId = id(value.originNodeId, `${label}.originNodeId`);
  const destinationNodeId = id(value.destinationNodeId, `${label}.destinationNodeId`);
  if (originNodeId === destinationNodeId) fail(`${label} endpoints must be distinct`);
  if (!S3_SYNTHETIC_PROFILE_IDS.includes(value.profileId)) fail(`${label}.profileId is unsupported`);
  const stratum = exactObject(value.stratum, `${label}.stratum`, [
    'weakComponentId', 'syntheticPartitionId', 'syntheticDistanceBucket',
  ]);
  if (!SYNTHETIC_DISTANCE_BUCKETS.includes(stratum.syntheticDistanceBucket)) {
    fail(`${label}.stratum.syntheticDistanceBucket is unsupported`);
  }
  const nodeIds = new Set(scope.graphArtifact.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(originNodeId) || !nodeIds.has(destinationNodeId)) fail(`${label} endpoints must exist in the admitted graph`);
  const expectedComponentId = scope.graphArtifact.components.byNodeId[originNodeId];
  if (scope.graphArtifact.components.byNodeId[destinationNodeId] !== expectedComponentId) {
    fail(`${label} endpoints must be in the same admitted weak component`);
  }
  return {
    odPairId: id(value.odPairId, `${label}.odPairId`),
    originNodeId,
    destinationNodeId,
    profileId: value.profileId,
    configurationIds: exactSequence(value.configurationIds, S3_CONFIGURATION_IDS, `${label}.configurationIds`),
    stratum: {
      weakComponentId: integer(stratum.weakComponentId, `${label}.stratum.weakComponentId`, {
        max: scope.graphArtifact.components.count - 1,
      }),
      syntheticPartitionId: id(stratum.syntheticPartitionId, `${label}.stratum.syntheticPartitionId`),
      syntheticDistanceBucket: stratum.syntheticDistanceBucket,
    },
  };
}

function admitProbe(raw, index) {
  const label = `S3ScenarioCohort.conformanceProbes[${index}]`;
  const value = exactObject(raw, label, [
    'schemaVersion', 'probeId', 'probeKind', 'configurationId', 'profileId',
    'stimulus', 'expectedOutcome', 'includedInMainCohort',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.conformanceProbe, `${label}.schemaVersion`);
  if (value.probeKind !== S3_CONFORMANCE_PROBE_KINDS[index]) fail(`${label} kind sequence drifted`);
  if (!S3_CONFIGURATION_IDS.includes(value.configurationId)) fail(`${label}.configurationId is unsupported`);
  if (!S3_SYNTHETIC_PROFILE_IDS.includes(value.profileId)) fail(`${label}.profileId is unsupported`);
  if (value.includedInMainCohort !== false) fail(`${label}.includedInMainCohort must be false`);
  if (index < 2 && value.configurationId !== S3_CONFIGURATION_IDS[0]) {
    fail(`${label} topology/input probe must use the objective-only configuration`);
  }
  if (index >= 2 && value.configurationId !== S3_CONFIGURATION_IDS[4]) {
    fail(`${label} evidence probe must use the three-capability configuration`);
  }
  const stimulusValue = exactObject(value.stimulus, `${label}.stimulus`, [
    'stimulusKind', 'graphArtifact', 'graphContentIdentity', 'edgeFactorEvidence',
    'originNodeId', 'destinationNodeId', 'requestMutation',
  ]);
  if (stimulusValue.stimulusKind !== value.probeKind) fail(`${label}.stimulus kind drifted`);
  const graphArtifact = admitSyntheticGraph(stimulusValue.graphArtifact, `${label}.stimulus.graphArtifact`);
  const graphContentIdentity = admitGraphContentIdentity(
    stimulusValue.graphContentIdentity,
    graphArtifact,
    `${label}.stimulus.graphContentIdentity`,
  );
  const edgeFactorEvidence = admitEdgeFactorEvidence(
    stimulusValue.edgeFactorEvidence,
    graphArtifact,
    `${label}.stimulus.edgeFactorEvidence`,
  );
  const originNodeId = id(stimulusValue.originNodeId, `${label}.stimulus.originNodeId`);
  const destinationNodeId = id(stimulusValue.destinationNodeId, `${label}.stimulus.destinationNodeId`);
  const nodeIds = new Set(graphArtifact.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(originNodeId) || !nodeIds.has(destinationNodeId) || originNodeId === destinationNodeId) {
    fail(`${label}.stimulus endpoints must be distinct admitted fixture nodes`);
  }
  let requestMutation = null;
  if (value.probeKind === 'invalid-input') {
    const mutation = exactObject(stimulusValue.requestMutation, `${label}.stimulus.requestMutation`, [
      'mutationKind', 'field', 'invalidValue',
    ]);
    if (mutation.mutationKind !== 'replace-field'
      || mutation.field !== 'requestedCandidateCount'
      || mutation.invalidValue !== 0) {
      fail(`${label} invalid-input mutation must replace requestedCandidateCount with zero`);
    }
    requestMutation = { mutationKind: 'replace-field', field: 'requestedCandidateCount', invalidValue: 0 };
  } else if (stimulusValue.requestMutation !== null) {
    fail(`${label}.stimulus.requestMutation is only allowed for invalid-input`);
  }
  const directEdges = graphArtifact.edges.filter(({ fromNodeId, toNodeId }) => (
    fromNodeId === originNodeId && toNodeId === destinationNodeId
  ));
  if (graphArtifact.nodes.length !== 2) {
    fail(`${label} executable probe fixture must contain exactly its two endpoint nodes`);
  }
  if (value.probeKind === 'disconnected') {
    const components = graphArtifact.components.byNodeId;
    if (graphArtifact.edges.length !== 0
      || components[originNodeId] === components[destinationNodeId]) {
      fail(`${label} disconnected stimulus must freeze two components with no directed edge`);
    }
  } else {
    if (graphArtifact.edges.length !== 1 || directEdges.length !== 1) {
      fail(`${label} executable probe must freeze one direct OD-relevant edge and no unrelated topology`);
    }
    const directEvidence = edgeFactorEvidence.edgeEvidence
      .find(({ edgeId }) => edgeId === directEdges[0].edgeId).observations;
    const routeObservations = CAPABILITY_FACTORS.map((factorId) => directEvidence[factorId]);
    if (value.probeKind === 'source-unavailable'
      && (!routeObservations.some(({ state }) => state === 'unavailable')
        || routeObservations.some(({ state, value: observationValue }) => (
          state === 'observed' && observationValue === false
        )))) {
      fail(`${label} source-unavailable stimulus requires unavailable evidence on its only OD route without a known false`);
    }
    if (value.probeKind === 'constraint-no-solution'
      && !routeObservations.some(({ state, value: observationValue }) => (
        state === 'observed' && observationValue === false
      ))) {
      fail(`${label} constraint-no-solution stimulus requires observed false evidence on its only OD route`);
    }
  }
  const expectedOutcome = admitCanonicalOutcome(
    value.expectedOutcome,
    `${label}.expectedOutcome`,
    {
      graphArtifact,
      edgeFactorEvidence,
      policy: S3_DECISION_POLICIES[S3_CONFIGURATION_IDS.indexOf(value.configurationId)],
      searchRequest: S3_CONFIGURATION_GROUPS[
        S3_CONFIGURATION_IDS.indexOf(value.configurationId)
      ].searchRequestTemplate,
      originNodeId,
      destinationNodeId,
      denominatorKind: 'conformance',
      probeKind: value.probeKind,
    },
  );
  if (expectedOutcome.termination !== PROBE_TERMINATIONS[index]) {
    fail(`${label}.expectedOutcome drifted from its executable stimulus contract`);
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.conformanceProbe,
    probeId: id(value.probeId, `${label}.probeId`),
    probeKind: value.probeKind,
    configurationId: value.configurationId,
    profileId: value.profileId,
    stimulus: {
      stimulusKind: value.probeKind,
      graphArtifact,
      graphContentIdentity,
      edgeFactorEvidence,
      originNodeId,
      destinationNodeId,
      requestMutation,
    },
    expectedOutcome,
    includedInMainCohort: false,
  });
}

export function admitS3ScenarioCohort(raw) {
  const value = exactObject(raw, 'S3ScenarioCohort', [
    'schemaVersion', 'cohortId', 'cohortKind', 'scenarioGeneratorVersion',
    'graphScope', 'edgeFactorEvidence', 'seed', 'counts',
    'configurationGroups', 'profiles', 'odPairs', 'conformanceProbes',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.cohort, 'S3ScenarioCohort.schemaVersion');
  if (value.cohortKind !== 'researcher-defined-synthetic-s3') fail('S3ScenarioCohort.cohortKind is unsupported');
  exactVersion(
    value.scenarioGeneratorVersion,
    S3_SCENARIO_GENERATOR_VERSION,
    'S3ScenarioCohort.scenarioGeneratorVersion',
  );
  if (value.seed !== S3_SCENARIO_SEED) fail(`S3ScenarioCohort.seed must be ${S3_SCENARIO_SEED}`);
  const countsValue = exactObject(value.counts, 'S3ScenarioCohort.counts', Object.keys(S3_SCENARIO_COUNTS));
  assertCounts(countsValue, 'S3ScenarioCohort.counts');
  const graphScope = admitGraphScope(value.graphScope);
  const edgeFactorEvidence = admitEdgeFactorEvidence(
    value.edgeFactorEvidence,
    graphScope.graphArtifact,
    'S3ScenarioCohort.edgeFactorEvidence',
  );
  const configurationGroups = strictArray(value.configurationGroups, 'S3ScenarioCohort.configurationGroups', { min: 5, max: 5 }).map(admitS3ConfigurationGroup);
  if (!same(configurationGroups, S3_CONFIGURATION_GROUPS)) fail('S3ScenarioCohort must preserve all five configurations');
  const profiles = strictArray(value.profiles, 'S3ScenarioCohort.profiles', { min: 2, max: 2 }).map(admitS3SyntheticProfile);
  if (!same(profiles, S3_SYNTHETIC_PROFILES)) fail('S3ScenarioCohort must preserve both paired strata');
  const odPairs = strictArray(value.odPairs, 'S3ScenarioCohort.odPairs', { min: 1_000, max: 1_000 }).map((pair, index) => admitOdPair(pair, index, graphScope));
  const generatedOdPairs = buildS3ScenarioOdPairs(
    graphScope.graphArtifact,
    value.scenarioGeneratorVersion,
    value.seed,
  );
  if (!same(odPairs, generatedOdPairs)) {
    fail('S3ScenarioCohort OD/profile/strata sequence drifted from the deterministic generator');
  }
  const probes = strictArray(value.conformanceProbes, 'S3ScenarioCohort.conformanceProbes', { min: 4, max: 4 }).map(admitProbe);
  if (new Set(probes.map(({ probeId }) => probeId)).size !== 4) fail('S3ScenarioCohort conformance probe IDs must be unique');
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.cohort,
    cohortId: id(value.cohortId, 'S3ScenarioCohort.cohortId'),
    cohortKind: 'researcher-defined-synthetic-s3',
    scenarioGeneratorVersion: S3_SCENARIO_GENERATOR_VERSION,
    graphScope,
    edgeFactorEvidence,
    seed: S3_SCENARIO_SEED,
    counts: { ...S3_SCENARIO_COUNTS },
    configurationGroups,
    profiles,
    odPairs,
    conformanceProbes: probes,
  });
}

export function admitS3ScenarioProtocol(raw) {
  const value = exactObject(raw, 'S3ScenarioProtocol', [
    'schemaVersion', 'protocolId', 'definitionScope', 'historicalWrtRecovery',
    'evaluationUnit', 'cohort', 'eligibleClaimCodes',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.protocol, 'S3ScenarioProtocol.schemaVersion');
  if (value.definitionScope !== 'preregistered-synthetic-engineering'
    || value.historicalWrtRecovery !== 'not-claimed') fail('S3ScenarioProtocol scope/history is unsupported');
  if (value.evaluationUnit !== 'scenario-config-evaluation') fail('S3ScenarioProtocol evaluationUnit must not describe users, trips, or routes');
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.protocol,
    protocolId: id(value.protocolId, 'S3ScenarioProtocol.protocolId'),
    definitionScope: 'preregistered-synthetic-engineering',
    historicalWrtRecovery: 'not-claimed',
    evaluationUnit: 'scenario-config-evaluation',
    cohort: admitS3ScenarioCohort(value.cohort),
    eligibleClaimCodes: claimCodes(value.eligibleClaimCodes, 'S3ScenarioProtocol.eligibleClaimCodes'),
  });
}

function admitExecutionIdentity(raw) {
  const value = exactObject(raw, 'S3RunManifest.executionIdentity', [
    'productAdapterVersion', 'solverAlgorithmVersion', 'oracleAlgorithmVersion',
    'fixtureVersion', 'canonicalSerializationVersion',
  ]);
  const admitted = Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    version(item, `S3RunManifest.executionIdentity.${key}`),
  ]));
  if (admitted.oracleAlgorithmVersion !== S3_ORACLE_ALGORITHM_VERSION) {
    fail('S3RunManifest.executionIdentity.oracleAlgorithmVersion drifted from the frozen oracle spec');
  }
  return admitted;
}

function admitReferenceEnvironment(raw) {
  const value = exactObject(raw, 'S3RunManifest.referenceEnvironment', ['runtime', 'os', 'architecture', 'cpuClass', 'memoryBytes']);
  return {
    runtime: text(value.runtime, 'S3RunManifest.referenceEnvironment.runtime', { max: 120 }),
    os: text(value.os, 'S3RunManifest.referenceEnvironment.os', { max: 120 }),
    architecture: id(value.architecture, 'S3RunManifest.referenceEnvironment.architecture'),
    cpuClass: text(value.cpuClass, 'S3RunManifest.referenceEnvironment.cpuClass', { max: 120 }),
    memoryBytes: integer(value.memoryBytes, 'S3RunManifest.referenceEnvironment.memoryBytes', { min: 1 }),
  };
}

function admitPerformanceProtocol(raw) {
  return deepFreeze(admitExactLiteral(
    raw,
    S3_PERFORMANCE_PROTOCOL,
    'S3RunManifest.performanceProtocol',
  ));
}

function admitConfigurationExecution(raw, index, protocol) {
  const label = `S3RunManifest.configurationExecutions[${index}]`;
  const value = exactObject(raw, label, ['configurationId', 'policyArtifactVersion', 'decisionPolicy', 'searchRequestTemplate', 'capacityPolicy']);
  const group = protocol.cohort.configurationGroups[index];
  const admitted = {
    configurationId: value.configurationId,
    policyArtifactVersion: id(value.policyArtifactVersion, `${label}.policyArtifactVersion`),
    decisionPolicy: admitPolicy(value.decisionPolicy, `${label}.decisionPolicy`),
    searchRequestTemplate: admitSearchRequest(value.searchRequestTemplate, `${label}.searchRequestTemplate`),
    capacityPolicy: admitCapacityPolicy(value.capacityPolicy, `${label}.capacityPolicy`),
  };
  assertPolicySearchEquality(admitted.decisionPolicy, admitted.searchRequestTemplate, label);
  const expected = {
    configurationId: group.configurationId,
    policyArtifactVersion: group.policyArtifactVersion,
    decisionPolicy: group.decisionPolicy,
    searchRequestTemplate: group.searchRequestTemplate,
    capacityPolicy: group.capacityPolicy,
  };
  if (!same(admitted, expected)) fail(`${label} policy/search/capacity content drifted from protocol`);
  return admitted;
}

export function admitS3RunManifest(raw) {
  const value = exactObject(raw, 'S3RunManifest', [
    'schemaVersion', 'runId', 'protocol', 'protocolId', 'graphScope', 'seed',
    'configurationExecutions', 'executionIdentity', 'referenceEnvironment',
    'oracleExecutionSpec', 'performanceProtocol', 'expectedCounts',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.runManifest, 'S3RunManifest.schemaVersion');
  const protocol = admitS3ScenarioProtocol(value.protocol);
  if (value.protocolId !== protocol.protocolId) fail('S3RunManifest.protocolId drifted');
  const graphScope = admitGraphScope(value.graphScope);
  if (!same(graphScope, protocol.cohort.graphScope)) fail('S3RunManifest.graphScope drifted');
  if (value.seed !== protocol.cohort.seed) fail('S3RunManifest.seed drifted');
  const expectedCounts = exactObject(value.expectedCounts, 'S3RunManifest.expectedCounts', [
    'uniqueOdPairs', 'configurationGroups', 'scenarioConfigEvaluations', 'conformanceProbeEvaluations',
  ]);
  assertCounts(expectedCounts, 'S3RunManifest.expectedCounts');
  if (expectedCounts.conformanceProbeEvaluations !== protocol.cohort.conformanceProbes.length) fail('S3RunManifest conformance count drifted');
  const configurationExecutions = strictArray(value.configurationExecutions, 'S3RunManifest.configurationExecutions', { min: 5, max: 5 })
    .map((entry, index) => admitConfigurationExecution(entry, index, protocol));
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.runManifest,
    runId: id(value.runId, 'S3RunManifest.runId'),
    protocol,
    protocolId: protocol.protocolId,
    graphScope,
    seed: protocol.cohort.seed,
    configurationExecutions,
    executionIdentity: admitExecutionIdentity(value.executionIdentity),
    referenceEnvironment: admitReferenceEnvironment(value.referenceEnvironment),
    oracleExecutionSpec: deepFreeze(admitExactLiteral(
      value.oracleExecutionSpec,
      S3_ORACLE_EXECUTION_SPEC,
      'S3RunManifest.oracleExecutionSpec',
    )),
    performanceProtocol: admitPerformanceProtocol(value.performanceProtocol),
    expectedCounts: { ...S3_SCENARIO_COUNTS, conformanceProbeEvaluations: protocol.cohort.conformanceProbes.length },
  });
}

function scenarioFor(run, denominatorKind, scenarioId, configurationId) {
  if (denominatorKind === 'main') {
    const pair = run.protocol.cohort.odPairs.find(({ odPairId }) => odPairId === scenarioId);
    if (!pair || !pair.configurationIds.includes(configurationId)) fail('S3 record references an unknown main scenario/configuration');
    return {
      originNodeId: pair.originNodeId,
      destinationNodeId: pair.destinationNodeId,
      profileId: pair.profileId,
      odPairId: pair.odPairId,
      graphArtifact: run.protocol.cohort.graphScope.graphArtifact,
      edgeFactorEvidence: run.protocol.cohort.edgeFactorEvidence,
    };
  }
  if (denominatorKind === 'conformance') {
    const probe = run.protocol.cohort.conformanceProbes.find(({ probeId }) => probeId === scenarioId);
    if (!probe || probe.configurationId !== configurationId) fail('S3 record references an unknown conformance scenario/configuration');
    return {
      originNodeId: probe.stimulus.originNodeId,
      destinationNodeId: probe.stimulus.destinationNodeId,
      profileId: probe.profileId,
      odPairId: null,
      graphArtifact: probe.stimulus.graphArtifact,
      edgeFactorEvidence: probe.stimulus.edgeFactorEvidence,
      probe,
    };
  }
  fail('S3 record denominatorKind is unsupported');
}

function recordKey(runId, denominatorKind, scenarioId, configurationId, profileId) {
  return `${runId}:${denominatorKind}:${scenarioId}:${configurationId}:${profileId}`;
}

function projectSearchRequest(run, scenario, configurationId, scenarioId) {
  const execution = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  if (!execution) fail('S3 record configuration execution is missing');
  const template = execution.searchRequestTemplate;
  return admitSearchRequest({
    ...template,
    requestId: `${run.runId}-${scenarioId}-${configurationId}`.slice(0, MAX_ID_LENGTH),
    graphId: scenario.graphArtifact.graphId,
    originNodeId: scenario.originNodeId,
    destinationNodeId: scenario.destinationNodeId,
  }, 'S3 projected CandidateSearchRequest');
}

function assertResultEvidenceBinding(result, request, scenario) {
  if (!result) return;
  const graphEdgeById = new Map(scenario.graphArtifact.edges.map((edge) => [edge.edgeId, edge]));
  const evidenceByEdge = new Map(
    scenario.edgeFactorEvidence.edgeEvidence.map((entry) => [entry.edgeId, entry.observations]),
  );
  for (const candidate of result.candidateFacts) {
    let cursor = request.originNodeId;
    let distanceMm = 0;
    let objectiveCostUnits = 0;
    const routeEvidence = Object.fromEntries(CAPABILITY_FACTORS.map((factorId) => [factorId, []]));
    for (const edgeId of candidate.edgeIds) {
      const edge = graphEdgeById.get(edgeId);
      const observations = evidenceByEdge.get(edgeId);
      if (!edge || !observations) fail('S3ProductExecution candidate references an edge outside its frozen graph/evidence fixture');
      if (edge.fromNodeId !== cursor) fail('S3ProductExecution candidate edge sequence is not contiguous from its frozen origin');
      cursor = edge.toNodeId;
      distanceMm += edge.distanceMm;
      objectiveCostUnits += edge.objectiveCostUnits;
      for (const factorId of CAPABILITY_FACTORS) routeEvidence[factorId].push(observations[factorId]);
      for (const { factorId } of request.hardConstraints) {
        const edgeObservation = observations[factorId];
        if (edgeObservation.state !== 'observed' || edgeObservation.value !== true) {
          fail(`S3ProductExecution returned candidate contradicts edge evidence for ${factorId}`);
        }
      }
    }
    if (cursor !== request.destinationNodeId
      || candidate.distanceMm !== distanceMm
      || candidate.objectiveCostUnits !== objectiveCostUnits) {
      fail('S3ProductExecution candidate path metrics/endpoints drifted from its frozen graph');
    }
    for (const factorId of CAPABILITY_FACTORS) {
      const candidateObservation = candidate.observations[factorId];
      if (!candidateObservation) continue;
      const edgeObservations = routeEvidence[factorId];
      const expected = edgeObservations.find(({ state, value: observationValue }) => (
        state === 'observed' && observationValue === false
      )) ?? edgeObservations.find(({ state }) => state !== 'observed') ?? edgeObservations[0];
      if (!expected || candidateObservation.state !== expected.state
        || candidateObservation.value !== expected.value
        || candidateObservation.unit !== expected.unit
        || candidateObservation.reasonCode !== expected.reasonCode) {
        fail(`S3ProductExecution candidate observation drifted from edge evidence for ${factorId}`);
      }
    }
  }
}

function deriveObservationSummary(result) {
  const summary = {
    denominatorUnit: 'candidate-factor-observation',
    denominator: result ? result.candidateFacts.length * CAPABILITY_FACTORS.length : 0,
    ...zeroMap(OBSERVATION_KEYS),
  };
  if (!result) return summary;
  for (const candidate of result.candidateFacts) {
    for (const factorId of CAPABILITY_FACTORS) {
      const observation = candidate.observations[factorId];
      if (!observation) {
        summary.missing += 1;
      } else if (observation.state === 'observed') {
        if (typeof observation.value === 'boolean') {
          summary[observation.value ? 'observedBooleanTrue' : 'observedBooleanFalse'] += 1;
        } else {
          summary.observedNumericNonzero += 1;
        }
      } else if (observation.state === 'zero') {
        summary.numericZero += 1;
      } else {
        summary[observation.state] += 1;
      }
    }
  }
  return summary;
}

function admitMeasurement(raw, label, attemptState, result) {
  const value = exactObject(raw, label, [
    'measurementStatus', 'cacheState', 'latencyMicros', 'memoryBytes', 'unmeasuredReason',
  ]);
  if (value.measurementStatus === 'not-measured') {
    if (value.cacheState !== 'not-applicable' || value.latencyMicros !== null
      || value.memoryBytes !== null) fail(`${label} not-measured must not carry samples`);
    const unmeasuredReason = id(value.unmeasuredReason, `${label}.unmeasuredReason`);
    if (!S3_PERFORMANCE_PROTOCOL.notMeasuredReasons.includes(unmeasuredReason)) {
      fail(`${label}.unmeasuredReason is outside the frozen performance protocol`);
    }
    const reasonAllowed = unmeasuredReason === 'measurement-not-enabled'
      || (unmeasuredReason === 'measurement-failure' && attemptState !== 'not-started')
      || (unmeasuredReason === 'execution-not-started'
        && (attemptState === 'not-started' || result?.status === 'not-started'))
      || (unmeasuredReason === 'execution-nonterminal' && attemptState === 'started-no-terminal');
    if (!reasonAllowed) fail(`${label}.unmeasuredReason contradicts the execution state`);
    return {
      measurementStatus: 'not-measured',
      cacheState: 'not-applicable',
      latencyMicros: null,
      memoryBytes: null,
      unmeasuredReason,
    };
  }
  if (value.measurementStatus !== 'measured'
    || !new Set(['warm', 'cold']).has(value.cacheState)
    || value.unmeasuredReason !== null) fail(`${label} measurement shape is unsupported`);
  if (attemptState !== 'terminal') fail(`${label} measured samples require a terminal execution record`);
  return {
    measurementStatus: 'measured',
    cacheState: value.cacheState,
    latencyMicros: integer(value.latencyMicros, `${label}.latencyMicros`),
    memoryBytes: integer(value.memoryBytes, `${label}.memoryBytes`),
    unmeasuredReason: null,
  };
}

function admitProductExecutionWithRun(raw, run) {
  const value = exactObject(raw, 'S3ProductExecution', [
    'schemaVersion', 'recordKey', 'denominatorKind', 'scenarioId', 'runId', 'protocolId',
    'graphIdentity', 'evidenceIdentity', 'odPairId', 'configurationId', 'profileId', 'decisionPolicy',
    'searchRequest', 'executionRole', 'executionAttemptId', 'attemptState', 'searchResult',
    'decisionEvaluation', 'measurement',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.productExecution, 'S3ProductExecution.schemaVersion');
  const configurationId = id(value.configurationId, 'S3ProductExecution.configurationId');
  const scenario = scenarioFor(run, value.denominatorKind, value.scenarioId, configurationId);
  const expectedKey = recordKey(run.runId, value.denominatorKind, value.scenarioId, configurationId, scenario.profileId);
  if (value.recordKey !== expectedKey || value.runId !== run.runId || value.protocolId !== run.protocolId
    || value.profileId !== scenario.profileId || value.odPairId !== scenario.odPairId) fail('S3ProductExecution composite identity drifted');
  const graphIdentity = admitRecordGraphIdentity(value.graphIdentity, 'S3ProductExecution.graphIdentity');
  if (!same(graphIdentity, graphIdentityOfArtifact(scenario.graphArtifact))) fail('S3ProductExecution graph identity drifted');
  const evidenceIdentity = admitEvidenceIdentity(value.evidenceIdentity, 'S3ProductExecution.evidenceIdentity');
  if (!same(evidenceIdentity, evidenceIdentityOf(scenario.edgeFactorEvidence))) {
    fail('S3ProductExecution edge-factor evidence identity drifted');
  }
  const execution = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  const policy = admitPolicy(value.decisionPolicy, 'S3ProductExecution.decisionPolicy');
  if (!same(policy, execution.decisionPolicy)) fail('S3ProductExecution DecisionPolicy drifted');
  const request = admitSearchRequest(value.searchRequest, 'S3ProductExecution.searchRequest');
  const projected = projectSearchRequest(run, scenario, configurationId, value.scenarioId);
  if (!same(request, projected)) fail('S3ProductExecution search request drifted from its OD/config template projection');
  assertPolicySearchEquality(policy, request, 'S3ProductExecution');
  const executionRole = enumValue(value.executionRole, EXECUTION_ROLES, 'S3ProductExecution.executionRole');
  const executionAttemptId = id(value.executionAttemptId, 'S3ProductExecution.executionAttemptId');
  const attemptState = enumValue(value.attemptState, ATTEMPT_STATES, 'S3ProductExecution.attemptState');
  const result = value.searchResult === null ? null : admitSearchResult(value.searchResult, 'S3ProductExecution.searchResult');
  const evaluation = value.decisionEvaluation === null
    ? null
    : admitDecisionEvaluation(value.decisionEvaluation, 'S3ProductExecution.decisionEvaluation');
  if (attemptState === 'terminal') {
    if (!result) fail('S3ProductExecution terminal record requires a search result');
    if (result.termination === 'endpoint-unavailable') {
      fail('S3ProductExecution endpoint-unavailable is not applicable in S3 v1 admitted graph scenarios');
    }
    if (result.request && !same(result.request, request)) fail('S3ProductExecution result request drifted');
    if (!result.request && !(value.denominatorKind === 'conformance' && scenario.probe.probeKind === 'invalid-input')) {
      fail('S3ProductExecution null result request is only valid for invalid-input probe');
    }
    if (!evaluation || !same(evaluation.policy, policy) || !same(evaluation.candidateArtifact, result)) {
      fail('S3ProductExecution terminal record requires its exact admitted provided-set decision evaluation');
    }
    assertResultEvidenceBinding(result, request, scenario);
    if (value.denominatorKind === 'conformance'
      && !same(canonicalOutcome({ attemptState, searchResult: result, decisionEvaluation: evaluation }), scenario.probe.expectedOutcome)) {
      fail('S3ProductExecution conformance result drifted from the frozen executable stimulus outcome');
    }
  } else if (result !== null || evaluation !== null) {
    fail('S3ProductExecution non-terminal record must not contain executable results');
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.productExecution,
    recordKey: expectedKey,
    denominatorKind: value.denominatorKind,
    scenarioId: value.scenarioId,
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity,
    evidenceIdentity,
    odPairId: scenario.odPairId,
    configurationId,
    profileId: scenario.profileId,
    decisionPolicy: policy,
    searchRequest: request,
    executionRole,
    executionAttemptId,
    attemptState,
    searchResult: result,
    decisionEvaluation: evaluation,
    observationSummary: deriveObservationSummary(result),
    measurement: admitMeasurement(
      value.measurement,
      'S3ProductExecution.measurement',
      attemptState,
      result,
    ),
  });
}

export function admitS3ProductExecution(raw, runManifest) {
  return admitProductExecutionWithRun(raw, admitS3RunManifest(runManifest));
}

function admitCanonicalCandidate(raw, index, label) {
  const value = exactObject(raw, `${label}[${index}]`, ['candidateId', 'edgeIds']);
  const candidateId = id(value.candidateId, `${label}[${index}].candidateId`);
  const expectedCandidateId = `candidate:${index + 1}`;
  if (candidateId !== expectedCandidateId) {
    fail(`${label}[${index}].candidateId must be ${expectedCandidateId} under the frozen oracle candidate-id rule`);
  }
  return {
    candidateId,
    edgeIds: uniqueIds(value.edgeIds, `${label}[${index}].edgeIds`, 100_000),
  };
}

function emptyPublicExplanation() {
  return {
    hardConstraintTrace: [],
    softPreferenceTrace: [],
    candidateDispositions: [],
    rankingTrace: [],
  };
}

function expectedConstraintOutcome(
  termination,
  candidateCount,
  hasConstraints,
  unresolvedEvidenceEncountered,
) {
  if (!hasConstraints) return 'not-required';
  if (termination === 'no-directed-route-in-bounded-scope') return 'not-evaluated';
  if (termination === 'no-eligible-route-in-bounded-scope') {
    return 'no-eligible-route-in-bounded-scope-proven';
  }
  if (termination === 'requested-candidate-count-reached') {
    return 'eligible-candidates-returned';
  }
  if (unresolvedEvidenceEncountered) return 'unresolved-evidence';
  if (candidateCount > 0) return 'eligible-candidates-returned';
  return 'no-eligible-route-not-proven';
}

function admitCanonicalSearchMetadata(raw, termination, candidateCount, context, label) {
  if (!context?.searchRequest) fail(`${label} requires the frozen oracle search request`);
  const value = exactObject(raw, label, [
    'status', 'requestedCandidateCount', 'candidateCount', 'expandedStateCount',
    'routeSearchCompleteness', 'constraintOutcome', 'budgetOutcome', 'capacityOutcome',
    'unresolvedEvidenceEncountered',
  ]);
  const request = context.searchRequest;
  const requestedCandidateCount = request.requestedCandidateCount;
  const hasConstraints = request.hardConstraints.length > 0;
  let expected;
  if (termination === 'invalid-input') {
    if (candidateCount !== 0) fail(`${label} invalid-input must have zero candidates`);
    if (context.denominatorKind !== 'conformance' || context.probeKind !== 'invalid-input') {
      fail(`${label} invalid-input is only applicable to the invalid-input conformance probe`);
    }
    expected = {
      status: 'rejected', requestedCandidateCount: null, candidateCount: 0,
      expandedStateCount: null, routeSearchCompleteness: null, constraintOutcome: null,
      budgetOutcome: null, capacityOutcome: null, unresolvedEvidenceEncountered: null,
    };
  } else if (termination === 'endpoint-unavailable') {
    fail(`${label} endpoint-unavailable is not applicable in S3 v1 admitted graph scenarios`);
  } else {
    const unresolvedEvidenceEncountered = termination === 'requested-candidate-count-reached'
      ? admitExactLiteral(
        value.unresolvedEvidenceEncountered,
        null,
        `${label}.unresolvedEvidenceEncountered`,
      )
      : booleanValue(
        value.unresolvedEvidenceEncountered,
        `${label}.unresolvedEvidenceEncountered`,
      );
    const expandedStateCount = integer(
      value.expandedStateCount,
      `${label}.expandedStateCount`,
      { max: request.bounds.maxExpandedStates },
    );
    const constraintOutcome = expectedConstraintOutcome(
      termination,
      candidateCount,
      hasConstraints,
      unresolvedEvidenceEncountered,
    );
    if (!hasConstraints && unresolvedEvidenceEncountered) {
      fail(`${label} unresolved evidence cannot be reported without hard constraints`);
    }
    if (unresolvedEvidenceEncountered && ![
      'unresolved-constraint-evidence',
      'search-budget-exhausted',
      'search-capacity-exhausted',
    ].includes(termination)) {
      fail(`${label} unresolved evidence is inconsistent with the terminal`);
    }
    if (termination === 'requested-candidate-count-reached') {
      if (candidateCount !== requestedCandidateCount) {
        fail(`${label} requested-count terminal requires exactly requestedCandidateCount candidates`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'not-proven', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'bounded-search-space-exhausted') {
      if (candidateCount === 0 || candidateCount >= requestedCandidateCount) {
        fail(`${label} bounded-search-space terminal requires between one and K-1 candidates`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'no-directed-route-in-bounded-scope') {
      if (candidateCount !== 0) fail(`${label} no-directed-route terminal requires zero candidates`);
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount: 0, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'no-eligible-route-in-bounded-scope') {
      if (candidateCount !== 0 || !hasConstraints) {
        fail(`${label} no-eligible-route terminal requires zero candidates and hard constraints`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount: 0, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'unresolved-constraint-evidence') {
      if (candidateCount >= requestedCandidateCount || !hasConstraints) {
        fail(`${label} unresolved-constraint terminal requires fewer than K candidates and hard constraints`);
      }
      if (!unresolvedEvidenceEncountered) {
        fail(`${label} unresolved-constraint terminal requires encountered unresolved evidence`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'search-budget-exhausted') {
      if (candidateCount >= requestedCandidateCount
        || expandedStateCount !== request.bounds.maxExpandedStates) {
        fail(`${label} budget terminal requires fewer than K candidates and the exact expansion bound`);
      }
      expected = {
        status: 'stopped', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'not-proven', constraintOutcome,
        budgetOutcome: 'exhausted', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'search-capacity-exhausted') {
      if (candidateCount >= requestedCandidateCount) {
        fail(`${label} capacity terminal requires fewer than K candidates`);
      }
      expected = {
        status: 'stopped', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'not-proven', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'exhausted',
        unresolvedEvidenceEncountered,
      };
    } else {
      fail(`${label} termination is outside the frozen S2 termination set`);
    }
  }
  return admitExactLiteral(value, expected, label);
}

function canonicalSearchMetadata(result) {
  const candidateSet = result.candidateSet;
  return {
    status: result.status,
    requestedCandidateCount: result.request?.requestedCandidateCount ?? null,
    candidateCount: result.candidateFacts.length,
    expandedStateCount: candidateSet?.expandedStateCount ?? null,
    routeSearchCompleteness: candidateSet?.completeness.routeSearch ?? null,
    constraintOutcome: candidateSet?.constraintOutcome ?? null,
    budgetOutcome: candidateSet?.budgetOutcome ?? null,
    capacityOutcome: candidateSet?.capacityOutcome ?? null,
    unresolvedEvidenceEncountered: candidateSet === null
      || result.termination === 'requested-candidate-count-reached'
      ? null
      : candidateSet.constraintOutcome === 'unresolved-evidence',
  };
}

function expectedZeroCandidateDecision(termination, label) {
  const reasonCode = S3_ZERO_CANDIDATE_REASON_BY_TERMINATION[termination];
  if (!reasonCode) fail(`${label} zero-candidate termination has no frozen evaluator mapping`);
  return {
    evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
    evaluationStatus: 'not-evaluated',
    reasonCode,
    decisionSchemaVersion: null,
    scope: null,
    decisionStatus: null,
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    rejectedCandidateIds: [],
    unresolvedCandidateIds: [],
    publicExplanation: emptyPublicExplanation(),
  };
}

function canonicalCandidateMetrics(candidate, context, label) {
  const edgeById = new Map(context.graphArtifact.edges.map((edge) => [edge.edgeId, edge]));
  const evidenceByEdge = new Map(
    context.edgeFactorEvidence.edgeEvidence.map((entry) => [entry.edgeId, entry.observations]),
  );
  let cursor = context.originNodeId;
  let distanceMm = 0;
  let objectiveCostUnits = 0;
  const visitedNodes = new Set([cursor]);
  for (const edgeId of candidate.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge || edge.fromNodeId !== cursor) {
      fail(`${label} edge path is not contiguous in the frozen oracle graph`);
    }
    cursor = edge.toNodeId;
    if (visitedNodes.has(cursor)) fail(`${label} edge path must be loopless`);
    visitedNodes.add(cursor);
    distanceMm += edge.distanceMm;
    objectiveCostUnits += edge.objectiveCostUnits;
    if (!Number.isSafeInteger(distanceMm) || !Number.isSafeInteger(objectiveCostUnits)) {
      fail(`${label} path metrics exceed safe integer bounds`);
    }
    const observations = evidenceByEdge.get(edgeId);
    if (!observations) fail(`${label} edge path is outside the frozen evidence artifact`);
    for (const constraint of context.policy.hardConstraints) {
      const observation = observations[constraint.factorId];
      if (!observation || observation.state !== 'observed'
        || observation.value !== constraint.expectedValue) {
        fail(`${label} returned oracle candidate violates its frozen hard-constraint evidence`);
      }
    }
  }
  if (cursor !== context.destinationNodeId) {
    fail(`${label} edge path does not terminate at the frozen oracle destination`);
  }
  return { distanceMm, objectiveCostUnits };
}

function preferenceRawValue(metrics, factorId, label) {
  if (factorId === 'distance-mm') return metrics.distanceMm;
  if (factorId === 'objective-cost-units') return metrics.objectiveCostUnits;
  fail(`${label} uses an unsupported frozen scoring factor`);
}

function scoreCanonicalCandidate(candidate, metrics, policy, label) {
  const contributions = [...policy.softPreferences]
    .sort((left, right) => left.preferenceId < right.preferenceId ? -1 : left.preferenceId > right.preferenceId ? 1 : 0)
    .map((preference) => {
      const rawValue = preferenceRawValue(metrics, preference.factorId, label);
      const clampedValue = Math.min(preference.rangeMax, Math.max(preference.rangeMin, rawValue));
      const rangeSpan = preference.rangeMax - preference.rangeMin;
      const utilityNumerator = (preference.rangeMax - clampedValue) * 10_000;
      const utilityBasisPoints = Math.floor(utilityNumerator / rangeSpan);
      const weightedScoreUnits = utilityBasisPoints * preference.weightBasisPoints;
      if (![rangeSpan, utilityNumerator, utilityBasisPoints, weightedScoreUnits]
        .every(Number.isSafeInteger)) {
        fail(`${label} scoring arithmetic is not a safe integer`);
      }
      return {
        candidateId: candidate.candidateId,
        stage: 'soft-preference',
        preferenceId: preference.preferenceId,
        factorId: preference.factorId,
        observationState: rawValue === 0 ? 'zero' : 'observed',
        rawValue,
        unit: preference.factorId === 'distance-mm' ? 'millimetres' : 'cost-units',
        direction: 'minimize',
        rangeMin: preference.rangeMin,
        rangeMax: preference.rangeMax,
        rangeSpan,
        utilityNumerator,
        utilityBasisPoints,
        weightBasisPoints: preference.weightBasisPoints,
        weightedScoreUnits,
        outcome: 'scored',
        reasonCode: 'soft-preference-scored',
      };
    });
  const totalScoreUnits = contributions.reduce(
    (sum, contribution) => sum + contribution.weightedScoreUnits,
    0,
  );
  if (!Number.isSafeInteger(totalScoreUnits)) fail(`${label} total score is not a safe integer`);
  return { candidate, metrics, contributions, totalScoreUnits };
}

function tieBreakValue(scored, factorId) {
  if (factorId === 'score-units') return scored.totalScoreUnits;
  if (factorId === 'objective-cost-units') return scored.metrics.objectiveCostUnits;
  if (factorId === 'distance-mm') return scored.metrics.distanceMm;
  if (factorId === 'candidate-id') return scored.candidate.candidateId;
  fail('frozen evaluator tie-break contains an unsupported factor');
}

function compareScoredCandidates(left, right, policy) {
  for (const entry of policy.tieBreak) {
    const leftValue = tieBreakValue(left, entry.factorId);
    const rightValue = tieBreakValue(right, entry.factorId);
    const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    if (comparison !== 0) return entry.direction === 'ascending' ? comparison : -comparison;
  }
  return 0;
}

function compareEdgeIdSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

function assertOracleCandidateGenerationOrder(scored, label) {
  const routeKeys = new Set();
  for (let index = 0; index < scored.length; index += 1) {
    const current = scored[index];
    const routeKey = JSON.stringify(current.candidate.edgeIds);
    if (routeKeys.has(routeKey)) {
      fail(`${label}.orderedCandidates must contain distinct directed-edge sequences`);
    }
    routeKeys.add(routeKey);
    if (index === 0) continue;
    const previous = scored[index - 1];
    const objectiveComparison = previous.metrics.objectiveCostUnits
      - current.metrics.objectiveCostUnits;
    if (objectiveComparison > 0 || (objectiveComparison === 0
      && compareEdgeIdSequences(previous.candidate.edgeIds, current.candidate.edgeIds) >= 0)) {
      fail(`${label}.orderedCandidates must preserve objective-cost then directed-edge-sequence generation order`);
    }
  }
}

function expectedCandidatefulDecision(orderedCandidates, context, label) {
  if (!context) fail(`${label} candidateful outcome requires frozen graph/evidence/policy context`);
  const candidatesById = [...orderedCandidates]
    .sort((left, right) => left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0);
  const hardConstraints = [...context.policy.hardConstraints]
    .sort((left, right) => left.constraintId < right.constraintId ? -1 : left.constraintId > right.constraintId ? 1 : 0);
  const hardConstraintTrace = [];
  const scored = candidatesById.map((candidate, index) => {
    const candidateLabel = `${label}.orderedCandidates[${index}]`;
    const metrics = canonicalCandidateMetrics(candidate, context, candidateLabel);
    for (const constraint of hardConstraints) {
      hardConstraintTrace.push({
        candidateId: candidate.candidateId,
        stage: 'hard-constraint',
        constraintId: constraint.constraintId,
        factorId: constraint.factorId,
        observationState: 'observed',
        actualValue: constraint.expectedValue,
        operator: 'equals',
        expectedValue: constraint.expectedValue,
        outcome: 'pass',
        reasonCode: 'hard-constraint-passed',
      });
    }
    return scoreCanonicalCandidate(candidate, metrics, context.policy, candidateLabel);
  });
  assertOracleCandidateGenerationOrder(scored, label);
  const ranked = [...scored].sort((left, right) => compareScoredCandidates(left, right, context.policy));
  const rankedCandidateIds = ranked.map(({ candidate }) => candidate.candidateId);
  return {
    evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
    evaluationStatus: 'evaluated',
    reasonCode: 'provided-candidate-set-evaluated',
    decisionSchemaVersion: ROUTE_SEARCH_DECISION_VERSION,
    scope: 'provided-candidate-set',
    decisionStatus: 'ranked-in-provided-set',
    admittedCandidateIds: [...rankedCandidateIds],
    rankedCandidateIds,
    rejectedCandidateIds: [],
    unresolvedCandidateIds: [],
    publicExplanation: {
      hardConstraintTrace,
      softPreferenceTrace: scored.flatMap(({ contributions }) => contributions),
      candidateDispositions: scored.map(({ candidate, totalScoreUnits }) => ({
        candidateId: candidate.candidateId,
        stage: 'candidate-disposition',
        outcome: 'admitted',
        constraintIds: [],
        preferenceIds: [],
        totalScoreUnits,
        reasonCode: 'candidate-admitted',
      })),
      rankingTrace: ranked.map((candidate, index) => ({
        candidateId: candidate.candidate.candidateId,
        stage: 'ranking',
        outcome: 'ranked',
        totalScoreUnits: candidate.totalScoreUnits,
        rank: index + 1,
        tieBreakValues: context.policy.tieBreak.map((entry) => ({
          factorId: entry.factorId,
          direction: entry.direction,
          value: tieBreakValue(candidate, entry.factorId),
        })),
        decidingFactorId: null,
        reasonCode: 'candidate-ranked',
      })),
    },
  };
}

function admitCanonicalOutcome(raw, label, context = null) {
  const value = exactObject(raw, label, [
    'termination', 'searchMetadata', 'orderedCandidates', 'providedSetDecision',
  ]);
  const termination = enumValue(
    value.termination,
    ROUTE_SEARCH_TERMINATION_SET,
    `${label}.termination`,
  );
  const orderedCandidates = strictArray(value.orderedCandidates, `${label}.orderedCandidates`, { max: 5 })
    .map((candidate, index) => admitCanonicalCandidate(candidate, index, `${label}.orderedCandidates`));
  if (new Set(orderedCandidates.map(({ candidateId }) => candidateId)).size !== orderedCandidates.length) {
    fail(`${label}.orderedCandidates candidateIds must be unique`);
  }
  const searchMetadata = admitCanonicalSearchMetadata(
    value.searchMetadata,
    termination,
    orderedCandidates.length,
    context,
    `${label}.searchMetadata`,
  );
  const expectedDecision = orderedCandidates.length === 0
    ? expectedZeroCandidateDecision(termination, label)
    : expectedCandidatefulDecision(orderedCandidates, context, label);
  const providedSetDecision = admitExactLiteral(
    value.providedSetDecision,
    expectedDecision,
    `${label}.providedSetDecision`,
  );
  return {
    termination,
    searchMetadata,
    orderedCandidates,
    providedSetDecision,
  };
}

function dispositionIds(items) {
  const ids = [];
  for (const item of items) {
    if (!ids.includes(item.candidateId)) ids.push(item.candidateId);
  }
  return ids;
}

function canonicalOutcome(product) {
  if (product.attemptState !== 'terminal') return null;
  const evaluation = product.decisionEvaluation.evaluation;
  const decision = evaluation.decision;
  return {
    termination: product.searchResult.termination,
    searchMetadata: canonicalSearchMetadata(product.searchResult),
    orderedCandidates: product.searchResult.candidateFacts.map(({ candidateId, edgeIds }) => ({
      candidateId,
      edgeIds: [...edgeIds],
    })),
    providedSetDecision: {
      evaluationSchemaVersion: product.decisionEvaluation.schemaVersion,
      evaluationStatus: evaluation.status,
      reasonCode: evaluation.reasonCode,
      decisionSchemaVersion: decision?.schemaVersion ?? null,
      scope: decision?.scope ?? null,
      decisionStatus: decision?.status ?? null,
      admittedCandidateIds: decision ? [...decision.admittedCandidateIds] : [],
      rankedCandidateIds: decision ? [...decision.rankedCandidateIds] : [],
      rejectedCandidateIds: decision ? dispositionIds(decision.rejected) : [],
      unresolvedCandidateIds: decision ? dispositionIds(decision.unresolved) : [],
      publicExplanation: decision ? {
        hardConstraintTrace: decision.trace
          .filter(({ stage }) => stage === 'hard-constraint')
          .map((item) => snapshotData(item, 'canonical hard-constraint trace')),
        softPreferenceTrace: decision.trace
          .filter(({ stage }) => stage === 'soft-preference')
          .map((item) => snapshotData(item, 'canonical soft-preference trace')),
        candidateDispositions: decision.trace
          .filter(({ stage }) => stage === 'candidate-disposition')
          .map((item) => snapshotData(item, 'canonical candidate-disposition trace')),
        rankingTrace: decision.trace
          .filter(({ stage }) => stage === 'ranking')
          .map((item) => snapshotData(item, 'canonical ranking trace')),
      } : emptyPublicExplanation(),
    },
  };
}

function admitIndependentOracleResultWithRun(raw, run) {
  const value = exactObject(raw, 'S3IndependentOracleResult', [
    'schemaVersion', 'recordKey', 'denominatorKind', 'scenarioId', 'runId', 'protocolId',
    'graphIdentity', 'evidenceIdentity', 'odPairId', 'configurationId', 'profileId', 'decisionPolicy',
    'searchRequest', 'oracleStatus', 'expectedOutcome',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.independentOracle, 'S3IndependentOracleResult.schemaVersion');
  const configurationId = id(value.configurationId, 'S3IndependentOracleResult.configurationId');
  const scenario = scenarioFor(run, value.denominatorKind, value.scenarioId, configurationId);
  const expectedKey = recordKey(run.runId, value.denominatorKind, value.scenarioId, configurationId, scenario.profileId);
  const graphIdentity = admitRecordGraphIdentity(value.graphIdentity, 'S3IndependentOracleResult.graphIdentity');
  const evidenceIdentity = admitEvidenceIdentity(value.evidenceIdentity, 'S3IndependentOracleResult.evidenceIdentity');
  if (value.recordKey !== expectedKey || value.runId !== run.runId || value.protocolId !== run.protocolId
    || value.profileId !== scenario.profileId || value.odPairId !== scenario.odPairId
    || !same(graphIdentity, graphIdentityOfArtifact(scenario.graphArtifact))
    || !same(evidenceIdentity, evidenceIdentityOf(scenario.edgeFactorEvidence))) {
    fail('S3IndependentOracleResult composite identity drifted');
  }
  const execution = run.configurationExecutions.find((item) => item.configurationId === configurationId);
  const policy = admitPolicy(value.decisionPolicy, 'S3IndependentOracleResult.decisionPolicy');
  const request = admitSearchRequest(value.searchRequest, 'S3IndependentOracleResult.searchRequest');
  if (!same(policy, execution.decisionPolicy)
    || !same(request, projectSearchRequest(run, scenario, configurationId, value.scenarioId))) fail('S3IndependentOracleResult policy/search binding drifted');
  if (!new Set(['computed', 'not-run']).has(value.oracleStatus)) fail('S3IndependentOracleResult.oracleStatus is unsupported');
  const expectedOutcome = value.expectedOutcome === null
    ? null
    : admitCanonicalOutcome(
      value.expectedOutcome,
      'S3IndependentOracleResult.expectedOutcome',
      {
        graphArtifact: scenario.graphArtifact,
        edgeFactorEvidence: scenario.edgeFactorEvidence,
        policy,
        searchRequest: request,
        originNodeId: scenario.originNodeId,
        destinationNodeId: scenario.destinationNodeId,
        denominatorKind: value.denominatorKind,
        probeKind: value.denominatorKind === 'conformance'
          ? scenario.probe.probeKind
          : null,
      },
    );
  if ((value.oracleStatus === 'computed') !== (expectedOutcome !== null)) {
    fail('S3IndependentOracleResult computed status must exactly bind a clean-room expected outcome');
  }
  if (value.denominatorKind === 'conformance' && expectedOutcome !== null
    && !same(expectedOutcome, scenario.probe.expectedOutcome)) {
    fail('S3IndependentOracleResult conformance oracle drifted from the preregistered canonical outcome');
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.independentOracle,
    recordKey: expectedKey,
    denominatorKind: value.denominatorKind,
    scenarioId: value.scenarioId,
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity,
    evidenceIdentity,
    odPairId: scenario.odPairId,
    configurationId,
    profileId: scenario.profileId,
    decisionPolicy: policy,
    searchRequest: request,
    oracleStatus: value.oracleStatus,
    expectedOutcome,
  });
}

export function admitS3IndependentOracleResult(raw, runManifest) {
  return admitIndependentOracleResultWithRun(raw, admitS3RunManifest(runManifest));
}

function admitJoinedRunRecordWithRun(raw, run) {
  const value = exactObject(raw, 'S3JoinedRunRecord', [
    'schemaVersion', 'recordKey', 'denominatorKind',
    'primaryExecution', 'replayExecution', 'oracleResult',
  ]);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.joinedRunRecord, 'S3JoinedRunRecord.schemaVersion');
  const primary = admitProductExecutionWithRun(value.primaryExecution, run);
  const replay = admitProductExecutionWithRun(value.replayExecution, run);
  const oracle = admitIndependentOracleResultWithRun(value.oracleResult, run);
  if (primary.executionRole !== 'primary' || replay.executionRole !== 'replay'
    || primary.executionAttemptId === replay.executionAttemptId) {
    fail('S3JoinedRunRecord requires distinct primary and replay execution attempts');
  }
  if (value.recordKey !== primary.recordKey || replay.recordKey !== primary.recordKey
    || oracle.recordKey !== primary.recordKey || value.denominatorKind !== primary.denominatorKind
    || replay.denominatorKind !== primary.denominatorKind || oracle.denominatorKind !== primary.denominatorKind
    || !same(primary.decisionPolicy, replay.decisionPolicy)
    || !same(primary.decisionPolicy, oracle.decisionPolicy)
    || !same(primary.searchRequest, replay.searchRequest)
    || !same(primary.searchRequest, oracle.searchRequest)
    || !same(primary.evidenceIdentity, replay.evidenceIdentity)
    || !same(primary.evidenceIdentity, oracle.evidenceIdentity)) {
    fail('S3JoinedRunRecord primary/replay/oracle composite binding drifted');
  }
  if (primary.measurement.measurementStatus === 'measured'
    && primary.measurement.cacheState !== S3_PERFORMANCE_PROTOCOL.primaryCacheState) {
    fail('S3JoinedRunRecord measured primary must use the frozen cold sampling position');
  }
  if (replay.measurement.measurementStatus === 'measured'
    && replay.measurement.cacheState !== S3_PERFORMANCE_PROTOCOL.replayCacheState) {
    fail('S3JoinedRunRecord measured replay must use the frozen warm sampling position');
  }
  const requiredOracleStatus = primary.attemptState === 'terminal' ? 'computed' : 'not-run';
  if (oracle.oracleStatus !== requiredOracleStatus) {
    fail('S3JoinedRunRecord oracle computed/not-run policy drifted from the frozen oracle spec');
  }
  const primaryOutcome = canonicalOutcome(primary);
  const replayOutcome = canonicalOutcome(replay);
  const replayComparison = replay.attemptState === 'not-started'
    ? 'not-run'
    : !primaryOutcome || !replayOutcome
      ? 'not-comparable'
      : same(primaryOutcome, replayOutcome) ? 'match' : 'mismatch';
  const oracleComparison = oracle.oracleStatus === 'not-run'
    ? 'not-run'
    : !primaryOutcome ? 'not-comparable'
      : same(primaryOutcome, oracle.expectedOutcome) ? 'match' : 'mismatch';
  let conformanceOutcome = 'not-applicable';
  if (primary.denominatorKind === 'conformance') {
    const probe = run.protocol.cohort.conformanceProbes.find(({ probeId }) => probeId === primary.scenarioId);
    conformanceOutcome = primary.attemptState === 'not-started' ? 'not-run'
      : same(primaryOutcome, probe.expectedOutcome)
        && replayComparison === 'match' && oracleComparison === 'match' ? 'pass' : 'fail';
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.joinedRunRecord,
    recordKey: primary.recordKey,
    denominatorKind: primary.denominatorKind,
    primaryExecution: primary,
    replayExecution: replay,
    oracleResult: oracle,
    replayComparison,
    oracleComparison,
    conformanceOutcome,
  });
}

export function admitS3JoinedRunRecord(raw, runManifest) {
  return admitJoinedRunRecordWithRun(raw, admitS3RunManifest(runManifest));
}

function expectedMainKeys(run) {
  const keys = new Set();
  for (const pair of run.protocol.cohort.odPairs) {
    for (const configurationId of pair.configurationIds) keys.add(recordKey(run.runId, 'main', pair.odPairId, configurationId, pair.profileId));
  }
  return keys;
}

function expectedConformanceKeys(run) {
  return new Set(run.protocol.cohort.conformanceProbes.map((probe) => recordKey(run.runId, 'conformance', probe.probeId, probe.configurationId, probe.profileId)));
}

export function admitS3RecordCollection(raw) {
  const value = exactObject(raw, 'S3RecordCollection', ['schemaVersion', 'runManifest', 'mainRecords', 'conformanceRecords']);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.recordCollection, 'S3RecordCollection.schemaVersion');
  const run = admitS3RunManifest(value.runManifest);
  const mainRecords = strictArray(value.mainRecords, 'S3RecordCollection.mainRecords', { max: 5_000 }).map((record) => admitJoinedRunRecordWithRun(record, run));
  const conformanceRecords = strictArray(value.conformanceRecords, 'S3RecordCollection.conformanceRecords', { max: run.expectedCounts.conformanceProbeEvaluations }).map((record) => admitJoinedRunRecordWithRun(record, run));
  if (mainRecords.some(({ denominatorKind }) => denominatorKind !== 'main')
    || conformanceRecords.some(({ denominatorKind }) => denominatorKind !== 'conformance')) fail('S3RecordCollection cross-denominator record is forbidden');
  const mainExpected = expectedMainKeys(run);
  const conformanceExpected = expectedConformanceKeys(run);
  for (const record of mainRecords) if (!mainExpected.has(record.recordKey)) fail('S3RecordCollection contains an extra main record');
  for (const record of conformanceRecords) if (!conformanceExpected.has(record.recordKey)) fail('S3RecordCollection contains an extra conformance record');
  if (new Set(mainRecords.map(({ recordKey: key }) => key)).size !== mainRecords.length
    || new Set(conformanceRecords.map(({ recordKey: key }) => key)).size !== conformanceRecords.length) fail('S3RecordCollection contains duplicate records');
  const executionAttemptIds = [...mainRecords, ...conformanceRecords].flatMap((record) => [
    record.primaryExecution.executionAttemptId,
    record.replayExecution.executionAttemptId,
  ]);
  if (new Set(executionAttemptIds).size !== executionAttemptIds.length) {
    fail('S3RecordCollection executionAttemptIds must be globally distinct');
  }
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.recordCollection,
    runManifest: run,
    mainRecords,
    conformanceRecords,
  });
}

function zeroMap(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function integerDistribution(values) {
  if (values.length === 0) return { sampleCount: 0, min: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (percent) => sorted[Math.ceil((percent / 100) * sorted.length) - 1];
  return {
    sampleCount: sorted.length,
    min: sorted[0],
    p50: percentile(50),
    p95: percentile(95),
    max: sorted.at(-1),
  };
}

function deriveMeasurements(records, expected, executionKey) {
  const measurements = records.map((record) => record[executionKey].measurement);
  const measured = measurements.filter(({ measurementStatus }) => measurementStatus === 'measured');
  const cold = measured.filter(({ cacheState }) => cacheState === 'cold');
  const warm = measured.filter(({ cacheState }) => cacheState === 'warm');
  return {
    denominatorUnit: 'scenario-config-product-execution',
    expected,
    recorded: measurements.length,
    measured: measured.length,
    recordedNotMeasured: measurements.length - measured.length,
    missingRecords: expected - measurements.length,
    notMeasured: expected - measured.length,
    coldSamples: cold.length,
    warmSamples: warm.length,
    coldLatencyMicros: integerDistribution(cold.map(({ latencyMicros }) => latencyMicros)),
    warmLatencyMicros: integerDistribution(warm.map(({ latencyMicros }) => latencyMicros)),
    measuredMemoryBytes: integerDistribution(measured.map(({ memoryBytes }) => memoryBytes)),
  };
}

function deriveDenominator(records, expected) {
  const terminalStatuses = zeroMap(TERMINATION_KEYS);
  const observations = { denominatorUnit: 'candidate-factor-observation', denominator: 0, ...zeroMap(OBSERVATION_KEYS) };
  const replayComparisons = zeroMap(['match', 'mismatch', 'not-comparable', 'not-run']);
  const oracleComparisons = zeroMap(['match', 'mismatch', 'not-comparable', 'not-run']);
  const conformanceOutcomes = zeroMap([...CONFORMANCE_OUTCOMES]);
  const constraintOutcomes = zeroMap([
    'not-required', 'eligible-candidates-returned',
    'no-eligible-route-in-bounded-scope-proven', 'no-eligible-route-not-proven',
    'unresolved-evidence', 'not-evaluated',
  ]);
  const budgetOutcomes = zeroMap(['within-budget', 'exhausted', 'not-evaluated']);
  const capacityOutcomes = zeroMap(['within-capacity', 'exhausted', 'not-evaluated']);
  const completenessOutcomes = zeroMap(['complete-within-bounds', 'not-proven', 'not-evaluated']);
  let attempted = 0;
  let terminal = 0;
  let startedNoTerminal = 0;
  for (const record of records) {
    const product = record.primaryExecution;
    if (product.attemptState !== 'not-started') attempted += 1;
    if (product.attemptState === 'terminal') {
      terminal += 1;
      terminalStatuses[product.searchResult.termination] += 1;
    } else if (product.attemptState === 'started-no-terminal') {
      startedNoTerminal += 1;
      terminalStatuses['started-no-terminal'] += 1;
    } else terminalStatuses['not-started'] += 1;
    observations.denominator += product.observationSummary.denominator;
    for (const key of OBSERVATION_KEYS) observations[key] += product.observationSummary[key];
    replayComparisons[record.replayComparison] += 1;
    oracleComparisons[record.oracleComparison] += 1;
    conformanceOutcomes[record.conformanceOutcome] += 1;
    const candidateSet = product.searchResult?.candidateSet;
    if (candidateSet) {
      constraintOutcomes[candidateSet.constraintOutcome] += 1;
      budgetOutcomes[candidateSet.budgetOutcome] += 1;
      capacityOutcomes[candidateSet.capacityOutcome] += 1;
      completenessOutcomes[candidateSet.completeness.routeSearch] += 1;
    } else {
      constraintOutcomes['not-evaluated'] += 1;
      budgetOutcomes['not-evaluated'] += 1;
      capacityOutcomes['not-evaluated'] += 1;
      completenessOutcomes['not-evaluated'] += 1;
    }
  }
  const missingRecords = expected - records.length;
  terminalStatuses['not-started'] += missingRecords;
  constraintOutcomes['not-evaluated'] += missingRecords;
  budgetOutcomes['not-evaluated'] += missingRecords;
  capacityOutcomes['not-evaluated'] += missingRecords;
  completenessOutcomes['not-evaluated'] += missingRecords;
  return {
    expected,
    attempted,
    recorded: records.length,
    terminal,
    notStarted: expected - attempted,
    startedNoTerminal,
    terminalStatuses: { denominator: expected, ...terminalStatuses },
    observationStates: observations,
    replayComparisons: { denominator: expected, ...replayComparisons, 'not-run': replayComparisons['not-run'] + expected - records.length },
    oracleComparisons: { denominator: expected, ...oracleComparisons, 'not-run': oracleComparisons['not-run'] + expected - records.length },
    conformanceOutcomes: { denominator: expected, ...conformanceOutcomes, 'not-run': conformanceOutcomes['not-run'] + expected - records.length },
    constraintOutcomes: { denominator: expected, ...constraintOutcomes },
    budgetOutcomes: { denominator: expected, ...budgetOutcomes },
    capacityOutcomes: { denominator: expected, ...capacityOutcomes },
    completenessOutcomes: { denominator: expected, ...completenessOutcomes },
    performanceMeasurements: {
      primary: deriveMeasurements(records, expected, 'primaryExecution'),
      replay: deriveMeasurements(records, expected, 'replayExecution'),
    },
  };
}

function assertClaims(emitted, protocol, collection, main, conformance, disclosures) {
  for (const claim of emitted) {
    if (!protocol.eligibleClaimCodes.includes(claim)) fail('S3Report emitted claim was not preregistered');
    if (claim === 'synthetic-determinism-evidence') {
      if (main.recorded !== main.expected || main.terminal !== main.expected
        || main.replayComparisons.match !== main.expected) fail('S3Report determinism claim requires complete primary/replay all-match records');
    }
    if (claim === 'synthetic-contract-conformance') {
      if (conformance.recorded !== conformance.expected
        || conformance.conformanceOutcomes.pass !== conformance.expected) fail('S3Report conformance claim requires every prescribed probe to pass');
    }
    if (claim === 'bounded-offline-validation') {
      const boundedTerminal = collection.mainRecords.some(({ primaryExecution }) => (
        primaryExecution.attemptState === 'terminal'
          && primaryExecution.searchResult.candidateSet !== null
      ));
      if (!boundedTerminal
        || disclosures.partialRun !== (main.recorded < main.expected || main.terminal < main.expected)) {
        fail('S3Report bounded validation claim requires bounded terminal evidence and truthful partial disclosure');
      }
    }
  }
}

export function admitS3Report(raw) {
  const value = exactObject(raw, 'S3Report', ['schemaVersion', 'reportId', 'recordCollection', 'runId', 'emittedClaimCodes', 'disclosures']);
  exactVersion(value.schemaVersion, S3_SCENARIO_SCHEMA_VERSIONS.report, 'S3Report.schemaVersion');
  const collection = admitS3RecordCollection(value.recordCollection);
  const run = collection.runManifest;
  if (value.runId !== run.runId) fail('S3Report.runId drifted');
  const disclosuresValue = exactObject(value.disclosures, 'S3Report.disclosures', ['partialRun', 'stoppedRecords']);
  if (typeof disclosuresValue.partialRun !== 'boolean') fail('S3Report.disclosures.partialRun must be boolean');
  const stoppedRecords = integer(disclosuresValue.stoppedRecords, 'S3Report.disclosures.stoppedRecords', { max: 5_000 });
  const actualStopped = collection.mainRecords.filter(({ primaryExecution }) => (
    primaryExecution.searchResult?.status === 'stopped'
  )).length;
  if (stoppedRecords !== actualStopped) fail('S3Report stopped disclosure must be derived from records');
  const main = deriveDenominator(collection.mainRecords, run.expectedCounts.scenarioConfigEvaluations);
  const conformance = deriveDenominator(collection.conformanceRecords, run.expectedCounts.conformanceProbeEvaluations);
  const actualPartial = main.recorded < main.expected || main.terminal < main.expected;
  if (disclosuresValue.partialRun !== actualPartial) fail('S3Report partial disclosure must be derived from records');
  const emittedClaimCodes = claimCodes(value.emittedClaimCodes, 'S3Report.emittedClaimCodes');
  const disclosures = { partialRun: actualPartial, stoppedRecords: actualStopped };
  assertClaims(emittedClaimCodes, run.protocol, collection, main, conformance, disclosures);
  return deepFreeze({
    schemaVersion: S3_SCENARIO_SCHEMA_VERSIONS.report,
    reportId: id(value.reportId, 'S3Report.reportId'),
    recordCollection: collection,
    runId: run.runId,
    emittedClaimCodes,
    disclosures,
    counts: {
      uniqueOdPairs: S3_SCENARIO_COUNTS.uniqueOdPairs,
      configurationGroups: S3_SCENARIO_COUNTS.configurationGroups,
      scenarioConfigEvaluations: S3_SCENARIO_COUNTS.scenarioConfigEvaluations,
    },
    mainCohortDenominators: main,
    conformanceDenominators: conformance,
    executionEvidence: {
      graphIdentity: graphIdentityOf(run.graphScope),
      graphSize: {
        nodeCount: run.graphScope.graphArtifact.nodes.length,
        edgeCount: run.graphScope.graphArtifact.edges.length,
        canonicalArtifactUtf8Bytes: new TextEncoder().encode(
          JSON.stringify(run.graphScope.graphArtifact),
        ).length,
      },
      executionIdentity: run.executionIdentity,
      referenceEnvironment: run.referenceEnvironment,
      performanceProtocol: run.performanceProtocol,
      performanceInterpretation: 'diagnostic-only-no-performance-claim-eligible-in-v1',
    },
  });
}
