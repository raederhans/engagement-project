import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { compileSyntheticCompactGraph } from '../lib/route_s6_compact_graph/compiler.mjs';
import {
  COMPACT_GRAPH_CANONICALIZATIONS,
  COMPACT_GRAPH_SCHEMA_VERSIONS,
} from '../../src/route_generation/compact_graph/contract_v1.js';
import {
  contentIdentity,
} from '../../src/route_generation/compact_graph/canonical_v1.js';
import {
  createCompactGraphSnapshotLifecycle,
} from '../../src/route_generation/compact_graph_runtime/lifecycle_v1.js';
import {
  admitSyntheticCompactGraphDocuments,
  COMPACT_GRAPH_RUNTIME_CLAIM_BOUNDARY,
} from '../../src/route_generation/compact_graph_runtime/snapshot_v1.js';
import {
  admitCompactGraphWorkerRequest,
  admitCompactGraphWorkerResponse,
  CompactGraphWorkerProtocolError,
  createCompactGraphWorkerCoordinator,
  createCompactGraphWorkerRequest,
  handleCompactGraphWorkerRequest,
} from '../../src/route_generation/compact_graph_runtime/worker_protocol_v1.js';

const RUNTIME_DIR = fileURLToPath(new URL(
  '../../src/route_generation/compact_graph_runtime/',
  import.meta.url,
));

function fixtureText(name) {
  return readFileSync(new URL(`../fixtures/route-s6-compact-graph/${name}`, import.meta.url), 'utf8')
    .trim();
}

function runtimeFixture(name) {
  return JSON.parse(readFileSync(
    new URL(`../fixtures/route-s6-compact-graph-runtime/${name}`, import.meta.url),
    'utf8',
  ));
}

function graphADocuments() {
  return {
    artifactJson: fixtureText('expected_compact_graph.json'),
    manifestJson: fixtureText('expected_manifest.json'),
  };
}

function graphBDocuments() {
  const source = JSON.parse(fixtureText('synthetic_graph_artifact.json'));
  source.graphId = 'synthetic-s6-compact-two-components-b';
  source.receipt.artifactVersion = 'synthetic-s6-compact-fixture-b-v1';
  source.edges[0].objectiveCostUnits = 0;
  source.edges.push({
    edgeId: 'edge-y',
    fromNodeId: 'node-c',
    toNodeId: 'node-b',
    distanceMm: 0,
    objectiveCostUnits: 0,
  });
  const compiled = compileSyntheticCompactGraph(
    source,
    'synthetic-s6-compact-two-components-b',
  );
  return {
    artifactJson: compiled.serializedArtifact,
    manifestJson: compiled.serializedManifest,
  };
}

function install(lifecycle, documents = graphADocuments()) {
  return lifecycle.install(documents.artifactJson, documents.manifestJson);
}

function solve(lifecycle, startNodeId, endNodeId) {
  const request = lifecycle.createSolveRequest(startNodeId, endNodeId);
  return {
    request,
    response: handleCompactGraphWorkerRequest(lifecycle.getState().current, request),
  };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function withArtifactIdentity(artifact) {
  const projection = structuredClone(artifact);
  delete projection.contentIdentity;
  return {
    ...projection,
    contentIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_SCHEMA_VERSIONS.artifactIdentity,
      COMPACT_GRAPH_CANONICALIZATIONS.artifact,
    ),
  };
}

test('exact primitive documents load, install, and solve through the reference protocol', () => {
  const documents = graphADocuments();
  const admission = admitSyntheticCompactGraphDocuments(
    documents.artifactJson,
    documents.manifestJson,
  );
  assertDeepFrozen(admission);
  assert.equal(admission.bundle.artifact.graph.directed, true);
  assert.equal(admission.bundle.artifact.graph.mode, 'walk');

  const lifecycle = createCompactGraphSnapshotLifecycle();
  assert.equal(lifecycle.getState().status, 'empty');
  const installed = install(lifecycle, documents);
  assert.equal(installed.status, 'current');
  assert.equal(installed.receipt.outcome, 'installed');

  const { response } = solve(lifecycle, 'node-a', 'node-c');
  assert.deepEqual(response, {
    schemaVersion: 'engagement-route-s6-compact-graph-worker-response/v1',
    requestId: response.requestId,
    requestSequence: 1,
    requestIdentity: response.requestIdentity,
    graphBinding: response.graphBinding,
    status: 'ready',
    route: {
      nodePath: ['node-a', 'node-b', 'node-c'],
      edgePath: ['edge-a', 'edge-z'],
      distanceMm: 1000,
      objectiveCostUnits: 14,
    },
    unavailableEndpoints: [],
    componentEvidence: null,
    issues: [],
  });
  assert.equal(lifecycle.acceptSolveResponse(response).status, 'accepted');
  assert.deepEqual(lifecycle.getState().latestAcceptedResponse, response);
  assert.strictEqual(lifecycle.getState().latestAcceptedResponse, response);
});

test('loader admits primitive strings only and never reads object, Proxy, or getter ingress', () => {
  const { manifestJson } = graphADocuments();
  let trapCalls = 0;
  const proxy = new Proxy({}, {
    get() { trapCalls += 1; return undefined; },
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
  });
  const getter = {};
  Object.defineProperty(getter, 'artifactJson', {
    enumerable: true,
    get() { trapCalls += 1; return graphADocuments().artifactJson; },
  });
  for (const input of [{}, proxy, getter, Object.freeze({}), [], null, new String('{}')]) {
    assert.throws(
      () => admitSyntheticCompactGraphDocuments(input, manifestJson),
      /primitive JSON text/,
    );
  }
  assert.equal(trapCalls, 0);
});

test('future, missing, extra, duplicate-key, tamper, and identity mismatch documents fail closed', () => {
  const { artifactJson, manifestJson } = graphADocuments();
  const artifact = JSON.parse(artifactJson);

  const future = { ...artifact, schemaVersion: `${artifact.schemaVersion}-future` };
  assert.throws(
    () => admitSyntheticCompactGraphDocuments(JSON.stringify(future), manifestJson),
    /schemaVersion must equal/,
  );

  const missing = { ...artifact };
  delete missing.encoding;
  assert.throws(
    () => admitSyntheticCompactGraphDocuments(JSON.stringify(missing), manifestJson),
    /schema mismatch.*encoding/,
  );

  const extra = { ...artifact, runtimeCurrent: true };
  assert.throws(
    () => admitSyntheticCompactGraphDocuments(JSON.stringify(extra), manifestJson),
    /schema mismatch.*runtimeCurrent/,
  );

  assert.throws(
    () => admitSyntheticCompactGraphDocuments(
      '{"schemaVersion":"a","schemaVersion":"b"}',
      manifestJson,
    ),
    /duplicate JSON object key schemaVersion/,
  );

  const tampered = structuredClone(artifact);
  tampered.edges[0].objectiveCostUnits += 1;
  assert.throws(
    () => admitSyntheticCompactGraphDocuments(JSON.stringify(tampered), manifestJson),
    /content identity does not match/,
  );

  const rebound = structuredClone(artifact);
  rebound.graph.graphId = 'synthetic-s6-compact-mismatch';
  rebound.provenance.sourceGraph.graphId = rebound.graph.graphId;
  const reidentified = withArtifactIdentity(rebound);
  assert.throws(
    () => admitSyntheticCompactGraphDocuments(JSON.stringify(reidentified), manifestJson),
    /manifest does not bind the exact compact graph artifact/,
  );
});

test('admission and installed snapshots are detached, deeply frozen, and identity-dialect explicit', () => {
  const documents = graphADocuments();
  const lifecycle = createCompactGraphSnapshotLifecycle();
  const state = install(lifecycle, documents);
  const snapshot = state.current;
  assertDeepFrozen(state);
  assert.notStrictEqual(snapshot.artifact, JSON.parse(documents.artifactJson));
  assert.equal(snapshot.serializedDocuments.artifactJson, documents.artifactJson);
  assert.equal(snapshot.identities.schemaVersion,
    'engagement-route-s6-compact-graph-identity-dialect/v1');
  assert.equal(snapshot.identities.sourceArtifactIdentity.contentIdentity.schemaVersion,
    'engagement-route-graph-content-identity/v1');
  assert.equal(snapshot.identities.compactEncodingIdentity.contentIdentity.schemaVersion,
    'engagement-route-compact-directed-graph-content-identity/v1');
  assert.equal(snapshot.identities.semanticTopologyIdentity.schemaVersion,
    'engagement-route-s6-semantic-topology-identity/v1');
  assert.equal(snapshot.identities.lifecycleSnapshotIdentity.schemaVersion,
    'engagement-route-s6-lifecycle-snapshot-identity/v1');
  assert.notEqual(
    snapshot.identities.sourceArtifactIdentity.contentIdentity.digest,
    snapshot.identities.semanticTopologyIdentity.contentIdentity.digest,
  );
  assert.match(
    snapshot.identities.semanticTopologyIdentity.excludes.join(','),
    /source-document-order/,
  );
});

test('failed update is atomic and preserves the exact current snapshot and bytes', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  const current = install(lifecycle).current;
  const failed = lifecycle.install(
    current.serializedDocuments.artifactJson.replace('"node-a"', '"node-tampered"'),
    current.serializedDocuments.manifestJson,
  );
  assert.equal(failed.status, 'failed-update');
  assert.equal(failed.receipt.outcome, 'rejected');
  assert.strictEqual(failed.current, current);
  assert.equal(failed.current.serializedDocuments.artifactJson,
    current.serializedDocuments.artifactJson);
  assert.deepEqual(failed.current.identities, current.identities);
});

test('rollback uses only an internally admitted previous snapshot and rebinds lifecycle identity', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  const graphA = install(lifecycle).current;
  const graphB = install(lifecycle, graphBDocuments()).current;
  const forged = lifecycle.rollback({
    digest: graphA.identities.lifecycleSnapshotIdentity.digest,
    snapshotSequence: graphA.snapshotSequence,
  });
  assert.equal(forged.status, 'rejected');
  assert.strictEqual(forged.state.current, graphB);

  const rolledBack = lifecycle.rollback();
  assert.equal(rolledBack.status, 'restored');
  assert.equal(rolledBack.state.status, 'rolled-back');
  assert.equal(
    rolledBack.state.current.serializedDocuments.artifactJson,
    graphA.serializedDocuments.artifactJson,
  );
  assert.notEqual(
    rolledBack.state.current.identities.lifecycleSnapshotIdentity.digest,
    graphA.identities.lifecycleSnapshotIdentity.digest,
  );
  assert.equal(lifecycle.rollback().reasonCode, 'previous-snapshot-unavailable');
});

test('out-of-order and duplicate responses never replace the latest accepted response', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const first = solve(lifecycle, 'node-a', 'node-b');
  const second = solve(lifecycle, 'node-b', 'node-c');
  assert.equal(lifecycle.acceptSolveResponse(second.response).status, 'accepted');
  const latest = lifecycle.getState().latestAcceptedResponse;
  assert.equal(lifecycle.acceptSolveResponse(first.response).status, 'stale');
  assert.strictEqual(lifecycle.getState().latestAcceptedResponse, latest);
  assert.equal(lifecycle.acceptSolveResponse(second.response).status, 'stale');
  assert.strictEqual(lifecycle.getState().latestAcceptedResponse, latest);
});

test('a worker-reported stale response is never installed as the latest response', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const first = solve(lifecycle, 'node-a', 'node-b');
  assert.equal(lifecycle.acceptSolveResponse(first.response).status, 'accepted');
  const latest = lifecycle.getState().latestAcceptedResponse;
  const request = lifecycle.createSolveRequest('node-b', 'node-c');
  const otherGraph = createCompactGraphSnapshotLifecycle();
  install(otherGraph, graphBDocuments());
  const staleResponse = handleCompactGraphWorkerRequest(
    otherGraph.getState().current,
    request,
  );
  assert.equal(staleResponse.status, 'stale');
  assert.equal(lifecycle.acceptSolveResponse(staleResponse).status, 'stale');
  assert.strictEqual(lifecycle.getState().latestAcceptedResponse, latest);
  assert.equal(lifecycle.getPendingRequestCount(), 0);
});

test('cross-lifecycle branded stale injection cannot cancel the victim active request', () => {
  const victim = createCompactGraphSnapshotLifecycle();
  const attacker = createCompactGraphSnapshotLifecycle();
  const mismatchHandler = createCompactGraphSnapshotLifecycle();
  install(victim);
  install(attacker);
  install(mismatchHandler, graphBDocuments());

  const baseline = solve(victim, 'node-a', 'node-b').response;
  assert.equal(victim.acceptSolveResponse(baseline).status, 'accepted');
  const previousLatest = victim.getState().latestAcceptedResponse;

  const victimRequest = victim.createSolveRequest('node-a', 'node-c');
  const attackerRequest = attacker.createSolveRequest('node-a', 'node-b');
  const foreignStale = handleCompactGraphWorkerRequest(
    mismatchHandler.getState().current,
    attackerRequest,
  );
  assert.equal(foreignStale.status, 'stale');
  assert.equal(victim.acceptSolveResponse(foreignStale).status, 'stale');
  assert.equal(victim.getPendingRequestCount(), 1);
  assert.strictEqual(victim.getState().latestAcceptedResponse, previousLatest);

  const genuine = handleCompactGraphWorkerRequest(victim.getState().current, victimRequest);
  assert.equal(victim.acceptSolveResponse(genuine).status, 'accepted');
  assert.equal(victim.getPendingRequestCount(), 0);
  assert.strictEqual(victim.getState().latestAcceptedResponse, genuine);
});

test('same-lifecycle superseded branded stale cannot cancel the newest active request', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  const mismatchHandler = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  install(mismatchHandler, graphBDocuments());

  const supersededRequest = lifecycle.createSolveRequest('node-a', 'node-b');
  const supersededStale = handleCompactGraphWorkerRequest(
    mismatchHandler.getState().current,
    supersededRequest,
  );
  assert.equal(supersededStale.status, 'stale');
  const newestRequest = lifecycle.createSolveRequest('node-b', 'node-c');
  assert.equal(lifecycle.acceptSolveResponse(supersededStale).status, 'stale');
  assert.equal(lifecycle.getPendingRequestCount(), 1);
  assert.equal(lifecycle.getState().latestAcceptedResponse, null);

  const newestResponse = handleCompactGraphWorkerRequest(
    lifecycle.getState().current,
    newestRequest,
  );
  assert.equal(lifecycle.acceptSolveResponse(newestResponse).status, 'accepted');
  assert.equal(lifecycle.getPendingRequestCount(), 0);
  assert.strictEqual(lifecycle.getState().latestAcceptedResponse, newestResponse);
});

test('graph swap rejects old responses and rollback accepts only a newly bound request', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const oldGraphResponse = solve(lifecycle, 'node-a', 'node-b').response;
  install(lifecycle, graphBDocuments());
  assert.equal(lifecycle.acceptSolveResponse(oldGraphResponse).status, 'stale');

  const rollback = lifecycle.rollback();
  assert.equal(rollback.status, 'restored');
  assert.equal(lifecycle.acceptSolveResponse(oldGraphResponse).status, 'stale');
  const restored = solve(lifecycle, 'node-a', 'node-b').response;
  assert.equal(restored.status, 'ready');
  assert.equal(lifecycle.acceptSolveResponse(restored).status, 'accepted');
});

test('directed no-route, endpoint-unavailable, self-route, and zero-cost cycle semantics remain exact', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  assert.equal(solve(lifecycle, 'node-c', 'node-a').response.status, 'no-route');
  assert.equal(solve(lifecycle, 'node-x', 'node-a').response.status, 'no-route');

  const endpoint = solve(lifecycle, 'node-missing', 'node-a').response;
  assert.equal(endpoint.status, 'endpoint-unavailable');
  assert.deepEqual(endpoint.unavailableEndpoints, [
    { endpoint: 'start', nodeId: 'node-missing' },
  ]);

  const self = solve(lifecycle, 'node-b', 'node-b').response;
  assert.equal(self.status, 'ready');
  assert.deepEqual(self.route, {
    nodePath: ['node-b'],
    edgePath: [],
    distanceMm: 0,
    objectiveCostUnits: 0,
  });

  install(lifecycle, graphBDocuments());
  const forwardZero = solve(lifecycle, 'node-b', 'node-c').response;
  const reverseZero = solve(lifecycle, 'node-c', 'node-b').response;
  assert.equal(forwardZero.status, 'ready');
  assert.equal(reverseZero.status, 'ready');
  assert.equal(forwardZero.route.objectiveCostUnits, 0);
  assert.equal(reverseZero.route.objectiveCostUnits, 0);
  assert.equal(forwardZero.route.distanceMm, 0);
  assert.equal(reverseZero.route.distanceMm, 0);
});

test('invalid and stale protocol states never become ready or no-route', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const request = lifecycle.createSolveRequest('node-a', 'node-b');
  assert.throws(
    () => handleCompactGraphWorkerRequest(lifecycle.getState().current, {
      ...request,
      futureField: true,
    }),
    CompactGraphWorkerProtocolError,
  );

  const graphB = createCompactGraphSnapshotLifecycle();
  install(graphB, graphBDocuments());
  const stale = handleCompactGraphWorkerRequest(graphB.getState().current, request);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.route, null);
});

test('reference handler rejects caller-forged snapshot provenance', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const request = lifecycle.createSolveRequest('node-a', 'node-b');
  const forgedSnapshot = structuredClone(lifecycle.getState().current);
  assert.throws(
    () => handleCompactGraphWorkerRequest(forgedSnapshot, request),
    /snapshot-provenance-unavailable/,
  );
});

test('canonical request identity binds coordinator, graph, sequence, mode, and both endpoints', () => {
  const firstLifecycle = createCompactGraphSnapshotLifecycle();
  const secondLifecycle = createCompactGraphSnapshotLifecycle();
  install(firstLifecycle);
  install(secondLifecycle);
  const firstRequest = firstLifecycle.createSolveRequest('node-a', 'node-b');
  const secondRequest = secondLifecycle.createSolveRequest('node-a', 'node-c');

  assert.equal(firstRequest.requestSequence, 1);
  assert.equal(secondRequest.requestSequence, 1);
  assert.notEqual(firstRequest.coordinatorNamespace, secondRequest.coordinatorNamespace);
  assert.notEqual(firstRequest.requestId, secondRequest.requestId);
  assert.notEqual(firstRequest.requestIdentity.digest, secondRequest.requestIdentity.digest);
  assert.equal(firstRequest.requestIdentity.schemaVersion,
    'engagement-route-s6-compact-graph-worker-request-identity/v1');
  assert.equal(firstRequest.requestIdentity.canonicalization,
    'route-s6-worker-request-canonical-json/v1');

  const firstResponse = handleCompactGraphWorkerRequest(
    firstLifecycle.getState().current,
    firstRequest,
  );
  assert.deepEqual(firstResponse.requestIdentity, firstRequest.requestIdentity);
  assert.equal(secondLifecycle.acceptSolveResponse(firstResponse).status, 'stale');
  assert.equal(secondLifecycle.getPendingRequestCount(), 1);

  const secondResponse = handleCompactGraphWorkerRequest(
    secondLifecycle.getState().current,
    secondRequest,
  );
  assert.equal(secondLifecycle.acceptSolveResponse(secondResponse).status, 'accepted');
});

test('a superseded same-graph request cannot collide with a newer endpoint projection', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const oldRequest = lifecycle.createSolveRequest('node-c', 'node-a');
  const oldNoRoute = handleCompactGraphWorkerRequest(lifecycle.getState().current, oldRequest);
  const currentRequest = lifecycle.createSolveRequest('node-a', 'node-b');
  const currentReady = handleCompactGraphWorkerRequest(
    lifecycle.getState().current,
    currentRequest,
  );

  assert.equal(oldNoRoute.status, 'no-route');
  assert.equal(currentReady.status, 'ready');
  assert.equal(lifecycle.acceptSolveResponse(oldNoRoute).status, 'stale');
  assert.equal(lifecycle.getPendingRequestCount(), 1);
  assert.equal(lifecycle.acceptSolveResponse(currentReady).status, 'accepted');
});

test('response terminal truth rejects forged route, totals, endpoints, and false terminals', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const { response } = solve(lifecycle, 'node-a', 'node-c');
  const forgeries = [];

  const inventedNode = structuredClone(response);
  inventedNode.route.nodePath[1] = 'invented-node';
  forgeries.push(inventedNode);
  const inventedEdge = structuredClone(response);
  inventedEdge.route.edgePath[0] = 'invented-edge';
  forgeries.push(inventedEdge);
  const reversedEdge = structuredClone(response);
  reversedEdge.route.nodePath = ['node-c', 'node-b', 'node-a'];
  forgeries.push(reversedEdge);
  const wrongDistance = structuredClone(response);
  wrongDistance.route.distanceMm += 1;
  forgeries.push(wrongDistance);
  const wrongObjective = structuredClone(response);
  wrongObjective.route.objectiveCostUnits += 1;
  forgeries.push(wrongObjective);
  const wrongEndpoint = structuredClone(response);
  wrongEndpoint.route.nodePath[2] = 'node-a';
  forgeries.push(wrongEndpoint);
  const falseNoRoute = structuredClone(response);
  falseNoRoute.status = 'no-route';
  falseNoRoute.route = null;
  falseNoRoute.componentEvidence = {
    schemaVersion: 'engagement-route-s6-weak-component-evidence/v1',
    kind: 'weakly-connected-graph-observation',
    startComponentId: 0,
    endComponentId: 0,
    interpretation: 'synthetic-graph-observation-only-not-authority-or-safety',
  };
  forgeries.push(falseNoRoute);
  const falseUnavailable = structuredClone(response);
  falseUnavailable.status = 'endpoint-unavailable';
  falseUnavailable.route = null;
  falseUnavailable.unavailableEndpoints = [{ endpoint: 'start', nodeId: 'node-a' }];
  forgeries.push(falseUnavailable);

  for (const forged of forgeries) {
    assert.equal(lifecycle.acceptSolveResponse(forged).status, 'invalid');
    assert.equal(lifecycle.getState().latestAcceptedResponse, null);
    assert.equal(lifecycle.getPendingRequestCount(), 1);
  }
  assert.equal(lifecycle.acceptSolveResponse(response).status, 'accepted');
});

test('no-route requires exact bounded weak-component observation evidence', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const disconnected = solve(lifecycle, 'node-x', 'node-a');
  assert.equal(disconnected.response.status, 'no-route');
  assert.deepEqual(disconnected.response.componentEvidence, {
    schemaVersion: 'engagement-route-s6-weak-component-evidence/v1',
    kind: 'weakly-connected-graph-observation',
    startComponentId: 1,
    endComponentId: 0,
    interpretation: 'synthetic-graph-observation-only-not-authority-or-safety',
  });
  assert.equal(lifecycle.acceptSolveResponse(disconnected.response).status, 'accepted');

  const directed = solve(lifecycle, 'node-c', 'node-a');
  assert.equal(directed.response.status, 'no-route');
  assert.equal(directed.response.componentEvidence.startComponentId, 0);
  assert.equal(directed.response.componentEvidence.endComponentId, 0);
  const missingEvidence = structuredClone(directed.response);
  missingEvidence.componentEvidence = null;
  assert.equal(lifecycle.acceptSolveResponse(missingEvidence).status, 'invalid');
  const wrongEvidence = structuredClone(directed.response);
  wrongEvidence.componentEvidence.startComponentId = 1;
  assert.equal(lifecycle.acceptSolveResponse(wrongEvidence).status, 'invalid');
  assert.equal(lifecycle.acceptSolveResponse(directed.response).status, 'accepted');
});

test('same-realm protocol APIs reject Proxy and getter ingress without executing traps', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const request = lifecycle.createSolveRequest('node-a', 'node-b');
  const response = handleCompactGraphWorkerRequest(lifecycle.getState().current, request);
  let trapCalls = 0;
  const hostile = new Proxy({}, {
    get() { trapCalls += 1; return undefined; },
    getPrototypeOf() { trapCalls += 1; return Object.prototype; },
    ownKeys() { trapCalls += 1; return []; },
    getOwnPropertyDescriptor() { trapCalls += 1; return undefined; },
  });
  const nestedGetter = {};
  Object.defineProperty(nestedGetter, 'graphBinding', {
    enumerable: true,
    get() { trapCalls += 1; return request.graphBinding; },
  });

  assert.throws(() => admitCompactGraphWorkerRequest(hostile), CompactGraphWorkerProtocolError);
  assert.throws(
    () => handleCompactGraphWorkerRequest(lifecycle.getState().current, hostile),
    CompactGraphWorkerProtocolError,
  );
  assert.throws(
    () => handleCompactGraphWorkerRequest(lifecycle.getState().current, nestedGetter),
    CompactGraphWorkerProtocolError,
  );
  assert.throws(
    () => admitCompactGraphWorkerResponse(hostile, lifecycle.getState().current),
    CompactGraphWorkerProtocolError,
  );
  assert.equal(lifecycle.acceptSolveResponse(hostile).status, 'invalid');

  const snapshotGetter = {};
  Object.defineProperty(snapshotGetter, 'snapshotSequence', {
    enumerable: true,
    get() { trapCalls += 1; return 1; },
  });
  const coordinator = createCompactGraphWorkerCoordinator();
  assert.throws(
    () => createCompactGraphWorkerRequest(
      snapshotGetter,
      coordinator,
      1,
      'node-a',
      'node-b',
    ),
    CompactGraphWorkerProtocolError,
  );
  assert.equal(trapCalls, 0);
  assert.equal(lifecycle.acceptSolveResponse(response).status, 'accepted');
});

test('response arrays are bounded before arbitrary caller data is traversed', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const { response } = solve(lifecycle, 'node-a', 'node-c');
  const tooManyIssues = structuredClone(response);
  tooManyIssues.issues = Array.from({ length: 10_001 }, () => 'invented-issue');
  assert.equal(lifecycle.acceptSolveResponse(tooManyIssues).status, 'invalid');

  let getterCalls = 0;
  const hostileResponse = {};
  Object.defineProperty(hostileResponse, 'issues', {
    enumerable: true,
    get() { getterCalls += 1; return tooManyIssues.issues; },
  });
  assert.equal(lifecycle.acceptSolveResponse(hostileResponse).status, 'invalid');
  assert.equal(getterCalls, 0);
  assert.equal(lifecycle.getPendingRequestCount(), 1);
  assert.equal(lifecycle.acceptSolveResponse(response).status, 'accepted');
});

test('single-active pending policy remains bounded under many superseding requests', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  install(lifecycle);
  const oldResponses = [];
  for (let index = 0; index < 256; index += 1) {
    const startNodeId = index % 2 === 0 ? 'node-a' : 'node-b';
    const endNodeId = index % 2 === 0 ? 'node-b' : 'node-c';
    const request = lifecycle.createSolveRequest(startNodeId, endNodeId);
    oldResponses.push(handleCompactGraphWorkerRequest(lifecycle.getState().current, request));
    assert.equal(lifecycle.getPendingRequestCount(), 1);
  }
  for (let index = 0; index < 744; index += 1) {
    lifecycle.createSolveRequest('node-a', 'node-c');
    assert.equal(lifecycle.getPendingRequestCount(), 1);
  }
  const latestRequest = lifecycle.createSolveRequest('node-a', 'node-b');
  const latestResponse = handleCompactGraphWorkerRequest(
    lifecycle.getState().current,
    latestRequest,
  );
  assert.equal(lifecycle.acceptSolveResponse(latestResponse).status, 'accepted');
  assert.equal(lifecycle.getPendingRequestCount(), 0);
  for (const oldResponse of oldResponses) {
    assert.equal(lifecycle.acceptSolveResponse(oldResponse).status, 'stale');
  }
  assert.strictEqual(lifecycle.getState().latestAcceptedResponse, latestResponse);
});

test('expected admission failures are classified without a catch-all state mutation', () => {
  const lifecycle = createCompactGraphSnapshotLifecycle();
  const initialState = lifecycle.getState();
  const rejected = lifecycle.install('{}', '{}');
  assert.equal(rejected.status, 'failed-update');
  assert.equal(rejected.receipt.reasonCode, 'bundle-contract-rejected');
  assert.equal(rejected.current, null);
  assert.equal(rejected.previous, null);
  assert.notStrictEqual(rejected, initialState);

  const source = readFileSync(
    new URL('../../src/route_generation/compact_graph_runtime/lifecycle_v1.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /catch\s*\{/);
  assert.match(source, /instanceof CompactGraphRuntimeAdmissionError/);
  assert.match(source, /instanceof CompactGraphWorkerProtocolError/);
});

test('synthetic-only claim boundary cannot be elevated by runtime conformance', () => {
  const fixture = runtimeFixture('claim_boundary.json');
  assert.deepEqual(COMPACT_GRAPH_RUNTIME_CLAIM_BOUNDARY, fixture);
  assert.equal(fixture.classification, 'synthetic-only');
  for (const required of [
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
  ]) assert.equal(fixture.limitations.includes(required), true);
});

test('runtime source stays browser-safe and contains no runtime or persistence wiring', () => {
  const files = readdirSync(RUNTIME_DIR).filter((name) => name.endsWith('.js')).sort();
  assert.deepEqual(files, ['lifecycle_v1.js', 'snapshot_v1.js', 'worker_protocol_v1.js']);
  for (const file of files) {
    const source = readFileSync(`${RUNTIME_DIR}/${file}`, 'utf8');
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()\s*['"]node:/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /\bnew\s+Worker\s*\(/);
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|serviceWorker)\b/);
  }
});
