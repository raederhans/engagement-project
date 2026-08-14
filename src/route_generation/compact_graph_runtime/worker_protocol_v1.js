import { findShortestPath } from '../base_dijkstra.js';
import {
  canonicalStringify,
  contentIdentity,
  deepFreeze,
} from '../compact_graph/canonical_v1.js';
import {
  compactGraphSnapshotBinding,
  compactSnapshotToSolverGraphArtifact,
  isInstalledCompactGraphSnapshot,
  sameCompactGraphBinding,
} from './snapshot_v1.js';

export const COMPACT_GRAPH_WORKER_PROTOCOL = deepFreeze({
  request: 'engagement-route-s6-compact-graph-worker-request/v1',
  requestIdentity: 'engagement-route-s6-compact-graph-worker-request-identity/v1',
  requestCanonicalization: 'route-s6-worker-request-canonical-json/v1',
  response: 'engagement-route-s6-compact-graph-worker-response/v1',
  binding: 'engagement-route-s6-compact-graph-binding/v1',
  componentEvidence: 'engagement-route-s6-weak-component-evidence/v1',
  error: 'engagement-route-s6-worker-protocol-error/v1',
  statuses: ['ready', 'no-route', 'endpoint-unavailable', 'invalid', 'stale'],
});

const MAX_ISSUES = 8;
const MAX_UNAVAILABLE_ENDPOINTS = 2;
const COORDINATORS = new WeakSet();
const COORDINATOR_NAMESPACES = new WeakMap();
const WORKER_REQUESTS = new WeakSet();
const WORKER_RESPONSES = new WeakSet();
const RESPONSE_REQUESTS = new WeakMap();
let coordinatorSequence = 0;

export class CompactGraphWorkerProtocolError extends TypeError {
  constructor(code) {
    super(`CompactGraph Worker protocol rejected: ${code}`);
    this.name = 'CompactGraphWorkerProtocolError';
    this.code = code;
    this.schemaVersion = COMPACT_GRAPH_WORKER_PROTOCOL.error;
  }
}

export function createCompactGraphWorkerCoordinator() {
  if (coordinatorSequence >= Number.MAX_SAFE_INTEGER) {
    throw protocolError('coordinator-capacity-exhausted');
  }
  coordinatorSequence += 1;
  const coordinator = Object.freeze({});
  COORDINATORS.add(coordinator);
  COORDINATOR_NAMESPACES.set(
    coordinator,
    `synthetic-runtime-coordinator-${coordinatorSequence}`,
  );
  return coordinator;
}

/**
 * Same-realm request factory. Provenance checks happen before any snapshot or
 * coordinator field is read. There is deliberately no arbitrary object ingress.
 */
export function createCompactGraphWorkerRequest(
  snapshot,
  coordinator,
  requestSequence,
  startNodeId,
  endNodeId,
) {
  assertInstalledSnapshot(snapshot);
  if (!COORDINATORS.has(coordinator)) throw protocolError('coordinator-provenance-unavailable');
  assertPositiveInteger(requestSequence, 'request-sequence-invalid');
  assertEndpointId(startNodeId, 'start-node-id-invalid');
  assertEndpointId(endNodeId, 'end-node-id-invalid');

  const coordinatorNamespace = COORDINATOR_NAMESPACES.get(coordinator);
  const graphBinding = compactGraphSnapshotBinding(snapshot);
  const projection = {
    schemaVersion: COMPACT_GRAPH_WORKER_PROTOCOL.request,
    coordinatorNamespace,
    graphBinding,
    requestSequence,
    mode: snapshot.artifact.graph.mode,
    startNodeId,
    endNodeId,
  };
  const request = deepFreeze({
    ...projection,
    requestId: `synthetic-compact-solve:${coordinatorNamespace}:${requestSequence}`,
    requestIdentity: contentIdentity(
      projection,
      COMPACT_GRAPH_WORKER_PROTOCOL.requestIdentity,
      COMPACT_GRAPH_WORKER_PROTOCOL.requestCanonicalization,
    ),
  });
  WORKER_REQUESTS.add(request);
  return request;
}

/**
 * Pure same-realm reference handler. It starts no Worker and performs no I/O,
 * scheduling, persistence, environment detection, network access, or fetch.
 */
export function handleCompactGraphWorkerRequest(snapshot, rawRequest) {
  assertInstalledSnapshot(snapshot);
  const request = admitCompactGraphWorkerRequest(rawRequest);
  const currentBinding = compactGraphSnapshotBinding(snapshot);
  if (!sameCompactGraphBinding(request.graphBinding, currentBinding)
    || request.mode !== snapshot.artifact.graph.mode) {
    return responseFor(request, {
      status: 'stale',
      issues: ['graph-binding-not-current'],
    });
  }
  return solveReferenceResponse(snapshot, request);
}

export function admitCompactGraphWorkerRequest(raw) {
  if (!WORKER_REQUESTS.has(raw)) throw protocolError('request-provenance-unavailable');
  validateInternalRequest(raw);
  return raw;
}

export function admitCompactGraphWorkerResponse(raw, snapshot) {
  assertInstalledSnapshot(snapshot);
  if (!WORKER_RESPONSES.has(raw)) throw protocolError('response-provenance-unavailable');
  validateInternalResponseBounds(raw, snapshot);
  return raw;
}

/**
 * Bind a handler-produced response to the closure-owned issued request and
 * recompute its complete terminal truth against the exact current snapshot.
 */
export function verifyCompactGraphWorkerResponse(snapshot, issuedRequest, rawResponse) {
  assertInstalledSnapshot(snapshot);
  const request = admitCompactGraphWorkerRequest(issuedRequest);
  const response = admitCompactGraphWorkerResponse(rawResponse, snapshot);
  assertCompactGraphWorkerResponseOwnership(request, response);
  const expected = solveReferenceResponse(snapshot, request);
  if (canonicalStringify(response) !== canonicalStringify(expected)) {
    throw protocolError('response-terminal-truth-mismatch');
  }
  return response;
}

/**
 * Verify closure-owned request provenance and its complete echoed identity
 * before a lifecycle interprets any response status as a state transition.
 */
export function assertCompactGraphWorkerResponseOwnership(issuedRequest, rawResponse) {
  const request = admitCompactGraphWorkerRequest(issuedRequest);
  if (!WORKER_RESPONSES.has(rawResponse)) {
    throw protocolError('response-provenance-unavailable');
  }
  const response = rawResponse;
  const responseRequest = RESPONSE_REQUESTS.get(response);
  if (responseRequest !== request
    || !sameCompactGraphWorkerRequest(responseRequest, request)) {
    throw protocolError('response-issued-request-provenance-mismatch');
  }
  if (response.requestId !== request.requestId
    || response.requestSequence !== request.requestSequence
    || canonicalStringify(response.requestIdentity) !== canonicalStringify(request.requestIdentity)
    || !sameCompactGraphBinding(response.graphBinding, request.graphBinding)) {
    throw protocolError('response-request-identity-mismatch');
  }
  return response;
}

export function sameCompactGraphWorkerRequest(left, right) {
  if (!WORKER_REQUESTS.has(left) || !WORKER_REQUESTS.has(right)) return false;
  return canonicalStringify(left) === canonicalStringify(right);
}

function solveReferenceResponse(snapshot, request) {
  const solverResult = findShortestPath(
    compactSnapshotToSolverGraphArtifact(snapshot),
    { startNodeId: request.startNodeId, endNodeId: request.endNodeId },
  );
  if (solverResult.status === 'ready') {
    return responseFor(request, {
      status: 'ready',
      route: {
        nodePath: solverResult.nodePath,
        edgePath: solverResult.edgePath,
        distanceMm: solverResult.distanceMm,
        objectiveCostUnits: solverResult.objectiveCostUnits,
      },
    });
  }
  if (solverResult.status === 'no_route') {
    return responseFor(request, {
      status: 'no-route',
      componentEvidence: componentEvidence(snapshot, request),
    });
  }
  if (solverResult.status === 'endpoint_unavailable') {
    return responseFor(request, {
      status: 'endpoint-unavailable',
      unavailableEndpoints: solverResult.unavailableEndpoints,
    });
  }
  return responseFor(request, {
    status: 'invalid',
    issues: ['solver-result-not-ready'],
  });
}

function responseFor(request, {
  status,
  route = null,
  unavailableEndpoints = [],
  componentEvidence: evidence = null,
  issues = [],
}) {
  const response = deepFreeze({
    schemaVersion: COMPACT_GRAPH_WORKER_PROTOCOL.response,
    requestId: request.requestId,
    requestSequence: request.requestSequence,
    requestIdentity: request.requestIdentity,
    graphBinding: request.graphBinding,
    status,
    route,
    unavailableEndpoints,
    componentEvidence: evidence,
    issues,
  });
  WORKER_RESPONSES.add(response);
  RESPONSE_REQUESTS.set(response, request);
  return response;
}

function componentEvidence(snapshot, request) {
  const nodeIndexById = new Map(
    snapshot.artifact.nodeIds.map((nodeId, index) => [nodeId, index]),
  );
  return deepFreeze({
    schemaVersion: COMPACT_GRAPH_WORKER_PROTOCOL.componentEvidence,
    kind: 'weakly-connected-graph-observation',
    startComponentId:
      snapshot.artifact.components.byNodeIndex[nodeIndexById.get(request.startNodeId)],
    endComponentId:
      snapshot.artifact.components.byNodeIndex[nodeIndexById.get(request.endNodeId)],
    interpretation: 'synthetic-graph-observation-only-not-authority-or-safety',
  });
}

function validateInternalRequest(request) {
  const expectedKeys = [
    'schemaVersion',
    'coordinatorNamespace',
    'graphBinding',
    'requestSequence',
    'mode',
    'startNodeId',
    'endNodeId',
    'requestId',
    'requestIdentity',
  ];
  assertExactInternalKeys(request, expectedKeys, 'request-shape-invalid');
  if (request.schemaVersion !== COMPACT_GRAPH_WORKER_PROTOCOL.request) {
    throw protocolError('request-schema-version-unsupported');
  }
  assertCanonicalId(request.coordinatorNamespace, 'coordinator-namespace-invalid');
  assertPositiveInteger(request.requestSequence, 'request-sequence-invalid');
  assertCanonicalId(request.requestId, 'request-id-invalid');
  assertEndpointId(request.startNodeId, 'start-node-id-invalid');
  assertEndpointId(request.endNodeId, 'end-node-id-invalid');
  if (request.mode !== 'walk') throw protocolError('request-mode-unsupported');
  validateRequestIdentity(request);
}

function validateRequestIdentity(request) {
  const expected = contentIdentity(
    {
      schemaVersion: request.schemaVersion,
      coordinatorNamespace: request.coordinatorNamespace,
      graphBinding: request.graphBinding,
      requestSequence: request.requestSequence,
      mode: request.mode,
      startNodeId: request.startNodeId,
      endNodeId: request.endNodeId,
    },
    COMPACT_GRAPH_WORKER_PROTOCOL.requestIdentity,
    COMPACT_GRAPH_WORKER_PROTOCOL.requestCanonicalization,
  );
  if (canonicalStringify(request.requestIdentity) !== canonicalStringify(expected)) {
    throw protocolError('request-identity-mismatch');
  }
}

function validateInternalResponseBounds(response, snapshot) {
  assertExactInternalKeys(response, [
    'schemaVersion',
    'requestId',
    'requestSequence',
    'requestIdentity',
    'graphBinding',
    'status',
    'route',
    'unavailableEndpoints',
    'componentEvidence',
    'issues',
  ], 'response-shape-invalid');
  if (response.schemaVersion !== COMPACT_GRAPH_WORKER_PROTOCOL.response) {
    throw protocolError('response-schema-version-unsupported');
  }
  if (!COMPACT_GRAPH_WORKER_PROTOCOL.statuses.includes(response.status)) {
    throw protocolError('response-status-unsupported');
  }
  assertCanonicalId(response.requestId, 'response-request-id-invalid');
  assertPositiveInteger(response.requestSequence, 'response-request-sequence-invalid');
  assertBoundedIssues(response.issues);
  assertUnavailableEndpoints(response.unavailableEndpoints, response.status);
  assertBoundedRoute(response.route, response.status, snapshot);
  assertComponentEvidence(response.componentEvidence, response.status, snapshot);
  if (response.status === 'invalid' && response.issues.length === 0) {
    throw protocolError('invalid-response-issue-required');
  }
}

function assertBoundedRoute(route, status, snapshot) {
  if (status !== 'ready') {
    if (route !== null) throw protocolError('non-ready-route-must-be-null');
    return;
  }
  assertExactInternalKeys(route, [
    'nodePath', 'edgePath', 'distanceMm', 'objectiveCostUnits',
  ], 'response-route-shape-invalid');
  if (!Array.isArray(route.nodePath)
    || route.nodePath.length < 1
    || route.nodePath.length > snapshot.artifact.graph.nodeCount) {
    throw protocolError('response-node-path-bound-invalid');
  }
  if (!Array.isArray(route.edgePath)
    || route.edgePath.length > snapshot.artifact.graph.edgeCount
    || route.edgePath.length + 1 !== route.nodePath.length) {
    throw protocolError('response-edge-path-bound-invalid');
  }
  for (const nodeId of route.nodePath) assertCanonicalId(nodeId, 'response-node-id-invalid');
  for (const edgeId of route.edgePath) assertCanonicalId(edgeId, 'response-edge-id-invalid');
  assertNonNegativeInteger(route.distanceMm, 'response-distance-invalid');
  assertNonNegativeInteger(route.objectiveCostUnits, 'response-objective-invalid');
}

function assertUnavailableEndpoints(entries, status) {
  if (!Array.isArray(entries) || entries.length > MAX_UNAVAILABLE_ENDPOINTS) {
    throw protocolError('unavailable-endpoints-bound-invalid');
  }
  const labels = new Set();
  for (const entry of entries) {
    assertExactInternalKeys(entry, ['endpoint', 'nodeId'], 'unavailable-endpoint-shape-invalid');
    if (!['start', 'end'].includes(entry.endpoint) || labels.has(entry.endpoint)) {
      throw protocolError('unavailable-endpoint-label-invalid');
    }
    labels.add(entry.endpoint);
    if (entry.nodeId !== null) assertEndpointId(entry.nodeId, 'unavailable-node-id-invalid');
  }
  if ((status === 'endpoint-unavailable') !== (entries.length > 0)) {
    throw protocolError('unavailable-endpoint-status-mismatch');
  }
}

function assertComponentEvidence(evidence, status, snapshot) {
  if (status !== 'no-route') {
    if (evidence !== null) throw protocolError('component-evidence-status-mismatch');
    return;
  }
  assertExactInternalKeys(evidence, [
    'schemaVersion',
    'kind',
    'startComponentId',
    'endComponentId',
    'interpretation',
  ], 'component-evidence-shape-invalid');
  if (evidence.schemaVersion !== COMPACT_GRAPH_WORKER_PROTOCOL.componentEvidence
    || evidence.kind !== 'weakly-connected-graph-observation'
    || evidence.interpretation
      !== 'synthetic-graph-observation-only-not-authority-or-safety') {
    throw protocolError('component-evidence-contract-invalid');
  }
  assertComponentId(evidence.startComponentId, snapshot);
  assertComponentId(evidence.endComponentId, snapshot);
}

function assertBoundedIssues(issues) {
  if (!Array.isArray(issues) || issues.length > MAX_ISSUES) {
    throw protocolError('response-issues-bound-invalid');
  }
  for (const issue of issues) {
    if (typeof issue !== 'string' || issue.length === 0 || issue.length > 120) {
      throw protocolError('response-issue-invalid');
    }
  }
}

function assertExactInternalKeys(value, expectedKeys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError(code);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key) => !expectedKeys.includes(key))) {
    throw protocolError(code);
  }
}

function assertInstalledSnapshot(snapshot) {
  if (!isInstalledCompactGraphSnapshot(snapshot)) {
    throw protocolError('snapshot-provenance-unavailable');
  }
}

function assertComponentId(value, snapshot) {
  if (!Number.isSafeInteger(value)
    || value < 0
    || value >= snapshot.artifact.components.count) {
    throw protocolError('component-id-invalid');
  }
}

function assertEndpointId(value, code) {
  assertCanonicalId(value, code);
}

function assertCanonicalId(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160
    || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw protocolError(code);
  }
}

function assertPositiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw protocolError(code);
}

function assertNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw protocolError(code);
  }
}

function protocolError(code) {
  return new CompactGraphWorkerProtocolError(code);
}
