import {
  canonicalStringify,
  compareCodeUnits,
  contentIdentity,
  deepFreeze,
} from './canonical_v1.js';
import { strictJsonParse } from './strict_json_v1.js';

const MAX_ID_LENGTH = 120;
const MAX_GRAPH_NODES = 100_000;
const MAX_GRAPH_EDGES = 250_000;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export const COMPACT_GRAPH_SCHEMA_VERSIONS = deepFreeze({
  artifact: 'engagement-route-compact-directed-graph/v1',
  encoding: 'engagement-route-compact-directed-graph-encoding/v1',
  artifactIdentity: 'engagement-route-compact-directed-graph-content-identity/v1',
  sourceIdentity: 'engagement-route-graph-content-identity/v1',
  claimBoundary: 'engagement-route-compact-graph-claim-boundary/v1',
  manifest: 'engagement-route-s6-compact-graph-manifest/v1',
  manifestIdentity: 'engagement-route-s6-compact-graph-manifest-identity/v1',
  compiler: 'engagement-route-s6-compact-graph-compiler/v1',
  graphArtifact: 'engagement-route-graph/v1',
});

export const COMPACT_GRAPH_CANONICALIZATIONS = deepFreeze({
  artifact: 'route-compact-directed-graph-canonical-json/v1',
  source: 'route-graph-canonical-json/v1',
  manifest: 'route-s6-compact-graph-manifest-canonical-json/v1',
});

export const COMPACT_GRAPH_ELIGIBLE_CLAIMS = deepFreeze([
  'deterministic-compact-compilation-from-exact-synthetic-graph-artifact',
]);

export const COMPACT_GRAPH_LIMITATIONS = deepFreeze([
  'synthetic-input-only',
  'not-real-city-data',
  'not-source-authenticity-or-external-graph-authority',
  'not-source-health-current',
  'not-product-graph-admission',
  'not-runtime-loader-worker-current-pointer-or-rollback',
  'not-performance-evidence',
  'not-publication-authority',
  'not-safety-safer-route-accessibility-outcome-or-scientific-validity',
  'digest-proves-internal-consistency-only',
]);

function fail(message) {
  throw new TypeError(`CompactDirectedGraph/v1 contract: ${message}`);
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

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_IDS.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function syntheticId(value, label) {
  const admitted = boundedId(value, label);
  if (!admitted.startsWith('synthetic-')) fail(`${label} must identify synthetic input`);
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

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) {
    fail(`${label} must match the exact frozen vocabulary`);
  }
  return value;
}

function contentIdentityShape(value, schemaVersion, canonicalization, label) {
  exactObject(value, [
    'schemaVersion', 'canonicalization', 'digestAlgorithm', 'canonicalUtf8Bytes', 'digest',
  ], label);
  exactString(value.schemaVersion, schemaVersion, `${label}.schemaVersion`);
  exactString(value.canonicalization, canonicalization, `${label}.canonicalization`);
  exactString(value.digestAlgorithm, 'sha256', `${label}.digestAlgorithm`);
  positiveInteger(value.canonicalUtf8Bytes, `${label}.canonicalUtf8Bytes`);
  if (typeof value.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.digest)) {
    fail(`${label}.digest must be a lowercase sha256 digest`);
  }
  return value;
}

function sourceGraphIdentity(value, label) {
  exactObject(value, [
    'schemaVersion', 'graphId', 'artifactVersion', 'contentIdentity',
  ], label);
  exactString(value.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.graphArtifact,
    `${label}.schemaVersion`);
  boundedId(value.graphId, `${label}.graphId`);
  boundedId(value.artifactVersion, `${label}.artifactVersion`);
  contentIdentityShape(
    value.contentIdentity,
    COMPACT_GRAPH_SCHEMA_VERSIONS.sourceIdentity,
    COMPACT_GRAPH_CANONICALIZATIONS.source,
    `${label}.contentIdentity`,
  );
  return value;
}

function claimBoundary(value, label) {
  exactObject(value, ['schemaVersion', 'classification', 'eligibleClaims', 'limitations'], label);
  exactString(value.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.claimBoundary,
    `${label}.schemaVersion`);
  exactString(value.classification, 'synthetic-only', `${label}.classification`);
  exactArray(value.eligibleClaims, COMPACT_GRAPH_ELIGIBLE_CLAIMS, `${label}.eligibleClaims`);
  exactArray(value.limitations, COMPACT_GRAPH_LIMITATIONS, `${label}.limitations`);
  return value;
}

function uniqueSortedIds(value, label, { min = 0, max, synthetic = false } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(`${label} length is outside the supported range`);
  }
  const admitted = value.map((entry, index) => (
    synthetic ? syntheticId(entry, `${label}[${index}]`) : boundedId(entry, `${label}[${index}]`)
  ));
  if (new Set(admitted).size !== admitted.length) fail(`${label} must not contain duplicates`);
  const sorted = [...admitted].sort(compareCodeUnits);
  if (sorted.some((entry, index) => entry !== admitted[index])) {
    fail(`${label} must use deterministic code-unit order`);
  }
  return admitted;
}

function validateEncoding(value) {
  exactObject(value, [
    'schemaVersion',
    'nodeOrder',
    'edgeOrder',
    'adjacencyRepresentation',
    'integerCostSemantics',
    'modeTaxonomyVersion',
  ], 'artifact.encoding');
  exactString(value.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.encoding,
    'artifact.encoding.schemaVersion');
  exactString(value.nodeOrder, 'node-id-code-unit-ascending', 'artifact.encoding.nodeOrder');
  exactString(value.edgeOrder, 'edge-id-code-unit-ascending', 'artifact.encoding.edgeOrder');
  exactString(value.adjacencyRepresentation, 'outgoing-offsets-plus-edge-index/v1',
    'artifact.encoding.adjacencyRepresentation');
  exactObject(value.integerCostSemantics, ['distanceMm', 'objectiveCostUnits'],
    'artifact.encoding.integerCostSemantics');
  exactString(value.integerCostSemantics.distanceMm, 'non-negative-safe-integer-millimetres',
    'artifact.encoding.integerCostSemantics.distanceMm');
  exactString(value.integerCostSemantics.objectiveCostUnits, 'non-negative-safe-integer-cost-units',
    'artifact.encoding.integerCostSemantics.objectiveCostUnits');
  exactString(value.modeTaxonomyVersion, 'engagement-route-mode-taxonomy/v1',
    'artifact.encoding.modeTaxonomyVersion');
}

function validateGraphHeader(value) {
  exactObject(value, [
    'graphSchemaVersion', 'graphId', 'artifactVersion', 'mode', 'directed', 'nodeCount', 'edgeCount',
  ], 'artifact.graph');
  exactString(value.graphSchemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.graphArtifact,
    'artifact.graph.graphSchemaVersion');
  boundedId(value.graphId, 'artifact.graph.graphId');
  boundedId(value.artifactVersion, 'artifact.graph.artifactVersion');
  exactString(value.mode, 'walk', 'artifact.graph.mode');
  if (value.directed !== true) fail('artifact.graph.directed must be true');
  positiveInteger(value.nodeCount, 'artifact.graph.nodeCount', MAX_GRAPH_NODES);
  nonNegativeInteger(value.edgeCount, 'artifact.graph.edgeCount', MAX_GRAPH_EDGES);
}

function validateEdges(value, graph, nodeIds, componentByNodeIndex) {
  if (!Array.isArray(value) || value.length !== graph.edgeCount) {
    fail('artifact.edges must match artifact.graph.edgeCount');
  }
  const edgeIds = new Set();
  const edges = value.map((rawEdge, index) => {
    const label = `artifact.edges[${index}]`;
    const edge = exactObject(rawEdge, [
      'edgeId', 'fromNodeIndex', 'toNodeIndex', 'distanceMm', 'objectiveCostUnits', 'componentId',
    ], label);
    const edgeId = boundedId(edge.edgeId, `${label}.edgeId`);
    if (edgeIds.has(edgeId)) fail(`artifact.edges contains duplicate edgeId ${edgeId}`);
    edgeIds.add(edgeId);
    if (index > 0 && compareCodeUnits(value[index - 1].edgeId, edgeId) >= 0) {
      fail('artifact.edges must use deterministic edge-id code-unit order');
    }
    const fromNodeIndex = nonNegativeInteger(
      edge.fromNodeIndex, `${label}.fromNodeIndex`, nodeIds.length - 1,
    );
    const toNodeIndex = nonNegativeInteger(
      edge.toNodeIndex, `${label}.toNodeIndex`, nodeIds.length - 1,
    );
    const componentId = nonNegativeInteger(
      edge.componentId, `${label}.componentId`, Math.max(0, componentByNodeIndex.length - 1),
    );
    if (componentByNodeIndex[fromNodeIndex] !== componentId
      || componentByNodeIndex[toNodeIndex] !== componentId) {
      fail(`${label}.componentId must bind both directed endpoints to one declared component`);
    }
    nonNegativeInteger(edge.distanceMm, `${label}.distanceMm`);
    nonNegativeInteger(edge.objectiveCostUnits, `${label}.objectiveCostUnits`);
    return edge;
  });
  return edges;
}

function validateComponents(value, nodeCount) {
  exactObject(value, ['kind', 'count', 'byNodeIndex'], 'artifact.components');
  exactString(value.kind, 'weakly-connected', 'artifact.components.kind');
  positiveInteger(value.count, 'artifact.components.count', nodeCount);
  if (!Array.isArray(value.byNodeIndex) || value.byNodeIndex.length !== nodeCount) {
    fail('artifact.components.byNodeIndex must have one entry per node');
  }
  const seen = new Set();
  const byNodeIndex = value.byNodeIndex.map((entry, index) => {
    const componentId = nonNegativeInteger(
      entry, `artifact.components.byNodeIndex[${index}]`, value.count - 1,
    );
    seen.add(componentId);
    return componentId;
  });
  if (seen.size !== value.count) fail('artifact.components must use every declared component id');
  return byNodeIndex;
}

function validateActualWeakComponents(nodeCount, edges, declaredByNodeIndex, declaredCount) {
  const neighbors = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    neighbors[edge.fromNodeIndex].push(edge.toNodeIndex);
    neighbors[edge.toNodeIndex].push(edge.fromNodeIndex);
  }
  const visited = new Uint8Array(nodeCount);
  const actualToDeclared = new Set();
  let actualCount = 0;
  for (let start = 0; start < nodeCount; start += 1) {
    if (visited[start]) continue;
    actualCount += 1;
    const declared = declaredByNodeIndex[start];
    actualToDeclared.add(declared);
    visited[start] = 1;
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of neighbors[queue[cursor]]) {
        if (declaredByNodeIndex[neighbor] !== declared) {
          fail('artifact.components identity does not match explicit weak topology');
        }
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
  }
  if (actualCount !== declaredCount || actualToDeclared.size !== declaredCount) {
    fail('artifact.components count or identity does not match explicit weak topology');
  }
}

function validateAdjacency(value, nodeCount, edges) {
  exactObject(value, ['offsets', 'edgeIndexes'], 'artifact.adjacency');
  if (!Array.isArray(value.offsets) || value.offsets.length !== nodeCount + 1) {
    fail('artifact.adjacency.offsets must contain nodeCount + 1 entries');
  }
  if (!Array.isArray(value.edgeIndexes) || value.edgeIndexes.length !== edges.length) {
    fail('artifact.adjacency.edgeIndexes must contain every edge exactly once');
  }
  const offsets = value.offsets.map((entry, index) => (
    nonNegativeInteger(entry, `artifact.adjacency.offsets[${index}]`, edges.length)
  ));
  if (offsets[0] !== 0 || offsets[offsets.length - 1] !== edges.length
    || offsets.some((entry, index) => index > 0 && entry < offsets[index - 1])) {
    fail('artifact.adjacency.offsets must be monotonic and span every edge');
  }
  const edgeIndexes = value.edgeIndexes.map((entry, index) => (
    nonNegativeInteger(entry, `artifact.adjacency.edgeIndexes[${index}]`, Math.max(0, edges.length - 1))
  ));
  if (edges.length === 0 && edgeIndexes.length !== 0) {
    fail('artifact.adjacency.edgeIndexes must be empty when the graph has no edges');
  }
  if (new Set(edgeIndexes).size !== edges.length) {
    fail('artifact.adjacency.edgeIndexes must be a permutation of all edge indexes');
  }
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
    let previousEdgeIndex = -1;
    for (let cursor = offsets[nodeIndex]; cursor < offsets[nodeIndex + 1]; cursor += 1) {
      const edgeIndex = edgeIndexes[cursor];
      if (edgeIndex <= previousEdgeIndex) {
        fail('artifact.adjacency edge indexes must preserve deterministic edge-id order');
      }
      if (edges[edgeIndex].fromNodeIndex !== nodeIndex) {
        fail('artifact.adjacency must preserve directed outgoing topology');
      }
      previousEdgeIndex = edgeIndex;
    }
  }
}

function validateProvenance(value, graph) {
  exactObject(value, ['dataClassification', 'sourceIds', 'sourceGraph'], 'artifact.provenance');
  exactString(value.dataClassification, 'synthetic', 'artifact.provenance.dataClassification');
  uniqueSortedIds(value.sourceIds, 'artifact.provenance.sourceIds', {
    min: 1, max: 32, synthetic: true,
  });
  sourceGraphIdentity(value.sourceGraph, 'artifact.provenance.sourceGraph');
  if (value.sourceGraph.graphId !== graph.graphId
    || value.sourceGraph.artifactVersion !== graph.artifactVersion) {
    fail('artifact.provenance.sourceGraph must bind the exact graph identity');
  }
}

function validateArtifact(value) {
  exactObject(value, [
    'schemaVersion',
    'graph',
    'encoding',
    'nodeIds',
    'edges',
    'adjacency',
    'components',
    'provenance',
    'claimBoundary',
    'contentIdentity',
  ], 'artifact');
  exactString(value.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.artifact,
    'artifact.schemaVersion');
  validateGraphHeader(value.graph);
  validateEncoding(value.encoding);
  const nodeIds = uniqueSortedIds(value.nodeIds, 'artifact.nodeIds', {
    min: 1, max: MAX_GRAPH_NODES,
  });
  if (nodeIds.length !== value.graph.nodeCount) fail('artifact.nodeIds must match graph.nodeCount');
  const componentByNodeIndex = validateComponents(value.components, nodeIds.length);
  const edges = validateEdges(value.edges, value.graph, nodeIds, componentByNodeIndex);
  validateActualWeakComponents(
    nodeIds.length, edges, componentByNodeIndex, value.components.count,
  );
  validateAdjacency(value.adjacency, nodeIds.length, edges);
  validateProvenance(value.provenance, value.graph);
  claimBoundary(value.claimBoundary, 'artifact.claimBoundary');
  contentIdentityShape(
    value.contentIdentity,
    COMPACT_GRAPH_SCHEMA_VERSIONS.artifactIdentity,
    COMPACT_GRAPH_CANONICALIZATIONS.artifact,
    'artifact.contentIdentity',
  );
  const projection = { ...value };
  delete projection.contentIdentity;
  const expectedIdentity = contentIdentity(
    projection,
    COMPACT_GRAPH_SCHEMA_VERSIONS.artifactIdentity,
    COMPACT_GRAPH_CANONICALIZATIONS.artifact,
  );
  if (canonicalStringify(value.contentIdentity) !== canonicalStringify(expectedIdentity)) {
    fail('artifact content identity does not match the exact compact graph projection');
  }
  return value;
}

function validateManifest(value) {
  exactObject(value, [
    'schemaVersion',
    'fixtureId',
    'compiler',
    'sourceGraph',
    'compactGraph',
    'claimBoundary',
    'manifestIdentity',
  ], 'manifest');
  exactString(value.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.manifest,
    'manifest.schemaVersion');
  syntheticId(value.fixtureId, 'manifest.fixtureId');
  exactObject(value.compiler, ['schemaVersion', 'deterministic', 'executionBoundary'],
    'manifest.compiler');
  exactString(value.compiler.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.compiler,
    'manifest.compiler.schemaVersion');
  if (value.compiler.deterministic !== true) fail('manifest.compiler.deterministic must be true');
  exactString(value.compiler.executionBoundary, 'node-build-time-only',
    'manifest.compiler.executionBoundary');
  sourceGraphIdentity(value.sourceGraph, 'manifest.sourceGraph');
  exactObject(value.compactGraph, [
    'schemaVersion', 'graphId', 'artifactVersion', 'nodeCount', 'edgeCount', 'contentIdentity',
  ], 'manifest.compactGraph');
  exactString(value.compactGraph.schemaVersion, COMPACT_GRAPH_SCHEMA_VERSIONS.artifact,
    'manifest.compactGraph.schemaVersion');
  boundedId(value.compactGraph.graphId, 'manifest.compactGraph.graphId');
  boundedId(value.compactGraph.artifactVersion, 'manifest.compactGraph.artifactVersion');
  positiveInteger(value.compactGraph.nodeCount, 'manifest.compactGraph.nodeCount', MAX_GRAPH_NODES);
  nonNegativeInteger(value.compactGraph.edgeCount, 'manifest.compactGraph.edgeCount', MAX_GRAPH_EDGES);
  contentIdentityShape(
    value.compactGraph.contentIdentity,
    COMPACT_GRAPH_SCHEMA_VERSIONS.artifactIdentity,
    COMPACT_GRAPH_CANONICALIZATIONS.artifact,
    'manifest.compactGraph.contentIdentity',
  );
  if (value.sourceGraph.graphId !== value.compactGraph.graphId
    || value.sourceGraph.artifactVersion !== value.compactGraph.artifactVersion) {
    fail('manifest sourceGraph and compactGraph identities must match');
  }
  claimBoundary(value.claimBoundary, 'manifest.claimBoundary');
  contentIdentityShape(
    value.manifestIdentity,
    COMPACT_GRAPH_SCHEMA_VERSIONS.manifestIdentity,
    COMPACT_GRAPH_CANONICALIZATIONS.manifest,
    'manifest.manifestIdentity',
  );
  const projection = { ...value };
  delete projection.manifestIdentity;
  const expectedIdentity = contentIdentity(
    projection,
    COMPACT_GRAPH_SCHEMA_VERSIONS.manifestIdentity,
    COMPACT_GRAPH_CANONICALIZATIONS.manifest,
  );
  if (canonicalStringify(value.manifestIdentity) !== canonicalStringify(expectedIdentity)) {
    fail('manifest content identity does not match the exact manifest projection');
  }
  return value;
}

/**
 * Browser boundary for one compact graph. Only primitive JSON text is read, so
 * caller-owned object graphs, accessors, descriptors, and Proxies have no path.
 * A successful parse proves schema and internal content consistency only.
 */
export function parseCompactDirectedGraphArtifact(serializedJson) {
  return deepFreeze(validateArtifact(strictJsonParse(serializedJson)));
}

export function parseSyntheticCompactGraphManifest(serializedJson) {
  return deepFreeze(validateManifest(strictJsonParse(serializedJson)));
}

export function parseSyntheticCompactGraphBundle(artifactJson, manifestJson) {
  const artifact = parseCompactDirectedGraphArtifact(artifactJson);
  const manifest = parseSyntheticCompactGraphManifest(manifestJson);
  if (manifest.compactGraph.graphId !== artifact.graph.graphId
    || manifest.compactGraph.artifactVersion !== artifact.graph.artifactVersion
    || manifest.compactGraph.nodeCount !== artifact.graph.nodeCount
    || manifest.compactGraph.edgeCount !== artifact.graph.edgeCount
    || canonicalStringify(manifest.compactGraph.contentIdentity)
      !== canonicalStringify(artifact.contentIdentity)
    || canonicalStringify(manifest.sourceGraph)
      !== canonicalStringify(artifact.provenance.sourceGraph)
    || canonicalStringify(manifest.claimBoundary)
      !== canonicalStringify(artifact.claimBoundary)) {
    fail('manifest does not bind the exact compact graph artifact');
  }
  return deepFreeze({ artifact, manifest });
}
