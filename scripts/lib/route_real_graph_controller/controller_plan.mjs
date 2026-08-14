import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import { parseContractJsonText } from '../route_real_graph_build/bounded_json.mjs';
import { parseRealGraphBuildPolicyJson } from '../route_real_graph_build/contracts.mjs';
import { deriveWorkspacePaths } from '../route_real_graph_build/workspace_paths.mjs';
import {
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT,
} from '../route_real_graph_build/policy.mjs';
import {
  CONTROLLER_ACQUISITION_PLAN_SCHEMA,
  CONTROLLER_CLAIMS,
  CONTROLLER_EVIDENCE_BINDING_SCHEMA,
  CONTROLLER_EXTRACTION_PLAN_SCHEMA,
  CONTROLLER_LIMITATIONS,
  CONTROLLER_NORMALIZATION_BINDING,
  CONTROLLER_PROCESS_CONSTRAINTS,
  deriveControllerCurlPaths,
  deriveControllerToolPaths,
} from './contracts.mjs';
import {
  assertControllerCurlClaimTextsMatchAcquisitionBinding,
  assertControllerOsmiumClaimTextsMatchExtractionBinding,
  buildValidationOnlyAcquisitionPhaseBinding,
  buildValidationOnlyExtractionPhaseBinding,
} from './controller_evidence_binding.mjs';
import {
  admitPersistentNonceStoreTransition,
  assertNonceAbsentFromPersistentStore,
  parsePersistentNonceStoreClaim,
  persistentNonceStoreClaimIdentity,
} from './persistent_store_contract.mjs';
import {
  downloadTransportObservationClaimIdentity,
  installedToolObservationClaimIdentity,
  parseDownloadTransportObservationClaim,
  parseInstalledToolObservationClaim,
} from './tool_contracts.mjs';

const POLICY = parseRealGraphBuildPolicyJson(ROUTE_REAL_GRAPH_BUILD_POLICY_JSON_TEXT);

export function buildValidationOnlyAcquisitionControllerPlan(
  workspaceRootAbsolute,
  curlClaimJsonText,
  acquisitionStoreClaimJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 6, 'controller-acquisition-plan-arguments');
  const curl = parseDownloadTransportObservationClaim(curlClaimJsonText);
  const store = parsePersistentNonceStoreClaim(acquisitionStoreClaimJsonText);
  const phaseBinding = buildValidationOnlyAcquisitionPhaseBinding(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  assertControllerCurlClaimTextsMatchAcquisitionBinding(
    canonicalStringify(phaseBinding),
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    curlClaimJsonText,
  );
  if (
    curl.workspaceRootAbsolute !== workspaceRootAbsolute
    || store.workspaceRootAbsolute !== workspaceRootAbsolute
    || phaseBinding.workspaceRootAbsolute !== workspaceRootAbsolute
    || store.controllerIdentity !== phaseBinding.controllerIdentity
  ) fail('controller-acquisition-plan-context-drift', 'acquisition plan inputs use different workspaces or controllers');
  assertNonceAbsentFromPersistentStore(
    acquisitionStoreClaimJsonText,
    phaseBinding.release.nonce,
    phaseBinding.release.releaseIdentity,
    phaseBinding.release.leaseIdentity,
    phaseBinding.controllerIdentity,
  );
  const paths = deriveWorkspacePaths(workspaceRootAbsolute);
  const curlPaths = deriveControllerCurlPaths(workspaceRootAbsolute);
  const definition = POLICY.acquisitionCommandPlan[0];
  const step = makeStep({
    phase: 'acquisition',
    stepId: definition.stepId,
    kind: 'external-process',
    toolSlot: 'supervisor-admitted-curl',
    toolClaimIdentity: downloadTransportObservationClaimIdentity(curlClaimJsonText),
    executableAbsolutePath: curlPaths.binaryAbsolutePath,
    argv: definition.argv.map((argument) => resolveArgument(argument, definition.stepId, paths)),
    cwdAbsolute: paths.workingDirectoryAbsolute,
    constraints: CONTROLLER_PROCESS_CONSTRAINTS,
    fileOutputs: fileOutputsForStep(definition.stepId, paths),
    identityOutputs: [],
  });
  return freezeData({
    schema: CONTROLLER_ACQUISITION_PLAN_SCHEMA,
    phase: 'acquisition',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    dataClassification: 'caller-claim-validation-only-acquisition-pre-run-plan',
    workspaceRootAbsolute,
    controllerIdentity: phaseBinding.controllerIdentity,
    curlToolId: curl.toolId,
    curlClaimIdentity: downloadTransportObservationClaimIdentity(curlClaimJsonText),
    persistentStoreClaimIdentity: persistentNonceStoreClaimIdentity(acquisitionStoreClaimJsonText),
    phaseBindingIdentity: phaseBinding.phaseBindingIdentity,
    phaseDocuments: phaseBinding.documentIdentities,
    release: phaseBinding.release,
    preAcquisitionIdentity: phaseBinding.preAcquisitionIdentity,
    steps: [step],
    commandAuthorization: false,
    commandsRunnable: false,
    runtimeAdapterCapability: 'unavailable',
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'validation-only acquisition pre-run plan');
}

export function parseAcquisitionControllerPlanJsonText(
  planJsonText,
  curlClaimJsonText,
  acquisitionStoreClaimJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 6, 'controller-acquisition-plan-json-arguments');
  const plan = exactDataObject(parseContractJsonText(planJsonText), [
    'schema', 'phase', 'policyIdentity', 'dataClassification',
    'workspaceRootAbsolute', 'controllerIdentity', 'curlToolId',
    'curlClaimIdentity', 'persistentStoreClaimIdentity', 'phaseBindingIdentity',
    'phaseDocuments', 'release', 'preAcquisitionIdentity', 'steps',
    'commandAuthorization', 'commandsRunnable', 'runtimeAdapterCapability',
    'claims', 'limitations',
  ], 'acquisition controller plan');
  const expected = buildValidationOnlyAcquisitionControllerPlan(
    plan.workspaceRootAbsolute,
    curlClaimJsonText,
    acquisitionStoreClaimJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  assertCanonicalPlan(plan, expected, 'controller-acquisition-plan-drift');
  return expected;
}

export function acquisitionControllerPlanIdentity(...values) {
  requirePrimitiveTexts(values, values, 6, 'controller-acquisition-plan-identity-arguments');
  return contentIdentity(parseAcquisitionControllerPlanJsonText(...values));
}

export function buildValidationOnlyExtractionControllerPlan(
  workspaceRootAbsolute,
  acquisitionPlanJsonText,
  curlClaimJsonText,
  acquisitionStoreClaimJsonText,
  osmiumClaimJsonText,
  extractionStoreClaimJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 11, 'controller-extraction-plan-arguments');
  const acquisitionPlan = parseAcquisitionControllerPlanJsonText(
    acquisitionPlanJsonText,
    curlClaimJsonText,
    acquisitionStoreClaimJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  const osmium = parseInstalledToolObservationClaim(osmiumClaimJsonText);
  const store = parsePersistentNonceStoreClaim(extractionStoreClaimJsonText);
  const phaseBinding = buildValidationOnlyExtractionPhaseBinding(
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  assertControllerOsmiumClaimTextsMatchExtractionBinding(
    canonicalStringify(phaseBinding),
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
    osmiumClaimJsonText,
  );
  if (
    acquisitionPlan.workspaceRootAbsolute !== workspaceRootAbsolute
    || osmium.workspaceRootAbsolute !== workspaceRootAbsolute
    || store.workspaceRootAbsolute !== workspaceRootAbsolute
    || phaseBinding.workspaceRootAbsolute !== workspaceRootAbsolute
    || acquisitionPlan.controllerIdentity !== phaseBinding.controllerIdentity
    || store.controllerIdentity !== phaseBinding.controllerIdentity
    || acquisitionPlan.phaseBindingIdentity !== phaseBinding.acquisitionPhaseBindingIdentity
  ) fail('controller-extraction-plan-context-drift', 'extraction plan inputs use different phase bindings, workspaces, or controllers');
  const acquisitionPlanIdentity = acquisitionControllerPlanIdentity(
    acquisitionPlanJsonText,
    curlClaimJsonText,
    acquisitionStoreClaimJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  const persistentStoreTransition = admitPersistentNonceStoreTransition(
    acquisitionStoreClaimJsonText,
    extractionStoreClaimJsonText,
  );
  const acquisitionTerminal = assertAcquisitionTerminalPersisted(
    store,
    phaseBinding,
    acquisitionPlanIdentity,
  );
  assertNonceAbsentFromPersistentStore(
    extractionStoreClaimJsonText,
    phaseBinding.releases.extraction.nonce,
    phaseBinding.releases.extraction.releaseIdentity,
    phaseBinding.releases.extraction.leaseIdentity,
    phaseBinding.controllerIdentity,
  );
  const paths = deriveWorkspacePaths(workspaceRootAbsolute);
  const osmiumPaths = deriveControllerToolPaths(workspaceRootAbsolute);
  const steps = POLICY.extractionCommandPlan.map((definition) => makeStep({
    phase: 'extraction',
    stepId: definition.stepId,
    kind: 'external-process',
    toolSlot: 'supervisor-admitted-osmium',
    toolClaimIdentity: installedToolObservationClaimIdentity(osmiumClaimJsonText),
    executableAbsolutePath: osmiumPaths.binaryAbsolutePath,
    argv: definition.argv.map((argument) => resolveArgument(argument, definition.stepId, paths)),
    cwdAbsolute: paths.workingDirectoryAbsolute,
    constraints: CONTROLLER_PROCESS_CONSTRAINTS,
    fileOutputs: fileOutputsForStep(definition.stepId, paths),
    identityOutputs: [],
  }));
  steps.push(makeStep({
    phase: 'normalization',
    stepId: 'normalize-opl-to-rd-b',
    kind: 'reviewed-pure-normalization',
    toolSlot: 'accepted-rd-f-bridge-and-rd-b-adapter',
    toolClaimIdentity: contentIdentity(CONTROLLER_NORMALIZATION_BINDING),
    executableAbsolutePath: null,
    argv: [],
    cwdAbsolute: paths.workingDirectoryAbsolute,
    constraints: null,
    fileOutputs: [],
    identityOutputs: CONTROLLER_NORMALIZATION_BINDING.requiredResultIdentities,
  }));
  steps.push(makeStep({
    phase: 'evidence-finalization',
    stepId: 'finalize-trusted-build-evidence',
    kind: 'reviewed-controller-evidence-finalization',
    toolSlot: 'accepted-rd-f-trusted-build-evidence-v1',
    toolClaimIdentity: contentIdentity({
      schema: CONTROLLER_EVIDENCE_BINDING_SCHEMA,
      trustedBuildEvidenceSchema: CONTROLLER_NORMALIZATION_BINDING.trustedBuildEvidenceSchema,
    }),
    executableAbsolutePath: null,
    argv: [],
    cwdAbsolute: paths.workingDirectoryAbsolute,
    constraints: null,
    fileOutputs: fileOutputsForStep('finalize-trusted-build-evidence', paths),
    identityOutputs: [],
  }));
  return freezeData({
    schema: CONTROLLER_EXTRACTION_PLAN_SCHEMA,
    phase: 'extraction-normalization-finalization',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    dataClassification: 'caller-claim-validation-only-extraction-pre-run-plan',
    workspaceRootAbsolute,
    controllerIdentity: phaseBinding.controllerIdentity,
    acquisitionPlanIdentity,
    acquisitionResultIdentity: phaseBinding.acquisitionResultIdentity,
    osmiumToolId: osmium.toolId,
    osmiumClaimIdentity: installedToolObservationClaimIdentity(osmiumClaimJsonText),
    persistentStoreClaimIdentity: persistentNonceStoreClaimIdentity(extractionStoreClaimJsonText),
    persistentStoreTransition,
    acquisitionTerminal,
    phaseBindingIdentity: phaseBinding.phaseBindingIdentity,
    phaseDocuments: phaseBinding.documentIdentities,
    releases: phaseBinding.releases,
    sourceTransfer: {
      acquisitionResultIdentity: phaseBinding.acquisitionResultIdentity,
      extractionInputRequirementIdentity: phaseBinding.extractionInputRequirementIdentity,
      sourcePayload: phaseBinding.sourcePayload,
    },
    normalizationBinding: CONTROLLER_NORMALIZATION_BINDING,
    evidenceBindingSchema: CONTROLLER_EVIDENCE_BINDING_SCHEMA,
    steps,
    commandAuthorization: false,
    commandsRunnable: false,
    runtimeAdapterCapability: 'unavailable',
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'validation-only extraction pre-run plan');
}

export function parseExtractionControllerPlanJsonText(
  planJsonText,
  acquisitionPlanJsonText,
  curlClaimJsonText,
  acquisitionStoreClaimJsonText,
  osmiumClaimJsonText,
  extractionStoreClaimJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
) {
  requirePrimitiveTexts(arguments, [...arguments], 11, 'controller-extraction-plan-json-arguments');
  const plan = exactDataObject(parseContractJsonText(planJsonText), [
    'schema', 'phase', 'policyIdentity', 'dataClassification',
    'workspaceRootAbsolute', 'controllerIdentity', 'acquisitionPlanIdentity',
    'acquisitionResultIdentity', 'osmiumToolId', 'osmiumClaimIdentity',
    'persistentStoreClaimIdentity', 'persistentStoreTransition',
    'acquisitionTerminal', 'phaseBindingIdentity', 'phaseDocuments',
    'releases', 'sourceTransfer', 'normalizationBinding',
    'evidenceBindingSchema', 'steps', 'commandAuthorization', 'commandsRunnable',
    'runtimeAdapterCapability', 'claims', 'limitations',
  ], 'extraction controller plan');
  const expected = buildValidationOnlyExtractionControllerPlan(
    plan.workspaceRootAbsolute,
    acquisitionPlanJsonText,
    curlClaimJsonText,
    acquisitionStoreClaimJsonText,
    osmiumClaimJsonText,
    extractionStoreClaimJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  assertCanonicalPlan(plan, expected, 'controller-extraction-plan-drift');
  return expected;
}

export function extractionControllerPlanIdentity(...values) {
  requirePrimitiveTexts(values, values, 11, 'controller-extraction-plan-identity-arguments');
  return contentIdentity(parseExtractionControllerPlanJsonText(...values));
}

function assertAcquisitionTerminalPersisted(store, phaseBinding, acquisitionPlanIdentity) {
  const release = phaseBinding.releases.acquisition;
  const matches = store.records.filter((record) => (
    record.nonce === release.nonce
    && record.releaseIdentity === release.releaseIdentity
    && record.leaseIdentity === release.leaseIdentity
    && record.controllerIdentity === release.controllerIdentity
    && record.phase === 'terminal-succeeded'
  ));
  if (matches.length !== 1) {
    fail('controller-acquisition-terminal-store-missing', 'extraction plan requires one durable acquisition terminal-succeeded record');
  }
  const terminal = matches[0];
  if (
    terminal.phaseSlot !== 'acquisition'
    || terminal.phasePlanIdentity !== acquisitionPlanIdentity
    || terminal.phaseResultIdentity !== phaseBinding.acquisitionResultIdentity
  ) fail('controller-acquisition-terminal-binding', 'acquisition terminal must bind the exact acquisition plan and result');
  if (
    Date.parse(terminal.recordedAt) <= Date.parse(phaseBinding.sourcePayload.observedAt)
    || Date.parse(terminal.recordedAt) >= Date.parse(phaseBinding.releases.extraction.issuedAt)
  ) {
    fail('controller-acquisition-terminal-store-clock', 'acquisition terminal must follow source observation and precede extraction release issuance');
  }
  return freezeData({
    recordIdentity: contentIdentity(terminal),
    phaseSlot: terminal.phaseSlot,
    phasePlanIdentity: terminal.phasePlanIdentity,
    phaseResultIdentity: terminal.phaseResultIdentity,
    recordedAt: terminal.recordedAt,
  }, 'exact persisted acquisition terminal projection');
}

function makeStep(base) {
  const value = freezeData(base, `controller plan step ${base.stepId}`);
  return freezeData({ ...value, stepIdentity: contentIdentity(value) }, `identity-bound controller plan step ${base.stepId}`);
}

function fileOutputsForStep(stepId, paths) {
  const mapping = {
    'download-pbf': [['sourcePbf', paths.artifacts.sourcePartial, paths.artifacts.sourcePbf]],
    'source-fileinfo': [['sourceFileInfo', `${paths.artifacts.sourceFileInfo}.partial`, paths.artifacts.sourceFileInfo]],
    'extract-buffer': [['bufferExtractPbf', `${paths.artifacts.bufferExtractPbf}.partial`, paths.artifacts.bufferExtractPbf]],
    'filter-walking': [['walkingFilteredPbf', `${paths.artifacts.walkingFilteredPbf}.partial`, paths.artifacts.walkingFilteredPbf]],
    'check-references': [],
    'write-opl': [['intermediateOpl', `${paths.artifacts.intermediateOpl}.partial`, paths.artifacts.intermediateOpl]],
    'intermediate-fileinfo': [['intermediateFileInfo', `${paths.artifacts.intermediateFileInfo}.partial`, paths.artifacts.intermediateFileInfo]],
    'finalize-trusted-build-evidence': [
      ['log', `${paths.logPathAbsolute}.partial`, paths.logPathAbsolute],
      ['buildEvidence', `${paths.artifacts.buildEvidence}.partial`, paths.artifacts.buildEvidence],
    ],
  };
  return mapping[stepId].map(([slot, partialPathAbsolute, finalPathAbsolute]) => freezeData({
    slot,
    partialPathAbsolute,
    finalPathAbsolute,
    closedFileObservationRequired: true,
    flushRequired: true,
    completeTraversalRequired: true,
    atomicNoReplacePromotionRequired: true,
    parentDirectoryDurabilityRequired: true,
    postPromotionReopenRehashRequired: true,
  }, `controller output ${slot}`));
}

function resolveArgument(argument, stepId, paths) {
  const replacements = {
    SOURCE_PBF_PARTIAL: paths.artifacts.sourcePartial,
    SOURCE_PBF: paths.artifacts.sourcePbf,
    BUFFER_BOUNDARY_GEOJSON: paths.artifacts.bufferBoundary,
    BUFFER_EXTRACT_PBF: stepId === 'extract-buffer'
      ? `${paths.artifacts.bufferExtractPbf}.partial`
      : paths.artifacts.bufferExtractPbf,
    WALKING_FILTERED_PBF: stepId === 'filter-walking'
      ? `${paths.artifacts.walkingFilteredPbf}.partial`
      : paths.artifacts.walkingFilteredPbf,
    INTERMEDIATE_OPL: stepId === 'write-opl'
      ? `${paths.artifacts.intermediateOpl}.partial`
      : paths.artifacts.intermediateOpl,
  };
  const match = /^\{([A-Z_]+)\}$/.exec(argument);
  if (!match) return argument;
  if (!(match[1] in replacements)) fail('controller-plan-placeholder', `unresolved controller plan placeholder ${argument}`);
  return replacements[match[1]];
}

function assertCanonicalPlan(actual, expected, code) {
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    fail(code, 'controller phase plan differs from exact support-document recomputation');
  }
}

function requirePrimitiveTexts(args, values, expectedCount, code) {
  if (args.length !== expectedCount || values.some((value) => typeof value !== 'string')) {
    fail(code, `controller phase plan requires ${expectedCount} primitive text inputs`);
  }
}
