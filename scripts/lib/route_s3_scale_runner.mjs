import { createHash } from 'node:crypto';

import {
  admitRouteS3JoinedRecordBatch,
  buildRouteS3ScaleReport,
  createRouteS3AdmittedExecutionSession,
  executeRouteS3AdmittedRecord,
  isRouteS3ForcedAdmissionTestError,
} from './route_s3_harness.mjs';

export const ROUTE_S3_SCALE_RUNNER_VERSIONS = Object.freeze({
  checkpoint: 'engagement-route-s3-private-checkpoint/v1',
  combinedCheckpoint: 'engagement-route-s3-private-combined-checkpoint/v1',
  manifestCompanion: 'engagement-route-s3-private-manifest-companion/v1',
  worklist: 'engagement-route-s3-private-worklist/v1',
});

export const ROUTE_S3_SCALE_CHUNK_MAX_RECORDS = 100;

const MAIN_EXPECTED_RECORDS = 5_000;
const CONFORMANCE_EXPECTED_RECORDS = 4;
const CANONICAL_JSON_VERSION = 'route-s3-canonical-json-sorted-object-keys/v1';
const EXTERNAL_CHECKPOINT_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 500_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 2_048,
});
const ROUTE_S3_SCALE_SESSION = Symbol('route-s3-scale-session');
const PERFORMANCE_DIAGNOSTIC = Object.freeze({
  measurementStatus: 'measurement-not-enabled',
  performanceSamples: 0,
  interpretation: 'diagnostic-only-no-performance-claim-eligible-in-v1',
});

function fail(message) {
  throw new TypeError(message);
}

function assertPlainSerializableTree(root, label = 'value', limits = EXTERNAL_CHECKPOINT_LIMITS) {
  const stack = [{ value: root, label, depth: 0 }];
  const seen = new WeakSet();
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const { value } = current;
    visited += 1;
    if (visited > limits.maxNodes) fail(`${label} exceeds the external checkpoint node limit`);
    if (current.depth > limits.maxDepth) fail(`${current.label} exceeds the external checkpoint depth limit`);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail(`${current.label} must contain only finite JSON numbers`);
      continue;
    }
    if (typeof value !== 'object') fail(`${current.label} must be plain JSON-serializable data`);
    if (seen.has(value)) fail(`${current.label} contains a cycle or repeated reference`);
    seen.add(value);
    let prototype;
    let keys;
    try {
      prototype = Reflect.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
    } catch {
      fail(`${current.label} must be inspectable plain JSON-serializable data`);
    }
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) fail(`${current.label} must be a plain array`);
      let lengthDescriptor;
      try {
        lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
      } catch {
        fail(`${current.label}.length must be an inspectable data property`);
      }
      if (!lengthDescriptor
        || 'get' in lengthDescriptor
        || 'set' in lengthDescriptor
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0) fail(`${current.label}.length must be a nonnegative integer data property`);
      const arrayLength = lengthDescriptor.value;
      if (arrayLength > limits.maxArrayLength) fail(`${current.label} exceeds the external checkpoint array limit`);
      const indexKeys = keys.filter((key) => key !== 'length');
      if (indexKeys.length !== arrayLength) fail(`${current.label} must not be sparse`);
      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
          fail(`${current.label} contains a non-index array property`);
        }
        let descriptor;
        try {
          descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        } catch {
          fail(`${current.label}[${key}] must be an inspectable data property`);
        }
        if (!descriptor || 'get' in descriptor || 'set' in descriptor) {
          fail(`${current.label}[${key}] must not be an accessor`);
        }
        stack.push({ value: descriptor.value, label: `${current.label}[${key}]`, depth: current.depth + 1 });
      }
      continue;
    }
    if (prototype !== Object.prototype && prototype !== null) fail(`${current.label} must be a plain object`);
    if (keys.length > limits.maxObjectKeys) fail(`${current.label} exceeds the external checkpoint object-key limit`);
    for (const key of keys) {
      if (typeof key !== 'string') fail(`${current.label} must not contain symbol keys`);
      let descriptor;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        fail(`${current.label}.${key} must be an inspectable data property`);
      }
      if (!descriptor || 'get' in descriptor || 'set' in descriptor) {
        fail(`${current.label}.${key} must not be an accessor`);
      }
      if (!descriptor.enumerable) fail(`${current.label}.${key} must be an enumerable JSON property`);
      stack.push({ value: descriptor.value, label: `${current.label}.${key}`, depth: current.depth + 1 });
    }
  }
  return root;
}

function clonePlainData(value, label) {
  assertPlainSerializableTree(value, label);
  try {
    return structuredClone(value);
  } catch {
    fail(`${label} must be detached JSON-serializable data`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  const stack = [value];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const key of Object.keys(current)) stack.push(current[key]);
    Object.freeze(current);
  }
  return value;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function recordKey(runId, denominatorKind, scenarioId, configurationId, profileId) {
  return `${runId}:${denominatorKind}:${scenarioId}:${configurationId}:${profileId}`;
}

function graphIdentity(run) {
  return {
    scopeKind: run.graphScope.scopeKind,
    graphId: run.graphScope.graphArtifact.graphId,
    artifactVersion: run.graphScope.graphArtifact.receipt.artifactVersion,
    graphContentIdentity: structuredClone(run.graphScope.graphContentIdentity),
  };
}

function buildMainWorklist(run) {
  const worklist = [];
  for (const pair of run.protocol.cohort.odPairs) {
    for (const configuration of run.configurationExecutions) {
      if (!pair.configurationIds.includes(configuration.configurationId)) {
        fail('admitted OD/configuration membership drifted while building the S3 worklist');
      }
      const index = worklist.length;
      worklist.push({
        index,
        denominatorKind: 'main',
        scenarioId: pair.odPairId,
        configurationId: configuration.configurationId,
        profileId: pair.profileId,
        recordKey: recordKey(
          run.runId,
          'main',
          pair.odPairId,
          configuration.configurationId,
          pair.profileId,
        ),
      });
    }
  }
  if (run.protocol.cohort.odPairs.length !== 1_000 || worklist.length !== MAIN_EXPECTED_RECORDS) {
    fail('S3 main worklist must contain exactly 1,000 OD by five configurations');
  }
  if (new Set(worklist.map(({ recordKey: key }) => key)).size !== MAIN_EXPECTED_RECORDS) {
    fail('S3 main worklist record keys must be unique');
  }
  return worklist;
}

function buildConformanceWorklist(run) {
  const worklist = run.protocol.cohort.conformanceProbes.map((probe, index) => ({
    index,
    denominatorKind: 'conformance',
    scenarioId: probe.probeId,
    configurationId: probe.configurationId,
    profileId: probe.profileId,
    recordKey: recordKey(run.runId, 'conformance', probe.probeId, probe.configurationId, probe.profileId),
  }));
  if (worklist.length !== CONFORMANCE_EXPECTED_RECORDS
    || worklist.some((item) => item.denominatorKind !== 'conformance')) {
    fail('S3 conformance worklist must contain exactly four separate probes');
  }
  return worklist;
}

function sessionOf(session) {
  if (session?.[ROUTE_S3_SCALE_SESSION] !== true) fail('a Route S3 scale execution session is required');
  return session;
}

function identityOf(session) {
  return session.identity;
}

function contentDigest(value) {
  return {
    canonicalization: CANONICAL_JSON_VERSION,
    algorithm: 'sha256',
    value: digest(value),
    trustModel: 'content-identity-not-signature-or-authenticity',
  };
}

export function createRouteS3ScaleExecutionSession({ runManifest }) {
  const harnessSession = createRouteS3AdmittedExecutionSession({ runManifest });
  const { run } = harnessSession;
  const mainWorklist = buildMainWorklist(run);
  const conformanceWorklist = buildConformanceWorklist(run);
  const worklistIdentity = {
    schemaVersion: ROUTE_S3_SCALE_RUNNER_VERSIONS.worklist,
    order: 'admitted-od-then-admitted-configuration-execution/v1',
    expectedRecords: MAIN_EXPECTED_RECORDS,
    recordKeyDigest: digest(mainWorklist.map(({ recordKey: key }) => key)),
  };
  const identity = deepFreeze({
    runId: run.runId,
    protocolId: run.protocolId,
    graphIdentity: graphIdentity(run),
    worklistIdentity,
    runManifestIdentity: {
      canonicalization: CANONICAL_JSON_VERSION,
      digestAlgorithm: 'sha256',
      digest: digest(run),
      executionIdentity: structuredClone(run.executionIdentity),
      referenceEnvironment: structuredClone(run.referenceEnvironment),
    },
  });
  return Object.freeze({
    [ROUTE_S3_SCALE_SESSION]: true,
    harnessSession,
    identity,
    mainWorklist: deepFreeze(mainWorklist),
    conformanceWorklist: deepFreeze(conformanceWorklist),
  });
}

export function exportRouteS3AdmittedManifestCompanion(session) {
  const admittedSession = sessionOf(session);
  return sealEnvelope({
    schemaVersion: ROUTE_S3_SCALE_RUNNER_VERSIONS.manifestCompanion,
    artifactKind: 'admitted-run-manifest-companion',
    identity: identityOf(admittedSession),
    admittedRunManifest: admittedSession.harnessSession.run,
    persistenceSemantics: 'caller-owned-json-artifact-no-filesystem-durability-or-atomicity',
  });
}

export function getRouteS3ScaleWorklist(session) {
  const admittedSession = sessionOf(session);
  return deepFreeze(structuredClone({
    identity: identityOf(admittedSession),
    main: admittedSession.mainWorklist,
    conformance: admittedSession.conformanceWorklist,
  }));
}

function performanceDiagnostic() {
  return { ...PERFORMANCE_DIAGNOSTIC };
}

function sealEnvelope(body) {
  const detachedBody = structuredClone(body);
  return deepFreeze({
    ...detachedBody,
    contentDigest: contentDigest(detachedBody),
  });
}

function executeWorkItem(session, workItem, forceAdmissionFailure) {
  return executeRouteS3AdmittedRecord({
    session: session.harnessSession,
    denominatorKind: workItem.denominatorKind,
    scenarioId: workItem.scenarioId,
    configurationId: workItem.configurationId,
    forceAdmissionFailure,
  });
}

function checkedInteger(value, label, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} is outside its integer bounds`);
  return value;
}

function errorDetails(error, failedIndex, failedRecordKey, failureSource, faultInjectionUsed) {
  return {
    code: 'record-execution-failed',
    failedIndex,
    failedRecordKey,
    name: String(error?.name ?? 'Error').slice(0, 120),
    message: String(error?.message ?? error ?? 'record execution failed').slice(0, 500),
    failureSource,
    faultInjectionUsed,
    retryAttempted: false,
    fallbackAttempted: false,
  };
}

function runWorkItems({
  session,
  worklist,
  startIndex,
  targetEndIndex,
  beforeRecord,
  forceAdmissionFailureAtIndex,
}) {
  const records = [];
  let failure = null;
  for (let index = startIndex; index < targetEndIndex; index += 1) {
    const workItem = worklist[index];
    if (beforeRecord) {
      try {
        beforeRecord({ workItem });
      } catch (error) {
        failure = errorDetails(error, index, workItem.recordKey, 'before-record-hook', true);
        break;
      }
    }
    try {
      const result = executeWorkItem(session, workItem, index === forceAdmissionFailureAtIndex);
      const admittedRecord = result.joinedRecord;
      if (admittedRecord.primaryExecution.attemptState !== 'terminal'
        || admittedRecord.replayExecution.attemptState !== 'terminal') {
        fail('Route S3 chunks may checkpoint only terminal primary/replay records');
      }
      records.push(admittedRecord);
    } catch (error) {
      const forcedAdmissionTest = isRouteS3ForcedAdmissionTestError(error);
      failure = errorDetails(
        error,
        index,
        workItem.recordKey,
        forcedAdmissionTest ? 'forced-admission-test' : 'record-execution',
        forcedAdmissionTest,
      );
      break;
    }
  }
  return { records, failure };
}

function admittedRecordsFor(session, denominatorKind, candidates) {
  const collection = admitRouteS3JoinedRecordBatch({
    session: session.harnessSession,
    mainRecordCandidates: denominatorKind === 'main' ? candidates : [],
    conformanceRecordCandidates: denominatorKind === 'conformance' ? candidates : [],
  });
  return denominatorKind === 'main' ? collection.mainRecords : collection.conformanceRecords;
}

function assertCompletedPrefixKeys(worklist, startIndex, records) {
  const expectedKeys = worklist
    .slice(startIndex, startIndex + records.length)
    .map(({ recordKey: key }) => key);
  if (!same(records.map(({ recordKey: key }) => key), expectedKeys)) {
    fail('Route S3 record execution returned a non-prefix or reordered record');
  }
}

function checkpointBody({
  session,
  kind,
  startIndex,
  targetEndIndex,
  expectedRecords,
  requestedMaxRecords,
  previousCheckpointDigest,
  records,
  failure,
}) {
  const endIndex = startIndex + records.length;
  const mainComplete = kind === 'main-chunk'
    && startIndex === 0
    && endIndex === MAIN_EXPECTED_RECORDS
    && failure === null;
  const conformanceComplete = kind === 'conformance-batch'
    && endIndex === CONFORMANCE_EXPECTED_RECORDS
    && failure === null;
  return {
    schemaVersion: ROUTE_S3_SCALE_RUNNER_VERSIONS.checkpoint,
    checkpointKind: kind,
    identity: identityOf(session),
    startIndex,
    targetEndIndex,
    endIndex,
    nextIndex: endIndex,
    expectedRecords,
    requestedMaxRecords,
    previousCheckpointDigest,
    rangeStatus: failure === null ? 'complete' : 'stopped-on-error',
    failureSource: failure?.failureSource ?? null,
    faultInjectionUsed: failure?.faultInjectionUsed ?? false,
    mainComplete,
    conformanceComplete,
    evidenceComplete: false,
    partialRun: !mainComplete,
    emittedClaimCodes: [],
    orderedRecordKeys: records.map(({ recordKey: key }) => key),
    joinedRecords: records,
    error: failure,
    performance: performanceDiagnostic(),
  };
}

function runMainChunk({
  session,
  startIndex,
  maxRecords,
  beforeRecord = null,
  forceAdmissionFailureAtIndex = null,
  errorMode = 'return-checkpoint',
  previousCheckpointDigest = null,
}) {
  const admittedSession = sessionOf(session);
  const start = checkedInteger(startIndex, 'startIndex', { min: 0, max: MAIN_EXPECTED_RECORDS - 1 });
  const boundedMax = checkedInteger(maxRecords, 'maxRecords', { min: 1, max: ROUTE_S3_SCALE_CHUNK_MAX_RECORDS });
  const targetEndIndex = Math.min(MAIN_EXPECTED_RECORDS, start + boundedMax);
  if (beforeRecord !== null && typeof beforeRecord !== 'function') fail('beforeRecord must be a function or null');
  if (forceAdmissionFailureAtIndex !== null) {
    checkedInteger(forceAdmissionFailureAtIndex, 'forceAdmissionFailureAtIndex', {
      min: start,
      max: targetEndIndex - 1,
    });
  }
  if (!['return-checkpoint', 'throw-with-checkpoint'].includes(errorMode)) fail('errorMode is unsupported');
  const { records, failure } = runWorkItems({
    session: admittedSession,
    worklist: admittedSession.mainWorklist,
    startIndex: start,
    targetEndIndex,
    beforeRecord,
    forceAdmissionFailureAtIndex,
  });
  assertCompletedPrefixKeys(admittedSession.mainWorklist, start, records);
  const checkpoint = sealEnvelope(checkpointBody({
    session: admittedSession,
    kind: 'main-chunk',
    startIndex: start,
    targetEndIndex,
    expectedRecords: MAIN_EXPECTED_RECORDS,
    requestedMaxRecords: boundedMax,
    previousCheckpointDigest,
    records,
    failure,
  }));
  if (failure && errorMode === 'throw-with-checkpoint') {
    const error = new Error('Route S3 chunk execution stopped on a record error');
    error.name = 'RouteS3ChunkExecutionError';
    error.checkpoint = checkpoint;
    throw error;
  }
  return checkpoint;
}


export function runRouteS3MainChunk(options) {
  return runMainChunk({ ...options, previousCheckpointDigest: null });
}

export function runRouteS3Conformance({
  session,
  beforeRecord = null,
  forceAdmissionFailureAtIndex = null,
  errorMode = 'return-checkpoint',
}) {
  const admittedSession = sessionOf(session);
  if (beforeRecord !== null && typeof beforeRecord !== 'function') fail('beforeRecord must be a function or null');
  if (forceAdmissionFailureAtIndex !== null) {
    checkedInteger(forceAdmissionFailureAtIndex, 'forceAdmissionFailureAtIndex', {
      min: 0,
      max: CONFORMANCE_EXPECTED_RECORDS - 1,
    });
  }
  if (!['return-checkpoint', 'throw-with-checkpoint'].includes(errorMode)) fail('errorMode is unsupported');
  const { records, failure } = runWorkItems({
    session: admittedSession,
    worklist: admittedSession.conformanceWorklist,
    startIndex: 0,
    targetEndIndex: CONFORMANCE_EXPECTED_RECORDS,
    beforeRecord,
    forceAdmissionFailureAtIndex,
  });
  assertCompletedPrefixKeys(admittedSession.conformanceWorklist, 0, records);
  const checkpoint = sealEnvelope(checkpointBody({
    session: admittedSession,
    kind: 'conformance-batch',
    startIndex: 0,
    targetEndIndex: CONFORMANCE_EXPECTED_RECORDS,
    expectedRecords: CONFORMANCE_EXPECTED_RECORDS,
    requestedMaxRecords: CONFORMANCE_EXPECTED_RECORDS,
    previousCheckpointDigest: null,
    records,
    failure,
  }));
  if (failure && errorMode === 'throw-with-checkpoint') {
    const error = new Error('Route S3 conformance execution stopped on a record error');
    error.name = 'RouteS3ConformanceExecutionError';
    error.checkpoint = checkpoint;
    throw error;
  }
  return checkpoint;
}

function assertExactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (!same(keys, sortedExpected)) fail(`${label} has an unsupported shape`);
}

function assertExternalTopLevelShape(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a plain object`);
  let prototype;
  let keys;
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(`${label} must be inspectable plain data`);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== 'string')) {
    fail(`${label} has an unsupported shape`);
  }
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || 'get' in descriptor || 'set' in descriptor) fail(`${label}.${String(key)} must not be an accessor`);
  }
  assertExactKeys(value, expected, label);
}

function validateCheckpoint(session, checkpoint, expectedKind) {
  const checkpointKeys = [
    'schemaVersion', 'checkpointKind', 'identity', 'startIndex', 'targetEndIndex',
    'endIndex', 'nextIndex', 'expectedRecords', 'requestedMaxRecords', 'previousCheckpointDigest',
    'rangeStatus', 'failureSource', 'faultInjectionUsed',
    'mainComplete', 'conformanceComplete', 'evidenceComplete', 'partialRun',
    'emittedClaimCodes', 'orderedRecordKeys', 'joinedRecords', 'error', 'performance', 'contentDigest',
  ];
  assertExternalTopLevelShape(checkpoint, checkpointKeys, 'Route S3 checkpoint');
  const value = clonePlainData(checkpoint, 'Route S3 checkpoint');
  if (value.schemaVersion !== ROUTE_S3_SCALE_RUNNER_VERSIONS.checkpoint
    || value.checkpointKind !== expectedKind) fail('Route S3 checkpoint version or kind drifted');
  if (!same(value.identity, identityOf(session))) fail('Route S3 checkpoint run/protocol/graph/worklist identity drifted');
  assertExactKeys(
    value.contentDigest,
    ['canonicalization', 'algorithm', 'value', 'trustModel'],
    'Route S3 checkpoint contentDigest',
  );
  const { contentDigest, ...body } = value;
  if (contentDigest.canonicalization !== CANONICAL_JSON_VERSION
    || contentDigest.algorithm !== 'sha256'
    || contentDigest.trustModel !== 'content-identity-not-signature-or-authenticity'
    || contentDigest.value !== digest(body)) {
    fail('Route S3 checkpoint content digest mismatch');
  }
  const expectedRecords = expectedKind === 'main-chunk' ? MAIN_EXPECTED_RECORDS : CONFORMANCE_EXPECTED_RECORDS;
  const maxChunk = expectedKind === 'main-chunk' ? ROUTE_S3_SCALE_CHUNK_MAX_RECORDS : CONFORMANCE_EXPECTED_RECORDS;
  checkedInteger(value.startIndex, 'checkpoint.startIndex', { min: 0, max: expectedRecords - 1 });
  checkedInteger(value.requestedMaxRecords, 'checkpoint.requestedMaxRecords', { min: 1, max: maxChunk });
  if (value.previousCheckpointDigest !== null
    && (typeof value.previousCheckpointDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.previousCheckpointDigest))) {
    fail('Route S3 checkpoint previous digest is invalid');
  }
  if (value.expectedRecords !== expectedRecords
    || value.targetEndIndex !== Math.min(expectedRecords, value.startIndex + value.requestedMaxRecords)
    || value.endIndex !== value.startIndex + value.joinedRecords.length
    || value.nextIndex !== value.endIndex
    || value.endIndex > value.targetEndIndex) fail('Route S3 checkpoint range metadata drifted');
  if (value.rangeStatus === 'complete') {
    if (value.error !== null
      || value.failureSource !== null
      || value.faultInjectionUsed !== false
      || value.endIndex !== value.targetEndIndex) fail('Route S3 completed range is inconsistent');
  } else if (value.rangeStatus === 'stopped-on-error') {
    assertExactKeys(value.error, [
      'code', 'failedIndex', 'failedRecordKey', 'name', 'message',
      'failureSource', 'faultInjectionUsed', 'retryAttempted', 'fallbackAttempted',
    ], 'Route S3 checkpoint error');
    const faultSource = value.error.failureSource === 'before-record-hook'
      || value.error.failureSource === 'forced-admission-test';
    if (value.error?.code !== 'record-execution-failed'
      || value.error.failedIndex !== value.endIndex
      || value.error.failedRecordKey !== (expectedKind === 'main-chunk'
        ? session.mainWorklist[value.endIndex]?.recordKey
        : session.conformanceWorklist[value.endIndex]?.recordKey)
      || value.error.retryAttempted !== false
      || value.error.fallbackAttempted !== false
      || !['record-execution', 'before-record-hook', 'forced-admission-test'].includes(value.error.failureSource)
      || value.error.faultInjectionUsed !== faultSource
      || value.failureSource !== value.error.failureSource
      || value.faultInjectionUsed !== value.error.faultInjectionUsed) {
      fail('Route S3 stopped range error truth drifted');
    }
  } else fail('Route S3 checkpoint rangeStatus is unsupported');
  const computedMainComplete = expectedKind === 'main-chunk'
    && value.startIndex === 0
    && value.endIndex === MAIN_EXPECTED_RECORDS
    && value.error === null;
  const computedConformanceComplete = expectedKind === 'conformance-batch'
    && value.endIndex === CONFORMANCE_EXPECTED_RECORDS
    && value.error === null;
  if (value.mainComplete !== computedMainComplete
    || value.conformanceComplete !== computedConformanceComplete
    || value.evidenceComplete !== false
    || value.partialRun !== !computedMainComplete) {
    fail('Route S3 checkpoint complete/partial truth drifted');
  }
  if (!same(value.emittedClaimCodes, [])) fail('Route S3 checkpoint must not emit claims');
  if (!same(value.performance, PERFORMANCE_DIAGNOSTIC)) fail('Route S3 checkpoint performance truth drifted');
  const expectedWorklist = expectedKind === 'main-chunk' ? session.mainWorklist : session.conformanceWorklist;
  const expectedKeys = expectedWorklist
    .slice(value.startIndex, value.endIndex)
    .map(({ recordKey: key }) => key);
  if (!same(value.orderedRecordKeys, expectedKeys)
    || !same(value.joinedRecords.map(({ recordKey: key }) => key), expectedKeys)) {
    fail('Route S3 checkpoint record order or keys drifted');
  }
  const records = admittedRecordsFor(
    session,
    expectedKind === 'main-chunk' ? 'main' : 'conformance',
    value.joinedRecords,
  );
  return {
    metadata: deepFreeze({
      startIndex: value.startIndex,
      endIndex: value.endIndex,
      nextIndex: value.nextIndex,
      previousCheckpointDigest: value.previousCheckpointDigest,
      rangeStatus: value.rangeStatus,
      failureSource: value.failureSource,
      faultInjectionUsed: value.faultInjectionUsed,
      mainComplete: value.mainComplete,
      conformanceComplete: value.conformanceComplete,
      error: value.error,
    }),
    contentDigest: value.contentDigest.value,
    records,
  };
}

function validateMainSequence(session, checkpoints) {
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) fail('at least one Route S3 main checkpoint is required');
  const records = [];
  const sourceChunkDigests = [];
  const digests = new Set();
  let nextIndex = 0;
  let previousDigest = null;
  let stoppedProvenance = null;
  for (const checkpoint of checkpoints) {
    const item = validateCheckpoint(session, checkpoint, 'main-chunk');
    if (item.metadata.startIndex !== nextIndex) fail('Route S3 main checkpoints contain a gap, overlap, or reorder');
    if (item.metadata.previousCheckpointDigest !== previousDigest) fail('Route S3 main checkpoint digest chain drifted');
    if (stoppedProvenance !== null) fail('Route S3 main checkpoints continue after a stopped run boundary');
    if (digests.has(item.contentDigest)) fail('Route S3 main checkpoints contain a duplicate');
    digests.add(item.contentDigest);
    records.push(...item.records);
    sourceChunkDigests.push(item.contentDigest);
    nextIndex = item.metadata.nextIndex;
    previousDigest = item.contentDigest;
    if (item.metadata.rangeStatus === 'stopped-on-error') {
      stoppedProvenance = {
        checkpointDigest: item.contentDigest,
        startIndex: item.metadata.startIndex,
        endIndex: item.metadata.endIndex,
        failureSource: item.metadata.failureSource,
        faultInjectionUsed: item.metadata.faultInjectionUsed,
        error: item.metadata.error,
      };
    }
    if (item.metadata.mainComplete && sourceChunkDigests.length !== checkpoints.length) {
      fail('Route S3 main checkpoints continue after completion');
    }
  }
  if (new Set(records.map(({ recordKey: key }) => key)).size !== records.length) {
    fail('Route S3 main checkpoints contain duplicate record keys');
  }
  return { records, sourceChunkDigests, nextIndex, previousDigest, stoppedProvenance };
}

export function resumeRouteS3MainChunks({
  session,
  previousCheckpoint,
  maxRecords,
  beforeRecord = null,
  errorMode = 'return-checkpoint',
}) {
  const admittedSession = sessionOf(session);
  const tail = validateCheckpoint(admittedSession, previousCheckpoint, 'main-chunk');
  if (tail.metadata.rangeStatus === 'stopped-on-error') {
    fail('Route S3 stopped run cannot resume; a new runId is required');
  }
  if (tail.metadata.nextIndex >= MAIN_EXPECTED_RECORDS) fail('Route S3 main run is already complete');
  return runMainChunk({
    session: admittedSession,
    startIndex: tail.metadata.nextIndex,
    maxRecords,
    beforeRecord,
    errorMode,
    previousCheckpointDigest: tail.contentDigest,
  });
}

export function combineRouteS3ScaleCheckpoints({
  session,
  mainCheckpoints,
  conformanceCheckpoint = null,
}) {
  const admittedSession = sessionOf(session);
  const mainSequence = validateMainSequence(admittedSession, mainCheckpoints);
  let conformanceRecords = [];
  let conformanceDigest = null;
  if (conformanceCheckpoint !== null) {
    const conformance = validateCheckpoint(admittedSession, conformanceCheckpoint, 'conformance-batch');
    if (!conformance.metadata.conformanceComplete || conformance.records.length !== CONFORMANCE_EXPECTED_RECORDS) {
      fail('Route S3 conformance checkpoint must contain all four terminal probes before merge');
    }
    conformanceRecords = conformance.records;
    conformanceDigest = conformance.contentDigest;
  }
  const report = buildRouteS3ScaleReport({
    session: admittedSession.harnessSession,
    mainRecords: mainSequence.records,
    conformanceRecords,
  });
  const mainComplete = mainSequence.nextIndex === MAIN_EXPECTED_RECORDS
    && mainSequence.records.length === MAIN_EXPECTED_RECORDS
    && mainSequence.stoppedProvenance === null;
  const conformanceComplete = conformanceRecords.length === CONFORMANCE_EXPECTED_RECORDS;
  const evidenceComplete = mainComplete && conformanceComplete;
  if (report.disclosures.partialRun === mainComplete) fail('Route S3 combined report partial truth drifted');
  return sealEnvelope({
    schemaVersion: ROUTE_S3_SCALE_RUNNER_VERSIONS.combinedCheckpoint,
    checkpointKind: 'main-combined',
    identity: identityOf(admittedSession),
    startIndex: 0,
    endIndex: mainSequence.nextIndex,
    nextIndex: mainSequence.nextIndex,
    expectedRecords: MAIN_EXPECTED_RECORDS,
    mainComplete,
    conformanceComplete,
    evidenceComplete,
    partialRun: !mainComplete,
    partialEvidence: !evidenceComplete,
    stoppedProvenance: mainSequence.stoppedProvenance,
    ledgerSemantics: 'append-only-recovery-ledger-with-derived-report',
    orderedRecordKeys: mainSequence.records.map(({ recordKey: key }) => key),
    sourceChunkDigests: mainSequence.sourceChunkDigests,
    conformance: {
      expectedRecords: CONFORMANCE_EXPECTED_RECORDS,
      recorded: conformanceRecords.length,
      includedInMainCohort: false,
      sourceCheckpointDigest: conformanceDigest,
    },
    report,
    summary: {
      denominatorUnit: 'scenario-config-evaluation',
      mainExpected: MAIN_EXPECTED_RECORDS,
      mainRecorded: mainSequence.records.length,
      conformanceExpected: CONFORMANCE_EXPECTED_RECORDS,
      conformanceRecorded: conformanceRecords.length,
      emittedClaimCodes: [],
      performanceSamples: 0,
      performanceStatus: 'measurement-not-enabled',
      performanceInterpretation: 'diagnostic-only-no-performance-claim-eligible-in-v1',
    },
  });
}
