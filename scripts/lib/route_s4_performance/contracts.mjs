import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { assertRouteS4StageInstrumentation } from './instrumentation.mjs';

const VERSIONS = Object.freeze({
  protocol: 'route-s4-performance-protocol/v1',
  referenceEnvironment: 'route-s4-reference-environment/v1',
  attempt: 'route-s4-performance-attempt/v1',
  sample: 'route-s4-performance-sample/v1',
  summary: 'route-s4-performance-summary/v1',
  collector: 'route-s4-stage-instrumentation/v1',
});
const MODES = ['diagnostic-dry-run', 'gate-eligible'];
const PHASES = ['cold', 'warmup', 'warm'];
const OUTCOMES = ['success', 'failure', 'stopped'];
const STAGES = ['adapter-input', 'candidate-search', 'decision-evaluation', 'adapter-output'];
const ARTIFACT_KEYS = ['algorithm', 'graph', 'policy', 'requestSet', 'adapter'];
const BINDING_KEYS = ARTIFACT_KEYS.map((key) => `${key}Identity`);
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SNAPSHOT_LIMITS = Object.freeze({ maxDepth: 12, maxNodes: 10_000, maxKeys: 200, maxArray: 1_000 });
const SESSION_STATE = new WeakMap();
const SAMPLE_STATE = new WeakMap();
const SUMMARY_STATE = new WeakMap();

export const ROUTE_S4_PERFORMANCE_PROTOCOL = deepFreeze({
  schemaVersion: VERSIONS.protocol,
  evidenceRuntime: 'node',
  evidenceScope: 'synthetic-engineering-only',
  identityFreeze: {
    timing: 'session-creation-before-any-sample',
    required: BINDING_KEYS,
    derivation: 'sha256-canonical-descriptor-safe-artifact-snapshot',
    mutationPolicy: 'admitted-snapshot-only',
  },
  order: {
    strata: ['micro-synthetic', 'bounded-synthetic'],
    phasesWithinStratum: PHASES,
    cold: { plannedSamples: 3, eligibility: 'measured', processState: 'fresh-process-authority-required' },
    warmup: { plannedSamples: 2, eligibility: 'excluded-warmup', processState: 'same-process-before-warm' },
    warm: { plannedSamples: 10, eligibility: 'measured', processState: 'same-process-after-warmup' },
  },
  stages: STAGES,
  timer: {
    source: 'process.hrtime.bigint', unit: 'nanoseconds', clock: 'monotonic',
    boundary: 'immediately-before-and-after-each-stage',
    aggregation: 'total-is-sum-of-completed-stage-durations', quantile: 'nearest-rank-ceiling',
  },
  memory: {
    source: 'process.memoryUsage', unit: 'bytes', fields: ['rss', 'heapUsed'],
    sampling: 'sample-baseline-and-each-completed-stage-boundary',
    statistic: 'maximum-observed-minus-sample-baseline', garbageCollection: 'no-forced-gc',
    negativeDeltaPolicy: 'clamp-to-zero',
  },
  strata: [
    {
      stratumId: 'micro-synthetic', graph: { nodeCount: 8, edgeCount: 12 },
      requestCount: 4, candidateLimit: 4,
      thresholds: {
        totalP95Nanoseconds: 25_000_000,
        maximumRssDeltaBytes: 32 * 1024 * 1024,
        maximumHeapUsedDeltaBytes: 16 * 1024 * 1024,
      },
    },
    {
      stratumId: 'bounded-synthetic', graph: { nodeCount: 64, edgeCount: 160 },
      requestCount: 16, candidateLimit: 8,
      thresholds: {
        totalP95Nanoseconds: 100_000_000,
        maximumRssDeltaBytes: 64 * 1024 * 1024,
        maximumHeapUsedDeltaBytes: 32 * 1024 * 1024,
      },
    },
  ],
  sampleAdmission: {
    provenance: 'module-private-session-and-collector-brand-required',
    diagnosticPolicy: 'all-diagnostic-samples-excluded-from-gate-denominator',
    warmupPolicy: 'all-warmup-samples-excluded-from-gate-denominator',
    failurePolicy: 'failure-remains-in-planned-gate-denominator',
    stoppedPolicy: 'stopped-remains-in-planned-gate-denominator',
    partialPolicy: 'missing-planned-samples-remain-in-denominator-and-prevent-decision',
    unexpectedSamplePolicy: 'reject',
  },
  decisionRule: {
    completeAttemptRequired: true, allMeasuredSamplesSuccessful: true,
    everyStratumThresholdRequired: true,
    freshProcessAuthority: 'external-main-owned-authority-required-v1-cannot-self-attest',
    authorityUnverifiedDecision: 'no-decision-authority-unverified',
    collectionFailureDecision: 'no-decision-collection-failure',
    thresholdDecisionWithoutAuthority: 'no-decision-authority-unverified',
    noPostHocPolicy: 'thresholds-strata-order-exclusions-and-mode-cannot-change-after-session-creation',
  },
  exclusions: {
    allowedReasons: ['diagnostic-dry-run', 'warmup'], s3OperationalEvidence: 'forbidden',
    browserWorkerServerEvidence: 'outside-v1',
  },
});

export function admitRouteS4ReferenceEnvironment(input) {
  const value = safeSnapshot(input, 'referenceEnvironment');
  exactKeys(value, [
    'schemaVersion', 'environmentId', 'environmentKind', 'capturedAt', 'operatingSystem',
    'runtime', 'hardware', 'process', 'isolation',
  ], 'referenceEnvironment');
  exact(value.schemaVersion, VERSIONS.referenceEnvironment, 'referenceEnvironment.schemaVersion');
  boundedId(value.environmentId, 'referenceEnvironment.environmentId');
  oneOf(value.environmentKind, ['measured-reference', 'synthetic-contract-probe'], 'referenceEnvironment.environmentKind');
  timestamp(value.capturedAt, 'referenceEnvironment.capturedAt');
  exactKeys(value.operatingSystem, ['platform', 'release', 'architecture'], 'referenceEnvironment.operatingSystem');
  for (const key of ['platform', 'release', 'architecture']) boundedText(value.operatingSystem[key], `referenceEnvironment.operatingSystem.${key}`);
  exactKeys(value.runtime, ['implementation', 'nodeVersion', 'v8Version'], 'referenceEnvironment.runtime');
  exact(value.runtime.implementation, 'node', 'referenceEnvironment.runtime.implementation');
  boundedText(value.runtime.nodeVersion, 'referenceEnvironment.runtime.nodeVersion');
  boundedText(value.runtime.v8Version, 'referenceEnvironment.runtime.v8Version');
  exactKeys(value.hardware, ['cpuModel', 'logicalCpuCount', 'memoryBytes'], 'referenceEnvironment.hardware');
  boundedText(value.hardware.cpuModel, 'referenceEnvironment.hardware.cpuModel');
  positiveInteger(value.hardware.logicalCpuCount, 'referenceEnvironment.hardware.logicalCpuCount');
  positiveInteger(value.hardware.memoryBytes, 'referenceEnvironment.hardware.memoryBytes');
  exactKeys(value.process, ['execArgv', 'nodeOptions', 'timezone'], 'referenceEnvironment.process');
  if (!Array.isArray(value.process.execArgv)) fail('referenceEnvironment.process.execArgv must be an array');
  value.process.execArgv.forEach((item, index) => boundedText(item, `referenceEnvironment.process.execArgv[${index}]`));
  if (value.process.nodeOptions !== null) boundedText(value.process.nodeOptions, 'referenceEnvironment.process.nodeOptions');
  boundedText(value.process.timezone, 'referenceEnvironment.process.timezone');
  exactKeys(value.isolation, ['network', 'backgroundLoad', 'powerMode'], 'referenceEnvironment.isolation');
  exact(value.isolation.network, 'disabled', 'referenceEnvironment.isolation.network');
  exact(value.isolation.backgroundLoad, 'controlled-and-recorded', 'referenceEnvironment.isolation.backgroundLoad');
  exact(value.isolation.powerMode, 'fixed-and-recorded', 'referenceEnvironment.isolation.powerMode');
  return value;
}

export function createRouteS4PerformanceSession(input) {
  const creation = safeOptions(input, 'session options', ['attempt', 'artifacts', 'collector']);
  const { attempt: rawAttempt, artifacts: rawArtifacts, collector } = creation;
  assertRouteS4StageInstrumentation(collector);
  const artifacts = safeSnapshot(rawArtifacts, 'artifacts');
  exactKeys(artifacts, ARTIFACT_KEYS, 'artifacts');
  const bindings = Object.fromEntries(ARTIFACT_KEYS.map((key) => [
    `${key}Identity`, contentIdentity(artifacts[key]),
  ]));
  const attempt = admitAttempt(rawAttempt, bindings);
  const session = Object.freeze({
    attempt,
    collect: (options) => collectWithSession(session, options),
    summarize: (samples) => summarizeWithSession(session, samples),
    admitSummary: (summary, samples) => admitSummaryWithSession(session, summary, samples),
  });
  SESSION_STATE.set(session, {
    attempt,
    artifacts,
    bindings,
    collector,
    nextOrdinal: 1,
    reserved: new Set(),
    consumed: new Set(),
    minted: new Set(),
  });
  return session;
}

export function expectedRouteS4PerformanceSchedule() {
  return deepFreeze(expectedSchedule());
}

export function admitRouteS4PerformanceAttempt() {
  fail('raw attempt admission is unavailable; create a bound performance session');
}

export function admitRouteS4PerformanceSample() {
  fail('raw sample admission is unavailable; samples must be minted by a performance session');
}

export function buildRouteS4PerformanceSummary(session, samples) {
  return summarizeWithSession(session, samples);
}

export function admitRouteS4PerformanceSummary(session, summary, samples) {
  return admitSummaryWithSession(session, summary, samples);
}

async function collectWithSession(session, input) {
  const state = requireSession(session);
  const options = safeOptions(input, 'collection options', ['ordinal', 'startedAt', 'stageOperations', 'signal']);
  positiveInteger(options.ordinal, 'collection ordinal');
  timestamp(options.startedAt, 'collection startedAt');
  if (Date.parse(options.startedAt) < Date.parse(state.attempt.preregisteredAt)) fail('sample started before preregistration');
  if (state.reserved.size !== 0) {
    fail('collection rejected while another frozen slot is active');
  }
  if (options.ordinal !== state.nextOrdinal) {
    fail(`collection ordinal must equal next frozen slot: ${state.nextOrdinal}`);
  }
  const slot = state.attempt.schedule[options.ordinal - 1];
  if (!slot) fail('collection ordinal is outside frozen schedule');
  if (state.reserved.has(options.ordinal) || state.consumed.has(options.ordinal)) {
    fail(`collection ordinal is already reserved or consumed: ${options.ordinal}`);
  }
  state.reserved.add(options.ordinal);
  state.consumed.add(options.ordinal);
  state.nextOrdinal += 1;
  let collected;
  try {
    collected = await state.collector.run(options.stageOperations, { signal: options.signal });
  } finally {
    state.reserved.delete(options.ordinal);
  }
  const collectorEvidence = safeSnapshot(collected.evidence, 'collector evidence');
  const sample = mintSample(state, slot, options.startedAt, collectorEvidence);
  state.minted.add(options.ordinal);
  SAMPLE_STATE.set(sample, { session, ordinal: options.ordinal });
  return Object.freeze({ sample, businessResults: collected.businessResults });
}

function mintSample(state, slot, startedAt, evidence) {
  exactKeys(evidence, ['collectorVersion', 'outcome', 'errorCode', 'completedStageId', 'stages', 'totalDurationNanoseconds', 'memory'], 'collector evidence');
  exact(evidence.collectorVersion, VERSIONS.collector, 'collector evidence.collectorVersion');
  oneOf(evidence.outcome, OUTCOMES, 'collector evidence.outcome');
  admitStages(evidence.stages, evidence.outcome);
  nonNegativeInteger(evidence.totalDurationNanoseconds, 'collector evidence.totalDurationNanoseconds');
  exact(evidence.totalDurationNanoseconds, evidence.stages.reduce((sum, stage) => sum + stage.durationNanoseconds, 0), 'collector evidence total');
  admitMemory(evidence.memory);
  if (evidence.outcome === 'success') {
    exact(evidence.errorCode, null, 'collector evidence.errorCode');
    exact(evidence.completedStageId, STAGES.at(-1), 'collector evidence.completedStageId');
  } else {
    boundedId(evidence.errorCode, 'collector evidence.errorCode');
    if (evidence.completedStageId !== null) oneOf(evidence.completedStageId, STAGES, 'collector evidence.completedStageId');
  }
  return deepFreeze({
    schemaVersion: VERSIONS.sample,
    collectorVersion: VERSIONS.collector,
    attemptId: state.attempt.attemptId,
    sampleId: `${state.attempt.attemptId}:${slot.ordinal}`,
    ordinal: slot.ordinal,
    mode: state.attempt.mode,
    stratumId: slot.stratumId,
    phase: slot.phase,
    phaseIndex: slot.phaseIndex,
    startedAt,
    outcome: evidence.outcome,
    exclusionReason: state.attempt.mode === 'diagnostic-dry-run'
      ? 'diagnostic-dry-run' : slot.phase === 'warmup' ? 'warmup' : null,
    completedStageId: evidence.completedStageId,
    stages: evidence.stages,
    totalDurationNanoseconds: evidence.totalDurationNanoseconds,
    memory: evidence.memory,
    errorCode: evidence.errorCode,
  });
}

function summarizeWithSession(session, sampleInputs, mintAuthority = true) {
  const state = requireSession(session);
  const sampleReferences = exactDenseArrayData(sampleInputs, 'samples', state.attempt.schedule.length);
  const samples = sampleReferences.map((sample) => {
    const brand = SAMPLE_STATE.get(sample);
    if (!brand || brand.session !== session || !state.minted.has(brand.ordinal)) fail('sample is not minted by this session');
    return sample;
  });
  const ordinals = new Set();
  for (const sample of samples) {
    if (ordinals.has(sample.ordinal)) fail(`duplicate sample ordinal: ${sample.ordinal}`);
    ordinals.add(sample.ordinal);
  }
  const measuredSlots = state.attempt.schedule.filter((slot) => slot.phase !== 'warmup');
  const byOrdinal = new Map(samples.map((sample) => [sample.ordinal, sample]));
  const gateSamples = state.attempt.mode === 'gate-eligible'
    ? measuredSlots.map((slot) => byOrdinal.get(slot.ordinal)).filter(Boolean) : [];
  const warmups = state.attempt.mode === 'gate-eligible'
    ? samples.filter((sample) => sample.phase === 'warmup') : [];
  const counts = {
    plannedGateEligible: state.attempt.mode === 'gate-eligible' ? measuredSlots.length : 0,
    observedGateEligible: gateSamples.length,
    successfulGateEligible: count(gateSamples, 'success'),
    failedGateEligible: count(gateSamples, 'failure'),
    stoppedGateEligible: count(gateSamples, 'stopped'),
    excludedDiagnostic: state.attempt.mode === 'diagnostic-dry-run' ? samples.length : 0,
    excludedWarmup: warmups.length,
    plannedWarmup: state.attempt.mode === 'gate-eligible'
      ? state.attempt.schedule.filter((slot) => slot.phase === 'warmup').length : 0,
    observedWarmup: warmups.length,
    failedWarmup: count(warmups, 'failure'),
    stoppedWarmup: count(warmups, 'stopped'),
  };
  counts.missingGateEligible = counts.plannedGateEligible - counts.observedGateEligible;
  counts.missingWarmup = counts.plannedWarmup - counts.observedWarmup;
  const strata = ROUTE_S4_PERFORMANCE_PROTOCOL.strata.map((stratum) => summarizeStratum(stratum, gateSamples));
  const summary = deepFreeze({
    schemaVersion: VERSIONS.summary, attemptId: state.attempt.attemptId,
    mode: state.attempt.mode, protocolVersion: VERSIONS.protocol, counts, strata,
    processAuthority: 'unverified',
    decision: decide(state.attempt.mode, counts, strata),
    claimScope: 'synthetic-engineering-performance-only',
  });
  if (mintAuthority) {
    SUMMARY_STATE.set(summary, {
      session,
      samples: Object.freeze([...samples]),
    });
  }
  return summary;
}

function admitSummaryWithSession(session, summary, sampleInputs) {
  requireSession(session);
  const authority = SUMMARY_STATE.get(summary);
  if (!authority || authority.session !== session) {
    fail('summary is not minted by this session');
  }
  const samples = exactDenseArrayData(sampleInputs, 'samples', authority.samples.length);
  if (samples.length !== authority.samples.length
    || samples.some((sample, index) => sample !== authority.samples[index])) {
    fail('summary sample collection or order drifted');
  }
  const derived = summarizeWithSession(session, samples, false);
  if (canonical(summary) !== canonical(derived)) fail('summary is not mechanically derived');
  return summary;
}

function admitAttempt(input, bindings) {
  const value = safeSnapshot(input, 'attempt');
  exactKeys(value, ['schemaVersion', 'attemptId', 'mode', 'preregisteredAt', 'protocol', 'referenceEnvironment', 'bindings', 'schedule'], 'attempt');
  exact(value.schemaVersion, VERSIONS.attempt, 'attempt.schemaVersion');
  boundedId(value.attemptId, 'attempt.attemptId');
  oneOf(value.mode, MODES, 'attempt.mode');
  timestamp(value.preregisteredAt, 'attempt.preregisteredAt');
  if (canonical(value.protocol) !== canonical(ROUTE_S4_PERFORMANCE_PROTOCOL)) fail('attempt.protocol drifted');
  const environment = admitRouteS4ReferenceEnvironment(value.referenceEnvironment);
  if (value.mode === 'gate-eligible' && environment.environmentKind !== 'measured-reference') fail('gate attempt requires measured-reference environment');
  if (Date.parse(environment.capturedAt) > Date.parse(value.preregisteredAt)) fail('environment captured after preregistration');
  if (canonical(value.bindings) !== canonical(bindings)) fail('attempt bindings do not match supplied artifact identities');
  if (canonical(value.schedule) !== canonical(expectedSchedule())) fail('attempt.schedule drifted');
  return deepFreeze({ ...value, referenceEnvironment: environment });
}

function safeSnapshot(input, label) {
  const seen = new WeakSet();
  const budget = { nodes: 0 };
  return deepFreeze(walk(input, label, 0));

  function walk(value, path, depth) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail(`${path} number must be a finite safe integer`);
      return value;
    }
    if (!value || typeof value !== 'object') fail(`${path} contains unsupported data`);
    if (utilTypes.isProxy(value)) fail(`${path} must not be a Proxy`);
    if (depth > SNAPSHOT_LIMITS.maxDepth) fail(`${path} exceeds snapshot depth`);
    if (seen.has(value)) fail(`${path} contains a cycle or repeated reference`);
    seen.add(value);
    budget.nodes += 1;
    if (budget.nodes > SNAPSHOT_LIMITS.maxNodes) fail(`${path} exceeds snapshot node budget`);
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      fail(`${path} must have a plain prototype`);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol')) fail(`${path} must not contain symbol keys`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (isArray) {
      if (value.length > SNAPSHOT_LIMITS.maxArray) fail(`${path} exceeds array bound`);
      const dataKeys = keys.filter((key) => key !== 'length');
      if (dataKeys.length !== value.length) fail(`${path} must be a dense array without hidden properties`);
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(`${path}[${index}] must be an enumerable data property`);
        output.push(walk(descriptor.value, `${path}[${index}]`, depth + 1));
      }
      return output;
    }
    if (keys.length > SNAPSHOT_LIMITS.maxKeys) fail(`${path} exceeds object key bound`);
    const output = Object.create(null);
    for (const key of keys) {
      if (BLOCKED_KEYS.has(key)) fail(`${path}.${key} is blocked`);
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fail(`${path}.${key} must not be hidden`);
      if (!('value' in descriptor)) fail(`${path}.${key} accessor is forbidden`);
      output[key] = walk(descriptor.value, `${path}.${key}`, depth + 1);
    }
    return output;
  }
}

function safeOptions(input, label, allowedKeys) {
  if (!input || typeof input !== 'object' || utilTypes.isProxy(input)) fail(`${label} must be a non-Proxy object`);
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) fail(`${label} must have a plain prototype`);
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key === 'symbol') || keys.some((key) => !allowedKeys.includes(key))) fail(`${label} has invalid keys`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output = Object.create(null);
  for (const key of allowedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(`${label}.${key} must be an enumerable data property`);
    output[key] = descriptor.value;
  }
  return output;
}

function contentIdentity(snapshot) {
  return `sha256:${createHash('sha256').update(canonical(snapshot)).digest('hex')}`;
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function expectedSchedule() {
  const output = [];
  let ordinal = 1;
  for (const stratumId of ROUTE_S4_PERFORMANCE_PROTOCOL.order.strata) {
    for (const phase of PHASES) {
      for (let phaseIndex = 1; phaseIndex <= ROUTE_S4_PERFORMANCE_PROTOCOL.order[phase].plannedSamples; phaseIndex += 1) {
        output.push({ ordinal, stratumId, phase, phaseIndex });
        ordinal += 1;
      }
    }
  }
  return output;
}

function summarizeStratum(stratum, samples) {
  const successful = samples.filter((sample) => sample.stratumId === stratum.stratumId && sample.outcome === 'success');
  return {
    stratumId: stratum.stratumId,
    successfulMeasuredSamples: successful.length,
    totalP95Nanoseconds: successful.length ? nearestRank(successful.map((sample) => sample.totalDurationNanoseconds), 0.95) : null,
    maximumRssDeltaBytes: successful.length ? Math.max(...successful.map((sample) => sample.memory.rssDeltaBytes)) : null,
    maximumHeapUsedDeltaBytes: successful.length ? Math.max(...successful.map((sample) => sample.memory.heapUsedDeltaBytes)) : null,
    thresholds: stratum.thresholds,
  };
}

function decide(mode, counts, strata) {
  if (mode === 'diagnostic-dry-run') return 'ineligible-diagnostic';
  if (counts.stoppedGateEligible || counts.stoppedWarmup) return 'no-decision-stopped';
  if (counts.missingGateEligible || counts.missingWarmup) return 'no-decision-partial';
  if (counts.failedGateEligible || counts.failedWarmup) return 'no-decision-collection-failure';
  return 'no-decision-authority-unverified';
}

function exactDenseArrayData(value, label, maximumLength) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a non-Proxy plain array`);
  }
  if (value.length > maximumLength) fail(`${label} exceeds frozen schedule`);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol')) fail(`${label} must not contain symbol keys`);
  const dataKeys = keys.filter((key) => key !== 'length');
  if (dataKeys.length !== value.length) fail(`${label} must be dense without hidden properties`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail(`${label}[${index}] must be an enumerable data property`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function admitStages(stages, outcome) {
  if (!Array.isArray(stages) || stages.length > STAGES.length) fail('collector stages are invalid');
  if (outcome === 'success' && stages.length !== STAGES.length) fail('successful collection requires all stages');
  stages.forEach((stage, index) => {
    exactKeys(stage, ['stageId', 'durationNanoseconds'], `stage[${index}]`);
    exact(stage.stageId, STAGES[index], `stage[${index}].stageId`);
    nonNegativeInteger(stage.durationNanoseconds, `stage[${index}].durationNanoseconds`);
  });
}

function admitMemory(value) {
  exactKeys(value, ['baselineRssBytes', 'baselineHeapUsedBytes', 'peakRssBytes', 'peakHeapUsedBytes', 'rssDeltaBytes', 'heapUsedDeltaBytes'], 'memory');
  for (const key of Object.keys(value)) nonNegativeInteger(value[key], `memory.${key}`);
  exact(value.rssDeltaBytes, Math.max(0, value.peakRssBytes - value.baselineRssBytes), 'memory.rssDeltaBytes');
  exact(value.heapUsedDeltaBytes, Math.max(0, value.peakHeapUsedBytes - value.baselineHeapUsedBytes), 'memory.heapUsedDeltaBytes');
}

function requireSession(session) {
  const state = SESSION_STATE.get(session);
  if (!state) fail('invalid performance session');
  return state;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort().join('\0');
  if (actual !== [...expected].sort().join('\0')) fail(`${label} must have exact keys: ${expected.join(', ')}`);
}

function exact(actual, expected, label) { if (!Object.is(actual, expected)) fail(`${label} must equal ${String(expected)}`); }
function oneOf(value, allowed, label) { if (!allowed.includes(value)) fail(`${label} is outside frozen vocabulary`); }
function boundedText(value, label) { if (typeof value !== 'string' || value.length < 1 || value.length > 200) fail(`${label} must be bounded text`); }
function boundedId(value, label) { if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(value)) fail(`${label} must be a bounded identifier`); }
function positiveInteger(value, label) { if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`); }
function nonNegativeInteger(value, label) { if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`); }
function timestamp(value, label) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${label} must be an exact ISO timestamp`); }
function count(values, outcome) { return values.filter((value) => value.outcome === outcome).length; }
function nearestRank(values, quantile) { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1]; }

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) deepFreeze(descriptor.value, seen);
    }
  }
  return value;
}

function fail(message) { throw new TypeError(`Route S4 performance admission: ${message}`); }

export const ROUTE_S4_PERFORMANCE_VERSIONS = VERSIONS;
