import {
  boundedText,
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  exactTimestamp,
  fail,
  freezeData,
} from '../route_graph_candidate/safe_data.mjs';
import { parseContractJsonText } from '../route_real_graph_build/bounded_json.mjs';
import {
  CONTROLLER_CLAIMS,
  CONTROLLER_LIMITATIONS,
  PERSISTENT_NONCE_STORE_CLAIM_SCHEMA,
  ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY,
  assertControllerExactPath,
  deriveControllerStatePaths,
} from './contracts.mjs';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const PHASES = new Set([
  'reserved', 'running', 'observing', 'promoted', 'terminal-succeeded',
  'terminal-failed', 'terminal-crashed', 'terminal-expired',
]);
const TERMINAL_PHASES = new Set([
  'terminal-succeeded', 'terminal-failed', 'terminal-crashed', 'terminal-expired',
]);
const LEGAL_SUCCESSOR_PHASES = new Map([
  ['reserved', new Set(['running', 'terminal-failed', 'terminal-crashed', 'terminal-expired'])],
  ['running', new Set(['observing', 'terminal-failed', 'terminal-crashed', 'terminal-expired'])],
  ['observing', new Set(['promoted', 'terminal-failed', 'terminal-crashed', 'terminal-expired'])],
  ['promoted', new Set(['terminal-succeeded', 'terminal-failed', 'terminal-crashed', 'terminal-expired'])],
]);

export function parsePersistentNonceStoreClaim(jsonText) {
  if (typeof jsonText !== 'string') fail('json-text-required', 'persistent-store ingress requires primitive JSON text');
  if (arguments.length !== 1) fail('persistent-store-json-arguments', 'persistent-store ingress accepts one JSON text argument');
  const store = exactDataObject(parseContractJsonText(jsonText), [
    'schema', 'storeId', 'policyIdentity', 'workspaceRootAbsolute',
    'ledgerAbsolutePath', 'controllerIdentity', 'snapshotObservedAt',
    'snapshotFileIdentity', 'snapshotSha256', 'snapshotByteCount',
    'predecessorClaimIdentity',
    'closedBeforeObservation', 'completeByteTraversal', 'reparsePoint',
    'exclusiveNoReplaceReservationRequired', 'reservationFileFlushRequired',
    'parentDirectoryDurabilityRequired', 'records', 'claims', 'limitations',
  ], 'persistent nonce store claim');
  if (store.schema !== PERSISTENT_NONCE_STORE_CLAIM_SCHEMA) fail('persistent-store-schema', 'persistent nonce store schema is unsupported');
  boundedText(store.storeId, 'persistent storeId', { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
  exactSha256(store.policyIdentity, 'persistent store policy identity');
  exactSha256(store.controllerIdentity, 'persistent store controller identity');
  if (store.policyIdentity !== ROUTE_REAL_GRAPH_BUILD_POLICY_IDENTITY) fail('persistent-store-policy-drift', 'persistent store policy identity drifted');
  const paths = deriveControllerStatePaths(store.workspaceRootAbsolute);
  assertControllerExactPath(store.ledgerAbsolutePath, paths.ledgerAbsolutePath, 'persistent ledger path');
  exactTimestamp(store.snapshotObservedAt, 'persistent store snapshotObservedAt');
  boundedText(store.snapshotFileIdentity, 'persistent store snapshotFileIdentity', { max: 160, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
  exactSha256(store.snapshotSha256, 'persistent store snapshot SHA-256');
  exactNonNegativeByteCount(store.snapshotByteCount, 'persistent store snapshot byte count');
  exactOptionalSha256(store.predecessorClaimIdentity, 'persistent store predecessor claim identity');
  exactTrue(store.closedBeforeObservation, 'persistent store closedBeforeObservation');
  exactTrue(store.completeByteTraversal, 'persistent store completeByteTraversal');
  exactFalse(store.reparsePoint, 'persistent store reparsePoint');
  exactTrue(store.exclusiveNoReplaceReservationRequired, 'persistent store exclusiveNoReplaceReservationRequired');
  exactTrue(store.reservationFileFlushRequired, 'persistent store reservationFileFlushRequired');
  exactTrue(store.parentDirectoryDurabilityRequired, 'persistent store parentDirectoryDurabilityRequired');
  admitPersistentRecords(store.records, store);
  if (canonicalStringify(store.claims) !== canonicalStringify(CONTROLLER_CLAIMS)) fail('controller-claims-drift', 'persistent store claim changed the source-only boundary');
  if (canonicalStringify(store.limitations) !== canonicalStringify(CONTROLLER_LIMITATIONS)) fail('controller-limitations-drift', 'persistent store claim limitations drifted');
  return freezeData(store, 'validated caller persistent nonce store claim');
}

export function persistentNonceStoreClaimIdentity(jsonText) {
  if (arguments.length !== 1) fail('persistent-store-identity-arguments', 'persistent-store identity accepts one JSON text argument');
  return contentIdentity(parsePersistentNonceStoreClaim(jsonText));
}

export function assertNonceAbsentFromPersistentStore(
  persistentStoreClaimJsonText,
  nonce,
  releaseIdentity,
  leaseIdentity,
  controllerIdentity,
) {
  if (
    arguments.length !== 5
    || typeof persistentStoreClaimJsonText !== 'string'
    || typeof nonce !== 'string'
    || typeof releaseIdentity !== 'string'
    || typeof leaseIdentity !== 'string'
    || typeof controllerIdentity !== 'string'
  ) fail('persistent-store-nonce-arguments', 'nonce lookup requires five primitive text arguments');
  const store = parsePersistentNonceStoreClaim(persistentStoreClaimJsonText);
  boundedText(nonce, 'reserved nonce', { max: 32, pattern: NONCE_PATTERN });
  exactSha256(releaseIdentity, 'nonce release identity');
  exactSha256(leaseIdentity, 'nonce lease identity');
  exactSha256(controllerIdentity, 'nonce controller identity');
  if (controllerIdentity !== store.controllerIdentity) fail('nonce-controller-drift', 'nonce controller identity differs from the persistent store');
  if (store.records.some((record) => (
    record.nonce === nonce
    || record.releaseIdentity === releaseIdentity
    || record.leaseIdentity === leaseIdentity
  ))) {
    fail('nonce-replay', 'the nonce, release, or lease already exists in durable persistent state and is permanently consumed');
  }
  return true;
}

export function admitPersistentNonceStoreTransition(
  predecessorClaimJsonText,
  successorClaimJsonText,
) {
  if (
    arguments.length !== 2
    || typeof predecessorClaimJsonText !== 'string'
    || typeof successorClaimJsonText !== 'string'
  ) fail('persistent-store-transition-arguments', 'persistent store transition requires two primitive JSON text arguments');
  const predecessor = parsePersistentNonceStoreClaim(predecessorClaimJsonText);
  const successor = parsePersistentNonceStoreClaim(successorClaimJsonText);
  const predecessorClaimIdentity = contentIdentity(predecessor);
  if (
    successor.predecessorClaimIdentity !== predecessorClaimIdentity
    || successor.storeId !== predecessor.storeId
    || successor.policyIdentity !== predecessor.policyIdentity
    || successor.workspaceRootAbsolute !== predecessor.workspaceRootAbsolute
    || successor.ledgerAbsolutePath !== predecessor.ledgerAbsolutePath
    || successor.controllerIdentity !== predecessor.controllerIdentity
    || successor.snapshotFileIdentity !== predecessor.snapshotFileIdentity
  ) fail('persistent-store-transition-lineage', 'persistent store successor must identify the exact predecessor and same ledger');
  if (Date.parse(successor.snapshotObservedAt) <= Date.parse(predecessor.snapshotObservedAt)) {
    fail('persistent-store-transition-clock', 'persistent store successor observation must strictly follow its predecessor');
  }
  if (successor.records.length <= predecessor.records.length) {
    fail('persistent-store-transition-records', 'persistent store successor must append at least one durable record');
  }
  for (const [index, record] of predecessor.records.entries()) {
    if (canonicalStringify(successor.records[index]) !== canonicalStringify(record)) {
      fail('persistent-store-transition-prefix', 'persistent store successor must preserve every predecessor record as a canonical prefix');
    }
  }
  const appendedRecords = successor.records.slice(predecessor.records.length);
  for (const record of appendedRecords) {
    if (Date.parse(record.recordedAt) <= Date.parse(predecessor.snapshotObservedAt)) {
      fail('persistent-store-transition-record-clock', 'each appended record must strictly follow the predecessor snapshot observation');
    }
  }
  const projection = {
    schema: 'route-real-graph-persistent-nonce-store-transition/v2',
    predecessorClaimIdentity,
    successorClaimIdentity: contentIdentity(successor),
    storeId: successor.storeId,
    ledgerAbsolutePath: successor.ledgerAbsolutePath,
    snapshotFileIdentity: successor.snapshotFileIdentity,
    predecessorObservedAt: predecessor.snapshotObservedAt,
    successorObservedAt: successor.snapshotObservedAt,
    appendedRecordIdentities: appendedRecords.map((record) => contentIdentity(record)),
  };
  return freezeData({
    ...projection,
    transitionIdentity: contentIdentity(projection),
  }, 'validated caller persistent nonce store transition');
}

function admitPersistentRecords(value, store) {
  if (!Array.isArray(value) || value.length > 2_048) fail('persistent-store-records', 'persistent store records must be a bounded array');
  let previousOrdinal = 0;
  let previousRecordedAt = null;
  const lastRecordByNonce = new Map();
  const nonceByReleaseIdentity = new Map();
  const nonceByLeaseIdentity = new Map();
  for (const [index, raw] of value.entries()) {
    const record = exactDataObject(raw, [
      'ordinal', 'phaseOrdinal', 'consumptionOrdinal', 'nonce', 'releaseIdentity', 'leaseIdentity', 'controllerIdentity',
      'phaseSlot', 'phasePlanIdentity', 'phaseResultIdentity',
      'phase', 'recordedAt', 'durableState', 'stateFileFlushed',
      'parentDirectoryDurable', 'retryUsed', 'fallbackUsed',
    ], `persistent nonce record ${index}`);
    if (!Number.isSafeInteger(record.ordinal) || record.ordinal !== previousOrdinal + 1) fail('persistent-record-ordinal', 'persistent store record ordinals must be contiguous and one-based');
    previousOrdinal = record.ordinal;
    if (!Number.isSafeInteger(record.phaseOrdinal) || record.phaseOrdinal < 1) fail('persistent-record-phase-ordinal', 'persistent nonce phase ordinals must be positive safe integers');
    if (record.consumptionOrdinal !== 1) fail('persistent-record-consumption-ordinal', 'one-shot persistent nonce consumption ordinal must equal one');
    boundedText(record.nonce, `persistent nonce record ${index}.nonce`, { max: 32, pattern: NONCE_PATTERN });
    exactSha256(record.releaseIdentity, `persistent nonce record ${index}.releaseIdentity`);
    exactSha256(record.leaseIdentity, `persistent nonce record ${index}.leaseIdentity`);
    if (
      (nonceByReleaseIdentity.has(record.releaseIdentity)
        && nonceByReleaseIdentity.get(record.releaseIdentity) !== record.nonce)
      || (nonceByLeaseIdentity.has(record.leaseIdentity)
        && nonceByLeaseIdentity.get(record.leaseIdentity) !== record.nonce)
    ) fail('persistent-record-release-lease-alias', 'release and lease identities must each bind exactly one nonce across the ledger');
    nonceByReleaseIdentity.set(record.releaseIdentity, record.nonce);
    nonceByLeaseIdentity.set(record.leaseIdentity, record.nonce);
    exactSha256(record.controllerIdentity, `persistent nonce record ${index}.controllerIdentity`);
    if (record.controllerIdentity !== store.controllerIdentity) fail('persistent-record-controller-drift', 'persistent nonce record controller identity drifted');
    if (record.phaseSlot !== 'acquisition' && record.phaseSlot !== 'extraction') fail('persistent-record-phase-slot', 'persistent nonce record phase slot is unsupported');
    exactSha256(record.phasePlanIdentity, `persistent nonce record ${index}.phasePlanIdentity`);
    if (!PHASES.has(record.phase)) fail('persistent-record-phase', 'persistent nonce record phase is unsupported');
    if (record.phase === 'terminal-succeeded') {
      exactSha256(record.phaseResultIdentity, `persistent nonce record ${index}.phaseResultIdentity`);
    } else if (record.phaseResultIdentity !== null) {
      fail('persistent-record-result-state', 'only terminal-succeeded records may bind a phase result identity');
    }
    const recordedAt = exactTimestamp(record.recordedAt, `persistent nonce record ${index}.recordedAt`);
    if (Date.parse(recordedAt) >= Date.parse(store.snapshotObservedAt)) fail('persistent-record-clock', 'persistent nonce record must strictly precede the observed snapshot');
    if (previousRecordedAt !== null && Date.parse(recordedAt) <= Date.parse(previousRecordedAt)) {
      fail('persistent-record-clock-order', 'persistent nonce records must have strictly increasing clocks in ledger order');
    }
    previousRecordedAt = recordedAt;
    const predecessor = lastRecordByNonce.get(record.nonce);
    if (predecessor === undefined) {
      if (record.phaseOrdinal !== 1 || record.phase !== 'reserved') {
        fail('persistent-record-initial-phase', 'the first record for a nonce must be phaseOrdinal 1 reserved');
      }
    } else {
      if (TERMINAL_PHASES.has(predecessor.phase)) {
        fail('persistent-record-after-terminal', 'a terminal nonce state cannot have a successor record');
      }
      if (
        record.phaseOrdinal !== predecessor.phaseOrdinal + 1
        || record.releaseIdentity !== predecessor.releaseIdentity
        || record.leaseIdentity !== predecessor.leaseIdentity
        || record.controllerIdentity !== predecessor.controllerIdentity
        || record.phaseSlot !== predecessor.phaseSlot
        || record.phasePlanIdentity !== predecessor.phasePlanIdentity
        || record.consumptionOrdinal !== predecessor.consumptionOrdinal
      ) fail('persistent-record-sequence-binding', 'nonce event successors must preserve exact phase bindings and increment phaseOrdinal');
      if (!LEGAL_SUCCESSOR_PHASES.get(predecessor.phase)?.has(record.phase)) {
        fail('persistent-record-phase-transition', 'persistent nonce phase transition is not legal');
      }
    }
    lastRecordByNonce.set(record.nonce, record);
    exactTrue(record.durableState, `persistent nonce record ${index}.durableState`);
    exactTrue(record.stateFileFlushed, `persistent nonce record ${index}.stateFileFlushed`);
    exactTrue(record.parentDirectoryDurable, `persistent nonce record ${index}.parentDirectoryDurable`);
    exactFalse(record.retryUsed, `persistent nonce record ${index}.retryUsed`);
    exactFalse(record.fallbackUsed, `persistent nonce record ${index}.fallbackUsed`);
  }
}

function exactSha256(value, label) {
  return boundedText(value, label, { max: 71, pattern: SHA256_PATTERN });
}

function exactOptionalSha256(value, label) {
  if (value === null) return null;
  return exactSha256(value, label);
}

function exactNonNegativeByteCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-byte-count', `${label} must be a non-negative safe integer`);
}

function exactTrue(value, label) {
  if (value !== true) fail('boolean-true-required', `${label} must be true`);
}

function exactFalse(value, label) {
  if (value !== false) fail('boolean-false-required', `${label} must be false`);
}
