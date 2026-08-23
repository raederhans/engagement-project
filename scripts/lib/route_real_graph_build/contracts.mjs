import {
  boundedText,
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import { parseContractJsonText } from './bounded_json.mjs';
import {
  FROZEN_RELATIVE_PATHS,
  admitWorkspaceRoot,
  assertCanonicalAbsolutePath,
  assertExactWorkspacePath,
  deriveWorkspacePaths,
} from './workspace_paths.mjs';

export const REAL_GRAPH_BUILD_POLICY_SCHEMA = 'route-real-graph-build-policy/v2';
export const REAL_GRAPH_BUILD_CONTROL_SCHEMA = 'route-real-graph-build-control/v2';
export const REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA = 'route-real-graph-supervisor-admission/v2';
export const REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA = 'route-real-graph-acquisition-release/v1';
export const REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA =
  'route-real-graph-observed-payload-receipt/v1';
export const REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA = 'route-real-graph-extraction-release/v1';
export const REAL_GRAPH_BOUNDARY_CANDIDATE_SCHEMA = 'route-real-graph-boundary-candidate/v2';
export const REAL_GRAPH_INTERMEDIATE_SCHEMA = 'route-real-graph-osmium-opl-intermediate/v1';
export const REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA = 'route-real-graph-osmium-opl-adapter/v1';
export const REAL_GRAPH_OWNER_LEASE_SCHEMA = 'route-real-graph-owner-lease/v1';

export const BUILD_POLICY_ID = 'philadelphia-pa-260813-osmium-opl-core-only/v2';
export const BOUNDARY_POLICY_ID = 'philadelphia-city-limits-1000m-core-only/v1';
export const EXTRACTOR_TOOL_ID = 'osmium-tool/1.19.1/win-64/conda-forge-h60971b7_0';
export const EXTRACTOR_VERSION = '1.19.1';
export const EXTRACTOR_PACKAGE_FILENAME = 'osmium-tool-1.19.1-h60971b7_0.conda';
export const DATED_SOURCE_URL =
  'https://download.geofabrik.de/north-america/us/pennsylvania-260813.osm.pbf';
export const AUTHORITY_UNAVAILABLE = 'authority-unavailable';
export const CONTROLLER_UNAVAILABLE = 'trusted-controller-unavailable';

// Byte-drift lock for this policy version, not source or reviewer authority.
export const EXPECTED_REAL_GRAPH_BUILD_POLICY_IDENTITY =
  'sha256:7ff943808335ca5e01e4eba2bdd81c4c01037065466b51fd1dae1aa41150e08b';

export const BUILD_AUTHORITY_LIMITATION =
  'Policy, digests, version text, reviewedBy text, release certificates, and caller data do not establish execution authority. Only module-private records plus a separately reviewed trusted controller may consume one exact lease nonce once.';
export const RELEASE_CERTIFICATE_LIMITATION =
  'A validated acquisition or extraction release is a bounded certificate, not an executable capability, command authorization, state transition, or proof that one-shot consumption occurred.';
export const BUILD_CLAIM_LIMITATION =
  'This surface does not prove that a payload was acquired, a real graph was built, admitted, current, complete, safe, accessible, product-ready, published, or deployed.';
export const INTERNAL_DIGEST_LIMITATION =
  'MD5 and SHA-256 values are byte and drift bindings only; they do not establish source authenticity, licence compliance, reviewer identity, or publication authority.';

const LIMITATIONS = Object.freeze([
  BUILD_AUTHORITY_LIMITATION,
  RELEASE_CERTIFICATE_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  INTERNAL_DIGEST_LIMITATION,
]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;

export function parseRealGraphBuildPolicyJson(jsonText) {
  const parsed = parseContractJsonText(jsonText);
  const policy = exactDataObject(parsed, [
    'schema',
    'policyId',
    'dataClassification',
    'researchObservedAt',
    'source',
    'extractor',
    'boundary',
    'intermediate',
    'acquisitionCommandPlan',
    'extractionCommandPlan',
    'paths',
    'licence',
    'network',
    'controller',
    'limitations',
  ], 'real graph build policy');
  if (policy.schema !== REAL_GRAPH_BUILD_POLICY_SCHEMA || policy.policyId !== BUILD_POLICY_ID) {
    fail('build-policy-version', 'real graph build policy schema or id is unsupported');
  }
  if (policy.dataClassification !== 'candidate-private-build-control') {
    fail('build-policy-classification', 'build policy must remain candidate-private build control');
  }
  exactTimestamp(policy.researchObservedAt, 'build policy.researchObservedAt');
  if (canonicalStringify(policy.paths) !== canonicalStringify(FROZEN_RELATIVE_PATHS)) {
    fail('build-policy-path-drift', 'build policy relative paths differ from frozen path slots');
  }
  exactLimitations(policy.limitations);
  const admitted = freezeData(policy, 'real graph build policy');
  if (contentIdentity(admitted) !== EXPECTED_REAL_GRAPH_BUILD_POLICY_IDENTITY) {
    fail('build-policy-content-drift', 'real graph build policy content changed without a version bump');
  }
  return admitted;
}

export function realGraphBuildPolicyIdentity(jsonText) {
  return contentIdentity(parseRealGraphBuildPolicyJson(jsonText));
}

export function parseSupervisorAdmissionJson(jsonText, expectedPolicyIdentity) {
  exactSha256(expectedPolicyIdentity, 'expected policy identity');
  const parsed = parseContractJsonText(jsonText);
  const admission = exactDataObject(parsed, [
    'schema',
    'admissionId',
    'policyIdentity',
    'admittedRevision',
    'workspaceRootAbsolute',
    'sourceManifestIdentity',
    'boundaryBinding',
    'intermediateAdapter',
    'extractorObservation',
    'transportObservation',
    'acceptedAt',
    'evidenceRef',
    'limitations',
  ], 'real graph supervisor admission');
  if (admission.schema !== REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA) {
    fail('supervisor-admission-schema', 'supervisor admission schema is unsupported');
  }
  boundedId(admission.admissionId, 'supervisor admission.admissionId');
  exactSha256(admission.policyIdentity, 'supervisor admission.policyIdentity');
  if (admission.policyIdentity !== expectedPolicyIdentity) {
    fail('supervisor-policy-drift', 'supervisor admission is not bound to the installed policy');
  }
  exactGitSha(admission.admittedRevision, 'supervisor admission.admittedRevision');
  admission.workspaceRootAbsolute = admitWorkspaceRoot(admission.workspaceRootAbsolute);
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  exactSha256(admission.sourceManifestIdentity, 'supervisor admission.sourceManifestIdentity');
  admission.boundaryBinding = admitBoundaryBinding(admission.boundaryBinding, paths);
  admission.intermediateAdapter = admitIntermediateAdapter(admission.intermediateAdapter);
  admission.extractorObservation = admitExtractorObservation(admission.extractorObservation);
  admission.transportObservation = admitTransportObservation(admission.transportObservation);
  const acceptedAt = exactTimestamp(admission.acceptedAt, 'supervisor admission.acceptedAt');
  if (Date.parse(admission.boundaryBinding.buffer.builtAt) < Date.parse(admission.boundaryBinding.core.observedAt)) {
    fail('boundary-clock-order', 'buffer builtAt precedes core observedAt');
  }
  if (
    Date.parse(admission.extractorObservation.observedAt)
    < Date.parse(admission.extractorObservation.packageObservedAt)
  ) {
    fail('extractor-clock-order', 'extractor binary observedAt precedes package observedAt');
  }
  for (const observedAt of [
    admission.boundaryBinding.core.observedAt,
    admission.boundaryBinding.buffer.builtAt,
    admission.intermediateAdapter.acceptedAt,
    admission.extractorObservation.packageObservedAt,
    admission.extractorObservation.observedAt,
    admission.transportObservation.observedAt,
  ]) {
    if (Date.parse(observedAt) > Date.parse(acceptedAt)) {
      fail('supervisor-admission-clock-order', 'supervisor admission predates a bound observation');
    }
  }
  boundedText(admission.evidenceRef, 'supervisor admission.evidenceRef', { max: 500 });
  admission.limitations = exactLimitations(admission.limitations);
  return freezeData(admission, 'real graph supervisor admission');
}

export function supervisorAdmissionIdentity(jsonText, expectedPolicyIdentity) {
  return contentIdentity(parseSupervisorAdmissionJson(jsonText, expectedPolicyIdentity));
}

export function parseAcquisitionReleaseJson(
  releaseJsonText,
  admissionJsonText,
  expectedPolicyIdentity,
) {
  const admission = parseSupervisorAdmissionJson(admissionJsonText, expectedPolicyIdentity);
  const parsed = parseContractJsonText(releaseJsonText);
  const release = exactDataObject(parsed, [
    'schema',
    'releaseId',
    'admissionIdentity',
    'datedUrl',
    'transportObservationIdentity',
    'workspaceRootAbsolute',
    'paths',
    'ownerLease',
    'trustedController',
    'oneShotConsumption',
    'preflight',
    'retryAllowed',
    'fallbackAllowed',
    'limitations',
  ], 'real graph acquisition release');
  if (release.schema !== REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA) {
    fail('acquisition-release-schema', 'acquisition release schema is unsupported');
  }
  boundedId(release.releaseId, 'acquisition release.releaseId');
  const expectedAdmissionIdentity = contentIdentity(admission);
  if (release.admissionIdentity !== expectedAdmissionIdentity) {
    fail('acquisition-admission-drift', 'acquisition release is not bound to the exact admission');
  }
  if (release.datedUrl !== DATED_SOURCE_URL) {
    fail('acquisition-source-drift', 'acquisition release URL is not the exact dated source');
  }
  if (release.transportObservationIdentity !== contentIdentity(admission.transportObservation)) {
    fail('acquisition-transport-drift', 'acquisition release transport identity drifted');
  }
  if (release.workspaceRootAbsolute !== admission.workspaceRootAbsolute) {
    fail('acquisition-workspace-drift', 'acquisition workspace root differs from admission');
  }
  const paths = deriveWorkspacePaths(release.workspaceRootAbsolute);
  release.paths = admitAcquisitionPaths(release.paths, paths);
  release.ownerLease = admitOwnerLease(release.ownerLease, 'acquisition release.ownerLease');
  if (Date.parse(release.ownerLease.issuedAt) < Date.parse(admission.acceptedAt)) {
    fail('acquisition-release-order', 'acquisition release lease predates supervisor admission');
  }
  release.trustedController = admitTrustedController(
    release.trustedController,
    release.ownerLease,
    'acquisition release.trustedController',
  );
  release.oneShotConsumption = admitUnconsumedOneShot(
    release.oneShotConsumption,
    'acquisition release.oneShotConsumption',
    'acquisition-release-replayed',
  );
  release.preflight = admitUnobservedPreflight(release.preflight, 'acquisition release.preflight');
  exactFalse(release.retryAllowed, 'acquisition release.retryAllowed');
  exactFalse(release.fallbackAllowed, 'acquisition release.fallbackAllowed');
  release.limitations = exactLimitations(release.limitations);
  return freezeData(release, 'real graph acquisition release');
}

export function acquisitionReleaseIdentity(
  releaseJsonText,
  admissionJsonText,
  expectedPolicyIdentity,
) {
  return contentIdentity(parseAcquisitionReleaseJson(
    releaseJsonText,
    admissionJsonText,
    expectedPolicyIdentity,
  ));
}

export function parseObservedPayloadReceiptJson(
  receiptJsonText,
  acquisitionReleaseJsonText,
  admissionJsonText,
  expectedPolicyIdentity,
) {
  const admission = parseSupervisorAdmissionJson(admissionJsonText, expectedPolicyIdentity);
  const release = parseAcquisitionReleaseJson(
    acquisitionReleaseJsonText,
    admissionJsonText,
    expectedPolicyIdentity,
  );
  const parsed = parseContractJsonText(receiptJsonText);
  const receipt = exactDataObject(parsed, [
    'schema',
    'receiptId',
    'acquisitionReleaseIdentity',
    'admissionIdentity',
    'ownerLeaseIdentity',
    'ownerNonce',
    'trustedControllerIdentity',
    'controllerObservedAt',
    'consumptionOrdinal',
    'consumedAt',
    'sourcePayload',
    'partialRemoved',
    'retryUsed',
    'fallbackUsed',
    'limitations',
  ], 'observed payload receipt');
  if (receipt.schema !== REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA) {
    fail('payload-receipt-schema', 'observed payload receipt schema is unsupported');
  }
  boundedId(receipt.receiptId, 'observed payload receipt.receiptId');
  if (receipt.acquisitionReleaseIdentity !== contentIdentity(release)) {
    fail('payload-receipt-release-drift', 'payload receipt is not bound to the acquisition release');
  }
  if (receipt.admissionIdentity !== contentIdentity(admission)) {
    fail('payload-receipt-admission-drift', 'payload receipt admission identity drifted');
  }
  if (
    receipt.ownerLeaseIdentity !== release.ownerLease.leaseIdentity
    || receipt.ownerNonce !== release.ownerLease.nonce
  ) {
    fail('payload-receipt-lease-drift', 'payload receipt owner lease or nonce drifted');
  }
  if (
    receipt.trustedControllerIdentity !== release.trustedController.identity
    || receipt.controllerObservedAt !== release.trustedController.observedAt
  ) {
    fail('payload-receipt-controller-drift', 'payload receipt controller observation drifted');
  }
  if (receipt.consumptionOrdinal !== 1) {
    fail('payload-receipt-replay', 'payload receipt must record the first and only lease consumption');
  }
  const consumedAt = exactTimestamp(receipt.consumedAt, 'observed payload receipt.consumedAt');
  assertClockOrder(
    release.trustedController.observedAt,
    consumedAt,
    release.ownerLease.deadlineAt,
    'payload receipt consumption',
  );
  receipt.sourcePayload = admitObservedPayload(
    receipt.sourcePayload,
    release,
    consumedAt,
  );
  exactTrue(receipt.partialRemoved, 'observed payload receipt.partialRemoved');
  exactFalse(receipt.retryUsed, 'observed payload receipt.retryUsed');
  exactFalse(receipt.fallbackUsed, 'observed payload receipt.fallbackUsed');
  receipt.limitations = exactLimitations(receipt.limitations);
  return freezeData(receipt, 'observed payload receipt');
}

export function observedPayloadReceiptIdentity(
  receiptJsonText,
  acquisitionReleaseJsonText,
  admissionJsonText,
  expectedPolicyIdentity,
) {
  return contentIdentity(parseObservedPayloadReceiptJson(
    receiptJsonText,
    acquisitionReleaseJsonText,
    admissionJsonText,
    expectedPolicyIdentity,
  ));
}

export function parseExtractionReleaseJson(
  extractionReleaseJsonText,
  receiptJsonText,
  acquisitionReleaseJsonText,
  admissionJsonText,
  expectedPolicyIdentity,
) {
  const admission = parseSupervisorAdmissionJson(admissionJsonText, expectedPolicyIdentity);
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionReleaseJsonText,
    admissionJsonText,
    expectedPolicyIdentity,
  );
  const receipt = parseObservedPayloadReceiptJson(
    receiptJsonText,
    acquisitionReleaseJsonText,
    admissionJsonText,
    expectedPolicyIdentity,
  );
  const parsed = parseContractJsonText(extractionReleaseJsonText);
  const release = exactDataObject(parsed, [
    'schema',
    'releaseId',
    'admissionIdentity',
    'observedPayloadReceiptIdentity',
    'extractorObservationIdentity',
    'boundaryBinding',
    'intermediateAdapterIdentity',
    'workspaceRootAbsolute',
    'paths',
    'ownerLease',
    'trustedController',
    'oneShotConsumption',
    'preflight',
    'retryAllowed',
    'fallbackAllowed',
    'limitations',
  ], 'real graph extraction release');
  if (release.schema !== REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA) {
    fail('extraction-release-schema', 'extraction release schema is unsupported');
  }
  boundedId(release.releaseId, 'extraction release.releaseId');
  if (release.admissionIdentity !== contentIdentity(admission)) {
    fail('extraction-admission-drift', 'extraction release admission identity drifted');
  }
  if (release.observedPayloadReceiptIdentity !== contentIdentity(receipt)) {
    fail('extraction-receipt-drift', 'extraction release requires the exact observed payload receipt');
  }
  if (release.extractorObservationIdentity !== contentIdentity(admission.extractorObservation)) {
    fail('extraction-tool-drift', 'extraction release osmium observation identity drifted');
  }
  const derived = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  release.boundaryBinding = admitBoundaryBinding(release.boundaryBinding, derived);
  if (canonicalStringify(release.boundaryBinding) !== canonicalStringify(admission.boundaryBinding)) {
    fail('extraction-boundary-drift', 'extraction release core or buffer byte binding drifted');
  }
  if (release.intermediateAdapterIdentity !== contentIdentity(admission.intermediateAdapter)) {
    fail('extraction-adapter-drift', 'extraction release RD-B adapter identity drifted');
  }
  if (
    release.workspaceRootAbsolute !== admission.workspaceRootAbsolute
    || release.workspaceRootAbsolute !== acquisition.workspaceRootAbsolute
  ) {
    fail('extraction-workspace-drift', 'extraction workspace root differs from prior records');
  }
  release.paths = admitExtractionPaths(release.paths, derived);
  if (release.paths.sourcePbfAbsolute !== receipt.sourcePayload.absolutePath) {
    fail('extraction-source-path-drift', 'extraction source path differs from the observed receipt');
  }
  release.ownerLease = admitOwnerLease(release.ownerLease, 'extraction release.ownerLease');
  if (Date.parse(release.ownerLease.issuedAt) < Date.parse(receipt.sourcePayload.observedAt)) {
    fail('extraction-release-order', 'extraction release lease predates observed payload receipt');
  }
  release.trustedController = admitTrustedController(
    release.trustedController,
    release.ownerLease,
    'extraction release.trustedController',
  );
  release.oneShotConsumption = admitUnconsumedOneShot(
    release.oneShotConsumption,
    'extraction release.oneShotConsumption',
    'extraction-release-replayed',
  );
  release.preflight = admitUnobservedPreflight(release.preflight, 'extraction release.preflight');
  exactFalse(release.retryAllowed, 'extraction release.retryAllowed');
  exactFalse(release.fallbackAllowed, 'extraction release.fallbackAllowed');
  release.limitations = exactLimitations(release.limitations);
  return freezeData(release, 'real graph extraction release');
}

function admitBoundaryBinding(value, paths) {
  const binding = exactDataObject(value, [
    'policyId',
    'core',
    'buffer',
    'builderIdentity',
  ], 'boundary binding');
  if (binding.policyId !== BOUNDARY_POLICY_ID) {
    fail('boundary-binding-policy', 'boundary binding policy id drifted');
  }
  binding.core = admitBoundFile(
    binding.core,
    paths.artifacts.coreBoundary,
    'observedAt',
    'boundary binding.core',
  );
  binding.buffer = admitBoundFile(
    binding.buffer,
    paths.artifacts.bufferBoundary,
    'builtAt',
    'boundary binding.buffer',
  );
  exactSha256(binding.builderIdentity, 'boundary binding.builderIdentity');
  return binding;
}

function admitIntermediateAdapter(value) {
  const adapter = exactDataObject(value, [
    'schema',
    'identity',
    'admittedRevision',
    'acceptedAt',
    'status',
  ], 'intermediate adapter');
  if (adapter.schema !== REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA) {
    fail('intermediate-adapter-schema', 'intermediate adapter schema drifted');
  }
  exactSha256(adapter.identity, 'intermediate adapter.identity');
  exactGitSha(adapter.admittedRevision, 'intermediate adapter.admittedRevision');
  exactTimestamp(adapter.acceptedAt, 'intermediate adapter.acceptedAt');
  if (adapter.status !== 'reviewed-admitted') {
    fail('intermediate-adapter-status', 'intermediate adapter must be explicitly reviewed and admitted');
  }
  return adapter;
}

function admitExtractorObservation(value) {
  const observation = exactDataObject(value, [
    'toolId',
    'version',
    'packageChannel',
    'packagePlatform',
    'packageFilename',
    'absolutePackagePath',
    'packageSha256',
    'packageByteCount',
    'packageObservedAt',
    'absoluteBinaryPath',
    'versionArguments',
    'versionOutput',
    'binarySha256',
    'binaryByteCount',
    'observedAt',
  ], 'extractor observation');
  if (observation.toolId !== EXTRACTOR_TOOL_ID || observation.version !== EXTRACTOR_VERSION) {
    fail('extractor-observation-identity', 'extractor observation identity drifted');
  }
  if (
    observation.packageChannel !== 'conda-forge'
    || observation.packagePlatform !== 'win-64'
    || observation.packageFilename !== EXTRACTOR_PACKAGE_FILENAME
  ) {
    fail('extractor-observation-package', 'extractor package build drifted');
  }
  assertCanonicalAbsolutePath(observation.absolutePackagePath, 'extractor package path');
  exactSha256(observation.packageSha256, 'extractor package SHA-256');
  exactByteCount(observation.packageByteCount, 'extractor package byte count');
  exactTimestamp(observation.packageObservedAt, 'extractor package observedAt');
  assertCanonicalAbsolutePath(observation.absoluteBinaryPath, 'extractor binary path');
  exactVersionArguments(observation.versionArguments, 'extractor observation.versionArguments');
  boundedText(observation.versionOutput, 'extractor observation.versionOutput', { max: 500 });
  exactSha256(observation.binarySha256, 'extractor binary SHA-256');
  exactByteCount(observation.binaryByteCount, 'extractor binary byte count');
  exactTimestamp(observation.observedAt, 'extractor binary observedAt');
  return observation;
}

function admitTransportObservation(value) {
  const observation = exactDataObject(value, [
    'toolId',
    'version',
    'absoluteBinaryPath',
    'versionArguments',
    'versionOutput',
    'binarySha256',
    'binaryByteCount',
    'observedAt',
  ], 'transport observation');
  const version = boundedText(observation.version, 'transport observation.version', {
    max: 40,
    pattern: /^\d+(?:\.\d+){1,3}$/,
  });
  if (observation.toolId !== `curl/${version}/supervisor-observed`) {
    fail('transport-observation-identity', 'transport observation must identify exact curl version');
  }
  assertCanonicalAbsolutePath(observation.absoluteBinaryPath, 'transport binary path');
  exactVersionArguments(observation.versionArguments, 'transport observation.versionArguments');
  boundedText(observation.versionOutput, 'transport observation.versionOutput', { max: 500 });
  exactSha256(observation.binarySha256, 'transport binary SHA-256');
  exactByteCount(observation.binaryByteCount, 'transport binary byte count');
  exactTimestamp(observation.observedAt, 'transport binary observedAt');
  return observation;
}

function admitAcquisitionPaths(value, derived) {
  const paths = exactDataObject(value, [
    'workingDirectoryAbsolute',
    'outputDirectoryAbsolute',
    'logPathAbsolute',
    'sourcePartialPathAbsolute',
    'sourceFinalPathAbsolute',
  ], 'acquisition release.paths');
  assertExactWorkspacePath(paths.workingDirectoryAbsolute, derived.workingDirectoryAbsolute, 'acquisition working directory');
  assertExactWorkspacePath(paths.outputDirectoryAbsolute, derived.outputDirectoryAbsolute, 'acquisition output directory');
  assertExactWorkspacePath(paths.logPathAbsolute, derived.logPathAbsolute, 'acquisition log path');
  assertExactWorkspacePath(paths.sourcePartialPathAbsolute, derived.artifacts.sourcePartial, 'acquisition partial source path');
  assertExactWorkspacePath(paths.sourceFinalPathAbsolute, derived.artifacts.sourcePbf, 'acquisition final source path');
  return paths;
}

function admitExtractionPaths(value, derived) {
  const expected = {
    workingDirectoryAbsolute: derived.workingDirectoryAbsolute,
    outputDirectoryAbsolute: derived.outputDirectoryAbsolute,
    logPathAbsolute: derived.logPathAbsolute,
    sourcePbfAbsolute: derived.artifacts.sourcePbf,
    sourceFileInfoAbsolute: derived.artifacts.sourceFileInfo,
    coreBoundaryAbsolute: derived.artifacts.coreBoundary,
    bufferBoundaryAbsolute: derived.artifacts.bufferBoundary,
    bufferExtractPbfAbsolute: derived.artifacts.bufferExtractPbf,
    walkingFilteredPbfAbsolute: derived.artifacts.walkingFilteredPbf,
    intermediateOplAbsolute: derived.artifacts.intermediateOpl,
    intermediateFileInfoAbsolute: derived.artifacts.intermediateFileInfo,
    buildEvidenceAbsolute: derived.artifacts.buildEvidence,
  };
  const paths = exactDataObject(value, Object.keys(expected), 'extraction release.paths');
  for (const [key, expectedPath] of Object.entries(expected)) {
    assertExactWorkspacePath(paths[key], expectedPath, `extraction path ${key}`);
  }
  return paths;
}

function admitOwnerLease(value, label) {
  const lease = exactDataObject(value, [
    'schema',
    'leaseIdentity',
    'ownerId',
    'nonce',
    'issuedAt',
    'deadlineAt',
  ], label);
  if (lease.schema !== REAL_GRAPH_OWNER_LEASE_SCHEMA) {
    fail('owner-lease-schema', `${label} schema drifted`);
  }
  boundedId(lease.ownerId, `${label}.ownerId`);
  boundedText(lease.nonce, `${label}.nonce`, { max: 32, pattern: NONCE_PATTERN });
  const issuedAt = exactTimestamp(lease.issuedAt, `${label}.issuedAt`);
  const deadlineAt = exactTimestamp(lease.deadlineAt, `${label}.deadlineAt`);
  if (Date.parse(deadlineAt) <= Date.parse(issuedAt)) {
    fail('owner-lease-deadline', `${label} deadline must be after issue time`);
  }
  const expectedIdentity = contentIdentity({
    schema: lease.schema,
    ownerId: lease.ownerId,
    nonce: lease.nonce,
    issuedAt,
    deadlineAt,
  });
  if (lease.leaseIdentity !== expectedIdentity) {
    fail('owner-lease-identity', `${label} identity does not bind owner, nonce, and clocks`);
  }
  return lease;
}

function admitTrustedController(value, lease, label) {
  const controller = exactDataObject(value, ['identity', 'observedAt'], label);
  exactSha256(controller.identity, `${label}.identity`);
  const observedAt = exactTimestamp(controller.observedAt, `${label}.observedAt`);
  if (Date.parse(observedAt) < Date.parse(lease.issuedAt)) {
    fail('controller-observation-order', `${label} observedAt precedes lease issue`);
  }
  if (Date.parse(observedAt) >= Date.parse(lease.deadlineAt)) {
    fail('release-expired', `${label} observedAt is at or after lease deadline`);
  }
  return controller;
}

function admitUnconsumedOneShot(value, label, replayCode) {
  const state = exactDataObject(value, [
    'required',
    'consumptionOrdinal',
    'consumedAt',
  ], label);
  exactTrue(state.required, `${label}.required`);
  if (state.consumptionOrdinal !== 0 || state.consumedAt !== null) {
    fail(replayCode, `${label} certificate is already consumed or replayed`);
  }
  return state;
}

function admitUnobservedPreflight(value, label) {
  const preflight = exactDataObject(value, [
    'status',
    'symlinkAndReparseCheckRequired',
    'preExistingOutputCheckRequired',
    'exactByteRevalidationRequired',
  ], label);
  if (preflight.status !== 'not-observed') {
    fail('preflight-status', `${label} must not claim a controller observation`);
  }
  exactTrue(preflight.symlinkAndReparseCheckRequired, `${label}.symlinkAndReparseCheckRequired`);
  exactTrue(preflight.preExistingOutputCheckRequired, `${label}.preExistingOutputCheckRequired`);
  exactTrue(preflight.exactByteRevalidationRequired, `${label}.exactByteRevalidationRequired`);
  return preflight;
}

function admitObservedPayload(value, release, consumedAt) {
  const payload = exactDataObject(value, [
    'absolutePath',
    'sha256',
    'byteCount',
    'retrievedAt',
    'observedAt',
  ], 'observed payload receipt.sourcePayload');
  assertExactWorkspacePath(
    payload.absolutePath,
    release.paths.sourceFinalPathAbsolute,
    'observed payload final path',
  );
  exactSha256(payload.sha256, 'observed payload SHA-256');
  exactByteCount(payload.byteCount, 'observed payload byte count');
  const retrievedAt = exactTimestamp(payload.retrievedAt, 'observed payload retrievedAt');
  const observedAt = exactTimestamp(payload.observedAt, 'observed payload observedAt');
  assertClockOrder(consumedAt, retrievedAt, release.ownerLease.deadlineAt, 'payload retrieval');
  assertClockOrder(retrievedAt, observedAt, release.ownerLease.deadlineAt, 'payload observation');
  return payload;
}

function admitBoundFile(value, expectedPath, clockKey, label) {
  const file = exactDataObject(value, ['absolutePath', 'sha256', 'byteCount', clockKey], label);
  assertExactWorkspacePath(file.absolutePath, expectedPath, `${label}.absolutePath`);
  exactSha256(file.sha256, `${label}.sha256`);
  exactByteCount(file.byteCount, `${label}.byteCount`);
  exactTimestamp(file[clockKey], `${label}.${clockKey}`);
  return file;
}

function exactLimitations(value) {
  if (!Array.isArray(value) || canonicalStringify(value) !== canonicalStringify(LIMITATIONS)) {
    fail('build-limitations', 'claim limitations must match the exact v2 boundary');
  }
  return [...LIMITATIONS];
}

function exactVersionArguments(value, label) {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== '--version') {
    fail('tool-version-command', `${label} must be exactly [--version]`);
  }
  return ['--version'];
}

function assertClockOrder(earlier, later, deadline, label) {
  if (Date.parse(later) < Date.parse(earlier) || Date.parse(later) >= Date.parse(deadline)) {
    fail('clock-order', `${label} clock order or deadline is invalid`);
  }
}

function exactSha256(value, label) {
  return boundedText(value, label, { max: 71, pattern: SHA256_PATTERN });
}

function exactByteCount(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('invalid-byte-count', `${label} must be a positive safe integer`);
  }
  return value;
}

function exactGitSha(value, label) {
  return boundedText(value, label, { max: 40, pattern: GIT_SHA_PATTERN });
}

function boundedId(value, label) {
  return boundedText(value, label, { max: 160, pattern: SAFE_ID_PATTERN });
}

function exactFalse(value, label) {
  if (value !== false) fail('boolean-false-required', `${label} must be false`);
  return false;
}

function exactTrue(value, label) {
  if (value !== true) fail('boolean-true-required', `${label} must be true`);
  return true;
}
