import { types as utilTypes } from 'node:util';

import {
  OSRM_GRAPH_ARTIFACT_SCHEMA,
  OSRM_MATURE_ENGINE_RECEIPT_SCHEMA,
  inspectOsrmMatureEngineReceiptJson,
  validateInstalledOsrmMatureEngineReceipt,
} from '../route_real_graph_build/osrm_mature_engine_receipt.mjs';
import {
  canonicalStringify,
  contentIdentity,
  fail,
  freezeData,
} from './safe_data.mjs';

export const MATURE_ENGINE_AUTHORITY_HANDLE_SCHEMA =
  'route-real-mature-engine-authority-handle/v1';
export const MATURE_ENGINE_AUTHORIZATION_SCHEMA =
  'route-real-mature-engine-authorization/v1';

const PREPARED_HANDLES = new WeakMap();
const ATTEMPTED_HANDLES = new WeakSet();

// Integration-owner-controlled positive capability root. It is intentionally
// one exact installed receipt, not a caller-extensible list or JSON registry.
const INSTALLED = Object.freeze({
  registryRevision: 'route-real-mature-engine-registry/m5-1-persistent-m4-refresh-osrm-26.8.0-v4',
  receiptSchema: OSRM_MATURE_ENGINE_RECEIPT_SCHEMA,
  receiptIdentity: 'sha256:378bf673e8435e769b2052e4069c735e79e3c39ff87140a06edd895d2469ebf0',
  graphArtifactIdentity: 'sha256:3adc0b82ec95257a58eae324dbdd0a469e5e54599461c152bf3b3239049901e0',
  topologyIdentity: 'sha256:25f3d33d33d82cf670c64db2f1bbc7e0bc7f9c1a11a31ba8ad700eb7fc6e0e3a',
  geometryIdentity: 'sha256:eef990bba12ff2891f01e66805bf6c6f84df764b45e6f66eacd8e11ee6b7c75b',
  engineAssetIdentity: 'sha256:623f60bb4202e21309db91ec9d84b508a134db6d8dda8ab0abc02613719ff728',
  sourcePayloadIdentity: 'sha256:b8f3db07ac7def4d9b7faf66d061e96987edd75e0ec7573eb9c70167327af174',
  profileIdentity: 'sha256:15000dda857c64dd6bf007b8985ad8c1e53ac23e32a0493e9a2cb4918749b709',
  authorityBoundaryIdentity: 'sha256:7cf4bb28468d048f2f775ae6f7a3f9d2db85f861e2b70839c18e097614dc69e2',
  m4SourceFinalRevision: '9c9b6a071aa87af09b7ed351856d3642622926fc',
  m4HandoffIdentity: 'sha256:c0ea04ced25bc10054f0527d50416dcd16da9f409b6a52e70c9094b18119c63f',
});

export function inspectInstalledMatureEngineRegistry() {
  if (arguments.length !== 0) {
    fail('mature-engine-registry-arguments', 'registry inspection accepts no caller input');
  }
  return freezeData({
    configured: true,
    entryCount: 1,
    registryRevision: INSTALLED.registryRevision,
    receiptSchema: INSTALLED.receiptSchema,
    receiptIdentity: INSTALLED.receiptIdentity,
    graphArtifactIdentity: INSTALLED.graphArtifactIdentity,
    callerExtensible: false,
    privateRuntimeProductPromotion: false,
    publicationAuthorized: false,
    redistributionAuthorized: false,
  }, 'installed mature-engine registry inspection');
}

export function matchMatureEngineReceiptAgainstInstalledRegistry(receiptJsonText) {
  if (arguments.length !== 1 || typeof receiptJsonText !== 'string') {
    fail('mature-engine-match-arguments', 'registry matching accepts one primitive receipt JSON text');
  }
  const receipt = inspectOsrmMatureEngineReceiptJson(receiptJsonText);
  try {
    assertInstalledReceipt(receipt);
    return freezeData({
      status: 'exact-match',
      exactMatch: true,
      registryRevision: INSTALLED.registryRevision,
      receiptIdentity: receipt.receiptIdentity,
      authorityIssued: false,
    }, 'neutral mature-engine registry match');
  } catch {
    return freezeData({
      status: 'no-match',
      exactMatch: false,
      registryRevision: INSTALLED.registryRevision,
      receiptIdentity: receipt.receiptIdentity,
      authorityIssued: false,
    }, 'neutral mature-engine registry no-match');
  }
}

export function prepareInstalledMatureEngineAuthority() {
  if (arguments.length !== 0) {
    fail('mature-engine-prepare-arguments', 'authority preparation accepts no caller paths, receipt, hashes, or facts');
  }
  const receipt = validateInstalledOsrmMatureEngineReceipt();
  assertInstalledReceipt(receipt);
  const core = {
    schema: MATURE_ENGINE_AUTHORITY_HANDLE_SCHEMA,
    status: 'installed-evidence-bound',
    registryRevision: INSTALLED.registryRevision,
    receiptIdentity: receipt.receiptIdentity,
    graphArtifactIdentity: receipt.graph.artifactIdentity,
    authorityAvailable: true,
    localRoutingAuthorized: false,
    privateRuntimeProductPromotion: false,
    publicationAuthorized: false,
    redistributionAuthorized: false,
  };
  const handle = freezeData({ ...core, handleIdentity: contentIdentity(core) }, 'mature-engine authority handle');
  PREPARED_HANDLES.set(handle, receipt);
  return handle;
}

export function authorizeInstalledMatureEngine(handle) {
  if (arguments.length !== 1) {
    fail('mature-engine-authorize-arguments', 'authorization accepts one exact same-session handle only');
  }
  if (utilTypes.isProxy(handle)) fail('mature-engine-handle-proxy', 'authority handle must not be a Proxy');
  const preparedReceipt = PREPARED_HANDLES.get(handle);
  if (!preparedReceipt) {
    fail('mature-engine-handle-unavailable', 'authorization requires the exact same-session installed handle');
  }
  if (ATTEMPTED_HANDLES.has(handle)) {
    fail('mature-engine-handle-replay', 'authority handle can be evaluated only once');
  }
  assertHandleIntact(handle, preparedReceipt);

  // Re-read every bound file at issuance time to close preparation/issuance
  // replacement and mutation windows.
  const currentReceipt = validateInstalledOsrmMatureEngineReceipt();
  assertInstalledReceipt(currentReceipt);
  if (canonicalStringify(currentReceipt) !== canonicalStringify(preparedReceipt)) {
    fail('mature-engine-evidence-replaced', 'installed evidence changed after handle preparation');
  }
  ATTEMPTED_HANDLES.add(handle);

  const graphArtifact = freezeData({
    schema: OSRM_GRAPH_ARTIFACT_SCHEMA,
    artifactKind: 'osrm-mld-dataset',
    graphId: currentReceipt.graph.artifactIdentity,
    mode: 'walking',
    engine: 'Project OSRM 26.8.0',
    algorithm: 'MLD',
    localArtifactRoot: currentReceipt.graph.artifactRoot,
    fileCount: currentReceipt.graph.fileCount,
    totalBytes: currentReceipt.graph.totalBytes,
    topologyIdentity: currentReceipt.graph.topologyIdentity,
    geometryIdentity: currentReceipt.graph.geometryIdentity,
    receiptIdentity: currentReceipt.receiptIdentity,
    authorityBoundaryIdentity: INSTALLED.authorityBoundaryIdentity,
    m4HandoffIdentity: INSTALLED.m4HandoffIdentity,
    accessibilityAuthority: false,
    safetyAuthority: false,
    realtimeAuthority: false,
    privateRuntimeProductPromotion: false,
  }, 'installed OSRM graph artifact');

  const authorityCore = {
    schema: MATURE_ENGINE_AUTHORIZATION_SCHEMA,
    status: 'authorized-local-build',
    registryRevision: INSTALLED.registryRevision,
    receiptIdentity: currentReceipt.receiptIdentity,
    graphArtifact,
    engineAuthority: {
      matureEngine: true,
      localRouting: true,
      mode: 'walking',
      travelTime: true,
      accessibility: false,
      realtime: false,
      safety: false,
      localLoopbackOnly: true,
      authorityScope: 'inside-exact-philadelphia-city-limits-polygon',
    },
    sourceHealthProjection: {
      status: 'not-applied',
      proposedStatus: 'current',
      applied: false,
      centralOwnerAuthorizationRequired: true,
    },
    privateRuntimeProductPromotion: false,
    candidateGenerationAuthorized: false,
    paretoRankingAuthorized: false,
    publicationAuthorized: false,
    redistributionAuthorized: false,
    deploymentAuthorized: false,
  };
  return freezeData({
    ...authorityCore,
    authorizationIdentity: contentIdentity(authorityCore),
  }, 'installed mature-engine authorization');
}

function assertInstalledReceipt(receipt) {
  const checks = [
    [receipt.schema, INSTALLED.receiptSchema],
    [receipt.receiptIdentity, INSTALLED.receiptIdentity],
    [receipt.graph?.artifactIdentity, INSTALLED.graphArtifactIdentity],
    [receipt.graph?.topologyIdentity, INSTALLED.topologyIdentity],
    [receipt.graph?.geometryIdentity, INSTALLED.geometryIdentity],
    [receipt.engine?.nativeAsset?.sha256, INSTALLED.engineAssetIdentity],
    [receipt.input?.pbf?.sha256, INSTALLED.sourcePayloadIdentity],
    [receipt.profile?.profileIdentity, INSTALLED.profileIdentity],
    [receipt.authorityBoundary?.file?.sha256, INSTALLED.authorityBoundaryIdentity],
    [receipt.m4Handoff?.sourceFinalRevision, INSTALLED.m4SourceFinalRevision],
    [receipt.m4Handoff?.handoffIdentity, INSTALLED.m4HandoffIdentity],
  ];
  if (checks.some(([actual, expected]) => actual !== expected)
    || receipt.status !== 'complete'
    || receipt.authority?.graphArtifact !== true
    || receipt.authority?.matureEngine !== true
    || receipt.authority?.localRouting !== true
    || receipt.authority?.mode !== 'walking'
    || receipt.authority?.travelTime !== true
    || receipt.authority?.accessibility !== false
    || receipt.authority?.safety !== false
    || receipt.authority?.privateRuntimeProductPromotion !== false
    || receipt.privacy?.remoteRoutingApiUsed !== false
    || receipt.privacy?.privateAddressUsed !== false
    || receipt.privacy?.privateCoordinatesUsed !== false
    || receipt.privacy?.privateRouteGeometryUsed !== false
    || receipt.privacy?.diaryUsed !== false
    || receipt.privacy?.userInputUsed !== false) {
    fail('mature-engine-authority-unavailable', 'installed receipt does not exactly match the private positive registry');
  }
}

function assertHandleIntact(handle, receipt) {
  if (!Object.isFrozen(handle)) fail('mature-engine-handle-tampered', 'authority handle must remain frozen');
  const { handleIdentity, ...core } = handle;
  if (handleIdentity !== contentIdentity(core)
    || handle.receiptIdentity !== receipt.receiptIdentity
    || handle.graphArtifactIdentity !== receipt.graph.artifactIdentity
    || handle.registryRevision !== INSTALLED.registryRevision) {
    fail('mature-engine-handle-tampered', 'authority handle no longer binds its exact installed receipt');
  }
}
