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
  validateExactWarehouse,
} from '../lib/area_intelligence_mart.mjs';
import {
  evaluateAreaIntelligence,
  evaluatePromotion,
  validateAreaIntelligenceMartForEvaluation,
  validateModelEvaluationReport,
} from '../lib/area_intelligence_evaluation.mjs';
import { validateAreaIntelligenceServingArtifact } from '../../src/area_intelligence/serving_contract.js';
import {
  buildAreaIntelligenceHtml,
  createAreaIntelligencePresentation,
} from '../../src/area_intelligence/view.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const protocolPath = path.join(repoRoot, 'scripts/data/area_intelligence_evaluation_protocol.v2.json');
const legacyProtocolPath = path.join(repoRoot, 'scripts/data/area_intelligence_evaluation_protocol.v1.json');

test('M2 evaluation protocol is frozen before performance and preserves claim/admission boundaries', async () => {
  const protocolBytes = await fs.readFile(protocolPath);
  assert.equal(protocolBytes.includes(13), false, 'protocol bytes must remain LF-only in every checkout');
  assert.equal(
    createHash('sha256').update(protocolBytes).digest('hex'),
    '997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde',
    'protocol byte identity must be checkout-independent',
  );
  const protocol = JSON.parse(protocolBytes.toString('utf8'));
  const legacy = JSON.parse(await fs.readFile(legacyProtocolPath, 'utf8'));
  assert.equal(protocol.schema, 'engagement-area-intelligence-evaluation-protocol/v2');
  assert.equal(protocol.schema_version, 2);
  assert.equal(protocol.frozen_before_model_performance, true);
  assert.equal(protocol.exact_input_gate.receipt_schema, 'engagement-phl-crime-warehouse-receipt/v3');
  assert.equal(protocol.exact_input_gate.receipt_identity, 'sha256:bc439541f4c574fa0260f7538cf186f268c66dff98c03b8334969e703d55e315');
  assert.equal('canonical_row_count' in protocol.exact_input_gate, false);
  assert.equal('scope_end_exclusive' in protocol.exact_input_gate, false);
  for (const field of ['target', 'admission', 'marts', 'rolling_folds', 'spatial_holdout', 'models', 'leakage_guards', 'metrics', 'promotion_gate', 'artifact_policy']) {
    assert.deepEqual(protocol[field], legacy[field], `${field} must remain byte-semantically frozen from v1`);
  }
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

test('promotion gate requires every exact tuple and only yields a local candidate', async () => {
  const protocol = JSON.parse(await fs.readFile(protocolPath, 'utf8'));
  protocol.promotion_gate.eligible_models = ['poisson-log-link-v1'];
  const primary = protocol.primary_tuple_vocabulary.map((tuple) => ({
    model: 'poisson-log-link-v1', ...tuple,
    observations: 2000, relative_mae_gain_vs_seasonal_naive: 0.06,
    prediction_interval_90_coverage: 0.9, poisson_deviance: 1, negative_binomial_deviance: 1,
  }));
  const fitStates = [];
  for (const { id: fold } of protocol.rolling_folds) {
    for (const unit_type of protocol.marts.unit_types) {
      const categories = unit_type === 'tract' ? ['all', ...protocol.marts.categories.tract_audit] : ['all'];
      for (const category of categories) fitStates.push({
        model: 'poisson-log-link-v1', fold, unit_type, category, failures: [], passed: true,
      });
    }
  }
  const finalized = {
    primary,
    category: [{ model: 'poisson-log-link-v1', fold: 'fold-2019', category: 'person', holdout_slice: 'spatial-heldout', relative_mae_gain_vs_seasonal_naive: 0 }],
    aggregate: [{ model: 'poisson-log-link-v1', relative_mae_gain_vs_seasonal_naive: 0.06 }],
    numerical_diagnostics: {
      schema: 'engagement-area-intelligence-numerical-diagnostics/v1',
      fit_states: fitStates,
      primary_slices: protocol.primary_tuple_vocabulary.map((tuple) => ({
        model: 'poisson-log-link-v1', ...tuple, failures: [], passed: true,
      })),
    },
  };
  const candidate = evaluatePromotion(finalized, protocol);
  assert.equal(candidate.status, 'not-promoted');
  assert.equal(candidate.decision, 'local-candidate');
  assert.equal(candidate.selected_model, null);
  finalized.primary[0].relative_mae_gain_vs_seasonal_naive = 0.019;
  const rejected = evaluatePromotion(finalized, protocol);
  assert.equal(rejected.status, 'not-promoted');
  assert.equal(rejected.decision, 'no-promotion');
  assert.match(rejected.candidates[0].reasons.join(','), /mae-gain-below-gate/);
});

test('legacy shallow ModelEvaluationReport is rejected by the P3 deep contract', () => {
  const legacy = {
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
  assert.throws(() => validateModelEvaluationReport(legacy), /machine-checkable contract/);
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
  await fs.mkdir(testRoot, { recursive: true });
  t.after(async () => fs.rm(testRoot, { recursive: true, force: true }));
  const snapshotId = 'sha256:synthetic-source-snapshot';
  const acquisitionRoot = path.join(sourceRoot, 'acquisition');
  await fs.mkdir(acquisitionRoot, { recursive: true });
  await fs.writeFile(path.join(acquisitionRoot, 'manifest.json'), `${JSON.stringify({ schema: 'synthetic-source/v1', snapshot_id: snapshotId, row_count: 5 })}\n`);
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
    latest_quality_report: 'quality/current.json',
  };
  const checkpoint = {
    schema: 'engagement-phl-crime-backfill-checkpoint/v1',
    completed: { scope: {} },
    final_quality: { acquired_rows: 5, date_scoped_count_complete: true },
  };
  const lineage = {
    schema: 'engagement-phl-crime-lineage/v1',
    source_snapshots: [{ snapshot_id: snapshotId, manifest_path: path.join(acquisitionRoot, 'manifest.json'), row_count: 5, availability: 'available', source_as_of: '2024-01-22T13:00:00.000Z', scope: {} }],
    model_input_contract: { serving_status: 'not-published' },
  };
  await fs.mkdir(path.join(sourceRoot, 'warehouse', 'lineage'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'warehouse', 'quality'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'warehouse', 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(sourceRoot, 'backfill-checkpoint.json'), `${JSON.stringify(checkpoint)}\n`);
  await fs.writeFile(path.join(sourceRoot, 'warehouse', 'lineage', 'registry.json'), `${JSON.stringify(lineage)}\n`);
  await fs.writeFile(path.join(sourceRoot, 'warehouse', 'quality', 'current.json'), `${JSON.stringify({
    schema: 'engagement-phl-crime-data-quality/v2',
    snapshot_id: snapshotId,
  })}\n`);
  const receipt = await writeSyntheticWarehouseReceipt(sourceRoot, { snapshotId, events });
  const protocol = JSON.parse(await fs.readFile(protocolPath, 'utf8'));
  await validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture: true });

  const canonicalPart = path.join(canonicalRoot, 'part-000.jsonl');
  const canonicalBytes = await fs.readFile(canonicalPart);
  const canonicalTamper = Buffer.from(canonicalBytes);
  canonicalTamper[0] = canonicalTamper[0] === 0x7b ? 0x5b : 0x7b;
  await fs.writeFile(canonicalPart, canonicalTamper);
  await assert.rejects(
    validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture: true }),
    /canonical partition drifted|SHA-256/i,
  );
  await fs.writeFile(canonicalPart, canonicalBytes);

  const missingPart = `${canonicalPart}.missing`;
  await fs.rename(canonicalPart, missingPart);
  await assert.rejects(
    validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture: true }),
    /part set|ENOENT|no such file/i,
  );
  await fs.rename(missingPart, canonicalPart);

  const extraCanonicalPart = path.join(canonicalRoot, 'part-999.jsonl');
  await fs.writeFile(extraCanonicalPart, canonicalBytes);
  await assert.rejects(
    validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture: true }),
    /part set/i,
  );
  await fs.rm(extraCanonicalPart);

  const qualityPath = path.join(sourceRoot, 'warehouse', 'quality', 'current.json');
  const qualityBytes = await fs.readFile(qualityPath);
  await fs.writeFile(qualityPath, Buffer.concat([qualityBytes, Buffer.from(' ')]));
  await assert.rejects(
    validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture: true }),
    /quality.*bytes|SHA-256/i,
  );
  await fs.writeFile(qualityPath, qualityBytes);

  const receiptPath = path.join(sourceRoot, 'receipt.json');
  const receiptBytes = await fs.readFile(receiptPath);
  const wrongReceipt = JSON.parse(receiptBytes.toString('utf8'));
  wrongReceipt.identity = `sha256:${'0'.repeat(64)}`;
  await fs.writeFile(receiptPath, `${JSON.stringify(wrongReceipt, null, 2)}\n`);
  await assert.rejects(
    validateExactWarehouse(sourceRoot, protocol, { allowSyntheticFixture: true }),
    /receipt v3 identity/i,
  );
  await fs.writeFile(receiptPath, receiptBytes);

  let interrupted = false;
  await assert.rejects(() => buildAreaIntelligenceMarts({
    sourceRoot, outputRoot, protocolPath,
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
    sourceRoot, outputRoot, protocolPath,
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
    sourceRoot, outputRoot, protocolPath,
    tractGeoJsonPath: path.join(repoRoot, 'public/data/tracts_phl.geojson'),
    outputPartitionCount: 2, allowSyntheticFixture: true,
  });
  assert.equal(rerun.idempotent, true);
  assert.deepEqual(await fs.readFile(publishedManifestPath), firstBytes);
  assert.equal((await fs.stat(publishedManifestPath)).mtimeMs, firstStat.mtimeMs);

  const syntheticAdmissionManifest = JSON.parse(firstBytes.toString('utf8'));
  Object.assign(syntheticAdmissionManifest.exact_input, {
    receipt_schema: protocol.exact_input_gate.receipt_schema,
    receipt_identity: protocol.exact_input_gate.receipt_identity,
    receipt_sha256: protocol.exact_input_gate.receipt_sha256,
  });
  const syntheticAdmissionCore = structuredClone(syntheticAdmissionManifest);
  delete syntheticAdmissionCore.artifact_identity;
  delete syntheticAdmissionCore.generated_at;
  syntheticAdmissionManifest.artifact_identity = syntheticIdentityOf(syntheticAdmissionCore);
  await fs.writeFile(publishedManifestPath, `${JSON.stringify(syntheticAdmissionManifest, null, 2)}\n`);
  const martGate = await validateAreaIntelligenceMartForEvaluation({ martRoot: outputRoot, protocolPath });
  assert.equal(martGate.martInventory.row_count, built.manifest.row_count);
  const martPartPath = path.join(outputRoot, ...built.manifest.parts[0].path.split('/'));
  const martPartBytes = await fs.readFile(martPartPath);
  await fs.writeFile(martPartPath, Buffer.concat([martPartBytes, Buffer.from('\n')]));
  await assert.rejects(
    validateAreaIntelligenceMartForEvaluation({ martRoot: outputRoot, protocolPath }),
    /rows, bytes, or SHA-256 drifted/i,
  );
  await fs.writeFile(martPartPath, martPartBytes);
  await fs.writeFile(publishedManifestPath, firstBytes);

  const evaluationOutput = path.join(testRoot, 'evaluation-output');
  await assert.rejects(
    evaluateAreaIntelligence({ martRoot: outputRoot, outputRoot: evaluationOutput, protocolPath }),
    /frozen evaluation gate/i,
  );
  await assert.rejects(fs.access(evaluationOutput));
  for (const part of built.manifest.parts) {
    const contents = await fs.readFile(path.join(outputRoot, ...part.path.split('/')), 'utf8');
    assert.doesNotMatch(contents, /generalized_location|coordinate|source_record_id/);
  }
});

async function writeSyntheticWarehouseReceipt(sourceRoot, { snapshotId, events }) {
  const canonicalRoot = path.join(sourceRoot, 'warehouse', 'canonical');
  const partNames = (await fs.readdir(canonicalRoot)).filter((name) => /^part-\d{3}\.jsonl$/.test(name)).sort();
  const bindings = [];
  for (const [partition, name] of partNames.entries()) {
    const relative = `canonical/${name}`;
    const bytes = await fs.readFile(path.join(canonicalRoot, name));
    bindings.push({
      partition,
      path: relative,
      row_count: bytes.toString('utf8').split(/\r?\n/).filter(Boolean).length,
      bytes: bytes.length,
      identity: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  const descriptors = {
    warehouse_manifest: await syntheticArtifactDescriptor(sourceRoot, 'warehouse/manifest.json', 'engagement-phl-crime-event-warehouse/v1'),
    backfill_checkpoint: await syntheticArtifactDescriptor(sourceRoot, 'backfill-checkpoint.json', 'engagement-phl-crime-backfill-checkpoint/v1'),
    lineage_registry: await syntheticArtifactDescriptor(sourceRoot, 'warehouse/lineage/registry.json', 'engagement-phl-crime-lineage/v1'),
    latest_quality_report: await syntheticArtifactDescriptor(sourceRoot, 'warehouse/quality/current.json', 'engagement-phl-crime-data-quality/v2'),
  };
  const canonicalBytes = bindings.reduce((sum, binding) => sum + binding.bytes, 0);
  const canonicalIdentity = syntheticIdentityOf(bindings.map((binding) => ({
    path: binding.path,
    bytes: binding.bytes,
    sha256: binding.identity,
  })));
  const evidence = {
    schema: 'engagement-phl-crime-warehouse-receipt/v3',
    mode: 'synthetic-fixture',
    serving_eligible: false,
    source: { dataset_id: 'synthetic', provider: 'test', source_table: 'fixture', schema: 'synthetic-source/v1', revision: snapshotId },
    warehouse: { schema: 'engagement-phl-crime-event-warehouse/v1', event_schema: 'engagement-phl-crime-event/v1', current_snapshot_id: snapshotId },
    coverage: {
      start: '2024-01-01',
      end_exclusive: '2024-02-01',
      earliest_event_at: events[0].event_at,
      latest_event_at: events.at(-1).event_at,
    },
    counts: {
      acquired_rows: events.length,
      expected_date_scoped_rows: events.length,
      canonical_rows: events.length,
      active_rows: events.length,
      removal_candidate_rows: 0,
      source_snapshots: 1,
      canonical_partitions: bindings.length,
    },
    clocks: {
      source_as_of: events.at(-1).event_at,
      retrieved_at: '2024-01-22T14:00:00.000Z',
      built_at: '2024-01-22T15:00:00.000Z',
      observed_at: '2024-01-22T16:00:00.000Z',
    },
    data_quality: {
      status: 'available',
      status_semantics: {
        unavailable_is_zero: false,
        partial_is_current: false,
        stale_is_current: false,
        zero_requires_complete_query: true,
      },
      coordinate: { available: 4, missing: 1, invalid: 0, outside_city_bounds: 0 },
      tract: { mapped: 3, unmapped: 1, ambiguous: 1 },
      fixed_grid: { mapped: 4, unavailable: 1 },
      route_corridor: { available: 0, unavailable: 5, matches: 0 },
      acs_estimate_moe: { available: 5, partial: 0, unavailable: 0, 'incompatible-vintage': 0 },
      unknown_label_count: 0,
    },
    artifacts: {
      ...descriptors,
      canonical: {
        path: 'warehouse/canonical',
        partition_count: bindings.length,
        bytes: canonicalBytes,
        sha256: canonicalIdentity,
        partition_bindings: bindings,
      },
    },
    authority: {
      producer_validated_local_candidate: true,
      integration_authority: false,
      serving_authority: false,
      deletion_authority: false,
    },
    limitations: ['Synthetic fixture only.'],
  };
  const receipt = { ...evidence, identity: syntheticIdentityOf(evidence) };
  await fs.writeFile(path.join(sourceRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function syntheticArtifactDescriptor(root, relative, schema) {
  const bytes = await fs.readFile(path.join(root, ...relative.split('/')));
  return {
    path: relative,
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    schema,
  };
}

function syntheticIdentityOf(value) {
  return `sha256:${createHash('sha256').update(syntheticStableSerialization(value)).digest('hex')}`;
}

function syntheticStableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(syntheticStableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${syntheticStableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

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
      coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-28' },
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
