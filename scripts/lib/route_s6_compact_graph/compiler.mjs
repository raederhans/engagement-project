import { types as utilTypes } from 'node:util';

import { admitGraphArtifact } from '../../../src/route_decision/contracts/index.js';
import {
  COMPACT_GRAPH_CANONICALIZATIONS,
  COMPACT_GRAPH_ELIGIBLE_CLAIMS,
  COMPACT_GRAPH_LIMITATIONS,
  COMPACT_GRAPH_SCHEMA_VERSIONS,
  parseSyntheticCompactGraphBundle,
} from '../../../src/route_generation/compact_graph/contract_v1.js';
import {
  canonicalStringify,
  compareCodeUnits,
  contentIdentity,
  deepFreeze,
} from '../../../src/route_generation/compact_graph/canonical_v1.js';

const MAX_DEPTH = 64;
const MAX_ITEMS = 500_000;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function fail(message) {
  throw new TypeError(`S6 compact graph compiler: ${message}`);
}

function snapshotCompilerInput(raw) {
  const ancestors = new Set();
  const counter = { items: 0 };

  function snapshot(value, label, depth) {
    if (!value || typeof value !== 'object') return value;
    if (utilTypes.isProxy(value)) fail(`${label} must not be a Proxy`);
    if (depth > MAX_DEPTH) fail(`${label} exceeds the supported nesting depth`);
    if (ancestors.has(value)) fail(`${label} must not contain cycles`);
    ancestors.add(value);
    try {
      const isArray = Array.isArray(value);
      const expectedPrototype = isArray ? Array.prototype : Object.prototype;
      if (Object.getPrototypeOf(value) !== expectedPrototype) {
        fail(`${label} must contain plain data containers only`);
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        fail(`${label} must not contain symbol properties`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const mutable = Object.isExtensible(value) && !Object.isFrozen(value);
      const frozen = Object.isFrozen(value);
      if (!mutable && !frozen) fail(`${label} must use either mutable or frozen container descriptors`);

      if (isArray) {
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || lengthDescriptor.enumerable !== false
          || lengthDescriptor.configurable !== false
          || lengthDescriptor.writable !== mutable
          || !Number.isSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0) {
          fail(`${label}.length descriptor does not match its container mode`);
        }
        const length = lengthDescriptor.value;
        const extra = ownKeys.filter((key) => key !== 'length'
          && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
        if (extra.length > 0) fail(`${label} contains unsupported array properties`);
        counter.items += length;
        if (counter.items > MAX_ITEMS) fail('input contains too many items');
        return Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor) fail(`${label} must not contain sparse entries`);
          assertDataDescriptor(descriptor, mutable, `${label}[${index}]`);
          return snapshot(descriptor.value, `${label}[${index}]`, depth + 1);
        });
      }

      counter.items += ownKeys.length;
      if (counter.items > MAX_ITEMS) fail('input contains too many items');
      const result = {};
      for (const key of ownKeys) {
        if (BLOCKED_KEYS.has(key)) fail(`${label}.${key} is prohibited`);
        const descriptor = descriptors[key];
        assertDataDescriptor(descriptor, mutable, `${label}.${key}`);
        result[key] = snapshot(descriptor.value, `${label}.${key}`, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }

  return snapshot(raw, 'GraphArtifact compiler input', 0);
}

function assertDataDescriptor(descriptor, mutable, label) {
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
    fail(`${label} must be an enumerable data property`);
  }
  if (descriptor.writable !== mutable || descriptor.configurable !== mutable) {
    fail(`${label} descriptor does not match its container mode`);
  }
}

function sourceIdentity(graphArtifact) {
  return {
    schemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.graphArtifact,
    graphId: graphArtifact.graphId,
    artifactVersion: graphArtifact.receipt.artifactVersion,
    contentIdentity: contentIdentity(
      graphArtifact,
      COMPACT_GRAPH_SCHEMA_VERSIONS.sourceIdentity,
      COMPACT_GRAPH_CANONICALIZATIONS.source,
    ),
  };
}

function frozenClaimBoundary() {
  return {
    schemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.claimBoundary,
    classification: 'synthetic-only',
    eligibleClaims: [...COMPACT_GRAPH_ELIGIBLE_CLAIMS],
    limitations: [...COMPACT_GRAPH_LIMITATIONS],
  };
}

function compileArtifact(graphArtifact) {
  const nodeIds = graphArtifact.nodes
    .map(({ nodeId }) => nodeId)
    .sort(compareCodeUnits);
  const nodeIndexById = new Map(nodeIds.map((nodeId, index) => [nodeId, index]));
  const componentByNodeIndex = nodeIds.map((nodeId) => graphArtifact.components.byNodeId[nodeId]);
  const edges = graphArtifact.edges
    .map((edge) => ({
      edgeId: edge.edgeId,
      fromNodeIndex: nodeIndexById.get(edge.fromNodeId),
      toNodeIndex: nodeIndexById.get(edge.toNodeId),
      distanceMm: edge.distanceMm,
      objectiveCostUnits: edge.objectiveCostUnits,
      componentId: graphArtifact.components.byNodeId[edge.fromNodeId],
    }))
    .sort((left, right) => compareCodeUnits(left.edgeId, right.edgeId));
  const outgoing = Array.from({ length: nodeIds.length }, () => []);
  edges.forEach((edge, edgeIndex) => outgoing[edge.fromNodeIndex].push(edgeIndex));
  const offsets = [0];
  const edgeIndexes = [];
  for (const indexes of outgoing) {
    edgeIndexes.push(...indexes);
    offsets.push(edgeIndexes.length);
  }
  const sourceGraph = sourceIdentity(graphArtifact);
  const projection = {
    schemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.artifact,
    graph: {
      graphSchemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.graphArtifact,
      graphId: graphArtifact.graphId,
      artifactVersion: graphArtifact.receipt.artifactVersion,
      mode: graphArtifact.mode,
      directed: true,
      nodeCount: nodeIds.length,
      edgeCount: edges.length,
    },
    encoding: {
      schemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.encoding,
      nodeOrder: 'node-id-code-unit-ascending',
      edgeOrder: 'edge-id-code-unit-ascending',
      adjacencyRepresentation: 'outgoing-offsets-plus-edge-index/v1',
      integerCostSemantics: {
        distanceMm: 'non-negative-safe-integer-millimetres',
        objectiveCostUnits: 'non-negative-safe-integer-cost-units',
      },
      modeTaxonomyVersion: 'engagement-route-mode-taxonomy/v1',
    },
    nodeIds,
    edges,
    adjacency: { offsets, edgeIndexes },
    components: {
      kind: 'weakly-connected',
      count: graphArtifact.components.count,
      byNodeIndex: componentByNodeIndex,
    },
    provenance: {
      dataClassification: 'synthetic',
      sourceIds: [...graphArtifact.provenance.sourceIds].sort(compareCodeUnits),
      sourceGraph,
    },
    claimBoundary: frozenClaimBoundary(),
  };
  return {
    ...projection,
    contentIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_SCHEMA_VERSIONS.artifactIdentity,
      COMPACT_GRAPH_CANONICALIZATIONS.artifact,
    ),
  };
}

function compileManifest(artifact, fixtureId) {
  const projection = {
    schemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.manifest,
    fixtureId,
    compiler: {
      schemaVersion: COMPACT_GRAPH_SCHEMA_VERSIONS.compiler,
      deterministic: true,
      executionBoundary: 'node-build-time-only',
    },
    sourceGraph: artifact.provenance.sourceGraph,
    compactGraph: {
      schemaVersion: artifact.schemaVersion,
      graphId: artifact.graph.graphId,
      artifactVersion: artifact.graph.artifactVersion,
      nodeCount: artifact.graph.nodeCount,
      edgeCount: artifact.graph.edgeCount,
      contentIdentity: artifact.contentIdentity,
    },
    claimBoundary: artifact.claimBoundary,
  };
  return {
    ...projection,
    manifestIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_SCHEMA_VERSIONS.manifestIdentity,
      COMPACT_GRAPH_CANONICALIZATIONS.manifest,
    ),
  };
}

/**
 * Deterministically compiles an already synthetic GraphArtifact/v1. This is a
 * build-time transformation only; it performs no reads, downloads, admission,
 * Source Health transition, runtime registration, or publication.
 */
export function compileSyntheticCompactGraph(rawGraphArtifact, fixtureId) {
  if (typeof fixtureId !== 'string') fail('fixtureId must be a primitive string');
  const snapshot = snapshotCompilerInput(rawGraphArtifact);
  let graphArtifact;
  try {
    graphArtifact = admitGraphArtifact(snapshot);
  } catch (error) {
    fail(`GraphArtifact/v1 rejected input: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  const artifactCandidate = compileArtifact(graphArtifact);
  const manifestCandidate = compileManifest(artifactCandidate, fixtureId);
  const serializedArtifact = canonicalStringify(artifactCandidate);
  const serializedManifest = canonicalStringify(manifestCandidate);
  const { artifact, manifest } = parseSyntheticCompactGraphBundle(
    serializedArtifact,
    serializedManifest,
  );
  return deepFreeze({
    artifact,
    manifest,
    serializedArtifact,
    serializedManifest,
  });
}
