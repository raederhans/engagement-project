import {
  boundedText,
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import { parseBridgeContractJsonText } from '../route_real_graph_bridge/primitive_ingress.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  CONTROLLER_TRACE_CLAIM_SCHEMA,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
} from './contracts.mjs';
import {
  parseControllerEvidenceBindingJsonText,
} from './controller_evidence_binding.mjs';
import {
  acquisitionControllerPlanIdentity,
  extractionControllerPlanIdentity,
  parseAcquisitionControllerPlanJsonText,
  parseExtractionControllerPlanJsonText,
} from './controller_plan.mjs';
import {
  admitPersistentNonceStoreTransition,
  parsePersistentNonceStoreClaim,
  persistentNonceStoreClaimIdentity,
} from './persistent_store_contract.mjs';

export function buildValidationOnlyControllerTraceClaim(
  traceId,
  acquisitionPlanJsonText,
  extractionPlanJsonText,
  evidenceBindingJsonText,
  trustedBuildEvidenceJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
  curlObservationClaimJsonText,
  osmiumObservationClaimJsonText,
  acquisitionStoreClaimJsonText,
  extractionStoreClaimJsonText,
  completionStoreClaimJsonText,
) {
  requireFifteenPrimitiveTexts(arguments, [
    traceId,
    acquisitionPlanJsonText,
    extractionPlanJsonText,
    evidenceBindingJsonText,
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
    curlObservationClaimJsonText,
    osmiumObservationClaimJsonText,
    acquisitionStoreClaimJsonText,
    extractionStoreClaimJsonText,
    completionStoreClaimJsonText,
  ]);
  boundedText(traceId, 'controller traceId', { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
  const context = admitExactContext(
    acquisitionPlanJsonText,
    extractionPlanJsonText,
    evidenceBindingJsonText,
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
    curlObservationClaimJsonText,
    osmiumObservationClaimJsonText,
    acquisitionStoreClaimJsonText,
    extractionStoreClaimJsonText,
    completionStoreClaimJsonText,
  );
  const {
    acquisitionPlan,
    extractionPlan,
    binding,
    acquisitionStore,
    extractionStore,
    completionStore,
    completionStoreTransition,
    extractionTerminalRecord,
  } = context;
  return freezeData({
    schema: CONTROLLER_TRACE_CLAIM_SCHEMA,
    traceId,
    dataClassification: 'caller-claim-validation-only-successful-evidence-closure',
    policyIdentity: ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
    acquisitionPlanIdentity: acquisitionControllerPlanIdentity(
      acquisitionPlanJsonText,
      curlObservationClaimJsonText,
      acquisitionStoreClaimJsonText,
      sourceManifestJsonText,
      supervisorAdmissionJsonText,
      acquisitionReleaseJsonText,
    ),
    extractionPlanIdentity: extractionControllerPlanIdentity(
      extractionPlanJsonText,
      acquisitionPlanJsonText,
      curlObservationClaimJsonText,
      acquisitionStoreClaimJsonText,
      osmiumObservationClaimJsonText,
      extractionStoreClaimJsonText,
      sourceManifestJsonText,
      supervisorAdmissionJsonText,
      acquisitionReleaseJsonText,
      observedPayloadReceiptJsonText,
      extractionReleaseJsonText,
    ),
    evidenceBindingIdentity: binding.bindingIdentity,
    persistentStoreClaimIdentities: {
      acquisitionBefore: persistentNonceStoreClaimIdentity(acquisitionStoreClaimJsonText),
      extractionBefore: persistentNonceStoreClaimIdentity(extractionStoreClaimJsonText),
      completionAfter: persistentNonceStoreClaimIdentity(completionStoreClaimJsonText),
    },
    persistentStoreTransitionIdentities: {
      acquisitionToExtraction: extractionPlan.persistentStoreTransition.transitionIdentity,
      extractionToCompletion: completionStoreTransition.transitionIdentity,
    },
    controllerIdentity: binding.controllerIdentity,
    documentIdentities: binding.documentIdentities,
    phaseBindings: binding.phases,
    sourceTransfer: {
      acquisitionResultIdentity: binding.acquisitionResultIdentity,
      extractionInputIdentity: binding.extractionInputIdentity,
      sourcePayload: binding.sourcePayload,
    },
    events: deriveCanonicalEvents(
      acquisitionPlan,
      extractionPlan,
      binding,
      acquisitionStore,
      extractionStore,
      completionStore,
      extractionTerminalRecord,
    ),
    terminalState: 'terminal-succeeded-evidence-bound',
    finalEvidenceIdentity: binding.finalEvidenceIdentity,
    capability: null,
    commandAuthorization: false,
    commandsRunnable: false,
    successEvidence: false,
    actual: false,
    current: false,
    runtime: false,
    product: false,
    publication: false,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'RD-G canonical successful evidence-closure trace claim');
}

export function parseControllerTraceClaim(
  traceJsonText,
  acquisitionPlanJsonText,
  extractionPlanJsonText,
  evidenceBindingJsonText,
  trustedBuildEvidenceJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
  curlObservationClaimJsonText,
  osmiumObservationClaimJsonText,
  acquisitionStoreClaimJsonText,
  extractionStoreClaimJsonText,
  completionStoreClaimJsonText,
) {
  if (typeof traceJsonText !== 'string') fail('json-text-required', 'controller trace ingress requires primitive JSON text');
  if (arguments.length !== 15 || [
    acquisitionPlanJsonText,
    extractionPlanJsonText,
    evidenceBindingJsonText,
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
    curlObservationClaimJsonText,
    osmiumObservationClaimJsonText,
    acquisitionStoreClaimJsonText,
    extractionStoreClaimJsonText,
    completionStoreClaimJsonText,
  ].some((value) => typeof value !== 'string')) {
    fail('controller-trace-json-arguments', 'controller trace admission requires fifteen primitive text inputs');
  }
  const parsed = exactDataObject(parseBridgeContractJsonText(
    traceJsonText,
    'RD-G successful controller trace JSON',
  ), [
    'schema', 'traceId', 'dataClassification', 'policyIdentity',
    'acquisitionPlanIdentity', 'extractionPlanIdentity', 'evidenceBindingIdentity',
    'persistentStoreClaimIdentities', 'persistentStoreTransitionIdentities',
    'controllerIdentity', 'documentIdentities',
    'phaseBindings', 'sourceTransfer', 'events', 'terminalState',
    'finalEvidenceIdentity', 'capability', 'commandAuthorization',
    'commandsRunnable', 'successEvidence', 'actual', 'current', 'runtime',
    'product', 'publication', 'claims', 'limitations',
  ], 'RD-G successful controller trace claim');
  const expected = buildValidationOnlyControllerTraceClaim(
    parsed.traceId,
    acquisitionPlanJsonText,
    extractionPlanJsonText,
    evidenceBindingJsonText,
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
    curlObservationClaimJsonText,
    osmiumObservationClaimJsonText,
    acquisitionStoreClaimJsonText,
    extractionStoreClaimJsonText,
    completionStoreClaimJsonText,
  );
  if (canonicalStringify(parsed) !== canonicalStringify(expected)) {
    fail('controller-trace-drift', 'controller trace differs from the exact RD-A/RD-E/RD-F evidence closure');
  }
  return expected;
}

export function controllerTraceClaimIdentity(...values) {
  if (values.length !== 15 || values.some((value) => typeof value !== 'string')) {
    fail('controller-trace-identity-arguments', 'controller trace identity requires fifteen primitive text inputs');
  }
  return contentIdentity(parseControllerTraceClaim(...values));
}

function admitExactContext(
  acquisitionPlanJsonText,
  extractionPlanJsonText,
  evidenceBindingJsonText,
  trustedBuildEvidenceJsonText,
  sourceManifestJsonText,
  supervisorAdmissionJsonText,
  acquisitionReleaseJsonText,
  observedPayloadReceiptJsonText,
  extractionReleaseJsonText,
  curlObservationClaimJsonText,
  osmiumObservationClaimJsonText,
  acquisitionStoreClaimJsonText,
  extractionStoreClaimJsonText,
  completionStoreClaimJsonText,
) {
  const acquisitionPlan = parseAcquisitionControllerPlanJsonText(
    acquisitionPlanJsonText,
    curlObservationClaimJsonText,
    acquisitionStoreClaimJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
  );
  const extractionPlan = parseExtractionControllerPlanJsonText(
    extractionPlanJsonText,
    acquisitionPlanJsonText,
    curlObservationClaimJsonText,
    acquisitionStoreClaimJsonText,
    osmiumObservationClaimJsonText,
    extractionStoreClaimJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  const binding = parseControllerEvidenceBindingJsonText(
    evidenceBindingJsonText,
    trustedBuildEvidenceJsonText,
    sourceManifestJsonText,
    supervisorAdmissionJsonText,
    acquisitionReleaseJsonText,
    observedPayloadReceiptJsonText,
    extractionReleaseJsonText,
  );
  const acquisitionStore = parsePersistentNonceStoreClaim(acquisitionStoreClaimJsonText);
  const extractionStore = parsePersistentNonceStoreClaim(extractionStoreClaimJsonText);
  const completionStore = parsePersistentNonceStoreClaim(completionStoreClaimJsonText);
  const completionStoreTransition = admitPersistentNonceStoreTransition(
    extractionStoreClaimJsonText,
    completionStoreClaimJsonText,
  );
  const phaseDocumentIdentities = { ...binding.documentIdentities };
  delete phaseDocumentIdentities.trustedBuildEvidenceIdentity;
  if (
    acquisitionPlan.workspaceRootAbsolute !== binding.workspaceRootAbsolute
    || extractionPlan.workspaceRootAbsolute !== binding.workspaceRootAbsolute
    || acquisitionStore.controllerIdentity !== binding.controllerIdentity
    || extractionStore.controllerIdentity !== binding.controllerIdentity
    || completionStore.controllerIdentity !== binding.controllerIdentity
    || acquisitionPlan.phaseBindingIdentity !== binding.acquisitionPhaseBindingIdentity
    || extractionPlan.phaseBindingIdentity !== binding.extractionPhaseBindingIdentity
    || extractionPlan.acquisitionPlanIdentity !== acquisitionControllerPlanIdentity(
      acquisitionPlanJsonText,
      curlObservationClaimJsonText,
      acquisitionStoreClaimJsonText,
      sourceManifestJsonText,
      supervisorAdmissionJsonText,
      acquisitionReleaseJsonText,
    )
    || canonicalStringify(extractionPlan.phaseDocuments) !== canonicalStringify(phaseDocumentIdentities)
    || extractionPlan.sourceTransfer.acquisitionResultIdentity !== binding.acquisitionResultIdentity
    || extractionPlan.sourceTransfer.extractionInputRequirementIdentity !== binding.extractionInput.requirementIdentity
    || canonicalStringify(extractionPlan.sourceTransfer.sourcePayload) !== canonicalStringify(binding.sourcePayload)
    || extractionPlan.persistentStoreTransition.predecessorClaimIdentity !== contentIdentity(acquisitionStore)
    || extractionPlan.persistentStoreTransition.successorClaimIdentity !== contentIdentity(extractionStore)
    || extractionPlan.acquisitionTerminal.phasePlanIdentity !== extractionPlan.acquisitionPlanIdentity
    || extractionPlan.acquisitionTerminal.phaseResultIdentity !== binding.acquisitionResultIdentity
  ) fail('controller-trace-context-drift', 'plan, six-document binding, tool claims, or persistent store differ');
  if (binding.phases.acquisition.nonce === binding.phases.extraction.nonce) {
    fail('controller-phase-nonce-reuse', 'acquisition and extraction must reserve distinct nonces');
  }
  const extractionRecords = requireSuccessfulPhaseRecordSequence(
    completionStore,
    binding.phases.extraction,
    'extraction',
    contentIdentity(extractionPlan),
    binding.finalEvidenceIdentity,
  );
  const extractionTerminalRecord = extractionRecords.at(-1);
  if (
    Date.parse(extractionTerminalRecord.recordedAt) <= Date.parse(binding.evidence.evidenceObservedAt)
    || Date.parse(extractionTerminalRecord.recordedAt) >= Date.parse(binding.phases.extraction.deadlineAt)
  ) fail('controller-extraction-terminal-store-clock', 'extraction terminal must follow final evidence observation and not exceed the extraction deadline');
  const acquisitionRecords = requireSuccessfulPhaseRecordSequence(
    extractionStore,
    binding.phases.acquisition,
    'acquisition',
    extractionPlan.acquisitionPlanIdentity,
    binding.acquisitionResultIdentity,
  );
  assertSuccessfulPhaseRecordClockBindings(acquisitionRecords, extractionRecords, binding);
  return {
    acquisitionPlan,
    extractionPlan,
    binding,
    acquisitionStore,
    extractionStore,
    completionStore,
    completionStoreTransition,
    extractionTerminalRecord,
  };
}

function deriveCanonicalEvents(
  acquisitionPlan,
  extractionPlan,
  binding,
  acquisitionStore,
  extractionStore,
  completionStore,
  extractionTerminalRecord,
) {
  const planSteps = [...acquisitionPlan.steps, ...extractionPlan.steps];
  const evidenceSteps = new Map(binding.evidence.steps.map((step) => [step.stepId, step]));
  const promotions = new Map(binding.evidence.promotions.map((promotion) => [promotion.slot, promotion]));
  const outputs = binding.evidence.outputs;
  const pending = [];
  let sequence = 0;
  const add = (priority, at, value) => {
    pending.push({ priority, sequence: sequence += 1, at, ...value });
  };
  add(10, binding.evidence.preflight.acquisitionObservedAt, {
    type: 'phase-preflight-observed',
    phase: 'acquisition',
    preflightIdentity: binding.evidence.preflightIdentity,
    checksIdentity: binding.evidence.preflight.checksIdentity,
  });
  addNonceAbsencePrecondition(
    add,
    binding.phases.acquisition,
    'acquisition',
    acquisitionStore,
    20,
  );
  const acquisitionRecords = requireSuccessfulPhaseRecordSequence(
    extractionStore,
    binding.phases.acquisition,
    'acquisition',
    contentIdentity(acquisitionPlan),
    binding.acquisitionResultIdentity,
  );
  addPhaseStateRecordEvents(add, acquisitionRecords, 'acquisition', extractionStore, 52);
  for (const step of planSteps.filter((entry) => entry.kind === 'external-process')) {
    const evidence = evidenceSteps.get(step.stepId);
    if (!evidence) fail('controller-step-evidence-missing', `RD-F evidence omitted ${step.stepId}`);
    add(30, evidence.startedAt, {
      type: 'process-step-started',
      phase: step.phase,
      stepId: step.stepId,
      stepIdentity: step.stepIdentity,
      executableAbsolutePath: step.executableAbsolutePath,
      argv: step.argv,
      cwdAbsolute: step.cwdAbsolute,
      stepBindingRevalidated: true,
    });
    add(40, evidence.endedAt, {
      type: 'process-step-exited',
      phase: step.phase,
      stepId: step.stepId,
      stepEvidenceIdentity: evidence.stepEvidenceIdentity,
      startedAt: evidence.startedAt,
      endedAt: evidence.endedAt,
      exitStatus: evidence.exitStatus,
      exitCode: evidence.exitCode,
      signal: evidence.signal,
      stdout: evidence.stdout,
      stderr: evidence.stderr,
      retryOrdinal: evidence.retryOrdinal,
      fallbackUsed: evidence.fallbackUsed,
      childTreeContainmentClaimed: true,
    });
  }
  add(50, binding.sourcePayload.observedAt, {
    type: 'acquisition-result-bound',
    phase: 'acquisition',
    acquisitionReleaseIdentity: binding.documentIdentities.acquisitionReleaseIdentity,
    observedPayloadReceiptIdentity: binding.documentIdentities.observedPayloadReceiptIdentity,
    acquisitionResultIdentity: binding.acquisitionResultIdentity,
    sourcePayload: binding.sourcePayload,
  });
  const acquisitionTerminalRecord = acquisitionRecords.at(-1);
  add(51, acquisitionTerminalRecord.recordedAt, {
    type: 'acquisition-terminal-persisted',
    phase: 'acquisition',
    recordIdentity: contentIdentity(acquisitionTerminalRecord),
    extractionStoreClaimIdentity: contentIdentity(extractionStore),
    phasePlanIdentity: acquisitionTerminalRecord.phasePlanIdentity,
    phaseResultIdentity: acquisitionTerminalRecord.phaseResultIdentity,
    sourcePayload: binding.sourcePayload,
    persistentStateDirectlyObserved: false,
  });
  add(10, binding.evidence.preflight.extractionObservedAt, {
    type: 'phase-preflight-observed',
    phase: 'extraction',
    preflightIdentity: binding.evidence.preflightIdentity,
    checksIdentity: binding.evidence.preflight.checksIdentity,
  });
  addNonceAbsencePrecondition(
    add,
    binding.phases.extraction,
    'extraction',
    extractionStore,
    20,
  );
  const extractionRecords = requireSuccessfulPhaseRecordSequence(
    completionStore,
    binding.phases.extraction,
    'extraction',
    contentIdentity(extractionPlan),
    binding.finalEvidenceIdentity,
  );
  addPhaseStateRecordEvents(add, extractionRecords, 'extraction', completionStore, 82);
  add(21, binding.phases.extraction.consumedAt, {
    type: 'source-input-revalidation-bound',
    phase: 'extraction',
    extractionReleaseIdentity: binding.documentIdentities.extractionReleaseIdentity,
    acquisitionResultIdentity: binding.acquisitionResultIdentity,
    extractionInputIdentity: binding.extractionInputIdentity,
    sourcePayload: binding.sourcePayload,
    mustBeObservedAfter: binding.extractionInput.mustBeObservedAfter,
    mustBeObservedBefore: binding.extractionInput.mustBeObservedBefore,
    closedFileObservationRequired: true,
    completeByteTraversalRequired: true,
    reparsePointRequired: false,
    observationTrusted: false,
  });

  const outputBySlot = canonicalOutputsBySlot(binding);
  const producerBySlot = {
    sourcePbf: 'download-pbf',
    sourceFileInfo: 'source-fileinfo',
    bufferExtractPbf: 'extract-buffer',
    walkingFilteredPbf: 'filter-walking',
    intermediateOpl: 'write-opl',
    intermediateFileInfo: 'intermediate-fileinfo',
    log: 'finalize-trusted-build-evidence',
    buildEvidence: 'finalize-trusted-build-evidence',
  };
  for (const [slot, promotion] of promotions) {
    const output = outputBySlot[slot];
    add(60, output.observedAt, {
      type: 'output-observed',
      stepId: producerBySlot[slot],
      slot,
      outputIdentity: output.outputIdentity,
      absolutePath: output.absolutePath,
      sha256: output.sha256,
      byteCount: output.byteCount,
      completeByteTraversal: true,
      reparsePoint: false,
    });
    add(55, promotion.promotedAt, {
      type: 'output-promoted',
      stepId: producerBySlot[slot],
      slot,
      promotionIdentity: promotion.promotionIdentity,
      partialPathAbsolute: promotion.partialPathAbsolute,
      finalPathAbsolute: promotion.finalPathAbsolute,
      method: promotion.method,
      sha256: promotion.sha256,
      byteCount: promotion.byteCount,
      partialAbsentAfter: promotion.partialAbsentAfter,
      finalPresentAfter: promotion.finalPresentAfter,
      finalReparsePoint: promotion.finalReparsePoint,
      parentDirectoryDurabilityClaimed: true,
      postPromotionReopenCompleteTraversalClaimed: true,
    });
  }

  const normalizationStep = extractionPlan.steps.find((step) => step.phase === 'normalization');
  add(70, outputs.bridgeMetadata.observedAt, {
    type: 'normalization-completed',
    phase: 'normalization',
    stepId: normalizationStep.stepId,
    stepIdentity: normalizationStep.stepIdentity,
    bridgeMetadataCapture: outputs.bridgeMetadata.capture,
    bridgeResultIdentity: binding.evidence.bridgeResultIdentity,
    bridgeResult: binding.evidence.bridgeResult,
    trustedBuildEvidenceIdentity: binding.documentIdentities.trustedBuildEvidenceIdentity,
  });
  const finalizationStep = extractionPlan.steps.find((step) => step.phase === 'evidence-finalization');
  add(80, binding.evidence.evidenceObservedAt, {
    type: 'trusted-build-evidence-bound',
    phase: 'evidence-finalization',
    stepId: finalizationStep.stepId,
    stepIdentity: finalizationStep.stepIdentity,
    executionIdentity: binding.evidence.executionIdentity,
    outputsIdentity: binding.evidence.outputsIdentity,
    trustedBuildEvidenceIdentity: binding.documentIdentities.trustedBuildEvidenceIdentity,
    finalEvidenceIdentity: binding.finalEvidenceIdentity,
    laterIndependentRegistryObservationRequired: true,
  });
  add(85, extractionTerminalRecord.recordedAt, {
    type: 'extraction-terminal-persisted',
    phase: 'extraction',
    recordIdentity: contentIdentity(extractionTerminalRecord),
    completionStoreClaimIdentity: contentIdentity(completionStore),
    phasePlanIdentity: extractionTerminalRecord.phasePlanIdentity,
    phaseResultIdentity: extractionTerminalRecord.phaseResultIdentity,
    persistentStateDirectlyObserved: false,
  });
  add(90, extractionTerminalRecord.recordedAt, {
    type: 'terminal-succeeded-evidence-bound',
    childTreeContainmentClaimed: true,
    retryUsed: false,
    fallbackUsed: false,
    commandAuthorization: false,
    successEvidence: false,
    finalEvidenceIdentity: binding.finalEvidenceIdentity,
  });
  pending.sort((left, right) => (
    Date.parse(left.at) - Date.parse(right.at)
    || left.priority - right.priority
    || left.sequence - right.sequence
  ));
  const events = pending.map(({ priority: _priority, sequence: _sequence, ...event }, index) => {
    const base = { ordinal: index + 1, ...event };
    return freezeData({ ...base, eventIdentity: contentIdentity(base) }, `RD-G canonical trace event ${index + 1}`);
  });
  if (events.at(-1)?.type !== 'terminal-succeeded-evidence-bound') {
    fail('controller-trace-terminal-order', 'the successful evidence-bound terminal must be the final canonical event');
  }
  return events;
}

function canonicalOutputsBySlot(binding) {
  const { outputs } = binding.evidence;
  return {
    sourcePbf: {
      absolutePath: binding.sourcePayload.absolutePath,
      observedAt: binding.sourcePayload.observedAt,
      sha256: binding.sourcePayload.sha256,
      byteCount: binding.sourcePayload.byteCount,
      outputIdentity: binding.acquisitionResultIdentity,
    },
    sourceFileInfo: capturedOutput(outputs.sourceFileInfo),
    bufferExtractPbf: boundOutput(outputs.bufferExtractPbf),
    walkingFilteredPbf: boundOutput(outputs.walkingFilteredPbf),
    intermediateOpl: capturedOutput(outputs.intermediateOpl),
    intermediateFileInfo: capturedOutput(outputs.intermediateFileInfo),
    log: capturedOutput(outputs.log),
    buildEvidence: {
      absolutePath: outputs.buildEvidence.absolutePath,
      observedAt: outputs.buildEvidence.observedAt,
      sha256: outputs.buildEvidence.sha256,
      byteCount: outputs.buildEvidence.byteCount,
      outputIdentity: outputs.buildEvidence.outputIdentity,
    },
  };
}

function capturedOutput(output) {
  return {
    absolutePath: output.absolutePath,
    observedAt: output.observedAt,
    sha256: output.capture.sha256,
    byteCount: output.capture.byteCount,
    outputIdentity: output.outputIdentity,
  };
}

function boundOutput(output) {
  return {
    absolutePath: output.finalPathAbsolute,
    observedAt: output.observedAt,
    sha256: output.sha256,
    byteCount: output.byteCount,
    outputIdentity: output.outputIdentity,
  };
}

function addNonceAbsencePrecondition(add, phase, phaseName, persistentStore, priority) {
  if (persistentStore.records.some((record) => record.nonce === phase.nonce)) {
    fail('controller-trace-nonce-precondition', 'pre-run persistent store must prove the phase nonce absent');
  }
  add(priority, persistentStore.snapshotObservedAt, {
    type: 'nonce-absence-precondition-bound',
    phase: phaseName,
    releaseIdentity: phase.releaseIdentity,
    leaseIdentity: phase.leaseIdentity,
    nonce: phase.nonce,
    controllerIdentity: phase.controllerIdentity,
    persistentStoreClaimIdentity: contentIdentity(persistentStore),
    consumptionOrdinal: phase.consumptionOrdinal,
    nonceAbsentInSnapshot: true,
    exclusiveNoReplaceReservationRequired: true,
    reservationOccurrenceTrusted: false,
  });
}

function addPhaseStateRecordEvents(add, records, phaseName, store, priority) {
  for (const record of records) {
    add(priority, record.recordedAt, {
      type: 'persistent-state-record-bound',
      phase: phaseName,
      state: record.phase,
      phaseOrdinal: record.phaseOrdinal,
      consumptionOrdinal: record.consumptionOrdinal,
      recordIdentity: contentIdentity(record),
      persistentStoreClaimIdentity: contentIdentity(store),
      phasePlanIdentity: record.phasePlanIdentity,
      phaseResultIdentity: record.phaseResultIdentity,
      durableStateClaimedByCaller: true,
      persistentStateDirectlyObserved: false,
    });
  }
}

function requireSuccessfulPhaseRecordSequence(store, phase, phaseName, planIdentity, resultIdentity) {
  const records = store.records.filter((record) => record.nonce === phase.nonce);
  const expectedPhases = ['reserved', 'running', 'observing', 'promoted', 'terminal-succeeded'];
  if (
    records.length !== expectedPhases.length
    || records.some((record, index) => (
      record.phase !== expectedPhases[index]
      || record.phaseOrdinal !== index + 1
      || record.releaseIdentity !== phase.releaseIdentity
      || record.leaseIdentity !== phase.leaseIdentity
      || record.controllerIdentity !== phase.controllerIdentity
      || record.phaseSlot !== phaseName
      || record.phasePlanIdentity !== planIdentity
      || record.phaseResultIdentity !== (record.phase === 'terminal-succeeded' ? resultIdentity : null)
      || record.consumptionOrdinal !== phase.consumptionOrdinal
    ))
  ) fail('controller-successful-phase-store-sequence', 'successful trace requires the exact durable five-state phase sequence and bindings');
  if (records[0].recordedAt !== phase.consumedAt) {
    fail('controller-successful-phase-consumption-clock', 'the durable reserved event must equal the exact lease consumption clock');
  }
  return records;
}

function assertSuccessfulPhaseRecordClockBindings(acquisitionRecords, extractionRecords, binding) {
  const acquisitionStep = binding.evidence.steps.find((step) => step.stepId === 'download-pbf');
  const extractionStep = binding.evidence.steps.find((step) => step.stepId === 'source-fileinfo');
  const finalPromotionAt = binding.evidence.promotions.reduce((latest, promotion) => (
    Date.parse(promotion.promotedAt) > Date.parse(latest) ? promotion.promotedAt : latest
  ), binding.evidence.promotions[0].promotedAt);
  if (
    acquisitionRecords[1].recordedAt !== acquisitionStep?.startedAt
    || acquisitionRecords[2].recordedAt !== acquisitionStep?.endedAt
    || acquisitionRecords[3].recordedAt !== binding.sourcePayload.observedAt
    || extractionRecords[1].recordedAt !== extractionStep?.startedAt
    || extractionRecords[2].recordedAt !== extractionStep?.endedAt
    || extractionRecords[3].recordedAt !== finalPromotionAt
  ) fail('controller-successful-phase-evidence-clock', 'durable running, observing, and promoted events must equal canonical process and output evidence clocks');
}

function requireFifteenPrimitiveTexts(args, values) {
  if (args.length !== 15 || values.some((value) => typeof value !== 'string')) {
    fail('controller-trace-build-arguments', 'controller trace construction requires fifteen primitive text arguments');
  }
}
