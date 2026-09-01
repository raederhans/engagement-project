import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import Ajv2020 from 'ajv/dist/2020.js';

import { contentIdentity } from '../lib/artifact_registry/safe_data.mjs';
import {
  buildShadowForecastArtifact,
  FROZEN_LINEAGE,
  strictJsonParse,
} from '../lib/ml_shadow_bridge/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARTIFACTS_ROOT = path.join(ROOT, 'ml', '.artifacts');
const SHADOW_CLI = path.join(ROOT, 'scripts', 'project_ml_shadow_forecast.mjs');
const execFileAsync = promisify(execFile);
const SHA = `sha256:${'a'.repeat(64)}`;
const AUTHORITY = {
  serving: false, promotion: false, production: false, routing: false, scientific: false,
};
const PRIVACY = {
  aggregate_only: true,
  event_level_data_included: false,
  coordinates_included: false,
  raw_or_canonical_events_included: false,
  source_record_ids_included: false,
};
const PRODUCTION = {
  status: 'unavailable', predictions: [], reason: 'm7-shadow-only-no-production-authority',
};
const MODELS = [
  ['seasonal-naive-52w', 'baseline', false, 'v3'],
  ['moving-average-13w', 'baseline', false, 'v3'],
  ['ewma-v1', 'baseline', false, 'v3'],
  ['sklearn-poisson-l2-v1', 'gate-candidate', true, 'v3'],
  ['sklearn-hist-gradient-boosting-poisson-v1', 'gate-candidate', true, 'v3'],
  ['torch-nb-global-v1', 'gate-candidate', true, 'v3'],
  ['poisson-log-link-v1', 'reference-only', false, 'v2-js-reference'],
  ['js-negative-binomial-log-link-v1-repaired', 'optional-reference', false, 'v3-optional-js-reference'],
];

function withIdentity(core, field) {
  return { ...core, [field]: contentIdentity(core) };
}

function fullLineage(nullable = false) {
  return {
    artifact_registry_identity: nullable ? null : SHA,
    m1_receipt_identity: nullable ? null : SHA,
    m2_mart_identity: nullable ? null : SHA,
    dataset_manifest_identity: nullable ? null : SHA,
    ...FROZEN_LINEAGE,
    parity_receipt_identity: nullable ? null : SHA,
  };
}

function primaryResults() {
  const folds = ['fold-2019', 'fold-2021', 'fold-2023', 'fold-2025-2026'];
  const unitTypes = ['tract', 'fixed-grid'];
  const holdouts = ['temporal-non-heldout', 'spatial-heldout'];
  return MODELS.slice(0, 6).flatMap(([model]) => folds.flatMap((fold) => unitTypes.flatMap((unit_type) => (
    holdouts.map((holdout_slice) => ({
      model,
      fold,
      unit_type,
      holdout_slice,
      observations: 1200,
      status: 'evaluated',
      mae: model === 'seasonal-naive-52w' ? 10 : 8,
      poisson_deviance: 1.2,
      negative_binomial_deviance: 1.1,
      prediction_interval_90_coverage: 0.9,
      mean_actual: 6,
      mean_predicted: 5.8,
      prediction_minimum: 0.25,
      prediction_maximum: 12,
      relative_mae_gain_vs_seasonal_naive: model === 'seasonal-naive-52w' ? 0 : 0.2,
    }))
  ))));
}

function governedFixture() {
  const lineage = fullLineage();
  const primary = primaryResults();
  const benchmarkCore = {
    schema: 'ModelBenchmarkReport/v1',
    evaluation_scope: 'synthetic-fixture',
    status: 'evaluated',
    research_only: true,
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
    lineage,
    candidate_catalog: MODELS.map(([id, role, admission_eligible, source_protocol], index) => ({
      id, role, admission_eligible, source_protocol,
      evidence_status: index < 6 ? 'evaluated' : 'parity-reference',
    })),
    search_execution: {
      status: 'fixed-reference-only',
      search_space_identity: lineage.search_space_identity,
      trial_receipt_identity: null,
    },
    primary_results: primary,
    candidate_summaries: MODELS.map(([model], index) => ({
      model,
      evidence_status: index < 6 ? 'evaluated' : 'parity-reference',
      primary_slice_count: index < 6 ? 16 : 0,
      observations: index < 6 ? 19200 : 0,
      aggregate_mae: index < 6 ? (index === 0 ? 10 : 8) : null,
      aggregate_relative_mae_gain: index < 6 ? (index === 0 ? 0 : 0.2) : null,
      worst_relative_mae_gain: index < 6 ? (index === 0 ? 0 : 0.2) : null,
      all_primary_slices_passed: index >= 3 && index < 6,
      calibration_passed: index < 6,
      convergence_passed: index < 6,
      prediction_cap_passed: index < 6,
    })),
    torch_stability: {
      fixed_seeds: [104729, 130363, 155921, 181081, 206369],
      runs: [104729, 130363, 155921, 181081, 206369].map((seed) => ({
        seed,
        status: 'evaluated',
        aggregate_primary_mae: 8,
        epochs_completed: [12, 13, 11, 12, 12, 13, 11, 12],
        environment: { python: '3.12.10', torch: '2.13.0', device: 'cpu' },
        runtime_memory: {
          wall_seconds: 1.25,
          python_tracemalloc_peak_bytes: 1024,
          cuda_peak_allocated_bytes: null,
          host_rss_claimed: false,
        },
        failure: null,
      })),
      summary: {
        median: 8,
        worst: 8,
        population_std: 0,
        failed_seeds: [],
        relative_instability: 0,
        epoch_median: 12,
        epoch_worst: 13,
        environment_identities: [contentIdentity({ python: '3.12.10', torch: '2.13.0', device: 'cpu' })],
        passed: true,
      },
    },
    gate: {
      passed: false,
      selected_candidate: null,
      reason_codes: [
        'synthetic-fixture-cannot-authorize-shadow-admission',
        'exact-full-artifact-registry-not-admitted',
        'v3-bounded-search-selection-not-executed',
      ],
    },
    production_forecast: { ...PRODUCTION },
  };
  const benchmark = withIdentity(benchmarkCore, 'report_identity');
  const calibrationCore = {
    schema: 'CalibrationReport/v1',
    evaluation_scope: 'synthetic-fixture',
    research_only: true,
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
    benchmark_report_identity: benchmark.report_identity,
    dataset_manifest_identity: lineage.dataset_manifest_identity,
    split_policy_identity: lineage.split_policy_identity,
    calibration_policy_identity: lineage.calibration_policy_identity,
    candidate_calibration: MODELS.slice(0, 6).map(([model]) => ({
      model,
      method: model === 'torch-nb-global-v1'
        ? 'training-only-nb2-central-90-percent'
        : 'training-only-calibrated-count-residual-90-percent',
      primary_slice_count: 16,
      coverage_minimum: 0.9,
      coverage_maximum: 0.9,
      coverage_median: 0.9,
      failed_slices: [],
      passed: true,
    })),
    gate: { passed: false, all_primary_slices_required: true },
  };
  const calibration = withIdentity(calibrationCore, 'report_identity');
  const receiptCore = {
    schema: 'ModelAdmissionReceipt/v1',
    status: 'complete',
    decision: 'no-promotion',
    evaluation_scope: 'synthetic-fixture',
    full_evaluation: false,
    research_only: true,
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
    lineage,
    benchmark_report_identity: benchmark.report_identity,
    calibration_report_identity: calibration.report_identity,
    model_card_identity: null,
    selected_model: null,
    reason_codes: [...benchmark.gate.reason_codes],
    production_forecast: { ...PRODUCTION },
  };
  const receipt = withIdentity(receiptCore, 'receipt_identity');
  return { benchmark, calibration, receipt };
}

async function loadSchemas() {
  const names = [
    'model_benchmark_report.v1.schema.json',
    'calibration_report.v1.schema.json',
    'model_card.v1.schema.json',
    'model_admission_receipt.v1.schema.json',
    'shadow_forecast_artifact.v1.schema.json',
  ];
  return Promise.all(names.map(async (name) => JSON.parse(
    await fs.readFile(path.join(ROOT, 'ml', 'contracts', name), 'utf8'),
  )));
}

test('M7 schemas compile and synthetic evidence remains aggregate-only no-promotion', async () => {
  const schemas = await loadSchemas();
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const schema of schemas) ajv.addSchema(schema);
  const fixture = governedFixture();
  const artifact = buildShadowForecastArtifact(fixture);
  for (const [id, value] of [
    ['https://engagement-project.local/ml/contracts/ModelBenchmarkReport/v1', fixture.benchmark],
    ['https://engagement-project.local/ml/contracts/CalibrationReport/v1', fixture.calibration],
    ['https://engagement-project.local/ml/contracts/ModelAdmissionReceipt/v1', fixture.receipt],
    ['https://engagement-project.local/ml/contracts/ShadowForecastArtifact/v1', artifact],
  ]) {
    const validate = ajv.getSchema(id);
    assert.ok(validate, `missing compiled schema ${id}`);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
  assert.equal(artifact.decision, 'no-promotion');
  assert.equal(artifact.shadow.status, 'unavailable');
  assert.equal(artifact.shadow.aggregate_forecasts.length, 0);
  assert.deepEqual(artifact.production_forecast, PRODUCTION);
  assert.equal(JSON.stringify(artifact).includes('unit_id'), false);
  assert.equal(JSON.stringify(artifact).includes('checkpoint'), false);
});

test('M7 no-promotion stays unavailable and hostile lineage, authority, and duplicate JSON fail closed', () => {
  const unavailableCore = {
    schema: 'ModelAdmissionReceipt/v1',
    status: 'unavailable',
    decision: 'no-promotion',
    evaluation_scope: 'unavailable',
    full_evaluation: false,
    research_only: true,
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
    lineage: fullLineage(true),
    benchmark_report_identity: null,
    calibration_report_identity: null,
    model_card_identity: null,
    selected_model: null,
    reason_codes: ['exact-artifact-registry-unavailable'],
    production_forecast: { ...PRODUCTION },
  };
  const receipt = withIdentity(unavailableCore, 'receipt_identity');
  const artifact = buildShadowForecastArtifact({ receipt });
  assert.equal(artifact.decision, 'no-promotion');
  assert.equal(artifact.shadow.status, 'unavailable');
  assert.deepEqual(artifact.shadow.aggregate_forecasts, []);
  assert.deepEqual(artifact.production_forecast, PRODUCTION);

  const hostileAuthority = structuredClone(receipt);
  hostileAuthority.authority.serving = true;
  assert.throws(() => buildShadowForecastArtifact({ receipt: hostileAuthority }), /authority/);
  const hostileLineage = structuredClone(receipt);
  hostileLineage.lineage.governance_protocol_identity = SHA;
  hostileLineage.receipt_identity = contentIdentity(Object.fromEntries(
    Object.entries(hostileLineage).filter(([key]) => key !== 'receipt_identity'),
  ));
  assert.throws(() => buildShadowForecastArtifact({ receipt: hostileLineage }), /frozen M7 input/);
  const forgedFullCore = {
    ...unavailableCore,
    status: 'complete',
    decision: 'shadow-admitted',
    evaluation_scope: 'full-exact-registry',
    full_evaluation: true,
    lineage: fullLineage(),
    benchmark_report_identity: SHA,
    calibration_report_identity: SHA,
    model_card_identity: SHA,
    selected_model: 'torch-nb-global-v1',
    reason_codes: ['fabricated-full-chain'],
  };
  const forgedFull = withIdentity(forgedFullCore, 'receipt_identity');
  assert.throws(
    () => buildShadowForecastArtifact({ receipt: forgedFull }),
    /blocked until an exact full ArtifactRegistry identity is frozen/,
  );
  assert.throws(
    () => strictJsonParse('{"schema":"ModelAdmissionReceipt/v1","schema":"drift"}'),
    /duplicate M7 JSON key/,
  );
});

test('M7 shadow CLI writes only a fresh ignored task artifact and rejects path drift', async (t) => {
  await fs.mkdir(ARTIFACTS_ROOT, { recursive: true });
  const runDirectory = await fs.mkdtemp(path.join(ARTIFACTS_ROOT, 'm7-node-cli-'));
  const linkedTarget = await fs.mkdtemp(path.join(ARTIFACTS_ROOT, 'm7-node-cli-real-'));
  const linkedDirectory = path.join(
    ARTIFACTS_ROOT,
    `m7-node-cli-link-${process.pid}-${Date.now()}`,
  );
  const deniedOutput = path.join(
    ROOT,
    'docs',
    `.m7-node-cli-denied-${process.pid}-${Date.now()}.json`,
  );
  let linkCreated = false;
  t.after(async () => {
    if (linkCreated) await fs.unlink(linkedDirectory);
    await fs.rm(runDirectory, { recursive: true, force: true });
    await fs.rm(linkedTarget, { recursive: true, force: true });
    await fs.rm(deniedOutput, { force: true });
  });

  const fixture = governedFixture();
  const inputPaths = Object.fromEntries(await Promise.all([
    ['admission', fixture.receipt],
    ['benchmark', fixture.benchmark],
    ['calibration', fixture.calibration],
  ].map(async ([name, value]) => {
    const inputPath = path.join(runDirectory, `${name}.json`);
    await fs.writeFile(inputPath, `${JSON.stringify(value)}\n`, 'utf8');
    return [name, inputPath];
  })));
  const output = path.join(runDirectory, 'shadow-forecast-artifact.json');
  const args = [
    SHADOW_CLI,
    '--admission', inputPaths.admission,
    '--benchmark', inputPaths.benchmark,
    '--calibration', inputPaths.calibration,
    '--output', output,
  ];

  const success = await execFileAsync(process.execPath, args, { cwd: ROOT, windowsHide: true });
  assert.match(success.stdout, /"decision":"no-promotion"/);
  const published = await fs.readFile(output, 'utf8');
  assert.equal(JSON.parse(published).decision, 'no-promotion');

  await assert.rejects(
    execFileAsync(process.execPath, args, { cwd: ROOT, windowsHide: true }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /must not already exist/);
      return true;
    },
  );
  assert.equal(await fs.readFile(output, 'utf8'), published);

  await assert.rejects(
    execFileAsync(process.execPath, [...args.slice(0, -1), deniedOutput], {
      cwd: ROOT,
      windowsHide: true,
    }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /repo\/ml\/\.artifacts/);
      return true;
    },
  );
  await assert.rejects(fs.lstat(deniedOutput), { code: 'ENOENT' });

  try {
    await fs.symlink(linkedTarget, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    linkCreated = true;
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    t.diagnostic('link-path regression skipped because this host cannot create a test link');
  }
  if (linkCreated) {
    const linkedOutput = path.join(linkedDirectory, 'shadow-forecast-artifact.json');
    await assert.rejects(
      execFileAsync(process.execPath, [...args.slice(0, -1), linkedOutput], {
        cwd: ROOT,
        windowsHide: true,
      }),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /existing real directory|link or reparse/);
        return true;
      },
    );
    await assert.rejects(fs.lstat(path.join(linkedTarget, 'shadow-forecast-artifact.json')), {
      code: 'ENOENT',
    });
  }
});
