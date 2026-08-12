import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitCandidateBundle,
  admitCandidateComparison,
  admitCandidateReceipt,
  admitSourceDescriptor,
  approveCandidateComparison,
  canonicalStringify,
  compareRouteGraphCandidates,
  createCandidateBundle,
  createCandidateReceipt,
  freezeData,
  normalizeRouteGraphCandidate,
} from '../lib/route_graph_candidate/index.mjs';

const descriptor = await fixture('synthetic_descriptor.json');
const profile = await fixture('walking_profile.json');
const validRaw = await fixture('valid_raw_graph.json');
const zeroLoopRaw = await fixture('zero_cost_self_loop.json');

test('candidate receipt rejects a caller-forged passed audit after fresh full-graph audit', () => {
  const failedNormalization = structuredClone(normalizeRouteGraphCandidate(zeroLoopRaw, profile));
  const passedAudit = normalizeRouteGraphCandidate(validRaw, profile).audit;
  failedNormalization.audit = structuredClone(passedAudit);
  assert.equal(failedNormalization.status, 'failed');
  assert.equal(failedNormalization.audit.status, 'passed');
  assert.throws(
    () => createCandidateReceipt({
      descriptor,
      profile,
      normalization: failedNormalization,
      baseline: null,
      review: null,
    }),
    hasCode('normalization-audit-drift'),
  );
});

test('candidate receipt rejects status drift from the mechanically derived fresh audit', () => {
  const normalization = structuredClone(normalizeRouteGraphCandidate(validRaw, profile));
  normalization.status = 'failed';
  assert.throws(
    () => createCandidateReceipt({
      descriptor,
      profile,
      normalization,
      baseline: null,
      review: null,
    }),
    hasCode('normalization-status-drift'),
  );
});

test('empty node and edge inventories fail fresh audit and cannot become harness eligible', () => {
  const emptyRaw = structuredClone(validRaw);
  emptyRaw.features = [];
  const empty = lifecycle(emptyRaw);
  assert.equal(empty.normalization.status, 'failed');
  assert.equal(empty.normalization.audit.status, 'failed');
  assert.ok(empty.normalization.audit.blockers.includes('empty-node-inventory'));
  assert.ok(empty.normalization.audit.blockers.includes('empty-edge-inventory'));
  const receipt = createCandidateReceipt({
    ...empty,
    baseline: null,
    review: null,
  });
  assert.equal(receipt.eligibility.harnessEligible, false);
  assert.ok(receipt.eligibility.reasons.includes('topology-audit-not-passed'));
  assert.equal(receipt.eligibility.productionEligible, false);
  assert.equal(receipt.eligibility.publishEligible, false);
});

test('hand-written unchanged comparison cannot use a null baseline identity', () => {
  const forgedComparison = {
    schema: 'route-graph-semantic-comparison/v2',
    disposition: 'unchanged',
    baselineIdentity: null,
    candidateIdentity: `sha256:${'1'.repeat(64)}`,
    reasons: [],
    review: { status: 'not-required', reviewedBy: null, reviewedAt: null, evidenceRef: null },
  };
  assert.throws(() => admitCandidateComparison(forgedComparison), hasCode('comparison-baseline-required'));
  assert.throws(
    () => createCandidateReceipt({
      ...lifecycle(), baseline: null, review: null, comparison: forgedComparison,
    }),
    hasCode('schema-mismatch'),
  );
});

test('null-baseline review approval is restricted to the exact first-seen path', () => {
  const forgedReview = {
    schema: 'route-graph-semantic-comparison/v2',
    disposition: 'review-approved',
    baselineIdentity: null,
    candidateIdentity: `sha256:${'2'.repeat(64)}`,
    reasons: ['topology-drift'],
    review: {
      status: 'approved',
      reviewedBy: 'forged-reviewer',
      reviewedAt: '2026-08-12T04:00:00.000Z',
      evidenceRef: 'forged null-baseline approval',
    },
  };
  assert.throws(() => admitCandidateComparison(forgedReview), hasCode('comparison-first-seen-baseline'));
  const candidate = lifecycle();
  const firstSeenApproved = approveCandidateComparison(
    compareRouteGraphCandidates({ candidate }),
    reviewEvidence(),
  );
  assert.equal(firstSeenApproved.baselineIdentity, null);
  assert.deepEqual(firstSeenApproved.reasons, ['first-seen-candidate']);
});

test('source receipt clocks must follow retrieval build and observation order', () => {
  for (const mutate of [
    (candidate) => { candidate.clocks.retrievedAt = '2026-08-12T00:01:01.000Z'; },
    (candidate) => { candidate.clocks.builtAt = '2026-08-12T00:02:01.000Z'; },
  ]) {
    const candidate = structuredClone(descriptor);
    mutate(candidate);
    assert.throws(() => admitSourceDescriptor(candidate), hasCode('clock-order'));
  }
  const equalBoundary = structuredClone(descriptor);
  equalBoundary.clocks.retrievedAt = equalBoundary.clocks.builtAt;
  equalBoundary.clocks.observedAt = equalBoundary.clocks.builtAt;
  assert.doesNotThrow(() => admitSourceDescriptor(equalBoundary));
});

test('sourceAsOf cannot be later than observedAt for timestamp or date-only clocks', () => {
  const futureTimestamp = structuredClone(descriptor);
  futureTimestamp.clocks.sourceAsOf = '2026-08-12T00:02:00.001Z';
  assert.throws(() => admitSourceDescriptor(futureTimestamp), hasCode('source-as-of-future'));

  const futureDate = structuredClone(descriptor);
  futureDate.clocks.sourceAsOf = '2026-08-13';
  assert.throws(() => admitSourceDescriptor(futureDate), hasCode('source-as-of-future'));

  const sameDate = structuredClone(descriptor);
  sameDate.clocks.sourceAsOf = '2026-08-12';
  assert.doesNotThrow(() => admitSourceDescriptor(sameDate));
});

test('first-seen comparison JSON rewrite cannot authorize a bundle without an actual baseline', () => {
  const candidate = lifecycle();
  const pending = compareRouteGraphCandidates({ candidate });
  const forged = structuredClone(pending);
  forged.disposition = 'unchanged';
  forged.baselineIdentity = pending.candidateIdentity;
  forged.reasons = [];
  forged.review = {
    status: 'not-required', reviewedBy: null, reviewedAt: null, evidenceRef: null,
  };
  assert.doesNotThrow(() => admitCandidateComparison(forged));
  assert.throws(
    () => createCandidateBundle({
      ...candidate, baseline: null, review: null, comparison: forged,
    }),
    hasCode('schema-mismatch'),
  );

  const rewritten = structuredClone(createCandidateBundle({
    ...candidate, baseline: null, review: null,
  }));
  rewritten.receipt.comparison = forged;
  rewritten.receipt.eligibility.reasons = ['candidate-bundle-required'];
  rewritten.eligibility.harnessEligible = true;
  rewritten.eligibility.reasons = [];
  assert.throws(() => admitCandidateBundle(rewritten), hasCode('bundle-comparison-drift'));
});

test('real A to B lifecycle drift remains review-required across semantic projections', () => {
  const candidateA = lifecycle();

  const licenseDrift = lifecycle();
  licenseDrift.descriptor.license.derivativeRedistribution = 'unknown';

  const coverageDrift = lifecycle();
  coverageDrift.descriptor.coverage.routing.description = 'Changed routing coverage evidence.';

  const profileValue = structuredClone(profile);
  profileValue.profileId = 'synthetic-walking-v2';
  const profileDrift = {
    descriptor: structuredClone(descriptor),
    profile: profileValue,
    normalization: normalizeRouteGraphCandidate(validRaw, profileValue),
  };

  const geometryRaw = structuredClone(validRaw);
  geometryRaw.features.find((feature) => feature.edge_id === 'e-de').coordinates = [
    [-74.95, 40.02],
    [-74.94, 40.02],
  ];
  const geometryDrift = lifecycle(geometryRaw);
  const topologyRaw = structuredClone(validRaw);
  topologyRaw.features.find((feature) => feature.edge_id === 'e-bc').cost_integer += 1;
  const topologyDrift = lifecycle(topologyRaw);

  for (const drifted of [licenseDrift, coverageDrift, profileDrift, geometryDrift, topologyDrift]) {
    const bundle = createCandidateBundle({
      ...drifted, baseline: candidateA, review: null,
    });
    assert.equal(bundle.receipt.comparison.disposition, 'review-required');
    assert.equal(bundle.eligibility.harnessEligible, false);
    assert.ok(bundle.eligibility.reasons.includes('semantic-review-required'));
  }
});

test('real A to A baseline lifecycle produces unchanged and a harness-eligible bundle', () => {
  const candidate = lifecycle();
  const comparison = compareRouteGraphCandidates({ baseline: candidate, candidate });
  const bundle = createCandidateBundle({
    ...candidate, baseline: candidate, review: null,
  });
  assert.equal(comparison.schema, 'route-graph-semantic-comparison/v2');
  assert.equal(comparison.disposition, 'unchanged');
  assert.equal(comparison.baselineIdentity, comparison.candidateIdentity);
  assert.equal(bundle.receipt.comparison.candidateIdentity, comparison.candidateIdentity);
  assert.equal(bundle.receipt.eligibility.harnessEligible, false);
  assert.equal(bundle.eligibility.harnessEligible, true);
  assert.deepEqual(bundle.eligibility.reasons, []);
  assert.equal(bundle.receipt.eligibility.productionEligible, false);
  assert.equal(bundle.receipt.eligibility.publishEligible, false);
});

test('first-seen explicit approval preserves the internally computed candidate identity', () => {
  const candidate = lifecycle();
  const pending = compareRouteGraphCandidates({ candidate });
  const approved = approveCandidateComparison(pending, {
    reviewedBy: 's3-integration-owner',
    reviewedAt: '2026-08-12T04:05:00.000Z',
    evidenceRef: 'S3-1 candidate identity first-seen review',
  });
  assert.equal(approved.baselineIdentity, null);
  assert.equal(approved.candidateIdentity, pending.candidateIdentity);
  assert.deepEqual(approved.reasons, pending.reasons);
  const bundle = createCandidateBundle({
    ...candidate,
    baseline: null,
    review: reviewEvidence('S3-1 candidate identity first-seen review', '2026-08-12T04:05:00.000Z'),
  });
  assert.equal(bundle.receipt.comparison.disposition, 'review-approved');
  assert.equal(bundle.receipt.comparison.candidateIdentity, pending.candidateIdentity);
  assert.equal(bundle.eligibility.harnessEligible, true);
  assert.equal(bundle.receipt.eligibility.harnessEligible, false);
});

test('semantic comparison v1 is rejected rather than silently reinterpreted as v2', () => {
  const candidate = lifecycle();
  const legacy = structuredClone(compareRouteGraphCandidates({ baseline: candidate, candidate }));
  legacy.schema = 'route-graph-semantic-comparison/v1';
  assert.throws(() => admitCandidateComparison(legacy), hasCode('comparison-schema'));
});

test('candidate receipt v1 is rejected rather than silently reinterpreted as v3', () => {
  const receipt = structuredClone(admittedBundle().receipt);
  receipt.schema = 'route-graph-candidate-receipt/v1';
  assert.throws(() => admitCandidateReceipt(receipt), hasCode('receipt-schema'));
});

test('candidate bundle v1 is rejected rather than silently reinterpreted as v3', () => {
  const bundle = structuredClone(admittedBundle());
  bundle.schema = 'route-graph-candidate-bundle/v1';
  assert.throws(() => admitCandidateBundle(bundle), hasCode('bundle-schema'));
});

test('standalone receipt admission recomputes and rejects candidateId tampering', () => {
  const receipt = structuredClone(admittedBundle().receipt);
  receipt.candidateId = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => admitCandidateReceipt(receipt), hasCode('receipt-candidate-id-drift'));
});

test('standalone receipt admission rejects comparison candidate identity tampering', () => {
  const receipt = structuredClone(admittedBundle().receipt);
  receipt.comparison.candidateIdentity = `sha256:${'8'.repeat(64)}`;
  assert.throws(
    () => admitCandidateReceipt(receipt),
    hasCode('receipt-comparison-identity-drift'),
  );
});

test('standalone receipt admission rejects harness and reasons tampering', () => {
  const falseHarness = structuredClone(admittedBundle().receipt);
  falseHarness.eligibility.harnessEligible = true;
  falseHarness.eligibility.reasons = [];
  assert.throws(() => admitCandidateReceipt(falseHarness), hasCode('receipt-eligibility-drift'));

  const falseReasons = structuredClone(admittedBundle().receipt);
  falseReasons.eligibility.reasons = ['fabricated-reason'];
  assert.throws(() => admitCandidateReceipt(falseReasons), hasCode('receipt-eligibility-drift'));
});

test('candidate bundle rejects topology tampering in its full graph', () => {
  const bundle = structuredClone(admittedBundle());
  bundle.graph.edges[0].cost += 1;
  assert.throws(() => admitCandidateBundle(bundle), hasCode('bundle-audit-drift'));
});

test('candidate bundle rejects geometry tampering in its full graph', () => {
  const bundle = structuredClone(admittedBundle());
  bundle.graph.edges[0].geometry[0][0] += 0.001;
  assert.throws(() => admitCandidateBundle(bundle), hasCode('bundle-audit-drift'));
});

test('candidate bundle rejects a valid receipt bound to different topology', () => {
  const original = structuredClone(admittedBundle());
  const changedRaw = structuredClone(validRaw);
  changedRaw.features.find((feature) => feature.edge_id === 'e-bc').cost_integer += 1;
  const changed = lifecycle(changedRaw);
  original.receipt = createCandidateReceipt({
    ...changed,
    baseline: null,
    review: reviewEvidence(),
  });
  assert.throws(() => admitCandidateBundle(original), hasCode('bundle-artifact-drift'));
});

test('candidate bundle rejects a valid receipt bound to different geometry', () => {
  const original = structuredClone(admittedBundle());
  const changedRaw = structuredClone(validRaw);
  const isolatedEdge = changedRaw.features.find((feature) => feature.edge_id === 'e-de');
  isolatedEdge.coordinates = [[-74.95, 40.02], [-74.94, 40.02]];
  const changed = lifecycle(changedRaw);
  original.receipt = createCandidateReceipt({
    ...changed,
    baseline: null,
    review: reviewEvidence(),
  });
  assert.throws(() => admitCandidateBundle(original), hasCode('bundle-artifact-drift'));
});

test('all public safe-data paths reject prototype-pollution keys', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const malicious = { safe: 'value' };
    Object.defineProperty(malicious, key, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: { polluted: true },
    });
    assert.throws(() => freezeData(malicious), hasCode('blocked-property-key'));
    assert.throws(() => canonicalStringify({ nested: malicious }), hasCode('blocked-property-key'));
    assert.equal({}.polluted, undefined);
  }
});

test('external candidate bundle stays candidate-external and can never become product or publish eligible', () => {
  const externalDescriptor = structuredClone(descriptor);
  externalDescriptor.sourceId = 'osm-pilot';
  externalDescriptor.sourceKind = 'osm';
  const externalProfile = structuredClone(profile);
  externalProfile.profileId = 'osm-walking-v1';
  externalProfile.sourceKind = 'osm';
  const externalRaw = structuredClone(validRaw);
  externalRaw.sourceId = 'osm-pilot';
  externalRaw.sourceKind = 'osm';
  const external = {
    descriptor: externalDescriptor,
    profile: externalProfile,
    normalization: normalizeRouteGraphCandidate(externalRaw, externalProfile),
  };
  const bundle = createCandidateBundle({
    ...external,
    baseline: null,
    review: reviewEvidence(),
  });
  assert.equal(bundle.dataClassification, 'candidate-external');
  assert.equal(bundle.graph.schema, 'route-graph-candidate/v1');
  assert.notEqual(bundle.graph.schema, 'GraphArtifact/v1');
  assert.equal(bundle.receipt.eligibility.harnessEligible, false);
  assert.equal(bundle.eligibility.harnessEligible, true);
  assert.equal(bundle.eligibility.productionEligible, false);
  assert.equal(bundle.eligibility.publishEligible, false);
  assert.equal(bundle.receipt.eligibility.productionEligible, false);
  assert.equal(bundle.receipt.eligibility.publishEligible, false);
  assert.ok(bundle.receipt.limitations.some((limitation) => /does not prove/i.test(limitation)));
});

function admittedBundle() {
  const candidate = lifecycle();
  return createCandidateBundle({
    ...candidate,
    baseline: null,
    review: reviewEvidence(),
  });
}

function lifecycle(raw = validRaw) {
  return {
    descriptor: structuredClone(descriptor),
    profile: structuredClone(profile),
    normalization: normalizeRouteGraphCandidate(raw, profile),
  };
}

function reviewEvidence(
  evidenceRef = 'S3-1 fail-closed bundle fixture review',
  reviewedAt = '2026-08-12T04:00:00.000Z',
) {
  return {
    reviewedBy: 's3-integration-owner',
    reviewedAt,
    evidenceRef,
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/route_graph_candidate/${name}`, import.meta.url), 'utf8'));
}
