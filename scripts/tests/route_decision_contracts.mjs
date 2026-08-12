#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ROUTE_DECISION_BOUNDARY,
  DEFAULT_TRAVEL_NEED_CATALOG,
  FUNCTIONAL_NEED_TAGS,
  ROUTE_DECISION_SCHEMA_VERSIONS,
  ROUTE_OBSERVATION_STATES,
  UNRESOLVED_OBSERVATION_STATES,
  admitCandidateSet,
  admitDecisionPolicy,
  admitDecisionResult,
  admitGraphArtifact,
  admitRouteCandidateFacts,
  admitRouteDecisionBoundary,
  admitRouteRequest,
  admitScenarioRunManifest,
  admitSourceObservation,
  admitTravelNeedCatalog,
  assertPermittedConstraintInputTag,
  assertPermittedClaimTag,
  assertPermittedRankingInputTag,
} from '../../src/route_decision/contracts/index.js';

const VERSION = ROUTE_DECISION_SCHEMA_VERSIONS;

function sourceObservation(overrides = {}) {
  return {
    schemaVersion: VERSION.sourceObservation,
    factorId: 'step-free',
    state: 'observed',
    value: true,
    unit: 'boolean',
    reasonCode: null,
    sourceId: 'synthetic-fixture',
    ...overrides,
  };
}

function graphArtifact(overrides = {}) {
  return {
    schemaVersion: VERSION.graphArtifact,
    graphId: 'graph-fixture-1',
    mode: 'walk',
    directed: true,
    nodes: [
      { nodeId: 'a' },
      { nodeId: 'b' },
      { nodeId: 'c' },
    ],
    edges: [
      {
        edgeId: 'a-b',
        fromNodeId: 'a',
        toNodeId: 'b',
        distanceMm: 1_250,
        objectiveCostUnits: 1_300,
      },
      {
        edgeId: 'b-c',
        fromNodeId: 'b',
        toNodeId: 'c',
        distanceMm: 2_000,
        objectiveCostUnits: 2_100,
      },
    ],
    components: {
      kind: 'weakly-connected',
      count: 1,
      byNodeId: { a: 0, b: 0, c: 0 },
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: ['synthetic-fixture'],
    },
    receipt: {
      artifactVersion: 'fixture-graph-v1',
    },
    ...overrides,
  };
}

function routeRequest(overrides = {}) {
  return {
    schemaVersion: VERSION.routeRequest,
    requestId: 'request-1',
    graphId: 'graph-fixture-1',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'c',
    decisionPolicyId: 'distance-first-v1',
    maxCandidateCount: 3,
    ...overrides,
  };
}

function routeCandidate(overrides = {}) {
  return {
    schemaVersion: VERSION.routeCandidateFacts,
    candidateId: 'candidate-1',
    edgeIds: ['a-b', 'b-c'],
    geometry: {
      kind: 'synthetic-polyline-mm',
      coordinatesMm: [[0, 0], [1_250, 0], [3_250, 0]],
    },
    distanceMm: 3_250,
    objectiveCostUnits: 3_400,
    observations: {
      'step-free': sourceObservation(),
      'stairs-count': sourceObservation({
        factorId: 'stairs-count',
        state: 'zero',
        value: 0,
        unit: 'count',
      }),
    },
    provenance: {
      graphId: 'graph-fixture-1',
      dataClassification: 'synthetic',
    },
    ...overrides,
  };
}

function candidateSet(overrides = {}) {
  return {
    schemaVersion: VERSION.candidateSet,
    candidateSetId: 'candidate-set-1',
    candidateSetRevision: 'revision-1',
    requestId: 'request-1',
    graphId: 'graph-fixture-1',
    strategy: 'base-objective-only',
    objectiveFactorId: 'objective-cost-units',
    candidateIds: ['candidate-1'],
    candidateCount: 1,
    completeness: 'incomplete',
    constraintAwareSearch: false,
    limitations: [
      'only-base-objective-candidate-generated',
      'constraint-aware-alternative-search-not-performed',
    ],
    ...overrides,
  };
}

function candidateSetReference(overrides = {}) {
  return {
    schemaVersion: VERSION.candidateSet,
    candidateSetId: 'candidate-set-1',
    candidateSetRevision: 'revision-1',
    candidateIds: ['candidate-1'],
    candidateCount: 1,
    completeness: 'incomplete',
    ...overrides,
  };
}

function decisionPolicy(overrides = {}) {
  return {
    schemaVersion: VERSION.decisionPolicy,
    policyId: 'distance-first-v1',
    hardConstraints: [{
      constraintId: 'requires-step-free',
      needTag: 'require-capability',
      factorId: 'step-free',
      operator: 'equals',
      expectedValue: true,
      unresolvedStates: ['unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing'],
    }],
    softPreferences: [
      {
        preferenceId: 'distance',
        needTag: 'minimize-distance',
        factorId: 'distance-mm',
        operator: 'minimize',
        rangeMin: 0,
        rangeMax: 10_000,
        weightBasisPoints: 7_500,
      },
      {
        preferenceId: 'objective-cost',
        needTag: 'minimize-objective-cost',
        factorId: 'objective-cost-units',
        operator: 'minimize',
        rangeMin: 0,
        rangeMax: 10_000,
        weightBasisPoints: 2_500,
      },
    ],
    weightBasisPointsTotal: 10_000,
    tieBreak: [
      { factorId: 'score-units', direction: 'descending' },
      { factorId: 'objective-cost-units', direction: 'ascending' },
      { factorId: 'distance-mm', direction: 'ascending' },
      { factorId: 'candidate-id', direction: 'ascending' },
    ],
    ...overrides,
  };
}

function decisionResult(overrides = {}) {
  return {
    schemaVersion: VERSION.decisionResult,
    policyId: 'distance-first-v1',
    candidateSet: candidateSetReference(),
    status: 'ranked-in-provided-set',
    admittedCandidateIds: ['candidate-1'],
    rankedCandidateIds: ['candidate-1'],
    rejected: [],
    unresolved: [],
    trace: [
      {
        candidateId: 'candidate-1',
        stage: 'hard-constraint',
        constraintId: 'requires-step-free',
        factorId: 'step-free',
        observationState: 'observed',
        actualValue: true,
        operator: 'equals',
        expectedValue: true,
        outcome: 'pass',
        reasonCode: 'hard-constraint-passed',
      },
      {
        candidateId: 'candidate-1',
        stage: 'soft-preference',
        preferenceId: 'distance',
        factorId: 'distance-mm',
        observationState: 'observed',
        rawValue: 3_250,
        unit: 'millimetres',
        direction: 'minimize',
        rangeMin: 0,
        rangeMax: 10_000,
        rangeSpan: 10_000,
        utilityNumerator: 67_500_000,
        utilityBasisPoints: 6_750,
        weightBasisPoints: 7_500,
        weightedScoreUnits: 50_625_000,
        outcome: 'scored',
        reasonCode: 'soft-preference-scored',
      },
      {
        candidateId: 'candidate-1',
        stage: 'soft-preference',
        preferenceId: 'objective-cost',
        factorId: 'objective-cost-units',
        observationState: 'observed',
        rawValue: 3_400,
        unit: 'cost-units',
        direction: 'minimize',
        rangeMin: 0,
        rangeMax: 10_000,
        rangeSpan: 10_000,
        utilityNumerator: 66_000_000,
        utilityBasisPoints: 6_600,
        weightBasisPoints: 2_500,
        weightedScoreUnits: 16_500_000,
        outcome: 'scored',
        reasonCode: 'soft-preference-scored',
      },
      {
        candidateId: 'candidate-1',
        stage: 'candidate-disposition',
        outcome: 'admitted',
        constraintIds: [],
        preferenceIds: [],
        totalScoreUnits: 67_125_000,
        reasonCode: 'candidate-admitted',
      },
      {
        candidateId: 'candidate-1',
        stage: 'ranking',
        outcome: 'ranked',
        totalScoreUnits: 67_125_000,
        rank: 1,
        tieBreakValues: [
          { factorId: 'score-units', direction: 'descending', value: 67_125_000 },
          { factorId: 'objective-cost-units', direction: 'ascending', value: 3_400 },
          { factorId: 'distance-mm', direction: 'ascending', value: 3_250 },
          { factorId: 'candidate-id', direction: 'ascending', value: 'candidate-1' },
        ],
        decidingFactorId: null,
        reasonCode: 'candidate-ranked',
      },
    ],
    ...overrides,
  };
}

function scenarioRunManifest(overrides = {}) {
  return {
    schemaVersion: VERSION.scenarioRunManifest,
    seed: 20260812,
    graphId: 'graph-fixture-1',
    policyVersions: ['distance-first-v1'],
    fixtureSetVersion: 'golden-fixtures-v1',
    solverVersion: 'base-dijkstra-v1',
    expectedCaseCount: 10,
    ...overrides,
  };
}

test('contract versions and allowlists are exact and immutable', () => {
  assert.deepEqual(ROUTE_OBSERVATION_STATES, [
    'observed', 'zero', 'unknown', 'unavailable', 'partial', 'stale', 'invalid',
  ]);
  assert.deepEqual(FUNCTIONAL_NEED_TAGS, [
    'require-capability', 'minimize-distance', 'minimize-objective-cost',
  ]);
  assert.deepEqual(UNRESOLVED_OBSERVATION_STATES, [
    'unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing',
  ]);
  assert.equal(Object.isFrozen(VERSION), true);
  assert.equal(Object.isFrozen(ROUTE_OBSERVATION_STATES), true);
  assert.equal(Object.isFrozen(FUNCTIONAL_NEED_TAGS), true);
  assert.throws(() => { ROUTE_OBSERVATION_STATES.push('persona'); }, TypeError);
});

test('every public contract rejects missing and future schema versions', () => {
  const cases = [
    [admitGraphArtifact, graphArtifact()],
    [admitRouteRequest, routeRequest()],
    [admitRouteCandidateFacts, routeCandidate()],
    [admitCandidateSet, candidateSet()],
    [admitSourceObservation, sourceObservation()],
    [admitTravelNeedCatalog, structuredClone(DEFAULT_TRAVEL_NEED_CATALOG)],
    [admitDecisionPolicy, decisionPolicy()],
    [admitDecisionResult, decisionResult()],
    [admitScenarioRunManifest, scenarioRunManifest()],
    [admitRouteDecisionBoundary, structuredClone(DEFAULT_ROUTE_DECISION_BOUNDARY)],
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

test('GraphArtifact admits explicit directed integer topology without mutating caller input', () => {
  const input = graphArtifact();
  const before = structuredClone(input);
  const admitted = admitGraphArtifact(input);

  assert.deepEqual(input, before);
  assert.notEqual(admitted, input);
  assert.notEqual(admitted.nodes, input.nodes);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.edges[0]), true);
  assert.deepEqual(admitted.edges[0], {
    edgeId: 'a-b',
    fromNodeId: 'a',
    toNodeId: 'b',
    distanceMm: 1_250,
    objectiveCostUnits: 1_300,
  });

  input.edges[0].distanceMm = 99;
  assert.equal(admitted.edges[0].distanceMm, 1_250);
});

test('GraphArtifact rejects schema drift, non-directed graphs, bad quantities, and inconsistent references', () => {
  assert.throws(
    () => admitGraphArtifact(graphArtifact({ schemaVersion: 'engagement-route-graph/v2' })),
    /schemaVersion is unsupported/,
  );
  assert.throws(() => admitGraphArtifact(graphArtifact({ directed: false })), /directed must be true/);
  assert.throws(() => admitGraphArtifact({ ...graphArtifact(), safetyScore: 8 }), /unknown: safetyScore/);

  for (const distanceMm of [NaN, Infinity, -Infinity, -1, 1.5, -0]) {
    const input = graphArtifact();
    input.edges[0].distanceMm = distanceMm;
    assert.throws(() => admitGraphArtifact(input), /distanceMm/);
  }

  const dangling = graphArtifact();
  dangling.edges[0].toNodeId = 'missing';
  assert.throws(() => admitGraphArtifact(dangling), /unknown toNodeId/);

  const inconsistentComponent = graphArtifact();
  inconsistentComponent.components.byNodeId.b = 1;
  inconsistentComponent.components.count = 2;
  assert.throws(() => admitGraphArtifact(inconsistentComponent), /crosses declared components/);

  const falseConnectedComponent = graphArtifact();
  falseConnectedComponent.edges.pop();
  assert.throws(
    () => admitGraphArtifact(falseConnectedComponent),
    /components.count does not match explicit topology/,
  );

  const nonSyntheticSource = graphArtifact();
  nonSyntheticSource.provenance.sourceIds = ['crime'];
  assert.throws(() => admitGraphArtifact(nonSyntheticSource), /must identify a synthetic source/);
});

test('RouteRequest is node-id based and rejects unknown versions, modes, fields, and invalid counts', () => {
  const input = routeRequest();
  assert.deepEqual(admitRouteRequest(input), input);
  assert.throws(() => admitRouteRequest(routeRequest({ mode: 'drive' })), /mode is unsupported/);
  assert.throws(() => admitRouteRequest(routeRequest({ maxCandidateCount: 0 })), /maxCandidateCount/);
  assert.throws(
    () => admitRouteRequest({ ...routeRequest(), latitude: 39.95 }),
    /unknown: latitude/,
  );
  assert.throws(
    () => admitRouteRequest(routeRequest({ schemaVersion: 'engagement-route-request/v999' })),
    /schemaVersion is unsupported/,
  );
});

test('source observation states preserve observed zero, unknown, unavailable, partial, stale, and invalid', () => {
  const observedZero = admitSourceObservation(sourceObservation({
    factorId: 'stairs-count',
    state: 'zero',
    value: 0,
    unit: 'count',
  }));
  assert.equal(observedZero.state, 'zero');
  assert.equal(observedZero.value, 0);

  const reasons = {
    unknown: 'not-observed',
    unavailable: 'source-unavailable',
    partial: 'coverage-partial',
    stale: 'observation-stale',
    invalid: 'source-invalid',
  };
  for (const [state, reasonCode] of Object.entries(reasons)) {
    const admitted = admitSourceObservation(sourceObservation({
      state,
      value: null,
      reasonCode,
    }));
    assert.equal(admitted.state, state);
    assert.equal(admitted.value, null);
  }

  assert.throws(
    () => admitSourceObservation(sourceObservation({ state: 'unknown', value: 0, reasonCode: 'not-observed' })),
    /unknown must not carry a value/,
  );
  assert.throws(
    () => admitSourceObservation(sourceObservation({ factorId: 'safety-score' })),
    /factorId is unsupported/,
  );
  assert.throws(
    () => admitSourceObservation(sourceObservation({ state: 'missing' })),
    /state is unsupported/,
  );
  assert.throws(
    () => admitSourceObservation(sourceObservation({ state: 'UNKNOWN' })),
    /state is unsupported/,
  );
});

test('TravelNeedCatalog is complete, task-oriented, and cannot be weakened or extended with identity tags', () => {
  const admitted = admitTravelNeedCatalog(DEFAULT_TRAVEL_NEED_CATALOG);
  assert.deepEqual(admitted, DEFAULT_TRAVEL_NEED_CATALOG);
  assert.equal(Object.isFrozen(admitted.entries), true);

  const incomplete = structuredClone(DEFAULT_TRAVEL_NEED_CATALOG);
  incomplete.entries.pop();
  assert.throws(() => admitTravelNeedCatalog(incomplete), /must define every functional need tag/);

  const identityTag = structuredClone(DEFAULT_TRAVEL_NEED_CATALOG);
  identityTag.entries[0].tag = 'wheelchair-user';
  assert.throws(() => admitTravelNeedCatalog(identityTag), /tag is unsupported/);
});

test('DecisionPolicy requires exact operators, unresolved hard states, and 10000 total basis points', () => {
  const admitted = admitDecisionPolicy(decisionPolicy());
  assert.equal(admitted.weightBasisPointsTotal, 10_000);
  assert.deepEqual(admitted.softPreferences[0], {
    preferenceId: 'distance',
    needTag: 'minimize-distance',
    factorId: 'distance-mm',
    operator: 'minimize',
    rangeMin: 0,
    rangeMax: 10_000,
    weightBasisPoints: 7_500,
  });
  assert.equal(Object.isFrozen(admitted.hardConstraints[0].unresolvedStates), true);

  const wrongSum = decisionPolicy();
  wrongSum.softPreferences[0].weightBasisPoints = 7_499;
  assert.throws(() => admitDecisionPolicy(wrongSum), /must sum to 10000/);

  const fractionalWeight = decisionPolicy();
  fractionalWeight.softPreferences[0].weightBasisPoints = 7_499.5;
  fractionalWeight.softPreferences[1].weightBasisPoints = 2_500.5;
  assert.throws(() => admitDecisionPolicy(fractionalWeight), /weightBasisPoints must be an integer/);

  const unknownOperator = decisionPolicy();
  unknownOperator.softPreferences[0].operator = 'approximately-minimize';
  assert.throws(() => admitDecisionPolicy(unknownOperator), /operator is unsupported/);

  const sensitiveTag = decisionPolicy();
  sensitiveTag.hardConstraints[0].needTag = 'senior-person';
  assert.throws(() => admitDecisionPolicy(sensitiveTag), /needTag is unsupported/);

  const defaultPass = decisionPolicy();
  defaultPass.hardConstraints[0].unresolvedStates = [
    'unavailable', 'partial', 'stale', 'invalid', 'missing',
  ];
  assert.throws(() => admitDecisionPolicy(defaultPass), /unresolvedStates must exactly preserve/);

  const inferredFactor = decisionPolicy();
  delete inferredFactor.softPreferences[0].factorId;
  assert.throws(() => admitDecisionPolicy(inferredFactor), /missing: factorId/);

  const wrongFactor = decisionPolicy();
  wrongFactor.softPreferences[0].factorId = 'objective-cost-units';
  assert.throws(() => admitDecisionPolicy(wrongFactor), /factorId is unsupported for minimize-distance/);

  const invalidRange = decisionPolicy();
  invalidRange.softPreferences[0].rangeMax = invalidRange.softPreferences[0].rangeMin;
  assert.throws(() => admitDecisionPolicy(invalidRange), /normalization range must increase/);
});

test('CandidateSet freezes base-objective generation identity and incomplete-search metadata', () => {
  const input = candidateSet();
  const admitted = admitCandidateSet(input);
  assert.deepEqual(admitted, input);
  assert.equal(Object.isFrozen(admitted.candidateIds), true);
  assert.equal(Object.isFrozen(admitted.limitations), true);

  assert.throws(
    () => admitCandidateSet(candidateSet({ completeness: 'complete' })),
    /completeness must be incomplete/,
  );
  assert.throws(
    () => admitCandidateSet(candidateSet({ constraintAwareSearch: true })),
    /constraintAwareSearch must be false/,
  );
  assert.throws(
    () => admitCandidateSet(candidateSet({ candidateCount: 2 })),
    /candidateCount/,
  );
  assert.throws(
    () => admitCandidateSet(candidateSet({ strategy: 'constraint-aware-k-shortest' })),
    /strategy must be base-objective-only/,
  );
});

test('RouteCandidateFacts preserves physical distance, objective cost, source states, and synthetic-only geometry', () => {
  const input = routeCandidate();
  const admitted = admitRouteCandidateFacts(input);
  assert.equal(admitted.distanceMm, 3_250);
  assert.equal(admitted.objectiveCostUnits, 3_400);
  assert.equal(admitted.observations['stairs-count'].state, 'zero');
  assert.equal(Object.isFrozen(admitted.geometry.coordinatesMm[0]), true);

  assert.throws(
    () => admitRouteCandidateFacts(routeCandidate({ distanceMm: -1 })),
    /distanceMm/,
  );
  assert.throws(
    () => admitRouteCandidateFacts(routeCandidate({ objectiveCostUnits: Infinity })),
    /objectiveCostUnits/,
  );
  assert.throws(
    () => admitRouteCandidateFacts({ ...routeCandidate(), riskScore: 9 }),
    /unknown: riskScore/,
  );

  const unknownObservation = routeCandidate();
  unknownObservation.observations['crime-rate'] = sourceObservation();
  assert.throws(() => admitRouteCandidateFacts(unknownObservation), /observation tag is unsupported/);
});

test('DecisionResult round-trips policy, score contributions, rank, and actual tie-break values', () => {
  const input = decisionResult();
  const admitted = admitDecisionResult(input);
  assert.deepEqual(admitted, input);
  assert.equal(admitted.policyId, 'distance-first-v1');
  assert.equal(admitted.candidateSet.completeness, 'incomplete');
  assert.equal(admitted.trace[1].rawValue, 3_250);
  assert.equal(admitted.trace[1].weightedScoreUnits, 50_625_000);
  assert.equal(admitted.trace.at(-1).rank, 1);
  assert.deepEqual(admitted.trace.at(-1).tieBreakValues, [
    { factorId: 'score-units', direction: 'descending', value: 67_125_000 },
    { factorId: 'objective-cost-units', direction: 'ascending', value: 3_400 },
    { factorId: 'distance-mm', direction: 'ascending', value: 3_250 },
    { factorId: 'candidate-id', direction: 'ascending', value: 'candidate-1' },
  ]);
  assert.equal(Object.isFrozen(admitted.candidateSet.candidateIds), true);
  assert.equal(Object.isFrozen(admitted.trace.at(-1).tieBreakValues), true);

  const zero = decisionResult();
  Object.assign(zero.trace[1], {
    observationState: 'zero',
    rawValue: 0,
    utilityNumerator: 100_000_000,
    utilityBasisPoints: 10_000,
    weightedScoreUnits: 75_000_000,
  });
  zero.trace[3].totalScoreUnits = 91_500_000;
  zero.trace[4].totalScoreUnits = 91_500_000;
  zero.trace[4].tieBreakValues[0].value = 91_500_000;
  zero.trace[4].tieBreakValues[2].value = 0;
  assert.equal(admitDecisionResult(zero).trace[1].observationState, 'zero');
});

test('DecisionResult preserves hard rejection without implying complete constrained search', () => {
  const rejection = {
    candidateId: 'candidate-2',
    stage: 'hard-constraint',
    constraintId: 'requires-step-free',
    factorId: 'step-free',
    observationState: 'observed',
    actualValue: false,
    operator: 'equals',
    expectedValue: true,
    outcome: 'reject',
    reasonCode: 'hard-constraint-failed',
  };
  const rejectedOnly = decisionResult({
    candidateSet: candidateSetReference({
      candidateIds: ['candidate-2'],
      candidateCount: 1,
    }),
    status: 'no-eligible-candidate-in-provided-set',
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    rejected: [structuredClone(rejection)],
    trace: [
      rejection,
      {
        candidateId: 'candidate-2',
        stage: 'candidate-disposition',
        outcome: 'rejected',
        constraintIds: ['requires-step-free'],
        preferenceIds: [],
        totalScoreUnits: null,
        reasonCode: 'candidate-hard-constraint-rejected',
      },
    ],
  });
  assert.equal(
    admitDecisionResult(rejectedOnly).status,
    'no-eligible-candidate-in-provided-set',
  );

  for (const prohibitedStatus of [
    'no-feasible-route',
    'no-admitted-candidate',
  ]) {
    assert.throws(
      () => admitDecisionResult({ ...rejectedOnly, status: prohibitedStatus }),
      /status is unsupported/,
    );
  }
});

test('a missing candidate observation key remains missing and maps one-to-one to hard unresolved', () => {
  const facts = routeCandidate();
  delete facts.observations['step-free'];
  const admittedFacts = admitRouteCandidateFacts(facts);
  assert.equal(Object.hasOwn(admittedFacts.observations, 'step-free'), false);

  const missing = {
    candidateId: 'candidate-1',
    stage: 'hard-constraint',
    constraintId: 'requires-step-free',
    factorId: 'step-free',
    observationState: 'missing',
    actualValue: null,
    operator: 'equals',
    expectedValue: true,
    outcome: 'unresolved',
    reasonCode: 'hard-constraint-missing-unresolved',
  };
  const unresolved = decisionResult({
    status: 'candidate-search-incomplete',
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    unresolved: [structuredClone(missing)],
    trace: [
      missing,
      {
        candidateId: 'candidate-1',
        stage: 'candidate-disposition',
        outcome: 'unresolved',
        constraintIds: ['requires-step-free'],
        preferenceIds: [],
        totalScoreUnits: null,
        reasonCode: 'candidate-hard-constraint-unresolved',
      },
    ],
  });
  const admitted = admitDecisionResult(unresolved);
  assert.equal(admitted.unresolved[0].observationState, 'missing');
  assert.equal(admitted.unresolved[0].actualValue, null);

  const invalidPass = decisionResult();
  invalidPass.trace[0].observationState = 'unknown';
  assert.throws(
    () => admitDecisionResult(invalidPass),
    /observationState must be observed for pass/,
  );
});

test('DecisionResult expresses soft unresolved and rejects lossy or private trace identities', () => {
  const hardPass = structuredClone(decisionResult().trace[0]);
  const softUnresolved = {
    candidateId: 'candidate-1',
    stage: 'soft-preference',
    preferenceId: 'distance',
    factorId: 'distance-mm',
    observationState: 'unavailable',
    rawValue: null,
    unit: 'millimetres',
    direction: 'minimize',
    rangeMin: 0,
    rangeMax: 10_000,
    rangeSpan: 10_000,
    utilityNumerator: null,
    utilityBasisPoints: null,
    weightBasisPoints: 7_500,
    weightedScoreUnits: null,
    outcome: 'unresolved',
    reasonCode: 'soft-preference-unavailable-unresolved',
  };
  const unresolved = decisionResult({
    status: 'candidate-search-incomplete',
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    unresolved: [structuredClone(softUnresolved)],
    trace: [
      hardPass,
      softUnresolved,
      {
        candidateId: 'candidate-1',
        stage: 'candidate-disposition',
        outcome: 'unresolved',
        constraintIds: [],
        preferenceIds: ['distance'],
        totalScoreUnits: null,
        reasonCode: 'candidate-soft-preference-unresolved',
      },
    ],
  });
  assert.equal(admitDecisionResult(unresolved).unresolved[0].preferenceId, 'distance');

  const privateId = decisionResult();
  privateId.trace[0].ruleId = 'private-rule-0';
  assert.throws(() => admitDecisionResult(privateId), /unknown: ruleId/);

  const missingActual = decisionResult();
  delete missingActual.trace[0].actualValue;
  assert.throws(() => admitDecisionResult(missingActual), /missing: actualValue/);

  const wrongContribution = decisionResult();
  wrongContribution.trace[1].weightedScoreUnits += 1;
  assert.throws(() => admitDecisionResult(wrongContribution), /weightedScoreUnits is inconsistent/);
});

test('ScenarioRunManifest fixes reproducibility identities and integer case counts', () => {
  const input = scenarioRunManifest();
  assert.deepEqual(admitScenarioRunManifest(input), input);
  assert.throws(
    () => admitScenarioRunManifest({ ...input, expectedCaseCount: 1.5 }),
    /expectedCaseCount/,
  );
  assert.throws(
    () => admitScenarioRunManifest({ ...input, policyVersions: ['distance-first-v1', 'distance-first-v1'] }),
    /policyVersions must be unique/,
  );
});

test('boundary contract makes prohibited ranking inputs, claims, and private-data handling executable', () => {
  const admitted = admitRouteDecisionBoundary(DEFAULT_ROUTE_DECISION_BOUNDARY);
  assert.deepEqual(admitted, DEFAULT_ROUTE_DECISION_BOUNDARY);
  assert.equal(admitted.privacy.networkTransport, 'forbidden');
  assert.equal(admitted.privacy.routeGeometryPersistence, 'forbidden');
  assert.equal(admitted.privacy.privateDiaryData, 'excluded');
  assert.equal(admitted.privacy.sessionPreferenceStorage, 'forbidden');
  assert.equal(assertPermittedRankingInputTag('distance-mm'), 'distance-mm');
  assert.equal(assertPermittedConstraintInputTag('step-free'), 'step-free');
  assert.equal(assertPermittedClaimTag('contract-conformance'), 'contract-conformance');
  assert.throws(() => assertPermittedRankingInputTag('step-free'), /ranking input tag is unsupported/);

  for (const tag of [
    'crime', 'hin', 'acs', 'diary', 'real-estate-proxy', 'safety-score', 'safetyBySegmentId',
  ]) {
    assert.throws(() => assertPermittedRankingInputTag(tag), /ranking input tag is prohibited/);
  }
  for (const tag of ['safe-route', 'safer-route', 'recommended-route', 'risk-prediction']) {
    assert.throws(() => assertPermittedClaimTag(tag), /claim tag is prohibited/);
  }

  const weakened = structuredClone(DEFAULT_ROUTE_DECISION_BOUNDARY);
  weakened.privacy.networkTransport = 'allowed';
  assert.throws(() => admitRouteDecisionBoundary(weakened), /must match the frozen boundary/);
});

test('validators reject prototype, accessor, symbol, and cyclic schema tricks without invoking getters', () => {
  const polluted = JSON.parse(JSON.stringify(graphArtifact()));
  polluted.nodes[0] = JSON.parse('{"nodeId":"a","__proto__":{"polluted":true}}');
  assert.throws(() => admitGraphArtifact(polluted), /unknown: __proto__/);
  assert.equal({}.polluted, undefined);

  let reads = 0;
  const accessorEdge = graphArtifact().edges[0];
  Object.defineProperty(accessorEdge, 'distanceMm', {
    enumerable: true,
    get() { reads += 1; return 1_250; },
  });
  const accessorGraph = graphArtifact();
  accessorGraph.edges[0] = accessorEdge;
  assert.throws(() => admitGraphArtifact(accessorGraph), /must contain data properties only/);
  assert.equal(reads, 0);

  const symbolGraph = graphArtifact();
  symbolGraph[Symbol('hidden')] = true;
  assert.throws(() => admitGraphArtifact(symbolGraph), /symbol properties/);

  const accessorResult = decisionResult();
  let traceReads = 0;
  Object.defineProperty(accessorResult.trace[0], 'stage', {
    enumerable: true,
    get() { traceReads += 1; return 'hard-constraint'; },
  });
  assert.throws(
    () => admitDecisionResult(accessorResult),
    /must contain data properties only/,
  );
  assert.equal(traceReads, 0);

  const cyclic = routeCandidate();
  cyclic.observations.self = cyclic;
  assert.throws(() => admitRouteCandidateFacts(cyclic), /observation tag is unsupported/);
});

test('failed validation and returned values never modify or retain caller-owned objects', () => {
  const invalid = decisionPolicy();
  invalid.softPreferences[0].weightBasisPoints = 9_999;
  const before = structuredClone(invalid);
  assert.throws(() => admitDecisionPolicy(invalid), /must sum to 10000/);
  assert.deepEqual(invalid, before);

  const candidate = routeCandidate();
  const admitted = admitRouteCandidateFacts(candidate);
  candidate.observations['step-free'].value = false;
  candidate.geometry.coordinatesMm[0][0] = 999;
  assert.equal(admitted.observations['step-free'].value, true);
  assert.equal(admitted.geometry.coordinatesMm[0][0], 0);

  const result = decisionResult();
  const admittedResult = admitDecisionResult(result);
  result.policyId = 'mutated-policy';
  result.candidateSet.candidateIds[0] = 'mutated-candidate';
  result.trace[1].rawValue = 9_999;
  assert.equal(admittedResult.policyId, 'distance-first-v1');
  assert.deepEqual(admittedResult.candidateSet.candidateIds, ['candidate-1']);
  assert.equal(admittedResult.trace[1].rawValue, 3_250);
});
