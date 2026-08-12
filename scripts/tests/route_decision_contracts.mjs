#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ROUTE_DECISION_BOUNDARY,
  DEFAULT_TRAVEL_NEED_CATALOG,
  FUNCTIONAL_NEED_TAGS,
  ROUTE_DECISION_SCHEMA_VERSIONS,
  ROUTE_OBSERVATION_STATES,
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
    observationTag: 'step-free',
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
        observationTag: 'stairs-count',
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

function decisionPolicy(overrides = {}) {
  return {
    schemaVersion: VERSION.decisionPolicy,
    policyId: 'distance-first-v1',
    hardConstraints: [{
      constraintId: 'requires-step-free',
      needTag: 'require-capability',
      observationTag: 'step-free',
      operator: 'equals',
      expectedValue: true,
      unresolvedStates: ['unknown', 'unavailable', 'partial', 'stale', 'invalid'],
    }],
    softPreferences: [
      {
        preferenceId: 'distance',
        needTag: 'minimize-distance',
        operator: 'minimize',
        weightBasisPoints: 7_500,
      },
      {
        preferenceId: 'objective-cost',
        needTag: 'minimize-objective-cost',
        operator: 'minimize',
        weightBasisPoints: 2_500,
      },
    ],
    weightBasisPointsTotal: 10_000,
    tieBreak: ['objective-cost-units', 'distance-mm', 'candidate-id'],
    ...overrides,
  };
}

function decisionResult(overrides = {}) {
  return {
    schemaVersion: VERSION.decisionResult,
    status: 'ranked',
    admittedCandidateIds: ['candidate-1'],
    rankedCandidateIds: ['candidate-1'],
    rejected: [],
    unresolved: [],
    trace: [
      {
        candidateId: 'candidate-1',
        stage: 'hard-constraint',
        ruleId: 'requires-step-free',
        outcome: 'pass',
        observationState: 'observed',
        reasonCode: 'hard-constraint-passed',
      },
      {
        candidateId: 'candidate-1',
        stage: 'soft-ranking',
        ruleId: 'distance',
        outcome: 'scored',
        observationState: null,
        reasonCode: 'soft-preference-scored',
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
    observationTag: 'stairs-count',
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
    () => admitSourceObservation(sourceObservation({ observationTag: 'safety-score' })),
    /observationTag is unsupported/,
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
  defaultPass.hardConstraints[0].unresolvedStates = ['unavailable', 'partial', 'stale', 'invalid'];
  assert.throws(() => admitDecisionPolicy(defaultPass), /unresolvedStates must exactly preserve/);
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

test('DecisionResult keeps admitted, rejected, and unresolved candidates disjoint', () => {
  assert.deepEqual(admitDecisionResult(decisionResult()), decisionResult());

  const rejectedOnly = decisionResult({
    status: 'no-admitted-candidate',
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    rejected: [{
      candidateId: 'candidate-2',
      constraintId: 'requires-step-free',
      reasonCode: 'hard-constraint-failed',
    }],
    trace: [{
      candidateId: 'candidate-2',
      stage: 'hard-constraint',
      ruleId: 'requires-step-free',
      outcome: 'reject',
      observationState: 'observed',
      reasonCode: 'hard-constraint-failed',
    }],
  });
  assert.equal(admitDecisionResult(rejectedOnly).status, 'no-admitted-candidate');

  const overlap = decisionResult({
    rejected: [{
      candidateId: 'candidate-1',
      constraintId: 'requires-step-free',
      reasonCode: 'hard-constraint-failed',
    }],
  });
  assert.throws(() => admitDecisionResult(overlap), /both admitted and rejected/);

  const badRanking = decisionResult({ rankedCandidateIds: [] });
  assert.throws(() => admitDecisionResult(badRanking), /rankedCandidateIds must contain every admitted candidate/);
});

test('DecisionResult cannot represent an unknown hard constraint as a pass', () => {
  const invalid = decisionResult();
  invalid.trace[0].observationState = 'unknown';
  assert.throws(() => admitDecisionResult(invalid), /unknown hard-constraint observation cannot pass/);

  const unresolved = decisionResult({
    status: 'unresolved',
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    unresolved: [{
      candidateId: 'candidate-2',
      constraintId: 'requires-step-free',
      observationTag: 'step-free',
      observationState: 'unknown',
      reasonCode: 'hard-constraint-unresolved',
    }],
    trace: [{
      candidateId: 'candidate-2',
      stage: 'hard-constraint',
      ruleId: 'requires-step-free',
      outcome: 'unresolved',
      observationState: 'unknown',
      reasonCode: 'hard-constraint-unresolved',
    }],
  });
  assert.equal(admitDecisionResult(unresolved).status, 'unresolved');
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
});
