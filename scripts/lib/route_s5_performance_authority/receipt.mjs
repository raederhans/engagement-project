import { admitRouteDecisionIntegrationRun } from '../../../src/route_decision/integration/index.js';
import {
  canonicalStringify,
  contentIdentity,
  contractFail,
  deepFreeze,
  sameData,
  snapshotData,
} from '../../../src/route_decision/integration/contract_support.js';

import {
  ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL,
  ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS,
} from './protocol.mjs';

const RECEIPT_IDENTITY_VERSION = 'route-s5-performance-child-receipt-identity/v1';
const RECEIPT_CANONICALIZATION = 'route-s5-performance-child-receipt-canonical-json/v1';
const MAX_CARRIER_BYTES = 16 * 1024 * 1024;

function fail(message) {
  contractFail('Route S5 performance authority receipt', message);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort().join('\0');
  if (actual !== [...keys].sort().join('\0')) fail(`${label} must have exact keys: ${keys.join(', ')}`);
}

function exact(actual, expected, label) {
  if (!Object.is(actual, expected)) fail(`${label} must equal ${String(expected)}`);
}

function boundedId(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,255}$/u.test(value)) {
    fail(`${label} must be a bounded identifier`);
  }
}

function boundedText(value, label, maximum = 4_096) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    fail(`${label} must be bounded text`);
  }
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label} must be a safe integer >= ${minimum}`);
}

function timestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) fail(`${label} must be an exact ISO timestamp`);
}

function decimal(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/u.test(value)) {
    fail(`${label} must be an unsigned decimal string`);
  }
  return BigInt(value);
}

export function admitRouteS5PerformanceWorkloadCarrier(raw) {
  const value = snapshotData(raw, 'workload carrier', fail);
  exactKeys(value, ['schemaVersion', 'stratumId', 'runs'], 'workload carrier');
  const diagnostic = value.schemaVersion === ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.diagnosticWorkload;
  const formal = value.schemaVersion === ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.formalWorkload;
  if (!diagnostic && !formal) fail('workload carrier schemaVersion is unsupported');
  boundedId(value.stratumId, 'workload carrier.stratumId');
  if (!Array.isArray(value.runs) || value.runs.length < 1 || value.runs.length > 32) {
    fail('workload carrier.runs must contain 1..32 typed runs');
  }
  const runs = value.runs.map((run) => admitRouteDecisionIntegrationRun(run));
  return deepFreeze({
    schemaVersion: value.schemaVersion,
    stratumId: value.stratumId,
    runs,
  });
}

export function canonicalRouteS5PerformanceWorkloadCarrier(raw) {
  return canonicalStringify(admitRouteS5PerformanceWorkloadCarrier(raw));
}

export function receiptIdentity(receiptWithoutIdentity) {
  return contentIdentity(
    RECEIPT_IDENTITY_VERSION,
    RECEIPT_CANONICALIZATION,
    receiptWithoutIdentity,
  ).digest;
}

export function sealRouteS5PerformanceReceipt(raw) {
  const value = snapshotData(raw, 'unsealed child receipt', fail);
  if (Object.hasOwn(value, 'receiptIdentity')) fail('unsealed child receipt must not contain receiptIdentity');
  return deepFreeze({ ...value, receiptIdentity: receiptIdentity(value) });
}

function admitUnit(unit) {
  exactKeys(unit, ['unitOrdinal', 'stratumId', 'processClass', 'slots'], 'receipt.unit');
  safeInteger(unit.unitOrdinal, 'receipt.unit.unitOrdinal', 1);
  boundedId(unit.stratumId, 'receipt.unit.stratumId');
  boundedId(unit.processClass, 'receipt.unit.processClass');
  if (!Array.isArray(unit.slots) || unit.slots.length < 1 || unit.slots.length > 16) {
    fail('receipt.unit.slots must contain 1..16 slots');
  }
  let previousOrdinal = 0;
  for (const [index, slot] of unit.slots.entries()) {
    exactKeys(slot, ['ordinal', 'phase', 'phaseIndex', 'eligibility'], `receipt.unit.slots[${index}]`);
    safeInteger(slot.ordinal, `receipt.unit.slots[${index}].ordinal`, 1);
    safeInteger(slot.phaseIndex, `receipt.unit.slots[${index}].phaseIndex`, 1);
    if (slot.ordinal <= previousOrdinal) fail('receipt unit slot order must be strictly increasing');
    previousOrdinal = slot.ordinal;
    if (!['cold', 'warmup', 'warm', 'diagnostic'].includes(slot.phase)) fail('receipt unit phase is unsupported');
    if (!['measured-formal', 'excluded-warmup', 'excluded-diagnostic'].includes(slot.eligibility)) {
      fail('receipt unit eligibility is unsupported');
    }
  }
}

function admitEnvironment(environment) {
  exactKeys(environment, [
    'schemaVersion', 'platform', 'release', 'arch', 'nodeVersion', 'v8Version',
    'execPath', 'execArgv', 'cwd', 'hardware', 'isolation', 'environmentEntries',
  ], 'receipt.environment');
  exact(environment.schemaVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.environment, 'receipt.environment.schemaVersion');
  for (const key of ['platform', 'release', 'arch', 'nodeVersion', 'v8Version', 'execPath', 'cwd']) {
    boundedText(environment[key], `receipt.environment.${key}`);
  }
  if (!Array.isArray(environment.execArgv) || environment.execArgv.some((value) => typeof value !== 'string')) {
    fail('receipt.environment.execArgv must be a string array');
  }
  exactKeys(environment.hardware, [
    'cpuModels', 'logicalCpuCount', 'totalMemoryBytes',
  ], 'receipt.environment.hardware');
  if (!Array.isArray(environment.hardware.cpuModels)
    || environment.hardware.cpuModels.length < 1
    || environment.hardware.cpuModels.some((model) => typeof model !== 'string' || model.length < 1)) {
    fail('receipt.environment.hardware.cpuModels must be a non-empty string array');
  }
  safeInteger(environment.hardware.logicalCpuCount, 'receipt.environment.hardware.logicalCpuCount', 1);
  safeInteger(environment.hardware.totalMemoryBytes, 'receipt.environment.hardware.totalMemoryBytes', 1);
  exactKeys(environment.isolation, [
    'network', 'backgroundLoad', 'powerMode', 'processIsolation', 'authority',
  ], 'receipt.environment.isolation');
  exact(environment.isolation.network, 'not-measured-diagnostic', 'receipt.environment.isolation.network');
  exact(environment.isolation.backgroundLoad, 'not-measured-diagnostic', 'receipt.environment.isolation.backgroundLoad');
  exact(environment.isolation.powerMode, 'not-measured-diagnostic', 'receipt.environment.isolation.powerMode');
  exact(environment.isolation.processIsolation, 'fresh-child-capture-only', 'receipt.environment.isolation.processIsolation');
  exact(environment.isolation.authority, 'runner-captured-diagnostic-only', 'receipt.environment.isolation.authority');
  if (!Array.isArray(environment.environmentEntries)) fail('receipt.environment.environmentEntries must be an array');
  let previousKey = '';
  for (const [index, entry] of environment.environmentEntries.entries()) {
    exactKeys(entry, ['key', 'value'], `receipt.environment.environmentEntries[${index}]`);
    boundedText(entry.key, `receipt.environment.environmentEntries[${index}].key`, 128);
    if (typeof entry.value !== 'string' || entry.value.length > 32_768) fail('environment entry value is invalid');
    if (index > 0 && entry.key <= previousKey) fail('environment entries must be strictly code-unit sorted and unique');
    previousKey = entry.key;
  }
}

function admitCodeRevisionManifest(manifest) {
  exactKeys(manifest, [
    'schemaVersion', 'authority', 'nodeExecutable', 'modules', 'limitation',
  ], 'receipt.codeRevisionManifest');
  exact(
    manifest.schemaVersion,
    ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.codeRevisionManifest,
    'receipt.codeRevisionManifest.schemaVersion',
  );
  exact(
    manifest.authority,
    'runner-captured-diagnostic-not-main-owned',
    'receipt.codeRevisionManifest.authority',
  );
  exactKeys(manifest.nodeExecutable, ['execPath', 'nodeVersion', 'digest'], 'receipt.codeRevisionManifest.nodeExecutable');
  boundedText(manifest.nodeExecutable.execPath, 'receipt.codeRevisionManifest.nodeExecutable.execPath');
  boundedText(manifest.nodeExecutable.nodeVersion, 'receipt.codeRevisionManifest.nodeExecutable.nodeVersion');
  if (typeof manifest.nodeExecutable.digest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(manifest.nodeExecutable.digest)) {
    fail('receipt.codeRevisionManifest.nodeExecutable.digest is invalid');
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length !== 4) {
    fail('receipt.codeRevisionManifest.modules must contain exact four runner modules');
  }
  const expectedIds = ['childModule', 'protocolModule', 'receiptModule', 'runnerModule'];
  manifest.modules.forEach((module, index) => {
    exactKeys(module, ['moduleId', 'moduleUrl', 'digest'], `receipt.codeRevisionManifest.modules[${index}]`);
    exact(module.moduleId, expectedIds[index], `receipt.codeRevisionManifest.modules[${index}].moduleId`);
    boundedText(module.moduleUrl, `receipt.codeRevisionManifest.modules[${index}].moduleUrl`);
    if (typeof module.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(module.digest)) {
      fail(`receipt.codeRevisionManifest.modules[${index}].digest is invalid`);
    }
  });
  exact(
    manifest.limitation,
    'exact local bytes captured by this runner; not cryptographic signer, host authenticity, or integration/main-owned authority',
    'receipt.codeRevisionManifest.limitation',
  );
}

function admitProcessIdentity(identity) {
  exactKeys(identity, [
    'pid', 'ppid', 'execPath', 'nodeVersion', 'v8Version', 'platform', 'release', 'arch',
  ], 'receipt.processIdentity');
  safeInteger(identity.pid, 'receipt.processIdentity.pid', 1);
  safeInteger(identity.ppid, 'receipt.processIdentity.ppid', 1);
  for (const key of ['execPath', 'nodeVersion', 'v8Version', 'platform', 'release', 'arch']) {
    boundedText(identity[key], `receipt.processIdentity.${key}`);
  }
}

function admitTiming(timing, sample, sampleIndex) {
  const label = `receipt.samples[${sampleIndex}].timing`;
  exactKeys(timing, [
    'schemaVersion', 'clockSource', 'unit', 'availability', 'failureCode', 'stages',
    'totalDurationNanoseconds',
  ], label);
  exact(timing.schemaVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.timing, `${label}.schemaVersion`);
  exact(timing.clockSource, 'process.hrtime.bigint', `${label}.clockSource`);
  exact(timing.unit, 'nanoseconds', `${label}.unit`);
  if (!['available', 'unavailable'].includes(timing.availability)) fail(`${label}.availability is unsupported`);
  if (!Array.isArray(timing.stages) || timing.stages.length > ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.profiles[0].stages.length) {
    fail(`${label}.stages is invalid`);
  }
  let previousEnd = null;
  let total = 0n;
  for (const [index, stage] of timing.stages.entries()) {
    exactKeys(stage, ['stageId', 'startedNanoseconds', 'completedNanoseconds', 'durationNanoseconds'], `${label}.stages[${index}]`);
    exact(stage.stageId, ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.profiles[0].stages[index], `${label}.stages[${index}].stageId`);
    const started = decimal(stage.startedNanoseconds, `${label}.stages[${index}].startedNanoseconds`);
    const completed = decimal(stage.completedNanoseconds, `${label}.stages[${index}].completedNanoseconds`);
    const duration = decimal(stage.durationNanoseconds, `${label}.stages[${index}].durationNanoseconds`);
    if (completed < started || duration !== completed - started) fail(`${label} contains clock rollback or duration drift`);
    if (previousEnd !== null && started < previousEnd) fail(`${label} stage order is not monotonic`);
    previousEnd = completed;
    total += duration;
  }
  if (decimal(timing.totalDurationNanoseconds, `${label}.totalDurationNanoseconds`) !== total) {
    fail(`${label}.totalDurationNanoseconds is not recomputable`);
  }
  if (timing.availability === 'available') {
    exact(timing.failureCode, null, `${label}.failureCode`);
  } else {
    if (!['clock-throw', 'clock-rollback'].includes(timing.failureCode)) fail(`${label}.failureCode is unsupported`);
    exact(sample.outcome, 'failure', `${label} unavailable outcome`);
  }
}

function admitMemory(memory, sample, sampleIndex) {
  const label = `receipt.samples[${sampleIndex}].memory`;
  exactKeys(memory, [
    'schemaVersion', 'source', 'unit', 'semantics', 'availability', 'failureCode',
    'observations', 'rssDeltaBytes', 'heapUsedDeltaBytes',
  ], label);
  exact(memory.schemaVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.memory, `${label}.schemaVersion`);
  exact(memory.source, 'process.memoryUsage', `${label}.source`);
  exact(memory.unit, 'bytes', `${label}.unit`);
  exact(memory.semantics, 'baseline-and-each-completed-stage-boundary-max-minus-baseline-clamped-zero', `${label}.semantics`);
  if (!['available', 'unavailable'].includes(memory.availability)) fail(`${label}.availability is unsupported`);
  if (!Array.isArray(memory.observations) || memory.observations.length > 5) fail(`${label}.observations is invalid`);
  const expectedBoundaries = ['sample-baseline', ...sample.timing.stages.map(({ stageId }) => `${stageId}:completed`)];
  for (const [index, observation] of memory.observations.entries()) {
    exactKeys(observation, ['boundaryId', 'rssBytes', 'heapUsedBytes'], `${label}.observations[${index}]`);
    exact(observation.boundaryId, expectedBoundaries[index], `${label}.observations[${index}].boundaryId`);
    safeInteger(observation.rssBytes, `${label}.observations[${index}].rssBytes`);
    safeInteger(observation.heapUsedBytes, `${label}.observations[${index}].heapUsedBytes`);
  }
  if (memory.availability === 'available') {
    exact(memory.failureCode, null, `${label}.failureCode`);
    if (memory.observations.length !== expectedBoundaries.length || memory.observations.length === 0) {
      fail(`${label} must include baseline and every completed-stage boundary`);
    }
    const baseline = memory.observations[0];
    const rssDelta = Math.max(0, Math.max(...memory.observations.map(({ rssBytes }) => rssBytes)) - baseline.rssBytes);
    const heapDelta = Math.max(0, Math.max(...memory.observations.map(({ heapUsedBytes }) => heapUsedBytes)) - baseline.heapUsedBytes);
    exact(memory.rssDeltaBytes, rssDelta, `${label}.rssDeltaBytes`);
    exact(memory.heapUsedDeltaBytes, heapDelta, `${label}.heapUsedDeltaBytes`);
  } else {
    exact(memory.failureCode, 'memory-throw', `${label}.failureCode`);
    exact(memory.rssDeltaBytes, null, `${label}.rssDeltaBytes`);
    exact(memory.heapUsedDeltaBytes, null, `${label}.heapUsedDeltaBytes`);
    exact(sample.outcome, 'failure', `${label} unavailable outcome`);
  }
}

function admitSample(sample, slot, index, workloadRunCount) {
  const label = `receipt.samples[${index}]`;
  exactKeys(sample, [
    'schemaVersion', 'ordinal', 'phase', 'phaseIndex', 'eligibility', 'startedAt',
    'completedAt', 'outcome', 'errorCode', 'completedStageId', 'timing', 'memory',
    'workloadExecution',
  ], label);
  exact(sample.schemaVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.sample, `${label}.schemaVersion`);
  for (const key of ['ordinal', 'phase', 'phaseIndex', 'eligibility']) exact(sample[key], slot[key], `${label}.${key}`);
  timestamp(sample.startedAt, `${label}.startedAt`);
  timestamp(sample.completedAt, `${label}.completedAt`);
  if (Date.parse(sample.completedAt) < Date.parse(sample.startedAt)) fail(`${label} wall-clock completion precedes start`);
  if (!['success', 'failure', 'stopped'].includes(sample.outcome)) fail(`${label}.outcome is unsupported`);
  if (sample.outcome === 'success') exact(sample.errorCode, null, `${label}.errorCode`);
  else boundedId(sample.errorCode, `${label}.errorCode`);
  if (sample.completedStageId !== null
    && !ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.profiles[0].stages.includes(sample.completedStageId)) {
    fail(`${label}.completedStageId is unsupported`);
  }
  admitTiming(sample.timing, sample, index);
  admitMemory(sample.memory, sample, index);
  exactKeys(sample.workloadExecution, [
    'schemaVersion', 'preMeasurementCompletedPipelineRuns', 'timedStageOrder',
    'timedCompletedPipelineRuns', 'firstPipelineCompletionBoundary',
  ], `${label}.workloadExecution`);
  exact(
    sample.workloadExecution.schemaVersion,
    'route-s5-performance-workload-execution-trace/v1',
    `${label}.workloadExecution.schemaVersion`,
  );
  exact(
    sample.workloadExecution.preMeasurementCompletedPipelineRuns,
    0,
    `${label}.workloadExecution.preMeasurementCompletedPipelineRuns`,
  );
  if (!sameData(
    sample.workloadExecution.timedStageOrder,
    sample.timing.stages.map(({ stageId }) => stageId),
  )) fail(`${label}.workloadExecution timed stage order drifted`);
  const completedPipeline = sample.timing.stages.at(-1)?.stageId === 'adapter-output';
  if (completedPipeline) {
    safeInteger(
      sample.workloadExecution.timedCompletedPipelineRuns,
      `${label}.workloadExecution.timedCompletedPipelineRuns`,
      1,
    );
    exact(
      sample.workloadExecution.timedCompletedPipelineRuns,
      workloadRunCount,
      `${label}.workloadExecution.timedCompletedPipelineRuns`,
    );
    exact(
      sample.workloadExecution.firstPipelineCompletionBoundary,
      'adapter-output:inside-timing-window',
      `${label}.workloadExecution.firstPipelineCompletionBoundary`,
    );
  } else {
    exact(sample.workloadExecution.timedCompletedPipelineRuns, 0, `${label}.workloadExecution.timedCompletedPipelineRuns`);
    exact(sample.workloadExecution.firstPipelineCompletionBoundary, null, `${label}.workloadExecution.firstPipelineCompletionBoundary`);
  }
  const completedStageId = sample.timing.stages.at(-1)?.stageId ?? null;
  exact(sample.completedStageId, completedStageId, `${label}.completedStageId`);
  if (sample.outcome === 'success'
    && sample.timing.stages.length !== ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.profiles[0].stages.length) {
    fail(`${label} success requires all frozen stages`);
  }
}

export function admitRouteS5PerformanceReceiptConformance(raw) {
  const value = snapshotData(raw, 'child receipt', fail);
  exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'runnerVersion', 'sessionId', 'sessionNonce',
    'challenge', 'preregistrationIdentity', 'unit', 'workloadCarrierCanonicalJson',
    'processIdentity', 'environment', 'codeRevisionManifest', 'startedAt', 'completedAt', 'samples', 'truth',
    'receiptIdentity',
  ], 'child receipt');
  exact(value.schemaVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.receipt, 'child receipt.schemaVersion');
  exact(value.protocolVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.protocol, 'child receipt.protocolVersion');
  exact(value.runnerVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.runner, 'child receipt.runnerVersion');
  for (const key of ['sessionId', 'sessionNonce', 'challenge']) boundedId(value[key], `child receipt.${key}`);
  if (typeof value.preregistrationIdentity !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.preregistrationIdentity)) {
    fail('child receipt.preregistrationIdentity is invalid');
  }
  admitUnit(value.unit);
  if (typeof value.workloadCarrierCanonicalJson !== 'string'
    || Buffer.byteLength(value.workloadCarrierCanonicalJson, 'utf8') > MAX_CARRIER_BYTES) {
    fail('child receipt workload carrier is invalid or too large');
  }
  let carrier;
  try {
    carrier = JSON.parse(value.workloadCarrierCanonicalJson);
  } catch {
    fail('child receipt workload carrier is not JSON');
  }
  const admittedCarrier = admitRouteS5PerformanceWorkloadCarrier(carrier);
  exact(admittedCarrier.stratumId, value.unit.stratumId, 'child receipt workload stratum');
  exact(canonicalStringify(admittedCarrier), value.workloadCarrierCanonicalJson, 'child receipt exact canonical workload carrier');
  admitProcessIdentity(value.processIdentity);
  admitEnvironment(value.environment);
  admitCodeRevisionManifest(value.codeRevisionManifest);
  timestamp(value.startedAt, 'child receipt.startedAt');
  timestamp(value.completedAt, 'child receipt.completedAt');
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) fail('child receipt wall-clock completion precedes start');
  if (!Array.isArray(value.samples) || value.samples.length > value.unit.slots.length) fail('child receipt samples exceed frozen unit');
  value.samples.forEach((sample, index) => admitSample(
    sample,
    value.unit.slots[index],
    index,
    admittedCarrier.runs.length,
  ));
  exactKeys(value.truth, ['started', 'completed', 'stopped', 'partial', 'failure', 'failureCode'], 'child receipt.truth');
  for (const key of ['started', 'completed', 'stopped', 'partial', 'failure']) {
    if (typeof value.truth[key] !== 'boolean') fail(`child receipt.truth.${key} must be boolean`);
  }
  exact(value.truth.started, true, 'child receipt.truth.started');
  const partial = value.samples.length !== value.unit.slots.length
    || value.samples.some((sample) => sample.timing.availability === 'unavailable'
      || sample.memory.availability === 'unavailable');
  const stopped = value.samples.some(({ outcome }) => outcome === 'stopped');
  const failure = value.samples.some(({ outcome }) => outcome === 'failure');
  exact(value.truth.partial, partial, 'child receipt.truth.partial');
  exact(value.truth.completed, !partial, 'child receipt.truth.completed');
  exact(value.truth.stopped, stopped, 'child receipt.truth.stopped');
  exact(value.truth.failure, failure, 'child receipt.truth.failure');
  if (partial || stopped || failure) boundedId(value.truth.failureCode, 'child receipt.truth.failureCode');
  else exact(value.truth.failureCode, null, 'child receipt.truth.failureCode');
  const identityInput = { ...value };
  delete identityInput.receiptIdentity;
  exact(value.receiptIdentity, receiptIdentity(identityInput), 'child receipt.receiptIdentity');
  return deepFreeze(value);
}

export function assertRouteS5ReceiptExpectation(receipt, expected) {
  const admitted = admitRouteS5PerformanceReceiptConformance(receipt);
  exact(admitted.sessionId, expected.sessionId, 'receipt expected sessionId');
  exact(admitted.sessionNonce, expected.sessionNonce, 'receipt expected sessionNonce');
  exact(admitted.challenge, expected.challenge, 'receipt expected challenge');
  exact(admitted.preregistrationIdentity, expected.preregistrationIdentity, 'receipt expected preregistrationIdentity');
  exact(admitted.processIdentity.pid, expected.observedPid, 'receipt observed child pid');
  exact(admitted.processIdentity.ppid, process.pid, 'receipt observed parent pid');
  for (const key of ['execPath', 'nodeVersion', 'v8Version', 'platform', 'release', 'arch']) {
    exact(
      admitted.processIdentity[key],
      expected.environment[key],
      `receipt processIdentity.${key} cross-binding to preregistration environment`,
    );
  }
  if (!sameData(admitted.unit, expected.unit)) fail('receipt unit drifted from preregistration');
  exact(admitted.workloadCarrierCanonicalJson, expected.workloadCarrierCanonicalJson, 'receipt exact workload carrier');
  if (!sameData(admitted.environment, expected.environment)) fail('receipt captured environment drifted');
  if (!sameData(admitted.codeRevisionManifest, expected.codeRevisionManifest)) {
    fail('receipt code revision manifest drifted from preregistration');
  }
  exact(
    admitted.codeRevisionManifest.nodeExecutable.execPath,
    admitted.processIdentity.execPath,
    'receipt code revision executable cross-binding',
  );
  exact(
    admitted.codeRevisionManifest.nodeExecutable.nodeVersion,
    admitted.processIdentity.nodeVersion,
    'receipt code revision Node version cross-binding',
  );
  return admitted;
}
