export const AREA_INTELLIGENCE_SERVING_SCHEMA = 'engagement-area-intelligence-serving/v1';

const PROTOCOL_SCHEMA = 'engagement-area-intelligence-evaluation-protocol/v2';
const EVALUATION_MANIFEST_SCHEMA = 'engagement-area-intelligence-evaluation-run/v2';
const MART_SCHEMA = 'engagement-area-intelligence-feature-mart/v2';
const M1_RECEIPT_SCHEMA = 'engagement-phl-crime-warehouse-receipt/v3';

export function validateAreaIntelligenceServingArtifact(value) {
  if (!isRecord(value)
    || value.schema !== AREA_INTELLIGENCE_SERVING_SCHEMA
    || !exactTimestamp(value.generated_at)
    || !['promoted', 'not-promoted'].includes(value.status)
    || value.historical_evidence?.status !== 'available'
    || value.historical_evidence?.measure !== 'PPD reported incidents'
    || typeof value.historical_evidence?.source_vintage !== 'string'
    || !Array.isArray(value.forbidden_claims)) {
    throw new TypeError('Invalid artifact.');
  }
  assertNoForbiddenFields(value);
  if (value.status === 'not-promoted') {
    if (value.forecast?.status !== 'unavailable'
      || typeof value.forecast?.reason !== 'string'
      || !Array.isArray(value.forecast?.predictions)
      || value.forecast.predictions.length !== 0
      || value.evaluation?.promotion_status !== 'not-promoted'
      || value.evaluation?.selected_model !== null) {
      throw new TypeError('Invalid no-promotion state.');
    }
  } else {
    if (value.forecast?.status !== 'available'
      || typeof value.forecast?.model_version !== 'string'
      || value.evaluation?.promotion_status !== 'promoted'
      || value.evaluation?.selected_model !== value.forecast.model_version
      || !Array.isArray(value.forecast?.predictions)
      || value.forecast.predictions.length === 0) {
      throw new TypeError('Predictions required.');
    }
    const units = new Set();
    for (const prediction of value.forecast.predictions) {
      validatePrediction(prediction, value.forecast.model_version, value.generated_at);
      const key = `${prediction.unit_type}:${prediction.unit_id}`;
      if (units.has(key)) throw new TypeError('Duplicate unit.');
      units.add(key);
    }
  }
  return structuredClone(value);
}

// Runtime admission is intentionally stricter than the evaluation's internal
// serving-artifact shape. In particular, a tracked historical v1 artifact is
// not a current candidate until the publisher has attached the exact v2
// protocol/evaluation/mart/M1 receipt lineage and current evidence clocks.
export function validateAreaIntelligenceServingCandidate(value) {
  const candidate = validateAreaIntelligenceServingArtifact(value);
  assertNoPrivateFields(candidate);
  const historical = candidate.historical_evidence;
  if (!exactTimestamp(historical.source_as_of)
    || historical.source_as_of > candidate.generated_at
    || !digest(historical.source_vintage)
    || !validCoverage(historical.coverage)
    || !nonEmptyStrings(historical.limitations)) {
    throw new TypeError('Area Intelligence serving candidate requires source-as-of, coverage, and limitations.');
  }

  const lineage = candidate.lineage;
  if (!isRecord(lineage)
    || lineage.protocol?.schema !== PROTOCOL_SCHEMA
    || !hashHex(lineage.protocol?.sha256)
    || lineage.evaluation?.schema !== EVALUATION_MANIFEST_SCHEMA
    || !hashHex(lineage.evaluation?.manifest_sha256)
    || lineage.mart?.schema !== MART_SCHEMA
    || !hashHex(lineage.mart?.manifest_sha256)
    || !digest(lineage.mart?.artifact_identity)
    || !digest(lineage.mart?.part_bindings_identity)
    || lineage.m1_receipt?.schema !== M1_RECEIPT_SCHEMA
    || !digest(lineage.m1_receipt?.identity)
    || candidate.evaluation?.protocol_sha256 !== lineage.protocol.sha256) {
    throw new TypeError('Area Intelligence serving candidate lineage is unavailable or invalid.');
  }

  if (candidate.status === 'not-promoted') {
    if (!reasonCode(candidate.forecast.reason)
      || /(?:^|-)zero(?:-|$)|safe|low-risk|no-risk/i.test(candidate.forecast.reason)) {
      throw new TypeError('Area Intelligence unavailable reason is invalid or unsafe.');
    }
  } else {
    for (const prediction of candidate.forecast.predictions) {
      if (prediction.trained_through >= prediction.target_week_start
        || prediction.feature_observed_through > prediction.target_week_start
        || prediction.source_vintage !== historical.source_vintage) {
        throw new TypeError('Area Intelligence prediction window crosses its admitted observation boundary.');
      }
    }
  }
  const claims = candidate.forbidden_claims.map((claim) => String(claim).toLowerCase());
  for (const required of ['individual victim probability', 'absolute safety', 'safest area', 'safest route', 'causal effect']) {
    if (!claims.includes(required)) throw new TypeError(`Area Intelligence serving candidate must forbid ${required}.`);
  }
  return candidate;
}

function validatePrediction(prediction, modelVersion, generatedAt) {
  if (!isRecord(prediction)
    || prediction.unit_type !== 'tract'
    || !/^\d{11}$/.test(prediction.unit_id || '')
    || !exactDate(prediction.target_week_start)
    || !Number.isFinite(prediction.predicted_reported_incident_count)
    || prediction.predicted_reported_incident_count < 0
    || !Number.isFinite(prediction.prediction_interval_90?.lower)
    || !Number.isFinite(prediction.prediction_interval_90?.upper)
    || prediction.prediction_interval_90.lower < 0
    || prediction.prediction_interval_90.upper < prediction.prediction_interval_90.lower
    || !exactDate(prediction.trained_through)
    || !exactDate(prediction.feature_observed_through)
    || prediction.model_version !== modelVersion
    || prediction.generated_at !== generatedAt
    || typeof prediction.source_vintage !== 'string'
    || !Array.isArray(prediction.limitations)
    || prediction.limitations.length === 0) {
    throw new TypeError('Area Intelligence prediction contract is invalid.');
  }
}

function assertNoForbiddenFields(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const forbidden = /^(?:safety_?score|victim_?probability|safest_?(?:area|route)|route_?recommendation)$/i;
  for (const [key, nested] of Object.entries(value)) {
    if (forbidden.test(key)) throw new TypeError(`Area Intelligence serving artifact contains forbidden field ${key}.`);
    assertNoForbiddenFields(nested, seen);
  }
}

function exactTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function assertNoPrivateFields(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const forbidden = /^(?:generalized_?location|location_?block|source_?record_?id|point_[xy]|coordinates?|input_?address|normalized_?address|parcel_?identifier)$/i;
  for (const [key, nested] of Object.entries(value)) {
    if (forbidden.test(key)) throw new TypeError(`Area Intelligence serving artifact contains forbidden field ${key}.`);
    assertNoPrivateFields(nested, seen);
  }
}

function exactDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function validCoverage(value) {
  return isRecord(value)
    && exactDate(value.earliest_scope_start)
    && exactDate(value.latest_scope_end_exclusive)
    && value.earliest_scope_start < value.latest_scope_end_exclusive;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= 500);
}

function digest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function hashHex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function reasonCode(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
