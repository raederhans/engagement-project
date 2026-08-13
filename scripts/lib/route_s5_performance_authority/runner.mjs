import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types as nodeTypes } from 'node:util';

import { admitRouteDecisionIntegrationRun } from '../../../src/route_decision/integration/index.js';
import {
  canonicalStringify,
  contentIdentity,
  contractFail,
  deepFreeze,
  sameData,
} from '../../../src/route_decision/integration/contract_support.js';

import {
  ROUTE_S5_DIAGNOSTIC_PROFILE,
  ROUTE_S5_FORMAL_PROFILE,
  ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL,
  ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS,
} from './protocol.mjs';
import {
  admitRouteS5PerformanceReceiptConformance,
  assertRouteS5ReceiptExpectation,
  canonicalRouteS5PerformanceWorkloadCarrier,
} from './receipt.mjs';

const CHILD_PATH = fileURLToPath(new URL('./child.mjs', import.meta.url));
const CODE_MODULES = [
  ['childModule', CHILD_PATH],
  ['protocolModule', fileURLToPath(new URL('./protocol.mjs', import.meta.url))],
  ['receiptModule', fileURLToPath(new URL('./receipt.mjs', import.meta.url))],
  ['runnerModule', fileURLToPath(import.meta.url)],
];
const MAX_CHILD_OUTPUT_BYTES = 20 * 1024 * 1024;
const SESSION_STATE = new WeakMap();
const RECEIPT_STATE = new WeakMap();
const RESULT_STATE = new WeakMap();
let capturedCodeRevisionManifest;
const ENVIRONMENT_KEYS = [
  'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL', 'LOGONSERVER', 'NODE_ENV',
  'PATH', 'PATHEXT', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TZ', 'USERDOMAIN',
  'USERNAME', 'USERPROFILE', 'WINDIR',
];

function fail(message) {
  contractFail('Route S5 performance authority runner', message);
}

function inspectContainer(raw, label, expectedArray) {
  if (!raw || typeof raw !== 'object' || nodeTypes.isProxy(raw)) {
    fail(`${label} must be a non-Proxy object`);
  }
  let prototype;
  let keys;
  let descriptors;
  let extensible;
  let frozen;
  try {
    prototype = Object.getPrototypeOf(raw);
    keys = Reflect.ownKeys(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
    extensible = Object.isExtensible(raw);
    frozen = Object.isFrozen(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  const isArray = Array.isArray(raw);
  if (isArray !== expectedArray
    || prototype !== (expectedArray ? Array.prototype : Object.prototype)) {
    fail(`${label} must be a standard ${expectedArray ? 'array' : 'plain object'}`);
  }
  if (keys.some((key) => typeof key === 'symbol')) fail(`${label} must contain string keys only`);
  let mode;
  if (extensible === true) mode = 'mutable';
  else if (frozen === true) mode = 'frozen';
  else fail(`${label} must be either extensible mutable data or fully frozen data`);
  const expectedMutable = mode === 'mutable';
  if (expectedArray) {
    const length = descriptors.length;
    if (!length || !Object.hasOwn(length, 'value') || length.enumerable !== false
      || length.configurable !== false || length.writable !== expectedMutable) {
      fail(`${label}.length descriptor does not match the ${mode} array mode`);
    }
  }
  for (const key of keys) {
    if (expectedArray && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true
      || descriptor.writable !== expectedMutable || descriptor.configurable !== expectedMutable) {
      fail(`${label}.${String(key)} descriptor does not match the ${mode} container mode`);
    }
  }
  return { keys, descriptors, mode };
}

function exactOptions(raw, keys, label) {
  const { keys: ownKeys, descriptors } = inspectContainer(raw, label, false);
  if (ownKeys.some((key) => typeof key === 'symbol')
    || ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) {
    fail(`${label} must have exact keys: ${keys.join(', ')}`);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function exactReferenceArray(raw, maximum, label) {
  const { keys, descriptors } = inspectContainer(raw, label, true);
  if (raw.length > maximum) fail(`${label} exceeds the preregistered unit count`);
  if (descriptors.length.value !== raw.length) fail(`${label}.length value is invalid`);
  if (keys.length !== raw.length + 1) fail(`${label} must be dense without extra properties`);
  const output = [];
  for (let index = 0; index < raw.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail(`${label} must be dense without sparse entries`);
    output.push(descriptor.value);
  }
  return output;
}

function selectedEnvironment() {
  const sourceEntries = Object.entries(process.env);
  const env = {};
  for (const requestedKey of ENVIRONMENT_KEYS) {
    const entry = sourceEntries.find(([key]) => key.toUpperCase() === requestedKey);
    if (entry) env[requestedKey] = entry[1] ?? '';
  }
  return env;
}

function capturedChildEnvironment(env) {
  const cpuModels = [...new Set(os.cpus().map(({ model }) => model))].sort();
  return {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.environment,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    execPath: process.execPath,
    execArgv: [],
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
    environmentEntries: Object.entries(env)
      .map(([key, value]) => ({ key, value }))
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  };
}

function captureCodeRevisionManifest() {
  capturedCodeRevisionManifest ??= deepFreeze({
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
  });
  return capturedCodeRevisionManifest;
}

function randomId(prefix) {
  return `${prefix}${randomBytes(24).toString('hex')}`;
}

function carrierFor(schemaVersion, stratumId, runs) {
  return canonicalRouteS5PerformanceWorkloadCarrier({ schemaVersion, stratumId, runs });
}

function diagnosticConfiguration(raw) {
  const { workload } = exactOptions(raw, ['workload'], 'diagnostic session options');
  const admitted = admitRouteDecisionIntegrationRun(workload);
  return {
    profile: ROUTE_S5_DIAGNOSTIC_PROFILE,
    carriers: new Map([[
      'diagnostic-conformance',
      carrierFor(
        ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.diagnosticWorkload,
        'diagnostic-conformance',
        [admitted],
      ),
    ]]),
    workloadIdentities: [admitted.runIdentity.digest],
  };
}

function createSession(configuration) {
  const environmentVariables = selectedEnvironment();
  const environment = deepFreeze(capturedChildEnvironment(environmentVariables));
  const codeRevisionManifest = captureCodeRevisionManifest();
  const sessionId = randomId('s5pa-');
  const sessionNonce = randomId('nonce-');
  const challenges = configuration.profile.units.map(() => randomId('challenge-'));
  if (new Set(challenges).size !== challenges.length) fail('generated child challenges are not unique');
  const preregistrationWithoutIdentity = {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.preregistration,
    protocol: ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL,
    sessionId,
    sessionNonce,
    createdAt: new Date().toISOString(),
    profile: configuration.profile,
    environment,
    codeRevisionManifest,
    workloadIdentities: [...configuration.workloadIdentities],
    units: configuration.profile.units.map((unit, index) => ({
      ...unit,
      challenge: challenges[index],
      workloadCarrierCanonicalJson: configuration.carriers.get(unit.stratumId),
    })),
  };
  const preregistrationIdentity = contentIdentity(
    'route-s5-performance-preregistration-identity/v1',
    'route-s5-performance-preregistration-canonical-json/v1',
    preregistrationWithoutIdentity,
  ).digest;
  const preregistration = deepFreeze({
    ...preregistrationWithoutIdentity,
    preregistrationIdentity,
  });
  const session = Object.freeze({
    preregistration,
    run(...args) {
      if (args.length) fail('runner execution accepts no injected clock, memory, measurement, result, or other options');
      return runSession(session);
    },
    recompute(receipts) {
      return recomputeSessionResult(session, receipts);
    },
    admitResult(result, receipts) {
      return admitSessionResult(session, result, receipts);
    },
  });
  SESSION_STATE.set(session, {
    configuration,
    preregistration,
    environmentVariables,
    environment,
    codeRevisionManifest,
    runState: 'not-executed',
    receipts: [],
    launchFailures: [],
    pids: new Set(),
    challenges: new Set(),
    receiptIdentities: new Set(),
  });
  return session;
}

export function createRouteS5DiagnosticPerformanceAuthoritySession(input) {
  return createSession(diagnosticConfiguration(input));
}

export function createRouteS5FormalPerformanceAuthoritySession() {
  fail('authority-unavailable: integration/main-owned unique cohort, admitted measured-reference, and exact code-revision manifests are not installed');
}

async function runSession(session) {
  const state = requireSession(session);
  if (state.runState !== 'not-executed') fail('opaque runner session can execute only once');
  state.runState = 'running';
  for (const preregisteredUnit of state.preregistration.units) {
    const { challenge, workloadCarrierCanonicalJson, ...unit } = preregisteredUnit;
    const command = {
      schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.childCommand,
      protocolVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.protocol,
      runnerVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.runner,
      sessionId: state.preregistration.sessionId,
      sessionNonce: state.preregistration.sessionNonce,
      challenge,
      preregistrationIdentity: state.preregistration.preregistrationIdentity,
      unit,
      workloadCarrierCanonicalJson,
      expectedEnvironment: state.environment,
      codeRevisionManifest: state.preregistration.codeRevisionManifest,
    };
    const launched = await launchChild(command, state);
    if (!launched.ok) {
      state.launchFailures.push(deepFreeze({
        unitOrdinal: unit.unitOrdinal,
        code: launched.code,
        observedPid: launched.observedPid,
      }));
      break;
    }
    let admitted;
    try {
      admitted = assertRouteS5ReceiptExpectation(launched.rawReceipt, {
        sessionId: state.preregistration.sessionId,
        sessionNonce: state.preregistration.sessionNonce,
        challenge,
        preregistrationIdentity: state.preregistration.preregistrationIdentity,
        observedPid: launched.observedPid,
        unit,
        workloadCarrierCanonicalJson,
        environment: state.environment,
        codeRevisionManifest: state.preregistration.codeRevisionManifest,
      });
      assertUniqueSource(state, admitted);
    } catch {
      state.launchFailures.push(deepFreeze({
        unitOrdinal: unit.unitOrdinal,
        code: 'receipt-validation-failed',
        observedPid: launched.observedPid,
      }));
      break;
    }
    RECEIPT_STATE.set(admitted, { session, unitOrdinal: unit.unitOrdinal });
    state.receipts.push(admitted);
  }
  state.runState = state.receipts.length === state.preregistration.units.length
    && state.launchFailures.length === 0 ? 'completed' : 'partial';
  const receipts = Object.freeze([...state.receipts]);
  const result = recomputeSessionResult(session, receipts);
  return deepFreeze({ receipts, result });
}

function assertUniqueSource(state, receipt) {
  if (state.pids.has(receipt.processIdentity.pid)) fail('duplicate child pid in opaque runner session');
  if (state.challenges.has(receipt.challenge)) fail('duplicate child challenge in opaque runner session');
  if (state.receiptIdentities.has(receipt.receiptIdentity)) fail('duplicate or replayed child receipt identity');
  state.pids.add(receipt.processIdentity.pid);
  state.challenges.add(receipt.challenge);
  state.receiptIdentities.add(receipt.receiptIdentity);
}

function launchChild(command, state) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [CHILD_PATH], {
        cwd: state.environment.cwd,
        env: state.environmentVariables,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve({ ok: false, code: 'child-spawn-threw', observedPid: null });
      return;
    }
    const observedPid = child.pid ?? null;
    let stdout = '';
    let stderr = '';
    let overflow = false;
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, state.configuration.profile.childTimeoutMilliseconds);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > MAX_CHILD_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, code: 'child-process-error', observedPid });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) return resolve({ ok: false, code: 'child-timeout', observedPid });
      if (overflow) return resolve({ ok: false, code: 'child-output-overflow', observedPid });
      if (signal !== null) return resolve({ ok: false, code: 'child-aborted-by-signal', observedPid });
      if (code !== 0) return resolve({ ok: false, code: 'child-crash-or-failure', observedPid });
      if (stderr.length !== 0) return resolve({ ok: false, code: 'child-unexpected-stderr', observedPid });
      let rawReceipt;
      try {
        rawReceipt = JSON.parse(stdout);
      } catch {
        return resolve({ ok: false, code: 'child-invalid-json', observedPid });
      }
      return resolve({ ok: true, rawReceipt, observedPid });
    });
    try {
      child.stdin.end(JSON.stringify(command));
    } catch {
      child.kill();
    }
  });
}

function recomputeSessionResult(session, rawReceipts) {
  const state = requireSession(session);
  const receipts = exactReferenceArray(rawReceipts, state.preregistration.units.length, 'authority receipts');
  const seenPids = new Set();
  const seenChallenges = new Set();
  const seenIdentities = new Set();
  receipts.forEach((receipt, index) => {
    admitRouteS5PerformanceReceiptConformance(receipt);
    if (seenPids.has(receipt.processIdentity.pid)) fail('duplicate child pid in authority receipts');
    if (seenChallenges.has(receipt.challenge)) fail('duplicate or replayed child challenge in authority receipts');
    if (seenIdentities.has(receipt.receiptIdentity)) fail('duplicate or replayed receipt identity');
    const brand = RECEIPT_STATE.get(receipt);
    if (!brand || brand.session !== session) fail('manual, cloned, cross-session, or cross-run receipt has no authority');
    if (brand.unitOrdinal !== index + 1) fail('receipt order differs from preregistered unit order');
    seenPids.add(receipt.processIdentity.pid);
    seenChallenges.add(receipt.challenge);
    seenIdentities.add(receipt.receiptIdentity);
  });
  const samples = receipts.flatMap(({ samples }) => samples);
  const formalSamples = samples.filter(({ eligibility }) => eligibility === 'measured-formal');
  const warmups = samples.filter(({ eligibility }) => eligibility === 'excluded-warmup');
  const diagnostics = samples.filter(({ eligibility }) => eligibility === 'excluded-diagnostic');
  const denominator = {
    plannedFormalEligible: state.configuration.profile.denominator.plannedFormalEligible,
    observedFormalEligible: formalSamples.length,
    missingFormalEligible: state.configuration.profile.denominator.plannedFormalEligible - formalSamples.length,
    plannedWarmup: state.configuration.profile.denominator.plannedWarmup,
    observedWarmup: warmups.length,
    missingWarmup: state.configuration.profile.denominator.plannedWarmup - warmups.length,
    plannedDiagnostic: state.configuration.profile.denominator.plannedDiagnostic,
    observedDiagnostic: diagnostics.length,
    excludedDiagnostic: diagnostics.length,
    excludedWarmup: warmups.length,
  };
  const execution = {
    started: state.runState !== 'not-executed',
    completed: state.runState === 'completed'
      && receipts.length === state.preregistration.units.length
      && receipts.every(({ truth }) => truth.completed),
    stopped: receipts.some(({ truth }) => truth.stopped),
    partial: state.runState === 'partial'
      || (state.runState !== 'not-executed' && receipts.length !== state.preregistration.units.length)
      || receipts.some(({ truth }) => truth.partial),
    failure: state.launchFailures.length > 0 || receipts.some(({ truth }) => truth.failure),
    launchFailures: state.launchFailures.map((failure) => ({ ...failure })),
  };
  const measurementUnavailable = samples.some((sample) => (
    sample.timing.availability === 'unavailable' || sample.memory.availability === 'unavailable'
  ));
  const strata = state.configuration.profile.eligibility === 'formal-eligible'
    ? state.configuration.profile.strata.map((stratum) => recomputeStratum(stratum, formalSamples)) : [];
  const { decision, reasonCodes } = decide(
    state.configuration.profile,
    execution,
    denominator,
    samples,
    measurementUnavailable,
    strata,
  );
  const resultWithoutIdentity = {
    schemaVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.result,
    protocolVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.protocol,
    runnerVersion: ROUTE_S5_PERFORMANCE_AUTHORITY_VERSIONS.runner,
    sessionId: state.preregistration.sessionId,
    preregistrationIdentity: state.preregistration.preregistrationIdentity,
    profileSchemaVersion: state.configuration.profile.schemaVersion,
    eligibility: state.configuration.profile.eligibility,
    receiptIdentities: receipts.map(({ receiptIdentity: identity }) => identity),
    codeRevisionManifest: state.preregistration.codeRevisionManifest,
    processEvidence: {
      capturedFreshChildCount: receipts.length,
      uniqueCapturedPids: [...seenPids],
      uniqueChallenges: seenChallenges.size,
      source: 'parent-observed-child-process-and-exact-receipt-binding',
      limitation: ROUTE_S5_PERFORMANCE_AUTHORITY_PROTOCOL.processSemantics.limitation,
      externalAuthorityProven: false,
    },
    execution,
    denominator,
    strata,
    decision,
    reasonCodes,
    claimBoundary: {
      scope: 'synthetic-engineering-performance-only',
      formalPerformanceConclusion: ['pass', 'fail'].includes(decision)
        ? decision : 'not-established',
      runtimeReady: false,
      externalHostAuthenticity: false,
      safetyOrRecommendationClaim: false,
      limitations: [
        'not-runtime-or-public-admission',
        'not-safety-or-safer-route-advice',
        'not-user-or-scientific-evidence',
        'captured-process-identity-is-not-os-host-or-external-authority-proof',
      ],
    },
  };
  const result = deepFreeze({
    ...resultWithoutIdentity,
    resultIdentity: contentIdentity(
      'PerformanceAuthorityResult-identity/v1',
      'PerformanceAuthorityResult-canonical-json/v1',
      resultWithoutIdentity,
    ).digest,
  });
  RESULT_STATE.set(result, { session, receipts: Object.freeze([...receipts]) });
  return result;
}

function recomputeStratum(stratum, samples) {
  const eligible = samples.filter(({ ordinal }) => {
    const unit = ROUTE_S5_FORMAL_PROFILE.units.find(({ slots }) => slots.some((slot) => slot.ordinal === ordinal));
    return unit?.stratumId === stratum.stratumId;
  });
  const successful = eligible.filter(({ outcome }) => outcome === 'success');
  const durations = successful.map(({ timing }) => BigInt(timing.totalDurationNanoseconds));
  const sorted = [...durations].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const p95 = sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null;
  const maximumRss = successful.length ? Math.max(...successful.map(({ memory }) => memory.rssDeltaBytes)) : null;
  const maximumHeap = successful.length ? Math.max(...successful.map(({ memory }) => memory.heapUsedDeltaBytes)) : null;
  return {
    stratumId: stratum.stratumId,
    observedEligible: eligible.length,
    successfulEligible: successful.length,
    totalP95Nanoseconds: p95?.toString() ?? null,
    maximumRssDeltaBytes: maximumRss,
    maximumHeapUsedDeltaBytes: maximumHeap,
    thresholds: { ...stratum.thresholds },
    thresholdSatisfied: p95 !== null
      && p95 <= BigInt(stratum.thresholds.totalP95Nanoseconds)
      && maximumRss <= stratum.thresholds.maximumRssDeltaBytes
      && maximumHeap <= stratum.thresholds.maximumHeapUsedDeltaBytes,
  };
}

export function classifyRouteS5PerformanceDecisionForInternalRecomputation({
  profile,
  execution,
  denominator,
  samples,
  measurementUnavailable,
  strata,
}) {
  if (profile.eligibility !== 'formal-eligible') {
    return { decision: 'no-decision-not-executed', reasonCodes: ['diagnostic-profile-mechanically-excluded'] };
  }
  if (!execution.started) return { decision: 'no-decision-not-executed', reasonCodes: ['formal-run-not-executed'] };
  if (execution.launchFailures.length || measurementUnavailable) {
    return { decision: 'authority-unavailable', reasonCodes: ['child-or-measurement-authority-unavailable'] };
  }
  if (execution.stopped || execution.partial || !execution.completed
    || denominator.missingFormalEligible !== 0 || denominator.missingWarmup !== 0) {
    return { decision: 'no-decision-partial', reasonCodes: ['formal-preregistered-denominator-incomplete'] };
  }
  if (execution.failure || samples.some(({ outcome }) => outcome !== 'success')) {
    return { decision: 'fail', reasonCodes: ['completed-formal-collection-failure'] };
  }
  if (strata.some(({ thresholdSatisfied }) => !thresholdSatisfied)) {
    return { decision: 'fail', reasonCodes: ['formal-threshold-exceeded'] };
  }
  return { decision: 'pass', reasonCodes: ['complete-formal-denominator-and-thresholds-satisfied'] };
}

function decide(profile, execution, denominator, samples, measurementUnavailable, strata) {
  return classifyRouteS5PerformanceDecisionForInternalRecomputation({
    profile, execution, denominator, samples, measurementUnavailable, strata,
  });
}

function admitSessionResult(session, result, rawReceipts) {
  requireSession(session);
  const brand = RESULT_STATE.get(result);
  if (!brand || brand.session !== session) fail('PerformanceAuthorityResult is not minted by this opaque runner session');
  const receipts = exactReferenceArray(rawReceipts, brand.receipts.length, 'result receipts');
  if (receipts.length !== brand.receipts.length
    || receipts.some((receipt, index) => receipt !== brand.receipts[index])) {
    fail('PerformanceAuthorityResult receipts differ from its exact recomputation inputs');
  }
  const recomputed = recomputeSessionResult(session, receipts);
  if (!sameData(result, recomputed)) fail('PerformanceAuthorityResult is not independently recomputable');
  return result;
}

function requireSession(session) {
  const state = SESSION_STATE.get(session);
  if (!state) fail('opaque runner session is invalid');
  return state;
}

export function recomputePerformanceAuthorityResult(session, receipts) {
  return recomputeSessionResult(session, receipts);
}

export function admitPerformanceAuthorityResult(session, result, receipts) {
  return admitSessionResult(session, result, receipts);
}
