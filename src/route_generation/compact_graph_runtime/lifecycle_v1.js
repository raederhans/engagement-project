import { deepFreeze } from '../compact_graph/canonical_v1.js';
import {
  admitSyntheticCompactGraphDocuments,
  CompactGraphRuntimeAdmissionError,
  compactGraphSnapshotBinding,
  createInstalledCompactGraphSnapshot,
  rebindInstalledCompactGraphSnapshot,
  sameCompactGraphBinding,
} from './snapshot_v1.js';
import {
  admitCompactGraphWorkerResponse,
  assertCompactGraphWorkerResponseOwnership,
  CompactGraphWorkerProtocolError,
  createCompactGraphWorkerCoordinator,
  createCompactGraphWorkerRequest,
  verifyCompactGraphWorkerResponse,
} from './worker_protocol_v1.js';

export const COMPACT_GRAPH_LIFECYCLE_SCHEMA_VERSIONS = deepFreeze({
  state: 'engagement-route-s6-compact-graph-lifecycle-state/v1',
  receipt: 'engagement-route-s6-compact-graph-lifecycle-receipt/v1',
  responseDisposition: 'engagement-route-s6-worker-response-disposition/v1',
});

export function createCompactGraphSnapshotLifecycle() {
  const workerCoordinator = createCompactGraphWorkerCoordinator();
  let transitionSequence = 0;
  let snapshotSequence = 0;
  let requestSequence = 0;
  let current = null;
  let previous = null;
  let activeRequest = null;
  let latestAcceptedResponse = null;
  let state = lifecycleState('empty', null, null, null, null);

  function install(artifactJson, manifestJson) {
    let admission;
    try {
      admission = admitSyntheticCompactGraphDocuments(artifactJson, manifestJson);
    } catch (error) {
      if (!(error instanceof CompactGraphRuntimeAdmissionError)) throw error;
      transitionSequence += 1;
      const receipt = lifecycleReceipt(
        transitionSequence,
        'install',
        'rejected',
        error.code,
        current,
      );
      state = lifecycleState(
        'failed-update',
        current,
        previous,
        receipt,
        latestAcceptedResponse,
      );
      return state;
    }

    // Any unexpected canonicalization or internal snapshot error propagates
    // before lifecycle state, counters, or pending request ownership changes.
    const installed = createInstalledCompactGraphSnapshot(admission, snapshotSequence + 1);
    snapshotSequence += 1;
    transitionSequence += 1;
    previous = current;
    current = installed;
    activeRequest = null;
    latestAcceptedResponse = null;
    const receipt = lifecycleReceipt(
      transitionSequence,
      'install',
      'installed',
      null,
      current,
    );
    state = lifecycleState('current', current, previous, receipt, null);
    return state;
  }

  function rollback(...callerAuthoredTargets) {
    if (callerAuthoredTargets.length > 0) {
      return rollbackDisposition('rejected', 'caller-authored-rollback-target-forbidden', state);
    }
    if (!previous) {
      return rollbackDisposition('rejected', 'previous-snapshot-unavailable', state);
    }
    const restored = rebindInstalledCompactGraphSnapshot(previous, snapshotSequence + 1);
    snapshotSequence += 1;
    transitionSequence += 1;
    current = restored;
    previous = null;
    activeRequest = null;
    latestAcceptedResponse = null;
    const receipt = lifecycleReceipt(
      transitionSequence,
      'rollback',
      'restored',
      null,
      current,
    );
    state = lifecycleState('rolled-back', current, null, receipt, null);
    return rollbackDisposition('restored', null, state);
  }

  function createSolveRequest(startNodeId, endNodeId) {
    if (!current) throw new TypeError('CompactGraph lifecycle has no current snapshot');
    const nextRequestSequence = requestSequence + 1;
    const request = createCompactGraphWorkerRequest(
      current,
      workerCoordinator,
      nextRequestSequence,
      startNodeId,
      endNodeId,
    );
    requestSequence = nextRequestSequence;
    // Single-active policy: a new request deterministically supersedes the old.
    activeRequest = request;
    return request;
  }

  function acceptSolveResponse(rawResponse) {
    if (!current || !activeRequest) {
      return responseDisposition('stale', 'active-request-unavailable', null);
    }

    let response;
    try {
      response = admitCompactGraphWorkerResponse(rawResponse, current);
    } catch (error) {
      if (!(error instanceof CompactGraphWorkerProtocolError)) throw error;
      return responseDisposition('invalid', error.code, null);
    }

    if (!sameCompactGraphBinding(
      activeRequest.graphBinding,
      compactGraphSnapshotBinding(current),
    )) {
      activeRequest = null;
      return responseDisposition('stale', 'active-request-graph-not-current', response);
    }

    // Status is not authority. A foreign or superseded branded response must
    // prove ownership of this exact closure-owned request before it may clear
    // the single active slot or otherwise affect lifecycle state.
    try {
      assertCompactGraphWorkerResponseOwnership(activeRequest, response);
    } catch (error) {
      if (!(error instanceof CompactGraphWorkerProtocolError)) throw error;
      return responseDisposition('stale', error.code, response);
    }
    if (response.status === 'stale') {
      activeRequest = null;
      return responseDisposition('stale', 'worker-reported-stale', response);
    }

    try {
      response = verifyCompactGraphWorkerResponse(current, activeRequest, response);
    } catch (error) {
      if (!(error instanceof CompactGraphWorkerProtocolError)) throw error;
      if (error.code === 'response-issued-request-provenance-mismatch'
        || error.code === 'response-request-identity-mismatch') {
        return responseDisposition('stale', error.code, response);
      }
      activeRequest = null;
      return responseDisposition('invalid', error.code, response);
    }

    latestAcceptedResponse = response;
    activeRequest = null;
    state = lifecycleState(
      state.status,
      current,
      previous,
      state.receipt,
      latestAcceptedResponse,
    );
    return responseDisposition('accepted', null, response);
  }

  return Object.freeze({
    getState: () => state,
    getPendingRequestCount: () => (activeRequest ? 1 : 0),
    install,
    rollback,
    createSolveRequest,
    acceptSolveResponse,
  });
}

function lifecycleState(status, current, previous, receipt, latestAcceptedResponse) {
  return deepFreeze({
    schemaVersion: COMPACT_GRAPH_LIFECYCLE_SCHEMA_VERSIONS.state,
    status,
    current,
    previous,
    receipt,
    latestAcceptedResponse,
  });
}

function lifecycleReceipt(sequence, operation, outcome, reasonCode, snapshot) {
  return deepFreeze({
    schemaVersion: COMPACT_GRAPH_LIFECYCLE_SCHEMA_VERSIONS.receipt,
    transitionSequence: sequence,
    operation,
    outcome,
    reasonCode,
    snapshotSequence: snapshot?.snapshotSequence ?? null,
    lifecycleSnapshotDigest: snapshot?.identities.lifecycleSnapshotIdentity.digest ?? null,
    compactEncodingDigest:
      snapshot?.identities.compactEncodingIdentity.contentIdentity.digest ?? null,
  });
}

function rollbackDisposition(status, reasonCode, nextState) {
  return deepFreeze({ status, reasonCode, state: nextState });
}

function responseDisposition(status, reasonCode, response) {
  return deepFreeze({
    schemaVersion: COMPACT_GRAPH_LIFECYCLE_SCHEMA_VERSIONS.responseDisposition,
    status,
    reasonCode,
    response,
  });
}
