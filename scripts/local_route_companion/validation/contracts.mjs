import { assertCanonicalIdentity, canonicalIdentity, identityPayload } from './canonical.mjs';
import { computeBenchmarkMetrics } from './metrics.mjs';
import {
  qaEligibleUniverseIdentity,
  qaSampleId,
  qaSelectionRank,
  selectDeterministicQaSample,
} from './qa.mjs';

export const VERSIONS = Object.freeze({
  corpus: 'mainline-m7-public-od-corpus/v1',
  policy: 'mainline-m7-validation-policy/v1',
  manifest: 'mainline-m7-validation-manifest/v1',
  receipt: 'mainline-m7-benchmark-receipt/v1',
  thresholds: 'mainline-m7-performance-thresholds/v1',
  qaPolicy: 'mainline-m7-qa-sampling-policy/v1',
  qaTemplate: 'mainline-m7-qa-adjudication-template/v1',
  qaSampleManifest: 'mainline-m7-qa-sample-manifest/v1',
  qaReceipt: 'mainline-m7-qa-receipt/v1',
});

const SHA = /^sha256:[0-9a-f]{64}$/;
const REGIONS = ['center', 'west', 'north', 'south', 'northeast'];
const DISTANCE_CLASSES = ['short', 'medium'];
const FEATURE_TAGS = ['bridge', 'park', 'superblock', 'dead-end', 'walkway'];
const admittedBenchmarkReceipts = new WeakSet();

export const EXACT_KEYS = Object.freeze({
  corpus: ['schemaVersion', 'corpusId', 'licenseBoundary', 'coordinateSystem', 'pairs', 'identity'],
  pair: ['pairId', 'region', 'distanceClass', 'featureTags', 'origin', 'destination'],
  point: ['publicLandmark', 'latitude', 'longitude'],
  policy: ['schemaVersion', 'policyId', 'candidateLimit', 'mode', 'percentileMethod', 'metricDefinitions', 'privacy', 'identity'],
  metricDefinitions: ['generationSuccessRate', 'invalidRate', 'duplicateCandidateRate', 'latency', 'mapMatchDistance', 'segmentEvidenceCoverageRate', 'detour', 'weightSensitivityChangeRate'],
  policyPrivacy: ['requiredEgressCount', 'privateOdAllowed'],
  manifest: ['schemaVersion', 'manifestId', 'corpus', 'policy', 'executionBoundary', 'identity'],
  manifestCorpus: ['identity', 'pairCount'],
  manifestPolicy: ['identity'],
  descriptor: ['status', 'identity'],
  receipt: ['schemaVersion', 'runId', 'status', 'reasonCodes', 'manifestIdentity', 'corpusIdentity', 'policyIdentity', 'identities', 'denominator', 'metrics', 'privacy', 'observations', 'identity'],
  identities: ['engine', 'graph', 'candidateGenerator', 'routeSet', 'evidence'],
  denominator: ['plannedPairs', 'attemptedPairs', 'successfulPairs', 'invalidPairs', 'unavailablePairs', 'generatedCandidates', 'sensitivityEligibleRoutes'],
  metrics: ['generationSuccessRate', 'invalidRate', 'duplicateCandidateRate', 'latencyMedianMs', 'latencyP95Ms', 'mapMatchDistanceMedianM', 'mapMatchDistanceP95M', 'segmentEvidenceCoverageRate', 'detourMedianRatio', 'detourP95Ratio', 'weightSensitivityChangeRate'],
  privacy: ['egressCount', 'measurement', 'measurementStatus', 'enforcement', 'observerIdentity', 'privateCoordinatesTransmitted'],
  successObservation: ['pairId', 'status', 'latencyMs', 'candidates'],
  invalidObservation: ['pairId', 'status', 'reasonCode', 'latencyMs', 'candidates'],
  unavailableObservation: ['pairId', 'status', 'reasonCode'],
  candidateObservation: ['candidateIdentity', 'mapMatchDistanceM', 'routeDistanceM', 'straightLineDistanceM', 'evidence', 'weightSensitivityChanged'],
  candidateEvidence: ['coveredSegmentCount', 'totalSegmentCount'],
  thresholds: ['schemaVersion', 'status', 'frozen', 'baselineReceiptIdentity', 'freezeSequence', 'thresholds', 'reasonCodes', 'identity'],
  thresholdValues: ['minimumGenerationSuccessRate', 'maximumInvalidRate', 'maximumDuplicateCandidateRate', 'maximumLatencyP95Ms', 'maximumMapMatchDistanceP95M', 'minimumSegmentEvidenceCoverageRate', 'maximumDetourP95Ratio', 'maximumWeightSensitivityChangeRate'],
  qaPolicy: ['schemaVersion', 'policyId', 'targetSegmentCount', 'samplingMethod', 'ordering', 'strata', 'identity'],
  qaTemplate: ['schemaVersion', 'sampleId', 'segmentIdentity', 'routeIdentity', 'reviewerOne', 'reviewerTwo', 'adjudication', 'identity'],
  reviewer: ['reviewerId', 'decision', 'reasonCode', 'reviewedAt'],
  adjudication: ['status', 'decision', 'adjudicatorId', 'reasonCode', 'adjudicatedAt'],
  qaSampleManifest: ['schemaVersion', 'status', 'qaPolicyIdentity', 'benchmarkReceiptIdentity', 'targetSegmentCount', 'samplingMethod', 'eligibleUniverseIdentity', 'eligibleSegmentCount', 'samples', 'reasonCodes', 'identity'],
  qaSample: ['sampleId', 'segmentIdentity', 'routeIdentity', 'selectionRank'],
  qaEligibleSegment: ['segmentIdentity', 'routeIdentity', 'region', 'distanceClass', 'featureTags'],
  qaReceipt: ['schemaVersion', 'status', 'qaPolicyIdentity', 'benchmarkReceiptIdentity', 'sampleManifestIdentity', 'adjudicationRecordIdentities', 'targetSegmentCount', 'sampledSegmentCount', 'reviewerOneCompletedCount', 'reviewerTwoCompletedCount', 'twoReviewerCompleted', 'adjudicatedCount', 'reasonCodes', 'identity'],
});

export function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} exact keys mismatch: expected ${wanted.join(',')}; got ${actual.join(',')}`);
  }
}

function assertIdentity(value, label) {
  if (!SHA.test(value || '')) throw new Error(`${label} must be a canonical sha256 identity`);
}

function assertPoint(point, label) {
  assertExactKeys(point, EXACT_KEYS.point, label);
  if (typeof point.publicLandmark !== 'string' || point.publicLandmark.length < 2) throw new Error(`${label} publicLandmark is required`);
  if (!Number.isFinite(point.latitude) || point.latitude < 39.8 || point.latitude > 40.2) throw new Error(`${label} latitude is outside Philadelphia corpus bounds`);
  if (!Number.isFinite(point.longitude) || point.longitude < -75.35 || point.longitude > -74.9) throw new Error(`${label} longitude is outside Philadelphia corpus bounds`);
}

export function admitCorpus(corpus) {
  assertExactKeys(corpus, EXACT_KEYS.corpus, 'corpus');
  if (corpus.schemaVersion !== VERSIONS.corpus || corpus.coordinateSystem !== 'WGS84') throw new Error('unsupported corpus contract');
  if (corpus.licenseBoundary !== 'public-landmarks-and-coordinates-only') throw new Error('corpus is not public-only');
  if (!Array.isArray(corpus.pairs) || corpus.pairs.length !== 40) throw new Error('corpus must contain exactly 40 OD pairs');
  const ids = new Set();
  const regionCounts = Object.fromEntries(REGIONS.map((region) => [region, 0]));
  const distanceCounts = Object.fromEntries(DISTANCE_CLASSES.map((kind) => [kind, 0]));
  const tagCounts = Object.fromEntries(FEATURE_TAGS.map((tag) => [tag, 0]));
  for (const [index, pair] of corpus.pairs.entries()) {
    assertExactKeys(pair, EXACT_KEYS.pair, `pair[${index}]`);
    if (ids.has(pair.pairId)) throw new Error(`duplicate pairId ${pair.pairId}`);
    ids.add(pair.pairId);
    if (!REGIONS.includes(pair.region)) throw new Error(`pair ${pair.pairId} has unsupported region`);
    if (!DISTANCE_CLASSES.includes(pair.distanceClass)) throw new Error(`pair ${pair.pairId} has unsupported distanceClass`);
    if (!Array.isArray(pair.featureTags) || pair.featureTags.some((tag) => !FEATURE_TAGS.includes(tag))) throw new Error(`pair ${pair.pairId} has unsupported feature tag`);
    assertPoint(pair.origin, `pair ${pair.pairId} origin`);
    assertPoint(pair.destination, `pair ${pair.pairId} destination`);
    regionCounts[pair.region] += 1;
    distanceCounts[pair.distanceClass] += 1;
    for (const tag of new Set(pair.featureTags)) tagCounts[tag] += 1;
  }
  if (Object.values(regionCounts).some((count) => count !== 8)) throw new Error(`corpus region coverage must be exactly 8 each: ${JSON.stringify(regionCounts)}`);
  if (Object.values(distanceCounts).some((count) => count === 0)) throw new Error('corpus must cover short and medium distances');
  if (Object.values(tagCounts).some((count) => count === 0)) throw new Error(`corpus feature coverage is incomplete: ${JSON.stringify(tagCounts)}`);
  assertCanonicalIdentity(corpus, 'identity', 'corpus');
  return corpus;
}

export function admitPolicy(policy) {
  assertExactKeys(policy, EXACT_KEYS.policy, 'policy');
  assertExactKeys(policy.metricDefinitions, EXACT_KEYS.metricDefinitions, 'policy.metricDefinitions');
  assertExactKeys(policy.privacy, EXACT_KEYS.policyPrivacy, 'policy.privacy');
  if (policy.schemaVersion !== VERSIONS.policy || policy.mode !== 'walk') throw new Error('unsupported policy contract');
  if (!Number.isSafeInteger(policy.candidateLimit) || policy.candidateLimit < 1 || policy.candidateLimit > 5) throw new Error('candidateLimit must be bounded from 1 through 5');
  if (policy.percentileMethod !== 'nearest-rank') throw new Error('percentile method must be nearest-rank');
  if (policy.privacy?.requiredEgressCount !== 0 || policy.privacy?.privateOdAllowed !== false) throw new Error('privacy policy must require zero egress and forbid private OD');
  assertCanonicalIdentity(policy, 'identity', 'policy');
  return policy;
}

export function admitManifest(manifest, corpus, policy) {
  assertExactKeys(manifest, EXACT_KEYS.manifest, 'manifest');
  assertExactKeys(manifest.corpus, EXACT_KEYS.manifestCorpus, 'manifest.corpus');
  assertExactKeys(manifest.policy, EXACT_KEYS.manifestPolicy, 'manifest.policy');
  if (manifest.schemaVersion !== VERSIONS.manifest) throw new Error('unsupported manifest contract');
  if (manifest.corpus.identity !== corpus.identity || manifest.corpus.pairCount !== 40) throw new Error('manifest corpus binding mismatch');
  if (manifest.policy.identity !== policy.identity) throw new Error('manifest policy binding mismatch');
  if (manifest.executionBoundary !== 'offline-local-no-network') throw new Error('manifest execution boundary must be offline-local-no-network');
  assertCanonicalIdentity(manifest, 'identity', 'manifest');
  return manifest;
}

export function unavailableDescriptor() {
  return Object.freeze({ status: 'unavailable', identity: null });
}

export function assertDescriptor(value, label) {
  assertExactKeys(value, EXACT_KEYS.descriptor, label);
  if (!['available', 'unavailable'].includes(value.status)) throw new Error(`${label} status is invalid`);
  if (value.status === 'available') assertIdentity(value.identity, `${label}.identity`);
  else if (value.identity !== null) throw new Error(`${label} unavailable identity must be null`);
}

export function sealArtifact(value) {
  const artifact = structuredClone(value);
  artifact.identity = canonicalIdentity(identityPayload(artifact));
  return artifact;
}

export const coverageVocabulary = Object.freeze({ REGIONS, DISTANCE_CLASSES, FEATURE_TAGS });

export function admitBenchmarkReceipt(receipt, { corpus, manifest, policy }) {
  assertExactKeys(receipt, EXACT_KEYS.receipt, 'benchmark receipt');
  if (receipt.schemaVersion !== VERSIONS.receipt) throw new Error('unsupported benchmark receipt contract');
  if (!['available', 'unavailable'].includes(receipt.status)) throw new Error('benchmark receipt status is invalid');
  if (receipt.manifestIdentity !== manifest.identity || receipt.corpusIdentity !== corpus.identity || receipt.policyIdentity !== policy.identity) throw new Error('benchmark receipt input identity binding mismatch');
  assertExactKeys(receipt.identities, EXACT_KEYS.identities, 'benchmark identities');
  for (const [key, descriptor] of Object.entries(receipt.identities)) assertDescriptor(descriptor, `benchmark identities.${key}`);
  assertExactKeys(receipt.denominator, EXACT_KEYS.denominator, 'benchmark denominator');
  assertExactKeys(receipt.metrics, EXACT_KEYS.metrics, 'benchmark metrics');
  assertExactKeys(receipt.privacy, EXACT_KEYS.privacy, 'benchmark privacy');
  if (receipt.denominator.plannedPairs !== corpus.pairs.length) throw new Error('planned pair denominator does not match corpus');
  const integerKeys = EXACT_KEYS.denominator;
  if (integerKeys.some((key) => !Number.isSafeInteger(receipt.denominator[key]) || receipt.denominator[key] < 0)) throw new Error('benchmark denominator values must be non-negative integers');
  if (receipt.denominator.attemptedPairs !== receipt.denominator.successfulPairs + receipt.denominator.invalidPairs) throw new Error('attempted denominator must equal successful plus invalid');
  if (receipt.denominator.plannedPairs !== receipt.denominator.attemptedPairs + receipt.denominator.unavailablePairs) throw new Error('planned denominator must equal attempted plus unavailable');
  admitPrivacyObservation(receipt.privacy, receipt.status, receipt.denominator);
  if (!Array.isArray(receipt.reasonCodes) || receipt.reasonCodes.some((reason) => !isReasonCode(reason))) throw new Error('benchmark reason codes are invalid');
  if (!Array.isArray(receipt.observations) || receipt.observations.length !== corpus.pairs.length) throw new Error('benchmark observations must cover the exact corpus denominator');
  const pairIds = new Set(corpus.pairs.map(({ pairId }) => pairId));
  const observedPairIds = new Set();
  for (const [index, observation] of receipt.observations.entries()) {
    admitObservation(observation, `benchmark observations[${index}]`);
    if (!pairIds.has(observation.pairId) || observedPairIds.has(observation.pairId)) throw new Error('benchmark observation pair binding is missing or duplicated');
    observedPairIds.add(observation.pairId);
  }
  if (receipt.status === 'unavailable') {
    if (Object.values(receipt.metrics).some((value) => value !== null)) throw new Error('unavailable benchmark metrics must remain null');
    if (Object.values(receipt.identities).some(({ status, identity }) => status !== 'unavailable' || identity !== null)) throw new Error('unavailable benchmark identities must remain unavailable');
    if (receipt.observations.some(({ status }) => status !== 'unavailable')) throw new Error('unavailable benchmark observations must remain unavailable');
  } else if (Object.values(receipt.identities).some(({ status }) => status !== 'available')) {
    throw new Error('available benchmark requires all five runtime identities');
  } else if (receipt.denominator.unavailablePairs !== 0
    || receipt.observations.some(({ status }) => !['success', 'invalid'].includes(status))) {
    throw new Error('available benchmark cannot contain unavailable observations');
  } else if (receipt.denominator.successfulPairs < 1
    || receipt.denominator.generatedCandidates < 1
    || Object.values(receipt.metrics).some((value) => !Number.isFinite(value))) {
    throw new Error('available benchmark requires complete finite metrics from at least one generated route');
  }
  if (receipt.status === 'available') {
    throw new Error('available benchmark admission is disabled until a verifier-bound OS observation artifact contract exists');
  }
  const recomputed = computeBenchmarkMetrics(receipt.observations, corpus.pairs.length);
  if (JSON.stringify(recomputed.denominator) !== JSON.stringify(receipt.denominator)) throw new Error('benchmark denominator does not match observations');
  if (JSON.stringify(recomputed.metrics) !== JSON.stringify(receipt.metrics)) throw new Error('benchmark metrics do not match observations');
  assertCanonicalIdentity(receipt, 'identity', 'benchmark receipt');
  admittedBenchmarkReceipts.add(receipt);
  return receipt;
}

function admitPrivacyObservation(privacy, receiptStatus, denominator) {
  if (privacy.egressCount !== 0 || privacy.privateCoordinatesTransmitted !== false) {
    throw new Error('privacy egress must be mechanically zero');
  }
  if (typeof privacy.measurement !== 'string' || privacy.measurement.length < 1) {
    throw new Error('privacy measurement is required');
  }
  if (receiptStatus === 'available') {
    if (privacy.measurementStatus !== 'observed'
      || privacy.enforcement !== 'os-outbound-deny') {
      throw new Error('available benchmark requires an independent OS outbound-deny observation');
    }
    assertIdentity(privacy.observerIdentity, 'benchmark privacy observerIdentity');
    return;
  }
  if (privacy.measurementStatus === 'not-run') {
    if (privacy.enforcement !== 'no-runtime-executed'
      || privacy.observerIdentity !== null || denominator.attemptedPairs !== 0) {
      throw new Error('not-run privacy evidence requires a no-runtime unavailable receipt');
    }
    return;
  }
  if (privacy.measurementStatus === 'observed') {
    if (!['attempt-detection-only', 'os-outbound-deny'].includes(privacy.enforcement)) {
      throw new Error('observed privacy enforcement is unsupported');
    }
    assertIdentity(privacy.observerIdentity, 'benchmark privacy observerIdentity');
    return;
  }
  throw new Error('benchmark privacy measurement status is invalid');
}

function admitObservation(observation, label) {
  if (observation?.status === 'success') {
    assertExactKeys(observation, EXACT_KEYS.successObservation, label);
    if (!Number.isFinite(observation.latencyMs) || observation.latencyMs < 0
      || !Array.isArray(observation.candidates) || observation.candidates.length < 1) {
      throw new Error(`${label} successful observation is invalid`);
    }
    observation.candidates.forEach((candidate, index) => admitCandidateObservation(candidate, `${label}.candidates[${index}]`));
    return;
  }
  if (observation?.status === 'invalid') {
    assertExactKeys(observation, EXACT_KEYS.invalidObservation, label);
    if (!isReasonCode(observation.reasonCode) || !Number.isFinite(observation.latencyMs)
      || observation.latencyMs < 0 || !Array.isArray(observation.candidates)
      || observation.candidates.length !== 0) {
      throw new Error(`${label} invalid observation is invalid`);
    }
    return;
  }
  if (observation?.status === 'unavailable') {
    assertExactKeys(observation, EXACT_KEYS.unavailableObservation, label);
    if (!isReasonCode(observation.reasonCode)) throw new Error(`${label} unavailable reason code is invalid`);
    return;
  }
  throw new Error(`${label} status is invalid`);
}

function admitCandidateObservation(candidate, label) {
  assertExactKeys(candidate, EXACT_KEYS.candidateObservation, label);
  assertExactKeys(candidate.evidence, EXACT_KEYS.candidateEvidence, `${label}.evidence`);
  assertIdentity(candidate.candidateIdentity, `${label}.candidateIdentity`);
  for (const key of ['mapMatchDistanceM', 'routeDistanceM', 'straightLineDistanceM']) {
    if (candidate[key] !== null && (!Number.isFinite(candidate[key]) || candidate[key] < 0)) throw new Error(`${label}.${key} is invalid`);
  }
  for (const key of ['coveredSegmentCount', 'totalSegmentCount']) {
    if (candidate.evidence[key] !== null
      && (!Number.isSafeInteger(candidate.evidence[key]) || candidate.evidence[key] < 0)) {
      throw new Error(`${label}.evidence.${key} is invalid`);
    }
  }
  if ((candidate.evidence.coveredSegmentCount === null) !== (candidate.evidence.totalSegmentCount === null)
    || candidate.evidence.coveredSegmentCount > candidate.evidence.totalSegmentCount
    || (candidate.weightSensitivityChanged !== null && typeof candidate.weightSensitivityChanged !== 'boolean')) {
    throw new Error(`${label} fail-closed evidence fields are inconsistent`);
  }
}

function isReasonCode(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function admitThresholds(artifact, baselineReceipt) {
  assertExactKeys(artifact, EXACT_KEYS.thresholds, 'performance thresholds');
  assertExactKeys(artifact.thresholds, EXACT_KEYS.thresholdValues, 'performance threshold values');
  if (artifact.schemaVersion !== VERSIONS.thresholds || artifact.freezeSequence !== 'baseline-first-then-formal-threshold-freeze') throw new Error('unsupported threshold contract');
  if (!['available', 'unavailable'].includes(artifact.status)) throw new Error('performance threshold status is invalid');
  if (artifact.baselineReceiptIdentity !== baselineReceipt.identity) throw new Error('threshold artifact is not identity-bound to baseline');
  if (!Array.isArray(artifact.reasonCodes) || artifact.reasonCodes.some((reason) => !isReasonCode(reason))) throw new Error('performance threshold reason codes are invalid');
  if (baselineReceipt.status !== 'available') {
    if (artifact.status !== 'unavailable' || artifact.frozen !== false) throw new Error('threshold cannot be frozen before an available baseline');
    if (Object.values(artifact.thresholds).some((value) => value !== null)) throw new Error('unavailable thresholds must remain null');
    if (artifact.reasonCodes.length < 1) throw new Error('unavailable thresholds require a reason code');
  } else {
    if (!admittedBenchmarkReceipts.has(baselineReceipt)) throw new Error('available thresholds require an admitted benchmark receipt');
    if (artifact.status !== 'available' || artifact.frozen !== true) throw new Error('available baseline requires available frozen thresholds');
    if (artifact.reasonCodes.length !== 0) throw new Error('available thresholds cannot carry unavailability reason codes');
    assertThresholdRange(artifact.thresholds.minimumGenerationSuccessRate, 'minimumGenerationSuccessRate', 0, 1);
    assertThresholdRange(artifact.thresholds.maximumInvalidRate, 'maximumInvalidRate', 0, 1);
    assertThresholdRange(artifact.thresholds.maximumDuplicateCandidateRate, 'maximumDuplicateCandidateRate', 0, 1);
    assertThresholdRange(artifact.thresholds.minimumSegmentEvidenceCoverageRate, 'minimumSegmentEvidenceCoverageRate', 0, 1);
    assertThresholdRange(artifact.thresholds.maximumWeightSensitivityChangeRate, 'maximumWeightSensitivityChangeRate', 0, 1);
    assertThresholdRange(artifact.thresholds.maximumLatencyP95Ms, 'maximumLatencyP95Ms', Number.EPSILON, Infinity);
    assertThresholdRange(artifact.thresholds.maximumMapMatchDistanceP95M, 'maximumMapMatchDistanceP95M', 0, Infinity);
    assertThresholdRange(artifact.thresholds.maximumDetourP95Ratio, 'maximumDetourP95Ratio', 1, Infinity);
  }
  assertCanonicalIdentity(artifact, 'identity', 'performance thresholds');
  return artifact;
}

function assertThresholdRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`performance threshold ${label} is out of range`);
}

export function admitQaPolicy(policy) {
  assertExactKeys(policy, EXACT_KEYS.qaPolicy, 'QA policy');
  if (policy.schemaVersion !== VERSIONS.qaPolicy || policy.targetSegmentCount !== 100) throw new Error('QA policy must target 100 segments');
  if (policy.samplingMethod !== 'identity-hash-stratified-without-replacement') throw new Error('QA sampling must be deterministic and without replacement');
  assertCanonicalIdentity(policy, 'identity', 'QA policy');
  return policy;
}

export function admitQaTemplate(template) {
  assertExactKeys(template, EXACT_KEYS.qaTemplate, 'QA template');
  assertExactKeys(template.reviewerOne, EXACT_KEYS.reviewer, 'QA reviewer one');
  assertExactKeys(template.reviewerTwo, EXACT_KEYS.reviewer, 'QA reviewer two');
  assertExactKeys(template.adjudication, EXACT_KEYS.adjudication, 'QA adjudication');
  if (template.schemaVersion !== VERSIONS.qaTemplate || template.adjudication.status !== 'pending') throw new Error('unsupported QA template');
  assertCanonicalIdentity(template, 'identity', 'QA template');
  return template;
}

export function assertQaEligibleUniverseRoutes(eligibleSegments, benchmarkReceipt) {
  if (!Array.isArray(eligibleSegments)) throw new Error('QA eligible segments must be an array');
  const admittedRouteIdentities = new Set();
  for (const observation of benchmarkReceipt?.observations || []) {
    if (observation.status !== 'success') continue;
    for (const candidate of observation.candidates || []) {
      if (SHA.test(candidate.candidateIdentity || '')) admittedRouteIdentities.add(candidate.candidateIdentity);
    }
  }
  for (const segment of eligibleSegments) {
    if (!admittedRouteIdentities.has(segment.routeIdentity)) {
      throw new Error('QA eligible segment routeIdentity is not present in the bound benchmark receipt candidates');
    }
  }
  return eligibleSegments;
}

export function admitQaSampleManifest(manifest, { policy, benchmarkReceipt, eligibleSegments = [] }) {
  assertExactKeys(manifest, EXACT_KEYS.qaSampleManifest, 'QA sample manifest');
  if (manifest.schemaVersion !== VERSIONS.qaSampleManifest || manifest.targetSegmentCount !== policy.targetSegmentCount) throw new Error('unsupported QA sample manifest');
  if (!['available', 'unavailable'].includes(manifest.status)) throw new Error('QA sample manifest status is invalid');
  if (manifest.qaPolicyIdentity !== policy.identity || manifest.benchmarkReceiptIdentity !== benchmarkReceipt.identity) throw new Error('QA sample manifest identity binding mismatch');
  if (manifest.samplingMethod !== policy.samplingMethod) throw new Error('QA sample manifest sampling method mismatch');
  if (!Array.isArray(manifest.reasonCodes) || manifest.reasonCodes.some((reason) => !isReasonCode(reason))) throw new Error('QA sample manifest reason codes are invalid');
  if (!Array.isArray(manifest.samples)) throw new Error('QA sample manifest samples must be an array');
  if (!Array.isArray(eligibleSegments)) throw new Error('QA eligible segments must be an array');
  const eligibleIds = new Set();
  for (const [index, segment] of eligibleSegments.entries()) {
    assertExactKeys(segment, EXACT_KEYS.qaEligibleSegment, `QA eligibleSegments[${index}]`);
    assertIdentity(segment.segmentIdentity, `QA eligibleSegments[${index}].segmentIdentity`);
    assertIdentity(segment.routeIdentity, `QA eligibleSegments[${index}].routeIdentity`);
    if (eligibleIds.has(segment.segmentIdentity)) throw new Error('QA eligible segment identities must be unique');
    if (!REGIONS.includes(segment.region) || !DISTANCE_CLASSES.includes(segment.distanceClass)
      || !Array.isArray(segment.featureTags) || segment.featureTags.some((tag) => !FEATURE_TAGS.includes(tag))) {
      throw new Error('QA eligible segment stratum fields are invalid');
    }
    eligibleIds.add(segment.segmentIdentity);
  }
  const sampleIds = new Set();
  const segmentIds = new Set();
  for (const [index, sample] of manifest.samples.entries()) {
    assertExactKeys(sample, EXACT_KEYS.qaSample, `QA sample manifest.samples[${index}]`);
    if (typeof sample.sampleId !== 'string' || sample.sampleId.length < 1 || sampleIds.has(sample.sampleId)) throw new Error('QA sample IDs must be unique non-empty strings');
    assertIdentity(sample.segmentIdentity, 'QA sample segmentIdentity');
    assertIdentity(sample.routeIdentity, 'QA sample routeIdentity');
    if (segmentIds.has(sample.segmentIdentity)) throw new Error('QA sample segment identities must be unique');
    const expectedRank = qaSelectionRank(policy.identity, sample);
    if (sample.selectionRank !== expectedRank) throw new Error('QA sample selection rank mismatch');
    sampleIds.add(sample.sampleId);
    segmentIds.add(sample.segmentIdentity);
  }
  if (manifest.status === 'available') {
    if (benchmarkReceipt.status !== 'available') throw new Error('available QA sample manifest requires an available benchmark');
    if (!admittedBenchmarkReceipts.has(benchmarkReceipt)) throw new Error('available QA sample manifest requires an admitted benchmark receipt');
    assertQaEligibleUniverseRoutes(eligibleSegments, benchmarkReceipt);
    if (eligibleSegments.length < policy.targetSegmentCount
      || manifest.eligibleSegmentCount !== eligibleSegments.length
      || manifest.eligibleUniverseIdentity !== qaEligibleUniverseIdentity(eligibleSegments)) {
      throw new Error('available QA sample manifest eligible universe binding mismatch');
    }
    const expectedSamples = selectDeterministicQaSample(eligibleSegments, policy).map((segment) => ({
      sampleId: qaSampleId(policy.identity, segment),
      segmentIdentity: segment.segmentIdentity,
      routeIdentity: segment.routeIdentity,
      selectionRank: qaSelectionRank(policy.identity, segment),
    }));
    if (expectedSamples.length !== policy.targetSegmentCount
      || JSON.stringify(manifest.samples) !== JSON.stringify(expectedSamples)
      || manifest.reasonCodes.length !== 0) {
      throw new Error('available QA sample manifest does not match deterministic selection from eligible universe');
    }
  } else {
    if (eligibleSegments.length !== 0 || manifest.eligibleUniverseIdentity !== null
      || manifest.eligibleSegmentCount !== 0 || manifest.samples.length !== 0 || manifest.reasonCodes.length < 1) {
      throw new Error('unavailable QA sample manifest must keep universe and samples unavailable with a reason code');
    }
  }
  assertCanonicalIdentity(manifest, 'identity', 'QA sample manifest');
  return manifest;
}

export function admitQaRecord(record, sample) {
  assertExactKeys(record, EXACT_KEYS.qaTemplate, 'QA adjudication record');
  assertExactKeys(record.reviewerOne, EXACT_KEYS.reviewer, 'QA reviewer one');
  assertExactKeys(record.reviewerTwo, EXACT_KEYS.reviewer, 'QA reviewer two');
  assertExactKeys(record.adjudication, EXACT_KEYS.adjudication, 'QA adjudication');
  if (record.schemaVersion !== VERSIONS.qaTemplate) throw new Error('unsupported QA adjudication record');
  if (record.sampleId !== sample.sampleId || record.segmentIdentity !== sample.segmentIdentity || record.routeIdentity !== sample.routeIdentity) throw new Error('QA adjudication record sample binding mismatch');
  assertCompletedReviewer(record.reviewerOne, 'QA reviewer one');
  assertCompletedReviewer(record.reviewerTwo, 'QA reviewer two');
  if (record.reviewerOne.reviewerId === record.reviewerTwo.reviewerId) throw new Error('QA reviewers must be different people');
  const disagrees = record.reviewerOne.decision !== record.reviewerTwo.decision;
  if (disagrees) {
    if (record.adjudication.status !== 'completed') throw new Error('QA reviewer disagreement requires completed adjudication');
    if (!['accept', 'reject', 'uncertain'].includes(record.adjudication.decision)
      || typeof record.adjudication.adjudicatorId !== 'string' || record.adjudication.adjudicatorId.length < 1
      || [record.reviewerOne.reviewerId, record.reviewerTwo.reviewerId].includes(record.adjudication.adjudicatorId)
      || !isReasonCode(record.adjudication.reasonCode) || !isIsoTimestamp(record.adjudication.adjudicatedAt)) {
      throw new Error('completed QA adjudication fields are invalid');
    }
  } else if (record.adjudication.status !== 'not-required'
    || Object.entries(record.adjudication).some(([key, value]) => key !== 'status' && value !== null)) {
    throw new Error('agreed QA review must mark adjudication not-required with null details');
  }
  assertCanonicalIdentity(record, 'identity', 'QA adjudication record');
  return record;
}

function assertCompletedReviewer(reviewer, label) {
  if (typeof reviewer.reviewerId !== 'string' || reviewer.reviewerId.length < 1
    || !['accept', 'reject', 'uncertain'].includes(reviewer.decision)
    || !isReasonCode(reviewer.reasonCode) || !isIsoTimestamp(reviewer.reviewedAt)) {
    throw new Error(`${label} completion fields are invalid`);
  }
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function admitQaReceipt(receipt, {
  policy,
  benchmarkReceipt,
  sampleManifest,
  eligibleSegments = [],
  adjudicationRecords = [],
}) {
  assertExactKeys(receipt, EXACT_KEYS.qaReceipt, 'QA receipt');
  if (receipt.schemaVersion !== VERSIONS.qaReceipt || receipt.targetSegmentCount !== 100) throw new Error('unsupported QA receipt');
  if (!['available', 'unavailable'].includes(receipt.status)) throw new Error('QA receipt status is invalid');
  if (receipt.qaPolicyIdentity !== policy.identity || receipt.benchmarkReceiptIdentity !== benchmarkReceipt.identity) throw new Error('QA receipt identity binding mismatch');
  admitQaSampleManifest(sampleManifest, { policy, benchmarkReceipt, eligibleSegments });
  if (receipt.sampleManifestIdentity !== sampleManifest.identity) throw new Error('QA receipt sample manifest identity binding mismatch');
  if (!Array.isArray(receipt.adjudicationRecordIdentities) || !Array.isArray(adjudicationRecords)) throw new Error('QA adjudication record identities are required');
  if (!Array.isArray(receipt.reasonCodes) || receipt.reasonCodes.some((reason) => !isReasonCode(reason))) throw new Error('QA receipt reason codes are invalid');
  const samplesById = new Map(sampleManifest.samples.map((sample) => [sample.sampleId, sample]));
  const recordsBySampleId = new Map();
  for (const record of adjudicationRecords) {
    const sample = samplesById.get(record.sampleId);
    if (!sample || recordsBySampleId.has(record.sampleId)) throw new Error('QA adjudication records must bind uniquely to manifest samples');
    admitQaRecord(record, sample);
    recordsBySampleId.set(record.sampleId, record);
  }
  const recordIdentities = adjudicationRecords.map(({ identity }) => identity);
  if (new Set(recordIdentities).size !== recordIdentities.length
    || JSON.stringify(receipt.adjudicationRecordIdentities) !== JSON.stringify(recordIdentities)) {
    throw new Error('QA receipt adjudication record identity binding mismatch');
  }
  const computed = {
    sampledSegmentCount: sampleManifest.samples.length,
    reviewerOneCompletedCount: adjudicationRecords.length,
    reviewerTwoCompletedCount: adjudicationRecords.length,
    twoReviewerCompleted: adjudicationRecords.length === receipt.targetSegmentCount,
    adjudicatedCount: adjudicationRecords.filter((record) => record.adjudication.status === 'completed').length,
  };
  for (const [key, value] of Object.entries(computed)) {
    if (receipt[key] !== value) throw new Error(`QA ${key} does not match bound artifacts`);
  }
  if (receipt.status === 'available') {
    if (benchmarkReceipt.status !== 'available' || sampleManifest.status !== 'available'
      || receipt.adjudicationRecordIdentities.length !== 100 || !receipt.twoReviewerCompleted
      || receipt.reasonCodes.length !== 0) {
      throw new Error('available QA requires an available benchmark, deterministic 100-sample manifest, and 100 bound two-reviewer records');
    }
  } else if (receipt.twoReviewerCompleted || receipt.reasonCodes.length < 1) {
    throw new Error('unavailable QA cannot claim completed two-reviewer review and requires a reason code');
  }
  assertCanonicalIdentity(receipt, 'identity', 'QA receipt');
  return receipt;
}
