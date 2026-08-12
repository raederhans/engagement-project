#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileNormalizedGraph,
  loadNormalizedGraph,
} from '../../src/route_generation/normalized_graph.js';
import {
  BASE_DIJKSTRA_TIE_BREAK_CONTRACT,
  findShortestPath,
  solveShortestRoute,
} from '../../src/route_generation/base_dijkstra.js';
import { generateRouteFoundation } from '../../src/route_generation/public_adapter.js';
import {
  CANDIDATE_SET_LIMITATIONS,
  ROUTE_DECISION_SCHEMA_VERSIONS,
  admitCandidateSet,
  admitRouteCandidateFacts,
} from '../../src/route_decision/contracts/index.js';

function edge(edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits) {
  return { edgeId, fromNodeId, toNodeId, distanceMm, objectiveCostUnits };
}

function graphArtifact({
  graphId = 'synthetic-graph',
  nodes = ['a', 'b', 'c'],
  edges = [],
  directed = true,
} = {}) {
  return {
    schemaVersion: 'graph-artifact-v1',
    graphId,
    mode: 'walking',
    directed,
    nodes: nodes.map((nodeId) => ({ nodeId })),
    edges,
  };
}

function s0GraphArtifact({
  graphId = 'graph-fixture-1',
  nodes = ['a', 'b', 'c'],
  edges = [
    edge('a-b', 'a', 'b', 1_250, 1_300),
    edge('b-c', 'b', 'c', 2_000, 2_100),
  ],
  components,
  mode = 'walk',
  schemaVersion = ROUTE_DECISION_SCHEMA_VERSIONS.graphArtifact,
} = {}) {
  const byNodeId = components?.byNodeId ?? Object.fromEntries(nodes.map((nodeId) => [nodeId, 0]));
  return {
    schemaVersion,
    graphId,
    mode,
    directed: true,
    nodes: nodes.map((nodeId) => ({ nodeId })),
    edges,
    components: components ?? {
      kind: 'weakly-connected',
      count: 1,
      byNodeId,
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: ['synthetic-fixture'],
    },
    receipt: {
      artifactVersion: 'fixture-graph-v1',
    },
  };
}

function s0RouteRequest(overrides = {}) {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.routeRequest,
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

function requireCompiled(artifact) {
  const compilation = compileNormalizedGraph(artifact);
  assert.equal(compilation.status, 'ready');
  return compilation.graph;
}

function assertRouteRecomputes(route, compiledGraph) {
  assert.equal(route.status, 'ready');
  assert.equal(route.nodePath.length, route.edgePath.length + 1);

  const edgesById = new Map(compiledGraph.edges.map((candidate) => [candidate.edgeId, candidate]));
  let distanceMm = 0;
  let objectiveCostUnits = 0;

  route.edgePath.forEach((edgeId, index) => {
    const candidate = edgesById.get(edgeId);
    assert.ok(candidate, `route edge ${edgeId} must exist in the compiled graph`);
    assert.equal(candidate.fromNodeId, route.nodePath[index]);
    assert.equal(candidate.toNodeId, route.nodePath[index + 1]);
    distanceMm += candidate.distanceMm;
    objectiveCostUnits += candidate.objectiveCostUnits;
  });

  assert.equal(route.distanceMm, distanceMm);
  assert.equal(route.objectiveCostUnits, objectiveCostUnits);
}

function issueCodes(result) {
  assert.equal(result.status, 'invalid_graph');
  return result.issues.map(({ code }) => code);
}

function defineThrowingGetter(target, property, onRead) {
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: true,
    get() {
      onRead();
      throw new Error(`getter ${String(property)} must not execute`);
    },
  });
}

test('compiler normalizes stable IDs, deterministic adjacency, and verifiable weak components', () => {
  const artifact = graphArtifact({
    nodes: ['z', 'b', 'a', 'orphan'],
    edges: [
      edge('edge-z', 'b', 'z', 300, 3),
      edge('edge-a', 'a', 'b', 200, 2),
    ],
  });

  const compiled = requireCompiled(artifact);

  assert.deepEqual(compiled.nodes, [
    { nodeId: 'a' },
    { nodeId: 'b' },
    { nodeId: 'orphan' },
    { nodeId: 'z' },
  ]);
  assert.deepEqual(compiled.edges.map(({ edgeId }) => edgeId), ['edge-a', 'edge-z']);
  assert.deepEqual(compiled.adjacency, [
    { nodeId: 'a', outgoingEdgeIds: ['edge-a'] },
    { nodeId: 'b', outgoingEdgeIds: ['edge-z'] },
    { nodeId: 'orphan', outgoingEdgeIds: [] },
    { nodeId: 'z', outgoingEdgeIds: [] },
  ]);
  assert.deepEqual(compiled.components, {
    kind: 'weak',
    count: 2,
    items: [
      {
        componentId: 'weak:a',
        nodeIds: ['a', 'b', 'z'],
        edgeIds: ['edge-a', 'edge-z'],
      },
      {
        componentId: 'weak:orphan',
        nodeIds: ['orphan'],
        edgeIds: [],
      },
    ],
    nodeMembership: [
      { nodeId: 'a', componentId: 'weak:a' },
      { nodeId: 'b', componentId: 'weak:a' },
      { nodeId: 'orphan', componentId: 'weak:orphan' },
      { nodeId: 'z', componentId: 'weak:a' },
    ],
  });
});

test('loader and compiler produce the same normalized graph without relying on input order', () => {
  const first = graphArtifact({
    nodes: ['c', 'a', 'b'],
    edges: [
      edge('bc', 'b', 'c', 200, 2),
      edge('ab', 'a', 'b', 100, 1),
    ],
  });
  const second = graphArtifact({
    nodes: ['b', 'c', 'a'],
    edges: [...first.edges].reverse(),
  });

  assert.deepEqual(loadNormalizedGraph(JSON.stringify(first)), compileNormalizedGraph(second));
  assert.deepEqual(loadNormalizedGraph('{not-json'), {
    status: 'invalid_graph',
    issues: [{ code: 'graph_json_invalid', path: '$' }],
  });
});

test('base Dijkstra returns the unique minimum-objective route with recomputable facts', () => {
  const compiled = requireCompiled(graphArtifact({
    nodes: ['a', 'b', 'c', 'd'],
    edges: [
      edge('ab', 'a', 'b', 100, 2),
      edge('bd', 'b', 'd', 200, 3),
      edge('ac', 'a', 'c', 50, 4),
      edge('cd', 'c', 'd', 50, 4),
    ],
  }));

  const route = findShortestPath(compiled, { startNodeId: 'a', endNodeId: 'd' });

  assert.deepEqual(route, {
    status: 'ready',
    graphId: 'synthetic-graph',
    startNodeId: 'a',
    endNodeId: 'd',
    nodePath: ['a', 'b', 'd'],
    edgePath: ['ab', 'bd'],
    distanceMm: 300,
    objectiveCostUnits: 5,
  });
  assertRouteRecomputes(route, compiled);
});

test('v1 tie-break contract is machine-readable and excludes raw hop count', () => {
  assert.deepEqual(BASE_DIJKSTRA_TIE_BREAK_CONTRACT, {
    version: 'route-generation-tie-break-v1',
    keys: [
      { key: 'objectiveCostUnits', order: 'ascending' },
      { key: 'directedEdgeIdSequence', order: 'locale-independent-lexicographic' },
    ],
  });
  assert.equal(Object.isFrozen(BASE_DIJKSTRA_TIE_BREAK_CONTRACT), true);
  assert.equal(Object.isFrozen(BASE_DIJKSTRA_TIE_BREAK_CONTRACT.keys), true);
});

test('v1 equal-cost canonical order selects two-edge a,b before one-edge z-direct', () => {
  const route = solveShortestRoute({
    graphArtifact: graphArtifact({
      nodes: ['start', 'middle', 'end'],
      edges: [
        edge('z-direct', 'start', 'end', 50, 4),
        edge('b', 'middle', 'end', 400, 2),
        edge('a', 'start', 'middle', 400, 2),
      ],
    }),
    startNodeId: 'start',
    endNodeId: 'end',
  });

  assert.deepEqual(route.edgePath, ['a', 'b']);
  assert.equal(route.objectiveCostUnits, 4);
  assert.equal(route.distanceMm, 800);
});

test('equal-objective routes compare the full edge-ID sequence regardless of input order', () => {
  const edges = [
    edge('b', 'middle', 'end', 1, 2),
    edge('prefix', 'start', 'middle', 100, 2),
    edge('a', 'middle', 'end', 900, 2),
  ];
  const first = solveShortestRoute({
    graphArtifact: graphArtifact({ nodes: ['end', 'middle', 'start'], edges }),
    startNodeId: 'start',
    endNodeId: 'end',
  });
  const second = solveShortestRoute({
    graphArtifact: graphArtifact({ nodes: ['middle', 'start', 'end'], edges: [...edges].reverse() }),
    startNodeId: 'start',
    endNodeId: 'end',
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.edgePath, ['prefix', 'a']);
  assert.equal(first.objectiveCostUnits, 4);
  assert.equal(first.distanceMm, 1_000);
});

test('physical distance never replaces objective cost as the Dijkstra weight', () => {
  const compiled = requireCompiled(graphArtifact({
    nodes: ['a', 'b', 'd'],
    edges: [
      edge('short-distance', 'a', 'd', 10, 10),
      edge('low-cost-1', 'a', 'b', 1_000, 2),
      edge('low-cost-2', 'b', 'd', 1_000, 2),
    ],
  }));

  const route = findShortestPath(compiled, { startNodeId: 'a', endNodeId: 'd' });

  assert.deepEqual(route.edgePath, ['low-cost-1', 'low-cost-2']);
  assert.equal(route.distanceMm, 2_000);
  assert.equal(route.objectiveCostUnits, 4);
  assertRouteRecomputes(route, compiled);
});

test('topology is explicitly directed and never gains an implicit reverse edge', () => {
  const compiled = requireCompiled(graphArtifact({
    nodes: ['a', 'b'],
    edges: [edge('ab', 'a', 'b', 100, 1)],
  }));

  assert.equal(findShortestPath(compiled, { startNodeId: 'a', endNodeId: 'b' }).status, 'ready');
  const reverse = findShortestPath(compiled, { startNodeId: 'b', endNodeId: 'a' });
  assert.equal(reverse.status, 'no_route');
  assert.equal('nodePath' in reverse, false);
  assert.equal('edgePath' in reverse, false);
});

test('zero-cost directed cycles terminate without displacing a shorter stable label', () => {
  const compiled = requireCompiled(graphArtifact({
    nodes: ['a', 'b', 'd'],
    edges: [
      edge('ab-zero', 'a', 'b', 100, 0),
      edge('ba-zero', 'b', 'a', 100, 0),
      edge('bd', 'b', 'd', 100, 1),
    ],
  }));

  const route = findShortestPath(compiled, { startNodeId: 'a', endNodeId: 'd' });

  assert.deepEqual(route.edgePath, ['ab-zero', 'bd']);
  assert.deepEqual(route.nodePath, ['a', 'b', 'd']);
  assert.equal(route.objectiveCostUnits, 1);
});

test('disconnected endpoints return no_route with component evidence and no partial route', () => {
  const compiled = requireCompiled(graphArtifact({
    nodes: ['a', 'b', 'x', 'y'],
    edges: [
      edge('ab', 'a', 'b', 100, 1),
      edge('xy', 'x', 'y', 100, 1),
    ],
  }));

  const route = findShortestPath(compiled, { startNodeId: 'a', endNodeId: 'y' });

  assert.deepEqual(route, {
    status: 'no_route',
    graphId: 'synthetic-graph',
    startNodeId: 'a',
    endNodeId: 'y',
    startComponentId: 'weak:a',
    endComponentId: 'weak:x',
  });
  assert.equal('nodePath' in route, false);
  assert.equal('edgePath' in route, false);
  assert.equal('distanceMm' in route, false);
  assert.equal('objectiveCostUnits' in route, false);
});

test('self-route is a ready zero-edge route', () => {
  const compiled = requireCompiled(graphArtifact({ nodes: ['a'], edges: [] }));

  const route = findShortestPath(compiled, { startNodeId: 'a', endNodeId: 'a' });

  assert.deepEqual(route, {
    status: 'ready',
    graphId: 'synthetic-graph',
    startNodeId: 'a',
    endNodeId: 'a',
    nodePath: ['a'],
    edgePath: [],
    distanceMm: 0,
    objectiveCostUnits: 0,
  });
  assertRouteRecomputes(route, compiled);
});

test('missing or malformed endpoints return endpoint_unavailable and no partial route', () => {
  const compiled = requireCompiled(graphArtifact({
    nodes: ['a', 'b'],
    edges: [edge('ab', 'a', 'b', 100, 1)],
  }));

  const route = findShortestPath(compiled, { startNodeId: 'missing', endNodeId: null });

  assert.deepEqual(route, {
    status: 'endpoint_unavailable',
    graphId: 'synthetic-graph',
    unavailableEndpoints: [
      { endpoint: 'start', nodeId: 'missing' },
      { endpoint: 'end', nodeId: null },
    ],
  });
  assert.equal('nodePath' in route, false);
  assert.equal('edgePath' in route, false);

  assert.deepEqual(findShortestPath(compiled, null), {
    status: 'endpoint_unavailable',
    graphId: 'synthetic-graph',
    unavailableEndpoints: [
      { endpoint: 'start', nodeId: null },
      { endpoint: 'end', nodeId: null },
    ],
  });
});

test('compiler rejects invalid and duplicate node IDs without returning a partial graph', () => {
  const artifact = graphArtifact({ nodes: ['a', 'a', ' '], edges: [] });

  const result = compileNormalizedGraph(artifact);
  const codes = issueCodes(result);

  assert.ok(codes.includes('node_id_duplicate'));
  assert.ok(codes.includes('node_id_invalid'));
  assert.equal('graph' in result, false);
});

test('compiler rejects duplicate edges and incomplete node references', () => {
  const artifact = graphArtifact({
    nodes: ['a', 'b'],
    edges: [
      edge('same', 'a', 'missing', 100, 1),
      edge('same', 'a', 'b', 100, 1),
    ],
  });

  const codes = issueCodes(compileNormalizedGraph(artifact));

  assert.ok(codes.includes('edge_id_duplicate'));
  assert.ok(codes.includes('edge_to_node_missing'));
});

test('compiler rejects negative, NaN, infinite, fractional, or unsafe weights', () => {
  const artifact = graphArtifact({
    nodes: ['a', 'b'],
    edges: [
      edge('negative-cost', 'a', 'b', 1, -1),
      edge('nan-distance', 'a', 'b', Number.NaN, 1),
      edge('infinite-cost', 'a', 'b', 1, Number.POSITIVE_INFINITY),
      edge('fractional-distance', 'a', 'b', 1.5, 1),
      edge('unsafe-cost', 'a', 'b', 1, Number.MAX_SAFE_INTEGER + 1),
    ],
  });

  const codes = issueCodes(compileNormalizedGraph(artifact));

  assert.equal(codes.filter((code) => code === 'edge_distance_mm_invalid').length, 2);
  assert.equal(codes.filter((code) => code === 'edge_objective_cost_units_invalid').length, 3);
});

test('compiler rejects topology that is not explicitly directed', () => {
  const result = compileNormalizedGraph(graphArtifact({ directed: false }));

  assert.ok(issueCodes(result).includes('directed_topology_required'));
  assert.equal(solveShortestRoute({
    graphArtifact: graphArtifact({ directed: false }),
    startNodeId: 'a',
    endNodeId: 'b',
  }).status, 'invalid_graph');
});

test('compiler rejects root, array-entry, and nested accessors without executing getters', () => {
  let getterCalls = 0;
  const onRead = () => {
    getterCalls += 1;
  };

  const rootAccessor = graphArtifact();
  defineThrowingGetter(rootAccessor, 'nodes', onRead);

  const arrayAccessor = graphArtifact();
  defineThrowingGetter(arrayAccessor.nodes, '0', onRead);

  const nestedAccessor = graphArtifact({
    nodes: ['a', 'b'],
    edges: [edge('ab', 'a', 'b', 100, 1)],
  });
  defineThrowingGetter(nestedAccessor.edges[0], 'objectiveCostUnits', onRead);

  const inheritedAccessor = graphArtifact();
  delete inheritedAccessor.nodes;
  const inheritedPrototype = {};
  defineThrowingGetter(inheritedPrototype, 'nodes', onRead);
  Object.setPrototypeOf(inheritedAccessor, inheritedPrototype);

  for (const artifact of [rootAccessor, arrayAccessor, nestedAccessor]) {
    const result = compileNormalizedGraph(artifact);
    assert.ok(issueCodes(result).includes('accessor_property_disallowed'));
    assert.equal('graph' in result, false);
  }
  assert.ok(issueCodes(compileNormalizedGraph(inheritedAccessor)).includes('graph_nodes_invalid'));
  assert.equal(getterCalls, 0);
});

test('exported solvers fail closed on request accessors without executing getters', () => {
  let getterCalls = 0;
  const onRead = () => {
    getterCalls += 1;
  };
  const artifact = graphArtifact({
    nodes: ['a', 'b'],
    edges: [edge('ab', 'a', 'b', 100, 1)],
  });

  const graphAccessorRequest = {};
  defineThrowingGetter(graphAccessorRequest, 'graphArtifact', onRead);
  assert.equal(solveShortestRoute(graphAccessorRequest).status, 'invalid_graph');

  const inheritedGraphRequest = Object.create(graphAccessorRequest);
  assert.equal(solveShortestRoute(inheritedGraphRequest).status, 'invalid_graph');

  const solverEndpointRequest = { graphArtifact: artifact, endNodeId: 'b' };
  defineThrowingGetter(solverEndpointRequest, 'startNodeId', onRead);
  const solverResult = solveShortestRoute(solverEndpointRequest);
  assert.equal(solverResult.status, 'endpoint_unavailable');
  assert.equal('edgePath' in solverResult, false);

  const directEndpointRequest = { endNodeId: 'b' };
  defineThrowingGetter(directEndpointRequest, 'startNodeId', onRead);
  const directResult = findShortestPath(artifact, directEndpointRequest);
  assert.equal(directResult.status, 'endpoint_unavailable');
  assert.equal('edgePath' in directResult, false);

  assert.equal(getterCalls, 0);
});

test('repeated compilation and route execution are byte-for-byte stable as data', () => {
  const artifact = graphArtifact({
    nodes: ['d', 'c', 'b', 'a'],
    edges: [
      edge('ac', 'a', 'c', 100, 1),
      edge('cd', 'c', 'd', 100, 1),
      edge('ab', 'a', 'b', 100, 1),
      edge('bd', 'b', 'd', 100, 1),
    ],
  });
  const request = { graphArtifact: artifact, startNodeId: 'a', endNodeId: 'd' };

  const firstCompilation = compileNormalizedGraph(artifact);
  const secondCompilation = compileNormalizedGraph(artifact);
  const firstRoute = solveShortestRoute(request);
  const secondRoute = solveShortestRoute(request);

  assert.deepEqual(firstCompilation, secondCompilation);
  assert.deepEqual(firstRoute, secondRoute);
  assert.equal(JSON.stringify(firstCompilation), JSON.stringify(secondCompilation));
  assert.equal(JSON.stringify(firstRoute), JSON.stringify(secondRoute));
});

test('compiler and router do not mutate the graph artifact or route request', () => {
  const artifact = graphArtifact({
    nodes: ['c', 'a', 'b'],
    edges: [
      edge('bc', 'b', 'c', 200, 2),
      edge('ab', 'a', 'b', 100, 1),
    ],
  });
  const request = { graphArtifact: artifact, startNodeId: 'a', endNodeId: 'c' };
  const before = structuredClone(request);

  compileNormalizedGraph(artifact);
  solveShortestRoute(request);

  assert.deepEqual(request, before);
});

test('public adapter maps an exact S0 RouteRequest that the internal solver cannot consume directly', () => {
  const graph = s0GraphArtifact();
  const request = s0RouteRequest();
  const directInternalResult = solveShortestRoute({ graphArtifact: graph, ...request });

  assert.equal(directInternalResult.status, 'endpoint_unavailable');

  const outcome = generateRouteFoundation(graph, request);
  assert.equal(outcome.status, 'ready');
  assert.deepEqual(outcome.candidateFacts, [{
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.routeCandidateFacts,
    candidateId: 'request-1',
    edgeIds: ['a-b', 'b-c'],
    distanceMm: 3_250,
    objectiveCostUnits: 3_400,
    observations: {},
    provenance: {
      graphId: 'graph-fixture-1',
      dataClassification: 'synthetic',
    },
  }]);
  assert.deepEqual(outcome.candidateSet, {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    candidateSetId: 'request-1',
    candidateSetRevision: 'fixture-graph-v1',
    requestId: 'request-1',
    graphId: 'graph-fixture-1',
    strategy: 'base-objective-only',
    objectiveFactorId: 'objective-cost-units',
    candidateIds: ['request-1'],
    candidateCount: 1,
    completeness: 'incomplete',
    constraintAwareSearch: false,
    limitations: [...CANDIDATE_SET_LIMITATIONS],
  });
  assert.deepEqual(admitRouteCandidateFacts(outcome.candidateFacts[0]), outcome.candidateFacts[0]);
  assert.deepEqual(admitCandidateSet(outcome.candidateSet), outcome.candidateSet);
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(Object.isFrozen(outcome.candidateFacts), true);
  assert.equal(Object.isFrozen(outcome.candidateFacts[0].observations), true);
});

test('public ready candidate preserves solver edge order and independently recomputable graph facts', () => {
  const graph = s0GraphArtifact({
    nodes: ['start', 'middle', 'end'],
    edges: [
      edge('z-direct', 'start', 'end', 10, 4),
      edge('b', 'middle', 'end', 400, 2),
      edge('a', 'start', 'middle', 400, 2),
    ],
  });
  graph.graphId = 'graph-path-order';
  const request = s0RouteRequest({
    requestId: 'request-path-order',
    graphId: 'graph-path-order',
    originNodeId: 'start',
    destinationNodeId: 'end',
  });

  const outcome = generateRouteFoundation(graph, request);
  const candidate = outcome.candidateFacts[0];
  const edgeById = new Map(graph.edges.map((candidateEdge) => [candidateEdge.edgeId, candidateEdge]));
  const recomputed = candidate.edgeIds.reduce((totals, edgeId) => {
    const candidateEdge = edgeById.get(edgeId);
    totals.distanceMm += candidateEdge.distanceMm;
    totals.objectiveCostUnits += candidateEdge.objectiveCostUnits;
    return totals;
  }, { distanceMm: 0, objectiveCostUnits: 0 });

  assert.equal(outcome.status, 'ready');
  assert.deepEqual(candidate.edgeIds, ['a', 'b']);
  assert.deepEqual(recomputed, {
    distanceMm: candidate.distanceMm,
    objectiveCostUnits: candidate.objectiveCostUnits,
  });
  assert.deepEqual(candidate.observations, {});
});

test('public adapter returns a truthful ready self-route with one zero-edge candidate', () => {
  const outcome = generateRouteFoundation(
    s0GraphArtifact({ nodes: ['a'], edges: [] }),
    s0RouteRequest({ destinationNodeId: 'a' }),
  );

  assert.equal(outcome.status, 'ready');
  assert.equal(outcome.candidateSet.candidateCount, 1);
  assert.deepEqual(outcome.candidateSet.candidateIds, ['request-1']);
  assert.deepEqual(outcome.candidateFacts[0].edgeIds, []);
  assert.equal(outcome.candidateFacts[0].distanceMm, 0);
  assert.equal(outcome.candidateFacts[0].objectiveCostUnits, 0);
});

test('public endpoint-unavailable and no-route terminals remain distinct zero-candidate sets', () => {
  const endpointUnavailable = generateRouteFoundation(
    s0GraphArtifact(),
    s0RouteRequest({ destinationNodeId: 'missing' }),
  );
  const disconnectedGraph = s0GraphArtifact({
    nodes: ['a', 'b', 'x', 'y'],
    edges: [
      edge('a-b', 'a', 'b', 100, 1),
      edge('x-y', 'x', 'y', 100, 1),
    ],
    components: {
      kind: 'weakly-connected',
      count: 2,
      byNodeId: { a: 0, b: 0, x: 1, y: 1 },
    },
  });
  const noRoute = generateRouteFoundation(
    disconnectedGraph,
    s0RouteRequest({ destinationNodeId: 'y' }),
  );

  assert.equal(endpointUnavailable.status, 'endpoint-unavailable');
  assert.equal(noRoute.status, 'no-route');
  for (const outcome of [endpointUnavailable, noRoute]) {
    assert.equal(outcome.status === 'no-feasible-route', false);
    assert.deepEqual(outcome.candidateFacts, []);
    assert.equal(outcome.candidateSet.candidateCount, 0);
    assert.deepEqual(outcome.candidateSet.candidateIds, []);
    assert.equal(outcome.candidateSet.completeness, 'incomplete');
    assert.equal(outcome.candidateSet.constraintAwareSearch, false);
    assert.deepEqual(outcome.candidateSet.limitations, CANDIDATE_SET_LIMITATIONS);
    assert.deepEqual(admitCandidateSet(outcome.candidateSet), outcome.candidateSet);
  }
});

test('public adapter fails closed on schema drift and graph/request identity mismatch', () => {
  const futureGraph = s0GraphArtifact({ schemaVersion: 'engagement-route-graph/v2' });
  const futureRequest = s0RouteRequest({ schemaVersion: 'engagement-route-request/v2' });
  const mismatchedRequest = s0RouteRequest({ graphId: 'another-graph' });
  const extraFieldGraph = { ...s0GraphArtifact(), unknownField: true };

  const outcomes = [
    generateRouteFoundation(futureGraph, s0RouteRequest()),
    generateRouteFoundation(s0GraphArtifact(), futureRequest),
    generateRouteFoundation(s0GraphArtifact(), mismatchedRequest),
    generateRouteFoundation(extraFieldGraph, s0RouteRequest()),
  ];

  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'invalid-input');
    assert.equal(Object.keys(outcome).length, 2);
    assert.equal(typeof outcome.reasonCode, 'string');
    assert.equal('candidateSet' in outcome, false);
    assert.equal('candidateFacts' in outcome, false);
    assert.equal(Object.isFrozen(outcome), true);
  }
});

test('public adapter rejects graph and request getters without executing them', () => {
  let getterCalls = 0;
  const onRead = () => {
    getterCalls += 1;
  };
  const graph = s0GraphArtifact();
  defineThrowingGetter(graph.edges[0], 'distanceMm', onRead);
  const request = s0RouteRequest();
  defineThrowingGetter(request, 'originNodeId', onRead);

  const graphOutcome = generateRouteFoundation(graph, s0RouteRequest());
  const requestOutcome = generateRouteFoundation(s0GraphArtifact(), request);

  assert.equal(graphOutcome.status, 'invalid-input');
  assert.equal(requestOutcome.status, 'invalid-input');
  assert.equal(getterCalls, 0);
});

test('public adapter does not mutate or retain caller graph and request objects', () => {
  const graph = s0GraphArtifact();
  const request = s0RouteRequest();
  const before = structuredClone({ graph, request });

  const outcome = generateRouteFoundation(graph, request);
  assert.deepEqual({ graph, request }, before);
  graph.edges[0].distanceMm = 999_999;
  request.originNodeId = 'mutated';

  assert.equal(outcome.candidateFacts[0].distanceMm, 3_250);
  assert.equal(outcome.candidateSet.requestId, 'request-1');
});
