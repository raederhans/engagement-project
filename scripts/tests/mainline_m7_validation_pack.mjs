import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  assertSchemaExactKeys,
  validateM7Pack,
} from '../local_route_companion/validate-m7-pack.mjs';
import { canonicalIdentity, identityPayload } from '../local_route_companion/validation/canonical.mjs';
import {
  admitCorpus,
  admitBenchmarkReceipt,
  admitQaRecord,
  admitQaReceipt,
  admitQaSampleManifest,
  admitThresholds,
  assertQaEligibleUniverseRoutes,
  sealArtifact,
} from '../local_route_companion/validation/contracts.mjs';
import { computeBenchmarkMetrics, nearestRank } from '../local_route_companion/validation/metrics.mjs';
import { runPublicBenchmark } from '../local_route_companion/validation/runner.mjs';
import {
  qaEligibleUniverseIdentity,
  qaSampleId,
  qaSelectionRank,
  selectDeterministicQaSample,
} from '../local_route_companion/validation/qa.mjs';

const root = new URL('../fixtures/mainline-m7-validation/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, root), 'utf8'));

test('tracked pack validates 40 public OD pairs, identity bindings, zero egress, and honest unavailable gates', async () => {
  const result = await validateM7Pack();
  assert.deepEqual(result, {
    status: 'valid',
    pairCount: 40,
    manifestIdentity: 'sha256:3a080c12373cbcf369127afbb7a0e13ce9b9e7249d86709b66632f5ac5b65165',
    baseline: { status: 'unavailable', identity: 'sha256:d037ae09d83a89ac223c90cb6f19b0f4bbdff4496698fd3ad2feb09109494d49' },
    thresholds: { status: 'unavailable', frozen: false, identity: 'sha256:93541c98cecd5ab9edd8755612d84326b41afe5ef1f798d0aee157c938282d2e' },
    privacyEgressCount: 0,
    qa: { status: 'unavailable', sampledSegmentCount: 0, twoReviewerCompleted: false },
  });
});

test('corpus rejects identity tamper, unexpected keys, and coverage drift', async () => {
  const corpus = await load('public-od-corpus.v1.json');
  const tampered = structuredClone(corpus);
  tampered.pairs[0].origin.latitude += 0.0001;
  assert.throws(() => admitCorpus(tampered), /identity mismatch/);
  const extra = structuredClone(corpus);
  extra.secretOrigin = 'forbidden';
  assert.throws(() => admitCorpus(extra), /exact keys mismatch/);
  const coverage = structuredClone(corpus);
  coverage.pairs[0].region = 'west';
  coverage.identity = canonicalIdentity(identityPayload(coverage));
  assert.throws(() => admitCorpus(coverage), /region coverage/);
});

test('static exact-key schemas stay mechanically aligned with executable contracts', async () => {
  const schemas = await load('exact-key-schemas.v1.json');
  assert.doesNotThrow(() => assertSchemaExactKeys(schemas));
  const drifted = structuredClone(schemas);
  drifted.$defs.qaReceipt.required.pop();
  assert.throws(
    () => assertSchemaExactKeys(drifted),
    /required keys do not match executable contract/,
  );
});

test('static artifact schemas compile and admit every matching tracked fixture', async () => {
  const schema = await load('exact-key-schemas.v1.json');
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(schema);
  const fixtures = [
    ['public-od-corpus.v1.json', 'corpus'],
    ['manifest.v1.json', 'manifest'],
    ['baseline-receipt.v1.json', 'receipt'],
    ['performance-thresholds.v1.json', 'thresholds'],
    ['qa-sample-manifest.v1.json', 'qaSampleManifest'],
    ['qa-receipt.v1.json', 'qaReceipt'],
    ['qa-adjudication-template.v1.json', 'qaAdjudication'],
  ];
  for (const [fixtureName, definitionName] of fixtures) {
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definitionName}` });
    assert.equal(
      validate(await load(fixtureName)),
      true,
      `${fixtureName}: ${ajv.errorsText(validate.errors)}`,
    );
  }
});

test('nearest-rank p50/p95 and metric denominators are mechanically recomputed', () => {
  assert.equal(nearestRank([40, 10, 30, 20], 0.5), 20);
  assert.equal(nearestRank(Array.from({ length: 20 }, (_, index) => index + 1), 0.95), 19);
  const observations = [
    { status: 'success', latencyMs: 10, candidates: [
      { candidateIdentity: 'route-a', mapMatchDistanceM: 2, routeDistanceM: 120, straightLineDistanceM: 100, evidence: { coveredSegmentCount: 3, totalSegmentCount: 4 }, weightSensitivityChanged: false },
      { candidateIdentity: 'route-a', mapMatchDistanceM: 4, routeDistanceM: 130, straightLineDistanceM: 100, evidence: { coveredSegmentCount: 1, totalSegmentCount: 2 }, weightSensitivityChanged: false },
    ] },
    { status: 'success', latencyMs: 30, candidates: [{ candidateIdentity: 'route-a', mapMatchDistanceM: 6, routeDistanceM: 150, straightLineDistanceM: 100, evidence: { coveredSegmentCount: 2, totalSegmentCount: 2 }, weightSensitivityChanged: true }] },
    { status: 'invalid', latencyMs: 20, candidates: [] },
    { status: 'unavailable' },
  ];
  const result = computeBenchmarkMetrics(observations, 4);
  assert.deepEqual(result.denominator, { plannedPairs: 4, attemptedPairs: 3, successfulPairs: 2, invalidPairs: 1, unavailablePairs: 1, generatedCandidates: 3, sensitivityEligibleRoutes: 3 });
  assert.equal(result.metrics.generationSuccessRate, 2 / 3);
  assert.equal(result.metrics.invalidRate, 1 / 3);
  assert.equal(result.metrics.duplicateCandidateRate, 1 / 3);
  assert.equal(result.metrics.latencyMedianMs, 20);
  assert.equal(result.metrics.latencyP95Ms, 30);
  assert.equal(result.metrics.mapMatchDistanceP95M, 6);
  assert.equal(result.metrics.segmentEvidenceCoverageRate, 6 / 8);
  assert.equal(result.metrics.detourP95Ratio, 1.5);
  assert.equal(result.metrics.weightSensitivityChangeRate, 1 / 3);
});

test('partial candidate evidence fails closed instead of computing subset metrics', () => {
  const observations = [{
    status: 'success',
    latencyMs: 10,
    candidates: [
      { candidateIdentity: 'route-a', mapMatchDistanceM: 2, routeDistanceM: 120, straightLineDistanceM: 100, evidence: { coveredSegmentCount: 3, totalSegmentCount: 4 }, weightSensitivityChanged: false },
      { candidateIdentity: 'route-b', mapMatchDistanceM: null, routeDistanceM: null, straightLineDistanceM: null, evidence: { coveredSegmentCount: null, totalSegmentCount: null }, weightSensitivityChanged: null },
    ],
  }];
  const { denominator, metrics } = computeBenchmarkMetrics(observations, 1);
  assert.equal(denominator.generatedCandidates, 2);
  assert.equal(denominator.sensitivityEligibleRoutes, 0);
  assert.equal(metrics.mapMatchDistanceMedianM, null);
  assert.equal(metrics.segmentEvidenceCoverageRate, null);
  assert.equal(metrics.detourMedianRatio, null);
  assert.equal(metrics.weightSensitivityChangeRate, null);
});

test('unavailable observations preserve null metrics rather than zero filling', () => {
  const { denominator, metrics } = computeBenchmarkMetrics(Array.from({ length: 40 }, () => ({ status: 'unavailable' })), 40);
  assert.equal(denominator.attemptedPairs, 0);
  assert.equal(denominator.unavailablePairs, 40);
  assert.ok(Object.values(metrics).every((value) => value === null));
});

test('runner emits an offline unavailable receipt with five unavailable identities when engine is absent', async () => {
  const corpus = await load('public-od-corpus.v1.json');
  const policy = await load('validation-policy.v1.json');
  const manifest = await load('manifest.v1.json');
  const receipt = await runPublicBenchmark({ corpus, policy, manifest });
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.privacy.egressCount, 0);
  assert.equal(receipt.denominator.unavailablePairs, 40);
  assert.ok(Object.values(receipt.identities).every(({ status, identity }) => status === 'unavailable' && identity === null));
  assert.ok(Object.values(receipt.metrics).every((value) => value === null));
});

test('benchmark receipt cannot relabel no-runtime or attempt-only evidence as formal zero-egress proof', async () => {
  const corpus = await load('public-od-corpus.v1.json');
  const policy = await load('validation-policy.v1.json');
  const manifest = await load('manifest.v1.json');
  const baseline = await load('baseline-receipt.v1.json');
  const missingObserver = sealArtifact({
    ...baseline,
    privacy: {
      ...baseline.privacy,
      measurementStatus: 'observed',
      enforcement: 'attempt-detection-only',
      observerIdentity: null,
    },
    identity: null,
  });
  assert.throws(
    () => admitBenchmarkReceipt(missingObserver, { corpus, manifest, policy }),
    /observerIdentity/,
  );
  const relabeledAvailable = sealArtifact({ ...baseline, status: 'available', identity: null });
  assert.throws(
    () => admitBenchmarkReceipt(relabeledAvailable, { corpus, manifest, policy }),
    /independent OS outbound-deny observation/,
  );
  const successfulObservations = corpus.pairs.map(({ pairId }, index) => ({
    pairId,
    status: 'success',
    latencyMs: 1,
    candidates: [{
      candidateIdentity: `sha256:${index.toString(16).padStart(64, '0')}`,
      mapMatchDistanceM: 1,
      routeDistanceM: 110,
      straightLineDistanceM: 100,
      evidence: { coveredSegmentCount: 1, totalSegmentCount: 1 },
      weightSensitivityChanged: false,
    }],
  }));
  const recomputed = computeBenchmarkMetrics(successfulObservations, corpus.pairs.length);
  const descriptor = (digit) => ({
    status: 'available',
    identity: `sha256:${digit.repeat(64)}`,
  });
  const selfReportedOsObservation = sealArtifact({
    ...baseline,
    status: 'available',
    reasonCodes: [],
    identities: {
      engine: descriptor('1'),
      graph: descriptor('2'),
      candidateGenerator: descriptor('3'),
      routeSet: descriptor('4'),
      evidence: descriptor('5'),
    },
    denominator: recomputed.denominator,
    metrics: recomputed.metrics,
    privacy: {
      egressCount: 0,
      measurement: 'independent-os-observer-test-fixture',
      measurementStatus: 'observed',
      enforcement: 'os-outbound-deny',
      observerIdentity: `sha256:${'6'.repeat(64)}`,
      privateCoordinatesTransmitted: false,
    },
    observations: successfulObservations,
    identity: null,
  });
  assert.throws(
    () => admitBenchmarkReceipt(selfReportedOsObservation, { corpus, manifest, policy }),
    /admission is disabled until a verifier-bound OS observation artifact contract exists/,
  );
});

test('runner refuses unverified injected engine and companion claims without executing them', async () => {
  const corpus = await load('public-od-corpus.v1.json');
  const policy = await load('validation-policy.v1.json');
  const manifest = await load('manifest.v1.json');
  let called = false;
  const companion = {
    async generate({ pair }) {
      called = true;
      return { status: 'success', candidates: [{
        candidateIdentity: canonicalIdentity(pair.pairId),
        mapMatchDistanceM: 1,
        routeDistanceM: 110,
        straightLineDistanceM: 100,
        evidence: { coveredSegmentCount: 2, totalSegmentCount: 2 },
        weightSensitivityChanged: false,
        geometry: [[-75.1, 39.9]],
      }] };
    },
    identities() { return {}; },
    privacyEgressCount() { return 0; },
  };
  const receipt = await runPublicBenchmark({ corpus, policy, manifest, engine: { identity: `sha256:${'1'.repeat(64)}` }, companion });
  assert.equal(called, false);
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.reasonCodes[0], 'unverified-custom-runtime');
  assert.equal(receipt.denominator.unavailablePairs, 40);
  assert.equal(receipt.metrics.generationSuccessRate, null);
  assert.equal(receipt.privacy.egressCount, 0);
  assert.doesNotMatch(JSON.stringify(receipt), /geometry|longitude|latitude/);
  assert.doesNotThrow(() => admitBenchmarkReceipt(receipt, { corpus, manifest, policy }));
});

test('unverified custom partial-runtime claims are not executed or admitted', async () => {
  const corpus = await load('public-od-corpus.v1.json');
  const policy = await load('validation-policy.v1.json');
  const manifest = await load('manifest.v1.json');
  let called = false;
  const companion = {
    async generate({ pair }) {
      called = true;
      if (pair.pairId === 'center-01') return { status: 'unavailable', reasonCode: 'engine-unavailable' };
      return { status: 'invalid', reasonCode: 'no-route', candidates: [] };
    },
    identities() { return {}; },
    privacyEgressCount() { return 0; },
  };
  const receipt = await runPublicBenchmark({
    corpus, policy, manifest, engine: { identity: `sha256:${'1'.repeat(64)}` }, companion,
  });
  assert.equal(called, false);
  assert.equal(receipt.status, 'unavailable');
  assert.equal(receipt.reasonCodes[0], 'unverified-custom-runtime');
});

test('formal thresholds cannot be pre-frozen or populated before an available baseline', async () => {
  const baseline = await load('baseline-receipt.v1.json');
  const thresholds = await load('performance-thresholds.v1.json');
  const preFrozen = sealArtifact({ ...thresholds, frozen: true, identity: null });
  assert.throws(() => admitThresholds(preFrozen, baseline), /cannot be frozen/);
  const fabricated = structuredClone(thresholds);
  fabricated.thresholds.maximumLatencyP95Ms = 500;
  const resealed = sealArtifact(fabricated);
  assert.throws(() => admitThresholds(resealed, baseline), /must remain null/);
  const unknown = sealArtifact({ ...thresholds, status: 'unknown', identity: null });
  assert.throws(() => admitThresholds(unknown, baseline), /status is invalid/);
});

test('available thresholds reject an unadmitted self-reported baseline', async () => {
  const trackedBaseline = await load('baseline-receipt.v1.json');
  const trackedThresholds = await load('performance-thresholds.v1.json');
  const baseline = sealArtifact({ ...trackedBaseline, status: 'available', identity: null });
  const values = {
    minimumGenerationSuccessRate: 0.95,
    maximumInvalidRate: 0.05,
    maximumDuplicateCandidateRate: 0.02,
    maximumLatencyP95Ms: 250,
    maximumMapMatchDistanceP95M: 12,
    minimumSegmentEvidenceCoverageRate: 0.9,
    maximumDetourP95Ratio: 1.8,
    maximumWeightSensitivityChangeRate: 0.25,
  };
  const valid = sealArtifact({
    ...trackedThresholds,
    status: 'available',
    frozen: true,
    baselineReceiptIdentity: baseline.identity,
    thresholds: values,
    reasonCodes: [],
    identity: null,
  });
  assert.throws(
    () => admitThresholds(valid, baseline),
    /available thresholds require an admitted benchmark receipt/,
  );
});

test('QA count-only claims are rejected and tracked artifacts remain honestly unavailable', async () => {
  const policy = await load('qa-sampling-policy.v1.json');
  const benchmarkReceipt = await load('baseline-receipt.v1.json');
  const sampleManifest = await load('qa-sample-manifest.v1.json');
  const base = await load('qa-receipt.v1.json');
  assert.doesNotThrow(() => admitQaSampleManifest(sampleManifest, { policy, benchmarkReceipt }));
  assert.doesNotThrow(() => admitQaReceipt(base, { policy, benchmarkReceipt, sampleManifest, adjudicationRecords: [] }));
  const countOnly = sealArtifact({
    ...base,
    status: 'available',
    sampledSegmentCount: 100,
    reviewerOneCompletedCount: 100,
    reviewerTwoCompletedCount: 100,
    twoReviewerCompleted: true,
    reasonCodes: [],
    identity: null,
  });
  assert.throws(
    () => admitQaReceipt(countOnly, { policy, benchmarkReceipt, sampleManifest, adjudicationRecords: [] }),
    /does not match bound artifacts/,
  );
});

test('QA universe binds to benchmark candidate routes while available admission stays fail-closed', async () => {
  const policy = await load('qa-sampling-policy.v1.json');
  const trackedBenchmark = await load('baseline-receipt.v1.json');
  const benchmarkReceipt = sealArtifact({
    ...trackedBenchmark,
    status: 'available',
    observations: Array.from({ length: 40 }, (_, index) => ({
      status: 'success',
      candidates: [{ candidateIdentity: `sha256:${index.toString(16).padStart(64, '0')}` }],
    })),
    identity: null,
  });
  const eligibleSegments = Array.from({ length: 125 }, (_, index) => ({
    segmentIdentity: `sha256:${index.toString(16).padStart(64, '0')}`,
    routeIdentity: `sha256:${(index % 40).toString(16).padStart(64, '0')}`,
    region: ['center', 'west', 'north', 'south', 'northeast'][index % 5],
    distanceClass: index % 2 ? 'short' : 'medium',
    featureTags: [['bridge', 'park', 'superblock', 'dead-end', 'walkway'][index % 5]],
  }));
  const samples = selectDeterministicQaSample(eligibleSegments, policy).map((segment) => ({
    sampleId: qaSampleId(policy.identity, segment),
    segmentIdentity: segment.segmentIdentity,
    routeIdentity: segment.routeIdentity,
    selectionRank: qaSelectionRank(policy.identity, segment),
  }));
  const sampleManifest = sealArtifact({
    schemaVersion: 'mainline-m7-qa-sample-manifest/v1',
    status: 'available',
    qaPolicyIdentity: policy.identity,
    benchmarkReceiptIdentity: benchmarkReceipt.identity,
    targetSegmentCount: 100,
    samplingMethod: policy.samplingMethod,
    eligibleUniverseIdentity: qaEligibleUniverseIdentity(eligibleSegments),
    eligibleSegmentCount: eligibleSegments.length,
    samples,
    reasonCodes: [],
    identity: null,
  });
  assert.doesNotThrow(() => assertQaEligibleUniverseRoutes(eligibleSegments, benchmarkReceipt));
  const routeForgery = structuredClone(eligibleSegments);
  routeForgery[0].routeIdentity = `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () => assertQaEligibleUniverseRoutes(routeForgery, benchmarkReceipt),
    /routeIdentity is not present in the bound benchmark receipt candidates/,
  );
  assert.throws(
    () => admitQaSampleManifest(sampleManifest, { policy, benchmarkReceipt, eligibleSegments }),
    /requires an admitted benchmark receipt/,
  );
  const records = samples.map((sample, index) => sealArtifact({
    schemaVersion: 'mainline-m7-qa-adjudication-template/v1',
    sampleId: sample.sampleId,
    segmentIdentity: sample.segmentIdentity,
    routeIdentity: sample.routeIdentity,
    reviewerOne: { reviewerId: 'reviewer-a', decision: 'accept', reasonCode: 'route-valid', reviewedAt: '2026-09-01T01:00:00.000Z' },
    reviewerTwo: { reviewerId: 'reviewer-b', decision: index === 0 ? 'reject' : 'accept', reasonCode: index === 0 ? 'route-invalid' : 'route-valid', reviewedAt: '2026-09-01T02:00:00.000Z' },
    adjudication: index === 0
      ? { status: 'completed', decision: 'accept', adjudicatorId: 'reviewer-c', reasonCode: 'route-valid', adjudicatedAt: '2026-09-01T03:00:00.000Z' }
      : { status: 'not-required', decision: null, adjudicatorId: null, reasonCode: null, adjudicatedAt: null },
    identity: null,
  }));
  const arbitrarySamples = eligibleSegments.slice(0, 100).map((segment) => ({
    sampleId: qaSampleId(policy.identity, segment),
    segmentIdentity: segment.segmentIdentity,
    routeIdentity: segment.routeIdentity,
    selectionRank: qaSelectionRank(policy.identity, segment),
  }));
  assert.notDeepEqual(arbitrarySamples, samples);

  const sameReviewer = sealArtifact({ ...records[1], reviewerTwo: { ...records[1].reviewerTwo, reviewerId: 'reviewer-a' }, identity: null });
  assert.throws(() => admitQaRecord(sameReviewer, samples[1]), /must be different/);
  const misbound = sealArtifact({ ...records[1], routeIdentity: samples[2].routeIdentity, identity: null });
  assert.throws(() => admitQaRecord(misbound, samples[1]), /sample binding mismatch/);
  const pendingDisagreement = sealArtifact({ ...records[0], adjudication: { status: 'pending', decision: null, adjudicatorId: null, reasonCode: null, adjudicatedAt: null }, identity: null });
  assert.throws(() => admitQaRecord(pendingDisagreement, samples[0]), /requires completed adjudication/);
});

test('QA sampling is deterministic, stratified, unique, and capped at 100 segments', async () => {
  const policy = await load('qa-sampling-policy.v1.json');
  const segments = Array.from({ length: 125 }, (_, index) => ({
    segmentIdentity: `sha256:${index.toString(16).padStart(64, '0')}`,
    routeIdentity: `sha256:${(index % 40).toString(16).padStart(64, '0')}`,
    region: ['center', 'west', 'north', 'south', 'northeast'][index % 5],
    distanceClass: index % 2 ? 'short' : 'medium',
    featureTags: [['bridge', 'park', 'superblock', 'dead-end', 'walkway'][index % 5]],
  }));
  const first = selectDeterministicQaSample(segments, policy);
  const second = selectDeterministicQaSample([...segments].reverse(), policy);
  assert.equal(first.length, 100);
  assert.equal(new Set(first.map(({ segmentIdentity }) => segmentIdentity)).size, 100);
  assert.deepEqual(first, second);
});
