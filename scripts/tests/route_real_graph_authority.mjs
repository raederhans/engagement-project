import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as authorityApi from '../lib/route_real_graph_authority/index.mjs';
import {
  REAL_GRAPH_AUTHORITY_EVIDENCE_HANDLE_SCHEMA,
  REAL_GRAPH_AUTHORITY_IDENTITY_KEYS,
  REAL_GRAPH_AUTHORITY_INGRESS_LIMITS,
  REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA,
  REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS,
  REAL_GRAPH_AUTHORITY_REGISTRY_ENTRY_SCHEMA,
  REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA,
  REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA,
  REAL_GRAPH_BUILD_TOOL_CERTIFICATE_SCHEMA,
  REAL_GRAPH_OWNER_RESOLVED_BINDINGS_SCHEMA,
  REAL_GRAPH_OWNER_RESOLVED_STATE_SCHEMA,
  REAL_GRAPH_RECORD_COUNT_DEFINITION,
  REAL_GRAPH_SOURCE_HEALTH_AUTHORIZATION_SCHEMA,
  REAL_GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA,
  REAL_GRAPH_SOURCE_READINESS_SCHEMA,
  REAL_GRAPH_SOURCE_READINESS_STATES,
  REQUIRED_INSTALLED_SCOPES,
  SOURCE_HEALTH_STATUSES,
  authorizeRealGraphSourceHealthUpdate,
  prepareRealGraphAuthorityEvidence,
} from '../lib/route_real_graph_authority/index.mjs';
import {
  assertRecomputedAudit,
  geometryIdentityFor,
  recomputeNormalizedGraphSemantics,
  stableEdgeId,
  stableNodeId,
  topologyIdentityFor,
  weakComponentCounts,
} from '../lib/route_real_graph_authority/graph_semantics.mjs';
import * as installedAnalysisApi from '../lib/route_real_graph_authority/installed_authority.mjs';
import {
  analyzeInstalledAuthorityEntries,
} from '../lib/route_real_graph_authority/installed_authority.mjs';
import {
  RouteRealGraphAuthorityError,
  assertArray,
  boundedText,
  canonicalStringify,
  cloneData,
  contentIdentity,
  exactDataObject,
  exactDateOrTimestamp,
  exactTimestamp,
  freezeData,
  nonNegativeSafeInteger,
  parseStrictJson,
} from '../lib/route_real_graph_authority/safe_data.mjs';

const seed = await fixture('evidence_seed.json');
const readinessCases = await fixture('source_health_states.json');

test('fixtures and readiness vocabulary are versioned and distinct from Source Health canonical states', () => {
  assert.equal(seed.schema, 'route-real-graph-authority-evidence-seed/v3');
  assert.equal(
    readinessCases.schema,
    'route-real-graph-authority-source-readiness-cases/v1',
  );
  assert.deepEqual(SOURCE_HEALTH_STATUSES, [
    'current', 'partial', 'stale', 'unavailable', 'unknown',
  ]);
  assert.deepEqual(REAL_GRAPH_SOURCE_READINESS_STATES, [
    'candidate-evidence-complete',
    'candidate-evidence-partial',
    'candidate-evidence-stale',
    'candidate-evidence-unavailable',
    'candidate-evidence-unknown',
  ]);
  assert.equal(REAL_GRAPH_SOURCE_READINESS_STATES.includes('current'), false);
});

test('strict preparation recomputes exact A, B, graph, tool-certificate, build, and readiness identities', () => {
  const evidence = makeEvidence();
  const handle = prepare(evidence);

  assert.equal(handle.schema, REAL_GRAPH_AUTHORITY_EVIDENCE_HANDLE_SCHEMA);
  assert.equal(handle.status, 'evidence-bound');
  assert.deepEqual(Object.keys(handle.identities), REAL_GRAPH_AUTHORITY_IDENTITY_KEYS);
  assert.equal(handle.identities.sourcePayload, evidence.acquisition.integrity.localSha256);
  assert.equal(handle.identities.acquisitionManifest, evidence.acquisition.manifest.manifestIdentity);
  assert.equal(handle.identities.acquisitionObservation, evidence.acquisition.observationIdentity);
  assert.equal(handle.identities.adapterProfile, evidence.adapter.profileIdentity);
  assert.equal(handle.identities.adapterResult, evidence.adapter.adapterIdentity);
  assert.equal(handle.identities.normalizedGraph, contentIdentity(evidence.adapter.normalization.graph));
  assert.equal(handle.identities.graphTopology, evidence.adapter.normalization.graph.topologyIdentity);
  assert.equal(handle.identities.graphGeometry, evidence.adapter.normalization.graph.geometryIdentity);
  assert.equal(handle.identities.graphVersion, contentIdentity({
    schema: 'route-real-graph-version-binding/v1',
    version: evidence.build.output.graphVersion,
    graphIdentity: evidence.build.output.graphIdentity,
  }));
  assert.equal(handle.identities.recordCountDefinition, contentIdentity(REAL_GRAPH_RECORD_COUNT_DEFINITION));
  assert.equal(handle.identities.buildToolCertificate, evidence.build.tool.certificateIdentity);
  assert.equal(handle.identities.buildToolExecutable, evidence.build.tool.executableIdentity);
  assert.equal(handle.identities.buildToolCommand, evidence.build.tool.commandIdentity);
  assert.equal(handle.identities.build, evidence.build.buildIdentity);
  assert.match(handle.evidenceSetIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(handle.entryMatched, false);
  assert.equal(handle.authorizationIssued, false);
  assert.equal(handle.actualAdmission, false);
  assert.equal(handle.sourceHealthCurrentClaimed, false);
  assert.equal(handle.reviewGate.callerAssertionsAccepted, false);
  assert.ok(Object.isFrozen(handle));
  assert.ok(Object.isFrozen(handle.identities));
});

test('A manifest, A observation, B profile, B adapter, tool certificate, and E build identities reject byte drift', async (t) => {
  const cases = [
    {
      name: 'A manifest identity',
      code: 'acquisition-manifest-identity-drift',
      mutate(evidence) {
        evidence.acquisition.manifest.references.boundary += '-v2';
      },
    },
    {
      name: 'A observation identity',
      code: 'acquisition-identity-drift',
      mutate(evidence) {
        evidence.acquisition.transport.head.etag = '"changed"';
      },
    },
    {
      name: 'B profile identity',
      code: 'adapter-profile-identity-drift',
      mutate(evidence) {
        evidence.adapter.profile.decisions.identityAndOrder.outputOrder = 'caller-order';
      },
    },
    {
      name: 'B adapter identity',
      code: 'adapter-identity-drift',
      mutate(evidence) {
        evidence.adapter.decisions.stairsPhysicalFeatureCount = 1;
      },
    },
    {
      name: 'E tool certificate identity',
      code: 'build-tool-certificate-drift',
      mutate(evidence) {
        evidence.build.tool.executableIdentity = hash('f');
      },
    },
    {
      name: 'E build identity',
      code: 'build-identity-drift',
      mutate(evidence) {
        evidence.build.limitations[0] += ' Exact bytes changed.';
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode(entry.code));
    });
  }
});

test('cross-evidence source, payload, adapter, boundary, tool, graph, clocks, and transport must bind exactly', async (t) => {
  const cases = [
    {
      name: 'payload identity',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.acquisition.payloadSha256 = hash('7');
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'adapter document identity',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.adapter.adapterDocumentIdentity = hash('8');
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'boundary identity',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.boundary.boundaryId = 'different-reviewed-boundary-v1';
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'certified tool id',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.tool.toolId = 'different-reviewed-extractor';
        refreshToolCertificate(evidence.build.tool);
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'readiness graph identity',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.sourceReadiness.snapshot.identity = hash('9');
      },
    },
    {
      name: 'readiness build clock',
      code: 'cross-evidence-clock-drift',
      mutate(evidence) {
        evidence.sourceReadiness.clocks.observedAt = '2026-08-14T00:04:00.000Z';
      },
    },
    {
      name: 'readiness transport',
      code: 'cross-evidence-transport-drift',
      mutate(evidence) {
        evidence.sourceReadiness.transport.etag = '"caller-relabel"';
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode(entry.code));
    });
  }
});

test('default private empty registry returns authority-unavailable without catalog or product claims', () => {
  const result = authorizeRealGraphSourceHealthUpdate(prepare(makeEvidence()));

  assert.equal(result.schema, REAL_GRAPH_SOURCE_HEALTH_AUTHORIZATION_SCHEMA);
  assert.equal(result.status, 'authority-unavailable');
  assert.equal(result.entryMatched, false);
  assert.equal(result.authorizationIssued, false);
  assert.equal(result.duplicateIssuance, false);
  assert.equal('transitioned' in result, false);
  assert.equal(result.registry.installedEntryCount, 0);
  assert.equal(result.registry.exactEntryMatched, false);
  assert.equal(result.authorityVerified, false);
  assert.equal(result.actualAdmissionAuthorized, false);
  assert.equal(result.updateAuthorization.authorized, false);
  assert.equal(result.updateAuthorization.proposedStatus, null);
  assert.equal(result.updateAuthorization.certificateIdentity, null);
  assert.equal(result.updateAuthorization.certificate, null);
  assert.equal(result.updateAuthorization.directCatalogMutationAuthorized, false);
  assert.equal(result.updateAuthorization.catalogMutationExecuted, false);
  assert.equal(result.sourceHealthCurrentClaimed, false);
  assert.equal(result.sourceCatalogUnchanged, true);
  assert.equal(result.productMaterialized, false);
  assert.equal(result.runtimeAuthorized, false);
  assert.equal(result.redistributionAuthorized, false);
  assert.equal(result.publicAccessAuthorized, false);
  assert.equal(result.publicationAuthorized, false);
  assert.equal(result.graphArtifactMinted, false);
  assert.deepEqual(result.reasonCodes, [
    'installed-authority-registry-empty', 'authority-unavailable', 'catalog-unchanged',
  ]);
  assert.ok(result.limitations.some((limitation) =>
    limitation.includes('not evidence of real-graph capacity')));
  assert.match(result.authorizationIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
});

test('projection remains not-observed/unavailable with five-state status and four null clocks', () => {
  const result = authorizeRealGraphSourceHealthUpdate(prepare(makeEvidence()));
  const projection = result.projection;

  assert.equal(projection.schema, REAL_GRAPH_SOURCE_HEALTH_PROJECTION_SCHEMA);
  assert.equal(projection.observationState, 'not-observed');
  assert.equal(projection.status, 'unavailable');
  assert.equal(SOURCE_HEALTH_STATUSES.includes(projection.status), true);
  assert.deepEqual(projection.clocks, {
    sourceAsOf: null,
    retrievedAt: null,
    builtAt: null,
    observedAt: null,
  });
  assert.deepEqual(projection.snapshot, { version: null, identity: null });
  assert.deepEqual(projection.coverage, {
    geography: null,
    temporalStart: null,
    temporalEnd: null,
  });
  assert.equal(projection.recordCountDefinition, null);
  assert.equal(projection.recordCount, null);
  assert.equal('graph' in result, false);
  assert.equal('graphArtifact' in result, false);
  assert.equal('catalog' in result, false);
  assert.equal(JSON.stringify(result).includes('"proposedStatus":"current"'), false);
});

test('normalized graph semantics are recomputed from actual graph and raw bytes', () => {
  const evidence = makeEvidence();
  const semantics = recomputeNormalizedGraphSemantics(
    evidence.adapter.normalization.graph,
    evidence.adapter.rawGraph,
    evidence.adapter.boundary,
  );
  assert.equal(semantics.topologyIdentity, evidence.adapter.normalization.graph.topologyIdentity);
  assert.equal(semantics.geometryIdentity, evidence.adapter.normalization.graph.geometryIdentity);
  assert.deepEqual(semantics.counts, evidence.adapter.normalization.graph.counts);
  assert.deepEqual(semantics.audit, evidence.adapter.normalization.audit);
  assert.deepEqual(semantics.recordCountDefinition, REAL_GRAPH_RECORD_COUNT_DEFINITION);
  assert.equal(semantics.recordCount, evidence.adapter.normalization.graph.edges.length);
});

test('full-outer-rehash hostile graph mutations cannot launder false semantic declarations', async (t) => {
  const cases = [
    {
      name: 'alternate topology hash',
      code: 'graph-topology-identity-drift',
      mutate(evidence) {
        evidence.adapter.normalization.graph.topologyIdentity = hash('9');
        refreshOuterIdentities(evidence, { recomputeGraphIdentities: false });
      },
    },
    {
      name: 'alternate geometry hash',
      code: 'graph-geometry-identity-drift',
      mutate(evidence) {
        evidence.adapter.normalization.graph.geometryIdentity = hash('8');
        refreshOuterIdentities(evidence, { recomputeGraphIdentities: false });
      },
    },
    {
      name: 'coordinate 999 999 with all outer identities refreshed',
      code: 'graph-coordinate-bounds',
      mutate(evidence) {
        const node = evidence.adapter.normalization.graph.nodes[0];
        node.coordinate = [999, 999];
        for (const edge of evidence.adapter.normalization.graph.edges) {
          if (edge.fromNodeId === node.id) edge.geometry[0] = [999, 999];
          if (edge.toNodeId === node.id) edge.geometry[edge.geometry.length - 1] = [999, 999];
        }
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'self-loop with caller-declared zero self loops',
      code: 'graph-self-loop',
      mutate(evidence) {
        const graph = evidence.adapter.normalization.graph;
        const edge = graph.edges[0];
        edge.toNodeId = edge.fromNodeId;
        edge.geometry[edge.geometry.length - 1] = [...edge.geometry[0]];
        graph.counts.selfLoopCount = 0;
        evidence.adapter.normalization.audit.counts.selfLoopCount = 0;
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'weakComponentCount zero with graph and audit coordinated',
      code: 'graph-count-drift',
      mutate(evidence) {
        evidence.adapter.normalization.graph.counts.weakComponentCount = 0;
        evidence.adapter.normalization.audit.counts.weakComponentCount = 0;
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'recordCount 999 in E and readiness',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.output.recordCount = 999;
        evidence.sourceReadiness.recordCount = 999;
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'exact duplicate directed edge with caller-declared zero duplicates',
      code: 'graph-duplicate-directed-edge',
      mutate(evidence) {
        addExactDuplicateDirectedEdge(evidence);
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'endpoint and geometry inconsistency',
      code: 'graph-endpoint-geometry-drift',
      mutate(evidence) {
        evidence.adapter.normalization.graph.edges[0].geometry[0] = [-75.11, 39.9];
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'zero edge cost',
      code: 'invalid-count',
      mutate(evidence) {
        evidence.adapter.rawGraph.features[0].cost_millimeters = 0;
        evidence.adapter.normalization.graph.edges[0].cost = 0;
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'noncanonical node order',
      code: 'graph-noncanonical-order',
      mutate(evidence) {
        evidence.adapter.normalization.graph.nodes.reverse();
        refreshOuterIdentities(evidence);
      },
    },
    {
      name: 'noncanonical edge order',
      code: 'graph-noncanonical-order',
      mutate(evidence) {
        makeBidirectional(evidence);
        evidence.adapter.normalization.graph.edges.reverse();
        refreshOuterIdentities(evidence);
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode(entry.code));
    });
  }
});

test('independent crypto full-rehash probes reject the five RD-Q laundering roots', async (t) => {
  const cases = [
    {
      name: 'alternate topology identity',
      code: 'graph-topology-identity-drift',
      mutate(evidence) {
        evidence.adapter.normalization.graph.topologyIdentity = hash('1');
        refreshOuterIdentitiesIndependently(evidence, { recomputeGraphIdentities: false });
      },
    },
    {
      name: 'self-loop declared as zero',
      code: 'graph-self-loop',
      mutate(evidence) {
        const edge = evidence.adapter.normalization.graph.edges[0];
        edge.toNodeId = edge.fromNodeId;
        edge.geometry[edge.geometry.length - 1] = [...edge.geometry[0]];
        refreshOuterIdentitiesIndependently(evidence);
      },
    },
    {
      name: 'weak component count zero',
      code: 'graph-count-drift',
      mutate(evidence) {
        evidence.adapter.normalization.graph.counts.weakComponentCount = 0;
        evidence.adapter.normalization.audit.counts.weakComponentCount = 0;
        refreshOuterIdentitiesIndependently(evidence);
      },
    },
    {
      name: 'record count 999',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.output.recordCount = 999;
        evidence.sourceReadiness.recordCount = 999;
        refreshOuterIdentitiesIndependently(evidence);
      },
    },
    {
      name: 'coordinate 999 999',
      code: 'graph-coordinate-bounds',
      mutate(evidence) {
        const node = evidence.adapter.normalization.graph.nodes[0];
        node.coordinate = [999, 999];
        for (const edge of evidence.adapter.normalization.graph.edges) {
          if (edge.fromNodeId === node.id) edge.geometry[0] = [999, 999];
          if (edge.toNodeId === node.id) edge.geometry[edge.geometry.length - 1] = [999, 999];
        }
        refreshOuterIdentitiesIndependently(evidence);
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode(entry.code));
    });
  }
});

test('graph counts and audit are never accepted by mutually consistent caller declarations alone', async (t) => {
  const cases = [
    ['nodeCount', 99],
    ['directedEdgeCount', 99],
    ['largestWeakComponentNodeCount', 99],
    ['excludedAccessCount', 99],
  ];
  for (const [field, value] of cases) {
    await t.test(field, () => {
      const evidence = makeEvidence();
      evidence.adapter.normalization.graph.counts[field] = value;
      if (Object.hasOwn(evidence.adapter.normalization.audit.counts, field)) {
        evidence.adapter.normalization.audit.counts[field] = value;
      }
      refreshOuterIdentities(evidence);
      assert.throws(() => prepare(evidence), hasCode('graph-count-drift'));
    });
  }
});

test('coordinated free-text labels remain opaque and cannot establish owner-reviewed resolution', async (t) => {
  const cases = [
    {
      name: 'profile awaiting-rd-b-review',
      mutate(evidence) {
        coordinateProfileReference(evidence, 'awaiting-rd-b-review');
      },
    },
    {
      name: 'boundary draft-boundary-v1',
      mutate(evidence) {
        coordinateBoundaryReference(evidence, 'draft-boundary-v1');
      },
    },
    {
      name: 'tool provisional-extractor',
      mutate(evidence) {
        coordinateToolReference(evidence, 'provisional-extractor', '1.0.0');
      },
    },
    {
      name: 'tool version un-available',
      mutate(evidence) {
        coordinateToolReference(evidence, evidence.build.tool.toolId, 'un-available');
      },
    },
    {
      name: 'graph version not-observed',
      mutate(evidence) {
        coordinateGraphVersion(evidence, 'not-observed');
      },
    },
    {
      name: 'profile not-reviewed',
      mutate(evidence) {
        coordinateProfileReference(evidence, 'not-reviewed');
      },
    },
    {
      name: 'graph version t.b.d',
      mutate(evidence) {
        coordinateGraphVersion(evidence, 't.b.d');
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      refreshOuterIdentities(evidence);
      const handle = prepare(evidence);
      const result = authorizeRealGraphSourceHealthUpdate(handle);
      assert.equal(handle.entryMatched, false);
      assert.equal(handle.authorizationIssued, false);
      assert.equal(result.status, 'authority-unavailable');
      assert.equal(result.entryMatched, false);
      assert.equal(result.authorizationIssued, false);
      assert.equal(result.actualAdmissionAuthorized, false);
      assert.equal(result.projection.observationState, 'not-observed');
      assert.equal(result.projection.status, 'unavailable');
      assert.equal(result.sourceHealthCurrentClaimed, false);
    });
  }
});

test('B to E tool equality is insufficient without an exact recomputed tool observation certificate', async (t) => {
  const cases = [
    {
      name: 'extractor binding hash differs while tool strings agree',
      code: 'cross-evidence-identity-drift',
      mutate(evidence) {
        evidence.build.tool.extractorBindingIdentity = hash('7');
        refreshToolCertificate(evidence.build.tool);
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'tool observation status is not exact',
      code: 'build-tool-schema',
      mutate(evidence) {
        evidence.build.tool.status = 'claimed-exact-tool';
        refreshToolCertificate(evidence.build.tool);
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'command bytes differ from command identity',
      code: 'build-tool-command-drift',
      mutate(evidence) {
        evidence.build.tool.command.push('--caller-changed-command');
        refreshToolCertificate(evidence.build.tool);
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'fallback tool certificate',
      code: 'build-tool-schema',
      mutate(evidence) {
        evidence.build.tool.fallbackUsed = true;
        refreshToolCertificate(evidence.build.tool);
        refreshBuildIdentity(evidence.build);
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode(entry.code));
    });
  }
});

test('caller readiness is candidate-only and never accepts canonical Source Health current', async (t) => {
  for (const entry of readinessCases.cases) {
    await t.test(`${entry.readiness}-${String(entry.recordCount)}`, () => {
      const evidence = makeEvidence();
      evidence.sourceReadiness.readiness = entry.readiness;
      evidence.sourceReadiness.recordCount = entry.recordCount;
      assert.throws(() => prepare(evidence), hasCode(entry.code));
    });
  }

  const current = makeEvidence();
  delete current.sourceReadiness.readiness;
  current.sourceReadiness.status = 'current';
  assert.throws(() => prepare(current), hasCode('schema-mismatch'));

  const callerProposal = makeEvidence();
  callerProposal.sourceReadiness.proposedStatus = 'current';
  assert.throws(() => prepare(callerProposal), hasCode('schema-mismatch'));
});

test('sourceAsOf remains null unless installed review provenance binds the certificate', async (t) => {
  const cases = [
    {
      name: 'A sourceAsOf',
      mutate(evidence) {
        evidence.acquisition.clocks.sourceAsOf = seed.clocks.sourceAsOf;
        refreshAcquisitionIdentity(evidence.acquisition);
        evidence.build.acquisition.observationIdentity = evidence.acquisition.observationIdentity;
        refreshBuildIdentity(evidence.build);
      },
    },
    {
      name: 'E and readiness sourceAsOf',
      mutate(evidence) {
        evidence.build.clocks.sourceAsOf = seed.clocks.sourceAsOf;
        evidence.sourceReadiness.clocks.sourceAsOf = seed.clocks.sourceAsOf;
        refreshBuildIdentity(evidence.build);
      },
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, () => {
      const evidence = makeEvidence();
      entry.mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode('unreviewed-source-as-of'));
    });
  }
});

test('schema drift, synthetic relabel, and GraphArtifact relabel reject before owner matching', async (t) => {
  const cases = [
    ['A v0', 'acquisition-schema', (e) => { e.acquisition.schema = 'route-real-graph-geofabrik-acquisition-observation/v0'; }],
    ['B v0', 'adapter-schema', (e) => { e.adapter.schema = 'route-real-graph-osm-adapter-result/v0'; }],
    ['E v0', 'build-schema', (e) => { e.build.schema = 'route-real-graph-build-evidence/v0'; }],
    ['readiness v0', 'source-readiness-schema', (e) => { e.sourceReadiness.schema = 'route-real-graph-source-readiness/v0'; }],
    ['synthetic B', 'synthetic-relabel', (e) => { e.adapter.dataClassification = 'synthetic'; }],
    ['GraphArtifact graph', 'synthetic-relabel', (e) => { e.adapter.normalization.graph.schema = 'GraphArtifact/v1'; }],
    ['GraphArtifact output', 'synthetic-relabel', (e) => { e.build.output.artifactSchema = 'GraphArtifact/v1'; }],
  ];
  for (const [name, code, mutate] of cases) {
    await t.test(name, () => {
      const evidence = makeEvidence();
      mutate(evidence);
      assert.throws(() => prepare(evidence), hasCode(code));
    });
  }
});

test('caller hash, reviewedBy, brand, registry, flags, and extra arguments cannot authorize', () => {
  for (const field of [
    'hash', 'reviewedBy', 'brand', 'registry', 'authorityVerified',
    'catalogMutationAuthorized', 'runtimeMutationAuthorized',
  ]) {
    const evidence = makeEvidence();
    evidence.sourceReadiness[field] = field;
    assert.throws(() => prepare(evidence), hasCode('schema-mismatch'), field);
  }

  const documents = jsonDocuments(makeEvidence());
  assert.throws(
    () => prepareRealGraphAuthorityEvidence(...documents, hash('b')),
    hasCode('evidence-arguments'),
  );
  const handle = prepare(makeEvidence());
  assert.throws(
    () => authorizeRealGraphSourceHealthUpdate(handle, JSON.stringify({ reviewedBy: 'caller' })),
    hasCode('authorization-arguments'),
  );
  assert.equal(authorizeRealGraphSourceHealthUpdate(handle).status, 'authority-unavailable');
});

test('same-session exact handles reject copies, cross-module instances, and replay', async () => {
  const handle = prepare(makeEvidence());
  assert.throws(
    () => authorizeRealGraphSourceHealthUpdate(structuredClone(handle)),
    hasCode('authority-handle-not-admitted'),
  );
  assert.throws(
    () => authorizeRealGraphSourceHealthUpdate(JSON.parse(JSON.stringify(handle))),
    hasCode('authority-handle-not-admitted'),
  );
  const freshAuthority = await import(
    `../lib/route_real_graph_authority/authority.mjs?fresh-session=${Date.now()}`
  );
  assert.throws(
    () => freshAuthority.authorizeRealGraphSourceHealthUpdate(handle),
    hasCode('authority-handle-not-admitted'),
  );
  assert.equal(authorizeRealGraphSourceHealthUpdate(handle).authorizationIssued, false);
  assert.throws(
    () => authorizeRealGraphSourceHealthUpdate(handle),
    hasCode('authority-handle-replay'),
  );
});

test('Proxy, getter, hidden, symbol, sparse, and mixed-descriptor evidence ingress rejects without traps', async (t) => {
  const documents = jsonDocuments(makeEvidence());
  for (const entry of hostileValues()) {
    await t.test(entry.name, () => {
      assert.throws(
        () => prepareRealGraphAuthorityEvidence(entry.value, ...documents.slice(1)),
        hasCode('json-text-required'),
      );
      assert.equal(entry.trapCalls(), 0);
    });
  }
});

test('Proxy, getter, hidden, symbol, sparse, and mixed-descriptor handle ingress rejects without traps', async (t) => {
  for (const entry of hostileValues()) {
    await t.test(entry.name, () => {
      assert.throws(
        () => authorizeRealGraphSourceHealthUpdate(entry.value),
        hasCode(entry.name === 'proxy' ? 'authority-handle-proxy' : 'authority-handle-not-admitted'),
      );
      assert.equal(entry.trapCalls(), 0);
    });
  }
});

test('oversized, duplicate-key, blocked-key, deep, and trailing JSON ingress fails closed', async (t) => {
  const documents = jsonDocuments(makeEvidence());
  const cases = [
    ['oversized', ' '.repeat(REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.acquisitionCodeUnits + 1), 'json-size'],
    ['duplicate key', '{"schema":"one","schema":"two"}', 'duplicate-json-key'],
    ['blocked key', '{"__proto__":{}}', 'blocked-property-key'],
    [
      'deep nesting',
      `${'['.repeat(REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.maximumDepth + 2)}0${']'.repeat(REAL_GRAPH_AUTHORITY_INGRESS_LIMITS.maximumDepth + 2)}`,
      'json-depth',
    ],
    ['trailing data', '{}{}', 'json-trailing-data'],
  ];
  for (const [name, text, code] of cases) {
    await t.test(name, () => {
      assert.throws(
        () => prepareRealGraphAuthorityEvidence(text, ...documents.slice(1)),
        hasCode(code),
      );
    });
  }
});

test('every exported object materializer applies depth budgets before cloning or hashing', async (t) => {
  const deepRecord = nestedRecord(5_000);
  const recordHelpers = [
    ['cloneData', (value) => cloneData(value, 'deep record')],
    ['freezeData', (value) => freezeData(value, 'deep record')],
    ['canonicalStringify', (value) => canonicalStringify(value)],
    ['contentIdentity', (value) => contentIdentity(value)],
    ['exactDataObject', (value) => exactDataObject(value, ['next'], 'deep record')],
  ];
  for (const [name, helper] of recordHelpers) {
    await t.test(name, () => {
      assertDomainError(() => helper(deepRecord), 'object-depth-budget');
    });
  }

  const deepArray = nestedArray(20_000);
  await t.test('assertArray', () => {
    assertDomainError(
      () => assertArray(deepArray, 'deep array', {
        maximum: REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength,
      }),
      'object-depth-budget',
    );
  });
});

test('width, aggregate, descriptor, sparse, custom-array, and length budgets reject before output materialization', async (t) => {
  await t.test('object width', () => {
    const wide = {};
    for (let index = 0;
      index <= REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumObjectWidth;
      index += 1) {
      wide[`field${index}`] = index;
    }
    assertDomainError(() => cloneData(wide, 'wide object'), 'object-width-budget');
  });

  await t.test('aggregate items', () => {
    const dense = [];
    for (let index = 0;
      index < REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumAggregateItems;
      index += 1) {
      dense.push(index);
    }
    assertDomainError(() => cloneData(dense, 'aggregate array'), 'object-aggregate-budget');
  });

  await t.test('aggregate descriptors', () => {
    const descriptorHeavy = [];
    const childCount = Math.floor(
      REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumDescriptors / 2,
    ) + 1;
    for (let index = 0; index < childCount; index += 1) descriptorHeavy.push([]);
    assertDomainError(
      () => cloneData(descriptorHeavy, 'descriptor-heavy array'),
      'object-descriptor-budget',
    );
  });

  await t.test('oversized array length', () => {
    const oversized = new Array(
      REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength + 1,
    );
    assertDomainError(
      () => cloneData(oversized, 'oversized sparse array'),
      'object-array-length-budget',
    );
  });

  await t.test('huge sparse array', () => {
    const sparse = new Array(
      REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength,
    );
    assertDomainError(
      () => cloneData(sparse, 'huge sparse array'),
      'object-aggregate-budget',
    );
  });

  await t.test('huge custom array', () => {
    const custom = new Array(50_000);
    Object.defineProperty(custom, 'custom-state', {
      configurable: true,
      enumerable: true,
      value: 'caller-defined',
      writable: true,
    });
    assertDomainError(
      () => cloneData(custom, 'huge custom array'),
      'descriptor-policy-array-custom',
    );
  });

  await t.test('bounded sparse array', () => {
    assertDomainError(
      () => cloneData(new Array(2), 'sparse array'),
      'descriptor-policy-sparse-array',
    );
  });
});

test('descriptor policy accepts only plain mutable or fully frozen data and never invokes traps', async (t) => {
  const mutable = { nested: [1, { value: 'accepted' }] };
  const frozen = freezeData(mutable, 'frozen fixture');
  assert.deepEqual(cloneData(mutable, 'mutable fixture'), mutable);
  assert.deepEqual(cloneData(frozen, 'frozen fixture'), mutable);

  const expectedCodes = new Map([
    ['proxy', 'proxy-object'],
    ['getter', 'descriptor-policy-accessor'],
    ['hidden', 'descriptor-policy-hidden'],
    ['symbol', 'descriptor-policy-symbol'],
    ['sparse', 'descriptor-policy-sparse-array'],
    ['mixed descriptor', 'descriptor-policy-mixed-mode'],
  ]);
  for (const entry of hostileValues()) {
    await t.test(entry.name, () => {
      assertDomainError(
        () => cloneData(entry.value, `hostile ${entry.name}`),
        expectedCodes.get(entry.name),
      );
      assert.equal(entry.trapCalls(), 0);
    });
  }

  await t.test('custom data descriptor', () => {
    const custom = {};
    Object.defineProperty(custom, 'value', {
      configurable: false,
      enumerable: true,
      value: 1,
      writable: true,
    });
    assertDomainError(
      () => cloneData(custom, 'custom descriptor'),
      'descriptor-policy-custom-mode',
    );
  });
});

test('exported option and schema-key objects are bounded before field access', async (t) => {
  const optionConsumers = [
    ['parseStrictJson', (options) => parseStrictJson('{}', options)],
    ['boundedText', (options) => boundedText('value', 'text', options)],
    ['exactTimestamp', (options) => exactTimestamp('2026-08-14T00:00:00.000Z', 'clock', options)],
    ['exactDateOrTimestamp', (options) => exactDateOrTimestamp('2026-08-14', 'clock', options)],
    ['nonNegativeSafeInteger', (options) => nonNegativeSafeInteger(1, 'count', options)],
    ['assertArray', (options) => assertArray([], 'array', options)],
  ];
  for (const [name, consume] of optionConsumers) {
    await t.test(name, () => {
      const hostile = trapProxy({});
      assertDomainError(() => consume(hostile.value), 'proxy-object');
      assert.equal(hostile.trapCalls(), 0);
    });
  }

  await t.test('exactDataObject expected keys', () => {
    const hostile = trapProxy([]);
    assertDomainError(
      () => exactDataObject({}, hostile.value, 'schema keys'),
      'proxy-object',
    );
    assert.equal(hostile.trapCalls(), 0);
  });
});

test('neutral installed matcher inherits object budgets for every caller-controlled object argument', async (t) => {
  const subject = matchSubject(prepare(makeEvidence()));
  const policy = installedPolicy();
  assertDomainError(
    () => analyzeInstalledAuthorityEntries(nestedArray(5_000), subject, policy),
    'object-depth-budget',
  );
  assertDomainError(
    () => analyzeInstalledAuthorityEntries(
      new Array(REAL_GRAPH_AUTHORITY_OBJECT_INGRESS_LIMITS.maximumArrayLength),
      subject,
      policy,
    ),
    'object-aggregate-budget',
  );
  const custom = new Array(50_000);
  custom.callerRegistry = 'not-authority';
  assertDomainError(
    () => analyzeInstalledAuthorityEntries(custom, subject, policy),
    'descriptor-policy-array-custom',
  );
});

test('every exported graph helper validates object budgets before reading graph fields', async (t) => {
  const deepRecord = nestedRecord(5_000);
  const cases = [
    ['recomputeNormalizedGraphSemantics', () =>
      recomputeNormalizedGraphSemantics(deepRecord, {}, {})],
    ['assertRecomputedAudit', () => assertRecomputedAudit(deepRecord, {})],
    ['topologyIdentityFor', () => topologyIdentityFor(deepRecord)],
    ['geometryIdentityFor', () => geometryIdentityFor(deepRecord)],
    ['stableNodeId', () => stableNodeId(deepRecord, 'source-node')],
    ['stableEdgeId', () => stableEdgeId('source', deepRecord, 'forward')],
    ['weakComponentCounts', () => weakComponentCounts(nestedArray(5_000), [])],
  ];
  for (const [name, invoke] of cases) {
    await t.test(name, () => {
      assertDomainError(invoke, 'object-depth-budget');
    });
  }

  await t.test('topology helper Proxy', () => {
    const hostile = trapProxy({});
    assertDomainError(() => topologyIdentityFor(hostile.value), 'proxy-object');
    assert.equal(hostile.trapCalls(), 0);
  });
});

test('neutral installed analysis covers exact, mismatch, ambiguous, duplicate, and review drift', async (t) => {
  const handle = prepare(makeEvidence());
  const subject = matchSubject(handle);
  const policy = installedPolicy();
  const exactEntry = installedEntry(subject, policy);

  await t.test('exact match', () => {
    const match = analyzeInstalledAuthorityEntries([exactEntry], subject, policy);
    assert.equal(match.status, 'exact-match');
    assert.equal(match.entryMatched, true);
    assert.equal(match.entry.entryIdentity, exactEntry.entryIdentity);
  });

  await t.test('identity mismatch is no match', () => {
    const entry = structuredClone(exactEntry);
    entry.identities.build = hash('f');
    entry.resolution.bindings.build = entry.identities.build;
    refreshResolutionIdentity(entry.resolution);
    refreshInstalledEntryIdentity(entry);
    const match = analyzeInstalledAuthorityEntries([entry], subject, policy);
    assert.equal(match.status, 'no-match');
    assert.equal(match.entryMatched, false);
  });

  await t.test('ambiguous exact matches reject', () => {
    const second = installedEntry(subject, policy, { entryId: 'accepted-test-entry-2' });
    assert.throws(
      () => analyzeInstalledAuthorityEntries([exactEntry, second], subject, policy),
      hasCode('installed-registry-ambiguous'),
    );
  });

  await t.test('duplicate entry rejects', () => {
    assert.throws(
      () => analyzeInstalledAuthorityEntries([exactEntry, structuredClone(exactEntry)], subject, policy),
      hasCode('installed-registry-duplicate'),
    );
  });

  await t.test('accepted revision drift rejects', () => {
    const entry = structuredClone(exactEntry);
    entry.review.buildRevision = '9'.repeat(40);
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('installed-review-revision-drift'),
    );
  });

  await t.test('review bytes drift rejects', () => {
    const entry = structuredClone(exactEntry);
    entry.review.reviewedBy = 'caller-rewritten-reviewer';
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('installed-review-identity-drift'),
    );
  });

  await t.test('entry bytes drift rejects', () => {
    const entry = structuredClone(exactEntry);
    entry.entryId = 'rewritten-entry-id';
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('installed-entry-identity-drift'),
    );
  });

  await t.test('label-only entry without positive resolution rejects', () => {
    const entry = structuredClone(exactEntry);
    delete entry.resolution;
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('schema-mismatch'),
    );
  });

  await t.test('non-resolved status rejects even with recomputed identities', () => {
    const entry = structuredClone(exactEntry);
    entry.resolution.status = 'candidate-evidence-complete';
    refreshResolutionIdentity(entry.resolution);
    refreshInstalledEntryIdentity(entry);
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('installed-resolution-unavailable'),
    );
  });

  await t.test('resolved identity binding drift rejects', () => {
    const entry = structuredClone(exactEntry);
    entry.resolution.bindings.build = hash('e');
    refreshResolutionIdentity(entry.resolution);
    refreshInstalledEntryIdentity(entry);
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('installed-resolution-binding-drift'),
    );
  });

  await t.test('resolved state bytes drift rejects', () => {
    const entry = structuredClone(exactEntry);
    entry.resolution.resolvedAt = '2026-08-14T01:00:01.000Z';
    assert.throws(
      () => analyzeInstalledAuthorityEntries([entry], subject, policy),
      hasCode('installed-resolution-review-drift'),
    );
  });
});

test('deep-imported installed analysis remains neutral across repeated prepare', () => {
  const evidence = makeEvidence();
  const firstHandle = prepare(evidence);
  const secondHandle = prepare(makeEvidence());
  assert.equal(firstHandle.evidenceSetIdentity, secondHandle.evidenceSetIdentity);

  const firstSubject = matchSubject(firstHandle);
  const secondSubject = matchSubject(secondHandle);
  const policy = installedPolicy();
  const entry = installedEntry(firstSubject, policy, {
    sourceAsOf: seed.clocks.sourceAsOf,
    sourceAsOfProvenanceIdentity: hash('a'),
  });
  const first = analyzeInstalledAuthorityEntries([entry], firstSubject, policy);
  const second = analyzeInstalledAuthorityEntries([entry], secondSubject, policy);

  assert.equal(first.entryMatched, true);
  assert.equal(second.entryMatched, true);
  assert.equal(first.entry.entryIdentity, second.entry.entryIdentity);
  for (const result of [first, second]) {
    assert.equal('authorizationIssued' in result, false);
    assert.equal('realGraphAdmissionAuthorized' in result, false);
    assert.equal('sourceHealthUpdateAuthorized' in result, false);
    assert.equal('proposedStatus' in result, false);
    assert.equal('certificate' in result, false);
  }
  const firstAuthorization = authorizeRealGraphSourceHealthUpdate(firstHandle);
  const secondAuthorization = authorizeRealGraphSourceHealthUpdate(secondHandle);
  for (const result of [firstAuthorization, secondAuthorization]) {
    assert.equal(result.status, 'authority-unavailable');
    assert.equal(result.entryMatched, false);
    assert.equal(result.authorizationIssued, false);
    assert.equal(result.duplicateIssuance, false);
    assert.equal(result.sourceCatalogUnchanged, true);
  }
});

test('pure matcher cannot bind sourceAsOf without exact reviewed provenance', () => {
  const subject = matchSubject(prepare(makeEvidence()));
  const policy = installedPolicy();
  const entry = installedEntry(subject, policy);
  entry.review.sourceAsOf = seed.clocks.sourceAsOf;
  refreshReviewIdentity(entry.review);
  refreshInstalledEntryIdentity(entry);
  assert.throws(
    () => analyzeInstalledAuthorityEntries([entry], subject, policy),
    hasCode('installed-source-as-of-provenance'),
  );
});

test('formal issuance is absent from public and deep-importable analysis surfaces', async () => {
  for (const name of [
    'matchInstalledAuthorityEntries',
    'analyzeInstalledAuthorityEntries',
    'buildInstalledAuthorizationCertificate',
    'installAuthorityEntry',
    'setAuthorityRegistry',
    'setReviewedBy',
    'brandAuthorityHandle',
  ]) {
    assert.equal(Object.hasOwn(authorityApi, name), false, name);
  }
  assert.deepEqual(Object.keys(installedAnalysisApi), ['analyzeInstalledAuthorityEntries']);
  const authoritySource = await readFile(
    new URL('../lib/route_real_graph_authority/authority.mjs', import.meta.url),
    'utf8',
  );
  const analysisSource = await readFile(
    new URL('../lib/route_real_graph_authority/installed_authority.mjs', import.meta.url),
    'utf8',
  );
  const safeDataSource = await readFile(
    new URL('../lib/route_real_graph_authority/safe_data.mjs', import.meta.url),
    'utf8',
  );
  assert.match(authoritySource, /function createInstalledAuthorityClosure\(\)/);
  assert.match(authoritySource, /const installedRegistry = Object\.freeze\(\[\]\);/);
  assert.match(authoritySource, /const issuedCertificateIdentities = new Set\(\);/);
  assert.match(authoritySource, /issuedCertificateIdentities\.has\(certificateIdentity\)/);
  assert.match(authoritySource, /issuedCertificateIdentities\.add\(certificateIdentity\)/);
  assert.match(
    authoritySource,
    /authorizationIssued:\s*false,[\s\S]*duplicateIssuance:\s*true/,
  );
  assert.doesNotMatch(authoritySource, /process\.env|globalThis|setInstalled|installEntry/);
  assert.doesNotMatch(
    analysisSource,
    /authorizationIssued\s*:\s*true|realGraphAdmissionAuthorized\s*:\s*true|proposedStatus\s*:/,
  );
  assert.doesNotMatch(
    safeDataSource,
    /Array\.from\(|getOwnPropertyDescriptors|concreteReference|sentinel-reference/,
  );
});

function prepare(evidence) {
  return prepareRealGraphAuthorityEvidence(...jsonDocuments(evidence));
}

function jsonDocuments(evidence) {
  return [
    evidence.acquisition,
    evidence.adapter,
    evidence.build,
    evidence.sourceReadiness,
  ].map((value) => JSON.stringify(value));
}

function makeEvidence() {
  const profile = makeProfile();
  const profileIdentity = contentIdentity(profile);
  const boundary = {
    schema: 'route-real-graph-osm-boundary/v1',
    boundaryId: seed.boundaryId,
    clipperId: 'reviewed-boundary-clipper',
    clipperVersion: '1.0.0',
    clippingStatus: 'complete',
    clippingPolicy: 'extractor-preclipped-explicit-endpoints',
    outsideInputPolicy: 'reject',
    bbox: [-75.3, 39.8, -74.8, 40.2],
  };
  const extractor = {
    schema: 'route-real-graph-osm-extractor-binding/v1',
    extractorId: seed.tool.toolId,
    extractorVersion: seed.tool.toolVersion,
    recordSchema: 'route-real-graph-osm-edge-record/v1',
  };
  const turnRestrictions = {
    schema: 'route-real-graph-osm-turn-restrictions/v1',
    status: 'unavailable',
    reason: 'not-extracted',
  };
  const rawGraph = {
    schema: 'route-graph-raw-candidate/v1',
    sourceId: seed.sourceId,
    sourceKind: 'osm',
    features: [{
      source_edge_id: 'osm-way:100:segment:0:part:0',
      from_node_id: 'osm-node:100',
      to_node_id: 'osm-node:101',
      geometry_lon_lat_1e7: [[-75.1, 39.9], [-75.09, 39.9]],
      cost_millimeters: 1000,
      walk_direction: 'forward',
      walk_access: 'allowed',
      mode: 'walking',
    }],
  };
  const nodeA = {
    id: stableNodeId(seed.sourceId, 'osm-node:100'),
    sourceNodeId: 'osm-node:100',
    coordinate: [-75.1, 39.9],
  };
  const nodeB = {
    id: stableNodeId(seed.sourceId, 'osm-node:101'),
    sourceNodeId: 'osm-node:101',
    coordinate: [-75.09, 39.9],
  };
  const nodes = [nodeA, nodeB].sort(compareId);
  const edges = [{
    id: stableEdgeId(seed.sourceId, rawGraph.features[0].source_edge_id, 'forward'),
    sourceEdgeId: rawGraph.features[0].source_edge_id,
    fromNodeId: nodeA.id,
    toNodeId: nodeB.id,
    cost: 1000,
    geometry: [[-75.1, 39.9], [-75.09, 39.9]],
    traversal: 'forward',
    sourceDirection: 'forward',
  }];
  const graph = {
    schema: 'route-graph-candidate/v1',
    dataClassification: 'candidate-external',
    sourceId: seed.sourceId,
    sourceKind: 'osm',
    profileId: seed.profileId,
    mode: 'walking',
    nodes,
    edges,
    topologyIdentity: null,
    geometryIdentity: null,
    counts: {
      physicalFeatureCount: 1,
      excludedAccessCount: 0,
      nodeCount: 2,
      directedEdgeCount: 1,
      weakComponentCount: 1,
      largestWeakComponentNodeCount: 2,
      selfLoopCount: 0,
      zeroCostEdgeCount: 0,
    },
    limitations: [
      'Candidate-only normalized real graph; not a product or publication artifact.',
      'Turn restrictions remain unavailable.',
    ],
  };
  graph.topologyIdentity = topologyIdentityFor(graph);
  graph.geometryIdentity = geometryIdentityFor(graph);
  const normalization = {
    status: 'ready',
    graph,
    audit: {
      schema: 'route-graph-topology-audit/v1',
      status: 'passed',
      blockers: [],
      warnings: ['turn-restrictions-unavailable'],
      counts: {
        nodeCount: 2,
        directedEdgeCount: 1,
        weakComponentCount: 1,
        largestWeakComponentNodeCount: 2,
        selfLoopCount: 0,
        zeroCostEdgeCount: 0,
        exactDuplicateDirectedEdgeCount: 0,
      },
    },
  };
  const decisions = {
    inputPhysicalFeatureCount: 1,
    includedPhysicalFeatureCount: 1,
    excludedPhysicalFeatureCount: 0,
    stairsPhysicalFeatureCount: 0,
    ferryPhysicalFeatureCount: 0,
    clippedPhysicalFeatureCount: 0,
    constructionExcludedPhysicalFeatureCount: 0,
    turnRestrictionRecordCount: null,
  };
  const adapter = {
    schema: 'route-real-graph-osm-adapter-result/v1',
    dataClassification: 'candidate-external',
    profile,
    profileIdentity,
    intermediateIdentity: seed.identities.intermediate,
    adapterIdentity: null,
    extractor,
    boundary,
    turnRestrictions,
    rawGraph,
    normalization,
    decisions,
    limitations: [
      'Candidate-only OSM mapping; this result is not GraphArtifact/v1 and is not product runtime.',
      'This result is not publication authority.',
    ],
  };
  refreshAdapterIdentity(adapter);

  const manifest = {
    schema: 'route-real-graph-geofabrik-acquisition-manifest/v1',
    manifestIdentity: null,
    dataClassification: 'candidate-external',
    source: {
      provider: 'Geofabrik GmbH',
      providerPage: seed.source.providerPage,
      region: 'north-america/us/pennsylvania',
      format: 'osm.pbf',
      datedUrl: seed.source.datedUrl,
      sidecarMd5Url: `${seed.source.datedUrl}.md5`,
    },
    references: {
      boundary: `route-real-graph-boundary/${seed.boundaryId}`,
      profile: `route-real-graph-osm-walk-profile/${seed.profileId}`,
      tool: `route-real-graph-extractor/${seed.tool.toolId}-${seed.tool.toolVersion}`,
    },
    policy: {
      candidateOnly: true,
      latestAllowed: false,
      fallbackAllowed: false,
      fullPayloadPersistenceAllowed: false,
    },
    limitations: [
      'Candidate discovery and payload verification only; not owner authority.',
      'Transport headers and checksums are drift and corruption evidence only.',
    ],
  };
  refreshManifestIdentity(manifest);
  const acquisition = {
    schema: 'route-real-graph-geofabrik-acquisition-observation/v1',
    dataClassification: 'candidate-external',
    manifest,
    status: 'payload-verified',
    clocks: {
      sourceAsOf: null,
      retrievedAt: seed.clocks.retrievedAt,
      builtAt: seed.clocks.acquisitionBuiltAt,
      observedAt: seed.clocks.acquisitionObservedAt,
    },
    transport: {
      head: {
        method: 'HEAD',
        url: seed.source.datedUrl,
        status: 200,
        ok: true,
        contentLength: seed.source.payloadBytes,
        contentType: 'application/octet-stream',
        etag: seed.source.etag,
        lastModified: seed.source.lastModified,
        bodyBytes: null,
      },
      sidecar: {
        method: 'GET',
        url: `${seed.source.datedUrl}.md5`,
        status: 200,
        ok: true,
        contentLength: 64,
        contentType: 'text/plain',
        etag: null,
        lastModified: null,
        bodyBytes: 64,
      },
    },
    integrity: {
      providerSidecarMd5: seed.source.payloadMd5,
      localMd5: seed.source.payloadMd5,
      localSha256: seed.source.payloadSha256,
      declaredBytes: seed.source.payloadBytes,
      localBytes: seed.source.payloadBytes,
      md5MatchesSidecar: true,
      declaredBytesMatch: true,
    },
    localPayload: { status: 'verified', persisted: false },
    fallbackUsed: false,
    failure: null,
    claimBoundary: {
      candidateOnly: true,
      sourceAuthenticity: 'not-established',
      businessFreshness: 'unknown',
      productAdmission: 'not-authorized',
      sourceHealthCurrent: 'not-authorized',
      publication: 'not-authorized',
    },
    observationIdentity: null,
  };
  refreshAcquisitionIdentity(acquisition);

  const tool = {
    schema: REAL_GRAPH_BUILD_TOOL_CERTIFICATE_SCHEMA,
    certificateIdentity: null,
    status: 'observed-exact-tool',
    extractorBindingIdentity: contentIdentity(extractor),
    toolId: seed.tool.toolId,
    toolVersion: seed.tool.toolVersion,
    executableIdentity: seed.tool.executableIdentity,
    command: [
      seed.tool.toolId,
      '--profile', seed.profileId,
      '--boundary', seed.boundaryId,
    ],
    commandIdentity: null,
    observedAt: seed.clocks.toolObservedAt,
    fallbackUsed: false,
    failure: null,
  };
  tool.commandIdentity = contentIdentity(tool.command);
  refreshToolCertificate(tool);
  const normalizedGraphIdentity = contentIdentity(graph);
  const build = {
    schema: 'route-real-graph-build-evidence/v1',
    buildIdentity: null,
    dataClassification: 'candidate-external',
    status: 'complete',
    acquisition: {
      schema: 'route-real-graph-build-acquisition-binding/v1',
      observationIdentity: acquisition.observationIdentity,
      payloadSha256: seed.source.payloadSha256,
      payloadBytes: seed.source.payloadBytes,
    },
    adapter: {
      schema: 'route-real-graph-build-adapter-binding/v1',
      profileIdentity,
      intermediateIdentity: adapter.intermediateIdentity,
      adapterIdentity: adapter.adapterIdentity,
      adapterDocumentIdentity: contentIdentity(adapter),
      normalizedGraphIdentity,
    },
    tool,
    boundary: {
      schema: 'route-real-graph-build-boundary-binding/v1',
      boundaryId: seed.boundaryId,
      boundaryPolicyIdentity: seed.identities.boundaryPolicy,
      crossStatePolicy: 'resolved-explicitly',
    },
    output: {
      schema: 'route-real-graph-build-output/v1',
      artifactSchema: 'route-graph-candidate/v1',
      graphVersion: seed.graphVersion,
      graphIdentity: normalizedGraphIdentity,
      nodeCount: 2,
      directedEdgeCount: 1,
      recordCountDefinition: { ...REAL_GRAPH_RECORD_COUNT_DEFINITION },
      recordCount: 1,
    },
    clocks: {
      sourceAsOf: null,
      retrievedAt: seed.clocks.retrievedAt,
      builtAt: seed.clocks.buildBuiltAt,
      observedAt: seed.clocks.buildObservedAt,
    },
    fallbackUsed: false,
    failure: null,
    claims: {
      candidateOnly: true,
      actualAdmission: false,
      sourceHealthCurrent: false,
      productRuntime: false,
      publication: false,
    },
    limitations: [
      'Private build candidate only; not actual admission, Source Health current, runtime, or publication.',
    ],
  };
  refreshBuildIdentity(build);
  const sourceReadiness = {
    schema: REAL_GRAPH_SOURCE_READINESS_SCHEMA,
    dataClassification: 'candidate-external-source-readiness',
    sourceId: seed.sourceId,
    readiness: 'candidate-evidence-complete',
    readinessReason: 'exact-real-graph-candidate-awaiting-owner-installed-entry',
    clocks: { ...build.clocks },
    snapshot: { version: seed.graphVersion, identity: normalizedGraphIdentity },
    boundaryVintage: seed.boundaryId,
    coverage: {
      geography: 'Philadelphia reviewed boundary candidate',
      temporalStart: '2026-08-13',
      temporalEnd: '2026-08-13',
    },
    transport: {
      endpointUrl: seed.source.datedUrl,
      lastModified: seed.source.lastModified,
      etag: seed.source.etag,
    },
    recordCountDefinition: { ...REAL_GRAPH_RECORD_COUNT_DEFINITION },
    recordCount: 1,
  };
  return { acquisition, adapter, build, sourceReadiness };
}

function makeProfile() {
  return {
    schema: 'route-real-graph-osm-walk-profile/v1',
    profileId: seed.profileId,
    sourceKind: 'osm',
    mode: 'walking',
    inputSchema: 'route-real-graph-osm-intermediate/v1',
    inputRecordSchema: 'route-real-graph-osm-edge-record/v1',
    outputRawSchema: 'route-graph-raw-candidate/v1',
    outputNormalizedSchema: 'route-graph-candidate/v1',
    decisions: {
      highway: { missing: 'reject', unknown: 'reject' },
      foot: { missing: 'reject', unknown: 'reject' },
      access: { missing: 'reject', unknown: 'reject' },
      oneway: { missingGeneral: 'bidirectional-profile-default', unknown: 'reject' },
      stairs: { accessibility: 'unavailable' },
      ferry: { unknownRoute: 'reject' },
      construction: { unknownConstructionValue: 'exclude-not-pass' },
      conditional: {
        fields: ['access', 'foot', 'oneway', 'onewayFoot'],
        missing: 'no-conditional-expression-present',
        present: 'reject-unresolved',
        unknown: 'reject',
      },
      geometry: { coordinateOrder: 'longitude-latitude' },
      boundary: {
        clipping: 'extractor-preclipped-with-explicit-endpoint-markers',
        outsideInputPolicy: 'reject',
        unknownClipping: 'reject',
        crossBoundaryCorrectness: 'unavailable',
      },
      turnRestrictions: {
        status: 'unavailable',
        acceptedReason: 'not-extracted',
        interpretation: 'not-applied-and-not-treated-as-empty',
      },
      distanceAndCost: {
        inputDistanceUnit: 'integer-millimeters',
        outputCostUnit: 'integer-millimeters',
        conversion: 'identity',
        minimum: 1,
        maximum: 2_000_000_000,
      },
      identityAndOrder: { outputOrder: 'ascending-code-unit-order' },
    },
    candidateProfile: {
      schema: 'route-graph-mode-profile/v1',
      profileId: seed.profileId,
      sourceKind: 'osm',
      mode: 'walking',
      fields: {
        sourceEdgeId: 'source_edge_id',
        fromNodeId: 'from_node_id',
        toNodeId: 'to_node_id',
        geometry: 'geometry_lon_lat_1e7',
        cost: 'cost_millimeters',
        oneway: 'walk_direction',
        access: 'walk_access',
        mode: 'mode',
      },
      oneway: {
        forward: ['forward'],
        reverse: ['reverse'],
        bidirectional: ['bidirectional'],
        missing: 'reject',
        unknown: 'reject',
      },
      access: {
        allowed: ['allowed'],
        denied: ['denied'],
        missing: 'reject',
        unknown: 'reject',
      },
      modeValues: { allowed: ['walking'], missing: 'reject', unknown: 'reject' },
      cost: { unit: 'integer', minimum: 1, maximum: 2_000_000_000 },
    },
    claims: {
      candidateOnly: true,
      accessibility: 'not-established',
      safety: 'not-established',
      completeness: 'not-established',
      cityCorrectness: 'not-established',
      productRouting: 'not-authorized',
      publication: 'not-authorized',
    },
  };
}

function refreshOuterIdentities(evidence, { recomputeGraphIdentities = true } = {}) {
  const { adapter, acquisition, build, sourceReadiness } = evidence;
  const graph = adapter.normalization.graph;
  if (recomputeGraphIdentities) {
    graph.topologyIdentity = topologyIdentityFor(graph);
    graph.geometryIdentity = geometryIdentityFor(graph);
  }
  adapter.profileIdentity = contentIdentity(adapter.profile);
  refreshAdapterIdentity(adapter);
  refreshManifestIdentity(acquisition.manifest);
  refreshAcquisitionIdentity(acquisition);
  build.acquisition.observationIdentity = acquisition.observationIdentity;
  build.adapter.profileIdentity = adapter.profileIdentity;
  build.adapter.intermediateIdentity = adapter.intermediateIdentity;
  build.adapter.adapterIdentity = adapter.adapterIdentity;
  build.adapter.adapterDocumentIdentity = contentIdentity(adapter);
  build.adapter.normalizedGraphIdentity = contentIdentity(graph);
  build.tool.extractorBindingIdentity = contentIdentity(adapter.extractor);
  build.tool.commandIdentity = contentIdentity(build.tool.command);
  refreshToolCertificate(build.tool);
  build.output.graphIdentity = build.adapter.normalizedGraphIdentity;
  sourceReadiness.snapshot.identity = build.output.graphIdentity;
  sourceReadiness.snapshot.version = build.output.graphVersion;
  refreshBuildIdentity(build);
}

function refreshOuterIdentitiesIndependently(
  evidence,
  { recomputeGraphIdentities = true } = {},
) {
  const { adapter, acquisition, build, sourceReadiness } = evidence;
  const graph = adapter.normalization.graph;
  if (recomputeGraphIdentities) {
    graph.topologyIdentity = independentTopologyIdentity(graph);
    graph.geometryIdentity = independentGeometryIdentity(graph);
  }
  adapter.profileIdentity = independentIdentity(adapter.profile);
  adapter.adapterIdentity = independentIdentity({
    schema: adapter.schema,
    profileIdentity: adapter.profileIdentity,
    intermediateIdentity: adapter.intermediateIdentity,
    extractor: adapter.extractor,
    boundary: adapter.boundary,
    turnRestrictions: adapter.turnRestrictions,
    rawGraph: adapter.rawGraph,
    decisions: adapter.decisions,
  });
  acquisition.manifest.manifestIdentity = independentIdentity({
    schema: acquisition.manifest.schema,
    dataClassification: acquisition.manifest.dataClassification,
    source: acquisition.manifest.source,
    references: acquisition.manifest.references,
    policy: acquisition.manifest.policy,
    limitations: acquisition.manifest.limitations,
  });
  const { observationIdentity: _observationIdentity, ...acquisitionCore } = acquisition;
  acquisition.observationIdentity = independentIdentity(acquisitionCore);
  build.acquisition.observationIdentity = acquisition.observationIdentity;
  build.adapter.profileIdentity = adapter.profileIdentity;
  build.adapter.intermediateIdentity = adapter.intermediateIdentity;
  build.adapter.adapterIdentity = adapter.adapterIdentity;
  build.adapter.adapterDocumentIdentity = independentIdentity(adapter);
  build.adapter.normalizedGraphIdentity = independentIdentity(graph);
  build.tool.extractorBindingIdentity = independentIdentity(adapter.extractor);
  build.tool.commandIdentity = independentIdentity(build.tool.command);
  const { certificateIdentity: _certificateIdentity, ...toolCore } = build.tool;
  build.tool.certificateIdentity = independentIdentity(toolCore);
  build.output.graphIdentity = build.adapter.normalizedGraphIdentity;
  sourceReadiness.snapshot.identity = build.output.graphIdentity;
  sourceReadiness.snapshot.version = build.output.graphVersion;
  const { buildIdentity: _buildIdentity, ...buildCore } = build;
  build.buildIdentity = independentIdentity(buildCore);
}

function independentTopologyIdentity(graph) {
  return independentIdentity({
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

function independentGeometryIdentity(graph) {
  return independentIdentity({
    nodes: graph.nodes.map((node) => [node.id, node.coordinate]),
    edges: graph.edges.map((edge) => [edge.id, edge.geometry]),
  });
}

function independentIdentity(value) {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(independentCanonicalize(value)), 'utf8')
    .digest('hex')}`;
}

function independentCanonicalize(value) {
  if (Array.isArray(value)) return value.map(independentCanonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, independentCanonicalize(value[key])]),
  );
}

function refreshAdapterIdentity(adapter) {
  adapter.adapterIdentity = contentIdentity({
    schema: adapter.schema,
    profileIdentity: adapter.profileIdentity,
    intermediateIdentity: adapter.intermediateIdentity,
    extractor: adapter.extractor,
    boundary: adapter.boundary,
    turnRestrictions: adapter.turnRestrictions,
    rawGraph: adapter.rawGraph,
    decisions: adapter.decisions,
  });
}

function refreshManifestIdentity(manifest) {
  manifest.manifestIdentity = contentIdentity({
    schema: manifest.schema,
    dataClassification: manifest.dataClassification,
    source: manifest.source,
    references: manifest.references,
    policy: manifest.policy,
    limitations: manifest.limitations,
  });
}

function refreshAcquisitionIdentity(acquisition) {
  const { observationIdentity: _ignored, ...core } = acquisition;
  acquisition.observationIdentity = contentIdentity(core);
}

function refreshToolCertificate(tool) {
  const { certificateIdentity: _ignored, ...core } = tool;
  tool.certificateIdentity = contentIdentity(core);
}

function refreshBuildIdentity(build) {
  const { buildIdentity: _ignored, ...core } = build;
  build.buildIdentity = contentIdentity(core);
}

function coordinateProfileReference(evidence, profileId) {
  evidence.adapter.profile.profileId = profileId;
  evidence.adapter.profile.candidateProfile.profileId = profileId;
  evidence.adapter.normalization.graph.profileId = profileId;
  evidence.acquisition.manifest.references.profile =
    `route-real-graph-osm-walk-profile/${profileId}`;
}

function coordinateBoundaryReference(evidence, boundaryId) {
  evidence.adapter.boundary.boundaryId = boundaryId;
  evidence.build.boundary.boundaryId = boundaryId;
  evidence.sourceReadiness.boundaryVintage = boundaryId;
  evidence.acquisition.manifest.references.boundary =
    `route-real-graph-boundary/${boundaryId}`;
}

function coordinateToolReference(evidence, toolId, toolVersion) {
  evidence.adapter.extractor.extractorId = toolId;
  evidence.adapter.extractor.extractorVersion = toolVersion;
  evidence.build.tool.toolId = toolId;
  evidence.build.tool.toolVersion = toolVersion;
  evidence.acquisition.manifest.references.tool =
    `route-real-graph-extractor/${toolId}-${toolVersion}`;
}

function coordinateGraphVersion(evidence, graphVersion) {
  evidence.build.output.graphVersion = graphVersion;
  evidence.sourceReadiness.snapshot.version = graphVersion;
}

function addExactDuplicateDirectedEdge(evidence) {
  const feature = structuredClone(evidence.adapter.rawGraph.features[0]);
  feature.source_edge_id = 'osm-way:100:segment:0:part:1';
  evidence.adapter.rawGraph.features.push(feature);
  evidence.adapter.rawGraph.features.sort((left, right) =>
    left.source_edge_id < right.source_edge_id ? -1 : left.source_edge_id > right.source_edge_id ? 1 : 0);
  const edge = structuredClone(evidence.adapter.normalization.graph.edges[0]);
  edge.sourceEdgeId = feature.source_edge_id;
  edge.id = stableEdgeId(seed.sourceId, feature.source_edge_id, 'forward');
  evidence.adapter.normalization.graph.edges.push(edge);
  evidence.adapter.normalization.graph.edges.sort(compareId);
  evidence.adapter.normalization.graph.counts.physicalFeatureCount = 2;
  evidence.adapter.normalization.graph.counts.directedEdgeCount = 2;
  evidence.adapter.normalization.audit.counts.directedEdgeCount = 2;
  evidence.adapter.decisions.inputPhysicalFeatureCount = 2;
  evidence.adapter.decisions.includedPhysicalFeatureCount = 2;
  evidence.build.output.directedEdgeCount = 2;
  evidence.build.output.recordCount = 2;
  evidence.sourceReadiness.recordCount = 2;
}

function makeBidirectional(evidence) {
  const feature = evidence.adapter.rawGraph.features[0];
  feature.walk_direction = 'bidirectional';
  const forward = evidence.adapter.normalization.graph.edges[0];
  forward.sourceDirection = 'bidirectional';
  const reverse = {
    id: stableEdgeId(seed.sourceId, feature.source_edge_id, 'reverse'),
    sourceEdgeId: feature.source_edge_id,
    fromNodeId: forward.toNodeId,
    toNodeId: forward.fromNodeId,
    cost: forward.cost,
    geometry: [...forward.geometry].reverse(),
    traversal: 'reverse',
    sourceDirection: 'bidirectional',
  };
  evidence.adapter.normalization.graph.edges.push(reverse);
  evidence.adapter.normalization.graph.edges.sort(compareId);
  evidence.adapter.normalization.graph.counts.directedEdgeCount = 2;
  evidence.adapter.normalization.audit.counts.directedEdgeCount = 2;
  evidence.build.output.directedEdgeCount = 2;
  evidence.build.output.recordCount = 2;
  evidence.sourceReadiness.recordCount = 2;
}

function matchSubject(handle) {
  return {
    schema: REAL_GRAPH_AUTHORITY_MATCH_SUBJECT_SCHEMA,
    sourceId: handle.sourceId,
    evidenceSetIdentity: handle.evidenceSetIdentity,
    identities: structuredClone(handle.identities),
  };
}

function installedPolicy() {
  return {
    schema: REAL_GRAPH_AUTHORITY_REGISTRY_POLICY_SCHEMA,
    registryRevision: 'route-real-graph-installed-authority-registry/accepted-test-v1',
    acceptedRevisions: {
      acquisition: 'a'.repeat(40),
      adapter: 'b'.repeat(40),
      build: 'c'.repeat(40),
      authority: 'd'.repeat(40),
    },
  };
}

function installedEntry(subject, policy, {
  entryId = 'accepted-test-entry-1',
  sourceAsOf = null,
  sourceAsOfProvenanceIdentity = null,
} = {}) {
  const review = {
    schema: REAL_GRAPH_AUTHORITY_REVIEW_GATE_SCHEMA,
    status: 'accepted',
    acquisitionRevision: policy.acceptedRevisions.acquisition,
    adapterRevision: policy.acceptedRevisions.adapter,
    buildRevision: policy.acceptedRevisions.build,
    authorityRevision: policy.acceptedRevisions.authority,
    reviewEvidenceIdentity: null,
    reviewedBy: 'integration-owner-test-fixture',
    acceptedAt: '2026-08-14T01:00:00.000Z',
    sourceAsOf,
    sourceAsOfProvenanceIdentity,
  };
  refreshReviewIdentity(review);
  const resolution = {
    schema: REAL_GRAPH_OWNER_RESOLVED_STATE_SCHEMA,
    status: 'owner-reviewed-resolved',
    bindings: {
      schema: REAL_GRAPH_OWNER_RESOLVED_BINDINGS_SCHEMA,
      ...structuredClone(subject.identities),
    },
    reviewEvidenceIdentity: review.reviewEvidenceIdentity,
    resolvedAt: review.acceptedAt,
    resolutionIdentity: null,
  };
  refreshResolutionIdentity(resolution);
  const entry = {
    schema: REAL_GRAPH_AUTHORITY_REGISTRY_ENTRY_SCHEMA,
    entryIdentity: null,
    entryId,
    registryRevision: policy.registryRevision,
    sourceId: subject.sourceId,
    evidenceSetIdentity: subject.evidenceSetIdentity,
    identities: structuredClone(subject.identities),
    scopes: [...REQUIRED_INSTALLED_SCOPES],
    review,
    resolution,
  };
  refreshInstalledEntryIdentity(entry);
  return entry;
}

function refreshReviewIdentity(review) {
  const { reviewEvidenceIdentity: _ignored, ...core } = review;
  review.reviewEvidenceIdentity = contentIdentity(core);
}

function refreshResolutionIdentity(resolution) {
  const { resolutionIdentity: _ignored, ...core } = resolution;
  resolution.resolutionIdentity = contentIdentity(core);
}

function refreshInstalledEntryIdentity(entry) {
  entry.entryIdentity = contentIdentity({
    schema: entry.schema,
    entryId: entry.entryId,
    registryRevision: entry.registryRevision,
    sourceId: entry.sourceId,
    evidenceSetIdentity: entry.evidenceSetIdentity,
    identities: entry.identities,
    scopes: entry.scopes,
    review: entry.review,
    resolution: entry.resolution,
  });
}

function nestedRecord(depth) {
  let value = { leaf: true };
  for (let index = 0; index < depth; index += 1) value = { next: value };
  return value;
}

function nestedArray(depth) {
  let value = ['leaf'];
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

function trapProxy(target) {
  let calls = 0;
  const value = new Proxy(target, {
    get() { calls += 1; return undefined; },
    getPrototypeOf() { calls += 1; return Object.prototype; },
    ownKeys() { calls += 1; return []; },
    getOwnPropertyDescriptor() { calls += 1; return undefined; },
  });
  return { value, trapCalls: () => calls };
}

function assertDomainError(action, code) {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof RouteRealGraphAuthorityError, 'expected stable authority domain error');
  assert.equal(caught instanceof RangeError, false);
  assert.equal(caught.code, code);
}

function hostileValues() {
  let proxyCalls = 0;
  const proxy = new Proxy({}, {
    get() { proxyCalls += 1; return undefined; },
    getPrototypeOf() { proxyCalls += 1; return Object.prototype; },
    ownKeys() { proxyCalls += 1; return []; },
    getOwnPropertyDescriptor() { proxyCalls += 1; return undefined; },
  });
  let getterCalls = 0;
  const getter = {};
  Object.defineProperty(getter, 'json', {
    enumerable: true,
    get() { getterCalls += 1; return '{}'; },
  });
  const hidden = {};
  Object.defineProperty(hidden, 'json', { enumerable: false, value: '{}' });
  const symbol = { [Symbol('json')]: '{}' };
  const sparse = new Array(2);
  const mixed = {};
  Object.defineProperties(mixed, {
    mutable: { enumerable: true, configurable: true, writable: true, value: '{}' },
    frozen: { enumerable: true, configurable: false, writable: false, value: '{}' },
  });
  return [
    { name: 'proxy', value: proxy, trapCalls: () => proxyCalls },
    { name: 'getter', value: getter, trapCalls: () => getterCalls },
    { name: 'hidden', value: hidden, trapCalls: () => 0 },
    { name: 'symbol', value: symbol, trapCalls: () => 0 },
    { name: 'sparse', value: sparse, trapCalls: () => 0 },
    { name: 'mixed descriptor', value: mixed, trapCalls: () => 0 },
  ];
}

function compareId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function hash(character) {
  return `sha256:${character.repeat(64)}`;
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function fixture(name) {
  return JSON.parse(await readFile(
    new URL(`../fixtures/route-real-graph-authority/${name}`, import.meta.url),
    'utf8',
  ));
}
