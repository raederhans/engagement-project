import {
  parseSyntheticCompactGraphBundle,
} from '../compact_graph/contract_v1.js';
import {
  canonicalStringify,
  contentIdentity,
  deepFreeze,
} from '../compact_graph/canonical_v1.js';

export const COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS = deepFreeze({
  admission: 'engagement-route-s6-compact-graph-runtime-admission/v1',
  identityDialect: 'engagement-route-s6-compact-graph-identity-dialect/v1',
  semanticTopologyIdentity: 'engagement-route-s6-semantic-topology-identity/v1',
  lifecycleSnapshotIdentity: 'engagement-route-s6-lifecycle-snapshot-identity/v1',
  snapshot: 'engagement-route-s6-compact-graph-snapshot/v1',
  claimBoundary: 'engagement-route-s6-compact-graph-runtime-claim-boundary/v1',
});

const SEMANTIC_TOPOLOGY_CANONICALIZATION =
  'route-s6-directed-routing-semantics-canonical-json/v1';
const LIFECYCLE_SNAPSHOT_CANONICALIZATION =
  'route-s6-lifecycle-snapshot-canonical-json/v1';
const ADMITTED_DOCUMENTS = new WeakSet();
const INSTALLED_SNAPSHOTS = new WeakSet();

export class CompactGraphRuntimeAdmissionError extends TypeError {
  constructor(code, cause) {
    super(`CompactGraph runtime admission rejected: ${code}; ${cause.message}`, { cause });
    this.name = 'CompactGraphRuntimeAdmissionError';
    this.code = code;
    this.schemaVersion = 'engagement-route-s6-compact-graph-admission-error/v1';
  }
}

export const COMPACT_GRAPH_RUNTIME_ELIGIBLE_CLAIMS = deepFreeze([
  'strict-primitive-json-bundle-admission-conformance',
  'atomic-in-memory-snapshot-lifecycle-conformance',
  'pure-reference-worker-protocol-conformance',
]);

export const COMPACT_GRAPH_RUNTIME_LIMITATIONS = deepFreeze([
  'synthetic-input-only',
  'not-real-data-or-real-city-data',
  'not-source-authenticity-or-external-authority',
  'not-source-health-current',
  'not-product-runtime-or-public-wiring',
  'not-public-or-publishable',
  'not-actual-browser-or-actual-worker-evidence',
  'not-formal-performance-evidence',
  'not-safety-or-safer-route-advice',
  'not-accessibility-outcome-evidence',
  'not-scientific-validity',
  'identities-prove-internal-consistency-only',
  'source-artifact-identity-is-not-semantic-topology-equivalence',
]);

export const COMPACT_GRAPH_RUNTIME_CLAIM_BOUNDARY = deepFreeze({
  schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.claimBoundary,
  classification: 'synthetic-only',
  eligibleClaims: COMPACT_GRAPH_RUNTIME_ELIGIBLE_CLAIMS,
  limitations: COMPACT_GRAPH_RUNTIME_LIMITATIONS,
});

/**
 * Strict runtime ingress for one S6-B artifact/manifest pair. The S6-B parser
 * owns JSON and schema admission. This wrapper accepts only the same two
 * primitive strings and adds no object, fetch, filesystem, or persistence path.
 */
export function admitSyntheticCompactGraphDocuments(artifactJson, manifestJson) {
  let bundle;
  try {
    bundle = parseSyntheticCompactGraphBundle(artifactJson, manifestJson);
  } catch (error) {
    if (isExpectedCompactGraphAdmissionError(error)) {
      throw new CompactGraphRuntimeAdmissionError('bundle-contract-rejected', error);
    }
    throw error;
  }
  const semanticTopologyIdentity = buildSemanticTopologyIdentity(bundle.artifact);
  const admission = deepFreeze({
    schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.admission,
    serializedDocuments: {
      artifactJson,
      manifestJson,
    },
    bundle,
    identities: {
      schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.identityDialect,
      sourceArtifactIdentity: bundle.artifact.provenance.sourceGraph,
      compactEncodingIdentity: {
        schemaVersion: bundle.artifact.schemaVersion,
        graphId: bundle.artifact.graph.graphId,
        artifactVersion: bundle.artifact.graph.artifactVersion,
        encoding: bundle.artifact.encoding,
        contentIdentity: bundle.artifact.contentIdentity,
      },
      semanticTopologyIdentity,
    },
    claimBoundary: COMPACT_GRAPH_RUNTIME_CLAIM_BOUNDARY,
  });
  ADMITTED_DOCUMENTS.add(admission);
  return admission;
}

export function createInstalledCompactGraphSnapshot(admission, snapshotSequence) {
  if (!ADMITTED_DOCUMENTS.has(admission)) {
    throw new TypeError('CompactGraph runtime admission provenance is unavailable');
  }
  if (!Number.isSafeInteger(snapshotSequence) || snapshotSequence <= 0) {
    throw new TypeError('CompactGraph runtime snapshot sequence must be a positive safe integer');
  }
  const identityProjection = {
    schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.lifecycleSnapshotIdentity,
    snapshotSequence,
    sourceArtifactIdentity: admission.identities.sourceArtifactIdentity,
    compactEncodingIdentity: admission.identities.compactEncodingIdentity,
    semanticTopologyIdentity: admission.identities.semanticTopologyIdentity,
    manifestIdentity: admission.bundle.manifest.manifestIdentity,
  };
  const lifecycleSnapshotIdentity = contentIdentity(
    identityProjection,
    COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.lifecycleSnapshotIdentity,
    LIFECYCLE_SNAPSHOT_CANONICALIZATION,
  );
  const snapshot = deepFreeze({
    schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.snapshot,
    snapshotSequence,
    serializedDocuments: admission.serializedDocuments,
    artifact: admission.bundle.artifact,
    manifest: admission.bundle.manifest,
    identities: {
      ...admission.identities,
      lifecycleSnapshotIdentity,
    },
    claimBoundary: admission.claimBoundary,
  });
  INSTALLED_SNAPSHOTS.add(snapshot);
  return snapshot;
}

export function rebindInstalledCompactGraphSnapshot(snapshot, snapshotSequence) {
  assertInstalledSnapshot(snapshot);
  const admission = deepFreeze({
    serializedDocuments: snapshot.serializedDocuments,
    bundle: {
      artifact: snapshot.artifact,
      manifest: snapshot.manifest,
    },
    identities: {
      schemaVersion: snapshot.identities.schemaVersion,
      sourceArtifactIdentity: snapshot.identities.sourceArtifactIdentity,
      compactEncodingIdentity: snapshot.identities.compactEncodingIdentity,
      semanticTopologyIdentity: snapshot.identities.semanticTopologyIdentity,
    },
    claimBoundary: snapshot.claimBoundary,
  });
  ADMITTED_DOCUMENTS.add(admission);
  return createInstalledCompactGraphSnapshot(admission, snapshotSequence);
}

export function compactGraphSnapshotBinding(snapshot) {
  assertInstalledSnapshot(snapshot);
  return deepFreeze({
    schemaVersion: 'engagement-route-s6-compact-graph-binding/v1',
    snapshotSequence: snapshot.snapshotSequence,
    lifecycleSnapshotDigest: snapshot.identities.lifecycleSnapshotIdentity.digest,
    compactEncodingDigest: snapshot.identities.compactEncodingIdentity.contentIdentity.digest,
    sourceArtifactDigest: snapshot.identities.sourceArtifactIdentity.contentIdentity.digest,
    semanticTopologyDigest: snapshot.identities.semanticTopologyIdentity.contentIdentity.digest,
  });
}

export function sameCompactGraphBinding(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

/** Explicit adapter from the admitted compact encoding to the existing solver. */
export function compactSnapshotToSolverGraphArtifact(snapshot) {
  assertInstalledSnapshot(snapshot);
  const { artifact } = snapshot;
  return deepFreeze({
    schemaVersion: artifact.graph.graphSchemaVersion,
    graphId: artifact.graph.graphId,
    mode: artifact.graph.mode,
    directed: artifact.graph.directed,
    nodes: artifact.nodeIds.map((nodeId) => ({ nodeId })),
    edges: artifact.edges.map((edge) => ({
      edgeId: edge.edgeId,
      fromNodeId: artifact.nodeIds[edge.fromNodeIndex],
      toNodeId: artifact.nodeIds[edge.toNodeIndex],
      distanceMm: edge.distanceMm,
      objectiveCostUnits: edge.objectiveCostUnits,
    })),
  });
}

export function isInstalledCompactGraphSnapshot(snapshot) {
  return Boolean(snapshot && typeof snapshot === 'object' && INSTALLED_SNAPSHOTS.has(snapshot));
}

function assertInstalledSnapshot(snapshot) {
  if (!isInstalledCompactGraphSnapshot(snapshot)) {
    throw new TypeError('CompactGraph runtime snapshot provenance is unavailable');
  }
}

function isExpectedCompactGraphAdmissionError(error) {
  return error instanceof TypeError && (
    error.message.startsWith('CompactGraph JSON contract:')
    || error.message.startsWith('CompactDirectedGraph/v1 contract:')
  );
}

function buildSemanticTopologyIdentity(artifact) {
  const projection = {
    schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.semanticTopologyIdentity,
    equivalenceScope:
      'directed-node-edge-id-mode-component-and-integer-routing-facts-only',
    mode: artifact.graph.mode,
    directed: artifact.graph.directed,
    nodeIds: artifact.nodeIds,
    edges: artifact.edges.map((edge) => ({
      edgeId: edge.edgeId,
      fromNodeId: artifact.nodeIds[edge.fromNodeIndex],
      toNodeId: artifact.nodeIds[edge.toNodeIndex],
      distanceMm: edge.distanceMm,
      objectiveCostUnits: edge.objectiveCostUnits,
      componentId: edge.componentId,
    })),
    components: artifact.components,
  };
  return deepFreeze({
    schemaVersion: COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.semanticTopologyIdentity,
    equivalenceScope: projection.equivalenceScope,
    excludes: [
      'source-document-order',
      'source-artifact-content-identity',
      'compact-encoding-layout',
      'manifest-identity',
      'lifecycle-sequence',
    ],
    contentIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_RUNTIME_SCHEMA_VERSIONS.semanticTopologyIdentity,
      SEMANTIC_TOPOLOGY_CANONICALIZATION,
    ),
  });
}
