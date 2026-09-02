import { computeBenchmarkMetrics } from './metrics.mjs';
import {
  admitBenchmarkReceipt,
  unavailableDescriptor,
  sealArtifact,
  VERSIONS,
} from './contracts.mjs';
import { deriveRouteSetIdentity, trustedBridgeContext } from './bridge.mjs';
import {
  observeRuntimeEscapes,
  RUNTIME_ESCAPE_MEASUREMENT,
  RUNTIME_ESCAPE_OBSERVER_IDENTITY,
} from './observer.mjs';

const identityKeys = ['engine', 'graph', 'candidateGenerator', 'routeSet', 'evidence'];
const SHA = /^sha256:[0-9a-f]{64}$/;
const DEFAULT_PAIR_DEADLINE_MS = 5000;

export async function runPublicBenchmark({
  corpus,
  manifest,
  policy,
  bridge = null,
  engine = null,
  companion = null,
  runId = 'm7-public-baseline',
  pairDeadlineMs = DEFAULT_PAIR_DEADLINE_MS,
}) {
  const bridgeContext = trustedBridgeContext(bridge);
  if (!bridgeContext) {
    const reasonCode = engine || companion || bridge
      ? 'unverified-custom-runtime' : 'engine-unavailable';
    return unavailableReceipt({
      corpus,
      manifest,
      policy,
      runId,
      reasonCode,
      privacyObservation: noRuntimePrivacyObservation(),
    });
  }
  if (!Number.isSafeInteger(pairDeadlineMs) || pairDeadlineMs < 1 || pairDeadlineMs > 60000) {
    throw new TypeError('pairDeadlineMs must be an integer from 1 through 60000');
  }

  const observed = await observeRuntimeEscapes(async () => {
    const observations = [];
    for (const pair of corpus.pairs) {
      observations.push(await runPair({ bridge, pair, policy, pairDeadlineMs }));
    }
    return observations;
  });
  if (observed.egressCount !== 0) {
    throw new Error(`benchmark observed ${observed.egressCount} runtime escape attempt(s): ${observed.eventTypes.join(',')}`);
  }

  // Preserve the independently recomputed identities for the future formal
  // OS-deny admission path. They are intentionally not admitted into an
  // unavailable receipt, whose contract requires all identities to be null.
  deriveRuntimeIdentities(bridgeContext, observed.value);
  return unavailableReceipt({
    corpus,
    manifest,
    policy,
    runId,
    reasonCode: 'os-outbound-deny-observation-unavailable',
    privacyObservation: {
      egressCount: observed.egressCount,
      measurement: observed.measurement,
      measurementStatus: observed.measurementStatus,
      enforcement: observed.enforcement,
      observerIdentity: observed.observerIdentity,
      privateCoordinatesTransmitted: false,
    },
  });
}

async function runPair({ bridge, pair, policy, pairDeadlineMs }) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('benchmark pair deadline exceeded')), pairDeadlineMs);
  try {
    const generated = await bridge.generate({
      pair: structuredClone(pair),
      policy: structuredClone(policy),
      signal: controller.signal,
    });
    return projectObservation(generated, pair.pairId, performance.now() - started, policy.candidateLimit);
  } catch {
    const reasonCode = controller.signal.aborted ? 'pair-deadline-exceeded' : 'generation-error';
    return invalidObservation(pair.pairId, performance.now() - started, reasonCode);
  } finally {
    clearTimeout(timeout);
  }
}

function deriveRuntimeIdentities(bridgeContext, observations) {
  return Object.freeze({
    engine: descriptor(bridgeContext.artifactIdentities.engine),
    graph: descriptor(bridgeContext.artifactIdentities.graph),
    candidateGenerator: descriptor(bridgeContext.artifactIdentities.candidateGenerator),
    routeSet: descriptor(deriveRouteSetIdentity(observations)),
    evidence: descriptor(bridgeContext.artifactIdentities.evidence),
  });
}

function unavailableReceipt({
  corpus, manifest, policy, runId, reasonCode, privacyObservation,
}) {
  const observations = corpus.pairs.map(({ pairId }) => ({ pairId, status: 'unavailable', reasonCode }));
  const { denominator, metrics } = computeBenchmarkMetrics(observations, corpus.pairs.length);
  return sealAndAdmit({
    schemaVersion: VERSIONS.receipt,
    runId,
    status: 'unavailable',
    reasonCodes: [reasonCode, 'graph-and-runtime-identities-not-observed'],
    manifestIdentity: manifest.identity,
    corpusIdentity: corpus.identity,
    policyIdentity: policy.identity,
    identities: Object.fromEntries(identityKeys.map((key) => [key, unavailableDescriptor()])),
    denominator,
    metrics,
    privacy: privacyObservation,
    observations,
    identity: null,
  }, { corpus, manifest, policy });
}

function noRuntimePrivacyObservation() {
  return {
    egressCount: 0,
    measurement: 'runner-owned-no-runtime-executed',
    measurementStatus: 'not-run',
    enforcement: 'no-runtime-executed',
    observerIdentity: null,
    privateCoordinatesTransmitted: false,
  };
}

function sealAndAdmit(value, inputs) {
  const receipt = sealArtifact(value);
  return admitBenchmarkReceipt(receipt, inputs);
}

function descriptor(identity) { return { status: 'available', identity }; }

function projectObservation(generated, pairId, latencyMs, candidateLimit) {
  if (!generated || typeof generated !== 'object' || Array.isArray(generated)) {
    return invalidObservation(pairId, latencyMs, 'invalid-companion-result');
  }
  if (generated.status === 'unavailable') {
    return { pairId, status: 'unavailable', reasonCode: safeReasonCode(generated.reasonCode, 'runtime-unavailable') };
  }
  if (generated.status === 'invalid') {
    return invalidObservation(pairId, latencyMs, safeReasonCode(generated.reasonCode, 'generation-invalid'));
  }
  if (generated.status !== 'success' || !Array.isArray(generated.candidates)
    || generated.candidates.length < 1 || generated.candidates.length > candidateLimit
    || generated.candidates.some(({ candidateIdentity }) => !SHA.test(candidateIdentity || ''))) {
    return invalidObservation(pairId, latencyMs, 'invalid-companion-result');
  }
  return {
    pairId,
    status: 'success',
    latencyMs,
    candidates: generated.candidates.map(projectCandidate),
  };
}

function projectCandidate(candidate) {
  const evidenceValid = Number.isSafeInteger(candidate.evidence?.coveredSegmentCount)
    && candidate.evidence.coveredSegmentCount >= 0
    && Number.isSafeInteger(candidate.evidence?.totalSegmentCount)
    && candidate.evidence.totalSegmentCount > 0
    && candidate.evidence.coveredSegmentCount <= candidate.evidence.totalSegmentCount;
  return {
    candidateIdentity: candidate.candidateIdentity,
    mapMatchDistanceM: nonNegativeFiniteOrNull(candidate.mapMatchDistanceM),
    routeDistanceM: nonNegativeFiniteOrNull(candidate.routeDistanceM),
    straightLineDistanceM: positiveFiniteOrNull(candidate.straightLineDistanceM),
    evidence: evidenceValid ? {
      coveredSegmentCount: candidate.evidence.coveredSegmentCount,
      totalSegmentCount: candidate.evidence.totalSegmentCount,
    } : { coveredSegmentCount: null, totalSegmentCount: null },
    weightSensitivityChanged: typeof candidate.weightSensitivityChanged === 'boolean'
      ? candidate.weightSensitivityChanged : null,
  };
}

function invalidObservation(pairId, latencyMs, reasonCode) {
  return { pairId, status: 'invalid', reasonCode, latencyMs, candidates: [] };
}
function nonNegativeFiniteOrNull(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function positiveFiniteOrNull(value) { return Number.isFinite(value) && value > 0 ? value : null; }
function safeReasonCode(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : fallback;
}

export const __testOnly = Object.freeze({
  projectObservation,
  deriveRuntimeIdentities,
  RUNTIME_ESCAPE_MEASUREMENT,
  RUNTIME_ESCAPE_OBSERVER_IDENTITY,
});
