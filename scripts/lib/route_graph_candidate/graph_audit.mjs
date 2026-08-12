import {
  boundedText,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
  stringArray,
} from './safe_data.mjs';

export const ROUTE_GRAPH_CANDIDATE_SCHEMA = 'route-graph-candidate/v1';
export const ROUTE_GRAPH_TOPOLOGY_AUDIT_SCHEMA = 'route-graph-topology-audit/v1';

export function auditRouteGraphCandidate(graphValue) {
  const graph = exactDataObject(graphValue, [
    'schema', 'dataClassification', 'sourceId', 'sourceKind', 'profileId', 'mode',
    'nodes', 'edges', 'topologyIdentity', 'geometryIdentity', 'counts', 'limitations',
  ], 'normalized graph');
  const blockers = [];
  const warnings = ['turn-restrictions-unavailable'];
  if (graph.schema !== ROUTE_GRAPH_CANDIDATE_SCHEMA) blockers.push('schema-unsupported');
  if (graph.dataClassification !== classificationFor(graph.sourceKind)) blockers.push('data-classification-mismatch');
  boundedId(graph.sourceId, 'graph.sourceId');
  boundedId(graph.profileId, 'graph.profileId');
  boundedId(graph.mode, 'graph.mode');
  stringArray(graph.limitations, 'graph.limitations', { min: 1 });
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) fail('graph-arrays', 'normalized graph nodes and edges must be arrays');
  const nodes = graph.nodes.map((node, index) => admitNode(node, index));
  const edges = graph.edges.map((edge, index) => admitEdge(edge, index));
  if (nodes.length === 0) blockers.push('empty-node-inventory');
  if (edges.length === 0) blockers.push('empty-edge-inventory');
  const nodeById = new Map();
  if (!isSortedById(nodes)) blockers.push('node-order-not-canonical');
  for (const node of nodes) {
    if (nodeById.has(node.id)) blockers.push(`duplicate-node-id:${node.id}`);
    if (node.id !== stableNodeId(graph.sourceId, node.sourceNodeId)) blockers.push(`unstable-node-id:${node.id}`);
    nodeById.set(node.id, node);
  }
  const edgeIds = new Set();
  const exactEdges = new Set();
  const sourceDirectionGroups = new Map();
  if (!isSortedById(edges)) blockers.push('edge-order-not-canonical');
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) blockers.push(`duplicate-edge-id:${edge.id}`);
    if (edge.id !== stableEdgeId(graph.sourceId, edge.sourceEdgeId, edge.traversal)) blockers.push(`unstable-edge-id:${edge.id}`);
    edgeIds.add(edge.id);
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from) blockers.push(`missing-from-node:${edge.id}`);
    if (!to) blockers.push(`missing-to-node:${edge.id}`);
    if (edge.cost < 0) blockers.push(`negative-cost:${edge.id}`);
    if (edge.fromNodeId === edge.toNodeId && edge.cost === 0) blockers.push(`zero-cost-self-loop:${edge.id}`);
    if (edge.fromNodeId === edge.toNodeId && edge.cost > 0) warnings.push(`self-loop:${edge.id}`);
    if (edge.cost === 0 && edge.fromNodeId !== edge.toNodeId) warnings.push(`zero-cost-edge:${edge.id}`);
    if (from && !sameCoordinate(edge.geometry[0], from.coordinate)) blockers.push(`from-endpoint-discontinuity:${edge.id}`);
    if (to && !sameCoordinate(edge.geometry.at(-1), to.coordinate)) blockers.push(`to-endpoint-discontinuity:${edge.id}`);
    const exactKey = JSON.stringify([edge.fromNodeId, edge.toNodeId, edge.cost, edge.geometry]);
    if (exactEdges.has(exactKey)) blockers.push(`duplicate-directed-edge:${edge.id}`);
    exactEdges.add(exactKey);
    const group = sourceDirectionGroups.get(edge.sourceEdgeId) || { direction: edge.sourceDirection, traversals: [], edges: [] };
    if (group.direction !== edge.sourceDirection) blockers.push(`source-direction-conflict:${edge.sourceEdgeId}`);
    group.traversals.push(edge.traversal);
    group.edges.push(edge);
    sourceDirectionGroups.set(edge.sourceEdgeId, group);
  }
  for (const [sourceEdgeId, group] of sourceDirectionGroups) {
    const actual = [...group.traversals].sort();
    const expected = group.direction === 'bidirectional' ? ['forward', 'reverse'] : [group.direction];
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      blockers.push(`oneway-traversal-mismatch:${sourceEdgeId}`);
    }
    if (group.direction === 'bidirectional' && group.edges.length === 2) {
      const forward = group.edges.find((edge) => edge.traversal === 'forward');
      const reverse = group.edges.find((edge) => edge.traversal === 'reverse');
      if (forward && reverse && JSON.stringify([...forward.geometry].reverse()) !== JSON.stringify(reverse.geometry)) {
        blockers.push(`bidirectional-geometry-mismatch:${sourceEdgeId}`);
      }
    }
  }

  const components = weakComponentCounts(nodes, edges);
  const measuredCounts = {
    nodeCount: nodes.length,
    directedEdgeCount: edges.length,
    weakComponentCount: components.weakComponentCount,
    largestWeakComponentNodeCount: components.largestWeakComponentNodeCount,
    selfLoopCount: edges.filter((edge) => edge.fromNodeId === edge.toNodeId).length,
    zeroCostEdgeCount: edges.filter((edge) => edge.cost === 0).length,
  };
  const declaredCounts = exactDataObject(graph.counts, [
    'physicalFeatureCount', 'excludedAccessCount', 'nodeCount', 'directedEdgeCount',
    'weakComponentCount', 'largestWeakComponentNodeCount', 'selfLoopCount', 'zeroCostEdgeCount',
  ], 'graph.counts');
  for (const [key, value] of Object.entries(declaredCounts)) {
    if (!Number.isSafeInteger(value) || value < 0) blockers.push(`invalid-count:${key}`);
  }
  for (const [key, value] of Object.entries(measuredCounts)) {
    if (declaredCounts[key] !== value) blockers.push(`count-mismatch:${key}`);
  }
  if (declaredCounts.physicalFeatureCount !== sourceDirectionGroups.size + declaredCounts.excludedAccessCount) {
    blockers.push('count-mismatch:physicalFeatureCount');
  }
  if (graph.topologyIdentity !== topologyIdentityFor(graph)) blockers.push('topology-identity-mismatch');
  if (graph.geometryIdentity !== geometryIdentityFor(graph)) blockers.push('geometry-identity-mismatch');
  if (components.weakComponentCount > 1) warnings.push(`disconnected-components:${components.weakComponentCount}`);

  return freezeData({
    schema: ROUTE_GRAPH_TOPOLOGY_AUDIT_SCHEMA,
    status: blockers.length ? 'failed' : 'passed',
    blockers: [...new Set(blockers)].sort(compareText),
    warnings: [...new Set(warnings)].sort(compareText),
    counts: {
      ...measuredCounts,
      exactDuplicateDirectedEdgeCount: blockers.filter((item) => item.startsWith('duplicate-directed-edge:')).length,
    },
  }, 'route graph topology audit');
}

export function topologyIdentityFor(graph) {
  return contentIdentity({
    schema: graph.schema,
    sourceId: graph.sourceId,
    sourceKind: graph.sourceKind,
    profileId: graph.profileId,
    mode: graph.mode,
    nodes: graph.nodes.map((node) => [node.id, node.sourceNodeId]),
    edges: graph.edges.map((edge) => [
      edge.id, edge.sourceEdgeId, edge.fromNodeId, edge.toNodeId, edge.cost, edge.traversal, edge.sourceDirection,
    ]),
  });
}

export function geometryIdentityFor(graph) {
  return contentIdentity({
    nodes: graph.nodes.map((node) => [node.id, node.coordinate]),
    edges: graph.edges.map((edge) => [edge.id, edge.geometry]),
  });
}

export function weakComponentCounts(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    if (adjacency.has(edge.fromNodeId) && adjacency.has(edge.toNodeId)) {
      adjacency.get(edge.fromNodeId).add(edge.toNodeId);
      adjacency.get(edge.toNodeId).add(edge.fromNodeId);
    }
  }
  const visited = new Set();
  let weakComponentCount = 0;
  let largestWeakComponentNodeCount = 0;
  for (const nodeId of [...adjacency.keys()].sort(compareText)) {
    if (visited.has(nodeId)) continue;
    weakComponentCount += 1;
    let componentSize = 0;
    const stack = [nodeId];
    visited.add(nodeId);
    while (stack.length) {
      const current = stack.pop();
      componentSize += 1;
      for (const neighbor of [...adjacency.get(current)].sort(compareText)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    largestWeakComponentNodeCount = Math.max(largestWeakComponentNodeCount, componentSize);
  }
  return { weakComponentCount, largestWeakComponentNodeCount };
}

export function stableNodeId(sourceId, sourceNodeId) {
  return `node:${contentIdentity({ sourceId, sourceNodeId }).slice('sha256:'.length)}`;
}

export function stableEdgeId(sourceId, sourceEdgeId, traversal) {
  return `edge:${contentIdentity({ sourceId, sourceEdgeId, traversal }).slice('sha256:'.length)}`;
}

function admitNode(value, index) {
  const node = exactDataObject(value, ['id', 'sourceNodeId', 'coordinate'], `graph.nodes[${index}]`);
  boundedId(node.id, `graph.nodes[${index}].id`);
  boundedId(node.sourceNodeId, `graph.nodes[${index}].sourceNodeId`);
  node.coordinate = coordinate(node.coordinate, `graph.nodes[${index}].coordinate`);
  return node;
}

function admitEdge(value, index) {
  const edge = exactDataObject(value, [
    'id', 'sourceEdgeId', 'fromNodeId', 'toNodeId', 'cost', 'geometry', 'traversal', 'sourceDirection',
  ], `graph.edges[${index}]`);
  for (const key of ['id', 'sourceEdgeId', 'fromNodeId', 'toNodeId']) boundedId(edge[key], `graph.edges[${index}].${key}`);
  if (!Number.isSafeInteger(edge.cost)) fail('invalid-edge-cost', `graph.edges[${index}].cost must be a safe integer`);
  edge.geometry = geometryLine(edge.geometry, `graph.edges[${index}].geometry`);
  if (!['forward', 'reverse'].includes(edge.traversal)) fail('edge-traversal', `graph.edges[${index}].traversal is unsupported`);
  if (!['forward', 'reverse', 'bidirectional'].includes(edge.sourceDirection)) fail('edge-source-direction', `graph.edges[${index}].sourceDirection is unsupported`);
  return edge;
}

function geometryLine(value, label) {
  if (!Array.isArray(value) || value.length < 2) fail('invalid-geometry', `${label} must contain at least two coordinates`);
  return value.map((item, index) => coordinate(item, `${label}[${index}]`));
}

function coordinate(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    fail('invalid-coordinate', `${label} must contain exactly two finite numbers`);
  }
  return value.map((number) => Object.is(number, -0) ? 0 : number);
}

function classificationFor(sourceKind) {
  if (!['synthetic', 'osm', 'city'].includes(sourceKind)) fail('unsupported-enum', 'graph.sourceKind is unsupported');
  return sourceKind === 'synthetic' ? 'candidate-synthetic-fixture' : 'candidate-external';
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function isSortedById(values) {
  return values.every((value, index) => index === 0 || compareText(values[index - 1].id, value.id) <= 0);
}

function boundedId(value, label) {
  return boundedText(value, label, { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/ });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
