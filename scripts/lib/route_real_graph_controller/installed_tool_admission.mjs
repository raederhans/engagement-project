import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  INSTALLED_TOOL_CLAIM_INSPECTION_SCHEMA,
} from './contracts.mjs';
import {
  downloadTransportObservationClaimIdentity,
  installedToolObservationClaimIdentity,
  parseDownloadTransportObservationClaim,
  parseInstalledToolObservationClaim,
} from './tool_contracts.mjs';
import {
  readInstalledCurlObservationJsonText,
  readInstalledToolObservationJsonText,
} from './private_registry.mjs';

export function inspectInstalledToolAdmission() {
  if (arguments.length !== 0) {
    fail('caller-tool-authority-forbidden', 'installed-tool admission accepts no caller records');
  }
  const installed = readInstalledToolObservationJsonText();
  const curl = readInstalledCurlObservationJsonText();
  return freezeData({
    schema: INSTALLED_TOOL_CLAIM_INSPECTION_SCHEMA,
    status: installed === null ? 'tool-admission-unavailable' : 'installed-record-not-admitted',
    registryState: installed === null ? 'empty' : 'unreviewed-record',
    installedOsmiumObservationPresent: installed !== null,
    installedCurlObservationPresent: curl !== null,
    installedToolAdmitted: false,
    observationIdentity: null,
    bytesDirectlyObserved: false,
    versionProcessDirectlyObserved: false,
    packageToBinaryProvenanceVerified: false,
    commandAuthorization: false,
    commandsRunnable: false,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
    reasonCodes: [
      'module-private-installed-tool-observation-missing',
      'module-private-installed-curl-observation-missing',
      'controller-direct-byte-observation-missing',
      'controller-direct-version-observation-missing',
      'package-to-installed-binary-provenance-missing',
    ],
  }, 'RD-G installed-tool admission status');
}

export function inspectCallerInstalledToolObservationClaim(jsonText) {
  if (typeof jsonText !== 'string') {
    fail('json-text-required', 'installed-tool claim inspection requires primitive JSON text');
  }
  if (arguments.length !== 1) {
    fail('installed-tool-claim-arguments', 'installed-tool claim inspection accepts one JSON text argument');
  }
  const claim = parseInstalledToolObservationClaim(jsonText);
  return freezeData({
    schema: INSTALLED_TOOL_CLAIM_INSPECTION_SCHEMA,
    status: 'caller-claim-only-not-trusted',
    claimShapeValidated: true,
    claimIdentity: installedToolObservationClaimIdentity(jsonText),
    embeddedCapturesRecomputed: true,
    bindingIdentitiesRecomputed: true,
    installedToolObservationPresent: false,
    installedToolAdmitted: false,
    controllerDirectObservation: false,
    commandAuthorization: false,
    commandsRunnable: false,
    actualExtraction: false,
    sourceHealthCurrent: false,
    runtimeAuthorized: false,
    publicationAuthorized: false,
    claimId: claim.claimId,
    toolId: claim.toolId,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'caller installed-tool observation claim inspection');
}

export function inspectCallerDownloadTransportObservationClaim(jsonText) {
  if (typeof jsonText !== 'string') {
    fail('json-text-required', 'download transport claim inspection requires primitive JSON text');
  }
  if (arguments.length !== 1) {
    fail('download-transport-claim-arguments', 'download transport claim inspection accepts one JSON text argument');
  }
  const claim = parseDownloadTransportObservationClaim(jsonText);
  return freezeData({
    schema: INSTALLED_TOOL_CLAIM_INSPECTION_SCHEMA,
    status: 'caller-claim-only-not-trusted',
    claimShapeValidated: true,
    claimIdentity: downloadTransportObservationClaimIdentity(jsonText),
    bindingIdentitiesRecomputed: true,
    installedToolAdmitted: false,
    controllerDirectObservation: false,
    commandAuthorization: false,
    commandsRunnable: false,
    actualAcquisition: false,
    sourceHealthCurrent: false,
    runtimeAuthorized: false,
    publicationAuthorized: false,
    claimId: claim.claimId,
    toolId: claim.toolId,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'caller download transport observation claim inspection');
}
