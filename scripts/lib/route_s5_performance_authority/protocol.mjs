import { ROUTE_S4_PERFORMANCE_PROTOCOL } from '../route_s4_performance/index.mjs';
import { deepFreeze } from '../../../src/route_decision/integration/contract_support.js';

export const ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS = deepFreeze({
  protocol: 'route-s5-cross-process-performance-protocol/v1',
  diagnosticProfile: 'route-s5-performance-diagnostic-profile/v1',
  formalProfile: 'route-s5-performance-formal-profile/v1',
  diagnosticWorkload: 'route-s5-performance-diagnostic-workload/v1',
  formalWorkload: 'route-s5-performance-formal-workload/v1',
  preregistration: 'route-s5-performance-preregistration/v1',
  childCommand: 'route-s5-performance-child-command/v1',
  receipt: 'route-s5-performance-child-receipt/v1',
  sample: 'route-s5-performance-child-sample/v1',
  timing: 'route-s5-performance-monotonic-timing/v1',
  memory: 'route-s5-performance-memory-observation/v1',
  environment: 'route-s5-performance-captured-environment/v1',
  measuredReference: 'route-s5-performance-measured-reference/v1',
  cohortManifest: 'route-s5-performance-cohort-manifest/v1',
  codeRevisionManifest: 'route-s5-performance-code-revision-manifest/v1',
  result: 'PerformanceAuthorityResult/v1',
  runner: 'route-s5-performance-runner/v1',
});

const STAGES = [...ROUTE_S4_PERFORMANCE_PROTOCOL.stages];
const S4_STRATA = ROUTE_S4_PERFORMANCE_PROTOCOL.strata.map((stratum) => ({
  stratumId: stratum.stratumId,
  graph: { ...stratum.graph },
  requestCount: stratum.requestCount,
  candidateLimit: stratum.candidateLimit,
  thresholds: { ...stratum.thresholds },
}));

function formalUnits() {
  const units = [];
  let unitOrdinal = 1;
  let sampleOrdinal = 1;
  for (const stratum of S4_STRATA) {
    for (let phaseIndex = 1; phaseIndex <= 3; phaseIndex += 1) {
      units.push({
        unitOrdinal: unitOrdinal++,
        stratumId: stratum.stratumId,
        processClass: 'fresh-cold-process',
        slots: [{
          ordinal: sampleOrdinal++, phase: 'cold', phaseIndex, eligibility: 'measured-formal',
        }],
      });
    }
    const slots = [];
    for (let phaseIndex = 1; phaseIndex <= 2; phaseIndex += 1) {
      slots.push({
        ordinal: sampleOrdinal++, phase: 'warmup', phaseIndex, eligibility: 'excluded-warmup',
      });
    }
    for (let phaseIndex = 1; phaseIndex <= 10; phaseIndex += 1) {
      slots.push({
        ordinal: sampleOrdinal++, phase: 'warm', phaseIndex, eligibility: 'measured-formal',
      });
    }
    units.push({
      unitOrdinal: unitOrdinal++,
      stratumId: stratum.stratumId,
      processClass: 'fresh-warm-sequence-process',
      slots,
    });
  }
  return units;
}

export const ROUTE_S5_DIAGNOSTIC_PROFILE = deepFreeze({
  schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.diagnosticProfile,
  eligibility: 'diagnostic-conformance-excluded',
  evidenceScope: 'synthetic-engineering-conformance-only',
  stages: STAGES,
  units: [1, 2].map((unitOrdinal) => ({
    unitOrdinal,
    stratumId: 'diagnostic-conformance',
    processClass: 'fresh-diagnostic-process',
    slots: [{
      ordinal: unitOrdinal,
      phase: 'diagnostic',
      phaseIndex: unitOrdinal,
      eligibility: 'excluded-diagnostic',
    }],
  })),
  denominator: {
    plannedFormalEligible: 0,
    plannedWarmup: 0,
    plannedDiagnostic: 2,
  },
  thresholds: null,
  failurePolicy: {
    diagnosticConclusion: 'no-decision-not-executed',
    measurementUnavailable: 'authority-unavailable',
    incompleteExecution: 'no-decision-partial',
  },
  childTimeoutMilliseconds: 10_000,
});

export const ROUTE_S5_FORMAL_PROFILE = deepFreeze({
  schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.formalProfile,
  eligibility: 'formal-eligible',
  evidenceScope: 'synthetic-engineering-performance-only',
  stages: STAGES,
  strata: S4_STRATA,
  units: formalUnits(),
  denominator: {
    plannedFormalEligible: 26,
    plannedWarmup: 4,
    plannedDiagnostic: 0,
  },
  quantile: 'nearest-rank-ceiling-p95',
  failurePolicy: {
    notLaunched: 'no-decision-not-executed',
    incompleteExecution: 'no-decision-partial',
    stoppedExecution: 'no-decision-partial',
    measurementUnavailable: 'authority-unavailable',
    childCrashOrTimeout: 'authority-unavailable',
    completedCollectionFailure: 'fail',
    thresholdExceeded: 'fail',
    allThresholdsSatisfied: 'pass',
  },
  childTimeoutMilliseconds: 60_000,
});

export const ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES = deepFreeze({
  schemaVersion: 'route-s5-performance-formal-authority-prerequisites/v1',
  status: 'authority-unavailable',
  cohortManifest: {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.cohortManifest,
    authority: 'integration-main-owned-module-private-admission-required',
    requirements: [
      'exact-preregistered-strata-and-request-counts',
      'unique-RouteDecisionIntegrationRun-v1-runIdentity-per-cohort-entry',
      'no-caller-duplication-or-denominator-padding',
      'full-parent-side-run-recomputation-before-session-creation',
    ],
    installed: false,
  },
  measuredReference: {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.measuredReference,
    authority: 'integration-main-owned-capture-and-admission-required',
    requiredFields: [
      'operatingSystem', 'hardware', 'runtime', 'network', 'backgroundLoad',
      'powerMode', 'processIsolation', 'capturedAt',
    ],
    installed: false,
  },
  codeRevisionManifest: {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.codeRevisionManifest,
    authority: 'integration-main-owned-exact-revision-admission-required',
    requiredBindings: [
      'nodeExecutable', 'childModule', 'runnerModule', 'receiptModule', 'protocolModule',
    ],
    installed: false,
  },
  decisionWithoutAllPrerequisites: 'authority-unavailable',
});

export const ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL = deepFreeze({
  schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.protocol,
  runnerVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.runner,
  parentAdmission: 'full-RouteDecisionIntegrationRun-v1-recomputation-before-launch',
  processBoundary: 'parent-spawns-exact-node-execPath-child-per-frozen-unit',
  inputCarrier: 'exact-canonical-json-of-fully-admitted-typed-workload',
  sourceBinding: 'opaque-session-plus-session-nonce-plus-per-child-challenge-plus-observed-pid',
  processSemantics: {
    capturedFacts: ['pid', 'ppid', 'execPath', 'nodeVersion', 'v8Version', 'platform', 'release', 'arch'],
    uniqueness: 'pid-sessionNonce-challenge-and-receipt-identity-must-be-unique-per-unit',
    limitation: 'captured-process-identifiers-and-environment-bind-this-runner-capture-only; they do not prove OS, host, or external authority authenticity',
  },
  formalAuthorityPrerequisites: ROUTE_S5_FORMAL_AUTHORITY_PREREQUISITES,
  measurement: {
    clock: 'child-process.hrtime.bigint-direct-no-injection',
    memory: 'child-process.memoryUsage-direct-no-injection',
    timing: 'raw-monotonic-start-end-and-derived-duration-per-stage',
    memorySemantics: 'sample-baseline-and-each-completed-stage-boundary; maxima-minus-baseline-clamped-at-zero',
    coldStart: 'child-performs-canonical-structure-and-identity-binding-only-before-timing; workload pipeline first executes inside frozen timed stages',
  },
  exclusions: {
    diagnostic: 'mechanically-excluded',
    warmup: 'mechanically-excluded',
    s3Observations: 'forbidden',
    s4SummaryUpgrade: 'forbidden',
    manualJson: 'conformance-only-never-authority',
    clonedReceipt: 'forbidden',
    crossSessionReceipt: 'forbidden',
    crossRunReceipt: 'forbidden',
    runnerCapturedCodeDigestAuthority: 'diagnostic-binding-only-not-cryptographic-or-main-owned-authority',
  },
  profiles: [ROUTE_S5_DIAGNOSTIC_PROFILE, ROUTE_S5_FORMAL_PROFILE],
});
