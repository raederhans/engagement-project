import { contentIdentity, fail, freezeData } from '../route_graph_candidate/safe_data.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  PERSISTENT_NONCE_STORE_INSPECTION_SCHEMA,
  CONTROLLER_TRACE_INSPECTION_SCHEMA,
} from './contracts.mjs';
import {
  parsePersistentNonceStoreClaim,
  persistentNonceStoreClaimIdentity,
} from './persistent_store_contract.mjs';
import {
  parseControllerTraceClaim,
} from './trace_contract.mjs';

export function inspectControllerStateMachineMechanics() {
  if (arguments.length !== 0) {
    fail('controller-mechanics-arguments', 'controller mechanics inspection accepts no caller input');
  }
  return freezeData({
    schema: 'route-real-graph-controller-state-machine-mechanics/v2',
    states: [
      'absent',
      'reserved',
      'running',
      'observing',
      'promoted',
      'terminal-succeeded-evidence-bound',
    ],
    reserveBeforeSpawnRequired: true,
    exclusiveNoReplaceReservationRequired: true,
    reservationFileFlushRequired: true,
    parentDirectoryDurabilityRequired: true,
    everyPriorNonceStateConsumed: true,
    successfulTraceBindsCanonicalPhaseAndEvidence: true,
    failedCrashedExpiredTraceGrammar: 'unavailable',
    retryAllowed: false,
    fallbackAllowed: false,
    partialCanBecomeFinalWithoutObservation: false,
    crashCanResetNonceToAbsent: false,
    progressiveAcquisitionAndExtractionPlansRequired: true,
    acquisitionPlanMustPrecedeReceipt: true,
    extractionPlanRequiresAcquisitionTerminalStoreRecord: true,
    acquisitionTerminalBindsExactPlanAndResult: true,
    persistentStoreSnapshotsRequireMonotonicPrefixTransition: true,
    persistentStoreNonceHistoryIsAppendOnlyEventSequence: true,
    finalTraceMustBindBothPlansThreeStoreSnapshotsAndTwoTransitions: true,
    successfulEvidenceTerminalMustBeFinalEvent: true,
    runtimeCapability: 'unavailable',
    commandsRunnable: false,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'RD-G controller state-machine mechanics');
}

export function inspectCallerPersistentNonceStoreClaim(jsonText) {
  if (typeof jsonText !== 'string') {
    fail('json-text-required', 'persistent-store inspection requires primitive JSON text');
  }
  if (arguments.length !== 1) {
    fail('persistent-store-inspection-arguments', 'persistent-store inspection accepts one JSON text argument');
  }
  const store = parsePersistentNonceStoreClaim(jsonText);
  return freezeData({
    schema: PERSISTENT_NONCE_STORE_INSPECTION_SCHEMA,
    status: 'caller-claim-only-not-trusted',
    claimShapeValidated: true,
    claimIdentity: persistentNonceStoreClaimIdentity(jsonText),
    canonicalClaimIdentity: contentIdentity(store),
    persistentStateDirectlyObserved: false,
    durableReservationTrusted: false,
    oneShotConsumptionTrusted: false,
    commandAuthorization: false,
    commandsRunnable: false,
    runtimeAuthorized: false,
    publicationAuthorized: false,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'caller persistent nonce store claim inspection');
}

export function inspectCallerControllerTraceClaim(
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
  if (typeof traceJsonText !== 'string') {
    fail('json-text-required', 'controller trace inspection requires primitive JSON text');
  }
  if (arguments.length !== 15 || [...arguments].some((value) => typeof value !== 'string')) {
    fail('controller-trace-arguments', 'controller trace inspection requires fifteen primitive trace and support texts');
  }
  const trace = parseControllerTraceClaim(
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
  );
  return freezeData({
    schema: CONTROLLER_TRACE_INSPECTION_SCHEMA,
    status: 'caller-trace-only-not-trusted',
    traceShapeValidated: true,
    traceIdentity: contentIdentity(trace),
    canonicalTraceIdentity: contentIdentity(trace),
    persistentStateDirectlyObserved: false,
    oneShotConsumptionTrusted: false,
    processObservationTrusted: false,
    filesystemObservationTrusted: false,
    canonicalPhaseBindingRecomputed: true,
    canonicalEvidenceBindingRecomputed: true,
    commandAuthorization: false,
    commandsRunnable: false,
    actualAcquisition: false,
    actualExtraction: false,
    actualIntermediate: false,
    actualGraph: false,
    sourceHealthCurrent: false,
    runtimeAuthorized: false,
    publicationAuthorized: false,
    terminalEvent: trace.events.at(-1).type,
    claims: CONTROLLER_CLAIMS,
    limitations: CONTROLLER_LIMITATIONS,
  }, 'caller controller trace claim inspection');
}
