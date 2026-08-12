#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import { solveShortestRoute } from '../../src/route_generation/base_dijkstra.js';
import {
  ROUTE_CANDIDATE_SEARCH_CAPACITY,
  ROUTE_CANDIDATE_SEARCH_EXPANDED_STATE_UNIT,
  searchRouteCandidates,
} from '../../src/route_generation/candidate_search/index.js';
import { ROUTE_DECISION_SCHEMA_VERSIONS } from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
} from '../../src/route_decision/contracts/candidate_search_v2.js';

const S2_VERSION = ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS;
const V1_VERSION = ROUTE_DECISION_SCHEMA_VERSIONS;

function edge(edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits) {
  return { edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits };
}

function graphArtifact({
  graphId = 'candidate-search-graph',
  nodes = ['a', 'b', 'd'],
  edges = [
    edge('a-b', 'a', 'b', 100, 1),
    edge('b-d', 'b', 'd', 100, 1),
  ],
} = {}) {
  const byNodeId = weakComponentMembership(nodes, edges);
  return {
    schemaVersion: V1_VERSION.graphArtifact,
    graphId,
    mode: 'walk',
    directed: true,
    nodes: nodes.map((nodeId) => ({ nodeId })),
    edges,
    components: {
      kind: 'weakly-connected',
      count: new Set(Object.values(byNodeId)).size,
      byNodeId,
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: ['synthetic-candidate-search-fixture'],
    },
    receipt: { artifactVersion: 'candidate-search-fixture-v1' },
  };
}

function weakComponentMembership(nodeIds, edges) {
  const neighbors = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  for (const candidate of edges) {
    neighbors.get(candidate.fromNodeId).push(candidate.toNodeId);
    neighbors.get(candidate.toNodeId).push(candidate.fromNodeId);
  }
  const byNodeId = {};
  let componentId = 0;
  for (const startingNodeId of nodeIds) {
    if (Object.hasOwn(byNodeId, startingNodeId)) continue;
    const pending = [startingNodeId];
    byNodeId[startingNodeId] = componentId;
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      for (const neighborId of neighbors.get(pending[cursor])) {
        if (Object.hasOwn(byNodeId, neighborId)) continue;
        byNodeId[neighborId] = componentId;
        pending.push(neighborId);
      }
    }
    componentId += 1;
  }
  return byNodeId;
}

function searchConstraint(factorId = 'step-free', constraintId = `requires-${factorId}`) {
  return {
    constraintId,
    factorId,
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

function searchRequest(overrides = {}) {
  return {
    schemaVersion: S2_VERSION.searchRequest,
    requestId: 'candidate-search-request',
    graphId: 'candidate-search-graph',
    mode: 'walk',
    originNodeId: 'a',
    destinationNodeId: 'd',
    decisionPolicyId: 'candidate-search-policy',
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
  const reasonCode = {
    unknown: 'not-observed',
    unavailable: 'source-unavailable',
    partial: 'coverage-partial',
    stale: 'observation-stale',
    invalid: 'source-invalid',
  }[state] ?? null;
  return {
    schemaVersion: V1_VERSION.sourceObservation,
    factorId,
    state,
    value: state === 'observed' ? value : null,
    unit: 'boolean',
    reasonCode,
    sourceId: 'synthetic-edge-capability-fixture',
  };
}

function assertCandidateRecomputes(candidate, graph) {
  const edgesById = new Map(graph.edges.map((item) => [item.edgeId, item]));
  let distanceMm = 0;
  let objectiveCostUnits = 0;
  for (const edgeId of candidate.edgeIds) {
    const item = edgesById.get(edgeId);
    assert.ok(item, `missing graph edge ${edgeId}`);
    distanceMm += item.distanceMm;
    objectiveCostUnits += item.objectiveCostUnits;
  }
  assert.equal(candidate.distanceMm, distanceMm);
  assert.equal(candidate.objectiveCostUnits, objectiveCostUnits);
}

test('K=1 preserves base Dijkstra objective and full edge-sequence tie-break', () => {
  const graph = graphArtifact({
    nodes: ['start', 'middle', 'end'],
    edges: [
      edge('z-direct', 'start', 'end', 50, 4),
      edge('b', 'middle', 'end', 400, 2),
      edge('a', 'start', 'middle', 400, 2),
    ],
  });
  graph.graphId = 'candidate-search-graph';
  const request = searchRequest({
    originNodeId: 'start',
    destinationNodeId: 'end',
    requestedCandidateCount: 1,
  });
  const base = solveShortestRoute({
    graphArtifact: graph,
    startNodeId: request.originNodeId,
    endNodeId: request.destinationNodeId,
  });
  const result = searchRouteCandidates(graph, request);

  assert.equal(result.termination, 'requested-candidate-count-reached');
  assert.deepEqual(result.candidateFacts[0].edgeIds, base.edgePath);
  assert.equal(result.candidateFacts[0].distanceMm, base.distanceMm);
  assert.equal(result.candidateFacts[0].objectiveCostUnits, base.objectiveCostUnits);
  assert.deepEqual(result.candidateFacts[0].edgeIds, ['a', 'b']);
  assert.equal(result.candidateSet.completeness.routeSearch, 'not-proven');
});

test('requested K caps a deterministic objective-then-edge-sequence prefix', () => {
  const graph = graphArtifact({
    nodes: ['a', 'b', 'c', 'd'],
    edges: [
      edge('z-direct', 'a', 'd', 1, 2),
      edge('a-first', 'a', 'b', 5, 1),
      edge('a-last', 'b', 'd', 5, 1),
      edge('c-first', 'a', 'c', 1, 2),
      edge('c-last', 'c', 'd', 1, 2),
    ],
  });
  const result = searchRouteCandidates(graph, searchRequest({ requestedCandidateCount: 2 }));

  assert.equal(result.candidateSet.candidateCount, 2);
  assert.deepEqual(result.candidateFacts.map(({ edgeIds }) => edgeIds), [
    ['a-first', 'a-last'],
    ['z-direct'],
  ]);
  assert.equal(result.termination, 'requested-candidate-count-reached');
});

test('frontier exhaustion returns fewer than K with bounded completeness', () => {
  const graph = graphArtifact();
  const result = searchRouteCandidates(graph, searchRequest({ requestedCandidateCount: 3 }));

  assert.equal(result.termination, 'bounded-search-space-exhausted');
  assert.equal(result.candidateSet.candidateCount, 1);
  assert.equal(result.candidateSet.requestedCandidateCount, 3);
  assert.equal(result.candidateSet.completeness.routeSearch, 'complete-within-bounds');
  assertCandidateRecomputes(result.candidateFacts[0], graph);
});

test('loopless enumeration rejects a zero-cost directed cycle', () => {
  const graph = graphArtifact({
    edges: [
      edge('a-b', 'a', 'b', 10, 0),
      edge('b-a', 'b', 'a', 10, 0),
      edge('b-d', 'b', 'd', 10, 1),
    ],
  });
  const result = searchRouteCandidates(graph, searchRequest({ requestedCandidateCount: 2 }));

  assert.deepEqual(result.candidateFacts.map(({ edgeIds }) => edgeIds), [['a-b', 'b-d']]);
  assert.equal(result.termination, 'bounded-search-space-exhausted');
  assert.equal(result.candidateFacts[0].edgeIds.includes('b-a'), false);
});

test('directed reverse traversal remains bounded no-route', () => {
  const graph = graphArtifact({
    nodes: ['a', 'd'],
    edges: [edge('a-d', 'a', 'd', 10, 1)],
  });
  const result = searchRouteCandidates(graph, searchRequest({
    originNodeId: 'd',
    destinationNodeId: 'a',
  }));

  assert.equal(result.termination, 'no-directed-route-in-bounded-scope');
  assert.equal(result.candidateSet.candidateCount, 0);
  assert.equal(result.candidateSet.completeness.routeSearch, 'complete-within-bounds');
});

test('same endpoint is the deterministic zero-edge primary without expanding state', () => {
  const result = searchRouteCandidates(graphArtifact(), searchRequest({
    originNodeId: 'a',
    destinationNodeId: 'a',
    requestedCandidateCount: 1,
    bounds: { maxExpandedStates: 1, maxRouteEdgeCount: 0 },
  }));

  assert.equal(result.termination, 'requested-candidate-count-reached');
  assert.deepEqual(result.candidateFacts[0].edgeIds, []);
  assert.equal(result.candidateFacts[0].distanceMm, 0);
  assert.equal(result.candidateFacts[0].objectiveCostUnits, 0);
  assert.equal(result.candidateSet.expandedStateCount, 0);
});

test('constrained same-endpoint route does not infer capability truth from an empty edge set', () => {
  const result = searchRouteCandidates(graphArtifact(), searchRequest({
    originNodeId: 'a',
    destinationNodeId: 'a',
    requestedCandidateCount: 1,
    bounds: { maxExpandedStates: 1, maxRouteEdgeCount: 0 },
    hardConstraints: [searchConstraint()],
  }));

  assert.equal(result.status, 'completed');
  assert.equal(result.termination, 'unresolved-constraint-evidence');
  assert.deepEqual(result.candidateFacts, []);
  assert.equal(result.candidateSet.candidateCount, 0);
  assert.deepEqual(result.candidateSet.candidateIds, []);
  assert.equal(result.candidateSet.expandedStateCount, 0);
  assert.equal(result.candidateSet.constraintOutcome, 'unresolved-evidence');
  assert.equal(result.candidateSet.completeness.routeSearch, 'complete-within-bounds');
  assert.equal(result.candidateSet.budgetOutcome, 'within-budget');
});

test('known-false edge capability excludes the cheap path and returns an eligible alternative', () => {
  const graph = graphArtifact({
    nodes: ['a', 'b', 'd'],
    edges: [
      edge('cheap', 'a', 'd', 10, 1),
      edge('a-b', 'a', 'b', 20, 2),
      edge('b-d', 'b', 'd', 20, 2),
    ],
  });
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [searchConstraint()],
  });
  const evidence = {
    cheap: { 'step-free': sourceObservation('step-free', 'observed', false) },
    'a-b': { 'step-free': sourceObservation('step-free') },
    'b-d': { 'step-free': sourceObservation('step-free') },
  };
  const result = searchRouteCandidates(graph, request, evidence);

  assert.deepEqual(result.candidateFacts[0].edgeIds, ['a-b', 'b-d']);
  assert.equal(result.candidateFacts[0].observations['step-free'].state, 'observed');
  assert.equal(result.candidateFacts[0].observations['step-free'].value, true);
  assert.equal(result.candidateSet.constraintOutcome, 'eligible-candidates-returned');
});

test('known failure dominates unresolved evidence on the same edge', () => {
  const graph = graphArtifact();
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [
      searchConstraint('step-free'),
      searchConstraint('paved-surface'),
    ],
  });
  const evidence = {
    'a-b': {
      'step-free': sourceObservation('step-free', 'observed', false),
      'paved-surface': sourceObservation('paved-surface', 'unknown'),
    },
    'b-d': {
      'step-free': sourceObservation('step-free'),
      'paved-surface': sourceObservation('paved-surface'),
    },
  };
  const result = searchRouteCandidates(graph, request, evidence);

  assert.equal(result.termination, 'no-eligible-route-in-bounded-scope');
  assert.equal(
    result.candidateSet.constraintOutcome,
    'no-eligible-route-in-bounded-scope-proven',
  );
});

test('known failure later on a route dominates an unresolved prefix edge', () => {
  const graph = graphArtifact();
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [searchConstraint()],
  });
  const evidence = {
    'a-b': { 'step-free': sourceObservation('step-free', 'unknown') },
    'b-d': { 'step-free': sourceObservation('step-free', 'observed', false) },
  };
  const result = searchRouteCandidates(graph, request, evidence);

  assert.equal(result.termination, 'no-eligible-route-in-bounded-scope');
  assert.equal(result.candidateSet.expandedStateCount, 4);
  assert.equal(
    result.candidateSet.constraintOutcome,
    'no-eligible-route-in-bounded-scope-proven',
  );
});

test('known failure on a prefix dominates an unresolved later edge on the route', () => {
  const graph = graphArtifact();
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [searchConstraint()],
  });
  const evidence = {
    'a-b': { 'step-free': sourceObservation('step-free', 'observed', false) },
    'b-d': { 'step-free': sourceObservation('step-free', 'unknown') },
  };
  const result = searchRouteCandidates(graph, request, evidence);

  assert.equal(result.termination, 'no-eligible-route-in-bounded-scope');
  assert.equal(
    result.candidateSet.constraintOutcome,
    'no-eligible-route-in-bounded-scope-proven',
  );
});

test('missing or unresolved complete edge evidence is excluded and reported', () => {
  const graph = graphArtifact();
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [searchConstraint()],
  });
  const missing = searchRouteCandidates(graph, request, {
    'b-d': { 'step-free': sourceObservation('step-free') },
  });
  const unavailable = searchRouteCandidates(graph, request, {
    'a-b': { 'step-free': sourceObservation('step-free', 'unavailable') },
    'b-d': { 'step-free': sourceObservation('step-free') },
  });

  for (const result of [missing, unavailable]) {
    assert.equal(result.termination, 'unresolved-constraint-evidence');
    assert.equal(result.candidateSet.candidateCount, 0);
    assert.equal(result.candidateSet.constraintOutcome, 'unresolved-evidence');
    assert.equal(result.candidateSet.completeness.routeSearch, 'complete-within-bounds');
  }
});

test('reaching K returns the finalized eligible prefix despite an unresolved dead branch', () => {
  const graph = graphArtifact({
    nodes: ['a', 'b', 'd', 'x'],
    edges: [
      edge('a-b', 'a', 'b', 10, 1),
      edge('b-d', 'b', 'd', 10, 1),
      edge('a-x', 'a', 'x', 10, 50),
    ],
  });
  const request = searchRequest({
    requestedCandidateCount: 1,
    hardConstraints: [searchConstraint()],
  });
  const result = searchRouteCandidates(graph, request, {
    'a-b': { 'step-free': sourceObservation('step-free') },
    'b-d': { 'step-free': sourceObservation('step-free') },
    'a-x': { 'step-free': sourceObservation('step-free', 'unknown') },
  });

  assert.equal(result.termination, 'requested-candidate-count-reached');
  assert.deepEqual(result.candidateFacts[0].edgeIds, ['a-b', 'b-d']);
  assert.equal(result.candidateSet.constraintOutcome, 'eligible-candidates-returned');
  assert.equal(result.candidateSet.completeness.routeSearch, 'not-proven');
});

test('an unresolved dead branch does not prevent bounded completion for eligible routes', () => {
  const graph = graphArtifact({
    nodes: ['a', 'b', 'd', 'x'],
    edges: [
      edge('a-b', 'a', 'b', 10, 1),
      edge('b-d', 'b', 'd', 10, 1),
      edge('a-x', 'a', 'x', 10, 50),
    ],
  });
  const request = searchRequest({
    requestedCandidateCount: 2,
    hardConstraints: [searchConstraint()],
  });
  const result = searchRouteCandidates(graph, request, {
    'a-b': { 'step-free': sourceObservation('step-free') },
    'b-d': { 'step-free': sourceObservation('step-free') },
    'a-x': { 'step-free': sourceObservation('step-free', 'unknown') },
  });

  assert.equal(result.termination, 'bounded-search-space-exhausted');
  assert.deepEqual(result.candidateFacts.map(({ edgeIds }) => edgeIds), [['a-b', 'b-d']]);
  assert.equal(result.candidateSet.expandedStateCount, 3);
  assert.equal(result.candidateSet.constraintOutcome, 'eligible-candidates-returned');
  assert.equal(result.candidateSet.completeness.routeSearch, 'complete-within-bounds');
});

test('budget exhaustion returns only the finalized ordered candidate prefix', () => {
  const graph = graphArtifact({
    edges: [
      edge('direct', 'a', 'd', 10, 1),
      edge('a-b', 'a', 'b', 10, 2),
      edge('b-d', 'b', 'd', 10, 2),
    ],
  });
  const request = searchRequest({
    requestedCandidateCount: 2,
    bounds: { maxExpandedStates: 1, maxRouteEdgeCount: 12 },
  });
  const result = searchRouteCandidates(graph, request);

  assert.equal(result.termination, 'search-budget-exhausted');
  assert.equal(result.status, 'stopped');
  assert.deepEqual(result.candidateFacts.map(({ edgeIds }) => edgeIds), [['direct']]);
  assert.equal(result.candidateSet.expandedStateCount, 1);
  assert.equal(result.candidateSet.budgetOutcome, 'exhausted');
  assert.equal(result.candidateSet.completeness.routeSearch, 'not-proven');
});

test('frontier capacity stops a high-outdegree expansion without claiming budget completion', () => {
  const branchCount = ROUTE_CANDIDATE_SEARCH_CAPACITY.maxFrontierStates + 1;
  const branchNodeIds = Array.from({ length: branchCount }, (_, index) => `x-${index}`);
  const graph = graphArtifact({
    nodes: ['a', 'd', ...branchNodeIds],
    edges: branchNodeIds.map((nodeId, index) => edge(`fan-${index}`, 'a', nodeId, 1, 1)),
  });
  const result = searchRouteCandidates(graph, searchRequest({
    requestedCandidateCount: 1,
    bounds: { maxExpandedStates: 10, maxRouteEdgeCount: 2 },
  }));

  assert.equal(result.status, 'stopped');
  assert.equal(result.termination, 'search-capacity-exhausted');
  assert.equal(result.candidateSet.expandedStateCount, 1);
  assert.equal(result.candidateSet.budgetOutcome, 'capacity-exhausted');
  assert.equal(result.candidateSet.completeness.routeSearch, 'not-proven');
  assert.equal(result.candidateSet.constraintOutcome, 'not-required');
  assert.equal(Object.isFrozen(ROUTE_CANDIDATE_SEARCH_CAPACITY), true);
});

test('frontier edge-reference capacity bounds deep pending labels below the state-count cap', () => {
  const chainNodeIds = Array.from({ length: 16 }, (_, index) => `c-${index}`);
  const branchNodeIds = Array.from({ length: 4_000 }, (_, index) => `x-${index}`);
  const chainEdges = chainNodeIds.map((nodeId, index) => edge(
    `chain-${index}`,
    index === 0 ? 'a' : chainNodeIds[index - 1],
    nodeId,
    1,
    1,
  ));
  const graph = graphArtifact({
    nodes: ['a', 'd', ...chainNodeIds, ...branchNodeIds],
    edges: [
      ...chainEdges,
      ...branchNodeIds.map((nodeId, index) => edge(
        `deep-fan-${index}`,
        chainNodeIds.at(-1),
        nodeId,
        1,
        1,
      )),
    ],
  });
  const result = searchRouteCandidates(graph, searchRequest({
    requestedCandidateCount: 1,
    bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 20 },
  }));

  assert.equal(result.termination, 'search-capacity-exhausted');
  assert.equal(result.candidateSet.expandedStateCount, 17);
  assert.equal(result.candidateSet.budgetOutcome, 'capacity-exhausted');
  assert.equal(result.candidateSet.completeness.routeSearch, 'not-proven');
});

test('capacity exhaustion preserves a finalized candidate as an incomplete ordered prefix', () => {
  const branchNodeIds = Array.from(
    { length: ROUTE_CANDIDATE_SEARCH_CAPACITY.maxFrontierStates + 1 },
    (_, index) => `x-${index}`,
  );
  const graph = graphArtifact({
    nodes: ['a', 'd', 'hub', ...branchNodeIds],
    edges: [
      edge('direct', 'a', 'd', 1, 0),
      edge('to-hub', 'a', 'hub', 1, 1),
      ...branchNodeIds.map((nodeId, index) => edge(`fan-${index}`, 'hub', nodeId, 1, 1)),
    ],
  });
  const result = searchRouteCandidates(graph, searchRequest({
    requestedCandidateCount: 2,
    bounds: { maxExpandedStates: 10, maxRouteEdgeCount: 2 },
  }));

  assert.equal(result.status, 'stopped');
  assert.equal(result.termination, 'search-capacity-exhausted');
  assert.deepEqual(result.candidateFacts.map(({ edgeIds }) => edgeIds), [['direct']]);
  assert.equal(result.candidateSet.expandedStateCount, 2);
  assert.equal(result.candidateSet.budgetOutcome, 'capacity-exhausted');
  assert.equal(result.candidateSet.completeness.routeSearch, 'not-proven');
});

test('bounded no-route and bounded no-eligible remain distinct', () => {
  const graph = graphArtifact();
  const tooShallow = searchRouteCandidates(graph, searchRequest({
    bounds: { maxExpandedStates: 20, maxRouteEdgeCount: 1 },
  }));
  assert.equal(tooShallow.termination, 'no-directed-route-in-bounded-scope');

  const request = searchRequest({
    requestedCandidateCount: 1,
    bounds: { maxExpandedStates: 20, maxRouteEdgeCount: 2 },
    hardConstraints: [searchConstraint()],
  });
  const excluded = searchRouteCandidates(graph, request, {
    'a-b': { 'step-free': sourceObservation('step-free', 'observed', false) },
    'b-d': { 'step-free': sourceObservation('step-free') },
  });
  assert.equal(excluded.termination, 'no-eligible-route-in-bounded-scope');
  assert.equal(excluded.candidateSet.completeness.routeSearch, 'complete-within-bounds');
  assert.ok(excluded.candidateSet.expandedStateCount > 1);
});

test('expanded state unit is deterministic and never exceeds the admitted budget', () => {
  assert.deepEqual(ROUTE_CANDIDATE_SEARCH_EXPANDED_STATE_UNIT, {
    version: 'loopless-frontier-state-expansion/v1',
    includes: 'nonterminal-label-adjacency-inspection',
    sharedAcrossClassificationPasses: true,
  });
  const result = searchRouteCandidates(graphArtifact(), searchRequest({
    requestedCandidateCount: 3,
    bounds: { maxExpandedStates: 2, maxRouteEdgeCount: 12 },
  }));
  assert.ok(result.candidateSet.expandedStateCount <= 2);
  assert.equal(Object.isFrozen(ROUTE_CANDIDATE_SEARCH_EXPANDED_STATE_UNIT), true);
});

test('invalid accessors fail closed without executing getters', () => {
  let getterCalls = 0;
  const graph = graphArtifact();
  Object.defineProperty(graph, 'edges', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  const graphResult = searchRouteCandidates(graph, searchRequest());

  const request = searchRequest();
  Object.defineProperty(request, 'requestedCandidateCount', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  const requestResult = searchRouteCandidates(graphArtifact(), request);

  const evidence = {};
  Object.defineProperty(evidence, 'a-b', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not execute');
    },
  });
  const evidenceResult = searchRouteCandidates(
    graphArtifact(),
    searchRequest({ hardConstraints: [searchConstraint()] }),
    evidence,
  );

  assert.equal(graphResult.termination, 'invalid-input');
  assert.equal(requestResult.termination, 'invalid-input');
  assert.equal(evidenceResult.termination, 'invalid-input');
  assert.equal(getterCalls, 0);
});

test('input order, repeated runs, immutability, and caller ownership are stable', () => {
  const graph = graphArtifact({
    nodes: ['d', 'c', 'b', 'a'],
    edges: [
      edge('c-d', 'c', 'd', 10, 2),
      edge('a-c', 'a', 'c', 10, 2),
      edge('b-d', 'b', 'd', 10, 1),
      edge('a-b', 'a', 'b', 10, 1),
    ],
  });
  const reordered = structuredClone(graph);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  const request = searchRequest({ requestedCandidateCount: 3 });
  const beforeGraph = structuredClone(graph);
  const beforeRequest = structuredClone(request);

  const first = searchRouteCandidates(graph, request);
  const second = searchRouteCandidates(graph, request);
  const permuted = searchRouteCandidates(reordered, structuredClone(request));

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(first), JSON.stringify(permuted));
  assert.deepEqual(graph, beforeGraph);
  assert.deepEqual(request, beforeRequest);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.candidateSet), true);
  assert.equal(Object.isFrozen(first.candidateFacts[0].edgeIds), true);

  graph.edges[0].objectiveCostUnits = 999;
  request.originNodeId = 'mutated';
  assert.equal(first.candidateFacts[0].objectiveCostUnits, 2);
  assert.equal(first.request.originNodeId, 'a');
});

test('unavailable endpoints do not start a bounded search', () => {
  const result = searchRouteCandidates(graphArtifact(), searchRequest({
    destinationNodeId: 'missing',
  }));
  assert.equal(result.status, 'not-started');
  assert.equal(result.termination, 'endpoint-unavailable');
  assert.equal(result.candidateSet, null);
  assert.deepEqual(result.candidateFacts, []);
});
