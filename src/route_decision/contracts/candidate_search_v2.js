import { admitRouteCandidateFacts } from './index.js';

const MAX_ID_LENGTH = 120;
const MAX_REQUESTED_CANDIDATES = 16;
const MAX_EXPANDED_STATES = 1_000_000;
const MAX_ROUTE_EDGE_COUNT = 100_000;

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export const ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS = Object.freeze({
  searchRequest: 'engagement-route-candidate-search-request/v1',
  candidateSet: 'engagement-route-candidate-set/v2',
  searchResult: 'engagement-route-candidate-search-result/v1',
});

export const ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES = Object.freeze([
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
  'missing',
]);

export const ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS = Object.freeze([
  'step-free',
  'curb-ramp-present',
  'paved-surface',
]);

export const ROUTE_SEARCH_RESULT_STATUSES = Object.freeze([
  'rejected',
  'not-started',
  'completed',
  'stopped',
]);

export const ROUTE_SEARCH_TERMINATIONS = Object.freeze([
  'invalid-input',
  'endpoint-unavailable',
  'requested-candidate-count-reached',
  'bounded-search-space-exhausted',
  'no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence',
  'search-budget-exhausted',
]);

export const ROUTE_SEARCH_DISTINCTNESS_VERSION = 'ordered-directed-edge-id-sequence/v1';
export const ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION =
  'every-directed-edge-fail-dominates-unresolved/v1';
export const ROUTE_SEARCH_TIE_BREAK_VERSION = 'route-candidate-search-tie-break/v1';

const SEARCH_FACTOR_SET = new Set(ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS);
const SEARCH_FACTOR_ORDER = new Map(
  ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS.map((factorId, index) => [factorId, index]),
);
const RESULT_STATUS_SET = new Set(ROUTE_SEARCH_RESULT_STATUSES);
const TERMINATION_SET = new Set(ROUTE_SEARCH_TERMINATIONS);
const ROUTE_SEARCH_COMPLETENESS_SET = new Set(['complete-within-bounds', 'not-proven']);
const CONSTRAINT_OUTCOME_SET = new Set([
  'not-required',
  'eligible-candidates-returned',
  'no-eligible-route-in-bounded-scope-proven',
  'no-eligible-route-not-proven',
  'unresolved-evidence',
  'not-evaluated',
]);
const BUDGET_OUTCOME_SET = new Set(['within-budget', 'exhausted']);

function fail(message) {
  throw new TypeError(`route candidate search contract: ${message}`);
}

function inspectPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of ownKeys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      fail(`${label} must contain data properties only`);
    }
  }
  return ownKeys;
}

function exactObject(value, label, requiredKeys) {
  const actualKeys = inspectPlainObject(value, label);
  const allowed = new Set(requiredKeys);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  const unknown = actualKeys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return value;
}

function strictArray(value, label, { min = 0, max } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be an array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < min || (max !== undefined && length > max)) {
    fail(`${label} length is outside the supported range`);
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail(`${label} must not contain sparse entries`);
    if (!Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must contain data properties only`);
    }
  }
  const extra = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
  if (extra.length) fail(`${label} contains unsupported properties`);
  return value;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_PROPERTY_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function exactEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) fail(`${label} is unsupported`);
  return value;
}

function safeInteger(value, label, { min, max }) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) {
    fail(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function exactSequence(value, expected, label) {
  const sequence = strictArray(value, label, { min: expected.length, max: expected.length });
  if (sequence.some((item, index) => item !== expected[index])) {
    fail(`${label} must exactly preserve ${expected.join(',')}`);
  }
  return [...sequence];
}

function uniqueIds(value, label, { max }) {
  const items = strictArray(value, label, { max });
  const admitted = items.map((item, index) => boundedId(item, `${label}[${index}]`));
  if (new Set(admitted).size !== admitted.length) fail(`${label} must be unique`);
  return admitted;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const ROUTE_CANDIDATE_SEARCH_DECISIONS = deepFreeze({
  requestedK: {
    field: 'requestedCandidateCount',
    meaning: 'maximum-requested-not-guaranteed',
    includesPrimary: true,
    returnedField: 'candidateCount',
    returnedShape: 'finalized-ordered-prefix',
  },
  directedRouteDistinctness: {
    version: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    identity: 'complete-ordered-directed-edge-id-sequence',
    geometryDefinesIdentity: false,
    candidateIdDefinesIdentity: false,
  },
  searchAdmissibleHardConstraints: {
    factorIds: [...ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS],
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    knownFailurePrecedence: 'fail-before-unresolved',
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
  },
  boundedCompleteness: {
    completeValue: 'complete-within-bounds',
    incompleteValue: 'not-proven',
    scope: 'loopless-directed-routes-within-max-route-edge-count',
    requestedCountReachedIsComplete: false,
    budgetExhaustedIsComplete: false,
  },
  terminalStatusSeparation: {
    statusField: 'status',
    terminationField: 'termination',
  },
  tieBreakVersioning: {
    version: ROUTE_SEARCH_TIE_BREAK_VERSION,
    keys: [
      { key: 'objectiveCostUnits', order: 'ascending' },
      { key: 'directedEdgeIdSequence', order: 'locale-independent-code-unit-lexicographic' },
    ],
    distanceParticipates: false,
  },
});

function admitSearchBounds(raw, label) {
  const value = exactObject(raw, label, ['maxExpandedStates', 'maxRouteEdgeCount']);
  return {
    maxExpandedStates: safeInteger(value.maxExpandedStates, `${label}.maxExpandedStates`, {
      min: 1,
      max: MAX_EXPANDED_STATES,
    }),
    maxRouteEdgeCount: safeInteger(value.maxRouteEdgeCount, `${label}.maxRouteEdgeCount`, {
      min: 0,
      max: MAX_ROUTE_EDGE_COUNT,
    }),
  };
}

function admitSearchConstraint(raw, index) {
  const label = `CandidateSearchRequest.hardConstraints[${index}]`;
  const value = exactObject(raw, label, [
    'constraintId',
    'factorId',
    'locality',
    'edgeEvidenceRequirement',
    'operator',
    'expectedValue',
    'routeAggregation',
    'aggregationVersion',
    'unresolvedStates',
    'unresolvedDisposition',
  ]);
  const factorId = exactEnum(value.factorId, SEARCH_FACTOR_SET, `${label}.factorId`);
  if (value.locality !== 'edge-local') fail(`${label}.locality must be edge-local`);
  if (value.edgeEvidenceRequirement !== 'complete') {
    fail(`${label}.edgeEvidenceRequirement must be complete`);
  }
  if (value.operator !== 'equals') fail(`${label}.operator must be equals`);
  if (value.expectedValue !== true) fail(`${label}.expectedValue must be true`);
  if (value.routeAggregation !== 'every-directed-edge') {
    fail(`${label}.routeAggregation must be every-directed-edge`);
  }
  if (value.aggregationVersion !== ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION) {
    fail(`${label}.aggregationVersion is unsupported`);
  }
  if (value.unresolvedDisposition !== 'exclude-and-report') {
    fail(`${label}.unresolvedDisposition must be exclude-and-report`);
  }
  return {
    constraintId: boundedId(value.constraintId, `${label}.constraintId`),
    factorId,
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    unresolvedStates: exactSequence(
      value.unresolvedStates,
      ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
      `${label}.unresolvedStates`,
    ),
    unresolvedDisposition: 'exclude-and-report',
  };
}

export function admitRouteCandidateSearchRequest(raw) {
  const value = exactObject(raw, 'CandidateSearchRequest', [
    'schemaVersion',
    'requestId',
    'graphId',
    'mode',
    'originNodeId',
    'destinationNodeId',
    'decisionPolicyId',
    'objectiveFactorId',
    'requestedCandidateCount',
    'routeDistinctnessVersion',
    'tieBreakVersion',
    'bounds',
    'hardConstraints',
  ]);
  if (value.schemaVersion !== ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest) {
    fail('CandidateSearchRequest.schemaVersion is unsupported');
  }
  if (value.mode !== 'walk') fail('CandidateSearchRequest.mode must be walk');
  if (value.objectiveFactorId !== 'objective-cost-units') {
    fail('CandidateSearchRequest.objectiveFactorId must be objective-cost-units');
  }
  if (value.routeDistinctnessVersion !== ROUTE_SEARCH_DISTINCTNESS_VERSION) {
    fail('CandidateSearchRequest.routeDistinctnessVersion is unsupported');
  }
  if (value.tieBreakVersion !== ROUTE_SEARCH_TIE_BREAK_VERSION) {
    fail('CandidateSearchRequest.tieBreakVersion is unsupported');
  }
  const constraints = strictArray(
    value.hardConstraints,
    'CandidateSearchRequest.hardConstraints',
    { max: ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS.length },
  ).map(admitSearchConstraint);
  const constraintIds = constraints.map(({ constraintId }) => constraintId);
  if (new Set(constraintIds).size !== constraintIds.length) {
    fail('CandidateSearchRequest.hardConstraints constraintIds must be unique');
  }
  const factorIds = constraints.map(({ factorId }) => factorId);
  if (new Set(factorIds).size !== factorIds.length) {
    fail('CandidateSearchRequest.hardConstraints factorIds must be unique');
  }
  constraints.sort((left, right) => (
    SEARCH_FACTOR_ORDER.get(left.factorId) - SEARCH_FACTOR_ORDER.get(right.factorId)
  ));
  return deepFreeze({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
    requestId: boundedId(value.requestId, 'CandidateSearchRequest.requestId'),
    graphId: boundedId(value.graphId, 'CandidateSearchRequest.graphId'),
    mode: 'walk',
    originNodeId: boundedId(value.originNodeId, 'CandidateSearchRequest.originNodeId'),
    destinationNodeId: boundedId(
      value.destinationNodeId,
      'CandidateSearchRequest.destinationNodeId',
    ),
    decisionPolicyId: boundedId(
      value.decisionPolicyId,
      'CandidateSearchRequest.decisionPolicyId',
    ),
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: safeInteger(
      value.requestedCandidateCount,
      'CandidateSearchRequest.requestedCandidateCount',
      { min: 1, max: MAX_REQUESTED_CANDIDATES },
    ),
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: admitSearchBounds(value.bounds, 'CandidateSearchRequest.bounds'),
    hardConstraints: constraints,
  });
}

function admitCompleteness(raw) {
  const value = exactObject(raw, 'CandidateSetV2.completeness', [
    'routeSearch',
    'scope',
  ]);
  if (value.scope !== 'loopless-directed-routes-within-max-route-edge-count') {
    fail('CandidateSetV2.completeness.scope is unsupported');
  }
  return {
    routeSearch: exactEnum(
      value.routeSearch,
      ROUTE_SEARCH_COMPLETENESS_SET,
      'CandidateSetV2.completeness.routeSearch',
    ),
    scope: 'loopless-directed-routes-within-max-route-edge-count',
  };
}

export function admitCandidateSetV2(raw) {
  const value = exactObject(raw, 'CandidateSetV2', [
    'schemaVersion',
    'candidateSetId',
    'candidateSetRevision',
    'requestId',
    'graphId',
    'strategy',
    'objectiveFactorId',
    'requestedCandidateCount',
    'candidateIds',
    'candidateCount',
    'routeDistinctnessVersion',
    'searchConstraintIds',
    'constraintAggregationVersion',
    'tieBreakVersion',
    'bounds',
    'expandedStateCount',
    'completeness',
    'constraintOutcome',
    'budgetOutcome',
  ]);
  if (value.schemaVersion !== ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.candidateSet) {
    fail('CandidateSetV2.schemaVersion is unsupported');
  }
  if (value.strategy !== 'bounded-loopless-k-candidates') {
    fail('CandidateSetV2.strategy must be bounded-loopless-k-candidates');
  }
  if (value.objectiveFactorId !== 'objective-cost-units') {
    fail('CandidateSetV2.objectiveFactorId must be objective-cost-units');
  }
  if (value.routeDistinctnessVersion !== ROUTE_SEARCH_DISTINCTNESS_VERSION) {
    fail('CandidateSetV2.routeDistinctnessVersion is unsupported');
  }
  if (value.constraintAggregationVersion !== ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION) {
    fail('CandidateSetV2.constraintAggregationVersion is unsupported');
  }
  if (value.tieBreakVersion !== ROUTE_SEARCH_TIE_BREAK_VERSION) {
    fail('CandidateSetV2.tieBreakVersion is unsupported');
  }
  const requestedCandidateCount = safeInteger(
    value.requestedCandidateCount,
    'CandidateSetV2.requestedCandidateCount',
    { min: 1, max: MAX_REQUESTED_CANDIDATES },
  );
  const candidateIds = uniqueIds(value.candidateIds, 'CandidateSetV2.candidateIds', {
    max: requestedCandidateCount,
  });
  const candidateCount = safeInteger(value.candidateCount, 'CandidateSetV2.candidateCount', {
    min: 0,
    max: requestedCandidateCount,
  });
  if (candidateCount !== candidateIds.length) {
    fail('CandidateSetV2.candidateCount must equal candidateIds length');
  }
  const searchConstraintIds = uniqueIds(
    value.searchConstraintIds,
    'CandidateSetV2.searchConstraintIds',
    { max: ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS.length },
  );
  const bounds = admitSearchBounds(value.bounds, 'CandidateSetV2.bounds');
  const expandedStateCount = safeInteger(
    value.expandedStateCount,
    'CandidateSetV2.expandedStateCount',
    { min: 0, max: bounds.maxExpandedStates },
  );
  const completeness = admitCompleteness(value.completeness);
  const constraintOutcome = exactEnum(
    value.constraintOutcome,
    CONSTRAINT_OUTCOME_SET,
    'CandidateSetV2.constraintOutcome',
  );
  const budgetOutcome = exactEnum(
    value.budgetOutcome,
    BUDGET_OUTCOME_SET,
    'CandidateSetV2.budgetOutcome',
  );
  if (searchConstraintIds.length === 0 && constraintOutcome !== 'not-required') {
    fail('CandidateSetV2.constraintOutcome must be not-required without search constraints');
  }
  if (searchConstraintIds.length > 0 && constraintOutcome === 'not-required') {
    fail('CandidateSetV2.constraintOutcome cannot be not-required with search constraints');
  }
  if (candidateCount > 0 && [
    'no-eligible-route-in-bounded-scope-proven',
    'no-eligible-route-not-proven',
    'not-evaluated',
  ].includes(constraintOutcome)) {
    fail('CandidateSetV2.constraintOutcome is inconsistent with returned candidates');
  }
  if (candidateCount === 0 && constraintOutcome === 'eligible-candidates-returned') {
    fail('CandidateSetV2.constraintOutcome requires returned candidates');
  }
  if (constraintOutcome === 'no-eligible-route-in-bounded-scope-proven'
    && completeness.routeSearch !== 'complete-within-bounds') {
    fail('CandidateSetV2 proven no-eligible outcome requires complete bounded search');
  }
  if (constraintOutcome === 'no-eligible-route-not-proven'
    && completeness.routeSearch !== 'not-proven') {
    fail('CandidateSetV2 unproven no-eligible outcome requires incomplete search');
  }
  if (budgetOutcome === 'exhausted' && completeness.routeSearch !== 'not-proven') {
    fail('CandidateSetV2 exhausted budget cannot claim complete bounded search');
  }
  if (budgetOutcome === 'exhausted' && expandedStateCount !== bounds.maxExpandedStates) {
    fail('CandidateSetV2 exhausted budget must reach maxExpandedStates');
  }
  return deepFreeze({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.candidateSet,
    candidateSetId: boundedId(value.candidateSetId, 'CandidateSetV2.candidateSetId'),
    candidateSetRevision: boundedId(
      value.candidateSetRevision,
      'CandidateSetV2.candidateSetRevision',
    ),
    requestId: boundedId(value.requestId, 'CandidateSetV2.requestId'),
    graphId: boundedId(value.graphId, 'CandidateSetV2.graphId'),
    strategy: 'bounded-loopless-k-candidates',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount,
    candidateIds,
    candidateCount,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    searchConstraintIds,
    constraintAggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds,
    expandedStateCount,
    completeness,
    constraintOutcome,
    budgetOutcome,
  });
}

function sameBounds(left, right) {
  return left.maxExpandedStates === right.maxExpandedStates
    && left.maxRouteEdgeCount === right.maxRouteEdgeCount;
}

function compareIdSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

function compareCandidateFacts(left, right) {
  if (left.objectiveCostUnits !== right.objectiveCostUnits) {
    return left.objectiveCostUnits - right.objectiveCostUnits;
  }
  return compareIdSequences(left.edgeIds, right.edgeIds);
}

function assertCandidateFactsConsistency(request, candidateSet, candidateFacts) {
  if (candidateFacts.length !== candidateSet.candidateCount) {
    fail('CandidateSearchResult.candidateFacts length must equal candidateSet.candidateCount');
  }
  for (let index = 0; index < candidateFacts.length; index += 1) {
    const candidate = candidateFacts[index];
    if (candidate.candidateId !== candidateSet.candidateIds[index]) {
      fail('CandidateSearchResult candidate IDs must exactly match candidateSet order');
    }
    if (candidate.provenance.graphId !== candidateSet.graphId) {
      fail('CandidateSearchResult candidate graphId must match candidateSet.graphId');
    }
    if (candidate.edgeIds.length > request.bounds.maxRouteEdgeCount) {
      fail('CandidateSearchResult candidate exceeds request maxRouteEdgeCount');
    }
    if (request.originNodeId === request.destinationNodeId && candidate.edgeIds.length !== 0) {
      fail('CandidateSearchResult same-endpoint candidate must use an empty edge sequence');
    }
    if (request.originNodeId !== request.destinationNodeId && candidate.edgeIds.length === 0) {
      fail('CandidateSearchResult distinct endpoints require a non-empty edge sequence');
    }
  }
  const routeIdentities = candidateFacts.map(({ edgeIds }) => JSON.stringify(edgeIds));
  if (new Set(routeIdentities).size !== routeIdentities.length) {
    fail('CandidateSearchResult routes must be distinct ordered directed edge ID sequences');
  }
  for (let index = 1; index < candidateFacts.length; index += 1) {
    if (compareCandidateFacts(candidateFacts[index - 1], candidateFacts[index]) > 0) {
      fail('CandidateSearchResult candidates must follow the versioned search tie-break order');
    }
  }
  for (const constraint of request.hardConstraints) {
    for (const candidate of candidateFacts) {
      const observation = candidate.observations[constraint.factorId];
      if (!observation || observation.state !== 'observed' || observation.value !== true) {
        fail(`CandidateSearchResult returned candidate must resolve ${constraint.factorId} as observed true`);
      }
    }
  }
}

function assertTerminalConsistency(status, termination, request, candidateSet, candidateFacts) {
  if (termination === 'invalid-input') {
    if (status !== 'rejected' || request !== null || candidateSet !== null || candidateFacts.length) {
      fail('CandidateSearchResult invalid-input terminal is inconsistent');
    }
    return;
  }
  if (!request) fail('CandidateSearchResult admitted terminals require a request');
  if (termination === 'endpoint-unavailable') {
    if (status !== 'not-started' || candidateSet !== null || candidateFacts.length) {
      fail('CandidateSearchResult endpoint-unavailable terminal is inconsistent');
    }
    return;
  }
  if (!candidateSet) fail('CandidateSearchResult searched terminals require a candidateSet');
  if (status === 'rejected' || status === 'not-started') {
    fail('CandidateSearchResult searched terminal has an inconsistent status');
  }
  const count = candidateSet.candidateCount;
  const requested = candidateSet.requestedCandidateCount;
  const routeSearch = candidateSet.completeness.routeSearch;
  const constraintOutcome = candidateSet.constraintOutcome;
  const budgetOutcome = candidateSet.budgetOutcome;
  const hasConstraints = candidateSet.searchConstraintIds.length > 0;

  if (termination === 'requested-candidate-count-reached') {
    if (status !== 'completed' || count !== requested || routeSearch !== 'not-proven'
      || budgetOutcome !== 'within-budget'
      || (hasConstraints && constraintOutcome !== 'eligible-candidates-returned')) {
      fail('CandidateSearchResult requested-count terminal is inconsistent');
    }
  } else if (termination === 'bounded-search-space-exhausted') {
    if (status !== 'completed' || count === 0 || count >= requested
      || routeSearch !== 'complete-within-bounds'
      || budgetOutcome !== 'within-budget'
      || (hasConstraints && constraintOutcome !== 'eligible-candidates-returned')) {
      fail('CandidateSearchResult bounded-search-space terminal is inconsistent');
    }
  } else if (termination === 'no-directed-route-in-bounded-scope') {
    if (status !== 'completed' || count !== 0 || routeSearch !== 'complete-within-bounds'
      || budgetOutcome !== 'within-budget'
      || (hasConstraints && constraintOutcome !== 'not-evaluated')) {
      fail('CandidateSearchResult bounded no-directed-route terminal is inconsistent');
    }
  } else if (termination === 'no-eligible-route-in-bounded-scope') {
    if (status !== 'completed' || count !== 0 || routeSearch !== 'complete-within-bounds'
      || budgetOutcome !== 'within-budget' || !hasConstraints
      || constraintOutcome !== 'no-eligible-route-in-bounded-scope-proven') {
      fail('CandidateSearchResult no-eligible-route terminal is inconsistent');
    }
  } else if (termination === 'unresolved-constraint-evidence') {
    if (status !== 'completed' || count >= requested || routeSearch !== 'complete-within-bounds'
      || budgetOutcome !== 'within-budget' || !hasConstraints
      || constraintOutcome !== 'unresolved-evidence') {
      fail('CandidateSearchResult unresolved-constraint terminal is inconsistent');
    }
  } else if (termination === 'search-budget-exhausted') {
    if (status !== 'stopped' || count >= requested || routeSearch !== 'not-proven'
      || budgetOutcome !== 'exhausted'
      || (hasConstraints
        && constraintOutcome === 'no-eligible-route-in-bounded-scope-proven')) {
      fail('CandidateSearchResult search-budget terminal is inconsistent');
    }
  }
}

export function admitRouteCandidateSearchResult(raw) {
  const value = exactObject(raw, 'CandidateSearchResult', [
    'schemaVersion',
    'status',
    'termination',
    'request',
    'candidateSet',
    'candidateFacts',
  ]);
  if (value.schemaVersion !== ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchResult) {
    fail('CandidateSearchResult.schemaVersion is unsupported');
  }
  const status = exactEnum(value.status, RESULT_STATUS_SET, 'CandidateSearchResult.status');
  const termination = exactEnum(
    value.termination,
    TERMINATION_SET,
    'CandidateSearchResult.termination',
  );
  const request = value.request === null ? null : admitRouteCandidateSearchRequest(value.request);
  const candidateSet = value.candidateSet === null ? null : admitCandidateSetV2(value.candidateSet);
  const candidateFacts = strictArray(
    value.candidateFacts,
    'CandidateSearchResult.candidateFacts',
    { max: MAX_REQUESTED_CANDIDATES },
  ).map((candidate) => admitRouteCandidateFacts(candidate));

  if (request && candidateSet) {
    const requestConstraintIds = request.hardConstraints.map(({ constraintId }) => constraintId);
    const sameConstraintIds = requestConstraintIds.length === candidateSet.searchConstraintIds.length
      && requestConstraintIds.every((id, index) => candidateSet.searchConstraintIds[index] === id);
    if (candidateSet.requestId !== request.requestId
      || candidateSet.graphId !== request.graphId
      || candidateSet.objectiveFactorId !== request.objectiveFactorId
      || candidateSet.requestedCandidateCount !== request.requestedCandidateCount
      || candidateSet.routeDistinctnessVersion !== request.routeDistinctnessVersion
      || candidateSet.tieBreakVersion !== request.tieBreakVersion
      || !sameBounds(candidateSet.bounds, request.bounds)
      || !sameConstraintIds) {
      fail('CandidateSearchResult candidateSet must exactly bind the admitted request');
    }
    assertCandidateFactsConsistency(request, candidateSet, candidateFacts);
  } else if (candidateSet || candidateFacts.length) {
    fail('CandidateSearchResult candidates require both request and candidateSet');
  }

  assertTerminalConsistency(status, termination, request, candidateSet, candidateFacts);

  return deepFreeze({
    schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchResult,
    status,
    termination,
    request,
    candidateSet,
    candidateFacts,
  });
}
