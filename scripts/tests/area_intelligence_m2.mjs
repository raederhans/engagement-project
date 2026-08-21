import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  accumulateIrls,
  baselinePredictions,
  createIrlsAccumulator,
  featureVector,
  isSpatialHoldout,
  linearPrediction,
  negativeBinomialDeviance,
  negativeBinomialInterval,
  poissonDeviance,
  poissonInterval,
  solveIrls,
} from '../lib/area_intelligence_model.mjs';
import {
  buildAreaIntelligenceMarts,
  utcMonday,
} from '../lib/area_intelligence_mart.mjs';
import {
  evaluatePromotion,
  validateModelEvaluationReport,
} from '../lib/area_intelligence_evaluation.mjs';
import { validateAreaIntelligenceServingArtifact } from '../../src/area_intelligence/serving_contract.js';
import {
  buildAreaIntelligenceHtml,
  createAreaIntelligencePresentation,
} from '../../src/area_intelligence/view.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const protocolPath = path.join(repoRoot, 'scripts/data/area_intelligence_evaluation_protocol.v1.json');

test('M2 evaluation protocol is frozen before performance and preserves claim/admission boundaries', async () => {
  const protocol = JSON.parse(await fs.readFile(protocolPath, 'utf8'));
  assert.equal(protocol.schema, 'engagement-area-intelligence-evaluation-protocol/v1');
  assert.equal(protocol.frozen_before_model_performance, true);
  assert.equal(protocol.rolling_folds.length, 4);
  assert.equal(protocol.admission.tract, 'spatial.tract.status=mapped-only');
  assert.equal(protocol.admission.acs.race_income_poverty, 'unavailable');
  assert.ok(protocol.target.forbidden_claims.includes('individual victim probability'));
  assert.ok(protocol.target.forbidden_claims.includes('safest route'));
  assert.equal(protocol.promotion_gate.all_primary_slices_must_pass, true);
});

test('weekly features are strictly historical and seasonal baseline uses exactly lag 52', () => {
  const counts = Int32Array.from({ length: 80 }, (_, index) => index % 9);
  const before = featureVector(counts, 60, '2025-03-03');
  const baselines = baselinePredictions(counts, 60);
  counts[60] = 999;
  counts[79] = 888;
  assert.deepEqual(featureVector(counts, 60, '2025-03-03'), before);
  assert.equal(baselines['seasonal-naive-52w'], counts[8]);
  assert.equal(utcMonday('2026-08-20T03:47:00.000Z'), '2026-08-17');
});

test('spatial holdout is deterministic at block grain', () => {
  const block = 'epsg3857-2km:-4187:2428';
  assert.equal(isSpatialHoldout(block), isSpatialHoldout(block));
  const remainders = new Set(Array.from({ length: 100 }, (_, index) => (
    createHash('sha256').update(`block-${index}`).digest().readUInt32BE(0) % 5
  )));
  assert.deepEqual(remainders, new Set([0, 1, 2, 3, 4]));
});

test('Poisson and negative-binomial baselines remain finite under zeros and over-dispersion', () => {
  let beta = [0, 0, 0, 0, 0, 0];
  const counts = Int32Array.from({ length: 180 }, (_, index) => (index % 17 === 0 ? 15 : index % 5 === 0 ? 2 : 0));
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const accumulator = createIrlsAccumulator();
    for (let index = 52; index < counts.length; index += 1) {
      const features = featureVector(counts, index, `2024-${String((index % 12) + 1).padStart(2, '0')}-05`);
      accumulateIrls(accumulator, features, counts[index], beta);
    }
    beta = solveIrls(accumulator, beta).beta;
  }
  const prediction = linearPrediction(beta, featureVector(counts, 179, '2026-08-10')).mean;
  assert.ok(Number.isFinite(prediction) && prediction > 0);
  assert.ok(Number.isFinite(poissonDeviance(0, prediction)));
  assert.ok(Number.isFinite(negativeBinomialDeviance(15, prediction, 0.7)));
  const poisson = poissonInterval(prediction);
  const nb = negativeBinomialInterval(prediction, 0.7);
  assert.ok(poisson.lower >= 0 && poisson.upper >= poisson.lower);
  assert.ok(nb.lower >= 0 && nb.upper >= nb.lower);
});

test('promotion gate requires every predefined temporal and spatial slice', () => {
  const protocol = {
    rolling_folds: [{ id: 'fold' }],
    spatial_holdout: { report_slices: ['temporal-non-heldout', 'spatial-heldout'] },
    promotion_gate: {
      eligible_models: ['poisson-log-link-v1'],
      minimum_observations_per_primary_slice: 1000,
      minimum_relative_mae_gain_each_fold_unit_and_holdout_slice: 0.02,
      minimum_aggregate_relative_mae_gain: 0.05,
      acceptable_interval_coverage_inclusive: [0.85, 0.95],
      maximum_category_mae_regression_vs_seasonal: 0.1,
      failure_result: 'honest-no-promotion-historical-trends-only',
    },
  };
  const primary = [];
  for (const unit_type of ['tract', 'fixed-grid']) {
    for (const holdout_slice of protocol.spatial_holdout.report_slices) {
      primary.push({
        model: 'poisson-log-link-v1', fold: 'fold', unit_type, holdout_slice,
        observations: 2000, relative_mae_gain_vs_seasonal_naive: 0.06,
        prediction_interval_90_coverage: 0.9, poisson_deviance: 1, negative_binomial_deviance: 1,
      });
    }
  }
  const finalized = {
    primary,
    category: [{ model: 'poisson-log-link-v1', fold: 'fold', category: 'person', holdout_slice: 'spatial-heldout', relative_mae_gain_vs_seasonal_naive: 0 }],
    aggregate: [{ model: 'poisson-log-link-v1', relative_mae_gain_vs_seasonal_naive: 0.06 }],
  };
  assert.equal(evaluatePromotion(finalized, protocol).status, 'promoted');
  finalized.primary[0].relative_mae_gain_vs_seasonal_naive = 0.019;
  const rejected = evaluatePromotion(finalized, protocol);
  assert.equal(rejected.status, 'not-promoted');
  assert.match(rejected.candidates[0].reasons.join(','), /mae-gain-below-gate/);
});

test('ModelEvaluationReport contract rejects missing promotion and non-finite primary metrics', () => {
  const valid = {
    schema: 'ModelEvaluationReport/v1',
    protocol: { frozen_before_model_performance: true },
    metrics: {
      primary_by_fold_space_holdout: [{
        model: 'seasonal-naive-52w', fold: 'fold', mae: 1,
        poisson_deviance: 1, negative_binomial_deviance: 1,
        prediction_interval_90_coverage: 0.9,
        relative_mae_gain_vs_seasonal_naive: 0,
      }],
      by_category: [],
      by_data_volume: [],
    },
    promotion: { status: 'not-promoted' },
  };
  assert.equal(validateModelEvaluationReport(valid), true);
  valid.metrics.primary_by_fold_space_holdout[0].mae = Number.NaN;
  assert.throws(() => validateModelEvaluationReport(valid), /non-finite/);
});

test('serving contract and bilingual-safe view keep promoted and no-promotion states explicit', () => {
  const noPromotion = servingArtifact({ promoted: false });
  assert.equal(validateAreaIntelligenceServingArtifact(noPromotion).forecast.status, 'unavailable');
  const unavailableHtml = buildAreaIntelligenceHtml(createAreaIntelligencePresentation(noPromotion, { queryMode: 'tract', selectedTractGEOID: '42101007400' }));
  assert.match(unavailableHtml, /did not exceed the pre-defined seasonal baseline/i);
  assert.match(unavailableHtml, /no zero forecast or hidden fallback/i);

  const promoted = servingArtifact({ promoted: true });
  const presentation = createAreaIntelligencePresentation(promoted, { queryMode: 'tract', selectedTractGEOID: '42101007400' });
  const promotedHtml = buildAreaIntelligenceHtml(presentation);
  assert.equal(presentation.status, 'promoted');
  assert.match(promotedHtml, /Modeled reported-incident count/i);
  assert.match(promotedHtml, /90% prediction interval/i);
  assert.match(promotedHtml, /not individual risk, absolute safety, or a route recommendation/i);

  promoted.forecast.predictions[0].prediction_interval_90 = null;
  assert.throws(() => validateAreaIntelligenceServingArtifact(promoted), /prediction contract is invalid/);
});

test('streaming mart build resumes, excludes ambiguous/unavailable units, and reruns semantically idempotent', async (t) => {
  const testRoot = path.join(repoRoot, '.dfev1', `area-intelligence-test-${process.pid}-${Date.now()}`);
  const sourceRoot = path.join(testRoot, 'source');
  const outputRoot = path.join(testRoot, 'output');
  const fixtureProtocolPath = path.join(testRoot, 'protocol.json');
  await fs.mkdir(testRoot, { recursive: true });
  t.after(async () => fs.rm(testRoot, { recursive: true, force: true }));
  const snapshotId = 'sha256:synthetic-source-snapshot';
  const acquisitionRoot = path.join(sourceRoot, 'acquisition');
  await fs.mkdir(acquisitionRoot, { recursive: true });
  await fs.writeFile(path.join(acquisitionRoot, 'manifest.json'), `${JSON.stringify({ snapshot_id: snapshotId, row_count: 5 })}\n`);
  const events = [
    event({ id: 1, tractStatus: 'mapped', gridStatus: 'mapped', week: '2024-01-01T12:00:00.000Z', snapshotId }),
    event({ id: 2, tractStatus: 'ambiguous', gridStatus: 'mapped', week: '2024-01-08T12:00:00.000Z', snapshotId }),
    event({ id: 3, tractStatus: 'unmapped', gridStatus: 'unavailable', week: '2024-01-15T12:00:00.000Z', snapshotId }),
    event({ id: 4, tractStatus: 'mapped', gridStatus: 'mapped', week: '2024-01-22T12:00:00.000Z', snapshotId }),
    event({ id: 5, tractStatus: 'mapped', gridStatus: 'mapped', week: '2024-01-22T13:00:00.000Z', snapshotId }),
  ];
  const canonicalRoot = path.join(sourceRoot, 'warehouse', 'canonical');
  await fs.mkdir(canonicalRoot, { recursive: true });
  await fs.writeFile(path.join(canonicalRoot, 'part-000.jsonl'), `${events.slice(0, 3).map(JSON.stringify).join('\n')}\n`);
  await fs.writeFile(path.join(canonicalRoot, 'part-001.jsonl'), `${events.slice(3).map(JSON.stringify).join('\n')}\n`);
  const manifest = {
    schema: 'engagement-phl-crime-event-warehouse/v1', mode: 'synthetic-fixture', serving_eligible: false,
    partition_count: 2, canonical_row_count: 5, active_row_count: 5,
    current_snapshot_id: snapshotId, applied_snapshot_ids: [snapshotId],
    coverage: { earliest_scope_start: '2024-01-01', latest_scope_end_exclusive: '2024-02-01', latest_event_at: '2024-01-22T13:00:00.000Z' },
    transforms: { tract_boundary_id: 'tracts', tract_geography_definition: '2020-census-tracts', grid_scheme: 'epsg3857-square-grid-v1', acs_snapshot_id: 'acs', acs_vintage: '2024' },
  };
  const checkpoint = {
    completed: { scope: {} },
    final_quality: { acquired_rows: 5, date_scoped_count_complete: true },
  };
  const lineage = {
    source_snapshots: [{ snapshot_id: snapshotId, manifest_path: path.join(acquisitionRoot, 'manifest.json'), row_count: 5, availability: 'available', source_as_of: '2024-01-22T13:00:00.000Z', scope: {} }],
    model_input_contract: { serving_status: 'not-published' },
  };
  await fs.mkdir(path.join(sourceRoot, 'warehouse', 'lineage'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'warehouse', 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(sourceRoot, 'backfill-checkpoint.json'), `${JSON.stringify(checkpoint)}\n`);
  await fs.writeFile(path.join(sourceRoot, 'warehouse', 'lineage', 'registry.json'), `${JSON.stringify(lineage)}\n`);
  const protocol = JSON.parse(await fs.readFile(protocolPath, 'utf8'));
  protocol.exact_input_gate = {
    ...protocol.exact_input_gate,
    scope_start: '2024-01-01', scope_end_exclusive: '2024-02-01', completed_scope_count: 1,
    canonical_row_count: 5, active_row_count: 5, partition_count: 2, source_snapshot_count: 1,
  };
  await fs.writeFile(fixtureProtocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  let interrupted = false;
  await assert.rejects(() => buildAreaIntelligenceMarts({
    sourceRoot, outputRoot, protocolPath: fixtureProtocolPath,
    tractGeoJsonPath: path.join(repoRoot, 'public/data/tracts_phl.geojson'),
    outputPartitionCount: 2, allowSyntheticFixture: true,
    onProgress(value) {
      if (!interrupted && value.phase === 'stage-partition') {
        interrupted = true;
        throw new Error('synthetic interruption');
      }
    },
  }), /synthetic interruption/);
  const built = await buildAreaIntelligenceMarts({
    sourceRoot, outputRoot, protocolPath: fixtureProtocolPath,
    tractGeoJsonPath: path.join(repoRoot, 'public/data/tracts_phl.geojson'),
    outputPartitionCount: 2, allowSyntheticFixture: true,
    now: () => new Date('2026-08-21T00:00:00.000Z'),
  });
  assert.equal(built.manifest.admission.canonical_rows_seen, 5);
  assert.deepEqual(built.manifest.admission.tract, { admitted: 3, ambiguous_excluded: 1, unmapped_excluded: 1 });
  assert.deepEqual(built.manifest.admission['fixed-grid'], { admitted: 4, unavailable_excluded: 1 });
  const publishedManifestPath = path.join(outputRoot, 'manifest.json');
  const firstStat = await fs.stat(publishedManifestPath);
  const firstBytes = await fs.readFile(publishedManifestPath);
  const rerun = await buildAreaIntelligenceMarts({
    sourceRoot, outputRoot, protocolPath: fixtureProtocolPath,
    tractGeoJsonPath: path.join(repoRoot, 'public/data/tracts_phl.geojson'),
    outputPartitionCount: 2, allowSyntheticFixture: true,
  });
  assert.equal(rerun.idempotent, true);
  assert.deepEqual(await fs.readFile(publishedManifestPath), firstBytes);
  assert.equal((await fs.stat(publishedManifestPath)).mtimeMs, firstStat.mtimeMs);
  for (const part of built.manifest.parts) {
    const contents = await fs.readFile(path.join(outputRoot, ...part.path.split('/')), 'utf8');
    assert.doesNotMatch(contents, /generalized_location|coordinate|source_record_id/);
  }
});

function event({ id, tractStatus, gridStatus, week, snapshotId }) {
  const geoid = '42101007400';
  return {
    event_at: week,
    lifecycle: { state: 'active' },
    normalized_category: { status: 'mapped', theme_id: id % 2 ? 'person' : 'property' },
    source_vintage: { snapshot_id: snapshotId },
    lineage: { source_snapshot_id: snapshotId },
    spatial: {
      tract: { status: tractStatus, geoid: tractStatus === 'mapped' ? geoid : null },
      grid: { status: gridStatus, gridId: gridStatus === 'mapped' ? `epsg3857-500m:-1674${id % 2}1:9713` : null },
    },
    acs: { valueStatus: 'available', estimate: { value: 3632 }, moe90: { value: 811 } },
  };
}

function servingArtifact({ promoted }) {
  const generatedAt = '2026-08-21T08:00:00.000Z';
  const model = 'negative-binomial-log-link-v1';
  return {
    schema: 'engagement-area-intelligence-serving/v1',
    generated_at: generatedAt,
    status: promoted ? 'promoted' : 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-22' },
      source_vintage: 'sha256:source',
      limitations: ['Historical evidence only.'],
    },
    forecast: promoted ? {
      status: 'available',
      model_version: model,
      predictions: [{
        unit_type: 'tract', unit_id: '42101007400', target_week_start: '2026-08-17',
        predicted_reported_incident_count: 4.2,
        prediction_interval_90: { lower: 1, upper: 9 },
        trained_through: '2025-08-18', feature_observed_through: '2026-08-17',
        model_version: model, generated_at: generatedAt, source_vintage: 'sha256:source',
        limitations: ['Modeled count only.'],
      }],
    } : {
      status: 'unavailable', reason: 'model-did-not-exceed-predefined-seasonal-baseline', predictions: [],
    },
    evaluation: {
      promotion_status: promoted ? 'promoted' : 'not-promoted',
      selected_model: promoted ? model : null,
      audit_model: model,
      protocol_sha256: 'protocol',
    },
    forbidden_claims: ['individual victim probability', 'absolute safety', 'safest route'],
  };
}
