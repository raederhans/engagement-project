import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitCandidateReceipt,
  admitModeProfile,
  admitSourceDescriptor,
  compareRouteGraphCandidates,
  createCandidateBundle,
  createCandidateReceipt,
  normalizeRouteGraphCandidate,
} from '../lib/route_graph_candidate/index.mjs';

const profileFixture = await fixture('walking_profile.json');
const descriptorFixture = await fixture('synthetic_descriptor.json');
const rawFixture = await fixture('valid_raw_graph.json');

test('mode profile admission is descriptor-safe and deeply frozen', () => {
  const profile = admitModeProfile(profileFixture);
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.fields));
  assert.ok(Object.isFrozen(profile.oneway.forward));
  assert.throws(() => { profile.cost.maximum = 1; }, TypeError);
});

test('profile accessors are rejected without executing getters', () => {
  const malicious = structuredClone(profileFixture);
  let executions = 0;
  Object.defineProperty(malicious, 'mode', {
    enumerable: true,
    get() {
      executions += 1;
      return 'walking';
    },
  });
  assert.throws(() => admitModeProfile(malicious), hasCode('accessor-property'));
  assert.equal(executions, 0);
});

test('source receipt separates owner transport licence attribution coverage and four clocks', () => {
  const descriptor = admitSourceDescriptor(descriptorFixture);
  assert.equal(descriptor.clocks.sourceAsOf, null);
  assert.equal(descriptor.clocks.retrievedAt, '2026-08-12T00:00:00.000Z');
  assert.equal(descriptor.clocks.builtAt, '2026-08-12T00:01:00.000Z');
  assert.equal(descriptor.clocks.observedAt, '2026-08-12T00:02:00.000Z');
  assert.notEqual(descriptor.owner.canonicalUrl, descriptor.transport.endpoint);
  assert.equal(descriptor.license.derivativeRedistribution, 'prohibited');
  assert.equal(descriptor.attribution.required, false);
  assert.equal(descriptor.coverage.routing.status, 'validated');
  assert.ok(Object.isFrozen(descriptor.coverage.routing));
});

test('missing mode semantics fail closed at the profile boundary', () => {
  const profile = structuredClone(profileFixture);
  delete profile.modeValues.missing;
  assert.throws(() => admitModeProfile(profile), hasCode('schema-mismatch'));
});

test('mode one-way and access missing policies must all be reject', () => {
  for (const mutate of [
    (profile) => { profile.oneway.missing = 'allow'; },
    (profile) => { profile.access.unknown = 'allow'; },
    (profile) => { profile.modeValues.missing = 'allow'; },
  ]) {
    const profile = structuredClone(profileFixture);
    mutate(profile);
    assert.throws(() => admitModeProfile(profile), hasCode('non-fail-closed-policy'));
  }
});

test('external candidate bundle can be harness eligible only after explicit semantic review', () => {
  const lifecycle = externalLifecycle();
  const comparison = compareRouteGraphCandidates({ candidate: lifecycle });
  assert.equal(comparison.disposition, 'review-required');
  const review = {
    reviewedBy: 's3-integration-owner',
    reviewedAt: '2026-08-12T01:00:00.000Z',
    evidenceRef: 'S3-1 bounded candidate review fixture',
  };
  const bundle = createCandidateBundle({ ...lifecycle, baseline: null, review });
  const { receipt } = bundle;
  assert.equal(receipt.dataClassification, 'candidate-external');
  assert.equal(receipt.source.sourceKind, 'osm');
  assert.equal(receipt.artifact.sourceKind, 'osm');
  assert.equal(receipt.artifact.dataClassification, 'candidate-external');
  assert.equal(receipt.artifact.schema, 'route-graph-candidate/v1');
  assert.notEqual(receipt.artifact.schema, 'GraphArtifact/v1');
  assert.equal(receipt.eligibility.harnessEligible, false);
  assert.ok(receipt.eligibility.reasons.includes('candidate-bundle-required'));
  assert.equal(bundle.eligibility.harnessEligible, true);
  assert.deepEqual(bundle.eligibility.reasons, []);
  assert.equal(receipt.eligibility.productionEligible, false);
  assert.equal(receipt.eligibility.publishEligible, false);
});

test('candidate receipt rejects external-to-synthetic reclassification', () => {
  const lifecycle = externalLifecycle();
  const receipt = structuredClone(createCandidateReceipt({
    ...lifecycle,
    baseline: null,
    review: reviewEvidence(),
  }));
  receipt.dataClassification = 'candidate-synthetic-fixture';
  assert.throws(() => admitCandidateReceipt(receipt), hasCode('receipt-data-classification'));
});

test('standalone receipt cannot promote harness production or publish eligibility', () => {
  const lifecycle = externalLifecycle();
  const receipt = structuredClone(createCandidateReceipt({
    ...lifecycle,
    baseline: null,
    review: reviewEvidence(),
  }));
  assert.equal(receipt.eligibility.harnessEligible, false);
  receipt.eligibility.harnessEligible = true;
  receipt.eligibility.reasons = [];
  assert.throws(() => admitCandidateReceipt(receipt), hasCode('receipt-eligibility-drift'));
  receipt.eligibility.harnessEligible = false;
  receipt.eligibility.reasons = ['candidate-bundle-required'];
  receipt.eligibility.productionEligible = true;
  assert.throws(() => admitCandidateReceipt(receipt), hasCode('receipt-public-eligibility'));
  receipt.eligibility.productionEligible = false;
  receipt.eligibility.publishEligible = true;
  assert.throws(() => admitCandidateReceipt(receipt), hasCode('receipt-public-eligibility'));
});

function externalLifecycle() {
  const descriptor = structuredClone(descriptorFixture);
  descriptor.sourceId = 'osm-pilot';
  descriptor.sourceKind = 'osm';
  const profile = structuredClone(profileFixture);
  profile.profileId = 'osm-walking-v1';
  profile.sourceKind = 'osm';
  const raw = structuredClone(rawFixture);
  raw.sourceId = 'osm-pilot';
  raw.sourceKind = 'osm';
  return { descriptor, profile, normalization: normalizeRouteGraphCandidate(raw, profile) };
}

function reviewEvidence() {
  return {
    reviewedBy: 's3-integration-owner',
    reviewedAt: '2026-08-12T01:00:00.000Z',
    evidenceRef: 'S3-1 bounded candidate review fixture',
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/route_graph_candidate/${name}`, import.meta.url), 'utf8'));
}
