import {
  canonicalStringify,
  compareCodeUnits,
  contentIdentity,
  deepFreeze,
} from './canonical_v1.js';
import { strictRealCompactJsonParse } from './strict_json_v1.js';

const MAX_ID_LENGTH = 160;
const MAX_NODES = 200_000;
const MAX_EDGES = 600_000;
const MAX_GEOMETRY_POINTS = 3_000_000;
const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,159})$/;
const IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BLOCKED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const DEPENDENCY_KINDS = Object.freeze([
  'source',
  'acquisition',
  'profile',
  'boundary',
  'tool',
  'build',
  'authorization',
]);
const FIXTURE_LANES = Object.freeze({
  source: 'RD-A',
  acquisition: 'RD-A',
  profile: 'RD-B',
  boundary: 'RD-E',
  tool: 'RD-E',
  build: 'RD-E',
  authorization: 'RD-C',
});
const ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE = Object.freeze({
  fixtureId: 'synthetic-construction-real-compact-two-components',
  fixtureInputDigest: 'sha256:291df5eda337c8a11712eec7e320079d834129a939589da54c9ce31fc38f137a',
});

export const REAL_COMPACT_GRAPH_SCHEMA_VERSIONS = deepFreeze({
  routeGraphCandidate: 'route-graph-candidate/v1',
  graphProjection: 'engagement-route-real-compact-graph-projection/v1',
  encoding: 'engagement-route-real-compact-graph-encoding/v1',
  topologyAudit: 'engagement-route-real-compact-graph-topology-audit/v1',
  candidateIdentity: 'engagement-route-real-compact-graph-candidate-identity/v1',
  topologyIdentity: 'engagement-route-real-compact-graph-topology-identity/v1',
  geometryIdentity: 'engagement-route-real-compact-graph-geometry-identity/v1',
  dependencyPlaceholderBindings:
    'engagement-route-real-compact-graph-synthetic-dependency-placeholder-bindings/v1',
  dependencyPlaceholderIdentity:
    'engagement-route-real-compact-graph-synthetic-dependency-placeholder-identity/v1',
  dependencyBridgeStatus: 'engagement-route-real-compact-graph-dependency-bridge-status/v1',
  licenceBoundary: 'engagement-route-real-compact-graph-licence-boundary/v1',
  materialization: 'engagement-route-real-compact-graph-materialization/v1',
  claimBoundary: 'engagement-route-real-compact-graph-claim-boundary/v1',
  compiler: 'engagement-route-real-compact-graph-compiler/v1',
  syntheticFixture: 'engagement-route-real-compact-graph-synthetic-construction-fixture/v1',
  syntheticFixtureIdentity: 'engagement-route-real-compact-graph-synthetic-fixture-identity/v1',
  syntheticObservation:
    'engagement-route-real-compact-graph-synthetic-construction-observation/v1',
  syntheticObservationIdentity:
    'engagement-route-real-compact-graph-synthetic-observation-identity/v1',
});

export const REAL_COMPACT_GRAPH_CANONICALIZATIONS = deepFreeze({
  candidate: 'route-real-compact-graph-candidate-canonical-json/v1',
  topology: 'route-real-compact-graph-topology-canonical-json/v1',
  geometry: 'route-real-compact-graph-geometry-canonical-json/v1',
  dependencyPlaceholder:
    'route-real-compact-graph-synthetic-dependency-placeholder-canonical-json/v1',
  syntheticFixture: 'route-real-compact-graph-synthetic-fixture-canonical-json/v1',
  syntheticObservation: 'route-real-compact-graph-synthetic-observation-canonical-json/v1',
});

export const REAL_COMPACT_GRAPH_DEPENDENCY_STATUS = deepFreeze({
  schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.dependencyBridgeStatus,
  status: 'dependency-contract-unavailable',
  rdB: {
    requiredSchema: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.routeGraphCandidate,
    requiredSemantics: 'accepted-exact-one-integer-millimetre-cost-contract',
    acceptedContractInstalled: false,
  },
  rdC: {
    requiredReceipt: 'accepted-exact-versioned-authorization-proposal-receipt',
    requiredBindings: [
      'authorization-identity',
      'evidence-identity',
      'admission-identity',
      'normalized-graph-identity',
    ],
    acceptedContractInstalled: false,
    ownerRegistry: 'empty',
    authorityState: 'authority-unavailable',
  },
  sourceHealth: {
    catalogMutationAuthorized: false,
    currentClaimAllowed: false,
    callerCurrentCanIncreaseAuthority: false,
  },
});

export const SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS = deepFreeze([
  'deterministic-one-cost-compact-mechanics-for-one-exact-synthetic-construction-fixture',
]);

export const SYNTHETIC_CONSTRUCTION_LIMITATIONS = deepFreeze([
  'synthetic-construction-fixture-only',
  'not-a-real-graph-artifact',
  'not-graphartifact-or-external-graph-authority',
  'not-actual-rd-a-rd-b-rd-c-or-rd-e-evidence',
  'production-rd-b-rd-c-dependency-contracts-unavailable',
  'production-owner-authorization-registry-empty-and-authority-unavailable',
  'not-source-health-current-and-no-catalog-mutation-authority',
  'caller-current-review-text-hashes-or-brands-cannot-increase-authority',
  'one-integer-millimetre-cost-mechanics-only',
  'future-cost-dimensions-require-a-separate-reviewed-profile-and-identity',
  'synthetic-integer-coordinate-mechanics-do-not-freeze-rd-b-real-coordinate-encoding',
  'not-product-runtime-worker-loader-performance-browser-pilot-or-deployment-ready',
  'not-publishable-redistributable-or-deployable',
  'odbl-and-openstreetmap-attribution-are-release-requirements-not-fixture-provenance',
  'sha256-identities-prove-internal-consistency-only',
  'not-safety-safer-route-accessibility-outcome-or-scientific-validity',
]);

function fail(message) {
  throw new TypeError(`RealCompactGraph mechanics/v1 contract: ${message}`);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a JSON object`);
  }
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !keys.includes(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) fail(`${label} must equal ${expected}`);
  return value;
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) {
    fail(`${label} must match the exact frozen vocabulary`);
  }
  return value;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_IDS.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function syntheticId(value, label) {
  const admitted = boundedId(value, label);
  if (!admitted.startsWith('synthetic-construction-')) {
    fail(`${label} must identify explicit synthetic construction`);
  }
  return admitted;
}

function nonNegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > max) {
    fail(`${label} must be a non-negative safe integer no greater than ${max}`);
  }
  return value;
}

function positiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  const admitted = nonNegativeInteger(value, label, max);
  if (admitted === 0) fail(`${label} must be positive`);
  return admitted;
}

function exactTimestamp(value, label) {
  if (typeof value !== 'string') fail(`${label} must be an exact ISO timestamp`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`${label} must be an exact ISO timestamp`);
  }
  return value;
}

function boundedTextArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    fail(`${label} must be a non-empty bounded array`);
  }
  const admitted = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry || entry !== entry.trim() || entry.length > 500) {
      fail(`${label}[${index}] must be bounded non-empty text without outer whitespace`);
    }
    return entry;
  });
  if (new Set(admitted).size !== admitted.length) fail(`${label} must not contain duplicates`);
  return admitted;
}

function identityShape(value, schemaVersion, canonicalization, label) {
  exactObject(value, [
    'schemaVersion',
    'canonicalization',
    'digestAlgorithm',
    'canonicalUtf8Bytes',
    'digest',
  ], label);
  exactString(value.schemaVersion, schemaVersion, `${label}.schemaVersion`);
  exactString(value.canonicalization, canonicalization, `${label}.canonicalization`);
  exactString(value.digestAlgorithm, 'sha256', `${label}.digestAlgorithm`);
  positiveInteger(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`);
  if (typeof value.digest !== 'string' || !IDENTITY_PATTERN.test(value.digest)) {
    fail(`${label}.digest must be a lowercase sha256 identity`);
  }
  return value;
}

function sameIdentity(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function coordinate(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(`${label} must contain exactly two integer coordinates`);
  }
  return value.map((entry, index) => {
    if (!Number.isSafeInteger(entry) || Object.is(entry, -0)) {
      fail(`${label}[${index}] must be a safe integer without negative zero`);
    }
    return entry;
  });
}

function geometryLine(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    fail(`${label} must contain at least two coordinates`);
  }
  return value.map((entry, index) => coordinate(entry, `${label}[${index}]`));
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function candidateTopologyProjection(graph) {
  return {
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
  };
}

function candidateGeometryProjection(graph) {
  return {
    nodes: graph.nodes.map((node) => [node.id, node.coordinate]),
    edges: graph.edges.map((edge) => [edge.id, edge.geometry]),
  };
}

function candidateTopologyDigest(graph) {
  return contentIdentity(
    candidateTopologyProjection(graph),
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.topologyIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.topology,
  ).digest;
}

function candidateGeometryDigest(graph) {
  return contentIdentity(
    candidateGeometryProjection(graph),
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.geometryIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.geometry,
  ).digest;
}

function stableNodeId(sourceId, sourceNodeId) {
  const digest = contentIdentity(
    { sourceId, sourceNodeId },
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.candidateIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.candidate,
  ).digest;
  return `node:${digest.slice('sha256:'.length)}`;
}

function stableEdgeId(sourceId, sourceEdgeId, traversal) {
  const digest = contentIdentity(
    { sourceId, sourceEdgeId, traversal },
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.candidateIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.candidate,
  ).digest;
  return `edge:${digest.slice('sha256:'.length)}`;
}

function computeWeakComponents(nodes, edges) {
  const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));
  const neighbors = Array.from({ length: nodes.length }, () => new Set());
  const incident = new Uint32Array(nodes.length);
  for (const edge of edges) {
    const fromIndex = nodeIndexById.get(edge.fromNodeId);
    const toIndex = nodeIndexById.get(edge.toNodeId);
    neighbors[fromIndex].add(toIndex);
    neighbors[toIndex].add(fromIndex);
    incident[fromIndex] += 1;
    incident[toIndex] += 1;
  }
  const byNodeIndex = new Array(nodes.length).fill(-1);
  const nodeCounts = [];
  let count = 0;
  for (let start = 0; start < nodes.length; start += 1) {
    if (byNodeIndex[start] !== -1) continue;
    const queue = [start];
    byNodeIndex[start] = count;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const sortedNeighbors = [...neighbors[queue[cursor]]].sort((left, right) => left - right);
      for (const neighbor of sortedNeighbors) {
        if (byNodeIndex[neighbor] === -1) {
          byNodeIndex[neighbor] = count;
          queue.push(neighbor);
        }
      }
    }
    nodeCounts.push(queue.length);
    count += 1;
  }
  return {
    count,
    byNodeIndex,
    nodeCounts,
    largestNodeCount: Math.max(...nodeCounts),
    isolatedNodeCount: [...incident].filter((entry) => entry === 0).length,
  };
}

function validateCandidateCounts(value, measured) {
  exactObject(value, [
    'physicalFeatureCount',
    'excludedAccessCount',
    'nodeCount',
    'directedEdgeCount',
    'weakComponentCount',
    'largestWeakComponentNodeCount',
    'selfLoopCount',
    'zeroCostEdgeCount',
  ], 'route graph candidate.counts');
  for (const [key, entry] of Object.entries(value)) {
    nonNegativeInteger(entry, `route graph candidate.counts.${key}`);
  }
  for (const [key, entry] of Object.entries(measured)) {
    if (value[key] !== entry) {
      fail(`route graph candidate.counts.${key} must match the recomputed candidate mechanics`);
    }
  }
  return value;
}

function validateDirectionGroups(groups) {
  for (const [sourceEdgeId, group] of groups) {
    const traversals = [...group.traversals].sort(compareCodeUnits);
    const expected = group.sourceDirection === 'bidirectional'
      ? ['forward', 'reverse']
      : [group.sourceDirection];
    if (traversals.length !== expected.length
      || traversals.some((entry, index) => entry !== expected[index])) {
      fail(`route graph candidate source edge ${sourceEdgeId} traversal set is inconsistent`);
    }
    if (group.sourceDirection === 'bidirectional') {
      const forward = group.edges.find((edge) => edge.traversal === 'forward');
      const reverse = group.edges.find((edge) => edge.traversal === 'reverse');
      if (!forward || !reverse
        || canonicalStringify([...forward.geometry].reverse())
          !== canonicalStringify(reverse.geometry)) {
        fail(`route graph candidate source edge ${sourceEdgeId} reverse geometry drifted`);
      }
    }
  }
}

function admitRouteGraphCandidateMechanicsValue(value) {
  const graph = exactObject(value, [
    'schema',
    'dataClassification',
    'sourceId',
    'sourceKind',
    'profileId',
    'mode',
    'nodes',
    'edges',
    'topologyIdentity',
    'geometryIdentity',
    'counts',
    'limitations',
  ], 'route graph candidate');
  exactString(
    graph.schema,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.routeGraphCandidate,
    'route graph candidate.schema',
  );
  exactString(
    graph.dataClassification,
    'candidate-synthetic-fixture',
    'route graph candidate.dataClassification',
  );
  syntheticId(graph.sourceId, 'route graph candidate.sourceId');
  exactString(graph.sourceKind, 'synthetic', 'route graph candidate.sourceKind');
  syntheticId(graph.profileId, 'route graph candidate.profileId');
  exactString(graph.mode, 'walk', 'route graph candidate.mode');
  boundedTextArray(graph.limitations, 'route graph candidate.limitations');

  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0 || graph.nodes.length > MAX_NODES) {
    fail('route graph candidate.nodes length is outside the supported range');
  }
  const nodeIds = new Set();
  const sourceNodeIds = new Set();
  const nodes = graph.nodes.map((rawNode, index) => {
    const label = `route graph candidate.nodes[${index}]`;
    const node = exactObject(rawNode, ['id', 'sourceNodeId', 'coordinate'], label);
    boundedId(node.id, `${label}.id`);
    syntheticId(node.sourceNodeId, `${label}.sourceNodeId`);
    if (nodeIds.has(node.id)) fail(`route graph candidate contains duplicate node id ${node.id}`);
    if (sourceNodeIds.has(node.sourceNodeId)) {
      fail(`route graph candidate contains duplicate source node id ${node.sourceNodeId}`);
    }
    nodeIds.add(node.id);
    sourceNodeIds.add(node.sourceNodeId);
    if (node.id !== stableNodeId(graph.sourceId, node.sourceNodeId)) {
      fail(`${label}.id must be the deterministic route-graph-candidate/v1 node id`);
    }
    if (index > 0 && compareCodeUnits(graph.nodes[index - 1].id, node.id) >= 0) {
      fail('route graph candidate.nodes must use strict id code-unit order');
    }
    return {
      id: node.id,
      sourceNodeId: node.sourceNodeId,
      coordinate: coordinate(node.coordinate, `${label}.coordinate`),
    };
  });

  if (!Array.isArray(graph.edges) || graph.edges.length === 0 || graph.edges.length > MAX_EDGES) {
    fail('route graph candidate.edges length is outside the supported range');
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeIds = new Set();
  const exactDirectedEdges = new Set();
  const directionGroups = new Map();
  let geometryPointCount = 0;
  const edges = graph.edges.map((rawEdge, index) => {
    const label = `route graph candidate.edges[${index}]`;
    const edge = exactObject(rawEdge, [
      'id',
      'sourceEdgeId',
      'fromNodeId',
      'toNodeId',
      'cost',
      'geometry',
      'traversal',
      'sourceDirection',
    ], label);
    boundedId(edge.id, `${label}.id`);
    syntheticId(edge.sourceEdgeId, `${label}.sourceEdgeId`);
    boundedId(edge.fromNodeId, `${label}.fromNodeId`);
    boundedId(edge.toNodeId, `${label}.toNodeId`);
    if (edgeIds.has(edge.id)) fail(`route graph candidate contains duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (index > 0 && compareCodeUnits(graph.edges[index - 1].id, edge.id) >= 0) {
      fail('route graph candidate.edges must use strict id code-unit order');
    }
    if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) {
      fail(`${label} must bind existing endpoint ids`);
    }
    if (edge.id !== stableEdgeId(graph.sourceId, edge.sourceEdgeId, edge.traversal)) {
      fail(`${label}.id must be the deterministic route-graph-candidate/v1 edge id`);
    }
    nonNegativeInteger(edge.cost, `${label}.cost`);
    if (!['forward', 'reverse'].includes(edge.traversal)) {
      fail(`${label}.traversal is unsupported`);
    }
    if (!['forward', 'reverse', 'bidirectional'].includes(edge.sourceDirection)) {
      fail(`${label}.sourceDirection is unsupported`);
    }
    const geometry = geometryLine(edge.geometry, `${label}.geometry`);
    geometryPointCount += geometry.length;
    if (geometryPointCount > MAX_GEOMETRY_POINTS) {
      fail('route graph candidate geometry contains too many points');
    }
    if (!sameCoordinate(geometry[0], nodeById.get(edge.fromNodeId).coordinate)
      || !sameCoordinate(geometry[geometry.length - 1], nodeById.get(edge.toNodeId).coordinate)) {
      fail(`${label}.geometry endpoints must exactly match from/to node coordinates`);
    }
    const exactKey = canonicalStringify([
      edge.fromNodeId, edge.toNodeId, edge.cost, geometry,
    ]);
    if (exactDirectedEdges.has(exactKey)) {
      fail(`${label} duplicates an exact directed route-graph-candidate/v1 edge`);
    }
    exactDirectedEdges.add(exactKey);
    const admitted = {
      id: edge.id,
      sourceEdgeId: edge.sourceEdgeId,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      cost: edge.cost,
      geometry,
      traversal: edge.traversal,
      sourceDirection: edge.sourceDirection,
    };
    const group = directionGroups.get(edge.sourceEdgeId) || {
      sourceDirection: edge.sourceDirection,
      traversals: [],
      edges: [],
    };
    if (group.sourceDirection !== edge.sourceDirection) {
      fail(`${label}.sourceDirection conflicts within one source edge`);
    }
    group.traversals.push(edge.traversal);
    group.edges.push(admitted);
    directionGroups.set(edge.sourceEdgeId, group);
    return admitted;
  });
  validateDirectionGroups(directionGroups);

  const components = computeWeakComponents(nodes, edges);
  if (components.isolatedNodeCount !== 0) {
    fail('route graph candidate compact mechanics do not admit isolated nodes');
  }
  const measuredCounts = {
    nodeCount: nodes.length,
    directedEdgeCount: edges.length,
    weakComponentCount: components.count,
    largestWeakComponentNodeCount: components.largestNodeCount,
    selfLoopCount: edges.filter((edge) => edge.fromNodeId === edge.toNodeId).length,
    zeroCostEdgeCount: edges.filter((edge) => edge.cost === 0).length,
  };
  validateCandidateCounts(graph.counts, measuredCounts);
  if (graph.counts.physicalFeatureCount
    !== directionGroups.size + graph.counts.excludedAccessCount) {
    fail('route graph candidate.counts.physicalFeatureCount must match source features plus exclusions');
  }
  if (typeof graph.topologyIdentity !== 'string' || !IDENTITY_PATTERN.test(graph.topologyIdentity)) {
    fail('route graph candidate.topologyIdentity must be a lowercase sha256 identity');
  }
  if (typeof graph.geometryIdentity !== 'string' || !IDENTITY_PATTERN.test(graph.geometryIdentity)) {
    fail('route graph candidate.geometryIdentity must be a lowercase sha256 identity');
  }
  const identityProjection = {
    ...graph,
    nodes,
    edges,
  };
  if (graph.topologyIdentity !== candidateTopologyDigest(identityProjection)) {
    fail('route graph candidate.topologyIdentity drifted');
  }
  if (graph.geometryIdentity !== candidateGeometryDigest(identityProjection)) {
    fail('route graph candidate.geometryIdentity drifted');
  }
  return {
    schema: graph.schema,
    dataClassification: graph.dataClassification,
    sourceId: graph.sourceId,
    sourceKind: graph.sourceKind,
    profileId: graph.profileId,
    mode: graph.mode,
    nodes,
    edges,
    topologyIdentity: graph.topologyIdentity,
    geometryIdentity: graph.geometryIdentity,
    counts: graph.counts,
    limitations: graph.limitations,
    components,
    geometryPointCount,
  };
}

function candidateGraphValue(graph) {
  return {
    schema: graph.schema,
    dataClassification: graph.dataClassification,
    sourceId: graph.sourceId,
    sourceKind: graph.sourceKind,
    profileId: graph.profileId,
    mode: graph.mode,
    nodes: graph.nodes,
    edges: graph.edges,
    topologyIdentity: graph.topologyIdentity,
    geometryIdentity: graph.geometryIdentity,
    counts: graph.counts,
    limitations: graph.limitations,
  };
}

function compactCounts(graph) {
  return {
    ...graph.counts,
    geometryPointCount: graph.geometryPointCount,
    isolatedNodeCount: graph.components.isolatedNodeCount,
  };
}

function compileRouteGraphCandidateProjection(graph) {
  const nodeIndexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const topology = contentIdentity(
    candidateTopologyProjection(graph),
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.topologyIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.topology,
  );
  const geometry = contentIdentity(
    candidateGeometryProjection(graph),
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.geometryIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.geometry,
  );
  const candidate = contentIdentity(
    candidateGraphValue(graph),
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.candidateIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.candidate,
  );
  const edges = graph.edges.map((edge, geometryIndex) => ({
    edgeId: edge.id,
    sourceEdgeId: edge.sourceEdgeId,
    fromNodeIndex: nodeIndexById.get(edge.fromNodeId),
    toNodeIndex: nodeIndexById.get(edge.toNodeId),
    cost: edge.cost,
    traversal: edge.traversal,
    sourceDirection: edge.sourceDirection,
    componentId: graph.components.byNodeIndex[nodeIndexById.get(edge.fromNodeId)],
    geometryIndex,
  }));
  const outgoing = Array.from({ length: graph.nodes.length }, () => []);
  edges.forEach((edge, edgeIndex) => outgoing[edge.fromNodeIndex].push(edgeIndex));
  const offsets = [0];
  const edgeIndexes = [];
  for (const indexes of outgoing) {
    edgeIndexes.push(...indexes);
    offsets.push(edgeIndexes.length);
  }
  const counts = compactCounts(graph);
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.graphProjection,
    graph: {
      sourceSchema: graph.schema,
      dataClassification: graph.dataClassification,
      sourceId: graph.sourceId,
      sourceKind: graph.sourceKind,
      profileId: graph.profileId,
      mode: graph.mode,
      directed: true,
    },
    encoding: {
      schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.encoding,
      nodeOrder: 'candidate-node-id-code-unit-ascending',
      edgeOrder: 'candidate-edge-id-code-unit-ascending',
      adjacencyRepresentation: 'outgoing-offsets-plus-edge-index/v1',
      geometryRepresentation: 'edge-aligned-candidate-coordinate-arrays/v1',
      integerCostSemantics: {
        cost: 'non-negative-safe-integer-millimetres',
      },
      additionalCostDimensions:
        'forbidden-without-separate-reviewed-profile-and-identity',
    },
    nodes: graph.nodes.map((node, index) => ({
      nodeId: node.id,
      sourceNodeId: node.sourceNodeId,
      coordinate: node.coordinate,
      componentId: graph.components.byNodeIndex[index],
    })),
    edges,
    geometries: graph.edges.map((edge) => edge.geometry),
    adjacency: { offsets, edgeIndexes },
    components: {
      kind: 'weakly-connected',
      count: graph.components.count,
      byNodeIndex: graph.components.byNodeIndex,
      nodeCounts: graph.components.nodeCounts,
    },
    counts,
    candidateLimitations: graph.limitations,
    topologyAudit: {
      schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.topologyAudit,
      status: 'passed',
      counts,
      topologyIdentity: topology,
      geometryIdentity: geometry,
    },
    identities: { candidate, topology, geometry },
  };
}

function candidateCountsFromCompact(value) {
  exactObject(value, [
    'physicalFeatureCount',
    'excludedAccessCount',
    'nodeCount',
    'directedEdgeCount',
    'weakComponentCount',
    'largestWeakComponentNodeCount',
    'selfLoopCount',
    'zeroCostEdgeCount',
    'geometryPointCount',
    'isolatedNodeCount',
  ], 'graph projection.counts');
  return {
    physicalFeatureCount: value.physicalFeatureCount,
    excludedAccessCount: value.excludedAccessCount,
    nodeCount: value.nodeCount,
    directedEdgeCount: value.directedEdgeCount,
    weakComponentCount: value.weakComponentCount,
    largestWeakComponentNodeCount: value.largestWeakComponentNodeCount,
    selfLoopCount: value.selfLoopCount,
    zeroCostEdgeCount: value.zeroCostEdgeCount,
  };
}

function reconstructRouteGraphCandidate(value) {
  exactObject(value, [
    'schemaVersion',
    'graph',
    'encoding',
    'nodes',
    'edges',
    'geometries',
    'adjacency',
    'components',
    'counts',
    'candidateLimitations',
    'topologyAudit',
    'identities',
  ], 'graph projection');
  exactString(
    value.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.graphProjection,
    'graph projection.schemaVersion',
  );
  exactObject(value.graph, [
    'sourceSchema',
    'dataClassification',
    'sourceId',
    'sourceKind',
    'profileId',
    'mode',
    'directed',
  ], 'graph projection.graph');
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > MAX_NODES) {
    fail('graph projection.nodes length is outside the supported range');
  }
  if (!Array.isArray(value.edges) || value.edges.length === 0 || value.edges.length > MAX_EDGES) {
    fail('graph projection.edges length is outside the supported range');
  }
  if (!Array.isArray(value.geometries) || value.geometries.length !== value.edges.length) {
    fail('graph projection.geometries must align one-to-one with edges');
  }
  const nodes = value.nodes.map((rawNode, index) => {
    const node = exactObject(
      rawNode,
      ['nodeId', 'sourceNodeId', 'coordinate', 'componentId'],
      `graph projection.nodes[${index}]`,
    );
    nonNegativeInteger(node.componentId, `graph projection.nodes[${index}].componentId`);
    return {
      id: node.nodeId,
      sourceNodeId: node.sourceNodeId,
      coordinate: node.coordinate,
    };
  });
  const edges = value.edges.map((rawEdge, index) => {
    const label = `graph projection.edges[${index}]`;
    const edge = exactObject(rawEdge, [
      'edgeId',
      'sourceEdgeId',
      'fromNodeIndex',
      'toNodeIndex',
      'cost',
      'traversal',
      'sourceDirection',
      'componentId',
      'geometryIndex',
    ], label);
    const fromNodeIndex = nonNegativeInteger(
      edge.fromNodeIndex,
      `${label}.fromNodeIndex`,
      nodes.length - 1,
    );
    const toNodeIndex = nonNegativeInteger(
      edge.toNodeIndex,
      `${label}.toNodeIndex`,
      nodes.length - 1,
    );
    nonNegativeInteger(edge.componentId, `${label}.componentId`);
    const geometryIndex = nonNegativeInteger(
      edge.geometryIndex,
      `${label}.geometryIndex`,
      value.geometries.length - 1,
    );
    if (geometryIndex !== index) {
      fail('graph projection geometry indexes must exactly follow edge order');
    }
    return {
      id: edge.edgeId,
      sourceEdgeId: edge.sourceEdgeId,
      fromNodeId: nodes[fromNodeIndex].id,
      toNodeId: nodes[toNodeIndex].id,
      cost: edge.cost,
      geometry: value.geometries[geometryIndex],
      traversal: edge.traversal,
      sourceDirection: edge.sourceDirection,
    };
  });
  exactObject(value.identities, ['candidate', 'topology', 'geometry'], 'graph projection.identities');
  identityShape(
    value.identities.candidate,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.candidateIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.candidate,
    'graph projection.identities.candidate',
  );
  identityShape(
    value.identities.topology,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.topologyIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.topology,
    'graph projection.identities.topology',
  );
  identityShape(
    value.identities.geometry,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.geometryIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.geometry,
    'graph projection.identities.geometry',
  );
  return admitRouteGraphCandidateMechanicsValue({
    schema: value.graph.sourceSchema,
    dataClassification: value.graph.dataClassification,
    sourceId: value.graph.sourceId,
    sourceKind: value.graph.sourceKind,
    profileId: value.graph.profileId,
    mode: value.graph.mode,
    nodes,
    edges,
    topologyIdentity: value.identities.topology.digest,
    geometryIdentity: value.identities.geometry.digest,
    counts: candidateCountsFromCompact(value.counts),
    limitations: value.candidateLimitations,
  });
}

function validateGraphProjectionValue(value) {
  const graph = reconstructRouteGraphCandidate(value);
  const expected = compileRouteGraphCandidateProjection(graph);
  if (canonicalStringify(value) !== canonicalStringify(expected)) {
    fail('graph projection topology, geometry, one-cost values, counts, components, adjacency, or identities drifted');
  }
  return { value, graph };
}

function validateDependencyPlaceholders(value) {
  exactObject(value, DEPENDENCY_KINDS, 'synthetic fixture.dependencyPlaceholders');
  const records = {};
  for (const kind of DEPENDENCY_KINDS) {
    const label = `synthetic fixture.dependencyPlaceholders.${kind}`;
    const record = exactObject(value[kind], [
      'schemaVersion', 'recordId', 'dataClassification', 'dependencyLane', 'contractStatus',
    ], label);
    exactString(
      record.schemaVersion,
      `engagement-route-real-compact-graph-${kind}-dependency-fixture/v1`,
      `${label}.schemaVersion`,
    );
    syntheticId(record.recordId, `${label}.recordId`);
    exactString(
      record.dataClassification,
      'synthetic-construction-only',
      `${label}.dataClassification`,
    );
    exactString(record.dependencyLane, FIXTURE_LANES[kind], `${label}.dependencyLane`);
    exactString(
      record.contractStatus,
      'primitive-fixture-placeholder-only',
      `${label}.contractStatus`,
    );
    records[kind] = record;
  }
  return records;
}

function dependencyPlaceholderBindingsFor(placeholders) {
  const bindings = {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.dependencyPlaceholderBindings,
  };
  for (const kind of DEPENDENCY_KINDS) {
    const record = placeholders[kind];
    bindings[kind] = {
      recordSchemaVersion: record.schemaVersion,
      recordId: record.recordId,
      contentIdentity: contentIdentity(
        record,
        REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.dependencyPlaceholderIdentity,
        REAL_COMPACT_GRAPH_CANONICALIZATIONS.dependencyPlaceholder,
      ),
    };
  }
  return bindings;
}

function validateDependencyPlaceholderBindings(value) {
  exactObject(
    value,
    ['schemaVersion', ...DEPENDENCY_KINDS],
    'synthetic dependency placeholder bindings',
  );
  exactString(
    value.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.dependencyPlaceholderBindings,
    'synthetic dependency placeholder bindings.schemaVersion',
  );
  for (const kind of DEPENDENCY_KINDS) {
    const label = `synthetic dependency placeholder bindings.${kind}`;
    const binding = exactObject(
      value[kind],
      ['recordSchemaVersion', 'recordId', 'contentIdentity'],
      label,
    );
    exactString(
      binding.recordSchemaVersion,
      `engagement-route-real-compact-graph-${kind}-dependency-fixture/v1`,
      `${label}.recordSchemaVersion`,
    );
    syntheticId(binding.recordId, `${label}.recordId`);
    identityShape(
      binding.contentIdentity,
      REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.dependencyPlaceholderIdentity,
      REAL_COMPACT_GRAPH_CANONICALIZATIONS.dependencyPlaceholder,
      `${label}.contentIdentity`,
    );
  }
  return value;
}

function syntheticClaimBoundary() {
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.claimBoundary,
    classification: 'synthetic-construction-only',
    eligibleClaims: [...SYNTHETIC_CONSTRUCTION_ELIGIBLE_CLAIMS],
    limitations: [...SYNTHETIC_CONSTRUCTION_LIMITATIONS],
  };
}

function syntheticSourceHealthBoundary() {
  return {
    state: 'not-authorized-synthetic-construction',
    catalogMutationAuthorized: false,
    currentClaimAllowed: false,
    callerCurrentCanIncreaseAuthority: false,
  };
}

function syntheticLicenceBoundary() {
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.licenceBoundary,
    fixtureDataLicense: 'not-applicable-synthetic-construction',
    realArtifactDatabaseLicenseRequirement: 'ODbL-1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attributionText: '© OpenStreetMap contributors',
    attributionUrl: 'https://www.openstreetmap.org/copyright',
    derivativeDatabaseRequirement: true,
    appliesToFixture: false,
  };
}

function syntheticMaterialization(constructedAt, buildIdentity) {
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.materialization,
    status: 'synthetic-construction-only-not-materialized',
    constructedAt,
    artifactPath: null,
    rebuildMethod: {
      status: 'unavailable-synthetic-fixture',
      buildPlaceholderIdentity: buildIdentity,
      publicMethodRef: null,
      machineReadableGraphRef: null,
    },
  };
}

function admitSyntheticConstructionFixtureValue(value) {
  const fixture = exactObject(value, [
    'schemaVersion',
    'fixtureId',
    'dataClassification',
    'constructedAt',
    'dependencyPlaceholders',
    'routeGraphCandidate',
  ], 'synthetic construction fixture');
  exactString(
    fixture.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixture,
    'synthetic construction fixture.schemaVersion',
  );
  syntheticId(fixture.fixtureId, 'synthetic construction fixture.fixtureId');
  exactString(
    fixture.dataClassification,
    'synthetic-construction-only',
    'synthetic construction fixture.dataClassification',
  );
  exactTimestamp(fixture.constructedAt, 'synthetic construction fixture.constructedAt');
  const dependencyPlaceholders = validateDependencyPlaceholders(fixture.dependencyPlaceholders);
  const graph = admitRouteGraphCandidateMechanicsValue(fixture.routeGraphCandidate);
  return { value: fixture, dependencyPlaceholders, graph };
}

function syntheticFixtureIdentityFor(fixture) {
  return contentIdentity(
    fixture,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixtureIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticFixture,
  );
}

function assertAcceptedSyntheticConstructionFixture(fixture, label) {
  const fixtureInputIdentity = syntheticFixtureIdentityFor(fixture.value);
  if (fixture.value.fixtureId !== ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureId
    || fixtureInputIdentity.digest
      !== ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureInputDigest) {
    fail(`${label} is not the one exact accepted mechanics fixture; expected ${ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureId} at ${ACCEPTED_SYNTHETIC_CONSTRUCTION_FIXTURE.fixtureInputDigest}`);
  }
  return fixtureInputIdentity;
}

function buildSyntheticConstructionObservation(fixture) {
  const fixtureInputIdentity = assertAcceptedSyntheticConstructionFixture(
    fixture,
    'synthetic construction observation source fixture',
  );
  const dependencyPlaceholderBindings = dependencyPlaceholderBindingsFor(
    fixture.dependencyPlaceholders,
  );
  const projection = {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservation,
    fixtureId: fixture.value.fixtureId,
    dataClassification: 'synthetic-construction-only',
    compiler: {
      schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.compiler,
      deterministic: true,
      executionBoundary: 'node-build-time-only',
      productionBridgeStatus: 'dependency-contract-unavailable',
      productionAuthorityState: 'authority-unavailable',
    },
    fixtureInputIdentity,
    dependencyStatus: REAL_COMPACT_GRAPH_DEPENDENCY_STATUS,
    dependencyPlaceholders: fixture.dependencyPlaceholders,
    dependencyPlaceholderBindings,
    sourceHealthBoundary: syntheticSourceHealthBoundary(),
    graphProjection: compileRouteGraphCandidateProjection(fixture.graph),
    licenceBoundary: syntheticLicenceBoundary(),
    materialization: syntheticMaterialization(
      fixture.value.constructedAt,
      dependencyPlaceholderBindings.build.contentIdentity,
    ),
    claimBoundary: syntheticClaimBoundary(),
  };
  return {
    ...projection,
    observationIdentity: contentIdentity(
      projection,
      REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
      REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
    ),
  };
}

function reconstructFixtureFromObservation(value) {
  const { graph } = validateGraphProjectionValue(value.graphProjection);
  return {
    schemaVersion: REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixture,
    fixtureId: value.fixtureId,
    dataClassification: value.dataClassification,
    constructedAt: value.materialization.constructedAt,
    dependencyPlaceholders: value.dependencyPlaceholders,
    routeGraphCandidate: candidateGraphValue(graph),
  };
}

function validateSyntheticObservationValue(value) {
  exactObject(value, [
    'schemaVersion',
    'fixtureId',
    'dataClassification',
    'compiler',
    'fixtureInputIdentity',
    'dependencyStatus',
    'dependencyPlaceholders',
    'dependencyPlaceholderBindings',
    'sourceHealthBoundary',
    'graphProjection',
    'licenceBoundary',
    'materialization',
    'claimBoundary',
    'observationIdentity',
  ], 'synthetic construction observation');
  exactString(
    value.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservation,
    'synthetic construction observation.schemaVersion',
  );
  syntheticId(value.fixtureId, 'synthetic construction observation.fixtureId');
  exactString(
    value.dataClassification,
    'synthetic-construction-only',
    'synthetic construction observation.dataClassification',
  );
  exactObject(value.compiler, [
    'schemaVersion',
    'deterministic',
    'executionBoundary',
    'productionBridgeStatus',
    'productionAuthorityState',
  ], 'synthetic construction observation.compiler');
  exactString(
    value.compiler.schemaVersion,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.compiler,
    'synthetic construction observation.compiler.schemaVersion',
  );
  if (value.compiler.deterministic !== true) {
    fail('synthetic construction observation.compiler.deterministic must be true');
  }
  exactString(
    value.compiler.executionBoundary,
    'node-build-time-only',
    'synthetic construction observation.compiler.executionBoundary',
  );
  exactString(
    value.compiler.productionBridgeStatus,
    'dependency-contract-unavailable',
    'synthetic construction observation.compiler.productionBridgeStatus',
  );
  exactString(
    value.compiler.productionAuthorityState,
    'authority-unavailable',
    'synthetic construction observation.compiler.productionAuthorityState',
  );
  identityShape(
    value.fixtureInputIdentity,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticFixtureIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticFixture,
    'synthetic construction observation.fixtureInputIdentity',
  );
  if (canonicalStringify(value.dependencyStatus)
    !== canonicalStringify(REAL_COMPACT_GRAPH_DEPENDENCY_STATUS)) {
    fail('synthetic construction observation production dependency status drifted');
  }
  const placeholders = validateDependencyPlaceholders(value.dependencyPlaceholders);
  validateDependencyPlaceholderBindings(value.dependencyPlaceholderBindings);
  const expectedBindings = dependencyPlaceholderBindingsFor(placeholders);
  if (canonicalStringify(value.dependencyPlaceholderBindings)
    !== canonicalStringify(expectedBindings)) {
    fail('synthetic construction observation dependency placeholder identities drifted');
  }
  if (canonicalStringify(value.sourceHealthBoundary)
    !== canonicalStringify(syntheticSourceHealthBoundary())) {
    fail('synthetic construction observation cannot claim Source Health current or mutation authority');
  }
  if (canonicalStringify(value.licenceBoundary)
    !== canonicalStringify(syntheticLicenceBoundary())) {
    fail('synthetic construction observation licence and attribution boundary drifted');
  }
  exactObject(value.materialization, [
    'schemaVersion', 'status', 'constructedAt', 'artifactPath', 'rebuildMethod',
  ], 'synthetic construction observation.materialization');
  exactTimestamp(
    value.materialization.constructedAt,
    'synthetic construction observation.materialization.constructedAt',
  );
  const expectedMaterialization = syntheticMaterialization(
    value.materialization.constructedAt,
    expectedBindings.build.contentIdentity,
  );
  if (canonicalStringify(value.materialization) !== canonicalStringify(expectedMaterialization)) {
    fail('synthetic construction observation materialization or rebuild boundary drifted');
  }
  if (canonicalStringify(value.claimBoundary) !== canonicalStringify(syntheticClaimBoundary())) {
    fail('synthetic construction observation claim boundary drifted');
  }
  const reconstructedFixture = reconstructFixtureFromObservation(value);
  const fixture = admitSyntheticConstructionFixtureValue(reconstructedFixture);
  const expectedFixtureIdentity = assertAcceptedSyntheticConstructionFixture(
    fixture,
    'synthetic construction observation fixture identity',
  );
  if (!sameIdentity(value.fixtureInputIdentity, expectedFixtureIdentity)) {
    fail('synthetic construction observation fixture input identity drifted');
  }
  identityShape(
    value.observationIdentity,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
    'synthetic construction observation.observationIdentity',
  );
  const projection = { ...value };
  delete projection.observationIdentity;
  const expectedObservationIdentity = contentIdentity(
    projection,
    REAL_COMPACT_GRAPH_SCHEMA_VERSIONS.syntheticObservationIdentity,
    REAL_COMPACT_GRAPH_CANONICALIZATIONS.syntheticObservation,
  );
  if (!sameIdentity(value.observationIdentity, expectedObservationIdentity)) {
    fail('synthetic construction observation identity drifted');
  }
  return value;
}

export function parseSyntheticConstructionObservation(serializedJson) {
  return deepFreeze(validateSyntheticObservationValue(strictRealCompactJsonParse(serializedJson)));
}

function parseSyntheticConstructionFixture(serializedJson) {
  return admitSyntheticConstructionFixtureValue(strictRealCompactJsonParse(serializedJson));
}

export function compileSyntheticConstructionObservation(serializedFixture) {
  const fixture = parseSyntheticConstructionFixture(serializedFixture);
  assertAcceptedSyntheticConstructionFixture(fixture, 'synthetic construction input');
  const candidate = buildSyntheticConstructionObservation(fixture);
  const serializedObservation = canonicalStringify(candidate);
  const observation = parseSyntheticConstructionObservation(serializedObservation);
  return deepFreeze({ observation, serializedObservation });
}
