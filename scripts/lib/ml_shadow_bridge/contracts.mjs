import {
  canonicalStringify,
  contentIdentity,
  exactDataObject,
  fail,
} from '../artifact_registry/safe_data.mjs';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FORMAL_MODELS = [
  'seasonal-naive-52w',
  'moving-average-13w',
  'ewma-v1',
  'sklearn-poisson-l2-v1',
  'sklearn-hist-gradient-boosting-poisson-v1',
  'torch-nb-global-v1',
  'poisson-log-link-v1',
  'js-negative-binomial-log-link-v1-repaired',
];
const GATE_MODELS = new Set(FORMAL_MODELS.slice(3, 6));
const FIXED_TORCH_SEEDS = [104729, 130363, 155921, 181081, 206369];
const FOLDS = ['fold-2019', 'fold-2021', 'fold-2023', 'fold-2025-2026'];
const UNIT_TYPES = ['tract', 'fixed-grid'];
const HOLDOUT_SLICES = ['temporal-non-heldout', 'spatial-heldout'];
const PREDICTION_CAP = 162754.79141900392;
const ADMITTED_REGISTRY_IDENTITIES = new Set();
const AUTHORITY_FALSE = {
  serving: false,
  promotion: false,
  production: false,
  routing: false,
  scientific: false,
};
const AGGREGATE_PRIVACY = {
  aggregate_only: true,
  event_level_data_included: false,
  coordinates_included: false,
  raw_or_canonical_events_included: false,
  source_record_ids_included: false,
};
const PRODUCTION_UNAVAILABLE = {
  status: 'unavailable',
  predictions: [],
  reason: 'm7-shadow-only-no-production-authority',
};
const LINEAGE_KEYS = [
  'artifact_registry_identity', 'm1_receipt_identity', 'm2_mart_identity',
  'dataset_manifest_identity', 'evaluation_protocol_identity',
  'governance_protocol_identity', 'feature_schema_identity', 'split_policy_identity',
  'candidate_set_identity', 'candidate_implementation_identity', 'search_space_identity',
  'seed_set_identity', 'preprocessing_identity', 'early_stopping_identity',
  'calibration_policy_identity', 'gate_policy_identity', 'runtime_memory_policy_identity',
  'environment_lock_identity', 'parity_receipt_identity',
];
export const FROZEN_LINEAGE = Object.freeze({
  evaluation_protocol_identity: 'sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde',
  governance_protocol_identity: 'sha256:13efc6cdcedbf3f4dd839f5af802c04d72696baaf02efa5c5588d56066b06534',
  feature_schema_identity: 'sha256:08cad80f5015e710fdd107c67eedee63e4b787d1420c9faf82e6cf4cc1cebe9b',
  split_policy_identity: 'sha256:cecc1a31d3a1dfba2c49a4e47bf41109d9c9f5fd06b93351fee7bf0656e91166',
  candidate_set_identity: 'sha256:b7d3696ba06182b836608d4a6757bd18dc54c3fb723f36e5d7c96f39fecaca45',
  candidate_implementation_identity: 'sha256:8282b0d7a0d6d6fa44eb7cde143148dba846e8727b041bd08ee11b070777f6fc',
  search_space_identity: 'sha256:b9c47e60b4e9e88523cbe44d33a9e6f3267bdc6ae2038c54e01815f08d4631fa',
  seed_set_identity: 'sha256:980f9d4f67f2ac46b38c14557dd7eb80b6f02a378385edcbc14f54e62aa612c8',
  preprocessing_identity: 'sha256:6c2320c5efa152bd3816a8153756e9989f1a2811d8c30ed30076ad14805c4fed',
  early_stopping_identity: 'sha256:d94f0281cbc1ff04f55fb50373be1e91bfa7f8d90c35a175159e10cd34e072fc',
  calibration_policy_identity: 'sha256:b8d4824550a6e7a0504e92e59f8df9732701dba976a84bf0211f1919c408a820',
  gate_policy_identity: 'sha256:1a0f89111b53bfaafe0c18bcfb6b7236e5d388429880ef03309bcc286131978e',
  runtime_memory_policy_identity: 'sha256:3ea660a9a3a9da274ba3114602101a54a8fd118ed04fbb1f2a9de7e2389afd20',
  environment_lock_identity: 'sha256:8661dd51b73e23c3097941bb1d0794f0cb677fec916e5a8cdfff7c93f95496e5',
});
const FORBIDDEN_INGRESS_KEYS = new Set([
  'unit_id', 'coordinates', 'latitude', 'longitude', 'event_id', 'source_record_id',
  'raw_events', 'canonical_events', 'checkpoint', 'state_dict', 'pickle', 'joblib',
  'model_payload',
]);

function same(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function sha(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !SHA256.test(value)) fail('m7-identity', `${label} must be a sha256 identity`);
  return value;
}

function finite(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('m7-number', `${label} must be finite`);
  }
  return value;
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail('m7-count', `${label} must be a non-negative integer`);
  return value;
}

function close(left, right) {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= 1e-12 * Math.max(1, Math.abs(left), Math.abs(right));
}

function median(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function weightedMean(rows, field) {
  const available = rows.filter((row) => row[field] !== null && row.observations > 0);
  const observations = available.reduce((total, row) => total + row.observations, 0);
  return observations === 0 ? null
    : available.reduce((total, row) => total + row.observations * row[field], 0) / observations;
}

function identity(value, field, label) {
  const core = { ...value };
  const declared = core[field];
  delete core[field];
  if (sha(declared, `${label}.${field}`) !== contentIdentity(core)) {
    fail('m7-content-identity', `${label} content identity drifted`);
  }
}

function common(value) {
  if (value.research_only !== true) fail('m7-research-only', 'M7 artifact must remain research_only');
  if (!same(value.authority, AUTHORITY_FALSE)) fail('m7-authority', 'M7 authority must remain exactly false');
  if (!same(value.privacy, AGGREGATE_PRIVACY)) fail('m7-privacy', 'M7 privacy must remain aggregate-only');
}

function production(value) {
  if (!same(value, PRODUCTION_UNAVAILABLE)) {
    fail('m7-production-forecast', 'M7 production forecast must remain unavailable and empty');
  }
}

function lineage(value, { allowUnavailable = false } = {}) {
  const result = exactDataObject(value, LINEAGE_KEYS, 'M7 lineage');
  const nullable = new Set([
    'artifact_registry_identity', 'm1_receipt_identity', 'm2_mart_identity',
    'dataset_manifest_identity', 'parity_receipt_identity',
  ]);
  for (const [key, item] of Object.entries(result)) {
    sha(item, `lineage.${key}`, { nullable: allowUnavailable && nullable.has(key) });
  }
  for (const [key, expected] of Object.entries(FROZEN_LINEAGE)) {
    if (result[key] !== expected) fail('m7-frozen-lineage', `lineage.${key} drifted from the frozen M7 input`);
  }
  return result;
}

function rejectForbiddenIngress(value, path = 'artifact') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenIngress(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_INGRESS_KEYS.has(key)) {
      fail('m7-forbidden-ingress', `${path}.${key} is forbidden at the M7 JSON ingress`);
    }
    rejectForbiddenIngress(item, `${path}.${key}`);
  }
}

function validatePrimaryResults(value, status) {
  if (!Array.isArray(value)) fail('m7-results', 'primary_results must be an array');
  const keys = [
    'model', 'fold', 'unit_type', 'holdout_slice', 'observations', 'status', 'mae',
    'poisson_deviance', 'negative_binomial_deviance', 'prediction_interval_90_coverage',
    'mean_actual', 'mean_predicted', 'prediction_minimum', 'prediction_maximum',
    'relative_mae_gain_vs_seasonal_naive',
  ];
  const rows = value.map((input, index) => {
    const row = exactDataObject(input, keys, `primary_results[${index}]`);
    if (!FORMAL_MODELS.slice(0, 6).includes(row.model)
      || !FOLDS.includes(row.fold) || !UNIT_TYPES.includes(row.unit_type)
      || !HOLDOUT_SLICES.includes(row.holdout_slice)
      || !['evaluated', 'unavailable'].includes(row.status)) {
      fail('m7-primary-vocabulary', `primary_results[${index}] vocabulary drifted`);
    }
    count(row.observations, `primary_results[${index}].observations`);
    for (const field of keys.slice(6)) finite(row[field], `primary_results[${index}].${field}`, { nullable: true });
    if (row.status === 'evaluated' && (row.prediction_minimum === null
      || row.prediction_maximum === null || row.prediction_minimum < 0
      || row.prediction_minimum > row.prediction_maximum)) {
      fail('m7-prediction-range', `primary_results[${index}] prediction range is invalid`);
    }
    return row;
  });
  const identities = rows.map((row) => `${row.model}|${row.fold}|${row.unit_type}|${row.holdout_slice}`);
  if (new Set(identities).size !== identities.length) fail('m7-primary-duplicate', 'primary slice identity is duplicated');
  if (status === 'evaluated') {
    for (const model of FORMAL_MODELS.slice(0, 6)) {
      const modelRows = rows.filter((row) => row.model === model);
      if (modelRows.length !== 16) fail('m7-primary-count', `${model} must contain 16 primary slices`);
    }
    const seasonal = new Map(rows.filter(({ model }) => model === FORMAL_MODELS[0])
      .map((row) => [`${row.fold}|${row.unit_type}|${row.holdout_slice}`, row]));
    for (const row of rows) {
      const baseline = seasonal.get(`${row.fold}|${row.unit_type}|${row.holdout_slice}`);
      const expected = row.mae === null || baseline?.mae === null || baseline?.mae === 0
        ? null : (baseline.mae - row.mae) / baseline.mae;
      if (!close(row.relative_mae_gain_vs_seasonal_naive, expected)) {
        fail('m7-relative-gain', `${row.model} relative MAE gain drifted`);
      }
    }
  } else if (rows.length !== 0) {
    fail('m7-unavailable-results', 'unavailable benchmark cannot contain primary results');
  }
  return rows;
}

function validateCandidateSummaries(value, primary) {
  if (!Array.isArray(value) || !same(value.map(({ model }) => model), FORMAL_MODELS)) {
    fail('m7-candidate-summaries', 'candidate summary identity/order drifted');
  }
  const keys = [
    'model', 'evidence_status', 'primary_slice_count', 'observations', 'aggregate_mae',
    'aggregate_relative_mae_gain', 'worst_relative_mae_gain', 'all_primary_slices_passed',
    'calibration_passed', 'convergence_passed', 'prediction_cap_passed',
  ];
  const seasonalMae = weightedMean(primary.filter(({ model }) => model === FORMAL_MODELS[0]), 'mae');
  return value.map((input, index) => {
    const row = exactDataObject(input, keys, `candidate_summaries[${index}]`);
    if (!['evaluated', 'parity-reference', 'unavailable'].includes(row.evidence_status)) {
      fail('m7-candidate-summary', `${row.model} evidence status is invalid`);
    }
    count(row.primary_slice_count, `${row.model}.primary_slice_count`);
    count(row.observations, `${row.model}.observations`);
    for (const field of ['aggregate_mae', 'aggregate_relative_mae_gain', 'worst_relative_mae_gain']) {
      finite(row[field], `${row.model}.${field}`, { nullable: true });
    }
    for (const field of ['all_primary_slices_passed', 'calibration_passed', 'convergence_passed', 'prediction_cap_passed']) {
      if (typeof row[field] !== 'boolean') fail('m7-candidate-summary', `${row.model}.${field} must be boolean`);
    }
    const modelRows = primary.filter(({ model }) => model === row.model);
    if (modelRows.length) {
      const aggregateMae = weightedMean(modelRows, 'mae');
      const aggregateGain = aggregateMae === null || seasonalMae === null || seasonalMae === 0
        ? null : (seasonalMae - aggregateMae) / seasonalMae;
      const gains = modelRows.map((item) => item.relative_mae_gain_vs_seasonal_naive)
        .filter((item) => item !== null);
      const coveragePassed = modelRows.length === 16 && modelRows.every((item) => item.prediction_interval_90_coverage !== null
        && item.prediction_interval_90_coverage >= 0.85 && item.prediction_interval_90_coverage <= 0.95);
      const capPassed = modelRows.length === 16 && modelRows.every((item) => item.prediction_minimum !== null
        && item.prediction_minimum >= 0 && item.prediction_maximum !== null
        && item.prediction_maximum <= PREDICTION_CAP);
      if (row.primary_slice_count !== modelRows.length
        || row.observations !== modelRows.reduce((total, item) => total + item.observations, 0)
        || !close(row.aggregate_mae, aggregateMae)
        || !close(row.aggregate_relative_mae_gain, aggregateGain)
        || !close(row.worst_relative_mae_gain, gains.length ? Math.min(...gains) : null)
        || row.calibration_passed !== coveragePassed
        || row.prediction_cap_passed !== capPassed) {
        fail('m7-candidate-summary', `${row.model} summary drifted from primary results`);
      }
      if (row.all_primary_slices_passed && !(modelRows.length === 16
        && modelRows.every((item) => item.observations >= 1000
          && item.relative_mae_gain_vs_seasonal_naive >= 0.02)
        && aggregateGain >= 0.05)) {
        fail('m7-candidate-gate', `${row.model} claimed a primary-slice pass without numeric evidence`);
      }
    } else if (row.primary_slice_count !== 0 || row.observations !== 0
      || [row.aggregate_mae, row.aggregate_relative_mae_gain, row.worst_relative_mae_gain].some((item) => item !== null)
      || row.all_primary_slices_passed || row.calibration_passed || row.convergence_passed
      || row.prediction_cap_passed) {
      fail('m7-candidate-summary', `${row.model} unavailable/reference summary contains evaluation claims`);
    }
    return row;
  });
}

function validateTorchStability(value) {
  const stability = exactDataObject(value, ['fixed_seeds', 'runs', 'summary'], 'torch_stability');
  if (!same(stability.fixed_seeds, FIXED_TORCH_SEEDS) || !Array.isArray(stability.runs)
    || !same(stability.runs.map(({ seed }) => seed), FIXED_TORCH_SEEDS)) {
    fail('m7-torch-seeds', 'torch stability fixed seeds or run order drifted');
  }
  const runs = stability.runs.map((input, index) => {
    const run = exactDataObject(input, [
      'seed', 'status', 'aggregate_primary_mae', 'epochs_completed', 'environment',
      'runtime_memory', 'failure',
    ], `torch_stability.runs[${index}]`);
    if (!['evaluated', 'failed'].includes(run.status) || !Array.isArray(run.epochs_completed)
      || run.epochs_completed.some((epoch) => !Number.isSafeInteger(epoch) || epoch < 0)) {
      fail('m7-torch-run', `torch stability run ${run.seed} is invalid`);
    }
    finite(run.aggregate_primary_mae, `${run.seed}.aggregate_primary_mae`, { nullable: true });
    const runtime = exactDataObject(run.runtime_memory, [
      'wall_seconds', 'python_tracemalloc_peak_bytes', 'cuda_peak_allocated_bytes', 'host_rss_claimed',
    ], `${run.seed}.runtime_memory`);
    finite(runtime.wall_seconds, `${run.seed}.wall_seconds`);
    count(runtime.python_tracemalloc_peak_bytes, `${run.seed}.python_tracemalloc_peak_bytes`);
    if (runtime.cuda_peak_allocated_bytes !== null) count(runtime.cuda_peak_allocated_bytes, `${run.seed}.cuda_peak_allocated_bytes`);
    if (runtime.host_rss_claimed !== false) fail('m7-runtime-memory', 'unmeasured host RSS cannot be claimed');
    if ((run.status === 'evaluated' && (run.aggregate_primary_mae === null || run.failure !== null))
      || (run.status === 'failed' && (run.aggregate_primary_mae !== null || typeof run.failure !== 'string'))) {
      fail('m7-torch-run', `torch stability run ${run.seed} status/evidence drifted`);
    }
    return run;
  });
  const summary = exactDataObject(stability.summary, [
    'median', 'worst', 'population_std', 'failed_seeds', 'relative_instability',
    'epoch_median', 'epoch_worst', 'environment_identities', 'passed',
  ], 'torch_stability.summary');
  for (const field of ['median', 'worst', 'population_std', 'relative_instability', 'epoch_median', 'epoch_worst']) {
    finite(summary[field], `torch_stability.summary.${field}`, { nullable: true });
  }
  if (!Array.isArray(summary.failed_seeds) || !Array.isArray(summary.environment_identities)
    || typeof summary.passed !== 'boolean') fail('m7-torch-summary', 'torch stability summary types drifted');
  const values = runs.filter(({ status }) => status === 'evaluated').map(({ aggregate_primary_mae }) => aggregate_primary_mae);
  const failed = runs.filter(({ status }) => status === 'failed').map(({ seed }) => seed);
  const epochs = runs.flatMap(({ epochs_completed }) => epochs_completed);
  const mean = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  const populationStd = mean === null ? null
    : Math.sqrt(values.reduce((total, value) => total + ((value - mean) ** 2), 0) / values.length);
  const expected = {
    median: median(values),
    worst: values.length ? Math.max(...values) : null,
    population_std: populationStd,
    failed_seeds: failed,
    relative_instability: populationStd === null || median(values) === 0 ? null : populationStd / median(values),
    epoch_median: median(epochs),
    epoch_worst: epochs.length ? Math.max(...epochs) : null,
    environment_identities: [...new Set(runs.filter(({ status }) => status === 'evaluated')
      .map(({ environment }) => contentIdentity(environment)))].sort(),
  };
  expected.passed = failed.length === 0 && values.length === FIXED_TORCH_SEEDS.length
    && expected.relative_instability !== null && expected.relative_instability <= 0.25;
  for (const [field, expectedValue] of Object.entries(expected)) {
    const drifted = Array.isArray(expectedValue) ? !same(summary[field], expectedValue)
      : typeof expectedValue === 'boolean' ? summary[field] !== expectedValue
        : !close(summary[field], expectedValue);
    if (drifted) {
      fail('m7-torch-summary', `torch stability summary ${field} drifted from runs`);
    }
  }
  return stability;
}

export function validateModelBenchmarkReport(value) {
  const report = exactDataObject(value, [
    'schema', 'evaluation_scope', 'status', 'research_only', 'authority', 'privacy',
    'lineage', 'candidate_catalog', 'search_execution', 'primary_results', 'candidate_summaries',
    'torch_stability', 'gate', 'production_forecast', 'report_identity',
  ], 'ModelBenchmarkReport/v1');
  if (report.schema !== 'ModelBenchmarkReport/v1') fail('m7-schema', 'unsupported ModelBenchmarkReport schema');
  if (!['full-exact-registry', 'synthetic-fixture'].includes(report.evaluation_scope)) {
    fail('m7-scope', 'ModelBenchmarkReport evaluation scope is invalid');
  }
  if (!['evaluated', 'unavailable'].includes(report.status)) fail('m7-status', 'ModelBenchmarkReport status is invalid');
  common(report);
  lineage(report.lineage);
  production(report.production_forecast);
  if (!Array.isArray(report.candidate_catalog)
    || !same(report.candidate_catalog.map(({ id }) => id), FORMAL_MODELS)) {
    fail('m7-candidates', 'ModelBenchmarkReport formal candidate identity/order drifted');
  }
  const search = exactDataObject(
    report.search_execution,
    ['status', 'search_space_identity', 'trial_receipt_identity'],
    'benchmark search execution',
  );
  if (!['complete', 'fixed-reference-only'].includes(search.status)
    || search.search_space_identity !== report.lineage.search_space_identity
    || (search.status === 'complete') !== (search.trial_receipt_identity !== null)) {
    fail('m7-search-execution', 'ModelBenchmarkReport search execution is not exact');
  }
  sha(search.trial_receipt_identity, 'search trial receipt', { nullable: true });
  const primary = validatePrimaryResults(report.primary_results, report.status);
  const summaries = validateCandidateSummaries(report.candidate_summaries, primary);
  const stability = validateTorchStability(report.torch_stability);
  const gate = exactDataObject(report.gate, ['passed', 'selected_candidate', 'reason_codes'], 'benchmark gate');
  if (gate.passed === true && (report.evaluation_scope !== 'full-exact-registry'
    || search.status !== 'complete'
    || !GATE_MODELS.has(gate.selected_candidate))) {
    fail('m7-gate', 'ModelBenchmarkReport gate passed without a full eligible candidate');
  }
  if (gate.passed !== true && gate.selected_candidate !== null) {
    fail('m7-gate', 'failed ModelBenchmarkReport gate selected a candidate');
  }
  if (gate.passed === true) {
    const selected = summaries.find(({ model }) => model === gate.selected_candidate);
    if (!selected || !['all_primary_slices_passed', 'calibration_passed', 'convergence_passed', 'prediction_cap_passed']
      .every((field) => selected[field] === true)
      || (selected.model === 'torch-nb-global-v1' && stability.summary.passed !== true)) {
      fail('m7-gate', 'ModelBenchmarkReport selected a candidate without every governed gate');
    }
  }
  rejectForbiddenIngress(report);
  identity(report, 'report_identity', 'ModelBenchmarkReport/v1');
  return report;
}

export function validateCalibrationReport(value, benchmark) {
  const report = exactDataObject(value, [
    'schema', 'evaluation_scope', 'research_only', 'authority', 'privacy',
    'benchmark_report_identity', 'dataset_manifest_identity', 'split_policy_identity',
    'calibration_policy_identity', 'candidate_calibration', 'gate', 'report_identity',
  ], 'CalibrationReport/v1');
  if (report.schema !== 'CalibrationReport/v1') fail('m7-schema', 'unsupported CalibrationReport schema');
  common(report);
  if (report.benchmark_report_identity !== benchmark.report_identity
    || report.dataset_manifest_identity !== benchmark.lineage.dataset_manifest_identity
    || report.split_policy_identity !== benchmark.lineage.split_policy_identity
    || report.calibration_policy_identity !== benchmark.lineage.calibration_policy_identity) {
    fail('m7-calibration-lineage', 'CalibrationReport lineage drifted from benchmark');
  }
  const gate = exactDataObject(report.gate, ['passed', 'all_primary_slices_required'], 'calibration gate');
  if (gate.all_primary_slices_required !== true) fail('m7-calibration-bypass', 'aggregate calibration bypass is prohibited');
  if (!Array.isArray(report.candidate_calibration)
    || !same(report.candidate_calibration.map(({ model }) => model), FORMAL_MODELS.slice(0, 6))) {
    fail('m7-calibration-candidates', 'CalibrationReport candidate order drifted');
  }
  const rows = report.candidate_calibration.map((input, index) => {
    const row = exactDataObject(input, [
      'model', 'method', 'primary_slice_count', 'coverage_minimum', 'coverage_maximum',
      'coverage_median', 'failed_slices', 'passed',
    ], `candidate_calibration[${index}]`);
    count(row.primary_slice_count, `${row.model}.primary_slice_count`);
    for (const field of ['coverage_minimum', 'coverage_maximum', 'coverage_median']) {
      const observed = finite(row[field], `${row.model}.${field}`, { nullable: true });
      if (observed !== null && (observed < 0 || observed > 1)) fail('m7-calibration-range', `${row.model}.${field} is outside [0,1]`);
    }
    if (!Array.isArray(row.failed_slices) || new Set(row.failed_slices).size !== row.failed_slices.length
      || typeof row.passed !== 'boolean') fail('m7-calibration-row', `${row.model} calibration evidence is invalid`);
    const primary = benchmark.primary_results.filter(({ model }) => model === row.model);
    const coverages = primary.map(({ prediction_interval_90_coverage }) => prediction_interval_90_coverage)
      .filter((item) => item !== null);
    const failed = primary.filter(({ prediction_interval_90_coverage }) => prediction_interval_90_coverage === null
      || prediction_interval_90_coverage < 0.85 || prediction_interval_90_coverage > 0.95)
      .map(({ fold, unit_type, holdout_slice }) => `${fold}|${unit_type}|${holdout_slice}`);
    const expectedPassed = primary.length === 16 && failed.length === 0;
    if (row.primary_slice_count !== primary.length
      || !close(row.coverage_minimum, coverages.length ? Math.min(...coverages) : null)
      || !close(row.coverage_maximum, coverages.length ? Math.max(...coverages) : null)
      || !close(row.coverage_median, median(coverages))
      || !same(row.failed_slices, failed) || row.passed !== expectedPassed) {
      fail('m7-calibration-row', `${row.model} calibration evidence drifted from benchmark`);
    }
    return row;
  });
  const selected = rows.find(({ model }) => model === benchmark.gate.selected_candidate);
  const expectedGate = benchmark.gate.passed === true && selected?.passed === true;
  if (gate.passed !== expectedGate) fail('m7-calibration-gate', 'CalibrationReport gate drifted from benchmark evidence');
  rejectForbiddenIngress(report);
  identity(report, 'report_identity', 'CalibrationReport/v1');
  return report;
}

export function validateModelCard(value, benchmark, calibration) {
  const card = exactDataObject(value, [
    'schema', 'model_id', 'role', 'research_only', 'authority', 'privacy',
    'benchmark_report_identity', 'calibration_report_identity', 'lineage', 'intended_use',
    'limitations', 'prohibited_uses', 'model_artifact', 'card_identity',
  ], 'ModelCard/v1');
  if (card.schema !== 'ModelCard/v1') fail('m7-schema', 'unsupported ModelCard schema');
  common(card);
  if (card.benchmark_report_identity !== benchmark.report_identity
    || card.calibration_report_identity !== calibration.report_identity
    || !same(lineage(card.lineage), benchmark.lineage)) {
    fail('m7-card-lineage', 'ModelCard lineage drifted');
  }
  if (card.intended_use !== 'aggregate-shadow-evaluation-only'
    || !same(card.model_artifact, {
      format: 'state-dict-only-or-none',
      admitted_for_deserialization: false,
      bridge_consumes_checkpoint: false,
    })) {
    fail('m7-card-boundary', 'ModelCard deserialization or intended-use boundary drifted');
  }
  if (benchmark.gate.passed !== true || calibration.gate.passed !== true
    || benchmark.gate.selected_candidate !== card.model_id || !GATE_MODELS.has(card.model_id)) {
    fail('m7-card-gate', 'ModelCard lacks an exact selected governed candidate');
  }
  rejectForbiddenIngress(card);
  identity(card, 'card_identity', 'ModelCard/v1');
  return card;
}

export function validateModelAdmissionReceipt(value) {
  const receipt = exactDataObject(value, [
    'schema', 'status', 'decision', 'evaluation_scope', 'full_evaluation', 'research_only',
    'authority', 'privacy', 'lineage', 'benchmark_report_identity',
    'calibration_report_identity', 'model_card_identity', 'selected_model', 'reason_codes',
    'production_forecast', 'receipt_identity',
  ], 'ModelAdmissionReceipt/v1');
  if (receipt.schema !== 'ModelAdmissionReceipt/v1'
    || !['no-promotion', 'shadow-admitted'].includes(receipt.decision)) {
    fail('m7-schema', 'unsupported ModelAdmissionReceipt schema or decision');
  }
  common(receipt);
  lineage(receipt.lineage, { allowUnavailable: receipt.status === 'unavailable' });
  for (const field of ['benchmark_report_identity', 'calibration_report_identity', 'model_card_identity']) {
    sha(receipt[field], field, { nullable: true });
  }
  if (receipt.decision === 'shadow-admitted') {
    if (receipt.status !== 'complete' || receipt.evaluation_scope !== 'full-exact-registry'
      || receipt.full_evaluation !== true || !GATE_MODELS.has(receipt.selected_model)
      || [receipt.benchmark_report_identity, receipt.calibration_report_identity, receipt.model_card_identity].includes(null)) {
      fail('m7-shadow-admission', 'shadow admission lacks exact full-evaluation evidence');
    }
    if (!ADMITTED_REGISTRY_IDENTITIES.has(receipt.lineage.artifact_registry_identity)) {
      fail('m7-registry-admission', 'shadow admission is blocked until an exact full ArtifactRegistry identity is frozen');
    }
  } else if (receipt.selected_model !== null) {
    fail('m7-no-promotion', 'no-promotion receipt cannot select a model');
  }
  production(receipt.production_forecast);
  rejectForbiddenIngress(receipt);
  identity(receipt, 'receipt_identity', 'ModelAdmissionReceipt/v1');
  return receipt;
}

export function buildShadowForecastArtifact({ receipt: receiptInput, benchmark: benchmarkInput = null, calibration: calibrationInput = null, modelCard: modelCardInput = null }) {
  const receipt = validateModelAdmissionReceipt(receiptInput);
  let benchmark = null;
  let calibration = null;
  let modelCard = null;
  if (receipt.benchmark_report_identity !== null) {
    if (!benchmarkInput) fail('m7-benchmark-required', 'admission receipt requires its exact benchmark');
    benchmark = validateModelBenchmarkReport(benchmarkInput);
    if (benchmark.report_identity !== receipt.benchmark_report_identity
      || !same(benchmark.lineage, receipt.lineage)) {
      fail('m7-benchmark-binding', 'admission receipt benchmark binding drifted');
    }
  }
  if (receipt.calibration_report_identity !== null) {
    if (!calibrationInput || !benchmark) fail('m7-calibration-required', 'admission receipt requires its exact calibration report');
    calibration = validateCalibrationReport(calibrationInput, benchmark);
    if (calibration.report_identity !== receipt.calibration_report_identity) {
      fail('m7-calibration-binding', 'admission receipt calibration binding drifted');
    }
  }
  if (receipt.model_card_identity !== null) {
    if (!modelCardInput || !benchmark || !calibration) fail('m7-card-required', 'admission receipt requires its exact model card');
    modelCard = validateModelCard(modelCardInput, benchmark, calibration);
    if (modelCard.card_identity !== receipt.model_card_identity
      || modelCard.model_id !== receipt.selected_model) {
      fail('m7-card-binding', 'admission receipt model card binding drifted');
    }
  }
  const admitted = receipt.decision === 'shadow-admitted';
  if (admitted && (!benchmark?.gate?.passed || !calibration?.gate?.passed || !modelCard)) {
    fail('m7-shadow-admission', 'shadow projection lacks passed cross-bound evidence');
  }
  const aggregates = admitted ? benchmark.primary_results
    .filter(({ model }) => model === receipt.selected_model)
    .map(({ fold, unit_type, holdout_slice, observations, mean_actual, mean_predicted }) => ({
      fold, unit_type, holdout_slice, observations, mean_actual, mean_predicted,
    })) : [];
  const core = {
    schema: 'ShadowForecastArtifact/v1',
    decision: receipt.decision,
    research_only: true,
    authority: { ...AUTHORITY_FALSE },
    privacy: { ...AGGREGATE_PRIVACY },
    lineage: { ...receipt.lineage },
    admission_receipt_identity: receipt.receipt_identity,
    benchmark_report_identity: receipt.benchmark_report_identity,
    calibration_report_identity: receipt.calibration_report_identity,
    model_card_identity: receipt.model_card_identity,
    shadow: {
      status: admitted ? 'available' : 'unavailable',
      model: admitted ? receipt.selected_model : null,
      basis: 'governed-backtest-aggregate-only',
      aggregate_forecasts: aggregates,
    },
    production_forecast: { ...PRODUCTION_UNAVAILABLE },
  };
  return { ...core, artifact_identity: contentIdentity(core) };
}
