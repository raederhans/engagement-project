import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { admitGeofabrikAcquisitionManifest } from '../../lib/route_real_graph_acquisition/index.mjs';
import { contentIdentity } from '../../lib/route_graph_candidate/safe_data.mjs';
import {
  BOUNDARY_POLICY_ID,
  BUILD_AUTHORITY_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  EXTRACTOR_PACKAGE_FILENAME,
  INTERNAL_DIGEST_LIMITATION,
  REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA,
  REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA,
  REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA,
  REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA,
  REAL_GRAPH_OWNER_LEASE_SCHEMA,
  REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA,
  RELEASE_CERTIFICATE_LIMITATION,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
  parseAcquisitionReleaseJson,
  parseExtractionReleaseJson,
  parseObservedPayloadReceiptJson,
  parseRealGraphBuildPolicyJson,
  parseSupervisorAdmissionJson,
} from '../../lib/route_real_graph_build/index.mjs';
import { deriveWorkspacePaths } from '../../lib/route_real_graph_build/workspace_paths.mjs';
import {
  OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
  TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA,
  TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA,
  TRUSTED_BUILD_CLAIMS,
  TRUSTED_BUILD_EVIDENCE_SCHEMA,
  TRUSTED_BUILD_LIMITATIONS,
  materializeSyntheticOsmiumOplFixture,
} from '../../lib/route_real_graph_bridge/index.mjs';

const SOURCE_MANIFEST_URL = new URL(
  '../route-real-graph-acquisition/pennsylvania-260813-manifest.json',
  import.meta.url,
);
const OPL_URL = new URL('../route-real-graph-bridge/synthetic-walking.osm.opl', import.meta.url);
const METADATA_URL = new URL('../route-real-graph-bridge/synthetic-bridge-metadata.json', import.meta.url);
const [sourceManifestText, oplText, metadataText] = await Promise.all([
  readFile(SOURCE_MANIFEST_URL, 'utf8'),
  readFile(OPL_URL, 'utf8'),
  readFile(METADATA_URL, 'utf8'),
]);
const syntheticBridge = materializeSyntheticOsmiumOplFixture(oplText, metadataText);
const BUILD_POLICY = parseRealGraphBuildPolicyJson(ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT);
const BUILD_LIMITATIONS = [
  BUILD_AUTHORITY_LIMITATION,
  RELEASE_CERTIFICATE_LIMITATION,
  BUILD_CLAIM_LIMITATION,
  INTERNAL_DIGEST_LIMITATION,
];

export function makeSyntheticControllerEvidenceBundle({
  workspaceRootAbsolute,
  controllerIdentity,
  curlClaim,
  osmiumClaim,
}) {
  const manifest = admitGeofabrikAcquisitionManifest(sourceManifestText);
  const admission = makeAdmission(
    manifest.manifestIdentity,
    workspaceRootAbsolute,
    curlClaim,
    osmiumClaim,
  );
  const admissionText = json(admission);
  const acquisition = makeAcquisitionRelease(admissionText, controllerIdentity);
  const acquisitionText = json(acquisition);
  const receipt = makeObservedReceipt(acquisitionText, admissionText);
  const receiptText = json(receipt);
  const extraction = makeExtractionRelease(
    receiptText,
    acquisitionText,
    admissionText,
    controllerIdentity,
  );
  const extractionText = json(extraction);
  const evidence = makeEvidence(
    manifest,
    admissionText,
    acquisitionText,
    receiptText,
    extractionText,
  );
  return {
    evidence,
    evidenceText: json(evidence),
    manifestText: sourceManifestText,
    admission,
    admissionText,
    acquisition,
    acquisitionText,
    receipt,
    receiptText,
    extraction,
    extractionText,
  };
}

function makeAdmission(sourceManifestIdentity, workspaceRootAbsolute, curlClaim, osmiumClaim) {
  const paths = deriveWorkspacePaths(workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_SUPERVISOR_ADMISSION_SCHEMA,
    admissionId: 'synthetic-rd-g-supervisor-admission/v1',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    admittedRevision: 'a'.repeat(40),
    workspaceRootAbsolute,
    sourceManifestIdentity,
    boundaryBinding: {
      policyId: BOUNDARY_POLICY_ID,
      core: {
        absolutePath: paths.artifacts.coreBoundary,
        sha256: fakeSha('2'),
        byteCount: 2_002,
        observedAt: '2026-08-14T08:00:00.000Z',
      },
      buffer: {
        absolutePath: paths.artifacts.bufferBoundary,
        sha256: fakeSha('3'),
        byteCount: 3_003,
        builtAt: '2026-08-14T08:01:00.000Z',
      },
      builderIdentity: fakeSha('4'),
    },
    intermediateAdapter: {
      schema: REAL_GRAPH_INTERMEDIATE_ADAPTER_SCHEMA,
      identity: syntheticBridge.bridgeIdentity,
      admittedRevision: 'b'.repeat(40),
      acceptedAt: '2026-08-14T08:02:00.000Z',
      status: 'reviewed-admitted',
    },
    extractorObservation: {
      toolId: osmiumClaim.toolId,
      version: '1.19.1',
      packageChannel: 'conda-forge',
      packagePlatform: 'win-64',
      packageFilename: EXTRACTOR_PACKAGE_FILENAME,
      absolutePackagePath: osmiumClaim.package.absolutePath,
      packageSha256: osmiumClaim.package.sha256,
      packageByteCount: osmiumClaim.package.byteCount,
      packageObservedAt: osmiumClaim.package.observedAt,
      absoluteBinaryPath: osmiumClaim.binaryAfterVersion.absolutePath,
      versionArguments: ['--version'],
      versionOutput: decodeVersion(osmiumClaim.version.stdout),
      binarySha256: osmiumClaim.binaryAfterVersion.sha256,
      binaryByteCount: osmiumClaim.binaryAfterVersion.byteCount,
      observedAt: osmiumClaim.binaryAfterVersion.observedAt,
    },
    transportObservation: {
      toolId: curlClaim.toolId,
      version: curlClaim.version,
      absoluteBinaryPath: curlClaim.binaryAfterVersion.absolutePath,
      versionArguments: ['--version'],
      versionOutput: decodeVersion(curlClaim.versionObservation.stdout),
      binarySha256: curlClaim.binaryAfterVersion.sha256,
      binaryByteCount: curlClaim.binaryAfterVersion.byteCount,
      observedAt: curlClaim.binaryAfterVersion.observedAt,
    },
    acceptedAt: '2026-08-14T08:06:00.000Z',
    evidenceRef: 'synthetic-rd-g-contract-test-only',
    limitations: BUILD_LIMITATIONS,
  };
}

function makeAcquisitionRelease(admissionText, controllerIdentity) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_ACQUISITION_RELEASE_SCHEMA,
    releaseId: 'synthetic-rd-g-acquisition-release/v1',
    admissionIdentity: contentIdentity(admission),
    datedUrl: BUILD_POLICY.source.datedUrl,
    transportObservationIdentity: contentIdentity(admission.transportObservation),
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    paths: {
      workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
      outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
      logPathAbsolute: paths.logPathAbsolute,
      sourcePartialPathAbsolute: paths.artifacts.sourcePartial,
      sourceFinalPathAbsolute: paths.artifacts.sourcePbf,
    },
    ownerLease: makeLease({
      ownerId: 'synthetic-acquisition-owner',
      nonce: 'a'.repeat(32),
      issuedAt: '2026-08-14T08:10:00.000Z',
      deadlineAt: '2026-08-14T08:30:00.000Z',
    }),
    trustedController: {
      identity: controllerIdentity,
      observedAt: '2026-08-14T08:11:00.000Z',
    },
    oneShotConsumption: {
      required: true,
      consumptionOrdinal: 0,
      consumedAt: null,
    },
    preflight: unobservedPreflight(),
    retryAllowed: false,
    fallbackAllowed: false,
    limitations: BUILD_LIMITATIONS,
  };
}

function makeObservedReceipt(acquisitionText, admissionText) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  return {
    schema: REAL_GRAPH_OBSERVED_PAYLOAD_RECEIPT_SCHEMA,
    receiptId: 'synthetic-rd-g-observed-payload-receipt/v1',
    acquisitionReleaseIdentity: contentIdentity(acquisition),
    admissionIdentity: contentIdentity(admission),
    ownerLeaseIdentity: acquisition.ownerLease.leaseIdentity,
    ownerNonce: acquisition.ownerLease.nonce,
    trustedControllerIdentity: acquisition.trustedController.identity,
    controllerObservedAt: acquisition.trustedController.observedAt,
    consumptionOrdinal: 1,
    consumedAt: '2026-08-14T08:12:00.000Z',
    sourcePayload: {
      absolutePath: acquisition.paths.sourceFinalPathAbsolute,
      sha256: fakeSha('9'),
      byteCount: 9_009,
      retrievedAt: '2026-08-14T08:14:00.000Z',
      observedAt: '2026-08-14T08:15:00.000Z',
    },
    partialRemoved: true,
    retryUsed: false,
    fallbackUsed: false,
    limitations: BUILD_LIMITATIONS,
  };
}

function makeExtractionRelease(receiptText, acquisitionText, admissionText, controllerIdentity) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const receipt = parseObservedPayloadReceiptJson(
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = deriveWorkspacePaths(admission.workspaceRootAbsolute);
  return {
    schema: REAL_GRAPH_EXTRACTION_RELEASE_SCHEMA,
    releaseId: 'synthetic-rd-g-extraction-release/v1',
    admissionIdentity: contentIdentity(admission),
    observedPayloadReceiptIdentity: contentIdentity(receipt),
    extractorObservationIdentity: contentIdentity(admission.extractorObservation),
    boundaryBinding: clone(admission.boundaryBinding),
    intermediateAdapterIdentity: contentIdentity(admission.intermediateAdapter),
    workspaceRootAbsolute: admission.workspaceRootAbsolute,
    paths: {
      workingDirectoryAbsolute: paths.workingDirectoryAbsolute,
      outputDirectoryAbsolute: paths.outputDirectoryAbsolute,
      logPathAbsolute: paths.logPathAbsolute,
      sourcePbfAbsolute: paths.artifacts.sourcePbf,
      sourceFileInfoAbsolute: paths.artifacts.sourceFileInfo,
      coreBoundaryAbsolute: paths.artifacts.coreBoundary,
      bufferBoundaryAbsolute: paths.artifacts.bufferBoundary,
      bufferExtractPbfAbsolute: paths.artifacts.bufferExtractPbf,
      walkingFilteredPbfAbsolute: paths.artifacts.walkingFilteredPbf,
      intermediateOplAbsolute: paths.artifacts.intermediateOpl,
      intermediateFileInfoAbsolute: paths.artifacts.intermediateFileInfo,
      buildEvidenceAbsolute: paths.artifacts.buildEvidence,
    },
    ownerLease: makeLease({
      ownerId: 'synthetic-extraction-owner',
      nonce: 'b'.repeat(32),
      issuedAt: '2026-08-14T08:16:00.000Z',
      deadlineAt: '2026-08-14T09:00:00.000Z',
    }),
    trustedController: {
      identity: controllerIdentity,
      observedAt: '2026-08-14T08:17:00.000Z',
    },
    oneShotConsumption: {
      required: true,
      consumptionOrdinal: 0,
      consumedAt: null,
    },
    preflight: unobservedPreflight(),
    retryAllowed: false,
    fallbackAllowed: false,
    limitations: BUILD_LIMITATIONS,
  };
}

function makeEvidence(manifest, admissionText, acquisitionText, receiptText, extractionText) {
  const admission = parseSupervisorAdmissionJson(
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const acquisition = parseAcquisitionReleaseJson(
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const receipt = parseObservedPayloadReceiptJson(
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const extraction = parseExtractionReleaseJson(
    extractionText,
    receiptText,
    acquisitionText,
    admissionText,
    ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  );
  const paths = fixtureResolvedPaths(acquisition, extraction);
  const sourceFileInfo = capture('{"file":"source","synthetic":true}\n');
  const intermediateFileInfo = capture('{"file":"intermediate-opl","synthetic":true}\n');
  const log = capture('synthetic TrustedBuildEvidence contract fixture log\n');
  const buildEvidenceFile = bytesBinding('synthetic controller build-evidence payload bytes');
  const steps = fixtureSteps(admission, paths, sourceFileInfo, intermediateFileInfo);
  const bufferExtractPbf = boundOutputObservation(
    'bufferExtractPbf',
    'extract-buffer',
    paths.staging.bufferExtractPbfAbsolute,
    paths.bufferExtractPbfAbsolute,
    '2026-08-14T08:22:10.000Z',
    extraction,
    bytesBinding('synthetic buffer extract bytes'),
  );
  const walkingFilteredPbf = boundOutputObservation(
    'walkingFilteredPbf',
    'filter-walking',
    paths.staging.walkingFilteredPbfAbsolute,
    paths.walkingFilteredPbfAbsolute,
    '2026-08-14T08:24:10.000Z',
    extraction,
    bytesBinding('synthetic walking filtered bytes'),
  );
  const outputs = {
    log: {
      absolutePath: paths.logPathAbsolute,
      observedAt: '2026-08-14T08:31:10.000Z',
      capture: log,
    },
    sourceFileInfo: {
      absolutePath: paths.sourceFileInfoAbsolute,
      observedAt: '2026-08-14T08:20:10.000Z',
      capture: sourceFileInfo,
    },
    bufferExtractPbf,
    walkingFilteredPbf,
    intermediateFileInfo: {
      absolutePath: paths.intermediateFileInfoAbsolute,
      observedAt: '2026-08-14T08:30:10.000Z',
      capture: intermediateFileInfo,
    },
    intermediateOpl: {
      absolutePath: paths.intermediateOplAbsolute,
      observedAt: '2026-08-14T08:28:10.000Z',
      capture: capture(oplText),
    },
    bridgeMetadata: {
      schema: TRUSTED_BUILD_BRIDGE_INPUT_CAPTURE_SCHEMA,
      input: 'bridge-metadata-json',
      observationKind: 'future-controller-exact-invocation-argument-byte-capture',
      controllerIdentity: extraction.trustedController.identity,
      leaseIdentity: extraction.ownerLease.leaseIdentity,
      leaseNonce: extraction.ownerLease.nonce,
      observedAt: '2026-08-14T08:30:20.000Z',
      capture: capture(metadataText),
    },
    buildEvidenceFile: {
      absolutePath: paths.buildEvidenceAbsolute,
      sha256: buildEvidenceFile.sha256,
      byteCount: buildEvidenceFile.byteCount,
      observedAt: '2026-08-14T08:31:20.000Z',
    },
  };
  return {
    schema: TRUSTED_BUILD_EVIDENCE_SCHEMA,
    evidenceId: 'synthetic-caller-claim-never-trusted/v1',
    dataClassification: 'candidate-private-process-observation',
    admittedRevision: admission.admittedRevision,
    evidenceObservedAt: '2026-08-14T08:32:00.000Z',
    bindings: {
      policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
      sourceManifestIdentity: manifest.manifestIdentity,
      supervisorAdmissionIdentity: contentIdentity(admission),
      acquisitionReleaseIdentity: contentIdentity(acquisition),
      observedPayloadReceiptIdentity: contentIdentity(receipt),
      extractionReleaseIdentity: contentIdentity(extraction),
      extractorObservationIdentity: contentIdentity(admission.extractorObservation),
      boundaryBindingIdentity: contentIdentity(admission.boundaryBinding),
      intermediateAdapterIdentity: contentIdentity(admission.intermediateAdapter),
    },
    tool: {
      toolId: admission.extractorObservation.toolId,
      version: admission.extractorObservation.version,
      packageChannel: admission.extractorObservation.packageChannel,
      packagePlatform: admission.extractorObservation.packagePlatform,
      packageFilename: admission.extractorObservation.packageFilename,
      packageAbsolutePath: admission.extractorObservation.absolutePackagePath,
      packageSha256: admission.extractorObservation.packageSha256,
      packageByteCount: admission.extractorObservation.packageByteCount,
      packageObservedAt: admission.extractorObservation.packageObservedAt,
      binaryAbsolutePath: admission.extractorObservation.absoluteBinaryPath,
      binarySha256: admission.extractorObservation.binarySha256,
      binaryByteCount: admission.extractorObservation.binaryByteCount,
      binaryObservedAt: admission.extractorObservation.observedAt,
      versionOutput: admission.extractorObservation.versionOutput,
    },
    leases: {
      acquisition: leaseObservation(acquisition, receipt.consumptionOrdinal, receipt.consumedAt),
      extraction: leaseObservation(extraction, 1, '2026-08-14T08:18:00.000Z'),
    },
    execution: {
      cwdAbsolute: paths.workingDirectoryAbsolute,
      resolvedPaths: paths,
      preflight: {
        status: 'observed-passed',
        acquisitionObservedAt: '2026-08-14T08:11:30.000Z',
        extractionObservedAt: '2026-08-14T08:17:30.000Z',
        checks: fixturePreflightChecks(admission, paths),
      },
      steps,
      promotions: fixturePromotions(receipt, paths, outputs),
      retryUsed: false,
      fallbackUsed: false,
    },
    outputs,
    bridgeResult: {
      schema: OSMIUM_OPL_BRIDGE_RESULT_SCHEMA,
      bridgeIdentity: syntheticBridge.bridgeIdentity,
      oplIdentity: syntheticBridge.identities.oplIdentity,
      bridgeMetadataIdentity: syntheticBridge.identities.metadataIdentity,
      rdBIntermediateIdentity: syntheticBridge.identities.intermediateIdentity,
      rdBAdapterIdentity: syntheticBridge.identities.rdBAdapterIdentity,
      rdBTopologyIdentity: syntheticBridge.rdBResult.normalization.graph.topologyIdentity,
      rdBGeometryIdentity: syntheticBridge.rdBResult.normalization.graph.geometryIdentity,
      nodeRecordCount: syntheticBridge.audit.nodeRecordCount,
      wayRecordCount: syntheticBridge.audit.wayRecordCount,
      relationRecordCount: syntheticBridge.audit.relationRecordCount,
      edgeRecordCount: syntheticBridge.audit.edgeRecordCount,
    },
    claims: TRUSTED_BUILD_CLAIMS,
    limitations: TRUSTED_BUILD_LIMITATIONS,
  };
}

function makeLease({ ownerId, nonce, issuedAt, deadlineAt }) {
  const projection = {
    schema: REAL_GRAPH_OWNER_LEASE_SCHEMA,
    ownerId,
    nonce,
    issuedAt,
    deadlineAt,
  };
  return { ...projection, leaseIdentity: contentIdentity(projection) };
}

function unobservedPreflight() {
  return {
    status: 'not-observed',
    symlinkAndReparseCheckRequired: true,
    preExistingOutputCheckRequired: true,
    exactByteRevalidationRequired: true,
  };
}

function leaseObservation(release, consumptionOrdinal, consumedAt) {
  return {
    leaseIdentity: release.ownerLease.leaseIdentity,
    ownerId: release.ownerLease.ownerId,
    nonce: release.ownerLease.nonce,
    issuedAt: release.ownerLease.issuedAt,
    deadlineAt: release.ownerLease.deadlineAt,
    trustedControllerIdentity: release.trustedController.identity,
    controllerObservedAt: release.trustedController.observedAt,
    consumptionOrdinal,
    consumedAt,
  };
}

function fixtureResolvedPaths(acquisition, extraction) {
  const paths = extraction.paths;
  return {
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
  };
}

function fixturePreflightChecks(admission, paths) {
  const check = (phase, absolutePath, disposition, exists) => ({
    phase,
    absolutePath,
    disposition,
    exists,
    reparsePoint: false,
    finalResolvedPath: true,
  });
  return [
    check('acquisition', admission.transportObservation.absoluteBinaryPath, 'existing-input', true),
    check('acquisition', paths.staging.sourcePbfAbsolute, 'absent-output', false),
    check('acquisition', paths.sourcePbfAbsolute, 'absent-output', false),
    check('extraction', admission.extractorObservation.absoluteBinaryPath, 'existing-input', true),
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

function fixtureSteps(admission, paths, sourceFileInfo, intermediateFileInfo) {
  const plans = [...BUILD_POLICY.acquisitionCommandPlan, ...BUILD_POLICY.extractionCommandPlan];
  const clocks = [
    ['2026-08-14T08:12:10.000Z', '2026-08-14T08:13:00.000Z'],
    ['2026-08-14T08:19:00.000Z', '2026-08-14T08:20:00.000Z'],
    ['2026-08-14T08:21:00.000Z', '2026-08-14T08:22:00.000Z'],
    ['2026-08-14T08:23:00.000Z', '2026-08-14T08:24:00.000Z'],
    ['2026-08-14T08:25:00.000Z', '2026-08-14T08:26:00.000Z'],
    ['2026-08-14T08:27:00.000Z', '2026-08-14T08:28:00.000Z'],
    ['2026-08-14T08:29:00.000Z', '2026-08-14T08:30:00.000Z'],
  ];
  return plans.map((plan, index) => ({
    stepId: plan.stepId,
    executableAbsolutePath: index === 0
      ? admission.transportObservation.absoluteBinaryPath
      : admission.extractorObservation.absoluteBinaryPath,
    argv: fixtureResolvedArgv(plan.argv, plan.stepId, paths),
    cwdAbsolute: paths.workingDirectoryAbsolute,
    shell: false,
    startedAt: clocks[index][0],
    endedAt: clocks[index][1],
    exitStatus: 'exited',
    exitCode: 0,
    signal: null,
    stdout: index === 1
      ? clone(sourceFileInfo)
      : index === 6
        ? clone(intermediateFileInfo)
        : capture(''),
    stderr: capture(''),
    retryOrdinal: 0,
    fallbackUsed: false,
  }));
}

function fixtureResolvedArgv(argv, stepId, paths) {
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
    return match ? replacements[match[1]] : argument;
  });
}

function fixturePromotions(receipt, paths, outputs) {
  const values = [
    ['sourcePbf', paths.staging.sourcePbfAbsolute, paths.sourcePbfAbsolute,
      '2026-08-14T08:13:10.000Z', receipt.sourcePayload],
    ['sourceFileInfo', paths.staging.sourceFileInfoAbsolute, paths.sourceFileInfoAbsolute,
      '2026-08-14T08:20:30.000Z', outputs.sourceFileInfo.capture],
    ['bufferExtractPbf', paths.staging.bufferExtractPbfAbsolute, paths.bufferExtractPbfAbsolute,
      '2026-08-14T08:22:30.000Z', outputs.bufferExtractPbf],
    ['walkingFilteredPbf', paths.staging.walkingFilteredPbfAbsolute, paths.walkingFilteredPbfAbsolute,
      '2026-08-14T08:24:30.000Z', outputs.walkingFilteredPbf],
    ['intermediateOpl', paths.staging.intermediateOplAbsolute, paths.intermediateOplAbsolute,
      '2026-08-14T08:28:30.000Z', outputs.intermediateOpl.capture],
    ['intermediateFileInfo', paths.staging.intermediateFileInfoAbsolute, paths.intermediateFileInfoAbsolute,
      '2026-08-14T08:30:30.000Z', outputs.intermediateFileInfo.capture],
    ['log', paths.staging.logPathAbsolute, paths.logPathAbsolute,
      '2026-08-14T08:31:00.000Z', outputs.log.capture],
    ['buildEvidence', paths.staging.buildEvidenceAbsolute, paths.buildEvidenceAbsolute,
      '2026-08-14T08:31:30.000Z', outputs.buildEvidenceFile],
  ];
  return values.map(([slot, partialPathAbsolute, finalPathAbsolute, promotedAt, binding]) => ({
    slot,
    partialPathAbsolute,
    finalPathAbsolute,
    method: 'atomic-rename-no-replace',
    promotedAt,
    partialAbsentAfter: true,
    finalPresentAfter: true,
    finalReparsePoint: false,
    sha256: binding.sha256,
    byteCount: binding.byteCount,
  }));
}

function capture(text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    encoding: 'base64-chunks',
    chunksBase64: bytes.byteLength === 0 ? [] : [bytes.toString('base64')],
    byteCount: bytes.byteLength,
    sha256: sha256Bytes(bytes),
    truncated: false,
  };
}

function bytesBinding(text) {
  const value = capture(text);
  return { sha256: value.sha256, byteCount: value.byteCount };
}

function boundOutputObservation(
  slot,
  producerStepId,
  partialPathAbsolute,
  finalPathAbsolute,
  observedAt,
  extraction,
  binding,
) {
  return {
    schema: TRUSTED_BUILD_BOUND_OUTPUT_OBSERVATION_SCHEMA,
    slot,
    observationKind: 'future-controller-direct-closed-file-byte-observation',
    controllerIdentity: extraction.trustedController.identity,
    leaseIdentity: extraction.ownerLease.leaseIdentity,
    leaseNonce: extraction.ownerLease.nonce,
    producerStepId,
    partialPathAbsolute,
    finalPathAbsolute,
    observedAt,
    closedBeforeObservation: true,
    completeByteTraversal: true,
    reparsePoint: false,
    sha256: binding.sha256,
    byteCount: binding.byteCount,
  };
}

function decodeVersion(captureValue) {
  return Buffer.from(captureValue.base64, 'base64').toString('utf8').replace(/\r?\n$/u, '');
}

function fakeSha(character) {
  return `sha256:${character.repeat(64)}`;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function json(value) {
  return JSON.stringify(value);
}
