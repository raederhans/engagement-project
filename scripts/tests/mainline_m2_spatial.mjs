import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildSpatialAttributionSensitivityReport,
  createUncertaintyFootprintArtifact,
  footprintCandidateWeights,
} from '../lib/uncertainty_footprint_artifact.mjs';
import { loadSpatialAttributionProtocolV3 } from '../lib/spatial_attribution_protocol_v3.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;

test('M2 freezes fractional and kernel weights without canonical-event mutation', () => {
  const footprint = fixtureFootprint();
  assert.equal(footprint.schema, 'UncertaintyFootprintArtifact/v1');
  assert.equal(footprint.canonical_event_mutation, false);
  assert.deepEqual(footprint.authority, {
    scientific: false, forecast: false, serving: false, safety: false,
  });
  const weights = footprintCandidateWeights(footprint, 'kernel-gaussian-100m');
  assert.equal(weights.length, 2);
  for (const row of weights) {
    assert.equal(row.method, 'area-kernel');
    assert.equal(row.input_artifact_identity, footprint.artifact_identity);
    assert.ok(Math.abs(row.candidate_weights.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-9);
    assert.equal(row.known_route_segment_kernel_used, false);
  }
});

test('M2 compares tract, grid, fractional, and every approved kernel as aggregate-only evidence', () => {
  const footprint = fixtureFootprint();
  const report = buildSpatialAttributionSensitivityReport({
    footprint,
    method_results: [
      result('tract-fail-closed', null, 'tract', [['tract-1', 1.2], ['tract-2', 0.8]]),
      result('fixed-grid-500m', null, 'fixed-grid', [['grid-1', 1], ['grid-2', 1]]),
      result('fractional', 'fractional-uniform-50m', 'tract', [['tract-1', 1.1], ['tract-2', 0.9]]),
      result('area-kernel', 'kernel-gaussian-100m', 'tract', [['tract-1', 1.05], ['tract-2', 0.95]]),
      result('area-kernel', 'kernel-gaussian-250m', 'tract', [['tract-1', 1], ['tract-2', 1]]),
    ],
    population_slices: [
      { unit_id: 'tract-1', slice: 'high' },
      { unit_id: 'tract-2', slice: 'low' },
    ],
    stability_gate: {
      maximum_tract_relative_variation: 0.3,
      maximum_rank_shift: 1,
      frozen_before_analysis: true,
    },
  });
  assert.equal(report.mass_conservation.passed, true);
  assert.equal(report.stable_under_approved_scenarios, true);
  assert.equal(report.privacy.aggregate_only, true);
  assert.equal(report.privacy.event_rows_included, false);
  assert.equal(report.prediction_geometry_decision, 'review-required-no-promotion');
});

test('M2 fails closed on non-conserving weights and preserves historical v2 bytes', async () => {
  const input = footprintInput();
  input.assignments[0].scenario_weights[0].weights[0].weight = 0.8;
  assert.throws(() => createUncertaintyFootprintArtifact(input), /conserve one unit/);

  const v2 = await readFile(new URL('../data/area_intelligence_evaluation_protocol.v2.json', import.meta.url));
  assert.equal(`sha256:${createHash('sha256').update(v2).digest('hex')}`,
    'sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde');
  const v3 = await loadSpatialAttributionProtocolV3();
  assert.equal(v3.protocol.geography_gate.official_centerline.current_status, 'unavailable');
  assert.equal(v3.protocol.decision_boundary.unstable_result, 'fixed-grid-500m-remains-primary');
});

function fixtureFootprint() {
  return createUncertaintyFootprintArtifact(footprintInput());
}

function footprintInput() {
  const scenarios = [
    {
      id: 'fractional-uniform-50m', method: 'fractional', approved: true,
      analysis_assumption: 'Uniform mass inside a 50 m analysis buffer.',
      parameters: { shape: 'uniform-buffer', radius_m: 50 },
    },
    {
      id: 'kernel-gaussian-100m', method: 'area-kernel', approved: true,
      analysis_assumption: 'Gaussian area kernel with a 100 m bandwidth.',
      parameters: { shape: 'gaussian', bandwidth_m: 100, truncation_m: 300 },
    },
    {
      id: 'kernel-gaussian-250m', method: 'area-kernel', approved: true,
      analysis_assumption: 'Gaussian area kernel with a 250 m bandwidth.',
      parameters: { shape: 'gaussian', bandwidth_m: 250, truncation_m: 750 },
    },
  ];
  const scenarioWeights = scenarios.map(({ id }) => ({
    scenario_id: id,
    weights: [{ unit_id: 'tract-1', weight: 0.6 }, { unit_id: 'tract-2', weight: 0.4 }],
  }));
  return {
    frozen_at: '2026-08-31T00:00:00.000Z',
    source: {
      receipt_identity: digest('1'), canonical_manifest_identity: digest('2'),
      coverage_start: '2019-01-01', coverage_end_exclusive: '2026-01-01',
      generalized_location_precision: 'source-generalized-block-face',
      producer_identity: digest('3'),
    },
    geography: {
      tract: descriptor('tract', '2020'),
      fixed_grid: descriptor('fixed-grid-500m', 'v1'),
      official_centerline: {
        ...descriptor('official-centerline', 'unavailable'),
        official: true,
        authority: 'reference-only',
      },
    },
    scenarios,
    assignments: [
      { row_token: digest('4'), scenario_weights: structuredClone(scenarioWeights) },
      { row_token: digest('5'), scenario_weights: structuredClone(scenarioWeights) },
    ],
  };
}

function descriptor(sourceId, vintage) {
  return {
    source_id: sourceId, dataset: sourceId, vintage, crs: 'EPSG:4326',
    schema_identity: digest('6'), catalog_identity: digest('7'),
  };
}

function result(method, scenarioId, geography, rows) {
  return {
    method,
    scenario_id: scenarioId,
    geography,
    status: 'available',
    reason: 'Deterministic aggregate fixture.',
    total_mass: rows.reduce((sum, [, mass]) => sum + mass, 0),
    aggregates: rows.map(([unit_id, mass]) => ({ unit_id, mass })),
  };
}
