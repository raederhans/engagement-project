import {
  REAL_GRAPH_RECORD_COUNT_DEFINITION,
  ROUTE_GRAPH_CANDIDATE_SCHEMA,
  ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA,
} from './contracts.mjs';
import {
  assertArray,
  boundedText,
  canonicalStringify,
  cloneData,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
  nonNegativeSafeInteger,
} from './safe_data.mjs';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const NODE_ID_PATTERN = /^node:[a-f0-9]{64}$/;
const EDGE_ID_PATTERN = /^edge:[a-f0-9]{64}$/;

export function recomputeNormalizedGraphSemantics(graphValue, rawGraphValue, boundaryValue) {
  const graph = exactDataObject(graphValue, [
    'schema', 'dataClassification', 'sourceId', 'sourceKind', 'profileId', 'mode',
    'nodes', 'edges', 'topologyIdentity', 'geometryIdentity', 'counts', 'limitations',
  ], 'RD-B normalized graph');
  const rawGraph = exactDataObject(rawGraphValue, [
    'schema', 'sourceId', 'sourceKind', 'features',
  ], 'RD-B raw graph semantic input');
  const boundary = exactDataObject(boundaryValue, [
    'schema', 'boundaryId', 'clipperId', 'clipperVersion', 'clippingStatus',
    'clippingPolicy', 'outsideInputPolicy', 'bbox',
  ], 'RD-B boundary semantic input');

  if (graph.schema !== ROUTE_GRAPH_CANDIDATE_SCHEMA
    || rawGraph.schema !== ROUTE_GRAPH_RAW_CANDIDATE_SCHEMA
    || graph.dataClassification !== 'candidate-external'
    || graph.sourceKind !== 'osm' || rawGraph.sourceKind !== 'osm'
    || graph.mode !== 'walking' || graph.sourceId !== rawGraph.sourceId) {
    fail('graph-semantic-schema', 'normalized graph semantics must remain the bound external OSM walking candidate');
  }

  const bbox = admitBbox(boundary.bbox);
  const rawFeatures = admitRawFeatures(rawGraph.features, bbox);
  const nodes = admitNodes(graph.nodes, graph.sourceId, bbox);
  const edges = admitEdges(graph.edges, graph.sourceId, nodes, bbox);

  assertCanonicalOrder(nodes, 'node');
  assertCanonicalOrder(edges, 'edge');

  const duplicateDirectedEdgeCount = exactDuplicateDirectedEdgeCount(edges);
  if (duplicateDirectedEdgeCount !== 0) {
    fail('graph-duplicate-directed-edge', 'normalized graph contains an exact duplicate directed edge');
  }
  const selfLoopCount = edges.filter((edge) => edge.fromNodeId === edge.toNodeId).length;
  if (selfLoopCount !== 0) {
    fail('graph-self-loop', 'normalized graph contains a self-loop');
  }
  assertRawNormalization(rawFeatures, nodes, edges, graph.sourceId);

  const components = weakComponentCounts(nodes, edges);
  const counts = {
    physicalFeatureCount: rawFeatures.length,
    excludedAccessCount: rawFeatures.filter((feature) => feature.walk_access === 'denied').length,
    nodeCount: nodes.length,
    directedEdgeCount: edges.length,
    weakComponentCount: components.weakComponentCount,
    largestWeakComponentNodeCount: components.largestWeakComponentNodeCount,
    selfLoopCount,
    zeroCostEdgeCount: edges.filter((edge) => edge.cost === 0).length,
  };
  const auditCounts = {
    nodeCount: counts.nodeCount,
    directedEdgeCount: counts.directedEdgeCount,
    weakComponentCount: counts.weakComponentCount,
    largestWeakComponentNodeCount: counts.largestWeakComponentNodeCount,
    selfLoopCount: counts.selfLoopCount,
    zeroCostEdgeCount: counts.zeroCostEdgeCount,
    exactDuplicateDirectedEdgeCount: duplicateDirectedEdgeCount,
  };
  const topologyIdentity = topologyIdentityFor({ ...graph, nodes, edges });
  const geometryIdentity = geometryIdentityFor({ ...graph, nodes, edges });
  const warnings = ['turn-restrictions-unavailable'];
  if (components.weakComponentCount > 1) {
    warnings.push(`disconnected-components:${components.weakComponentCount}`);
  }

  assertExactDeclaredObject(graph.counts, counts, 'graph-count-drift', 'RD-B graph counts');
  if (graph.topologyIdentity !== topologyIdentity) {
    fail('graph-topology-identity-drift', 'RD-B topologyIdentity does not match recomputed normalized graph bytes');
  }
  if (graph.geometryIdentity !== geometryIdentity) {
    fail('graph-geometry-identity-drift', 'RD-B geometryIdentity does not match recomputed normalized graph bytes');
  }

  return freezeData({
    nodes,
    edges,
    topologyIdentity,
    geometryIdentity,
    counts,
    audit: {
      schema: 'route-graph-topology-audit/v1',
      status: 'passed',
      blockers: [],
      warnings,
      counts: auditCounts,
    },
    recordCountDefinition: REAL_GRAPH_RECORD_COUNT_DEFINITION,
    recordCount: edges.length,
  }, 'recomputed normalized graph semantics');
}

export function assertRecomputedAudit(auditValue, semanticsValue) {
  const audit = exactDataObject(auditValue, [
    'schema', 'status', 'blockers', 'warnings', 'counts',
  ], 'RD-B normalization audit');
  const semantics = exactDataObject(semanticsValue, [
    'nodes', 'edges', 'topologyIdentity', 'geometryIdentity', 'counts', 'audit',
    'recordCountDefinition', 'recordCount',
  ], 'RD-B recomputed semantics');
  if (canonicalStringify(audit) !== canonicalStringify(semantics.audit)) {
    fail('graph-audit-drift', 'RD-B audit does not equal the audit recomputed from normalized graph bytes');
  }
  return freezeData(audit, 'admitted RD-B recomputed audit');
}

export function topologyIdentityFor(graphValue) {
  const graph = admitIdentityGraph(graphValue, 'topology identity graph');
  return contentIdentity({
    schema: graph.schema,
    sourceId: graph.sourceId,
    sourceKind: graph.sourceKind,
    profileId: graph.profileId,
    mode: graph.mode,
    nodes: graph.nodes.map((node) => [node.id, node.sourceNodeId]),
    edges: graph.edges.map((edge) => [
      edge.id,
      edge.sourceEdgeId,
      edge.fromNodeId,
      edge.toNodeId,
      edge.cost,
      edge.traversal,
      edge.sourceDirection,
    ]),
  });
}

export function geometryIdentityFor(graphValue) {
  const graph = admitIdentityGraph(graphValue, 'geometry identity graph');
  return contentIdentity({
    nodes: graph.nodes.map((node) => [node.id, node.coordinate]),
    edges: graph.edges.map((edge) => [edge.id, edge.geometry]),
  });
}

export function stableNodeId(sourceId, sourceNodeId) {
  return `node:${contentIdentity({ sourceId, sourceNodeId }).slice('sha256:'.length)}`;
}

export function stableEdgeId(sourceId, sourceEdgeId, traversal) {
  return `edge:${contentIdentity({ sourceId, sourceEdgeId, traversal }).slice('sha256:'.length)}`;
}

export function weakComponentCounts(nodesValue, edgesValue) {
  const nodesData = cloneData(nodesValue, 'weak-component nodes');
  const edgesData = cloneData(edgesValue, 'weak-component edges');
  if (!Array.isArray(nodesData) || !Array.isArray(edgesData)) {
    fail('graph-component-input', 'weak-component inputs must be bounded dense data arrays');
  }
  const nodes = nodesData.map((node, index) => exactDataObject(node, [
    'id', 'sourceNodeId', 'coordinate',
  ], `weak-component nodes[${index}]`));
  const edges = edgesData.map((edge, index) => exactDataObject(edge, [
    'id', 'sourceEdgeId', 'fromNodeId', 'toNodeId', 'cost', 'geometry',
    'traversal', 'sourceDirection',
  ], `weak-component edges[${index}]`));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.add(edge.toNodeId);
    adjacency.get(edge.toNodeId)?.add(edge.fromNodeId);
  }
  let weakComponentCount = 0;
  let largestWeakComponentNodeCount = 0;
  const visited = new Set();
  for (const nodeId of [...adjacency.keys()].sort(compareText)) {
    if (visited.has(nodeId)) continue;
    weakComponentCount += 1;
    let size = 0;
    const stack = [nodeId];
    visited.add(nodeId);
    while (stack.length > 0) {
      const current = stack.pop();
      size += 1;
      for (const neighbor of [...adjacency.get(current)].sort(compareText)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    largestWeakComponentNodeCount = Math.max(largestWeakComponentNodeCount, size);
  }
  return { weakComponentCount, largestWeakComponentNodeCount };
}

function admitIdentityGraph(value, label) {
  const graph = cloneData(value, label);
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)
    || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    fail('graph-identity-input', `${label} must contain bounded dense node and edge arrays`);
  }
  for (const field of ['schema', 'sourceId', 'sourceKind', 'profileId', 'mode']) {
    if (!Object.hasOwn(graph, field)) {
      fail('graph-identity-input', `${label} is missing ${field}`);
    }
  }
  const nodes = graph.nodes.map((node, index) => exactDataObject(node, [
    'id', 'sourceNodeId', 'coordinate',
  ], `${label}.nodes[${index}]`));
  const edges = graph.edges.map((edge, index) => exactDataObject(edge, [
    'id', 'sourceEdgeId', 'fromNodeId', 'toNodeId', 'cost', 'geometry',
    'traversal', 'sourceDirection',
  ], `${label}.edges[${index}]`));
  return { ...graph, nodes, edges };
}

function admitBbox(value) {
  assertArray(value, 'RD-B boundary bbox', { minimum: 4, maximum: 4 });
  if (!value.every(Number.isFinite)
    || value[0] < -180 || value[2] > 180
    || value[1] < -90 || value[3] > 90
    || value[0] >= value[2] || value[1] >= value[3]) {
    fail('graph-boundary-bbox', 'RD-B boundary bbox must be increasing finite longitude/latitude bounds');
  }
  return value;
}

function admitRawFeatures(value, bbox) {
  assertArray(value, 'RD-B semantic raw features', { minimum: 1, maximum: 1_000_000 });
  const seen = new Set();
  const features = value.map((candidate, index) => {
    const feature = exactDataObject(candidate, [
      'source_edge_id', 'from_node_id', 'to_node_id', 'geometry_lon_lat_1e7',
      'cost_millimeters', 'walk_direction', 'walk_access', 'mode',
    ], `RD-B semantic raw features[${index}]`);
    for (const field of ['source_edge_id', 'from_node_id', 'to_node_id']) {
      boundedText(feature[field], `RD-B semantic raw ${field}`, { max: 240, pattern: ID_PATTERN });
    }
    if (seen.has(feature.source_edge_id)) {
      fail('graph-raw-duplicate-feature', 'RD-B semantic raw feature ids must be unique');
    }
    seen.add(feature.source_edge_id);
    if (feature.from_node_id === feature.to_node_id) {
      fail('graph-raw-self-loop', 'RD-B semantic raw feature endpoints must differ');
    }
    const geometry = admitGeometry(feature.geometry_lon_lat_1e7, 'RD-B semantic raw geometry', bbox);
    nonNegativeSafeInteger(feature.cost_millimeters, 'RD-B semantic raw cost', { positive: true });
    if (!['forward', 'reverse', 'bidirectional'].includes(feature.walk_direction)
      || !['allowed', 'denied'].includes(feature.walk_access)
      || feature.mode !== 'walking') {
      fail('graph-raw-semantics', 'RD-B semantic raw feature contains unsupported walk semantics');
    }
    return { ...feature, geometry_lon_lat_1e7: geometry };
  });
  assertCanonicalOrder(features.map((feature) => ({ id: feature.source_edge_id })), 'raw feature');
  return features;
}

function admitNodes(value, sourceId, bbox) {
  assertArray(value, 'RD-B normalized nodes', { minimum: 1, maximum: 2_000_000 });
  const ids = new Set();
  const sourceIds = new Set();
  return value.map((candidate, index) => {
    const node = exactDataObject(candidate, ['id', 'sourceNodeId', 'coordinate'], `RD-B nodes[${index}]`);
    boundedText(node.id, `RD-B nodes[${index}].id`, { max: 71, pattern: NODE_ID_PATTERN });
    boundedText(node.sourceNodeId, `RD-B nodes[${index}].sourceNodeId`, { max: 240, pattern: ID_PATTERN });
    if (ids.has(node.id) || sourceIds.has(node.sourceNodeId)) {
      fail('graph-duplicate-node', 'RD-B normalized node ids and source ids must be unique');
    }
    ids.add(node.id);
    sourceIds.add(node.sourceNodeId);
    if (node.id !== stableNodeId(sourceId, node.sourceNodeId)) {
      fail('graph-unstable-node-id', 'RD-B normalized node id does not match its source identity');
    }
    return { ...node, coordinate: admitCoordinate(node.coordinate, `RD-B nodes[${index}].coordinate`, bbox) };
  });
}

function admitEdges(value, sourceId, nodes, bbox) {
  assertArray(value, 'RD-B normalized edges', { minimum: 1, maximum: 2_000_000 });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ids = new Set();
  return value.map((candidate, index) => {
    const edge = exactDataObject(candidate, [
      'id', 'sourceEdgeId', 'fromNodeId', 'toNodeId', 'cost', 'geometry',
      'traversal', 'sourceDirection',
    ], `RD-B edges[${index}]`);
    boundedText(edge.id, `RD-B edges[${index}].id`, { max: 71, pattern: EDGE_ID_PATTERN });
    boundedText(edge.sourceEdgeId, `RD-B edges[${index}].sourceEdgeId`, { max: 240, pattern: ID_PATTERN });
    for (const field of ['fromNodeId', 'toNodeId']) {
      boundedText(edge[field], `RD-B edges[${index}].${field}`, { max: 71, pattern: NODE_ID_PATTERN });
    }
    if (ids.has(edge.id)) fail('graph-duplicate-edge-id', 'RD-B normalized edge ids must be unique');
    ids.add(edge.id);
    if (!['forward', 'reverse'].includes(edge.traversal)
      || !['forward', 'reverse', 'bidirectional'].includes(edge.sourceDirection)) {
      fail('graph-edge-semantics', 'RD-B normalized edge traversal semantics are unsupported');
    }
    if (edge.id !== stableEdgeId(sourceId, edge.sourceEdgeId, edge.traversal)) {
      fail('graph-unstable-edge-id', 'RD-B normalized edge id does not match its source identity');
    }
    nonNegativeSafeInteger(edge.cost, `RD-B edges[${index}].cost`, { positive: true });
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from || !to) fail('graph-edge-endpoint', 'RD-B normalized edge references an unknown node');
    const geometry = admitGeometry(edge.geometry, `RD-B edges[${index}].geometry`, bbox);
    if (!sameCoordinate(geometry[0], from.coordinate)
      || !sameCoordinate(geometry.at(-1), to.coordinate)) {
      fail('graph-endpoint-geometry-drift', 'RD-B normalized edge geometry does not meet its exact endpoint nodes');
    }
    return { ...edge, geometry };
  });
}

function assertRawNormalization(rawFeatures, nodes, edges, sourceId) {
  const expectedNodes = new Map();
  const expectedEdges = [];
  for (const feature of rawFeatures) {
    if (feature.walk_access === 'denied') continue;
    const fromNode = {
      id: stableNodeId(sourceId, feature.from_node_id),
      sourceNodeId: feature.from_node_id,
      coordinate: feature.geometry_lon_lat_1e7[0],
    };
    const toNode = {
      id: stableNodeId(sourceId, feature.to_node_id),
      sourceNodeId: feature.to_node_id,
      coordinate: feature.geometry_lon_lat_1e7.at(-1),
    };
    registerExpectedNode(expectedNodes, fromNode);
    registerExpectedNode(expectedNodes, toNode);
    if (['forward', 'bidirectional'].includes(feature.walk_direction)) {
      expectedEdges.push(expectedEdge(sourceId, feature, 'forward'));
    }
    if (['reverse', 'bidirectional'].includes(feature.walk_direction)) {
      expectedEdges.push(expectedEdge(sourceId, feature, 'reverse'));
    }
  }
  const canonicalExpectedNodes = [...expectedNodes.values()].sort((left, right) => compareText(left.id, right.id));
  const canonicalExpectedEdges = expectedEdges.sort((left, right) => compareText(left.id, right.id));
  if (canonicalStringify(nodes) !== canonicalStringify(canonicalExpectedNodes)) {
    fail('graph-node-normalization-drift', 'RD-B normalized nodes do not exactly derive from admitted raw graph endpoints');
  }
  if (canonicalStringify(edges) !== canonicalStringify(canonicalExpectedEdges)) {
    fail('graph-edge-normalization-drift', 'RD-B normalized edges do not exactly derive from admitted raw graph features');
  }
}

function registerExpectedNode(nodes, candidate) {
  const existing = nodes.get(candidate.sourceNodeId);
  if (existing && !sameCoordinate(existing.coordinate, candidate.coordinate)) {
    fail('graph-node-coordinate-conflict', 'RD-B raw graph assigns conflicting coordinates to one source node');
  }
  if (!existing) nodes.set(candidate.sourceNodeId, candidate);
}

function expectedEdge(sourceId, feature, traversal) {
  const reverse = traversal === 'reverse';
  return {
    id: stableEdgeId(sourceId, feature.source_edge_id, traversal),
    sourceEdgeId: feature.source_edge_id,
    fromNodeId: stableNodeId(sourceId, reverse ? feature.to_node_id : feature.from_node_id),
    toNodeId: stableNodeId(sourceId, reverse ? feature.from_node_id : feature.to_node_id),
    cost: feature.cost_millimeters,
    geometry: reverse ? [...feature.geometry_lon_lat_1e7].reverse() : feature.geometry_lon_lat_1e7,
    traversal,
    sourceDirection: feature.walk_direction,
  };
}

function exactDuplicateDirectedEdgeCount(edges) {
  const seen = new Set();
  let duplicates = 0;
  for (const edge of edges) {
    const key = canonicalStringify([edge.fromNodeId, edge.toNodeId, edge.cost, edge.geometry]);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  return duplicates;
}

function admitGeometry(value, label, bbox) {
  assertArray(value, label, { minimum: 2, maximum: 4_096 });
  return value.map((coordinate, index) => admitCoordinate(coordinate, `${label}[${index}]`, bbox));
}

function admitCoordinate(value, label, bbox) {
  assertArray(value, label, { minimum: 2, maximum: 2 });
  if (!value.every(Number.isFinite)
    || value[0] < -180 || value[0] > 180
    || value[1] < -90 || value[1] > 90) {
    fail('graph-coordinate-bounds', `${label} is outside finite longitude/latitude bounds`);
  }
  if (value[0] < bbox[0] || value[0] > bbox[2]
    || value[1] < bbox[1] || value[1] > bbox[3]) {
    fail('graph-coordinate-boundary', `${label} is outside the admitted boundary bbox`);
  }
  return value.map((number) => (Object.is(number, -0) ? 0 : number));
}

function assertCanonicalOrder(values, kind) {
  for (let index = 1; index < values.length; index += 1) {
    if (compareText(values[index - 1].id, values[index].id) >= 0) {
      fail('graph-noncanonical-order', `RD-B ${kind} order must be strictly ascending by exact id`);
    }
  }
}

function assertExactDeclaredObject(value, expected, code, label) {
  const declared = exactDataObject(value, Object.keys(expected), label);
  for (const [field, count] of Object.entries(declared)) {
    nonNegativeSafeInteger(count, `${label}.${field}`);
  }
  if (canonicalStringify(declared) !== canonicalStringify(expected)) {
    fail(code, `${label} does not equal values recomputed from normalized graph bytes`);
  }
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
