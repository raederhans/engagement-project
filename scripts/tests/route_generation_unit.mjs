#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileNormalizedGraph,
  loadNormalizedGraph,
} from '../../src/route_generation/normalized_graph.js';
import {
  findShortestPath,
  solveShortestRoute,
} from '../../src/route_generation/base_dijkstra.js';

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

test('equal-objective routes prefer fewer hops before stable ID tie-breaking', () => {
  const route = solveShortestRoute({
    graphArtifact: graphArtifact({
      nodes: ['a', 'b', 'd'],
      edges: [
        edge('a-first', 'a', 'b', 100, 2),
        edge('a-second', 'b', 'd', 100, 2),
        edge('z-direct', 'a', 'd', 500, 4),
      ],
    }),
    startNodeId: 'a',
    endNodeId: 'd',
  });

  assert.deepEqual(route.edgePath, ['z-direct']);
  assert.equal(route.objectiveCostUnits, 4);
  assert.equal(route.distanceMm, 500);
});

test('equal-objective equal-hop routes use stable edge-ID sequences regardless of input order', () => {
  const edges = [
    edge('b-2', 'b', 'd', 1, 2),
    edge('a-1', 'a', 'c', 900, 2),
    edge('b-1', 'a', 'b', 1, 2),
    edge('a-2', 'c', 'd', 900, 2),
  ];
  const first = solveShortestRoute({
    graphArtifact: graphArtifact({ nodes: ['d', 'c', 'b', 'a'], edges }),
    startNodeId: 'a',
    endNodeId: 'd',
  });
  const second = solveShortestRoute({
    graphArtifact: graphArtifact({ nodes: ['b', 'a', 'd', 'c'], edges: [...edges].reverse() }),
    startNodeId: 'a',
    endNodeId: 'd',
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.edgePath, ['a-1', 'a-2']);
  assert.equal(first.objectiveCostUnits, 4);
  assert.equal(first.distanceMm, 1_800);
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
