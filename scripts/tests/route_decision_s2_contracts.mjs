#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitCandidateSet,
  admitRouteRequest,
} from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_DECISIONS,
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_RESULT_STATUSES,
  ROUTE_SEARCH_TERMINATIONS,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
  admitCandidateSetV2,
  admitRouteCandidateSearchRequest,
  admitRouteCandidateSearchResult,
} from '../../src/route_decision/contracts/candidate_search_v2.js';

const S2_VERSION = ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS;
const V1_VERSION = ROUTE_DECISION_SCHEMA_VERSIONS;

const REASON_BY_STATE = {
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
};

function searchConstraint(overrides = {}) {
  return {
    constraintId: 'requires-step-free',
    factorId: 'step-free',
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
    unresolvedDisposition: 'exclude-and-report',
    ...overrides,
  };
}

function searchRequest(overrides = {}) {
  return {
    schemaVersion: S2_VERSION.searchRequest,
    requestId: 'search-request-1',
    graphId: 'graph-fixture-1',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: 'distance-first-v1',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 2,
    routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
    tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
    bounds: {
      maxExpandedStates: 1_000,
      maxRouteEdgeCount: 12,
    },
    hardConstraints: [],
    ...overrides,
  };
}

function sourceObservation(factorId, state = 'observed', value = true) {
  const unit = factorId === 'stairs-count' ? 'count' : 'boolean';
  if (state === 'observed') {
    return {
      schemaVersion: V1_VERSION.sourceObservation,
      factorId,
      state,
      value,
      unit,
      reasonCode: null,
      sourceId: 'synthetic-s2-fixture',
    };
  }
  if (state === 'zero') {
    return {
      schemaVersion: V1_VERSION.sourceObservation,
      factorId,
      state,
      value: 0,
      unit,
      reasonCode: null,
      sourceId: 'synthetic-s2-fixture',
    };
  }
  return {
    schemaVersion: V1_VERSION.sourceObservation,
    factorId,
    state,
    value: null,
    unit,
    reasonCode: REASON_BY_STATE[state],
    sourceId: 'synthetic-s2-fixture',
  };
}

function candidate(candidateId, edgeIds, objectiveCostUnits, overrides = {}) {
  return {
    schemaVersion: V1_VERSION.routeCandidateFacts,
    candidateId,
    edgeIds,
    distanceMm: objectiveCostUnits * 2,
    objectiveCostUnits,
    observations: {},
    provenance: {
      graphId: 'graph-fixture-1',
      dataClassification: 'synthetic',
    },
    ...overrides,
  };
}

function candidateSetFor(request, candidates, overrides = {}) {
  const constraintIds = request.hardConstraints.map(({ constraintId }) => constraintId);
  return {
    schemaVersion: S2_VERSION.candidateSet,
    candidateSetId: 'candidate-set-1',
    candidateSetRevision: 'fixture-graph-v1',
    requestId: request.requestId,
    graphId: request.graphId,
    strategy: 'bounded-loopless-k-candidates',
    objectiveFactorId: request.objectiveFactorId,
    requestedCandidateCount: request.requestedCandidateCount,
    candidateIds: candidates.map(({ candidateId }) => candidateId),
    candidateCount: candidates.length,
    routeDistinctnessVersion: request.routeDistinctnessVersion,
    searchConstraintIds: constraintIds,
    constraintAggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
    tieBreakVersion: request.tieBreakVersion,
    bounds: structuredClone(request.bounds),
    expandedStateCount: Math.floor(request.bounds.maxExpandedStates / 2),
    completeness: {
      routeSearch: 'not-proven',
      scope: 'loopless-directed-routes-within-max-route-edge-count',
    },
    constraintOutcome: constraintIds.length
      ? 'eligible-candidates-returned'
      : 'not-required',
    budgetOutcome: 'within-budget',
    ...overrides,
  };
}

function searchResult(overrides = {}) {
  const request = searchRequest();
  const candidates = [
    candidate('candidate-a', ['a-b', 'b-d'], 10),
    candidate('candidate-b', ['a-c', 'c-d'], 20),
  ];
  return {
    schemaVersion: S2_VERSION.searchResult,
    status: 'completed',
    termination: 'requested-candidate-count-reached',
    request,
    candidateSet: candidateSetFor(request, candidates),
    candidateFacts: candidates,
    ...overrides,
  };
}

function terminalResult(termination) {
  if (termination === 'invalid-input') {
    return searchResult({
      status: 'rejected',
      termination,
      request: null,
      candidateSet: null,
      candidateFacts: [],
    });
  }
  const constrained = [
    'no-eligible-route-in-bounded-scope',
    'unresolved-constraint-evidence',
  ].includes(termination);
  const request = searchRequest({
    requestedCandidateCount: 3,
    hardConstraints: constrained ? [searchConstraint()] : [],
  });
  if (termination === 'endpoint-unavailable') {
    return searchResult({
      status: 'not-started',
      termination,
      request,
      candidateSet: null,
      candidateFacts: [],
    });
  }
  const hasCandidate = [
    'bounded-search-space-exhausted',
    'search-budget-exhausted',
    'search-capacity-exhausted',
  ].includes(termination);
  const candidates = hasCandidate
    ? [candidate('candidate-a', ['a-b', 'b-d'], 10)]
    : [];
  const constraintOutcome = termination === 'no-eligible-route-in-bounded-scope'
    ? 'no-eligible-route-in-bounded-scope-proven'
    : termination === 'unresolved-constraint-evidence'
      ? 'unresolved-evidence'
      : termination === 'no-directed-route-in-bounded-scope' && constrained
        ? 'not-evaluated'
        : 'not-required';
  const candidateSet = candidateSetFor(request, candidates, {
    completeness: {
      routeSearch: ['search-budget-exhausted', 'search-capacity-exhausted'].includes(termination)
        ? 'not-proven'
        : 'complete-within-bounds',
      scope: 'loopless-directed-routes-within-max-route-edge-count',
    },
    constraintOutcome,
    budgetOutcome: termination === 'search-budget-exhausted'
      ? 'exhausted'
      : termination === 'search-capacity-exhausted'
        ? 'capacity-exhausted'
        : 'within-budget',
    expandedStateCount: termination === 'search-budget-exhausted'
      ? request.bounds.maxExpandedStates
      : Math.floor(request.bounds.maxExpandedStates / 2),
  });
  return searchResult({
    status: ['search-budget-exhausted', 'search-capacity-exhausted'].includes(termination)
      ? 'stopped'
      : 'completed',
    termination,
    request,
    candidateSet,
    candidateFacts: candidates,
  });
}

test('S2 versions and the six semantic decisions are exact, separate, and immutable', () => {
  assert.deepEqual(S2_VERSION, {
    searchRequest: 'engagement-route-candidate-search-request/v1',
    candidateSet: 'engagement-route-candidate-set/v2',
    searchResult: 'engagement-route-candidate-search-result/v1',
  });
  assert.deepEqual(ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS, [
    'step-free', 'curb-ramp-present', 'paved-surface',
  ]);
  assert.deepEqual(ROUTE_SEARCH_RESULT_STATUSES, [
    'rejected', 'not-started', 'completed', 'stopped',
  ]);
  assert.deepEqual(ROUTE_SEARCH_TERMINATIONS, [
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
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.requestedK.meaning,
    'maximum-requested-not-guaranteed');
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.requestedK.includesPrimary, true);
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.requestedK.returnedShape,
    'finalized-ordered-prefix');
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.directedRouteDistinctness.geometryDefinesIdentity,
    false);
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.searchAdmissibleHardConstraints.locality,
    'edge-local');
  assert.equal(
    ROUTE_CANDIDATE_SEARCH_DECISIONS.searchAdmissibleHardConstraints.edgeEvidenceRequirement,
    'complete',
  );
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.boundedCompleteness.budgetExhaustedIsComplete,
    false);
  assert.deepEqual(ROUTE_CANDIDATE_SEARCH_DECISIONS.tieBreakVersioning.keys, [
    { key: 'objectiveCostUnits', order: 'ascending' },
    {
      key: 'directedEdgeIdSequence',
      order: 'locale-independent-code-unit-lexicographic',
    },
  ]);
  assert.equal(ROUTE_CANDIDATE_SEARCH_DECISIONS.tieBreakVersioning.distanceParticipates, false);
  assert.equal(Object.isFrozen(ROUTE_CANDIDATE_SEARCH_DECISIONS), true);
  assert.equal(Object.isFrozen(ROUTE_CANDIDATE_SEARCH_DECISIONS.tieBreakVersioning.keys[0]), true);
});

test('v1 request and CandidateSet retain exact version map and serialized behavior', () => {
  assert.deepEqual(V1_VERSION, {
    graphArtifact: 'engagement-route-graph/v1',
    routeRequest: 'engagement-route-request/v1',
    routeCandidateFacts: 'engagement-route-candidate-facts/v1',
    candidateSet: 'engagement-route-candidate-set/v1',
    sourceObservation: 'engagement-route-source-observation/v1',
    travelNeedCatalog: 'engagement-travel-need-catalog/v1',
    decisionPolicy: 'engagement-route-decision-policy/v1',
    decisionResult: 'engagement-route-decision-result/v1',
    scenarioRunManifest: 'engagement-route-scenario-run-manifest/v1',
    boundary: 'engagement-route-decision-boundary/v1',
  });
  const v1Request = {
    schemaVersion: V1_VERSION.routeRequest,
    requestId: 'request-1',
    graphId: 'graph-fixture-1',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: 'distance-first-v1',
    maxCandidateCount: 3,
  };
  const v1Set = {
    schemaVersion: V1_VERSION.candidateSet,
    candidateSetId: 'candidate-set-1',
    candidateSetRevision: 'fixture-graph-v1',
    requestId: 'request-1',
    graphId: 'graph-fixture-1',
    strategy: 'base-objective-only',
    objectiveFactorId: 'objective-cost-units',
    candidateIds: ['candidate-a'],
    candidateCount: 1,
    completeness: 'incomplete',
    constraintAwareSearch: false,
    limitations: [
      'only-base-objective-candidate-generated',
      'constraint-aware-alternative-search-not-performed',
    ],
  };
  assert.equal(JSON.stringify(admitRouteRequest(v1Request)), JSON.stringify(v1Request));
  assert.equal(JSON.stringify(admitCandidateSet(v1Set)), JSON.stringify(v1Set));
  assert.throws(
    () => admitCandidateSet({ ...v1Set, schemaVersion: S2_VERSION.candidateSet }),
    /schemaVersion is unsupported/,
  );
});

test('every S2 public contract rejects missing and future schema versions', () => {
  const validResult = searchResult();
  const cases = [
    [admitRouteCandidateSearchRequest, validResult.request],
    [admitCandidateSetV2, validResult.candidateSet],
    [admitRouteCandidateSearchResult, validResult],
  ];
  for (const [validator, input] of cases) {
    const missing = structuredClone(input);
    delete missing.schemaVersion;
    assert.throws(() => validator(missing), /missing: schemaVersion/);

    const future = structuredClone(input);
    future.schemaVersion = `${input.schemaVersion}-future`;
    assert.throws(() => validator(future), /schemaVersion is unsupported/);
  }
});

test('CandidateSearchRequest separates requested K, bounds, distinctness, and tie-break versions', () => {
  const input = searchRequest();
  const before = structuredClone(input);
  const admitted = admitRouteCandidateSearchRequest(input);
  assert.deepEqual(input, before);
  assert.deepEqual(admitted, input);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.bounds), true);

  for (const requestedCandidateCount of [0, 17, 1.5, NaN, -0]) {
    assert.throws(
      () => admitRouteCandidateSearchRequest(searchRequest({ requestedCandidateCount })),
      /requestedCandidateCount/,
    );
  }
  assert.throws(
    () => admitRouteCandidateSearchRequest(searchRequest({
      routeDistinctnessVersion: 'rendered-geometry/v1',
    })),
    /routeDistinctnessVersion is unsupported/,
  );
  assert.throws(
    () => admitRouteCandidateSearchRequest(searchRequest({ tieBreakVersion: 'hop-count/v1' })),
    /tieBreakVersion is unsupported/,
  );
  assert.throws(
    () => admitRouteCandidateSearchRequest(searchRequest({
      bounds: { maxExpandedStates: 0, maxRouteEdgeCount: 12 },
    })),
    /maxExpandedStates/,
  );
  assert.throws(
    () => admitRouteCandidateSearchRequest({ ...searchRequest(), latitude: 39.95 }),
    /unknown: latitude/,
  );
});

test('only complete edge-local positive capability constraints are search-admissible', () => {
  const request = searchRequest({ hardConstraints: [searchConstraint()] });
  const admitted = admitRouteCandidateSearchRequest(request);
  assert.deepEqual(admitted.hardConstraints[0], searchConstraint());
  assert.equal(Object.isFrozen(admitted.hardConstraints[0].unresolvedStates), true);

  for (const [field, value, pattern] of [
    ['factorId', 'stairs-count', /factorId is unsupported/],
    ['locality', 'path-level', /locality must be edge-local/],
    ['edgeEvidenceRequirement', 'partial', /edgeEvidenceRequirement must be complete/],
    ['operator', 'not-equals', /operator must be equals/],
    ['expectedValue', false, /expectedValue must be true/],
    ['routeAggregation', 'any-edge', /routeAggregation must be every-directed-edge/],
    ['aggregationVersion', 'naive-edge-pruning/v1', /aggregationVersion is unsupported/],
    ['unresolvedDisposition', 'pass', /unresolvedDisposition must be exclude-and-report/],
  ]) {
    assert.throws(
      () => admitRouteCandidateSearchRequest(searchRequest({
        hardConstraints: [searchConstraint({ [field]: value })],
      })),
      pattern,
    );
  }
  const weakened = searchConstraint();
  weakened.unresolvedStates = weakened.unresolvedStates.filter((state) => state !== 'missing');
  assert.throws(
    () => admitRouteCandidateSearchRequest(searchRequest({ hardConstraints: [weakened] })),
    /length is outside the supported range|must exactly preserve/,
  );
  assert.throws(
    () => admitRouteCandidateSearchRequest(searchRequest({
      hardConstraints: [searchConstraint(), searchConstraint({ constraintId: 'duplicate-factor' })],
    })),
    /factorIds must be unique/,
  );

  const reversed = searchRequest({
    hardConstraints: [
      searchConstraint({
        constraintId: 'requires-paved',
        factorId: 'paved-surface',
      }),
      searchConstraint(),
    ],
  });
  const canonical = admitRouteCandidateSearchRequest(reversed);
  assert.deepEqual(
    canonical.hardConstraints.map(({ factorId }) => factorId),
    ['step-free', 'paved-surface'],
  );
  assert.deepEqual(
    canonical.hardConstraints.map(({ constraintId }) => constraintId),
    ['requires-step-free', 'requires-paved'],
  );
  assert.deepEqual(
    reversed.hardConstraints.map(({ factorId }) => factorId),
    ['paved-surface', 'step-free'],
  );
});

test('SearchResult binds CandidateSet constraint IDs to canonical factor order', () => {
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [
      searchConstraint({
        constraintId: 'requires-paved',
        factorId: 'paved-surface',
      }),
      searchConstraint(),
    ],
  });
  const eligible = candidate('candidate-a', ['a-b', 'b-d'], 10, {
    observations: {
      'step-free': sourceObservation('step-free'),
      'paved-surface': sourceObservation('paved-surface'),
    },
  });
  const canonicalSet = candidateSetFor(request, [eligible], {
    searchConstraintIds: ['requires-step-free', 'requires-paved'],
  });
  const admitted = admitRouteCandidateSearchResult(searchResult({
    request,
    candidateSet: canonicalSet,
    candidateFacts: [eligible],
  }));
  assert.deepEqual(
    admitted.request.hardConstraints.map(({ factorId }) => factorId),
    ['step-free', 'paved-surface'],
  );
  assert.deepEqual(
    admitted.candidateSet.searchConstraintIds,
    ['requires-step-free', 'requires-paved'],
  );

  const callerOrderedSet = candidateSetFor(request, [eligible]);
  assert.throws(
    () => admitRouteCandidateSearchResult(searchResult({
      request,
      candidateSet: callerOrderedSet,
      candidateFacts: [eligible],
    })),
    /candidateSet must exactly bind the admitted request/,
  );
});

test('CandidateSet v2 keeps requested and returned counts separate and binds bounded completeness', () => {
  const request = searchRequest({ requestedCandidateCount: 3 });
  const candidates = [candidate('candidate-a', ['a-b', 'b-d'], 10)];
  const input = candidateSetFor(request, candidates);
  const admitted = admitCandidateSetV2(input);
  assert.equal(admitted.requestedCandidateCount, 3);
  assert.equal(admitted.candidateCount, 1);
  assert.equal(admitted.expandedStateCount, 500);
  assert.equal(admitted.completeness.routeSearch, 'not-proven');
  assert.equal(Object.isFrozen(admitted.candidateIds), true);

  assert.throws(
    () => admitCandidateSetV2({ ...input, candidateCount: 2 }),
    /candidateCount must equal candidateIds length/,
  );
  assert.throws(
    () => admitCandidateSetV2({
      ...input,
      candidateIds: ['candidate-a', 'candidate-b', 'candidate-c', 'candidate-d'],
      candidateCount: 4,
    }),
    /length is outside the supported range/,
  );
  assert.throws(
    () => admitCandidateSetV2({
      ...input,
      constraintOutcome: 'eligible-candidates-returned',
    }),
    /must be not-required without search constraints/,
  );
  assert.throws(
    () => admitCandidateSetV2({ ...input, expandedStateCount: 1_001 }),
    /expandedStateCount/,
  );
  assert.throws(
    () => admitCandidateSetV2({
      ...input,
      budgetOutcome: 'exhausted',
      expandedStateCount: 999,
    }),
    /must reach maxExpandedStates/,
  );
});

test('SearchResult enforces directed-edge-sequence distinctness and versioned candidate order', () => {
  const admitted = admitRouteCandidateSearchResult(searchResult());
  assert.deepEqual(admitted.candidateSet.candidateIds, ['candidate-a', 'candidate-b']);
  assert.equal(Object.isFrozen(admitted.candidateFacts[0].edgeIds), true);

  const duplicate = searchResult();
  duplicate.candidateFacts[1].edgeIds = [...duplicate.candidateFacts[0].edgeIds];
  assert.throws(
    () => admitRouteCandidateSearchResult(duplicate),
    /distinct ordered directed edge ID sequences/,
  );

  const reversed = searchResult();
  reversed.candidateFacts.reverse();
  reversed.candidateSet.candidateIds.reverse();
  assert.throws(
    () => admitRouteCandidateSearchResult(reversed),
    /versioned search tie-break order/,
  );

  const edgeTieBreak = searchResult();
  edgeTieBreak.candidateFacts[1].objectiveCostUnits = 10;
  edgeTieBreak.candidateFacts[1].distanceMm = 1;
  assert.deepEqual(
    admitRouteCandidateSearchResult(edgeTieBreak).candidateSet.candidateIds,
    ['candidate-a', 'candidate-b'],
  );
});

test('constraint evidence cannot silently pass on returned candidates', () => {
  const request = searchRequest({ hardConstraints: [searchConstraint()] });
  const validCandidate = candidate('candidate-a', ['a-b', 'b-d'], 10, {
    observations: { 'step-free': sourceObservation('step-free') },
  });
  const validResult = searchResult({
    request,
    candidateSet: candidateSetFor(request, [validCandidate], {
      completeness: {
        routeSearch: 'not-proven',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
      constraintOutcome: 'eligible-candidates-returned',
    }),
    candidateFacts: [validCandidate],
  });
  validResult.request.requestedCandidateCount = 1;
  validResult.candidateSet.requestedCandidateCount = 1;
  assert.equal(admitRouteCandidateSearchResult(validResult).candidateFacts.length, 1);

  const unresolvedStates = ['unknown', 'unavailable', 'partial', 'stale', 'invalid'];
  for (const state of unresolvedStates) {
    const invalid = structuredClone(validResult);
    invalid.candidateFacts[0].observations['step-free'] = sourceObservation('step-free', state);
    assert.throws(
      () => admitRouteCandidateSearchResult(invalid),
      /must resolve step-free as observed true/,
    );
  }
  const missing = structuredClone(validResult);
  delete missing.candidateFacts[0].observations['step-free'];
  assert.throws(
    () => admitRouteCandidateSearchResult(missing),
    /must resolve step-free as observed true/,
  );
  const observedFalse = structuredClone(validResult);
  observedFalse.candidateFacts[0].observations['step-free'] = sourceObservation(
    'step-free',
    'observed',
    false,
  );
  assert.throws(
    () => admitRouteCandidateSearchResult(observedFalse),
    /must resolve step-free as observed true/,
  );
});

test('observed zero remains a fact and is not collapsed into missing or unresolved', () => {
  const result = searchResult();
  result.candidateFacts[0].observations['stairs-count'] = sourceObservation('stairs-count', 'zero');
  const admitted = admitRouteCandidateSearchResult(result);
  assert.equal(admitted.candidateFacts[0].observations['stairs-count'].state, 'zero');
  assert.equal(admitted.candidateFacts[0].observations['stairs-count'].value, 0);
  assert.equal(admitted.termination, 'requested-candidate-count-reached');
});

test('unresolved source states and a missing key remain distinct in unconstrained results', () => {
  for (const state of ['unknown', 'unavailable', 'partial', 'stale', 'invalid']) {
    const result = searchResult();
    result.candidateFacts[0].observations['step-free'] = sourceObservation('step-free', state);
    const admitted = admitRouteCandidateSearchResult(result);
    assert.equal(admitted.candidateFacts[0].observations['step-free'].state, state);
    assert.equal(
      admitted.candidateFacts[0].observations['step-free'].reasonCode,
      REASON_BY_STATE[state],
    );
  }
  const missing = admitRouteCandidateSearchResult(searchResult());
  assert.equal(Object.hasOwn(missing.candidateFacts[0].observations, 'step-free'), false);
});

test('candidate edge sequences must respect the declared bound and endpoint shape', () => {
  const overBound = searchResult();
  overBound.request.bounds.maxRouteEdgeCount = 1;
  overBound.candidateSet.bounds.maxRouteEdgeCount = 1;
  assert.throws(
    () => admitRouteCandidateSearchResult(overBound),
    /exceeds request maxRouteEdgeCount/,
  );

  const emptyForDistinctEndpoints = searchResult();
  emptyForDistinctEndpoints.candidateFacts[0].edgeIds = [];
  emptyForDistinctEndpoints.candidateFacts[0].distanceMm = 0;
  emptyForDistinctEndpoints.candidateFacts[0].objectiveCostUnits = 0;
  assert.throws(
    () => admitRouteCandidateSearchResult(emptyForDistinctEndpoints),
    /distinct endpoints require a non-empty edge sequence/,
  );

  const request = searchRequest({
    originNodeId: 'a',
    destinationNodeId: 'a',
    requestedCandidateCount: 1,
  });
  const sameEndpointCandidate = candidate('candidate-a', [], 0, { distanceMm: 0 });
  const valid = searchResult({
    request,
    candidateSet: candidateSetFor(request, [sameEndpointCandidate]),
    candidateFacts: [sameEndpointCandidate],
  });
  assert.equal(admitRouteCandidateSearchResult(valid).candidateFacts[0].edgeIds.length, 0);

  sameEndpointCandidate.edgeIds = ['a-b'];
  sameEndpointCandidate.distanceMm = 1;
  sameEndpointCandidate.objectiveCostUnits = 1;
  assert.throws(
    () => admitRouteCandidateSearchResult({
      ...valid,
      candidateFacts: [sameEndpointCandidate],
    }),
    /same-endpoint candidate must use an empty edge sequence/,
  );
});

test('terminal causes remain mechanically separate from process status', () => {
  for (const termination of [
    'invalid-input',
    'endpoint-unavailable',
    'bounded-search-space-exhausted',
    'no-directed-route-in-bounded-scope',
    'no-eligible-route-in-bounded-scope',
    'unresolved-constraint-evidence',
    'search-budget-exhausted',
    'search-capacity-exhausted',
  ]) {
    const admitted = admitRouteCandidateSearchResult(terminalResult(termination));
    assert.equal(admitted.termination, termination);
  }
  assert.equal(terminalResult('no-eligible-route-in-bounded-scope').status, 'completed');
  assert.equal(terminalResult('unresolved-constraint-evidence').status, 'completed');
  assert.equal(terminalResult('search-budget-exhausted').status, 'stopped');
  assert.equal(terminalResult('search-capacity-exhausted').status, 'stopped');

  const collapsed = terminalResult('search-budget-exhausted');
  collapsed.termination = 'no-eligible-route-in-bounded-scope';
  assert.throws(
    () => admitRouteCandidateSearchResult(collapsed),
    /no-eligible-route terminal is inconsistent/,
  );

  const request = searchRequest({
    requestedCandidateCount: 3,
    hardConstraints: [searchConstraint()],
  });
  const unresolvedAtBudget = searchResult({
    status: 'stopped',
    termination: 'search-budget-exhausted',
    request,
    candidateSet: candidateSetFor(request, [], {
      completeness: {
        routeSearch: 'not-proven',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
      constraintOutcome: 'unresolved-evidence',
      budgetOutcome: 'exhausted',
      expandedStateCount: request.bounds.maxExpandedStates,
    }),
    candidateFacts: [],
  });
  const admitted = admitRouteCandidateSearchResult(unresolvedAtBudget);
  assert.equal(admitted.termination, 'search-budget-exhausted');
  assert.equal(admitted.candidateSet.constraintOutcome, 'unresolved-evidence');
  assert.equal(admitted.candidateSet.budgetOutcome, 'exhausted');
});

test('bounded-search-space and bounded no-route terminals remain exclusive', () => {
  const emptyExhausted = terminalResult('bounded-search-space-exhausted');
  emptyExhausted.candidateSet.candidateIds = [];
  emptyExhausted.candidateSet.candidateCount = 0;
  emptyExhausted.candidateFacts = [];
  assert.throws(
    () => admitRouteCandidateSearchResult(emptyExhausted),
    /bounded-search-space terminal is inconsistent/,
  );

  const boundedNoRoute = admitRouteCandidateSearchResult(
    terminalResult('no-directed-route-in-bounded-scope'),
  );
  assert.equal(boundedNoRoute.candidateSet.candidateCount, 0);
  assert.equal(boundedNoRoute.termination, 'no-directed-route-in-bounded-scope');
});

test('complete/no-route/no-eligible claims require their exact proof and evidence states', () => {
  const budgetAsComplete = terminalResult('search-budget-exhausted');
  budgetAsComplete.candidateSet.completeness.routeSearch = 'complete-within-bounds';
  assert.throws(
    () => admitRouteCandidateSearchResult(budgetAsComplete),
    /exhausted budget cannot claim complete bounded search|search-budget terminal is inconsistent/,
  );

  const budgetMarkedAvailable = terminalResult('search-budget-exhausted');
  budgetMarkedAvailable.candidateSet.budgetOutcome = 'within-budget';
  assert.throws(
    () => admitRouteCandidateSearchResult(budgetMarkedAvailable),
    /search-budget terminal is inconsistent/,
  );

  const budgetBelowDeclaredMaximum = terminalResult('search-budget-exhausted');
  budgetBelowDeclaredMaximum.candidateSet.expandedStateCount -= 1;
  assert.throws(
    () => admitRouteCandidateSearchResult(budgetBelowDeclaredMaximum),
    /exhausted budget must reach maxExpandedStates/,
  );

  const noEligibleUnproven = terminalResult('no-eligible-route-in-bounded-scope');
  noEligibleUnproven.candidateSet.completeness.routeSearch = 'not-proven';
  assert.throws(
    () => admitRouteCandidateSearchResult(noEligibleUnproven),
    /proven no-eligible outcome requires complete bounded search|no-eligible-route terminal is inconsistent/,
  );

  const unresolvedAsResolved = terminalResult('unresolved-constraint-evidence');
  unresolvedAsResolved.candidateSet.constraintOutcome =
    'no-eligible-route-in-bounded-scope-proven';
  assert.throws(
    () => admitRouteCandidateSearchResult(unresolvedAsResolved),
    /unresolved-constraint terminal is inconsistent/,
  );

  const reached = searchResult();
  reached.candidateSet.completeness.routeSearch = 'complete-within-bounds';
  assert.throws(
    () => admitRouteCandidateSearchResult(reached),
    /requested-count terminal is inconsistent/,
  );
});

test('SearchResult exactly binds request, CandidateSet, candidate IDs, graph, bounds, and constraints', () => {
  for (const mutate of [
    (value) => { value.candidateSet.requestId = 'other-request'; },
    (value) => { value.candidateSet.graphId = 'other-graph'; },
    (value) => { value.candidateSet.requestedCandidateCount = 3; },
    (value) => { value.candidateSet.bounds.maxExpandedStates += 1; },
    (value) => { value.candidateSet.candidateIds[0] = 'wrong-candidate'; },
    (value) => { value.candidateFacts[0].provenance.graphId = 'other-graph'; },
  ]) {
    const invalid = searchResult();
    mutate(invalid);
    assert.throws(() => admitRouteCandidateSearchResult(invalid), TypeError);
  }
});

test('S2 admissions reject accessors, prototypes, symbols, sparse arrays, and future fields without getter reads', () => {
  let requestReads = 0;
  const accessorRequest = searchRequest();
  Object.defineProperty(accessorRequest, 'requestedCandidateCount', {
    enumerable: true,
    get() { requestReads += 1; return 2; },
  });
  assert.throws(
    () => admitRouteCandidateSearchRequest(accessorRequest),
    /must contain data properties only/,
  );
  assert.equal(requestReads, 0);

  let candidateSetReads = 0;
  const accessorCandidateSet = searchResult().candidateSet;
  Object.defineProperty(accessorCandidateSet, 'budgetOutcome', {
    enumerable: true,
    get() { candidateSetReads += 1; return 'within-budget'; },
  });
  assert.throws(
    () => admitCandidateSetV2(accessorCandidateSet),
    /must contain data properties only/,
  );
  assert.equal(candidateSetReads, 0);

  let resultReads = 0;
  const accessorResult = searchResult();
  Object.defineProperty(accessorResult, 'termination', {
    enumerable: true,
    get() { resultReads += 1; return 'requested-candidate-count-reached'; },
  });
  assert.throws(
    () => admitRouteCandidateSearchResult(accessorResult),
    /must contain data properties only/,
  );
  assert.equal(resultReads, 0);

  let constraintReads = 0;
  const accessorConstraint = searchConstraint();
  Object.defineProperty(accessorConstraint, 'factorId', {
    enumerable: true,
    get() { constraintReads += 1; return 'step-free'; },
  });
  assert.throws(
    () => admitRouteCandidateSearchRequest(searchRequest({
      hardConstraints: [accessorConstraint],
    })),
    /must contain data properties only/,
  );
  assert.equal(constraintReads, 0);

  const sparse = searchRequest();
  sparse.hardConstraints = new Array(1);
  assert.throws(
    () => admitRouteCandidateSearchRequest(sparse),
    /must not contain sparse entries/,
  );

  const inherited = Object.create({ requestedCandidateCount: 2 });
  Object.assign(inherited, searchRequest());
  delete inherited.requestedCandidateCount;
  assert.throws(
    () => admitRouteCandidateSearchRequest(inherited),
    /must be a plain object/,
  );

  const symbol = searchRequest();
  symbol[Symbol('hidden')] = true;
  assert.throws(
    () => admitRouteCandidateSearchRequest(symbol),
    /symbol properties/,
  );

  assert.throws(
    () => admitRouteCandidateSearchResult({ ...searchResult(), globalComplete: true }),
    /unknown: globalComplete/,
  );
});

test('admitted S2 values are detached, deeply frozen copies', () => {
  const input = searchResult();
  const admitted = admitRouteCandidateSearchResult(input);
  input.request.bounds.maxExpandedStates = 7;
  input.candidateSet.candidateIds[0] = 'mutated-candidate';
  input.candidateFacts[0].edgeIds[0] = 'mutated-edge';
  assert.equal(admitted.request.bounds.maxExpandedStates, 1_000);
  assert.equal(admitted.candidateSet.candidateIds[0], 'candidate-a');
  assert.equal(admitted.candidateFacts[0].edgeIds[0], 'a-b');
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.request.hardConstraints), true);
  assert.equal(Object.isFrozen(admitted.candidateSet.completeness), true);
  assert.equal(Object.isFrozen(admitted.candidateFacts[0]), true);
});
