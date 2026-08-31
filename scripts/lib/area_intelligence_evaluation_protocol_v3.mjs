import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const AREA_INTELLIGENCE_EVALUATION_PROTOCOL_V3_SCHEMA =
  'engagement-area-intelligence-evaluation-protocol/v3';

const CANDIDATES = Object.freeze([
  'seasonal-naive-52w',
  'moving-average-13w',
  'ewma-v1',
  'sklearn-poisson-l2-v1',
  'sklearn-hist-gradient-boosting-poisson-v1',
  'torch-nb-global-v1',
  'js-negative-binomial-log-link-v1-repaired',
]);
const FOLDS = Object.freeze(['fold-2019', 'fold-2021', 'fold-2023', 'fold-2025-2026']);
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export async function loadAreaIntelligenceEvaluationProtocolV3(path = new URL(
  '../data/area_intelligence_evaluation_protocol.v3.json',
  import.meta.url,
)) {
  const bytes = await readFile(path);
  if (bytes.includes(13) || bytes.at(-1) !== 10) {
    throw new TypeError('Evaluation Protocol v3 bytes must be LF-only and end in one LF.');
  }
  const protocol = JSON.parse(bytes.toString('utf8'));
  validateAreaIntelligenceEvaluationProtocolV3(protocol);
  return Object.freeze({
    protocol: deepFreeze(protocol),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
}

export function validateAreaIntelligenceEvaluationProtocolV3(protocol) {
  exactKeys(protocol, [
    'schema', 'schema_version', 'frozen_at', 'frozen_before_v3_candidate_performance',
    'previous_protocol', 'runtime', 'feature_schema', 'candidates', 'inner_validation',
    'rolling_folds', 'spatial_holdout', 'convergence', 'interval_calibration',
    'prediction_cap', 'slice_gate', 'artifact_contract', 'decision', 'privacy', 'authority',
  ], 'Evaluation Protocol v3');
  if (protocol.schema !== AREA_INTELLIGENCE_EVALUATION_PROTOCOL_V3_SCHEMA
    || protocol.schema_version !== 3
    || protocol.frozen_before_v3_candidate_performance !== true
    || protocol.previous_protocol.status !== 'historical-immutable'
    || protocol.previous_protocol.sha256
      !== 'sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde') {
    throw new TypeError('Evaluation Protocol v3 version, freeze point, or v2 lineage drifted.');
  }
  if (!SHA256.test(protocol.previous_protocol.sha256)) {
    throw new TypeError('Evaluation Protocol v3 previous identity is invalid.');
  }
  if (protocol.runtime.python !== '3.12.x'
    || protocol.runtime.scikit_learn !== '1.9.0'
    || protocol.runtime.torch !== '2.13.0'
    || protocol.runtime.determinism !== 'fixed-seed-single-process-cpu-reference') {
    throw new TypeError('Evaluation Protocol v3 runtime identity drifted.');
  }
  if (protocol.feature_schema.schema !== 'FeatureSchema/v2'
    || protocol.feature_schema.activation_gate !== 'FeatureSchema/v1-js-parity-receipt-passed'
    || protocol.feature_schema.temporal_cutoff !== 'strictly-before-predicted-week'
    || protocol.feature_schema.preprocessing !== 'fit-on-training-only-within-outer-fold'
    || protocol.feature_schema.features.length !== 27
    || new Set(protocol.feature_schema.features).size !== protocol.feature_schema.features.length) {
    throw new TypeError('Evaluation Protocol v3 feature schema drifted.');
  }
  if (stable(protocol.candidates.map(({ id }) => id)) !== stable(CANDIDATES)
    || protocol.candidates.at(-1).optional !== true
    || protocol.candidates.slice(0, -1).some(({ optional }) => optional !== false)) {
    throw new TypeError('Evaluation Protocol v3 candidate vocabulary drifted.');
  }
  let budget = 0;
  for (const candidate of protocol.candidates) {
    exactKeys(candidate, [
      'id', 'implementation', 'kind', 'hyperparameters', 'maximum_trials', 'optional',
    ], `candidate ${candidate.id}`);
    if (typeof candidate.implementation !== 'string' || candidate.implementation.length < 5
      || !Number.isSafeInteger(candidate.maximum_trials) || candidate.maximum_trials < 1) {
      throw new TypeError(`Evaluation Protocol v3 candidate ${candidate.id} is incomplete.`);
    }
    budget += candidate.maximum_trials;
  }
  if (budget !== protocol.inner_validation.maximum_total_trials_per_fold_unit_slice
    || protocol.inner_validation.scope !== 'training-window-only'
    || protocol.inner_validation.test_fold_access !== false) {
    throw new TypeError('Evaluation Protocol v3 hyperparameter budget or inner validation drifted.');
  }
  if (stable(protocol.rolling_folds.map(({ id }) => id)) !== stable(FOLDS)) {
    throw new TypeError('Evaluation Protocol v3 rolling folds drifted.');
  }
  for (const fold of protocol.rolling_folds) validateFold(fold);
  if (protocol.spatial_holdout.held_out_blocks_fit_any_preprocessing_or_model !== false
    || protocol.convergence.finite_parameters_and_predictions_required !== true
    || protocol.interval_calibration.aggregate_bypass_allowed !== false
    || protocol.prediction_cap.minimum_inclusive !== 0
    || protocol.prediction_cap.maximum_inclusive !== Math.exp(12)
    || protocol.slice_gate.all_primary_slices_must_pass !== true
    || protocol.slice_gate.simple_baselines_auto_promote !== false
    || protocol.slice_gate.ml_models_auto_promote !== false) {
    throw new TypeError('Evaluation Protocol v3 holdout, convergence, interval, cap, or slice gate drifted.');
  }
  if (protocol.artifact_contract.research_only !== true
    || protocol.artifact_contract.test_results_in_protocol !== false
    || !protocol.artifact_contract.required_identities.includes('candidate_implementation_identity')
    || protocol.decision.eligibility_is_promotion !== false
    || protocol.decision.default !== 'no-promotion'
    || protocol.decision.current_state !== 'unavailable') {
    throw new TypeError('Evaluation Protocol v3 artifact or promotion boundary drifted.');
  }
  if (protocol.privacy.aggregate_only !== true
    || Object.entries(protocol.privacy).some(([key, value]) => key !== 'aggregate_only' && value !== false)
    || Object.values(protocol.authority).some((value) => value !== false)) {
    throw new TypeError('Evaluation Protocol v3 privacy or authority boundary drifted.');
  }
  return protocol;
}

function validateFold(fold) {
  exactKeys(fold, [
    'id', 'train_start', 'train_end_exclusive', 'test_start', 'test_end_exclusive',
  ], `fold ${fold.id}`);
  const values = [fold.train_start, fold.train_end_exclusive, fold.test_start, fold.test_end_exclusive];
  for (const value of values) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
      || new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 1) {
      throw new TypeError(`Evaluation Protocol v3 fold date ${value} is invalid or not Monday aligned.`);
    }
  }
  if (!(fold.train_start < fold.train_end_exclusive
    && fold.train_end_exclusive === fold.test_start
    && fold.test_start < fold.test_end_exclusive)) {
    throw new TypeError(`Evaluation Protocol v3 fold ${fold.id} overlaps or is empty.`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || stable(Object.keys(value).sort()) !== stable([...keys].sort())) {
    throw new TypeError(`${label} contains unknown or missing fields.`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
