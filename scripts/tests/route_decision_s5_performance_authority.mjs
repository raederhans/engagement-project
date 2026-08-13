#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  UNRESOLVED_OBSERVATION_STATES,
} from '../../src/route_decision/contracts/index.js';
import {
  ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS,
  ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
  ROUTE_SEARCH_DISTINCTNESS_VERSION,
  ROUTE_SEARCH_TIE_BREAK_VERSION,
  ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES,
} from '../../src/route_decision/contracts/candidate_search_v2.js';
import {
  PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
  adaptPhiladelphiaSyntheticGraph,
} from '../../src/route_generation/city_adapter/index.js';
import {
  buildCityRouteDecisionBinding,
  buildRouteDecisionIntegrationRun,
} from '../../src/route_decision/integration/index.js';
import {
  ROUTE_S5_DIAGNOSTIC_PROFILE,
  ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES,
  ROUTE_S5_FORMAL_PROFILE,
  ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL,
  ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS,
  admitPerformanceAuthorityResult,
  admitRouteS5PerformanceReceiptConformance,
  createRouteS5DiagnosticPerformanceAuthoritySession,
  createRouteS5FormalPerformanceAuthoritySession,
} from '../lib/route_s5_performance_authority/index.mjs';
import {
  assertRouteS5ReceiptExpectation,
  sealRouteS5PerformanceReceipt,
} from '../lib/route_s5_performance_authority/receipt.mjs';
import {
  classifyRouteS5PerformanceDecisionForInternalRecomputation,
} from '../lib/route_s5_performance_authority/runner.mjs';

const FIXTURE_URL = new URL(
  '../fixtures/route-s5-performance-authority/diagnostic_city_source.json',
  import.meta.url,
);

async function diagnosticRun() {
  const source = JSON.parse(await readFile(FIXTURE_URL, 'utf8'));
  const cityAdaptationResult = adaptPhiladelphiaSyntheticGraph(
    source,
    PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
  );
  const binding = buildCityRouteDecisionBinding({
    sourceGraph: source,
    cityAdapter: PHILADELPHIA_SYNTHETIC_CITY_ADAPTER,
    cityAdaptationResult,
  });
  const factorId = 'step-free';
  return buildRouteDecisionIntegrationRun({
    binding,
    searchRequest: {
      schemaVersion: ROUTE_CANDIDATE_SEARCH_SCHEMA_VERSIONS.searchRequest,
      requestId: 's5-performance-diagnostic-request',
      graphId: cityAdaptationResult.graphArtifact.graphId,
      mode: cityAdaptationResult.graphArtifact.mode,
      originNodeId: 'node-a',
      destinationNodeId: 'node-b',
      decisionPolicyId: 's5-performance-diagnostic-policy',
      objectiveFactorId: 'objective-cost-units',
      requestedCandidateCount: 1,
      routeDistinctnessVersion: ROUTE_SEARCH_DISTINCTNESS_VERSION,
      tieBreakVersion: ROUTE_SEARCH_TIE_BREAK_VERSION,
      bounds: { maxExpandedStates: 100, maxRouteEdgeCount: 4 },
      hardConstraints: [{
        constraintId: `requires-${factorId}`,
        factorId,
        locality: 'edge-local',
        edgeEvidenceRequirement: 'complete',
        operator: 'equals',
        expectedValue: true,
        routeAggregation: 'every-directed-edge',
        aggregationVersion: ROUTE_SEARCH_CONSTRAINT_AGGREGATION_VERSION,
        unresolvedStates: [...ROUTE_SEARCH_UNRESOLVED_EVIDENCE_STATES],
        unresolvedDisposition: 'exclude-and-report',
      }],
    },
    decisionPolicy: {
      schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionPolicy,
      policyId: 's5-performance-diagnostic-policy',
      hardConstraints: [{
        constraintId: `requires-${factorId}`,
        needTag: 'require-capability',
        factorId,
        operator: 'equals',
        expectedValue: true,
        unresolvedStates: [...UNRESOLVED_OBSERVATION_STATES],
      }],
      softPreferences: [{
        preferenceId: 'prefer-shorter-distance',
        needTag: 'minimize-distance',
        factorId: 'distance-mm',
        operator: 'minimize',
        rangeMin: 0,
        rangeMax: 10_000,
        weightBasisPoints: 10_000,
      }],
      weightBasisPointsTotal: 10_000,
      tieBreak: [
        { factorId: 'score-units', direction: 'descending' },
        { factorId: 'distance-mm', direction: 'ascending' },
        { factorId: 'candidate-id', direction: 'ascending' },
      ],
    },
  });
}

let executedDiagnostic;
async function executeDiagnosticOnce() {
  executedDiagnostic ??= (async () => {
    const workload = await diagnosticRun();
    const session = createRouteS5DiagnosticPerformanceAuthoritySession({ workload });
    const before = session.recompute([]);
    const execution = await session.run();
    return { workload, session, before, ...execution };
  })();
  return executedDiagnostic;
}

test('v1 freezes distinct diagnostic and formal schemas, profiles, order, denominator, and failure policy', () => {
  assert.equal(
    ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.schemaVersion,
    'route-s5-cross-process-performance-protocol/v1',
  );
  assert.notEqual(ROUTE_S5_DIAGNOSTIC_PROFILE.schemaVersion, ROUTE_S5_FORMAL_PROFILE.schemaVersion);
  assert.equal(ROUTE_S5_DIAGNOSTIC_PROFILE.eligibility, 'diagnostic-conformance-excluded');
  assert.equal(ROUTE_S5_FORMAL_PROFILE.eligibility, 'formal-eligible');
  assert.equal(ROUTE_S5_DIAGNOSTIC_PROFILE.denominator.plannedFormalEligible, 0);
  assert.equal(ROUTE_S5_FORMAL_PROFILE.denominator.plannedFormalEligible, 26);
  assert.equal(ROUTE_S5_FORMAL_PROFILE.denominator.plannedWarmup, 4);
  assert.equal(ROUTE_S5_FORMAL_PROFILE.units.length, 8);
  assert.deepEqual(ROUTE_S5_FORMAL_PROFILE.stages, [
    'adapter-input', 'candidate-search', 'decision-evaluation', 'adapter-output',
  ]);
  assert.equal(ROUTE_S5_FORMAL_PROFILE.failurePolicy.notLaunched, 'no-decision-not-executed');
  assert.equal(ROUTE_S5_FORMAL_PROFILE.failurePolicy.measurementUnavailable, 'authority-unavailable');
  assert.equal(ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.exclusions.s4SummaryUpgrade, 'forbidden');
  assert.equal(ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES.status, 'authority-unavailable');
  assert.equal(ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES.cohortManifest.installed, false);
  assert.equal(ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES.measuredReference.installed, false);
  assert.equal(ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES.codeRevisionManifest.installed, false);
  assert.equal(Object.isFrozen(ROUTE_S5_FORMAL_PROFILE.strata[0].thresholds), true);
});

test('parent fully re-admits RouteDecisionIntegrationRun/v1 before session creation and accepts no runner injection', async () => {
  const workload = await diagnosticRun();
  const forged = structuredClone(workload);
  forged.truth.stopped = !forged.truth.stopped;
  assert.throws(
    () => createRouteS5DiagnosticPerformanceAuthoritySession({ workload: forged }),
    /full binding, search, evaluation, explanation, and presentation recomputation/,
  );

  let getterCalls = 0;
  const hostileOptions = {};
  Object.defineProperty(hostileOptions, 'workload', {
    enumerable: true,
    get() { getterCalls += 1; return workload; },
  });
  assert.throws(
    () => createRouteS5DiagnosticPerformanceAuthoritySession(hostileOptions),
    /descriptor does not match/,
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => createRouteS5DiagnosticPerformanceAuthoritySession(new Proxy({ workload }, {})),
    /non-Proxy/,
  );

  const session = createRouteS5DiagnosticPerformanceAuthoritySession({ workload });
  assert.throws(
    () => session.run({ clock: () => 0n, readMemory: () => ({}) }),
    /accepts no injected clock, memory, measurement, result, or other options/,
  );

  const readonlyRoot = {};
  Object.defineProperty(readonlyRoot, 'workload', {
    value: workload,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  assert.throws(
    () => createRouteS5DiagnosticPerformanceAuthoritySession(readonlyRoot),
    /descriptor does not match the mutable container mode/,
  );
  assert.throws(
    () => createRouteS5DiagnosticPerformanceAuthoritySession(
      Object.preventExtensions({ workload }),
    ),
    /either extensible mutable data or fully frozen data/,
  );
  assert.doesNotThrow(
    () => createRouteS5DiagnosticPerformanceAuthoritySession(Object.freeze({ workload })),
  );
});

test('formal entry is authority-unavailable without main-owned unique cohort, measured-reference, and code manifests', async () => {
  const workload = await diagnosticRun();
  assert.throws(
    () => createRouteS5FormalPerformanceAuthoritySession({
      cohortManifest: { runs: Array.from({ length: 26 }, () => workload) },
      measuredReference: { environment: 'caller-self-report' },
      codeRevisionManifest: { revision: 'caller-self-report' },
    }),
    /authority-unavailable: integration\/main-owned unique cohort, admitted measured-reference, and exact code-revision manifests are not installed/,
  );
});

test('four failed warmups mechanically prevent pass even when all 26 measured samples succeed', () => {
  const samples = [
    ...Array.from({ length: 26 }, () => ({ outcome: 'success' })),
    ...Array.from({ length: 4 }, () => ({ outcome: 'failure' })),
  ];
  const classified = classifyRouteS5PerformanceDecisionForInternalRecomputation({
    profile: ROUTE_S5_FORMAL_PROFILE,
    execution: {
      started: true,
      completed: true,
      stopped: false,
      partial: false,
      failure: true,
      launchFailures: [],
    },
    denominator: { missingFormalEligible: 0, missingWarmup: 0 },
    samples,
    measurementUnavailable: false,
    strata: ROUTE_S5_FORMAL_PROFILE.strata.map(({ stratumId }) => ({
      stratumId,
      thresholdSatisfied: true,
    })),
  });
  assert.deepEqual(classified, {
    decision: 'fail',
    reasonCodes: ['completed-formal-collection-failure'],
  });
});

test('short diagnostic run uses two unique fresh Node children and is mechanically excluded from formal authority', async () => {
  const { session, before, receipts, result } = await executeDiagnosticOnce();
  assert.equal(before.schemaVersion, ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.result);
  assert.equal(before.decision, 'no-decision-not-executed');
  assert.deepEqual(before.reasonCodes, ['diagnostic-profile-mechanically-excluded']);
  assert.equal(receipts.length, 2, JSON.stringify(result.execution));
  assert.equal(new Set(receipts.map(({ processIdentity }) => processIdentity.pid)).size, 2);
  assert.equal(receipts.every(({ processIdentity }) => processIdentity.pid !== process.pid), true);
  assert.equal(receipts.every(({ processIdentity }) => processIdentity.ppid === process.pid), true);
  assert.equal(new Set(receipts.map(({ challenge }) => challenge)).size, 2);
  assert.equal(receipts.every(({ sessionNonce }) => sessionNonce === session.preregistration.sessionNonce), true);
  for (const receipt of receipts) {
    assert.equal(receipt.truth.started, true);
    assert.equal(receipt.truth.completed, true);
    assert.equal(receipt.truth.partial, false);
    assert.equal(receipt.samples.length, 1);
    assert.equal(receipt.samples[0].eligibility, 'excluded-diagnostic');
    assert.equal(receipt.samples[0].outcome, 'success');
    assert.deepEqual(receipt.samples[0].timing.stages.map(({ stageId }) => stageId), [
      'adapter-input', 'candidate-search', 'decision-evaluation', 'adapter-output',
    ]);
    assert.equal(receipt.samples[0].memory.observations.length, 5);
    assert.equal(
      receipt.samples[0].workloadExecution.preMeasurementCompletedPipelineRuns,
      0,
    );
    assert.equal(receipt.samples[0].workloadExecution.timedCompletedPipelineRuns, 1);
    assert.equal(
      receipt.samples[0].workloadExecution.firstPipelineCompletionBoundary,
      'adapter-output:inside-timing-window',
    );
    assert.deepEqual(
      receipt.samples[0].workloadExecution.timedStageOrder,
      receipt.samples[0].timing.stages.map(({ stageId }) => stageId),
    );
    assert.deepEqual(receipt.codeRevisionManifest, session.preregistration.codeRevisionManifest);
    assert.match(receipt.codeRevisionManifest.nodeExecutable.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(receipt.codeRevisionManifest.modules.length, 4);
    assert.equal(receipt.environment.hardware.logicalCpuCount > 0, true);
    assert.equal(receipt.environment.hardware.totalMemoryBytes > 0, true);
    assert.equal(receipt.environment.isolation.network, 'not-measured-diagnostic');
    assert.equal(
      JSON.parse(receipt.workloadCarrierCanonicalJson).schemaVersion,
      ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.diagnosticWorkload,
    );
  }
  assert.equal(result.decision, 'no-decision-not-executed');
  assert.equal(result.denominator.observedFormalEligible, 0);
  assert.equal(result.denominator.excludedDiagnostic, 2);
  assert.equal(result.processEvidence.capturedFreshChildCount, 2);
  assert.equal(result.processEvidence.externalAuthorityProven, false);
  assert.equal(result.claimBoundary.formalPerformanceConclusion, 'not-established');
  assert.equal(result.claimBoundary.runtimeReady, false);
  assert.deepEqual(result.codeRevisionManifest, session.preregistration.codeRevisionManifest);
  assert.deepEqual(session.recompute(receipts), result);
  assert.equal(admitPerformanceAuthorityResult(session, result, receipts), result);
});

test('child source performs no full integration-run admission before measurement', async () => {
  const childSource = await readFile(
    new URL('../lib/route_s5_performance_authority/child.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(childSource.includes('admitRouteDecisionIntegrationRun'), false);
  assert.match(
    childSource,
    /bindCanonicalCarrierWithoutWorkloadExecution\(carrier, value\)/,
  );
});

test('manual JSON, cloned, replayed, reordered, and cross-session receipts cannot enter authority recomputation', async () => {
  const { workload, session, receipts } = await executeDiagnosticOnce();
  const cloned = structuredClone(receipts[0]);
  assert.throws(() => session.recompute([cloned]), /manual, cloned, cross-session, or cross-run/);
  assert.throws(() => session.recompute([receipts[0], receipts[0]]), /duplicate/);
  assert.throws(() => session.recompute([receipts[1], receipts[0]]), /order differs/);
  const other = createRouteS5DiagnosticPerformanceAuthoritySession({ workload });
  assert.throws(() => other.recompute(receipts), /cross-session/);
  assert.throws(
    () => session.admitResult(structuredClone(session.recompute(receipts)), receipts),
    /not minted by this opaque runner session/,
  );

  const nonExtensible = Object.preventExtensions([...receipts]);
  assert.throws(
    () => session.recompute(nonExtensible),
    /either extensible mutable data or fully frozen data/,
  );
  assert.throws(
    () => session.recompute(Object.preventExtensions([])),
    /(?:either extensible mutable data or fully frozen data|length descriptor does not match the frozen array mode)/,
  );
  const mixed = [...receipts];
  Object.defineProperty(mixed, '0', {
    value: mixed[0], enumerable: true, writable: false, configurable: false,
  });
  assert.throws(() => session.recompute(mixed), /descriptor does not match the mutable container mode/);
  assert.deepEqual(session.recompute([...receipts]), session.recompute(receipts));
  assert.throws(
    () => session.admitResult(
      session.recompute(receipts),
      Object.preventExtensions([...receipts]),
    ),
    /either extensible mutable data or fully frozen data/,
  );
});

test('parent expectation cross-binds every process identity field to preregistered environment', async () => {
  const { session, receipts } = await executeDiagnosticOnce();
  const preregistered = session.preregistration.units[0];
  const {
    challenge, workloadCarrierCanonicalJson, ...unit
  } = preregistered;
  const expected = {
    sessionId: session.preregistration.sessionId,
    sessionNonce: session.preregistration.sessionNonce,
    challenge,
    preregistrationIdentity: session.preregistration.preregistrationIdentity,
    observedPid: receipts[0].processIdentity.pid,
    unit,
    workloadCarrierCanonicalJson,
    environment: session.preregistration.environment,
    codeRevisionManifest: session.preregistration.codeRevisionManifest,
  };
  const mutations = {
    execPath: 'C:\\forged\\node.exe',
    nodeVersion: 'v0.0.0',
    v8Version: '0.0.0-forged',
    platform: 'forged-platform',
    release: 'forged-release',
    arch: 'forged-arch',
  };
  for (const [field, forgedValue] of Object.entries(mutations)) {
    const raw = structuredClone(receipts[0]);
    delete raw.receiptIdentity;
    raw.processIdentity[field] = forgedValue;
    const forged = sealRouteS5PerformanceReceipt(raw);
    assert.throws(
      () => assertRouteS5ReceiptExpectation(forged, expected),
      new RegExp(`processIdentity\\.${field} cross-binding`),
    );
  }
});

test('receipt conformance fails closed on wrong stage order, clock rollback, memory drift, Proxy, getter, and descriptor attacks', async () => {
  const { receipts } = await executeDiagnosticOnce();
  const receipt = receipts[0];

  const wrongOrder = structuredClone(receipt);
  [wrongOrder.samples[0].timing.stages[0].stageId, wrongOrder.samples[0].timing.stages[1].stageId] = [
    wrongOrder.samples[0].timing.stages[1].stageId,
    wrongOrder.samples[0].timing.stages[0].stageId,
  ];
  assert.throws(() => admitRouteS5PerformanceReceiptConformance(wrongOrder), /stageId/);

  const rollback = structuredClone(receipt);
  rollback.samples[0].timing.stages[0].completedNanoseconds = '0';
  assert.throws(() => admitRouteS5PerformanceReceiptConformance(rollback), /clock rollback/);

  const memoryDrift = structuredClone(receipt);
  memoryDrift.samples[0].memory.rssDeltaBytes += 1;
  assert.throws(() => admitRouteS5PerformanceReceiptConformance(memoryDrift), /rssDeltaBytes/);

  let getterCalls = 0;
  const getter = structuredClone(receipt);
  Object.defineProperty(getter, 'sessionId', {
    enumerable: true,
    get() { getterCalls += 1; return 'forged'; },
  });
  assert.throws(() => admitRouteS5PerformanceReceiptConformance(getter), /own data property/);
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxy = new Proxy(structuredClone(receipt), {
    get() { proxyTraps += 1; return undefined; },
    ownKeys() { proxyTraps += 1; return []; },
  });
  assert.throws(() => admitRouteS5PerformanceReceiptConformance(proxy), /must not be a Proxy/);
  assert.equal(proxyTraps, 0);

  const descriptor = structuredClone(receipt);
  Object.defineProperty(descriptor, 'sessionId', {
    value: descriptor.sessionId,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  assert.throws(() => admitRouteS5PerformanceReceiptConformance(descriptor), /descriptor does not match/);
});

test('clock and memory unavailability are admissible only as explicit partial failure truth and never as authority', async () => {
  const { session, receipts } = await executeDiagnosticOnce();

  const clockRaw = structuredClone(receipts[0]);
  delete clockRaw.receiptIdentity;
  const clockSample = clockRaw.samples[0];
  clockSample.outcome = 'failure';
  clockSample.errorCode = 'clock-throw';
  clockSample.completedStageId = null;
  clockSample.timing.availability = 'unavailable';
  clockSample.timing.failureCode = 'clock-throw';
  clockSample.timing.stages = [];
  clockSample.timing.totalDurationNanoseconds = '0';
  clockSample.workloadExecution.timedStageOrder = [];
  clockSample.workloadExecution.timedCompletedPipelineRuns = 0;
  clockSample.workloadExecution.firstPipelineCompletionBoundary = null;
  clockSample.memory.observations = [clockSample.memory.observations[0]];
  clockSample.memory.rssDeltaBytes = 0;
  clockSample.memory.heapUsedDeltaBytes = 0;
  clockRaw.truth.completed = false;
  clockRaw.truth.partial = true;
  clockRaw.truth.failure = true;
  clockRaw.truth.failureCode = 'clock-throw';
  const clockUnavailable = sealRouteS5PerformanceReceipt(clockRaw);
  assert.equal(
    admitRouteS5PerformanceReceiptConformance(clockUnavailable).truth.partial,
    true,
  );
  assert.throws(() => session.recompute([clockUnavailable]), /manual, cloned, cross-session, or cross-run/);

  const memoryRaw = structuredClone(receipts[0]);
  delete memoryRaw.receiptIdentity;
  const memorySample = memoryRaw.samples[0];
  memorySample.outcome = 'failure';
  memorySample.errorCode = 'memory-throw';
  memorySample.memory.availability = 'unavailable';
  memorySample.memory.failureCode = 'memory-throw';
  memorySample.memory.rssDeltaBytes = null;
  memorySample.memory.heapUsedDeltaBytes = null;
  memoryRaw.truth.completed = false;
  memoryRaw.truth.partial = true;
  memoryRaw.truth.failure = true;
  memoryRaw.truth.failureCode = 'memory-throw';
  const memoryUnavailable = sealRouteS5PerformanceReceipt(memoryRaw);
  assert.equal(
    admitRouteS5PerformanceReceiptConformance(memoryUnavailable).truth.partial,
    true,
  );
  assert.throws(() => session.recompute([memoryUnavailable]), /manual, cloned, cross-session, or cross-run/);
});
