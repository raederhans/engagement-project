import { Buffer } from 'node:buffer';

import { admitGeofabrikAcquisitionManifest } from '../route_real_graph_acquisition/index.mjs';
import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  parseAcquisitionReleaseJson,
  parseExtractionReleaseJson,
  parseObservedPayloadReceiptJson,
  parseSupervisorAdmissionJson,
} from '../route_real_graph_build/contracts.mjs';
import { ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY } from '../route_real_graph_build/policy.mjs';
import {
  inspectCallerTrustedBuildEvidenceClaim,
} from '../route_real_graph_bridge/index.mjs';
import { parseBridgeContractJsonText } from '../route_real_graph_bridge/primitive_ingress.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_EVIDENCE_BINDING_SCHEMA,
  CONTROLLER_LIMITATIONS,
  CONTROLLER_PHASE_BINDING_SCHEMA,
} from './contracts.mjs';
import {
  parseDownloadTransportObservationClaim,
  parseInstalledToolObservationClaim,
} from './tool_contracts.mjs';

const FALSE_BOUNDARY = freezeData({
  capability: null,
  successEvidence: false,
  commandAuthorization: false,
  commandsRunnable: false,
  actual: false,
  current: false,
  runtime: false,
  product: false,
  publication: false,
}, 'RD-G non-capability evidence boundary');

export function buildValidationOnlyAcquisitionPhaseBinding(
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  ], 3, 'controller-acquisition-binding-arguments');
  const { manifest, admission, acquisition } = parseAcquisitionDocumentChain(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  const documentIdentities = freezeData({
    sourceManifestIdentity: manifest.manifestIdentity,
    supervisorAdmissionIdentity: contentIdentity(admission),
    acquisitionReleaseIdentity: contentIdentity(acquisition),
  }, 'RD-G exact acquisition document identities');
  const preAcquisitionIdentity = contentIdentity({
    ...documentIdentities,
    transportObservationIdentity: contentIdentity(admission.transportObservation),
    acquisitionLeaseIdentity: acquisition.ownerLease.leaseIdentity,
  });
  const base = freezeData({
    schema: CONTROLLER_PHASE_BINDING_SCHEMA,
    phase: 'acquisition',
    dataClassification: 'caller-claim-validation-only-acquisition-pre-run-closure',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    controllerIdentity: acquisition.trustedController.identity,
    documentIdentities,
    transportObservationIdentity: contentIdentity(admission.transportObservation),
    transportObservation: admission.transportObservation,
    release: projectRelease(acquisition),
    preAcquisitionIdentity,
    ...FALSE_BOUNDARY,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'RD-G acquisition phase binding without self identity');
  return freezeData({
    ...base,
    phaseBindingIdentity: contentIdentity(base),
  }, 'RD-G canonical acquisition phase binding');
}

export function parseControllerAcquisitionPhaseBindingJsonText(
  phaseBindingJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 4, 'controller-acquisition-binding-json-arguments');
  const parsed = exactDataObject(parseBridgeContractJsonText(
    phaseBindingJsonText,
    'RD-G acquisition phase binding JSON',
  ), [
    'schema', 'phase', 'dataClassification', 'policyIdentity',
    'workspaceRootAbsolute', 'controllerIdentity', 'documentIdentities',
    'transportObservationIdentity', 'transportObservation', 'release',
    'preAcquisitionIdentity', 'capability', 'successEvidence',
    'commandAuthorization', 'commandsRunnable', 'actual', 'current', 'runtime',
    'product', 'publication', 'claims', 'limitations', 'phaseBindingIdentity',
  ], 'RD-G acquisition phase binding');
  const expected = buildValidationOnlyAcquisitionPhaseBinding(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  assertCanonicalMatch(parsed, expected, 'controller-acquisition-binding-drift',
    'acquisition binding differs from exact RD-A/RD-E recomputation');
  return expected;
}

export function controllerAcquisitionPhaseBindingIdentity(...values) {
  requirePrimitiveTexts(values, values, 4, 'controller-acquisition-binding-identity-arguments');
  return contentIdentity(parseControllerAcquisitionPhaseBindingJsonText(...values));
}

export function buildValidationOnlyExtractionPhaseBinding(
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  ], 5, 'controller-phase-binding-arguments');
  const chain = parseFiveDocumentChain(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  const { manifest, admission, acquisition, receipt, extraction } = chain;
  if (acquisition.trustedController.identity !== extraction.trustedController.identity) {
    fail('controller-evidence-controller-drift', 'acquisition and extraction must use one exact trusted-controller identity');
  }
  const documentIdentities = freezeData({
    sourceManifestIdentity: manifest.manifestIdentity,
    supervisorAdmissionIdentity: contentIdentity(admission),
    acquisitionReleaseIdentity: contentIdentity(acquisition),
    observedPayloadReceiptIdentity: contentIdentity(receipt),
    extractionReleaseIdentity: contentIdentity(extraction),
  }, 'RD-G exact five-document identities');
  const sourcePayload = freezeData({ ...receipt.sourcePayload }, 'RD-G exact acquired payload projection');
  const acquisitionPhaseBinding = buildValidationOnlyAcquisitionPhaseBinding(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  const preAcquisitionIdentity = acquisitionPhaseBinding.preAcquisitionIdentity;
  const acquisitionResultIdentity = contentIdentity({
    preAcquisitionIdentity,
    observedPayloadReceiptIdentity: documentIdentities.observedPayloadReceiptIdentity,
    sourcePayload,
  });
  const extractionInputRequirement = freezeData({
    acquisitionResultIdentity,
    observedPayloadReceiptIdentity: documentIdentities.observedPayloadReceiptIdentity,
    extractionReleaseIdentity: documentIdentities.extractionReleaseIdentity,
    absolutePath: sourcePayload.absolutePath,
    sha256: sourcePayload.sha256,
    byteCount: sourcePayload.byteCount,
    closedFileObservationRequired: true,
    completeByteTraversalRequired: true,
    reparsePointRequired: false,
    independentObservationRequiredAfterLeaseConsumption: true,
  }, 'RD-G extraction input observation requirement');
  const extractionInputRequirementIdentity = contentIdentity(extractionInputRequirement);
  const base = freezeData({
    schema: CONTROLLER_PHASE_BINDING_SCHEMA,
    phase: 'extraction',
    dataClassification: 'caller-claim-validation-only-extraction-pre-run-closure',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    controllerIdentity: acquisition.trustedController.identity,
    acquisitionPhaseBindingIdentity: acquisitionPhaseBinding.phaseBindingIdentity,
    documentIdentities,
    installedObservations: projectInstalledObservations(admission),
    releases: {
      acquisition: projectRelease(acquisition),
      extraction: projectRelease(extraction),
    },
    sourcePayload,
    preAcquisitionIdentity,
    acquisitionResultIdentity,
    extractionInputRequirement,
    extractionInputRequirementIdentity,
    ...FALSE_BOUNDARY,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'RD-G controller phase binding without self identity');
  return freezeData({
    ...base,
    phaseBindingIdentity: contentIdentity(base),
  }, 'RD-G canonical controller phase binding');
}

export function parseControllerExtractionPhaseBindingJsonText(
  phaseBindingJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [
    phaseBindingJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  ], 6, 'controller-extraction-binding-json-arguments');
  const parsed = exactDataObject(parseBridgeContractJsonText(
    phaseBindingJsonText,
    'RD-G controller phase binding JSON',
  ), [
    'schema', 'phase', 'dataClassification', 'policyIdentity', 'workspaceRootAbsolute',
    'controllerIdentity', 'acquisitionPhaseBindingIdentity', 'documentIdentities',
    'installedObservations', 'releases',
    'sourcePayload', 'preAcquisitionIdentity', 'acquisitionResultIdentity',
    'extractionInputRequirement', 'extractionInputRequirementIdentity',
    'capability', 'successEvidence', 'commandAuthorization', 'commandsRunnable',
    'actual', 'current', 'runtime', 'product', 'publication', 'claims',
    'limitations', 'phaseBindingIdentity',
  ], 'RD-G controller phase binding');
  const expected = buildValidationOnlyExtractionPhaseBinding(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  assertCanonicalMatch(parsed, expected, 'controller-extraction-binding-drift',
    'extraction binding differs from exact RD-A/RD-E recomputation');
  return expected;
}

export function controllerExtractionPhaseBindingIdentity(...values) {
  requirePrimitiveTexts(values, values, 6, 'controller-extraction-binding-identity-arguments');
  return contentIdentity(parseControllerExtractionPhaseBindingJsonText(...values));
}

export function buildValidationOnlyControllerEvidenceBinding(
  trustedBuildEvidenceJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  ], 6, 'controller-evidence-arguments');
  const inspection = inspectCallerTrustedBuildEvidenceClaim(
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  assertTrustedInspection(inspection);
  const extractionPhaseBinding = buildValidationOnlyExtractionPhaseBinding(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  const evidence = parseBridgeContractJsonText(
    trustedBuildEvidenceJsonText,
    'RD-G exact TrustedBuildEvidence projection',
  );
  if (
    inspection.sourceManifestIdentity !== extractionPhaseBinding.documentIdentities.sourceManifestIdentity
    || inspection.extractionReleaseIdentity !== extractionPhaseBinding.documentIdentities.extractionReleaseIdentity
    || inspection.evidenceIdentity !== contentIdentity(evidence)
    || inspection.bridgeResultIdentity !== evidence.bridgeResult.bridgeIdentity
  ) fail('controller-evidence-inspection-root-drift', 'RD-F inspection roots differ from the exact six-document projection');
  const evidenceProjection = projectEvidence(evidence);
  const sourcePromotion = evidenceProjection.promotions.find((promotion) => promotion.slot === 'sourcePbf');
  if (!sourcePromotion || (
    sourcePromotion.finalPathAbsolute !== extractionPhaseBinding.sourcePayload.absolutePath
    || sourcePromotion.sha256 !== extractionPhaseBinding.sourcePayload.sha256
    || sourcePromotion.byteCount !== extractionPhaseBinding.sourcePayload.byteCount
  )) fail('controller-source-promotion-drift', 'RD-F source promotion differs from the exact RD-E acquired payload');
  const extractionInput = freezeData({
    requirementIdentity: extractionPhaseBinding.extractionInputRequirementIdentity,
    acquisitionResultIdentity: extractionPhaseBinding.acquisitionResultIdentity,
    sourcePromotionIdentity: sourcePromotion.promotionIdentity,
    absolutePath: extractionPhaseBinding.sourcePayload.absolutePath,
    sha256: extractionPhaseBinding.sourcePayload.sha256,
    byteCount: extractionPhaseBinding.sourcePayload.byteCount,
    mustBeObservedAfter: evidence.leases.extraction.consumedAt,
    mustBeObservedBefore: evidence.execution.steps.find((step) => step.stepId === 'source-fileinfo').startedAt,
    closedFileObservationRequired: true,
    completeByteTraversalRequired: true,
    reparsePointRequired: false,
    observationTrusted: false,
  }, 'RD-G exact extraction input equality and observation requirement');
  const extractionInputIdentity = contentIdentity(extractionInput);
  const finalEvidenceIdentity = contentIdentity({
    acquisitionPhaseBindingIdentity: extractionPhaseBinding.acquisitionPhaseBindingIdentity,
    extractionPhaseBindingIdentity: extractionPhaseBinding.phaseBindingIdentity,
    extractionInputIdentity,
    trustedBuildEvidenceIdentity: inspection.evidenceIdentity,
    executionIdentity: evidenceProjection.executionIdentity,
    outputsIdentity: evidenceProjection.outputsIdentity,
    bridgeResultIdentity: evidenceProjection.bridgeResultIdentity,
  });
  const base = freezeData({
    schema: CONTROLLER_EVIDENCE_BINDING_SCHEMA,
    dataClassification: 'caller-claim-validation-only-six-document-closure',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    workspaceRootAbsolute: extractionPhaseBinding.workspaceRootAbsolute,
    controllerIdentity: extractionPhaseBinding.controllerIdentity,
    acquisitionPhaseBindingIdentity: extractionPhaseBinding.acquisitionPhaseBindingIdentity,
    extractionPhaseBindingIdentity: extractionPhaseBinding.phaseBindingIdentity,
    documentIdentities: {
      ...extractionPhaseBinding.documentIdentities,
      trustedBuildEvidenceIdentity: inspection.evidenceIdentity,
    },
    installedObservations: extractionPhaseBinding.installedObservations,
    phases: {
      acquisition: projectConsumedPhase(extractionPhaseBinding.releases.acquisition, evidence.leases.acquisition),
      extraction: projectConsumedPhase(extractionPhaseBinding.releases.extraction, evidence.leases.extraction),
    },
    sourcePayload: extractionPhaseBinding.sourcePayload,
    preAcquisitionIdentity: extractionPhaseBinding.preAcquisitionIdentity,
    acquisitionResultIdentity: extractionPhaseBinding.acquisitionResultIdentity,
    extractionInput,
    extractionInputIdentity,
    evidence: evidenceProjection,
    finalEvidenceIdentity,
    ...FALSE_BOUNDARY,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'RD-G controller evidence binding without self identity');
  return freezeData({
    ...base,
    bindingIdentity: contentIdentity(base),
  }, 'RD-G canonical controller evidence binding');
}

export function parseControllerEvidenceBindingJsonText(
  bindingJsonText,
  trustedBuildEvidenceJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [
    bindingJsonText,
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  ], 7, 'controller-evidence-binding-json-arguments');
  const parsed = exactDataObject(parseBridgeContractJsonText(
    bindingJsonText,
    'RD-G controller evidence binding JSON',
  ), [
    'schema', 'dataClassification', 'policyIdentity', 'workspaceRootAbsolute',
    'controllerIdentity', 'acquisitionPhaseBindingIdentity',
    'extractionPhaseBindingIdentity', 'documentIdentities',
    'installedObservations', 'phases', 'sourcePayload', 'preAcquisitionIdentity',
    'acquisitionResultIdentity', 'extractionInput', 'extractionInputIdentity',
    'evidence', 'finalEvidenceIdentity', 'capability', 'successEvidence',
    'commandAuthorization', 'commandsRunnable', 'actual', 'current', 'runtime',
    'product', 'publication', 'claims', 'limitations', 'bindingIdentity',
  ], 'RD-G controller evidence binding');
  const expected = buildValidationOnlyControllerEvidenceBinding(
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  assertCanonicalMatch(parsed, expected, 'controller-evidence-binding-drift',
    'controller evidence binding differs from exact RD-A/RD-E/RD-F recomputation');
  return expected;
}

export function controllerEvidenceBindingIdentity(...values) {
  requirePrimitiveTexts(values, values, 7, 'controller-evidence-binding-identity-arguments');
  return contentIdentity(parseControllerEvidenceBindingJsonText(...values));
}

export function assertControllerCurlClaimTextsMatchAcquisitionBinding(
  phaseBindingJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  curlObservationClaimJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 5, 'controller-acquisition-tool-binding-arguments');
  const binding = parseControllerAcquisitionPhaseBindingJsonText(
    phaseBindingJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  compareTransportClaim(binding.transportObservation,
    parseDownloadTransportObservationClaim(curlObservationClaimJsonText));
  return binding;
}

export function assertControllerOsmiumClaimTextsMatchExtractionBinding(
  phaseBindingJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
  osmiumObservationClaimJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 7, 'controller-extraction-tool-binding-arguments');
  const binding = parseControllerExtractionPhaseBindingJsonText(
    phaseBindingJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  compareExtractorClaim(binding.installedObservations.extractorObservation,
    parseInstalledToolObservationClaim(osmiumObservationClaimJsonText));
  return binding;
}

function parseAcquisitionDocumentChain(
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
) {
  const manifest = admitGeofabrikAcquisitionManifest(sourceManifestJsonText);
  const admission = parseSupervisorAdmissionJson(
    supervisorAdmissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionReleaseJsonText,
    supervisorAdmissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  if (admission.sourceManifestIdentity !== manifest.manifestIdentity) {
    fail('controller-phase-manifest-drift', 'supervisor admission differs from the exact source manifest');
  }
  return { manifest, admission, acquisition };
}

function parseFiveDocumentChain(
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  const { manifest, admission, acquisition } = parseAcquisitionDocumentChain(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  const receipt = parseObservedPayloadReceiptJson(
    observedPayloadReceiptJsonText,
    acquisitionReleaseJsonText,
    supervisorAdmissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const extraction = parseExtractionReleaseJson(
    extractionReleaseJsonText,
    observedPayloadReceiptJsonText,
    acquisitionReleaseJsonText,
    supervisorAdmissionJsonText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  return { manifest, admission, acquisition, receipt, extraction };
}

function projectInstalledObservations(admission) {
  return freezeData({
    transportObservationIdentity: contentIdentity(admission.transportObservation),
    transportObservation: admission.transportObservation,
    extractorObservationIdentity: contentIdentity(admission.extractorObservation),
    extractorObservation: admission.extractorObservation,
    boundaryBindingIdentity: contentIdentity(admission.boundaryBinding),
    intermediateAdapterIdentity: contentIdentity(admission.intermediateAdapter),
  }, 'RD-G exact installed observation projection');
}

function projectRelease(release) {
  return freezeData({
    releaseIdentity: contentIdentity(release),
    leaseIdentity: release.ownerLease.leaseIdentity,
    nonce: release.ownerLease.nonce,
    ownerId: release.ownerLease.ownerId,
    issuedAt: release.ownerLease.issuedAt,
    deadlineAt: release.ownerLease.deadlineAt,
    controllerIdentity: release.trustedController.identity,
    controllerObservedAt: release.trustedController.observedAt,
  }, 'RD-G exact controller release projection');
}

function projectConsumedPhase(release, lease) {
  if (
    lease.leaseIdentity !== release.leaseIdentity
    || lease.nonce !== release.nonce
    || lease.trustedControllerIdentity !== release.controllerIdentity
  ) fail('controller-evidence-lease-drift', 'RD-F lease projection differs from the exact RD-E release');
  return freezeData({
    ...release,
    consumptionOrdinal: lease.consumptionOrdinal,
    consumedAt: lease.consumedAt,
  }, 'RD-G exact consumed phase binding');
}

function projectEvidence(evidence) {
  const steps = evidence.execution.steps.map(projectStep);
  const promotions = evidence.execution.promotions.map((promotion) => freezeData({
    ...promotion,
    promotionIdentity: contentIdentity(promotion),
  }, `RD-G evidence promotion ${promotion.slot}`));
  const outputs = projectOutputs(evidence.outputs);
  return freezeData({
    evidenceIdentity: contentIdentity(evidence),
    evidenceObservedAt: evidence.evidenceObservedAt,
    executionIdentity: contentIdentity(evidence.execution),
    preflightIdentity: contentIdentity(evidence.execution.preflight),
    preflight: {
      status: evidence.execution.preflight.status,
      acquisitionObservedAt: evidence.execution.preflight.acquisitionObservedAt,
      extractionObservedAt: evidence.execution.preflight.extractionObservedAt,
      checksIdentity: contentIdentity(evidence.execution.preflight.checks),
    },
    resolvedPaths: evidence.execution.resolvedPaths,
    steps,
    promotions,
    outputsIdentity: contentIdentity(evidence.outputs),
    outputs,
    bridgeResultIdentity: contentIdentity(evidence.bridgeResult),
    bridgeResult: evidence.bridgeResult,
  }, 'RD-G exact RD-F evidence projection');
}

function projectStep(step) {
  return freezeData({
    stepId: step.stepId,
    executableAbsolutePath: step.executableAbsolutePath,
    argv: step.argv,
    cwdAbsolute: step.cwdAbsolute,
    shell: step.shell,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
    exitStatus: step.exitStatus,
    exitCode: step.exitCode,
    signal: step.signal,
    stdout: projectCapture(step.stdout),
    stderr: projectCapture(step.stderr),
    retryOrdinal: step.retryOrdinal,
    fallbackUsed: step.fallbackUsed,
    stepEvidenceIdentity: contentIdentity(step),
  }, `RD-G exact step evidence ${step.stepId}`);
}

function projectOutputs(outputs) {
  return freezeData({
    log: projectCapturedOutput(outputs.log),
    sourceFileInfo: projectCapturedOutput(outputs.sourceFileInfo),
    bufferExtractPbf: projectBoundOutput(outputs.bufferExtractPbf),
    walkingFilteredPbf: projectBoundOutput(outputs.walkingFilteredPbf),
    intermediateFileInfo: projectCapturedOutput(outputs.intermediateFileInfo),
    intermediateOpl: projectCapturedOutput(outputs.intermediateOpl),
    bridgeMetadata: {
      schema: outputs.bridgeMetadata.schema,
      input: outputs.bridgeMetadata.input,
      controllerIdentity: outputs.bridgeMetadata.controllerIdentity,
      leaseIdentity: outputs.bridgeMetadata.leaseIdentity,
      leaseNonce: outputs.bridgeMetadata.leaseNonce,
      observedAt: outputs.bridgeMetadata.observedAt,
      capture: projectCapture(outputs.bridgeMetadata.capture),
      outputIdentity: contentIdentity(outputs.bridgeMetadata),
    },
    buildEvidence: {
      absolutePath: outputs.buildEvidenceFile.absolutePath,
      sha256: outputs.buildEvidenceFile.sha256,
      byteCount: outputs.buildEvidenceFile.byteCount,
      observedAt: outputs.buildEvidenceFile.observedAt,
      outputIdentity: contentIdentity(outputs.buildEvidenceFile),
    },
  }, 'RD-G exact evidence output roots');
}

function projectCapturedOutput(output) {
  return freezeData({
    absolutePath: output.absolutePath,
    observedAt: output.observedAt,
    capture: projectCapture(output.capture),
    outputIdentity: contentIdentity(output),
  }, 'RD-G captured output projection');
}

function projectBoundOutput(output) {
  return freezeData({
    slot: output.slot,
    producerStepId: output.producerStepId,
    partialPathAbsolute: output.partialPathAbsolute,
    finalPathAbsolute: output.finalPathAbsolute,
    observedAt: output.observedAt,
    sha256: output.sha256,
    byteCount: output.byteCount,
    outputIdentity: contentIdentity(output),
  }, `RD-G bound output projection ${output.slot}`);
}

function projectCapture(capture) {
  return freezeData({
    captureIdentity: contentIdentity(capture),
    sha256: capture.sha256,
    byteCount: capture.byteCount,
    truncated: capture.truncated,
  }, 'RD-G exact capture root');
}

function compareTransportClaim(transport, curlClaim) {
  const expectedTransport = {
    toolId: curlClaim.toolId,
    version: curlClaim.version,
    absoluteBinaryPath: curlClaim.binaryAfterVersion.absolutePath,
    versionArguments: ['--version'],
    versionOutput: decodedVersionOutput(curlClaim.versionObservation.stdout),
    binarySha256: curlClaim.binaryAfterVersion.sha256,
    binaryByteCount: curlClaim.binaryAfterVersion.byteCount,
    observedAt: curlClaim.binaryAfterVersion.observedAt,
  };
  if (canonicalStringify(transport) !== canonicalStringify(expectedTransport)) {
    fail('controller-curl-evidence-drift', 'RD-G curl observation differs from the exact RD-E transport observation');
  }
}

function compareExtractorClaim(extractor, osmiumClaim) {
  const expectedExtractor = {
    toolId: osmiumClaim.toolId,
    version: '1.19.1',
    packageChannel: 'conda-forge',
    packagePlatform: 'win-64',
    packageFilename: 'osmium-tool-1.19.1-h60971b7_0.conda',
    absolutePackagePath: osmiumClaim.package.absolutePath,
    packageSha256: osmiumClaim.package.sha256,
    packageByteCount: osmiumClaim.package.byteCount,
    packageObservedAt: osmiumClaim.package.observedAt,
    absoluteBinaryPath: osmiumClaim.binaryAfterVersion.absolutePath,
    versionArguments: ['--version'],
    versionOutput: decodedVersionOutput(osmiumClaim.version.stdout),
    binarySha256: osmiumClaim.binaryAfterVersion.sha256,
    binaryByteCount: osmiumClaim.binaryAfterVersion.byteCount,
    observedAt: osmiumClaim.binaryAfterVersion.observedAt,
  };
  if (canonicalStringify(extractor) !== canonicalStringify(expectedExtractor)) {
    fail('controller-osmium-evidence-drift', 'RD-G osmium observation differs from the exact RD-E extractor observation');
  }
}

function decodedVersionOutput(capture) {
  return Buffer.from(capture.base64, 'base64').toString('utf8').replace(/\r?\n$/u, '');
}

function assertTrustedInspection(inspection) {
  if (
    inspection.status !== 'caller-claim-only-not-trusted'
    || inspection.contractShapeValidated !== true
    || inspection.certificateChainRecomputed !== true
    || inspection.embeddedCaptureDigestsRecomputed !== true
    || inspection.boundOutputObservationClaimsCrossChecked !== true
    || inspection.syntheticBridgeResultRecomputed !== true
    || inspection.capability !== false
    || inspection.successEvidence !== false
  ) fail('controller-evidence-inspection-drift', 'RD-F evidence inspection did not preserve the exact caller-only boundary');
}

function assertCanonicalMatch(actual, expected, code, message) {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) fail(code, message);
}

function requirePrimitiveTexts(args, values, expectedCount, code) {
  if (args.length !== expectedCount || values.some((value) => typeof value !== 'string')) {
    fail(code, `controller binding requires ${expectedCount} primitive text inputs`);
  }
}
