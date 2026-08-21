export const AREA_INTELLIGENCE_SERVING_SCHEMA = 'engagement-area-intelligence-serving/v1';

export function validateAreaIntelligenceServingArtifact(value) {
  if (!isRecord(value)
    || value.schema !== AREA_INTELLIGENCE_SERVING_SCHEMA
    || !exactTimestamp(value.generated_at)
    || !['promoted', 'not-promoted'].includes(value.status)
    || value.historical_evidence?.status !== 'available'
    || value.historical_evidence?.measure !== 'PPD reported incidents'
    || typeof value.historical_evidence?.source_vintage !== 'string'
    || !Array.isArray(value.forbidden_claims)) {
    throw new TypeError('Area Intelligence serving artifact is unavailable or invalid.');
  }
  assertNoForbiddenFields(value);
  if (value.status === 'not-promoted') {
    if (value.forecast?.status !== 'unavailable'
      || value.forecast?.reason !== 'model-did-not-exceed-predefined-seasonal-baseline'
      || !Array.isArray(value.forecast?.predictions)
      || value.forecast.predictions.length !== 0
      || value.evaluation?.promotion_status !== 'not-promoted'
      || value.evaluation?.selected_model !== null) {
      throw new TypeError('Area Intelligence no-promotion serving state must remain explicit and empty.');
    }
  } else {
    if (value.forecast?.status !== 'available'
      || typeof value.forecast?.model_version !== 'string'
      || value.evaluation?.promotion_status !== 'promoted'
      || value.evaluation?.selected_model !== value.forecast.model_version
      || !Array.isArray(value.forecast?.predictions)
      || value.forecast.predictions.length === 0) {
      throw new TypeError('Area Intelligence promoted serving state requires admitted predictions.');
    }
    const units = new Set();
    for (const prediction of value.forecast.predictions) {
      validatePrediction(prediction, value.forecast.model_version, value.generated_at);
      const key = `${prediction.unit_type}:${prediction.unit_id}`;
      if (units.has(key)) throw new TypeError('Area Intelligence serving predictions contain a duplicate unit.');
      units.add(key);
    }
  }
  return structuredClone(value);
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

function exactDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
