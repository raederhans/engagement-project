import { fail, freezeData } from '../route_graph_candidate/safe_data.mjs';
import {
  AUTHORITY_UNAVAILABLE,
  BUILD_AUTHORITY_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  CONTROLLER_UNAVAILABLE,
  INTERNAL_DIGEST_LIMITATION,
  REAL_GRAPH_BUILD_CONTROL_SCHEMA,
  RELEASE_CERTIFICATE_LIMITATION,
  acquisitionReleaseIdentity,
  observedPayloadReceiptIdentity,
  parseAcquisitionReleaseJson,
  parseExtractionReleaseJson,
  parseObservedPayloadReceiptJson,
  parseRealGraphBuildPolicyJson,
  parseSupervisorAdmissionJson,
  supervisorAdmissionIdentity,
} from './contracts.mjs';
import {
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
} from './policy.mjs';
import {
  readInstalledAcquisitionReleaseJsonText,
  readInstalledExtractionReleaseJsonText,
  readInstalledObservedPayloadReceiptJsonText,
  readInstalledSupervisorAdmissionJsonText,
} from './private_registry.mjs';

const ROUTE_REAL_GRAPH_BUILD_POLICY = parseRealGraphBuildPolicyJson(
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
);

export function inspectRouteRealGraphBuildControl() {
  if (arguments.length !== 0) {
    fail('caller-authority-forbidden', 'build control accepts no caller-supplied records or authority');
  }

  const admissionText = readInstalledSupervisorAdmissionJsonText();
  const acquisitionText = readInstalledAcquisitionReleaseJsonText();
  const receiptText = readInstalledObservedPayloadReceiptJsonText();
  const extractionText = readInstalledExtractionReleaseJsonText();
  let admission = null;
  let acquisition = null;
  let receipt = null;
  let extraction = null;
  const reasonCodes = [];

  if (admissionText === null) {
    reasonCodes.push(
      'supervisor-admission-missing',
      'extractor-binary-unavailable',
      'download-transport-unavailable',
      'core-boundary-unavailable',
      'buffer-boundary-unavailable',
      'rd-b-exact-adapter-unavailable',
    );
  } else {
    admission = parseSupervisorAdmissionJson(admissionText, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY);
  }

  if (acquisitionText === null) {
    reasonCodes.push('acquisition-release-missing');
  } else if (admission === null) {
    reasonCodes.push('acquisition-release-without-admission');
  } else {
    acquisition = parseAcquisitionReleaseJson(
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    );
  }

  if (receiptText === null) {
    reasonCodes.push('observed-payload-receipt-missing', 'source-payload-unavailable');
  } else if (acquisition === null) {
    reasonCodes.push('payload-receipt-without-acquisition-release');
  } else {
    receipt = parseObservedPayloadReceiptJson(
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    );
  }

  if (extractionText === null) {
    reasonCodes.push('extraction-release-missing');
  } else if (receipt === null) {
    reasonCodes.push('extraction-release-without-observed-receipt');
  } else {
    extraction = parseExtractionReleaseJson(
      extractionText,
      receiptText,
      acquisitionText,
      admissionText,
      ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    );
  }

  reasonCodes.push(
    'trusted-controller-unavailable',
    'opl-to-rd-b-bridge-unavailable',
    'trusted-build-evidence-unavailable',
  );
  const certificateChainValidated = [admission, acquisition, receipt, extraction]
    .every((value) => value !== null);

  return freezeData({
    schema: REAL_GRAPH_BUILD_CONTROL_SCHEMA,
    policyId: ROUTE_REAL_GRAPH_BUILD_POLICY.policyId,
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    status: certificateChainValidated ? CONTROLLER_UNAVAILABLE : AUTHORITY_UNAVAILABLE,
    authorityVerified: false,
    certificateChainValidated,
    supervisorAdmissionValidated: admission !== null,
    supervisorAdmissionIdentity: admission === null
      ? null
      : supervisorAdmissionIdentity(admissionText, ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY),
    acquisitionReleaseValidated: acquisition !== null,
    acquisitionReleaseIdentity: acquisition === null
      ? null
      : acquisitionReleaseIdentity(
        acquisitionText,
        admissionText,
        ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
      ),
    observedPayloadReceiptValidated: receipt !== null,
    observedPayloadReceiptIdentity: receipt === null
      ? null
      : observedPayloadReceiptIdentity(
        receiptText,
        acquisitionText,
        admissionText,
        ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
      ),
    extractionReleaseValidated: extraction !== null,
    releaseCertificatesExecutable: false,
    trustedControllerImplemented: false,
    oneShotConsumptionCapabilityImplemented: false,
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
    source: ROUTE_REAL_GRAPH_BUILD_POLICY.source,
    extractor: ROUTE_REAL_GRAPH_BUILD_POLICY.extractor,
    boundary: ROUTE_REAL_GRAPH_BUILD_POLICY.boundary,
    intermediate: ROUTE_REAL_GRAPH_BUILD_POLICY.intermediate,
    acquisitionCommandPlan: ROUTE_REAL_GRAPH_BUILD_POLICY.acquisitionCommandPlan,
    extractionCommandPlan: ROUTE_REAL_GRAPH_BUILD_POLICY.extractionCommandPlan,
    relativePaths: ROUTE_REAL_GRAPH_BUILD_POLICY.paths,
    controller: ROUTE_REAL_GRAPH_BUILD_POLICY.controller,
    reasonCodes,
    limitations: [
      BUILD_AUTHORITY_LIMITATION,
      RELEASE_CERTIFICATE_LIMITATION,
      BUILD_CLAIM_LIMITATION,
      INTERNAL_DIGEST_LIMITATION,
    ],
  }, 'route real graph build control');
}
