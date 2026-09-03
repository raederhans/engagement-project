import { createHash } from 'node:crypto';

import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitDecisionPolicy,
  admitGraphArtifact,
  admitSourceObservation,
} from '../index.js';
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
} from '../candidate_search_v2.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  ROUTE_SEARCH_DECISION_VERSION,
  admitRouteSearchDecisionEvaluation,
} from '../../evaluator/search_v2.js';
import {
  deepFreeze,
  exactObject,
  fail,
  strictArray,
} from '../internal/s3_validator_v1.js';

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

export {
  CAPABILITY_FACTORS,
  MAX_ID_LENGTH,
  OBSERVATION_KEYS,
  PROBE_TERMINATIONS,
  SYNTHETIC_DISTANCE_BUCKETS as S3_SYNTHETIC_DISTANCE_BUCKETS,
  S3_ZERO_CANDIDATE_REASON_BY_TERMINATION,
  TERMINATION_KEYS,
  admitDecisionEvaluation,
  admitExactLiteral,
  admitPolicy,
  admitSearchRequest,
  admitSearchResult,
  admitSyntheticGraph,
  assertCounts,
  assertPolicySearchEquality,
  booleanValue,
  claimCodes,
  deepFreeze,
  enumValue,
  exactObject,
  exactSequence,
  exactVersion,
  fail,
  id,
  integer,
  same,
  snapshotData,
  strictArray,
  text,
  uniqueIds,
  version,
};
