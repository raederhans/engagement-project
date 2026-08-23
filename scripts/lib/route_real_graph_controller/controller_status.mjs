import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  CONTROLLER_STATUS_SCHEMA,
} from './contracts.mjs';
import {
  readInstalledLiveReleaseJsonText,
  readInstalledPersistentNonceStoreObservationJsonText,
  readInstalledCurlObservationJsonText,
  readInstalledToolObservationJsonText,
  readInstalledTrustedControllerObservationJsonText,
} from './private_registry.mjs';

export function inspectRouteRealGraphControllerStatus() {
  if (arguments.length !== 0) {
    fail('caller-controller-authority-forbidden', 'controller status accepts no caller records');
  }
  const controller = readInstalledTrustedControllerObservationJsonText();
  const tool = readInstalledToolObservationJsonText();
  const curl = readInstalledCurlObservationJsonText();
  const release = readInstalledLiveReleaseJsonText();
  const nonceStore = readInstalledPersistentNonceStoreObservationJsonText();
  return freezeData({
    schema: CONTROLLER_STATUS_SCHEMA,
    status: 'authority-unavailable',
    sourceCoreImplemented: true,
    controllerRegistryState: controller === null ? 'empty' : 'unreviewed-record',
    toolRegistryState: tool === null ? 'empty' : 'unreviewed-record',
    curlRegistryState: curl === null ? 'empty' : 'unreviewed-record',
    liveReleaseRegistryState: release === null ? 'empty' : 'unreviewed-record',
    nonceStoreRegistryState: nonceStore === null ? 'empty' : 'unreviewed-record',
    trustedControllerInstalled: false,
    installedToolAdmitted: false,
    downloadTransportAdmitted: false,
    liveReleaseInstalled: false,
    persistentNonceStoreObserved: false,
    oneShotConsumptionCapabilityImplemented: false,
    processTreeContainmentImplemented: false,
    handleLevelFilesystemSafetyImplemented: false,
    commandsRunnable: false,
    actualAcquisition: false,
    actualExtraction: false,
    actualIntermediate: false,
    actualGraph: false,
    sourceHealthProjection: {
      status: 'unknown',
      observationState: 'not-observed',
      recordCount: null,
      catalogMutationAuthorized: false,
      runtimeMutationAuthorized: false,
    },
    runtimeAuthorized: false,
    publicationAuthorized: false,
    reasonCodes: [
      'trusted-controller-observation-missing',
      'installed-tool-admission-missing',
      'download-transport-admission-missing',
      'live-release-missing',
      'persistent-nonce-store-observation-missing',
      'windows-runtime-capability-missing',
      'job-object-tree-containment-missing',
    ],
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'route real graph controller status');
}
