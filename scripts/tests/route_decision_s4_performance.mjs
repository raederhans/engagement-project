import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROUTE_S4_PERFORMANCE_PROTOCOL,
  admitRouteS4PerformanceAttempt,
  admitRouteS4PerformanceSample,
  admitRouteS4ReferenceEnvironment,
  createRouteS4PerformanceSession,
  createRouteS4StageInstrumentation,
  expectedRouteS4PerformanceSchedule,
} from '../lib/route_s4_performance/index.mjs';
import {
  deterministicCollector,
  syntheticArtifacts,
  syntheticAttempt,
  syntheticOperations,
  syntheticReferenceEnvironment,
} from '../fixtures/route-s4-performance/synthetic_protocol_probe.mjs';

test('v1 freezes preregistration, order, denominator, threshold, and authority rules', () => {
  assert.equal(ROUTE_S4_PERFORMANCE_PROTOCOL.schemaVersion, 'route-s4-performance-protocol/v1');
  assert.equal(ROUTE_S4_PERFORMANCE_PROTOCOL.identityFreeze.derivation, 'sha256-canonical-descriptor-safe-artifact-snapshot');
  assert.equal(ROUTE_S4_PERFORMANCE_PROTOCOL.sampleAdmission.provenance, 'module-private-session-and-collector-brand-required');
  assert.equal(ROUTE_S4_PERFORMANCE_PROTOCOL.decisionRule.authorityUnverifiedDecision, 'no-decision-authority-unverified');
  assert.equal(ROUTE_S4_PERFORMANCE_PROTOCOL.exclusions.s3OperationalEvidence, 'forbidden');
  assert.deepEqual(ROUTE_S4_PERFORMANCE_PROTOCOL.stages, [
    'adapter-input', 'candidate-search', 'decision-evaluation', 'adapter-output',
  ]);
  assert.equal(Object.isFrozen(ROUTE_S4_PERFORMANCE_PROTOCOL.strata[0].thresholds), true);
});

test('schedule remains exact cold, warmup, warm with 26 measured and four warmups', () => {
  const schedule = expectedRouteS4PerformanceSchedule();
  assert.equal(schedule.length, 30);
  assert.equal(schedule.filter((slot) => slot.phase !== 'warmup').length, 26);
  assert.equal(schedule.filter((slot) => slot.phase === 'warmup').length, 4);
  assert.deepEqual(schedule.slice(0, 6).map((slot) => slot.phase), [
    'cold', 'cold', 'cold', 'warmup', 'warmup', 'warm',
  ]);
});

test('descriptor-safe snapshot invokes no getters and rejects accessor, Proxy, prototype, symbol, and hidden data', () => {
  let getterCalls = 0;
  const getterEnvironment = syntheticReferenceEnvironment();
  Object.defineProperty(getterEnvironment, 'environmentId', {
    enumerable: true,
    get() { getterCalls += 1; return 'hostile'; },
  });
  assert.throws(() => admitRouteS4ReferenceEnvironment(getterEnvironment), /accessor is forbidden/);
  assert.equal(getterCalls, 0);

  assert.throws(() => admitRouteS4ReferenceEnvironment(new Proxy(syntheticReferenceEnvironment(), {})), /must not be a Proxy/);

  const prototype = syntheticReferenceEnvironment();
  Object.setPrototypeOf(prototype, { polluted: true });
  assert.throws(() => admitRouteS4ReferenceEnvironment(prototype), /plain prototype/);

  const symbol = syntheticReferenceEnvironment();
  symbol[Symbol('hidden')] = true;
  assert.throws(() => admitRouteS4ReferenceEnvironment(symbol), /symbol keys/);

  const hidden = syntheticReferenceEnvironment();
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  assert.throws(() => admitRouteS4ReferenceEnvironment(hidden), /must not be hidden/);
});

test('snapshot rejects dangerous keys, sparse arrays, excessive depth, cycles, and repeated references', () => {
  const dangerousArtifacts = syntheticArtifacts();
  Object.defineProperty(dangerousArtifacts.graph, '__proto__', { value: 'blocked', enumerable: true });
  assert.throws(() => hostileSession(dangerousArtifacts), /__proto__ is blocked/);

  const sparseArtifacts = syntheticArtifacts();
  sparseArtifacts.graph.values = new Array(2);
  sparseArtifacts.graph.values[1] = 1;
  assert.throws(() => hostileSession(sparseArtifacts), /dense array/);

  const deepArtifacts = syntheticArtifacts();
  let cursor = deepArtifacts.graph;
  for (let index = 0; index < 20; index += 1) { cursor.child = {}; cursor = cursor.child; }
  assert.throws(() => hostileSession(deepArtifacts), /snapshot depth/);

  const cycleArtifacts = syntheticArtifacts();
  cycleArtifacts.graph.self = cycleArtifacts.graph;
  assert.throws(() => hostileSession(cycleArtifacts), /cycle or repeated reference/);

  const repeatedArtifacts = syntheticArtifacts();
  repeatedArtifacts.graph.shared = {};
  repeatedArtifacts.graph.again = repeatedArtifacts.graph.shared;
  assert.throws(() => hostileSession(repeatedArtifacts), /cycle or repeated reference/);
});

test('session mechanically binds supplied admitted artifacts and snapshots before later mutation', () => {
  const artifacts = syntheticArtifacts();
  const attempt = syntheticAttempt('diagnostic-dry-run', artifacts);
  const session = createRouteS4PerformanceSession({ attempt, artifacts, collector: deterministicCollector() });
  artifacts.graph.kind = 'mutated-after-admission';
  assert.equal(session.attempt.bindings.graphIdentity, attempt.bindings.graphIdentity);
  assert.equal(Object.isFrozen(session.attempt.bindings), true);

  const drift = syntheticAttempt('diagnostic-dry-run', syntheticArtifacts());
  drift.bindings.graphIdentity = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () => createRouteS4PerformanceSession({ attempt: drift, artifacts: syntheticArtifacts(), collector: deterministicCollector() }),
    /bindings do not match/,
  );
  assert.throws(
    () => createRouteS4PerformanceSession({ attempt, artifacts, collector: { run() {} } }),
    /not minted by route-s4 stage instrumentation/,
  );

  let getterCalls = 0;
  const hostileOptions = { artifacts, collector: deterministicCollector() };
  Object.defineProperty(hostileOptions, 'attempt', {
    enumerable: true,
    get() { getterCalls += 1; return attempt; },
  });
  assert.throws(() => createRouteS4PerformanceSession(hostileOptions), /enumerable data property/);
  assert.equal(getterCalls, 0);
  assert.throws(() => createRouteS4PerformanceSession(new Proxy({ attempt, artifacts }, {})), /non-Proxy object/);
});

test('raw attempts and raw samples cannot self-admit or manufacture evidence', () => {
  assert.throws(() => admitRouteS4PerformanceAttempt(syntheticAttempt()), /create a bound performance session/);
  assert.throws(() => admitRouteS4PerformanceSample({}), /minted by a performance session/);
});

test('diagnostic collection is minted by its session and mechanically excluded from denominator', async () => {
  const session = sessionFor();
  const { sample, businessResults } = await collect(session, 1);
  assert.equal(sample.mode, 'diagnostic-dry-run');
  assert.equal(sample.exclusionReason, 'diagnostic-dry-run');
  assert.equal('results' in sample, false);
  assert.equal('error' in sample, false);
  assert.equal(businessResults['adapter-input'].mutableBusinessResult, 'adapter-input');
  businessResults['adapter-input'].mutableBusinessResult = 'changed-outside-evidence';
  assert.equal('businessResults' in sample, false);

  const summary = session.summarize([sample]);
  assert.equal(summary.counts.plannedGateEligible, 0);
  assert.equal(summary.counts.excludedDiagnostic, 1);
  assert.equal(summary.decision, 'ineligible-diagnostic');
});

test('handwritten 30 samples, diagnostic-to-gate repackaging, cross-session samples, and tampering are rejected', async () => {
  const diagnostic = sessionFor();
  const gate = sessionFor('gate-eligible');
  const otherGate = sessionFor('gate-eligible');
  const { sample: diagnosticSample } = await collect(diagnostic, 1);
  const { sample: gateSample } = await collect(gate, 1);

  const handwritten = Array.from({ length: 30 }, (_, index) => ({ ordinal: index + 1 }));
  assert.throws(() => gate.summarize(handwritten), /not minted by this session/);

  const repackaged = { ...diagnosticSample, mode: 'gate-eligible', exclusionReason: null };
  assert.throws(() => gate.summarize([repackaged]), /not minted by this session/);
  assert.throws(() => otherGate.summarize([gateSample]), /not minted by this session/);

  assert.throws(() => { gateSample.mode = 'diagnostic-dry-run'; }, TypeError);
  assert.throws(() => gate.summarize([{ ...gateSample, processIdentity: 'forged' }]), /not minted by this session/);
});

test('session atomically enforces the exact next slot before awaiting collector work', async () => {
  const outOfOrder = sessionFor();
  await assert.rejects(() => collect(outOfOrder, 30), /must equal next frozen slot: 1/);

  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const concurrent = sessionFor();
  const operations = syntheticOperations();
  operations['adapter-input'] = async () => firstBlocked;
  const first = collect(concurrent, 1, { operations });
  await assert.rejects(() => collect(concurrent, 1), /another frozen slot is active/);
  await assert.rejects(() => collect(concurrent, 2), /another frozen slot is active/);
  releaseFirst('released');
  assert.equal((await first).sample.ordinal, 1);
  assert.equal((await collect(concurrent, 2)).sample.ordinal, 2);
});

test('failure and stop consume their slot and only the exact next ordinal may run', async () => {
  const failed = sessionFor();
  const failingOperations = syntheticOperations();
  failingOperations['adapter-input'] = () => { throw new Error('synthetic failure'); };
  const failedSample = (await collect(failed, 1, { operations: failingOperations })).sample;
  assert.equal(failedSample.outcome, 'failure');
  await assert.rejects(() => collect(failed, 1), /must equal next frozen slot: 2/);
  assert.equal((await collect(failed, 2)).sample.ordinal, 2);

  const stopped = sessionFor();
  const stoppedSample = (await collect(stopped, 1, { signal: { aborted: true } })).sample;
  assert.equal(stoppedSample.outcome, 'stopped');
  await assert.rejects(() => collect(stopped, 1), /must equal next frozen slot: 2/);
  assert.equal((await collect(stopped, 2)).sample.ordinal, 2);
});

test('even a complete successful gate collection cannot pass without external fresh-process authority', async () => {
  const gate = sessionFor('gate-eligible');
  const samples = [];
  for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
    samples.push((await collect(gate, ordinal)).sample);
  }
  const summary = gate.summarize(samples);
  assert.equal(summary.counts.plannedGateEligible, 26);
  assert.equal(summary.counts.missingGateEligible, 0);
  assert.equal(summary.counts.missingWarmup, 0);
  assert.equal(summary.processAuthority, 'unverified');
  assert.equal(summary.decision, 'no-decision-authority-unverified');
});

test('partial, stopped, failure, and summary self-authorship keep frozen denominator truth', async () => {
  const partial = sessionFor('gate-eligible');
  assert.equal(partial.summarize([]).decision, 'no-decision-partial');
  assert.equal(partial.summarize([]).counts.missingGateEligible, 26);

  const stoppedSignal = { aborted: true };
  const stopped = sessionFor('gate-eligible');
  const stoppedSample = (await collect(stopped, 1, { signal: stoppedSignal })).sample;
  assert.equal(stoppedSample.errorCode, 'collection-aborted');
  assert.equal(stopped.summarize([stoppedSample]).decision, 'no-decision-stopped');

  const failed = sessionFor('gate-eligible');
  const operations = syntheticOperations();
  operations['adapter-input'] = () => { throw new Error('raw secret error'); };
  const failedSample = (await collect(failed, 1, { operations })).sample;
  assert.equal(failedSample.errorCode, 'synthetic-stage-failure');
  assert.equal('error' in failedSample, false);

  const summary = partial.summarize([]);
  const forgedSummary = structuredClone(summary);
  forgedSummary.counts.plannedGateEligible = 0;
  assert.throws(() => partial.admitSummary(forgedSummary, []), /not mechanically derived/);
});

test('instrumentation rechecks abort after awaited stage and after final stage, preserving completed boundary', async () => {
  const signal = { aborted: false };
  const operations = syntheticOperations((stageId) => {
    if (stageId === 'adapter-output') signal.aborted = true;
  });
  const collector = deterministicCollector();
  const result = await collector.run(operations, { signal });
  assert.equal(result.evidence.outcome, 'stopped');
  assert.equal(result.evidence.errorCode, 'collection-aborted');
  assert.equal(result.evidence.completedStageId, 'adapter-output');
  assert.equal(result.evidence.stages.length, 4);
  assert.equal('error' in result.evidence, false);
  assert.equal('results' in result.evidence, false);
});

test('instrumentation operation and memory probes are descriptor-safe and invoke no getter', async () => {
  let calls = 0;
  const operations = syntheticOperations();
  Object.defineProperty(operations, 'adapter-input', {
    enumerable: true,
    get() { calls += 1; return () => null; },
  });
  await assert.rejects(() => deterministicCollector().run(operations), /enumerable function data property/);
  assert.equal(calls, 0);

  const proxiedMemory = createRouteS4StageInstrumentation({
    clock: () => 1n,
    readMemory: () => new Proxy({ rss: 1, heapUsed: 1 }, {}),
  });
  await assert.rejects(() => proxiedMemory.run(syntheticOperations()), /memory must be non-Proxy data/);
});

function sessionFor(mode = 'diagnostic-dry-run', artifacts = syntheticArtifacts()) {
  return createRouteS4PerformanceSession({
    attempt: syntheticAttempt(mode, artifacts), artifacts, collector: deterministicCollector(),
  });
}

function hostileSession(artifacts) {
  const cleanArtifacts = syntheticArtifacts();
  return createRouteS4PerformanceSession({
    attempt: syntheticAttempt('diagnostic-dry-run', cleanArtifacts),
    artifacts,
    collector: deterministicCollector(),
  });
}

function collect(session, ordinal, { operations = syntheticOperations(), signal = null } = {}) {
  return session.collect({
    ordinal,
    startedAt: `2026-08-13T00:00:${String(ordinal).padStart(2, '0')}.000Z`,
    stageOperations: operations,
    signal,
  });
}
