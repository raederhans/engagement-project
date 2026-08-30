import { createHash } from 'node:crypto';
import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import Ajv from 'ajv';

export const AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SCHEMA =
  'engagement-area-intelligence-evaluation-protocol/v2';
export const AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256 =
  'sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde';
export const AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SEMANTIC_SHA256 =
  'sha256:0416157d2b02a58809c5cb28f9217e3a5003225105b24a6c25e34e41d0229cb7';
export const AREA_INTELLIGENCE_EVALUATION_RECEIPT_SHA256 =
  'sha256:2735f174cc978ea6abad31519672c58618fe5602cc9dedef918f8d624f523925';

const readFileAsync = promisify(readFile);
const DEFAULT_PROTOCOL_URL = new URL(
  '../data/area_intelligence_evaluation_protocol.v2.json',
  import.meta.url,
);
const SCHEMA_URL = new URL(
  '../data/area_intelligence_evaluation_protocol.schema.json',
  import.meta.url,
);
const schema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FOLD_IDS = Object.freeze(['fold-2019', 'fold-2021', 'fold-2023', 'fold-2025-2026']);
const UNIT_TYPES = Object.freeze(['tract', 'fixed-grid']);
const HOLDOUT_SLICES = Object.freeze(['temporal-non-heldout', 'spatial-heldout']);
const MODEL_IDS = Object.freeze([
  'seasonal-naive-52w',
  'moving-average-4w',
  'moving-average-13w',
  'poisson-log-link-v1',
  'negative-binomial-log-link-v1',
]);
const FORBIDDEN_CLAIMS = Object.freeze([
  'individual victim probability',
  'absolute safety',
  'safety score',
  'safest area',
  'safest route',
  'causal effect',
]);

export class AreaIntelligenceEvaluationProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AreaIntelligenceEvaluationProtocolError';
    this.code = code;
  }
}

export async function loadAreaIntelligenceEvaluationProtocol({
  protocolPath = DEFAULT_PROTOCOL_URL,
  expectedProtocolSha256 = AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
  receiptSha256 = AREA_INTELLIGENCE_EVALUATION_RECEIPT_SHA256,
} = {}) {
  const protocolBytes = await readFileAsync(protocolPath);
  let protocol;
  try {
    protocol = JSON.parse(protocolBytes.toString('utf8'));
  } catch (error) {
    throw protocolError('protocol-json-invalid', `Protocol JSON is invalid: ${error.message}`);
  }
  validateAreaIntelligenceEvaluationProtocol(protocol, {
    protocolBytes,
    expectedProtocolSha256,
    receiptSha256,
  });
  return deepFreeze(protocol);
}

export function validateAreaIntelligenceEvaluationProtocol(protocol, {
  protocolBytes,
  expectedProtocolSha256 = AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
  receiptSha256 = AREA_INTELLIGENCE_EVALUATION_RECEIPT_SHA256,
} = {}) {
  if (!validateSchema(protocol)) {
    const details = validateSchema.errors
      ?.map(({ instancePath, message }) => `${instancePath || '/'} ${message}`)
      .join('; ');
    throw protocolError('schema-invalid', `Protocol schema validation failed: ${details}`);
  }

  requireSha256(expectedProtocolSha256, 'expected protocol SHA-256');
  requireSha256(receiptSha256, 'observed receipt SHA-256');
  if (protocol.exact_input_gate.receipt_sha256 !== receiptSha256) {
    throw protocolError('receipt-sha256-drift', 'Exact M1 receipt byte identity drifted from the frozen protocol.');
  }

  validateFoldSemantics(protocol.rolling_folds);
  validatePrimaryTupleVocabulary(protocol);
  validateModelAndNumericalSemantics(protocol);
  validateIntervalSemantics(protocol);
  validateGovernanceSemantics(protocol);

  const semanticIdentity = identityOfStableValue(protocol);
  if (semanticIdentity !== AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SEMANTIC_SHA256) {
    throw protocolError(
      'protocol-semantic-drift',
      'Protocol fields, vocabulary, ordering, or frozen values drifted from the exact P3 semantic identity.',
    );
  }

  if (protocolBytes !== undefined) {
    validateProtocolBytes(protocol, protocolBytes, expectedProtocolSha256);
  }
  return protocol;
}

export function areaIntelligenceEvaluationProtocolIdentity(protocolBytes) {
  const bytes = toBuffer(protocolBytes, 'protocol bytes');
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialization(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateProtocolBytes(protocol, protocolBytes, expectedProtocolSha256) {
  const bytes = toBuffer(protocolBytes, 'protocol bytes');
  if (bytes.includes(13)) {
    throw protocolError('protocol-byte-format-drift', 'Protocol bytes must be LF-only.');
  }
  if (bytes.length === 0 || bytes.at(-1) !== 10) {
    throw protocolError('protocol-byte-format-drift', 'Protocol bytes must end with exactly one LF.');
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw protocolError('protocol-json-invalid', `Protocol bytes do not contain valid JSON: ${error.message}`);
  }
  if (stableSerialization(parsed) !== stableSerialization(protocol)) {
    throw protocolError('protocol-object-byte-mismatch', 'Validated protocol object does not match the supplied protocol bytes.');
  }
  if (areaIntelligenceEvaluationProtocolIdentity(bytes) !== expectedProtocolSha256) {
    throw protocolError('protocol-sha256-drift', 'Protocol byte identity drifted from the frozen P3 identity.');
  }
}

function validateFoldSemantics(folds) {
  if (stableSerialization(folds.map(({ id }) => id)) !== stableSerialization(FOLD_IDS)) {
    throw protocolError('fold-vocabulary-drift', 'Rolling fold identifiers or ordering drifted.');
  }
  const testWindows = [];
  for (const fold of folds) {
    const boundaries = [
      fold.train_start,
      fold.train_end_exclusive,
      fold.test_start,
      fold.test_end_exclusive,
    ];
    const milliseconds = boundaries.map((value) => mondayMilliseconds(value));
    if (!(milliseconds[0] < milliseconds[1]
      && milliseconds[1] === milliseconds[2]
      && milliseconds[2] < milliseconds[3])) {
      throw protocolError(
        'fold-range-invalid',
        `${fold.id} must have nonempty adjacent training and test ranges with no overlap.`,
      );
    }
    testWindows.push([milliseconds[2], milliseconds[3], fold.id]);
  }
  for (let index = 1; index < testWindows.length; index += 1) {
    if (testWindows[index][0] < testWindows[index - 1][1]) {
      throw protocolError(
        'fold-test-overlap',
        `${testWindows[index - 1][2]} and ${testWindows[index][2]} test windows overlap.`,
      );
    }
  }
}

function validatePrimaryTupleVocabulary(protocol) {
  const expected = [];
  for (const fold of FOLD_IDS) {
    for (const unitType of UNIT_TYPES) {
      for (const holdoutSlice of HOLDOUT_SLICES) {
        expected.push({ fold, unit_type: unitType, holdout_slice: holdoutSlice });
      }
    }
  }
  if (stableSerialization(protocol.marts.unit_types) !== stableSerialization(UNIT_TYPES)
    || stableSerialization(protocol.spatial_holdout.report_slices) !== stableSerialization(HOLDOUT_SLICES)
    || stableSerialization(protocol.primary_tuple_vocabulary) !== stableSerialization(expected)) {
    throw protocolError(
      'primary-tuple-vocabulary-drift',
      'Primary tuple vocabulary must be the exact 4-fold by 2-unit by 2-holdout Cartesian product.',
    );
  }
}

function validateModelAndNumericalSemantics(protocol) {
  if (stableSerialization(protocol.models.map(({ id }) => id)) !== stableSerialization(MODEL_IDS)) {
    throw protocolError('model-vocabulary-drift', 'Model identifiers or ordering drifted.');
  }
  const gate = protocol.numerical_stability_gate;
  const numericValues = [
    gate.coefficient_abs_limit_inclusive,
    gate.convergence.threshold_exclusive,
    gate.prediction.minimum_inclusive,
    gate.prediction.maximum_inclusive,
    gate.prediction.log_mean_abs_limit_inclusive,
    ...gate.dispersion_alpha_inclusive,
  ];
  if (!numericValues.every(Number.isFinite)
    || !(gate.coefficient_abs_limit_inclusive > 0)
    || !(gate.convergence.threshold_exclusive > 0)
    || !(gate.prediction.minimum_inclusive >= 0)
    || !(gate.prediction.maximum_inclusive > gate.prediction.minimum_inclusive)
    || !(gate.dispersion_alpha_inclusive[0] > 0)
    || !(gate.dispersion_alpha_inclusive[1] >= gate.dispersion_alpha_inclusive[0])) {
    throw protocolError('numerical-gate-invalid', 'Numerical stability thresholds must be finite and within their frozen domains.');
  }
  if (gate.prediction.maximum_inclusive !== Math.exp(gate.prediction.log_mean_abs_limit_inclusive)) {
    throw protocolError('maximum-prediction-invalid', 'Maximum prediction must equal exp(log mean limit).');
  }
  for (const model of protocol.models.filter(({ kind }) => (
    kind === 'poisson' || kind === 'negative-binomial-nb2'
  ))) {
    if (model.coefficient_abs_limit !== gate.coefficient_abs_limit_inclusive) {
      throw protocolError('model-config-drift', `${model.id} coefficient limit drifted from the numerical gate.`);
    }
  }
}

function validateIntervalSemantics(protocol) {
  const interval = protocol.numerical_stability_gate.interval;
  const coverage = interval.primary_slice_coverage_inclusive;
  if (!Number.isFinite(interval.nominal_probability)
    || !(interval.nominal_probability > 0 && interval.nominal_probability < 1)
    || coverage.length !== 2
    || !coverage.every(Number.isFinite)
    || !(0 <= coverage[0] && coverage[0] <= interval.nominal_probability)
    || !(interval.nominal_probability <= coverage[1] && coverage[1] <= 1)
    || protocol.metrics.interval_nominal !== interval.nominal_probability
    || protocol.metrics.baseline_interval !== interval.baseline_calibration
    || protocol.metrics.count_model_intervals !== interval.count_model_calibration
    || stableSerialization(protocol.promotion_gate.acceptable_interval_coverage_inclusive)
      !== stableSerialization(coverage)
    || interval.aggregate_bypass_allowed !== false
    || protocol.promotion_gate.all_primary_slices_must_pass !== true) {
    throw protocolError('interval-gate-drift', 'Nominal interval and exact primary-slice coverage rules drifted.');
  }
}

function validateGovernanceSemantics(protocol) {
  if (stableSerialization(protocol.target.forbidden_claims) !== stableSerialization(FORBIDDEN_CLAIMS)
    || stableSerialization(protocol.forbidden_claims) !== stableSerialization(FORBIDDEN_CLAIMS)) {
    throw protocolError('forbidden-claims-drift', 'The exact forbidden-claim vocabulary is missing or drifted.');
  }
  if (protocol.privacy.aggregate_only !== true
    || Object.entries(protocol.privacy).some(([key, value]) => key !== 'aggregate_only' && value !== false)
    || Object.values(protocol.authority).some((value) => value !== false)
    || protocol.current_evaluation_state.status !== 'not-promoted'
    || protocol.current_evaluation_state.availability !== 'unavailable'
    || protocol.current_evaluation_state.selected_model !== null
    || protocol.current_evaluation_state.failure_result !== protocol.promotion_gate.failure_result
    || protocol.artifact_policy.forbidden.length === 0) {
    throw protocolError('governance-boundary-drift', 'Artifact, privacy, no-promotion, or authority boundaries drifted.');
  }
}

function mondayMilliseconds(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    throw protocolError('fold-date-invalid', `Fold date is not an exact YYYY-MM-DD value: ${value}.`);
  }
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds)
    || new Date(milliseconds).toISOString().slice(0, 10) !== value
    || new Date(milliseconds).getUTCDay() !== 1
    || milliseconds % WEEK_MS !== 4 * 24 * 60 * 60 * 1000) {
    throw protocolError('fold-date-invalid', `Fold date is invalid or not Monday-aligned: ${value}.`);
  }
  return milliseconds;
}

function identityOfStableValue(value) {
  return `sha256:${createHash('sha256').update(stableSerialization(value)).digest('hex')}`;
}

function requireSha256(value, label) {
  if (!SHA256_PATTERN.test(value || '')) {
    throw protocolError('sha256-invalid', `${label} must be a prefixed lowercase SHA-256 digest.`);
  }
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw protocolError('protocol-bytes-invalid', `${label} must be a Buffer, Uint8Array, or string.`);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function protocolError(code, message) {
  return new AreaIntelligenceEvaluationProtocolError(code, message);
}
