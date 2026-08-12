import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  acquireBoundedCandidatePayload,
  compareRouteGraphCandidates,
  createCandidateReceipt,
  normalizeRouteGraphCandidate,
} from '../lib/route_graph_candidate/index.mjs';

const descriptor = await fixture('synthetic_descriptor.json');
const profile = await fixture('walking_profile.json');
const raw = await fixture('valid_raw_graph.json');
const zeroLoop = await fixture('zero_cost_self_loop.json');
const lifecycle = makeLifecycle();

test('first-seen candidate is review-required and not harness eligible', () => {
  const comparison = compareRouteGraphCandidates({ candidate: lifecycle });
  assert.deepEqual(comparison.reasons, ['first-seen-candidate']);
  assert.equal(comparison.disposition, 'review-required');
  assert.equal(comparison.review.status, 'pending');
  const receipt = createCandidateReceipt({ ...lifecycle, baseline: null, review: null });
  assert.equal(receipt.eligibility.harnessEligible, false);
  assert.ok(receipt.eligibility.reasons.includes('semantic-review-required'));
  assert.equal(receipt.eligibility.productionEligible, false);
  assert.equal(receipt.eligibility.publishEligible, false);
});

test('retrieval build and observation clock-only changes do not masquerade as semantic drift', () => {
  const candidate = structuredClone(lifecycle);
  candidate.descriptor.clocks.retrievedAt = '2026-08-12T02:00:00.000Z';
  candidate.descriptor.clocks.builtAt = '2026-08-12T02:01:00.000Z';
  candidate.descriptor.clocks.observedAt = '2026-08-12T02:02:00.000Z';
  const comparison = compareRouteGraphCandidates({ baseline: lifecycle, candidate });
  assert.equal(comparison.disposition, 'unchanged');
  assert.deepEqual(comparison.reasons, []);
  assert.equal(comparison.review.status, 'not-required');
});

test('sourceAsOf changes remain visible as review-required semantic drift', () => {
  const candidate = structuredClone(lifecycle);
  candidate.descriptor.clocks.sourceAsOf = '2026-08-11';
  const comparison = compareRouteGraphCandidates({ baseline: lifecycle, candidate });
  assert.equal(comparison.disposition, 'review-required');
  assert.ok(comparison.reasons.includes('source-as-of-drift'));
});

test('licence and attribution drift is review-required rather than silently admitted', () => {
  const candidate = structuredClone(lifecycle);
  candidate.descriptor.license.derivativeRedistribution = 'unknown';
  const comparison = compareRouteGraphCandidates({ baseline: lifecycle, candidate });
  assert.equal(comparison.disposition, 'review-required');
  assert.ok(comparison.reasons.includes('license-attribution-drift'));
});

test('coverage drift is review-required and remains distinct from transport reachability', () => {
  const candidate = structuredClone(lifecycle);
  candidate.descriptor.coverage.routing.status = 'partial';
  candidate.descriptor.coverage.routing.description = 'Synthetic routing coverage is only partial.';
  const comparison = compareRouteGraphCandidates({ baseline: lifecycle, candidate });
  assert.equal(comparison.disposition, 'review-required');
  assert.ok(comparison.reasons.includes('coverage-drift'));
});

test('valid topology changes are review-required with an explicit topology reason', () => {
  const changedRaw = structuredClone(raw);
  changedRaw.features.find((feature) => feature.edge_id === 'e-bc').cost_integer += 1;
  const candidate = {
    descriptor: structuredClone(descriptor),
    profile: structuredClone(profile),
    normalization: normalizeRouteGraphCandidate(changedRaw, profile),
  };
  const comparison = compareRouteGraphCandidates({ baseline: lifecycle, candidate });
  assert.equal(comparison.disposition, 'review-required');
  assert.ok(comparison.reasons.includes('topology-drift'));
});

test('invalid topology is failed and cannot be reported as unchanged or reviewable drift', () => {
  const candidate = {
    descriptor: structuredClone(descriptor),
    profile: structuredClone(profile),
    normalization: normalizeRouteGraphCandidate(zeroLoop, profile),
  };
  const comparison = compareRouteGraphCandidates({ baseline: lifecycle, candidate });
  assert.equal(comparison.disposition, 'failed');
  assert.deepEqual(comparison.reasons, ['candidate-topology-invalid']);
  const receipt = createCandidateReceipt({ ...candidate, baseline: lifecycle, review: null });
  assert.equal(receipt.eligibility.harnessEligible, false);
  assert.ok(receipt.eligibility.reasons.includes('topology-audit-not-passed'));
  assert.ok(receipt.eligibility.reasons.includes('semantic-comparison-failed'));
});

test('partial fallback candidate stays explicit and never masquerades as last-known-good', () => {
  const partial = structuredClone(descriptor);
  partial.acquisition.status = 'partial';
  partial.acquisition.fallbackUsed = true;
  partial.acquisition.recordCount = null;
  partial.coverage.routing.status = 'partial';
  partial.coverage.routing.description = 'Partial candidate coverage; last-known-good was not substituted.';
  const candidate = { ...lifecycle, descriptor: partial };
  const receipt = createCandidateReceipt({ ...candidate, baseline: null, review: null });
  assert.equal(receipt.eligibility.harnessEligible, false);
  assert.ok(receipt.eligibility.reasons.includes('acquisition-not-complete'));
  assert.ok(receipt.eligibility.reasons.includes('fallback-used'));
  assert.ok(receipt.eligibility.reasons.includes('routing-coverage-not-validated'));
  assert.equal('current' in receipt, false);
  assert.equal('lastKnownGood' in receipt, false);
});

test('bounded endpoint response remains transport evidence only', async () => {
  const calls = [];
  const times = ['2026-08-12T03:00:00.000Z', '2026-08-12T03:00:01.000Z'];
  const observation = await acquireBoundedCandidatePayload({
    sourceId: 'osm-probe',
    sourceKind: 'osm',
    transport: { endpoint: 'https://example.invalid/osm-probe.json', method: 'GET' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response('{"type":"FeatureCollection","features":[]}', {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      });
    },
    maxBytes: 1_024,
    timeoutMs: 100,
    now: () => times.shift(),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(observation.dataClassification, 'candidate-external');
  assert.equal(observation.interpretation.endpointReachable, true);
  assert.equal(observation.interpretation.sourceFreshness, 'unknown');
  assert.equal(observation.interpretation.sourceCompleteness, 'unknown');
  assert.equal(observation.interpretation.modeFitness, 'unknown');
  assert.equal(observation.interpretation.licenseDisposition, 'not-evaluated');
  assert.equal(observation.interpretation.candidateAdmission, 'not-evaluated');
  assert.equal(observation.clocks.sourceAsOf, null);
  assert.equal('current' in observation.interpretation, false);
  assert.equal('allowed' in observation.interpretation, false);
  assert.match(observation.response.contentIdentity, /^sha256:[a-f0-9]{64}$/);
});

test('bounded acquisition rejects oversized responses without writing a candidate', async () => {
  await assert.rejects(
    acquireBoundedCandidatePayload({
      sourceId: 'city-probe',
      sourceKind: 'city',
      transport: { endpoint: 'https://example.invalid/city-probe.json', method: 'GET' },
      fetchImpl: async () => new Response('12345', { headers: { 'content-length': '5' } }),
      maxBytes: 4,
      timeoutMs: 100,
      now: () => '2026-08-12T03:00:00.000Z',
    }),
    hasCode('acquisition-too-large'),
  );
});

test('bounded candidate acquisition refuses non-read-only methods', async () => {
  await assert.rejects(
    acquireBoundedCandidatePayload({
      sourceId: 'city-probe',
      sourceKind: 'city',
      transport: { endpoint: 'https://example.invalid/city-probe.json', method: 'POST' },
      fetchImpl: async () => new Response('{}'),
    }),
    hasCode('probe-method'),
  );
});

test('bounded acquisition reports a timed-out endpoint without claiming reachability', async () => {
  await assert.rejects(
    acquireBoundedCandidatePayload({
      sourceId: 'osm-timeout',
      sourceKind: 'osm',
      transport: { endpoint: 'https://example.invalid/osm-timeout.json', method: 'GET' },
      fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
      timeoutMs: 5,
      now: () => '2026-08-12T03:00:00.000Z',
    }),
    hasCode('acquisition-timeout'),
  );
});

function makeLifecycle() {
  return {
    descriptor: structuredClone(descriptor),
    profile: structuredClone(profile),
    normalization: normalizeRouteGraphCandidate(raw, profile),
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/route_graph_candidate/${name}`, import.meta.url), 'utf8'));
}
