#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  admitCityRouteDecisionBinding,
  projectBindingEvidenceForSearch,
} from '../../../src/route_decision/integration/index.js';
import {
  canonicalStringify,
  sameData,
  snapshotData,
} from '../../../src/route_decision/integration/contract_support.js';
import { evaluateAdmittedRouteSearchDecision } from '../../../src/route_decision/evaluator/search_v2.js';
import {
  buildRouteDecisionExplanation,
  projectRouteDecisionExplanationPresentation,
} from '../../../src/route_decision/explanation/index.js';
import { searchRouteCandidates } from '../../../src/route_generation/candidate_search/index.js';

import {
  ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS,
} from './protocol.mjs';
import {
  sealRouteS5PerformanceReceipt,
} from './receipt.mjs';

const STAGES = ['adapter-input', 'candidate-search', 'decision-evaluation', 'adapter-output'];
const MAX_STDIN_BYTES = 16 * 1024 * 1024;
const CODE_MODULES = [
  ['childModule', fileURLToPath(import.meta.url)],
  ['protocolModule', fileURLToPath(new URL('./protocol.mjs', import.meta.url))],
  ['receiptModule', fileURLToPath(new URL('./receipt.mjs', import.meta.url))],
  ['runnerModule', fileURLToPath(new URL('./runner.mjs', import.meta.url))],
];

function childFail(message) {
  throw new TypeError(`Route S5 performance child: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) childFail(`${label} must be an object`);
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    childFail(`${label} has a schema mismatch`);
  }
}

function captureEnvironment() {
  const cpuModels = [...new Set(os.cpus().map(({ model }) => model))].sort();
  const environmentEntries = Object.entries(process.env)
    .map(([key, value]) => ({ key, value: value ?? '' }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  return {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.environment,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    execPath: process.execPath,
    execArgv: [...process.execArgv],
    cwd: process.cwd(),
    hardware: {
      cpuModels,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    isolation: {
      network: 'not-measured-diagnostic',
      backgroundLoad: 'not-measured-diagnostic',
      powerMode: 'not-measured-diagnostic',
      processIsolation: 'fresh-child-capture-only',
      authority: 'runner-captured-diagnostic-only',
    },
    environmentEntries,
  };
}

function captureCodeRevisionManifest() {
  return {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.codeRevisionManifest,
    authority: 'runner-captured-diagnostic-not-main-owned',
    nodeExecutable: {
      execPath: process.execPath,
      nodeVersion: process.version,
      digest: `sha256:${createHash('sha256').update(readFileSync(process.execPath)).digest('hex')}`,
    },
    modules: CODE_MODULES.map(([moduleId, path]) => ({
      moduleId,
      moduleUrl: pathToFileURL(path).href,
      digest: `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`,
    })),
    limitation: 'exact local bytes captured by this runner; not cryptographic signer, host authenticity, or integration/main-owned authority',
  };
}

function admitCommand(raw) {
  const value = snapshotData(raw, 'child command', childFail);
  exactKeys(value, [
    'schemaVersion', 'protocolVersion', 'runnerVersion', 'sessionId', 'sessionNonce',
    'challenge', 'preregistrationIdentity', 'unit', 'workloadCarrierCanonicalJson',
    'expectedEnvironment', 'codeRevisionManifest',
  ], 'child command');
  if (value.schemaVersion !== ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.childCommand
    || value.protocolVersion !== ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.protocol
    || value.runnerVersion !== ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.runner) {
    childFail('command version is unsupported');
  }
  if (typeof value.workloadCarrierCanonicalJson !== 'string') childFail('workload carrier must be exact JSON text');
  let carrier;
  try {
    carrier = JSON.parse(value.workloadCarrierCanonicalJson);
  } catch {
    childFail('workload carrier is not JSON');
  }
  const boundCarrier = bindCanonicalCarrierWithoutWorkloadExecution(carrier, value);
  const actualEnvironment = captureEnvironment();
  if (!sameData(actualEnvironment, value.expectedEnvironment)) childFail('captured child environment differs from preregistration');
  const actualCodeRevisionManifest = captureCodeRevisionManifest();
  if (!sameData(actualCodeRevisionManifest, value.codeRevisionManifest)) {
    childFail('captured child code revision differs from preregistration');
  }
  return {
    value,
    boundRuns: boundCarrier.runs,
    actualEnvironment,
    actualCodeRevisionManifest,
  };
}

export function bindCanonicalCarrierWithoutWorkloadExecution(rawCarrier, command) {
  const carrier = snapshotData(rawCarrier, 'child structural workload carrier', childFail);
  exactKeys(carrier, ['schemaVersion', 'stratumId', 'runs'], 'child structural workload carrier');
  if (![ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.diagnosticWorkload,
    ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.formalWorkload].includes(carrier.schemaVersion)) {
    childFail('child structural workload carrier version is unsupported');
  }
  if (carrier.stratumId !== command.unit.stratumId) childFail('child structural workload carrier stratum drifted');
  if (!Array.isArray(carrier.runs) || carrier.runs.length < 1 || carrier.runs.length > 32) {
    childFail('child structural workload carrier must contain 1..32 runs');
  }
  const runKeys = [
    'schemaVersion', 'binding', 'searchRequest', 'decisionPolicy', 'searchResult',
    'decisionEvaluation', 'explanation', 'presentation', 'truth', 'revisions',
    'claimBoundary', 'runIdentity',
  ];
  for (const [index, run] of carrier.runs.entries()) {
    exactKeys(run, runKeys, `child structural workload carrier.runs[${index}]`);
    if (run.schemaVersion !== 'engagement-route-decision-integration-run/v1') {
      childFail('child structural workload carrier run version is unsupported');
    }
    if (!run.runIdentity || typeof run.runIdentity !== 'object'
      || typeof run.runIdentity.digest !== 'string') {
      childFail('child structural workload carrier run identity is missing');
    }
  }
  if (canonicalStringify(carrier) !== command.workloadCarrierCanonicalJson) {
    childFail('child structural workload carrier is not the exact canonical parent carrier');
  }
  return carrier;
}

function readMemory(boundaryId) {
  const observed = process.memoryUsage();
  if (!Number.isSafeInteger(observed.rss) || observed.rss < 0
    || !Number.isSafeInteger(observed.heapUsed) || observed.heapUsed < 0) {
    throw new TypeError('process.memoryUsage returned invalid values');
  }
  return { boundaryId, rssBytes: observed.rss, heapUsedBytes: observed.heapUsed };
}

function operationsFor(runs) {
  const state = {
    bindings: null,
    searches: null,
    evaluations: null,
    completedPipelineRuns: 0,
  };
  const operations = {
    'adapter-input'() {
      state.bindings = runs.map(({ binding }) => admitCityRouteDecisionBinding(binding));
    },
    'candidate-search'() {
      state.searches = runs.map((run, index) => {
        const factorIds = run.searchRequest.hardConstraints.map(({ factorId }) => factorId);
        return searchRouteCandidates(
          state.bindings[index].cityAdaptationResult.graphArtifact,
          run.searchRequest,
          projectBindingEvidenceForSearch(state.bindings[index], factorIds),
        );
      });
    },
    'decision-evaluation'() {
      state.evaluations = runs.map((run, index) => evaluateAdmittedRouteSearchDecision({
        policy: run.decisionPolicy,
        candidateArtifact: state.searches[index],
      }));
    },
    'adapter-output'() {
      for (const [index, run] of runs.entries()) {
        const explanation = buildRouteDecisionExplanation({ decisionEvaluation: state.evaluations[index] });
        const presentation = projectRouteDecisionExplanationPresentation(explanation);
        if (!sameData(explanation, run.explanation) || !sameData(presentation, run.presentation)) {
          throw new TypeError('typed run output recomputation drifted');
        }
      }
      state.completedPipelineRuns = runs.length;
    },
  };
  return { operations, state };
}

function timing(stages, availability = 'available', failureCode = null) {
  return {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.timing,
    clockSource: 'process.hrtime.bigint',
    unit: 'nanoseconds',
    availability,
    failureCode,
    stages,
    totalDurationNanoseconds: stages.reduce(
      (sum, stage) => sum + BigInt(stage.durationNanoseconds),
      0n,
    ).toString(),
  };
}

function memory(observations, availability = 'available', failureCode = null) {
  if (availability === 'unavailable') {
    return {
      schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.memory,
      source: 'process.memoryUsage',
      unit: 'bytes',
      semantics: 'baseline-and-each-completed-stage-boundary-max-minus-baseline-clamped-zero',
      availability,
      failureCode,
      observations,
      rssDeltaBytes: null,
      heapUsedDeltaBytes: null,
    };
  }
  const baseline = observations[0];
  return {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.memory,
    source: 'process.memoryUsage',
    unit: 'bytes',
    semantics: 'baseline-and-each-completed-stage-boundary-max-minus-baseline-clamped-zero',
    availability,
    failureCode,
    observations,
    rssDeltaBytes: Math.max(0, Math.max(...observations.map(({ rssBytes }) => rssBytes)) - baseline.rssBytes),
    heapUsedDeltaBytes: Math.max(0, Math.max(...observations.map(({ heapUsedBytes }) => heapUsedBytes)) - baseline.heapUsedBytes),
  };
}

async function measureSample(slot, runs) {
  const startedAt = new Date().toISOString();
  const stageMeasurements = [];
  const memoryObservations = [];
  let timingAvailability = 'available';
  let timingFailure = null;
  let memoryAvailability = 'available';
  let memoryFailure = null;
  let outcome = 'success';
  let errorCode = null;

  try {
    memoryObservations.push(readMemory('sample-baseline'));
  } catch {
    memoryAvailability = 'unavailable';
    memoryFailure = 'memory-throw';
    outcome = 'failure';
    errorCode = 'memory-throw';
  }

  const workloadExecution = operationsFor(runs);
  const { operations } = workloadExecution;
  if (memoryAvailability === 'available') {
    for (const stageId of STAGES) {
      let started;
      try {
        started = process.hrtime.bigint();
      } catch {
        timingAvailability = 'unavailable';
        timingFailure = 'clock-throw';
        outcome = 'failure';
        errorCode = 'clock-throw';
        break;
      }
      let operationFailed = false;
      try {
        await operations[stageId]();
      } catch {
        operationFailed = true;
        outcome = 'failure';
        errorCode = 'stage-operation-failed';
      }
      let completed;
      try {
        completed = process.hrtime.bigint();
      } catch {
        timingAvailability = 'unavailable';
        timingFailure = 'clock-throw';
        outcome = 'failure';
        errorCode = 'clock-throw';
        break;
      }
      if (completed < started) {
        timingAvailability = 'unavailable';
        timingFailure = 'clock-rollback';
        outcome = 'failure';
        errorCode = 'clock-rollback';
        break;
      }
      stageMeasurements.push({
        stageId,
        startedNanoseconds: started.toString(),
        completedNanoseconds: completed.toString(),
        durationNanoseconds: (completed - started).toString(),
      });
      try {
        memoryObservations.push(readMemory(`${stageId}:completed`));
      } catch {
        memoryAvailability = 'unavailable';
        memoryFailure = 'memory-throw';
        outcome = 'failure';
        errorCode = 'memory-throw';
        break;
      }
      if (operationFailed) break;
    }
  }

  return {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.sample,
    ordinal: slot.ordinal,
    phase: slot.phase,
    phaseIndex: slot.phaseIndex,
    eligibility: slot.eligibility,
    startedAt,
    completedAt: new Date().toISOString(),
    outcome,
    errorCode,
    completedStageId: stageMeasurements.at(-1)?.stageId ?? null,
    timing: timing(stageMeasurements, timingAvailability, timingFailure),
    memory: memory(memoryObservations, memoryAvailability, memoryFailure),
    workloadExecution: {
      schemaVersion: 'route-s5-performance-workload-execution-trace/v1',
      preMeasurementCompletedPipelineRuns: 0,
      timedStageOrder: stageMeasurements.map(({ stageId }) => stageId),
      timedCompletedPipelineRuns: stageMeasurements.at(-1)?.stageId === 'adapter-output'
        ? workloadExecution.state.completedPipelineRuns : 0,
      firstPipelineCompletionBoundary: stageMeasurements.at(-1)?.stageId === 'adapter-output'
        ? 'adapter-output:inside-timing-window' : null,
    },
  };
}

async function execute(command) {
  const {
    value, boundRuns, actualEnvironment, actualCodeRevisionManifest,
  } = admitCommand(command);
  const startedAt = new Date().toISOString();
  const samples = [];
  for (const slot of value.unit.slots) {
    const sample = await measureSample(slot, boundRuns);
    samples.push(sample);
    if (sample.timing.availability === 'unavailable'
      || sample.memory.availability === 'unavailable') break;
  }
  const partial = samples.length !== value.unit.slots.length
    || samples.some((sample) => sample.timing.availability === 'unavailable'
      || sample.memory.availability === 'unavailable');
  const stopped = samples.some(({ outcome }) => outcome === 'stopped');
  const failure = samples.some(({ outcome }) => outcome === 'failure');
  const failureCode = samples.find(({ errorCode }) => errorCode !== null)?.errorCode ?? null;
  return sealRouteS5PerformanceReceipt({
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.receipt,
    protocolVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.protocol,
    runnerVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.runner,
    sessionId: value.sessionId,
    sessionNonce: value.sessionNonce,
    challenge: value.challenge,
    preregistrationIdentity: value.preregistrationIdentity,
    unit: value.unit,
    workloadCarrierCanonicalJson: value.workloadCarrierCanonicalJson,
    processIdentity: {
      pid: process.pid,
      ppid: process.ppid,
      execPath: process.execPath,
      nodeVersion: process.version,
      v8Version: process.versions.v8,
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
    },
    environment: actualEnvironment,
    codeRevisionManifest: actualCodeRevisionManifest,
    startedAt,
    completedAt: new Date().toISOString(),
    samples,
    truth: {
      started: true,
      completed: !partial,
      stopped,
      partial,
      failure,
      failureCode,
    },
  });
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input, 'utf8') > MAX_STDIN_BYTES) process.exitCode = 2;
});
process.stdin.on('end', async () => {
  if (process.exitCode) return;
  try {
    const receipt = await execute(JSON.parse(input));
    process.stdout.write(JSON.stringify(receipt));
  } catch {
    process.exitCode = 2;
  }
});
