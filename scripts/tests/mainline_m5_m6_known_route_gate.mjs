import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  admitKnownRouteEvidenceReadiness,
  buildKnownRouteEvidenceReadiness,
  knownRouteEvidenceDimensionIds,
} from '../lib/known_route_evidence_readiness.mjs';
import {
  admitR7GoNoGoReport,
  evaluateR7GoNoGoGate,
  r7FutureCandidateVocabulary,
} from '../lib/r7_go_no_go_gate.mjs';

const readinessPath = new URL('../../reports/known-route/evidence-readiness.v1.json', import.meta.url);
const gatePath = new URL('../../reports/known-route/r7-go-no-go.v1.json', import.meta.url);
const digest = (character) => `sha256:${character.repeat(64)}`;

test('M5 tracked readiness keeps incidents, crash, accessibility, legality, calibration, and sensitivity separate', async () => {
  const readiness = admitKnownRouteEvidenceReadiness(JSON.parse(await readFile(readinessPath, 'utf8')));
  assert.equal(readiness.status, 'unavailable');
  assert.equal(readiness.incidents_crash_separated, true);
  assert.equal(readiness.dimensions[0].dimension_id, 'reported-incidents');
  assert.equal(readiness.dimensions[1].dimension_id, 'raw-crash');
  assert.ok(readiness.dimensions.every((dimension) => dimension.status === 'unavailable'));
  assert.equal(readiness.sensitivity.stable_under_approved_scenarios, null);
  assert.equal(readiness.cross_dimension_combination, 'forbidden');
  assert.ok(Object.values(readiness.authority).every((value) => value === false));
});

test('M6 tracked report is mechanically NO-GO/UNAVAILABLE and contains no generated decision output keys', async () => {
  const report = admitR7GoNoGoReport(JSON.parse(await readFile(gatePath, 'utf8')));
  assert.equal(report.decision, 'NO-GO');
  assert.equal(report.availability, 'UNAVAILABLE');
  assert.deepEqual(report.future_candidate_contract.vocabulary, [
    'fastest', 'balanced', 'lower-modeled-exposure',
  ]);
  assert.equal(report.future_candidate_contract.activated, false);
  assert.equal(report.output_boundary.generated, false);
  assert.ok(report.hard_gates.some(({ status }) => status === 'FAIL'));
  assertNoGeneratedOutputKeys(report);
});

test('M6 hard gates can become GO only with exact bindings, calibration, walking legality, and stable scenarios', () => {
  const dimensions = knownRouteEvidenceDimensionIds().map((dimensionId, index) => ({
    dimension_id: dimensionId,
    status: 'available',
    receipt_identity: digest(String((index % 9) + 1)),
    producer_identity: digest('a'),
    reason: 'Exact route-bound aggregate fixture.',
  }));
  const readiness = buildKnownRouteEvidenceReadiness({
    observed_at: '2026-08-31T00:00:00.000Z',
    bindings: {
      route_identity: `route:${'1'.repeat(16)}`,
      corridor_identity: `known-route-corridor:${'2'.repeat(16)}`,
      centerline_identity: `centerline-catalog:${'3'.repeat(16)}`,
      catalog_identity: `centerline-catalog:${'4'.repeat(16)}`,
      crash_accessibility_producer_identity: digest('b'),
      mode_legality_producer_identity: digest('c'),
    },
    dimensions,
    sensitivity: {
      status: 'available', receipt_identity: digest('d'),
      approved_scenarios: ['match-tolerance-low', 'match-tolerance-high'],
      stable_under_approved_scenarios: true,
      reason: 'Both pre-approved scenarios passed the frozen stability limits.',
    },
  });
  const report = evaluateR7GoNoGoGate({
    evaluated_at: '2026-08-31T00:00:01.000Z', readiness,
  });
  assert.equal(report.decision, 'GO');
  assert.equal(report.availability, 'AVAILABLE');
  assert.equal(report.output_boundary.generated, false);
  assert.equal(report.future_candidate_contract.activated, false);
  assert.deepEqual(r7FutureCandidateVocabulary(), ['fastest', 'balanced', 'lower-modeled-exposure']);
  assertNoGeneratedOutputKeys(report);
});

test('M6 fails closed when one hard gate is absent and rejects injected route output', async () => {
  const readiness = JSON.parse(await readFile(readinessPath, 'utf8'));
  const report = evaluateR7GoNoGoGate({
    evaluated_at: '2026-08-31T00:00:01.000Z', readiness,
  });
  assert.equal(report.decision, 'NO-GO');

  const hostile = structuredClone(report);
  hostile.alternatives = [];
  assert.throws(() => admitR7GoNoGoReport(hostile));
});

function assertNoGeneratedOutputKeys(value) {
  const forbidden = new Set([
    'routes', 'alternatives', 'ranking', 'rankings', 'winner', 'safest',
    'score', 'scores', 'combined_safety_score',
  ]);
  const visit = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, key);
      visit(child);
    }
  };
  visit(value);
}
