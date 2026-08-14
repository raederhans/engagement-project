import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { admitGeofabrikAcquisitionManifest } from '../route_real_graph_acquisition/index.mjs';
import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import {
  parseAcquisitionReleaseJson,
  parseExtractionReleaseJson,
  parseObservedPayloadReceiptJson,
  parseRealGraphBuildPolicyJson,
  parseSupervisorAdmissionJson,
} from '../route_real_graph_build/contracts.mjs';
import {
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
} from '../route_real_graph_build/policy.mjs';
import {
  OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
  TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA,
  TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA,
  TRUSTED_BUILD_CAPTURE_LIMITS,
  TRUSTED_BUILD_CLAIMS,
  TRUSTED_BUILD_EVIDENCE_CLAIM_INSPECTION_SCHEMA,
  TRUSTED_BUILD_EVIDENCE_SCHEMA,
  TRUSTED_BUILD_EVIDENCE_STATUS_SCHEMA,
  TRUSTED_BUILD_LIMITATIONS,
  TRUSTED_BUILD_PROMOTION_SLOTS,
  TRUSTED_BUILD_STEP_IDS,
} from './contracts.mjs';
import { materializeSyntheticOsmiumOplFixture } from './bridge.mjs';
import { parseBridgeContractJsonText, preflightPrimitiveUtf8Text } from './primitive_ingress.mjs';
import { readInstalledTrustedBuildEvidenceJsonText } from './private_registry.mjs';

const BUILD_POLICY = parseRealGraphBuildPolicyJson(ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

export function inspectTrustedBuildEvidence() {
  if (arguments.length !== 0) {
    fail('caller-evidence-forbidden', 'trusted build evidence inspection accepts no caller record');
  }
  const installed = readInstalledTrustedBuildEvidenceJsonText();
  return freezeData({
    schema: TRUSTED_BUILD_EVIDENCE_STATUS_SCHEMA,
    evidenceSchema: TRUSTED_BUILD_EVIDENCE_SCHEMA,
    status: 'trusted-build-evidence-unavailable',
    registryState: installed === null ? 'empty' : 'installed-observation-not-admitted',
    trustedControllerImplemented: false,
    processObservationInstalled: false,
    oneShotConsumptionCapabilityImplemented: false,
    commandsRunnable: false,
    actualAcquisition: false,
    actualExtraction: false,
    actualIntermediate: false,
    actualRdBResult: false,
    graphArtifactAuthority: false,
    rdCAdmissionAuthority: false,
    rdDRealArtifactAuthority: false,
    sourceHealthCurrent: false,
    runtimeAuthorized: false,
    publicationAuthorized: false,
    reasonCodes: [
      'trusted-controller-unavailable',
      'module-private-trusted-build-observation-missing',
      'one-shot-consumption-observation-unavailable',
      'process-captures-unavailable',
      'real-rd-b-result-unavailable',
    ],
    limitations: TRUSTED_BUILD_LIMITATIONS,
  }, 'TrustedBuildEvidence/v1 unavailable status');
}

export function inspectCallerTrustedBuildEvidenceClaim(
  evidenceJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  if (arguments.length !== 6) {
    fail('evidence-arguments', 'evidence claim inspection requires six primitive JSON text inputs');
  }
  preflightEvidenceArguments([
    ['evidence JSON', evidenceJsonText],
    ['source manifest JSON', sourceManifestJsonText],
    ['supervisor admission JSON', supervisorAdmissionJsonText],
    ['acquisition release JSON', acquisitionReleaseJsonText],
    ['observed payload receipt JSON', observedPayloadReceiptJsonText],
    ['extraction release JSON', extractionReleaseJsonText],
  ]);

  const evidenceValue = parseBridgeContractJsonText(evidenceJsonText, 'TrustedBuildEvidence/v1 JSON');
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
  if (manifest.manifestIdentity !== admission.sourceManifestIdentity) {
    fail('evidence-source-manifest-drift', 'RD-A manifest identity differs from RD-E admission');
  }

  const state = { capturedBytes: 0 };
  const evidence = admitEvidence(
    evidenceValue,
    { manifest, admission, acquisition, receipt, extraction },
    state,
  );
  const evidenceIdentity = contentIdentity(evidence);
  return freezeData({
    schema: TRUSTED_BUILD_EVIDENCE_CLAIM_INSPECTION_SCHEMA,
    evidenceSchema: TRUSTED_BUILD_EVIDENCE_SCHEMA,
    status: 'caller-claim-only-not-trusted',
    contractShapeValidated: true,
    certificateChainRecomputed: true,
    embeddedCaptureDigestsRecomputed: true,
    boundOutputObservationClaimsCrossChecked: true,
    syntheticBridgeResultRecomputed: true,
    resolvedArgvRecomputed: true,
    resolvedPathsRecomputed: true,
    evidenceIdentity,
    policyIdentity: evidence.bindings.policyIdentity,
    sourceManifestIdentity: evidence.bindings.sourceManifestIdentity,
    extractionReleaseIdentity: evidence.bindings.extractionReleaseIdentity,
    bridgeResultIdentity: evidence.bridgeResult.bridgeIdentity,
    trustedBuildEvidence: false,
    processObservationTrusted: false,
    capability: false,
    commandAuthorization: false,
    successEvidence: false,
    graphArtifactAuthority: false,
    rdCAdmissionAuthority: false,
    rdDRealArtifactAuthority: false,
    sourceHealthCurrent: false,
    limitations: TRUSTED_BUILD_LIMITATIONS,
  }, 'caller TrustedBuildEvidence/v1 claim inspection');
}

function preflightEvidenceArguments(entries) {
  for (const [label, value] of entries) {
    preflightPrimitiveUtf8Text(value, label);
  }
}

function admitEvidence(value, chain, state) {
  const evidence = exactDataObject(value, [
    'schema',
    'evidenceId',
    'dataClassification',
    'admittedRevision',
    'evidenceObservedAt',
    'bindings',
    'tool',
    'leases',
    'execution',
    'outputs',
    'bridgeResult',
    'claims',
    'limitations',
  ], 'TrustedBuildEvidence/v1');
  if (evidence.schema !== TRUSTED_BUILD_EVIDENCE_SCHEMA) {
    fail('evidence-schema', 'TrustedBuildEvidence/v1 schema is unsupported');
  }
  boundedId(evidence.evidenceId, 'TrustedBuildEvidence.evidenceId');
  if (evidence.dataClassification !== 'candidate-private-process-observation') {
    fail('evidence-classification', 'TrustedBuildEvidence must remain a private process observation');
  }
  exactGitSha(evidence.admittedRevision, 'TrustedBuildEvidence.admittedRevision');
  if (evidence.admittedRevision !== chain.admission.admittedRevision) {
    fail('evidence-revision-drift', 'evidence revision differs from supervisor admission');
  }
  const evidenceObservedAt = exactTimestamp(
    evidence.evidenceObservedAt,
    'TrustedBuildEvidence.evidenceObservedAt',
  );
  evidence.bindings = admitBindings(evidence.bindings, chain);
  evidence.tool = admitTool(evidence.tool, chain.admission.extractorObservation);
  evidence.leases = admitLeases(evidence.leases, chain);
  evidence.execution = admitExecution(evidence.execution, chain, evidence.leases, state);
  evidence.outputs = admitOutputs(
    evidence.outputs,
    chain,
    evidence.leases,
    evidence.execution,
    state,
  );
  evidence.bridgeResult = admitBridgeResult(evidence.bridgeResult, evidence.outputs);
  validatePromotions(
    evidence.execution.promotions,
    chain,
    evidence.execution,
    evidence.outputs,
  );
  const finalStepEndedAt = evidence.execution.steps.at(-1).endedAt;
  const finalPromotionAt = evidence.execution.promotions.at(-1).promotedAt;
  if (
    Date.parse(evidenceObservedAt) < Date.parse(finalStepEndedAt)
    || Date.parse(evidenceObservedAt) < Date.parse(finalPromotionAt)
    || Date.parse(evidenceObservedAt) >= Date.parse(chain.extraction.ownerLease.deadlineAt)
  ) {
    fail('evidence-clock-order', 'evidence observation must follow all steps within the extraction lease');
  }
  if (canonicalStringify(evidence.claims) !== canonicalStringify(TRUSTED_BUILD_CLAIMS)) {
    fail('evidence-claims', 'TrustedBuildEvidence claims drifted from the exact closed boundary');
  }
  if (canonicalStringify(evidence.limitations) !== canonicalStringify(TRUSTED_BUILD_LIMITATIONS)) {
    fail('evidence-limitations', 'TrustedBuildEvidence limitations drifted');
  }
  evidence.claims = TRUSTED_BUILD_CLAIMS;
  evidence.limitations = [...TRUSTED_BUILD_LIMITATIONS];
  return freezeData(evidence, 'validated caller TrustedBuildEvidence/v1 claim');
}

function admitBindings(value, chain) {
  const bindings = exactDataObject(value, [
    'policyIdentity',
    'sourceManifestIdentity',
    'supervisorAdmissionIdentity',
    'acquisitionReleaseIdentity',
    'observedPayloadReceiptIdentity',
    'extractionReleaseIdentity',
    'extractorObservationIdentity',
    'boundaryBindingIdentity',
    'intermediateAdapterIdentity',
  ], 'TrustedBuildEvidence.bindings');
  const expected = {
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    sourceManifestIdentity: chain.manifest.manifestIdentity,
    supervisorAdmissionIdentity: contentIdentity(chain.admission),
    acquisitionReleaseIdentity: contentIdentity(chain.acquisition),
    observedPayloadReceiptIdentity: contentIdentity(chain.receipt),
    extractionReleaseIdentity: contentIdentity(chain.extraction),
    extractorObservationIdentity: contentIdentity(chain.admission.extractorObservation),
    boundaryBindingIdentity: contentIdentity(chain.admission.boundaryBinding),
    intermediateAdapterIdentity: contentIdentity(chain.admission.intermediateAdapter),
  };
  for (const [key, expectedIdentity] of Object.entries(expected)) {
    exactSha256(bindings[key], `TrustedBuildEvidence.bindings.${key}`);
    if (bindings[key] !== expectedIdentity) {
      fail('evidence-binding-drift', `TrustedBuildEvidence binding ${key} drifted`);
    }
  }
  return bindings;
}

function admitTool(value, observation) {
  const tool = exactDataObject(value, [
    'toolId',
    'version',
    'packageChannel',
    'packagePlatform',
    'packageFilename',
    'packageAbsolutePath',
    'packageSha256',
    'packageByteCount',
    'packageObservedAt',
    'binaryAbsolutePath',
    'binarySha256',
    'binaryByteCount',
    'binaryObservedAt',
    'versionOutput',
  ], 'TrustedBuildEvidence.tool');
  const expected = {
    toolId: observation.toolId,
    version: observation.version,
    packageChannel: observation.packageChannel,
    packagePlatform: observation.packagePlatform,
    packageFilename: observation.packageFilename,
    packageAbsolutePath: observation.absolutePackagePath,
    packageSha256: observation.packageSha256,
    packageByteCount: observation.packageByteCount,
    packageObservedAt: observation.packageObservedAt,
    binaryAbsolutePath: observation.absoluteBinaryPath,
    binarySha256: observation.binarySha256,
    binaryByteCount: observation.binaryByteCount,
    binaryObservedAt: observation.observedAt,
    versionOutput: observation.versionOutput,
  };
  if (canonicalStringify(tool) !== canonicalStringify(expected)) {
    fail('evidence-tool-drift', 'admitted osmium package, binary, version, path, or hash drifted');
  }
  return tool;
}

function admitLeases(value, chain) {
  const leases = exactDataObject(value, ['acquisition', 'extraction'], 'TrustedBuildEvidence.leases');
  leases.acquisition = admitLeaseObservation(
    leases.acquisition,
    chain.acquisition,
    {
      consumptionOrdinal: chain.receipt.consumptionOrdinal,
      consumedAt: chain.receipt.consumedAt,
    },
    'acquisition',
  );
  leases.extraction = admitLeaseObservation(
    leases.extraction,
    chain.extraction,
    { consumptionOrdinal: 1, consumedAt: leases.extraction?.consumedAt },
    'extraction',
  );
  if (
    Date.parse(leases.extraction.consumedAt) < Date.parse(chain.extraction.trustedController.observedAt)
    || Date.parse(leases.extraction.consumedAt) >= Date.parse(chain.extraction.ownerLease.deadlineAt)
  ) {
    fail('evidence-extraction-consumption-clock', 'extraction lease consumption is outside its deadline');
  }
  return leases;
}

function admitLeaseObservation(value, release, consumption, label) {
  const lease = exactDataObject(value, [
    'leaseIdentity',
    'ownerId',
    'nonce',
    'issuedAt',
    'deadlineAt',
    'trustedControllerIdentity',
    'controllerObservedAt',
    'consumptionOrdinal',
    'consumedAt',
  ], `TrustedBuildEvidence.leases.${label}`);
  const expected = {
    leaseIdentity: release.ownerLease.leaseIdentity,
    ownerId: release.ownerLease.ownerId,
    nonce: release.ownerLease.nonce,
    issuedAt: release.ownerLease.issuedAt,
    deadlineAt: release.ownerLease.deadlineAt,
    trustedControllerIdentity: release.trustedController.identity,
    controllerObservedAt: release.trustedController.observedAt,
    consumptionOrdinal: consumption.consumptionOrdinal,
    consumedAt: consumption.consumedAt,
  };
  if (canonicalStringify(lease) !== canonicalStringify(expected)) {
    fail('evidence-lease-drift', `${label} owner, lease, nonce, deadline, or consumption drifted`);
  }
  exactSha256(lease.leaseIdentity, `${label} lease identity`);
  exactSha256(lease.trustedControllerIdentity, `${label} controller identity`);
  if (!NONCE_PATTERN.test(lease.nonce)) fail('evidence-nonce', `${label} nonce is invalid`);
  exactTimestamp(lease.issuedAt, `${label} issuedAt`);
  exactTimestamp(lease.deadlineAt, `${label} deadlineAt`);
  exactTimestamp(lease.controllerObservedAt, `${label} controllerObservedAt`);
  exactTimestamp(lease.consumedAt, `${label} consumedAt`);
  if (lease.consumptionOrdinal !== 1) {
    fail('evidence-one-shot-consumption', `${label} must record first and only consumption`);
  }
  return lease;
}

function admitExecution(value, chain, leases, state) {
  const execution = exactDataObject(value, [
    'cwdAbsolute',
    'resolvedPaths',
    'preflight',
    'steps',
    'promotions',
    'retryUsed',
    'fallbackUsed',
  ], 'TrustedBuildEvidence.execution');
  const expectedPaths = expectedResolvedPaths(chain.acquisition, chain.extraction);
  if (execution.cwdAbsolute !== chain.extraction.paths.workingDirectoryAbsolute) {
    fail('evidence-cwd-drift', 'controller cwd differs from the exact extraction working directory');
  }
  if (canonicalStringify(execution.resolvedPaths) !== canonicalStringify(expectedPaths)) {
    fail('evidence-resolved-path-drift', 'final or staging resolved paths drifted from RD-E');
  }
  execution.resolvedPaths = expectedPaths;
  execution.preflight = admitPreflight(execution.preflight, chain, expectedPaths, leases);
  execution.steps = admitSteps(execution.steps, chain, leases, expectedPaths, state);
  execution.promotions = admitPromotionShapes(execution.promotions, expectedPaths);
  exactFalse(execution.retryUsed, 'TrustedBuildEvidence.execution.retryUsed');
  exactFalse(execution.fallbackUsed, 'TrustedBuildEvidence.execution.fallbackUsed');
  return execution;
}

function expectedResolvedPaths(acquisition, extraction) {
  const paths = extraction.paths;
  return freezeData({
    workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
    outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
    logPathAbsolute: paths.logPathAbsolute,
    sourcePartialPathAbsolute: acquisition.paths.sourcePartialPathAbsolute,
    sourcePbfAbsolute: paths.sourcePbfAbsolute,
    sourceFileInfoAbsolute: paths.sourceFileInfoAbsolute,
    coreBoundaryAbsolute: paths.coreBoundaryAbsolute,
    bufferBoundaryAbsolute: paths.bufferBoundaryAbsolute,
    bufferExtractPbfAbsolute: paths.bufferExtractPbfAbsolute,
    walkingFilteredPbfAbsolute: paths.walkingFilteredPbfAbsolute,
    intermediateOplAbsolute: paths.intermediateOplAbsolute,
    intermediateFileInfoAbsolute: paths.intermediateFileInfoAbsolute,
    buildEvidenceAbsolute: paths.buildEvidenceAbsolute,
    staging: {
      sourcePbfAbsolute: acquisition.paths.sourcePartialPathAbsolute,
      sourceFileInfoAbsolute: `${paths.sourceFileInfoAbsolute}.partial`,
      bufferExtractPbfAbsolute: `${paths.bufferExtractPbfAbsolute}.partial`,
      walkingFilteredPbfAbsolute: `${paths.walkingFilteredPbfAbsolute}.partial`,
      intermediateOplAbsolute: `${paths.intermediateOplAbsolute}.partial`,
      intermediateFileInfoAbsolute: `${paths.intermediateFileInfoAbsolute}.partial`,
      logPathAbsolute: `${paths.logPathAbsolute}.partial`,
      buildEvidenceAbsolute: `${paths.buildEvidenceAbsolute}.partial`,
    },
  }, 'TrustedBuildEvidence exact resolved paths');
}

function admitPreflight(value, chain, paths, leases) {
  const preflight = exactDataObject(value, [
    'status', 'acquisitionObservedAt', 'extractionObservedAt', 'checks',
  ], 'TrustedBuildEvidence.execution.preflight');
  if (preflight.status !== 'observed-passed') {
    fail('evidence-preflight-status', 'controller preflight must be directly observed passed');
  }
  const acquisitionObservedAt = exactTimestamp(
    preflight.acquisitionObservedAt,
    'preflight.acquisitionObservedAt',
  );
  const extractionObservedAt = exactTimestamp(
    preflight.extractionObservedAt,
    'preflight.extractionObservedAt',
  );
  assertWithinLease(
    acquisitionObservedAt,
    chain.acquisition.ownerLease.issuedAt,
    chain.acquisition.ownerLease.deadlineAt,
    'acquisition preflight',
  );
  assertWithinLease(
    extractionObservedAt,
    chain.extraction.ownerLease.issuedAt,
    chain.extraction.ownerLease.deadlineAt,
    'extraction preflight',
  );
  if (
    Date.parse(acquisitionObservedAt) < Date.parse(chain.acquisition.trustedController.observedAt)
    || Date.parse(acquisitionObservedAt) > Date.parse(leases.acquisition.consumedAt)
    || Date.parse(extractionObservedAt) < Date.parse(chain.extraction.trustedController.observedAt)
    || Date.parse(extractionObservedAt) > Date.parse(leases.extraction.consumedAt)
  ) fail('evidence-preflight-clock', 'preflight must follow controller observation and precede consumption');
  const expected = expectedPreflightChecks(chain, paths);
  if (canonicalStringify(preflight.checks) !== canonicalStringify(expected)) {
    fail('evidence-preflight-check-drift', 'resolved path, existence, or reparse preflight drifted');
  }
  preflight.checks = expected;
  return preflight;
}

function expectedPreflightChecks(chain, paths) {
  const check = (phase, absolutePath, disposition, exists) => ({
    phase,
    absolutePath,
    disposition,
    exists,
    reparsePoint: false,
    finalResolvedPath: true,
  });
  return [
    check('acquisition', chain.admission.transportObservation.absoluteBinaryPath, 'existing-input', true),
    check('acquisition', paths.staging.sourcePbfAbsolute, 'absent-output', false),
    check('acquisition', paths.sourcePbfAbsolute, 'absent-output', false),
    check('extraction', chain.admission.extractorObservation.absoluteBinaryPath, 'existing-input', true),
    check('extraction', paths.sourcePbfAbsolute, 'existing-input', true),
    check('extraction', paths.coreBoundaryAbsolute, 'existing-input', true),
    check('extraction', paths.bufferBoundaryAbsolute, 'existing-input', true),
    ...[
      'sourceFileInfoAbsolute',
      'bufferExtractPbfAbsolute',
      'walkingFilteredPbfAbsolute',
      'intermediateOplAbsolute',
      'intermediateFileInfoAbsolute',
      'logPathAbsolute',
      'buildEvidenceAbsolute',
    ].flatMap((key) => [
      check('extraction', paths.staging[key], 'absent-output', false),
      check('extraction', paths[key], 'absent-output', false),
    ]),
  ];
}

function admitSteps(value, chain, leases, paths, state) {
  if (!Array.isArray(value) || value.length !== TRUSTED_BUILD_STEP_IDS.length) {
    fail('evidence-step-count', 'TrustedBuildEvidence must contain all seven exact process steps');
  }
  const expectedPlans = [
    ...BUILD_POLICY.acquisitionCommandPlan,
    ...BUILD_POLICY.extractionCommandPlan,
  ];
  let previousEndedAt = null;
  return value.map((entry, index) => {
    const stepId = TRUSTED_BUILD_STEP_IDS[index];
    const step = exactDataObject(entry, [
      'stepId',
      'executableAbsolutePath',
      'argv',
      'cwdAbsolute',
      'shell',
      'startedAt',
      'endedAt',
      'exitStatus',
      'exitCode',
      'signal',
      'stdout',
      'stderr',
      'retryOrdinal',
      'fallbackUsed',
    ], `TrustedBuildEvidence.execution.steps[${index}]`);
    if (step.stepId !== stepId || expectedPlans[index].stepId !== stepId) {
      fail('evidence-step-order', `process step ${index} drifted from the exact RD-E order`);
    }
    const expectedExecutable = index === 0
      ? chain.admission.transportObservation.absoluteBinaryPath
      : chain.admission.extractorObservation.absoluteBinaryPath;
    if (step.executableAbsolutePath !== expectedExecutable) {
      fail('evidence-executable-drift', `process step ${stepId} executable drifted`);
    }
    const expectedArgv = resolveStepArgv(expectedPlans[index].argv, stepId, paths);
    if (canonicalStringify(step.argv) !== canonicalStringify(expectedArgv)) {
      fail('evidence-argv-drift', `process step ${stepId} argv drifted`);
    }
    step.argv = expectedArgv;
    if (step.cwdAbsolute !== paths.workingDirectoryAbsolute) {
      fail('evidence-cwd-drift', `process step ${stepId} cwd drifted`);
    }
    exactFalse(step.shell, `process step ${stepId}.shell`);
    const startedAt = exactTimestamp(step.startedAt, `process step ${stepId}.startedAt`);
    const endedAt = exactTimestamp(step.endedAt, `process step ${stepId}.endedAt`);
    const lease = index === 0 ? leases.acquisition : leases.extraction;
    if (
      Date.parse(startedAt) < Date.parse(lease.consumedAt)
      || Date.parse(endedAt) < Date.parse(startedAt)
      || Date.parse(endedAt) >= Date.parse(lease.deadlineAt)
      || (previousEndedAt !== null && Date.parse(startedAt) < Date.parse(previousEndedAt))
    ) {
      fail('evidence-step-clock', `process step ${stepId} clock order or deadline is invalid`);
    }
    previousEndedAt = endedAt;
    if (
      index === 0
      && Date.parse(endedAt) > Date.parse(chain.receipt.sourcePayload.retrievedAt)
    ) fail('evidence-acquisition-clock', 'download process ended after the observed retrieval clock');
    if (step.exitStatus !== 'exited' || step.exitCode !== 0 || step.signal !== null) {
      fail('evidence-exit-status', `process step ${stepId} did not record exact successful exit`);
    }
    step.stdout = admitCapture(step.stdout, `process step ${stepId}.stdout`, state);
    step.stderr = admitCapture(step.stderr, `process step ${stepId}.stderr`, state);
    if (step.retryOrdinal !== 0) fail('evidence-retry', `process step ${stepId} recorded a retry`);
    exactFalse(step.fallbackUsed, `process step ${stepId}.fallbackUsed`);
    return step;
  });
}

function resolveStepArgv(argv, stepId, paths) {
  const replacements = {
    SOURCE_PBF_PARTIAL: paths.staging.sourcePbfAbsolute,
    SOURCE_PBF: paths.sourcePbfAbsolute,
    BUFFER_BOUNDARY_GEOJSON: paths.bufferBoundaryAbsolute,
    BUFFER_EXTRACT_PBF: stepId === 'extract-buffer'
      ? paths.staging.bufferExtractPbfAbsolute
      : paths.bufferExtractPbfAbsolute,
    WALKING_FILTERED_PBF: stepId === 'filter-walking'
      ? paths.staging.walkingFilteredPbfAbsolute
      : paths.walkingFilteredPbfAbsolute,
    INTERMEDIATE_OPL: stepId === 'write-opl'
      ? paths.staging.intermediateOplAbsolute
      : paths.intermediateOplAbsolute,
  };
  return argv.map((argument) => {
    const match = /^\{([A-Z_]+)\}$/.exec(argument);
    if (!match) return argument;
    const replacement = replacements[match[1]];
    if (replacement === undefined) {
      fail('evidence-argv-placeholder', `unresolved RD-E argv placeholder ${argument}`);
    }
    return replacement;
  });
}

function admitPromotionShapes(value, paths) {
  if (!Array.isArray(value) || value.length !== TRUSTED_BUILD_PROMOTION_SLOTS.length) {
    fail('evidence-promotion-count', 'all exact partial-to-final promotions must be recorded');
  }
  const descriptors = promotionDescriptors(paths);
  return value.map((entry, index) => {
    const promotion = exactDataObject(entry, [
      'slot',
      'partialPathAbsolute',
      'finalPathAbsolute',
      'method',
      'promotedAt',
      'partialAbsentAfter',
      'finalPresentAfter',
      'finalReparsePoint',
      'sha256',
      'byteCount',
    ], `TrustedBuildEvidence.execution.promotions[${index}]`);
    const expected = descriptors[index];
    if (
      promotion.slot !== expected.slot
      || promotion.partialPathAbsolute !== expected.partialPathAbsolute
      || promotion.finalPathAbsolute !== expected.finalPathAbsolute
      || promotion.method !== 'atomic-rename-no-replace'
    ) fail('evidence-promotion-drift', `promotion ${index} path or method drifted`);
    exactTimestamp(promotion.promotedAt, `promotion ${promotion.slot}.promotedAt`);
    exactTrue(promotion.partialAbsentAfter, `promotion ${promotion.slot}.partialAbsentAfter`);
    exactTrue(promotion.finalPresentAfter, `promotion ${promotion.slot}.finalPresentAfter`);
    exactFalse(promotion.finalReparsePoint, `promotion ${promotion.slot}.finalReparsePoint`);
    exactSha256(promotion.sha256, `promotion ${promotion.slot}.sha256`);
    positiveByteCount(promotion.byteCount, `promotion ${promotion.slot}.byteCount`);
    return promotion;
  });
}

function promotionDescriptors(paths) {
  return [
    ['sourcePbf', paths.staging.sourcePbfAbsolute, paths.sourcePbfAbsolute],
    ['sourceFileInfo', paths.staging.sourceFileInfoAbsolute, paths.sourceFileInfoAbsolute],
    ['bufferExtractPbf', paths.staging.bufferExtractPbfAbsolute, paths.bufferExtractPbfAbsolute],
    ['walkingFilteredPbf', paths.staging.walkingFilteredPbfAbsolute, paths.walkingFilteredPbfAbsolute],
    ['intermediateOpl', paths.staging.intermediateOplAbsolute, paths.intermediateOplAbsolute],
    ['intermediateFileInfo', paths.staging.intermediateFileInfoAbsolute, paths.intermediateFileInfoAbsolute],
    ['log', paths.staging.logPathAbsolute, paths.logPathAbsolute],
    ['buildEvidence', paths.staging.buildEvidenceAbsolute, paths.buildEvidenceAbsolute],
  ].map(([slot, partialPathAbsolute, finalPathAbsolute]) => ({
    slot,
    partialPathAbsolute,
    finalPathAbsolute,
  }));
}

function admitOutputs(value, chain, leases, execution, state) {
  const outputs = exactDataObject(value, [
    'log',
    'sourceFileInfo',
    'bufferExtractPbf',
    'walkingFilteredPbf',
    'intermediateFileInfo',
    'intermediateOpl',
    'bridgeMetadata',
    'buildEvidenceFile',
  ], 'TrustedBuildEvidence.outputs');
  outputs.log = admitCapturedFile(
    outputs.log,
    execution.resolvedPaths.logPathAbsolute,
    'log',
    state,
  );
  outputs.sourceFileInfo = admitCapturedFile(
    outputs.sourceFileInfo,
    execution.resolvedPaths.sourceFileInfoAbsolute,
    'sourceFileInfo',
    state,
  );
  outputs.intermediateFileInfo = admitCapturedFile(
    outputs.intermediateFileInfo,
    execution.resolvedPaths.intermediateFileInfoAbsolute,
    'intermediateFileInfo',
    state,
  );
  if (!sameCapture(outputs.sourceFileInfo.capture, execution.steps[1].stdout)) {
    fail('evidence-source-fileinfo-bytes', 'source fileinfo bytes differ from exact process stdout');
  }
  if (!sameCapture(outputs.intermediateFileInfo.capture, execution.steps[6].stdout)) {
    fail('evidence-intermediate-fileinfo-bytes', 'intermediate fileinfo bytes differ from exact process stdout');
  }
  outputs.bufferExtractPbf = admitBoundOutputObservation(
    outputs.bufferExtractPbf,
    'bufferExtractPbf',
    'extract-buffer',
    execution.resolvedPaths.staging.bufferExtractPbfAbsolute,
    execution.resolvedPaths.bufferExtractPbfAbsolute,
    leases.extraction,
    execution,
  );
  outputs.walkingFilteredPbf = admitBoundOutputObservation(
    outputs.walkingFilteredPbf,
    'walkingFilteredPbf',
    'filter-walking',
    execution.resolvedPaths.staging.walkingFilteredPbfAbsolute,
    execution.resolvedPaths.walkingFilteredPbfAbsolute,
    leases.extraction,
    execution,
  );
  outputs.intermediateOpl = admitCapturedFile(
    outputs.intermediateOpl,
    execution.resolvedPaths.intermediateOplAbsolute,
    'intermediate OPL',
    state,
  );
  if (
    Date.parse(outputs.intermediateOpl.observedAt)
    < Date.parse(execution.steps[5].endedAt)
    || Date.parse(outputs.intermediateOpl.observedAt)
      >= Date.parse(chain.extraction.ownerLease.deadlineAt)
  ) fail('evidence-intermediate-opl-clock', 'intermediate OPL observation clock is invalid');
  outputs.bridgeMetadata = admitBridgeMetadataCapture(
    outputs.bridgeMetadata,
    leases.extraction,
    execution,
    state,
  );
  outputs.buildEvidenceFile = admitBoundFile(
    outputs.buildEvidenceFile,
    execution.resolvedPaths.buildEvidenceAbsolute,
    'controller build-evidence payload',
  );
  if (
    Date.parse(outputs.buildEvidenceFile.observedAt)
      < Date.parse(execution.steps.at(-1).endedAt)
    || Date.parse(outputs.buildEvidenceFile.observedAt)
      >= Date.parse(chain.extraction.ownerLease.deadlineAt)
  ) fail('evidence-build-evidence-clock', 'build-evidence payload observation clock is invalid');
  return outputs;
}

function admitBoundOutputObservation(
  value,
  slot,
  producerStepId,
  partialPathAbsolute,
  finalPathAbsolute,
  lease,
  execution,
) {
  const observation = exactDataObject(value, [
    'schema',
    'slot',
    'observationKind',
    'controllerIdentity',
    'leaseIdentity',
    'leaseNonce',
    'producerStepId',
    'partialPathAbsolute',
    'finalPathAbsolute',
    'observedAt',
    'closedBeforeObservation',
    'completeByteTraversal',
    'reparsePoint',
    'sha256',
    'byteCount',
  ], `evidence bound output observation ${slot}`);
  if (
    observation.schema !== TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA
    || observation.slot !== slot
    || observation.observationKind !== 'future-controller-direct-closed-file-byte-observation'
    || observation.controllerIdentity !== lease.trustedControllerIdentity
    || observation.leaseIdentity !== lease.leaseIdentity
    || observation.leaseNonce !== lease.nonce
    || observation.producerStepId !== producerStepId
  ) fail('evidence-bound-output-observer-drift', `${slot} observer binding drifted`);
  if (
    observation.partialPathAbsolute !== partialPathAbsolute
    || observation.finalPathAbsolute !== finalPathAbsolute
  ) fail('evidence-bound-output-path-drift', `${slot} observed path binding drifted`);
  exactTimestamp(observation.observedAt, `${slot}.observedAt`);
  exactTrue(observation.closedBeforeObservation, `${slot}.closedBeforeObservation`);
  exactTrue(observation.completeByteTraversal, `${slot}.completeByteTraversal`);
  exactFalse(observation.reparsePoint, `${slot}.reparsePoint`);
  exactSha256(observation.sha256, `${slot}.sha256`);
  positiveByteCount(observation.byteCount, `${slot}.byteCount`);
  const producer = execution.steps.find((step) => step.stepId === producerStepId);
  const promotion = execution.promotions.find((entry) => entry.slot === slot);
  if (
    producer === undefined
    || promotion === undefined
    || Date.parse(observation.observedAt) < Date.parse(producer.endedAt)
    || Date.parse(observation.observedAt) > Date.parse(promotion.promotedAt)
  ) fail('evidence-bound-output-clock', `${slot} byte observation clock is invalid`);
  assertWithinLease(
    observation.observedAt,
    lease.issuedAt,
    lease.deadlineAt,
    `${slot}.observedAt`,
  );
  return observation;
}

function admitBridgeMetadataCapture(value, lease, execution, state) {
  const input = exactDataObject(value, [
    'schema',
    'input',
    'observationKind',
    'controllerIdentity',
    'leaseIdentity',
    'leaseNonce',
    'observedAt',
    'capture',
  ], 'evidence bridge metadata input capture');
  if (
    input.schema !== TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA
    || input.input !== 'bridge-metadata-json'
    || input.observationKind !== 'future-controller-exact-invocation-argument-byte-capture'
    || input.controllerIdentity !== lease.trustedControllerIdentity
    || input.leaseIdentity !== lease.leaseIdentity
    || input.leaseNonce !== lease.nonce
  ) fail('evidence-bridge-metadata-observer-drift', 'bridge metadata observer binding drifted');
  exactTimestamp(input.observedAt, 'bridgeMetadata.observedAt');
  if (
    Date.parse(input.observedAt) < Date.parse(execution.steps.at(-1).endedAt)
    || Date.parse(input.observedAt) >= Date.parse(lease.deadlineAt)
  ) fail('evidence-bridge-metadata-clock', 'bridge metadata capture clock is invalid');
  input.capture = admitCapture(input.capture, 'bridgeMetadata.capture', state);
  return input;
}

function admitCapturedFile(value, expectedPath, label, state) {
  const file = exactDataObject(value, ['absolutePath', 'observedAt', 'capture'], `evidence output ${label}`);
  if (file.absolutePath !== expectedPath) fail('evidence-output-path', `${label} path drifted`);
  exactTimestamp(file.observedAt, `${label}.observedAt`);
  file.capture = admitCapture(file.capture, `${label}.capture`, state);
  return file;
}

function admitBoundFile(value, expectedPath, label) {
  const file = exactDataObject(value, [
    'absolutePath', 'sha256', 'byteCount', 'observedAt',
  ], label);
  if (file.absolutePath !== expectedPath) fail('evidence-output-path', `${label} path drifted`);
  exactSha256(file.sha256, `${label}.sha256`);
  positiveByteCount(file.byteCount, `${label}.byteCount`);
  exactTimestamp(file.observedAt, `${label}.observedAt`);
  return file;
}

function admitBridgeResult(value, outputs) {
  const bridge = exactDataObject(value, [
    'schema',
    'bridgeIdentity',
    'oplIdentity',
    'bridgeMetadataIdentity',
    'rdBIntermediateIdentity',
    'rdBAdapterIdentity',
    'rdBTopologyIdentity',
    'rdBGeometryIdentity',
    'nodeRecordCount',
    'wayRecordCount',
    'relationRecordCount',
    'edgeRecordCount',
  ], 'TrustedBuildEvidence.bridgeResult');
  if (bridge.schema !== OSMIUM_OPL_BRIDGE_RESULT_SCHEMA) {
    fail('evidence-bridge-schema', 'trusted evidence bridge result schema drifted');
  }
  for (const key of [
    'bridgeIdentity',
    'oplIdentity',
    'bridgeMetadataIdentity',
    'rdBIntermediateIdentity',
    'rdBAdapterIdentity',
    'rdBTopologyIdentity',
    'rdBGeometryIdentity',
  ]) exactSha256(bridge[key], `bridgeResult.${key}`);
  if (bridge.oplIdentity !== outputs.intermediateOpl.capture.sha256) {
    fail('evidence-bridge-opl-drift', 'bridge OPL identity differs from observed intermediate bytes');
  }
  for (const key of ['nodeRecordCount', 'wayRecordCount', 'relationRecordCount', 'edgeRecordCount']) {
    nonNegativeSafeInteger(bridge[key], `bridgeResult.${key}`);
  }
  const oplText = captureUtf8Text(outputs.intermediateOpl.capture, 'intermediate OPL capture');
  const metadataText = captureUtf8Text(outputs.bridgeMetadata.capture, 'bridge metadata capture');
  const recomputed = materializeSyntheticOsmiumOplFixture(oplText, metadataText);
  const expectedIdentities = {
    bridgeIdentity: recomputed.bridgeIdentity,
    oplIdentity: recomputed.identities.oplIdentity,
    bridgeMetadataIdentity: recomputed.identities.metadataIdentity,
    rdBIntermediateIdentity: recomputed.identities.intermediateIdentity,
    rdBAdapterIdentity: recomputed.identities.rdBAdapterIdentity,
    rdBTopologyIdentity: recomputed.rdBResult.normalization.graph.topologyIdentity,
    rdBGeometryIdentity: recomputed.rdBResult.normalization.graph.geometryIdentity,
  };
  for (const [key, expected] of Object.entries(expectedIdentities)) {
    if (bridge[key] !== expected) {
      fail('evidence-bridge-recomputation-drift', `bridgeResult.${key} differs from exact recomputation`);
    }
  }
  const expectedCounts = {
    nodeRecordCount: recomputed.audit.nodeRecordCount,
    wayRecordCount: recomputed.audit.wayRecordCount,
    relationRecordCount: recomputed.audit.relationRecordCount,
    edgeRecordCount: recomputed.audit.edgeRecordCount,
  };
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (bridge[key] !== expected) {
      fail('evidence-bridge-counts', `bridgeResult.${key} differs from exact recomputation`);
    }
  }
  return bridge;
}

function validatePromotions(promotions, chain, execution, outputs) {
  const stepById = new Map(execution.steps.map((step) => [step.stepId, step]));
  const producerBySlot = {
    sourcePbf: 'download-pbf',
    sourceFileInfo: 'source-fileinfo',
    bufferExtractPbf: 'extract-buffer',
    walkingFilteredPbf: 'filter-walking',
    intermediateOpl: 'write-opl',
    intermediateFileInfo: 'intermediate-fileinfo',
    log: 'intermediate-fileinfo',
    buildEvidence: 'intermediate-fileinfo',
  };
  const consumerBySlot = {
    sourcePbf: 'source-fileinfo',
    bufferExtractPbf: 'filter-walking',
    walkingFilteredPbf: 'check-references',
    intermediateOpl: 'intermediate-fileinfo',
  };
  let priorPromotion = null;
  for (const promotion of promotions) {
    const producer = stepById.get(producerBySlot[promotion.slot]);
    const deadline = promotion.slot === 'sourcePbf'
      ? chain.acquisition.ownerLease.deadlineAt
      : chain.extraction.ownerLease.deadlineAt;
    if (
      Date.parse(promotion.promotedAt) < Date.parse(producer.endedAt)
      || Date.parse(promotion.promotedAt) >= Date.parse(deadline)
      || (priorPromotion !== null && Date.parse(promotion.promotedAt) < Date.parse(priorPromotion))
    ) fail('evidence-promotion-clock', `promotion ${promotion.slot} clock order is invalid`);
    const consumerId = consumerBySlot[promotion.slot];
    if (
      consumerId !== undefined
      && Date.parse(promotion.promotedAt) > Date.parse(stepById.get(consumerId).startedAt)
    ) fail('evidence-promotion-clock', `promotion ${promotion.slot} occurred after its consumer started`);
    if (
      promotion.slot === 'sourcePbf'
      && Date.parse(promotion.promotedAt) > Date.parse(chain.receipt.sourcePayload.retrievedAt)
    ) fail('evidence-promotion-clock', 'source promotion occurred after the observed retrieval clock');
    priorPromotion = promotion.promotedAt;
  }
  bindPromotion(promotions[0], chain.receipt.sourcePayload.sha256, chain.receipt.sourcePayload.byteCount);
  bindPromotion(
    promotions[1],
    outputs.sourceFileInfo.capture.sha256,
    outputs.sourceFileInfo.capture.byteCount,
  );
  bindPromotion(
    promotions[2],
    outputs.bufferExtractPbf.sha256,
    outputs.bufferExtractPbf.byteCount,
  );
  bindPromotion(
    promotions[3],
    outputs.walkingFilteredPbf.sha256,
    outputs.walkingFilteredPbf.byteCount,
  );
  bindPromotion(
    promotions[4],
    outputs.intermediateOpl.capture.sha256,
    outputs.intermediateOpl.capture.byteCount,
  );
  bindPromotion(
    promotions[5],
    outputs.intermediateFileInfo.capture.sha256,
    outputs.intermediateFileInfo.capture.byteCount,
  );
  bindPromotion(promotions[6], outputs.log.capture.sha256, outputs.log.capture.byteCount);
  bindPromotion(
    promotions[7],
    outputs.buildEvidenceFile.sha256,
    outputs.buildEvidenceFile.byteCount,
  );
}

function bindPromotion(promotion, sha256, byteCount) {
  if (promotion.sha256 !== sha256 || promotion.byteCount !== byteCount) {
    fail('evidence-promotion-byte-drift', `promotion ${promotion.slot} byte binding drifted`);
  }
}

function admitCapture(value, label, state) {
  const capture = exactDataObject(value, [
    'encoding', 'chunksBase64', 'byteCount', 'sha256', 'truncated',
  ], label);
  if (capture.encoding !== 'base64-chunks') fail('evidence-capture-encoding', `${label} encoding drifted`);
  if (
    !Array.isArray(capture.chunksBase64)
    || capture.chunksBase64.length > TRUSTED_BUILD_CAPTURE_LIMITS.maximumChunks
  ) fail('evidence-capture-chunks', `${label} exceeds its chunk budget`);
  const hash = createHash('sha256');
  let byteCount = 0;
  for (const chunk of capture.chunksBase64) {
    if (typeof chunk !== 'string') fail('evidence-capture-chunk', `${label} chunk must be base64 text`);
    const bytes = Buffer.from(chunk, 'base64');
    if (bytes.toString('base64') !== chunk) {
      fail('evidence-capture-base64', `${label} contains non-canonical base64`);
    }
    byteCount += bytes.byteLength;
    if (byteCount > TRUSTED_BUILD_CAPTURE_LIMITS.maximumSingleCaptureDecodedBytes) {
      fail('evidence-capture-byte-limit', `${label} exceeds its decoded byte budget`);
    }
    hash.update(bytes);
  }
  state.capturedBytes += byteCount;
  if (state.capturedBytes > TRUSTED_BUILD_CAPTURE_LIMITS.maximumAggregateDecodedBytes) {
    fail('evidence-capture-aggregate-limit', 'evidence captures exceed the aggregate byte budget');
  }
  if (!Number.isSafeInteger(capture.byteCount) || capture.byteCount < 0 || capture.byteCount !== byteCount) {
    fail('evidence-capture-byte-count', `${label} byte count does not match exact embedded bytes`);
  }
  const sha256 = `sha256:${hash.digest('hex')}`;
  if (capture.sha256 !== sha256) fail('evidence-capture-sha256', `${label} digest does not match exact bytes`);
  exactFalse(capture.truncated, `${label}.truncated`);
  return capture;
}

function sameCapture(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function captureUtf8Text(capture, label) {
  const bytes = Buffer.concat(capture.chunksBase64.map((chunk) => Buffer.from(chunk, 'base64')));
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    fail('evidence-capture-utf8', `${label} is not exact well-formed UTF-8 text`);
  }
  return text;
}

function assertWithinLease(value, issuedAt, deadlineAt, label) {
  if (Date.parse(value) < Date.parse(issuedAt) || Date.parse(value) >= Date.parse(deadlineAt)) {
    fail('evidence-lease-clock', `${label} is outside its owner lease`);
  }
}

function exactSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail('evidence-sha256', `${label} must be an exact SHA-256 identity`);
  }
  return value;
}

function exactGitSha(value, label) {
  if (typeof value !== 'string' || !GIT_SHA_PATTERN.test(value)) {
    fail('evidence-git-sha', `${label} must be an exact Git revision`);
  }
  return value;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > 160 || !SAFE_ID_PATTERN.test(value)) {
    fail('evidence-id', `${label} must be a bounded canonical id`);
  }
  return value;
}

function positiveByteCount(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('evidence-byte-count', `${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('evidence-count', `${label} must be a non-negative safe integer`);
  }
  return value;
}

function exactTrue(value, label) {
  if (value !== true) fail('evidence-true-required', `${label} must be true`);
  return true;
}

function exactFalse(value, label) {
  if (value !== false) fail('evidence-false-required', `${label} must be false`);
  return false;
}
