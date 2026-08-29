export const AREA_INTELLIGENCE_SERVING_SCHEMA = 'engagement-area-intelligence-serving/v2';

const LEGACY_SERVING_SCHEMA = 'engagement-area-intelligence-serving/v1';
const PROTOCOL_SCHEMA = 'engagement-area-intelligence-evaluation-protocol/v2';
const EVALUATION_MANIFEST_SCHEMA = 'engagement-area-intelligence-evaluation-run/v2';
const MART_SCHEMA = 'engagement-area-intelligence-feature-mart/v2';
const M1_RECEIPT_SCHEMA = 'engagement-phl-crime-warehouse-receipt/v3';
const REQUIRED_FORBIDDEN_CLAIMS = Object.freeze([
  'individual victim probability', 'absolute safety', 'safety score',
  'safest area', 'safest route', 'causal effect',
]);
const AUTHORITY_KEYS = Object.freeze([
  'local_evaluation', 'serving', 'product_promotion', 'scientific', 'causal', 'safety', 'deletion',
]);
const PRIVACY_KEYS = Object.freeze([
  'aggregate_only', 'event_level_data_included', 'coordinates_included',
  'generalized_locations_included', 'raw_or_canonical_events_included', 'source_record_ids_included',
]);
const WHY_UNAVAILABLE_CODES = new Set([
  'local-candidate-only', 'promotion-gate-not-passed',
  'primary-interval-90-gate-not-passed', 'serving-authority-unavailable',
]);

// The legacy shape remains readable so the committed historical baseline can be
// rendered. It is never a current serving candidate. New publication is v2 and
// intentionally has no promoted branch: P3 has no serving authority.
export function validateAreaIntelligenceServingArtifact(value) {
  assertPlainFiniteJson(value, 'Area Intelligence serving artifact');
  if (value?.schema === LEGACY_SERVING_SCHEMA) return validateLegacyArtifact(value);
  if (value?.schema !== AREA_INTELLIGENCE_SERVING_SCHEMA) throw new TypeError('Invalid artifact schema.');
  assertExactKeys(value, [
    'schema', 'generated_at', 'status', 'historical_evidence', 'forecast', 'evaluation',
    'authority', 'privacy', 'lineage', 'forbidden_claims',
  ], 'artifact');
  if (!exactTimestamp(value.generated_at) || value.status !== 'not-promoted') {
    throw new TypeError('Area Intelligence public projection must remain not-promoted.');
  }
  validateHistoricalEvidence(value.historical_evidence, value.generated_at);
  validateUnavailableForecast(value.forecast);
  validateEvaluationSummary(value.evaluation);
  validateGovernance(value.authority, value.privacy);
  validateLineage(value.lineage);
  validateForbiddenClaims(value.forbidden_claims);
  assertNoSensitiveValues(value);
  return structuredClone(value);
}

export function validateAreaIntelligenceServingCandidate(value, context = {}) {
  const candidate = validateAreaIntelligenceServingArtifact(value);
  if (candidate.schema !== AREA_INTELLIGENCE_SERVING_SCHEMA) {
    throw new TypeError('Legacy Area Intelligence artifacts are not current serving candidates.');
  }
  if (candidate.evaluation.decision === 'local-candidate'
    && candidate.evaluation.local_candidate_model === null) {
    throw new TypeError('Local-candidate outcome requires its audit-only candidate identity.');
  }
  if (candidate.evaluation.decision === 'no-promotion'
    && candidate.evaluation.local_candidate_model !== null) {
    throw new TypeError('No-promotion outcome cannot retain a local candidate model.');
  }
  validateExternalContext(candidate, context);
  return candidate;
}

function validateLegacyArtifact(value) {
  assertExactKeys(value, [
    'schema', 'generated_at', 'status', 'historical_evidence', 'forecast', 'evaluation', 'forbidden_claims',
  ], 'legacy artifact');
  assertExactKeys(value.historical_evidence, [
    'status', 'measure', 'coverage', 'source_vintage', 'limitations',
  ], 'legacy historical evidence');
  assertExactKeys(value.historical_evidence.coverage, [
    'earliest_scope_start', 'latest_scope_end_exclusive', 'latest_event_at',
  ], 'legacy coverage');
  assertExactKeys(value.forecast, ['status', 'reason', 'predictions'], 'legacy forecast');
  assertExactKeys(value.evaluation, ['promotion_status', 'selected_model'], 'legacy evaluation');
  if (!exactTimestamp(value.generated_at)
    || value.status !== 'not-promoted'
    || value.historical_evidence.status !== 'available'
    || value.historical_evidence.measure !== 'PPD reported incidents'
    || !digest(value.historical_evidence.source_vintage)
    || !validCoverage(value.historical_evidence.coverage)
    || !exactTimestamp(value.historical_evidence.coverage.latest_event_at)
    || !nonEmptyStrings(value.historical_evidence.limitations)
    || value.forecast.status !== 'unavailable'
    || !reasonCode(value.forecast.reason)
    || !Array.isArray(value.forecast.predictions)
    || value.forecast.predictions.length !== 0
    || value.evaluation.promotion_status !== 'not-promoted'
    || value.evaluation.selected_model !== null) {
    throw new TypeError('Invalid legacy no-promotion artifact.');
  }
  validateForbiddenClaims(value.forbidden_claims);
  assertNoSensitiveValues(value);
  return structuredClone(value);
}

function validateHistoricalEvidence(value, generatedAt) {
  assertExactKeys(value, ['status', 'measure', 'source_as_of', 'source_vintage', 'coverage', 'method'], 'historical evidence');
  assertExactKeys(value.coverage, [
    'earliest_scope_start', 'latest_scope_end_exclusive', 'complete_week_end_exclusive',
  ], 'coverage');
  assertExactKeys(value.method, [
    'grain', 'week_definition', 'unit_types', 'spatial_holdout_from_count_model_training',
    'incomplete_source_week_excluded', 'ambiguous_or_unavailable_spatial_assignments_excluded',
  ], 'method');
  if (value.status !== 'available'
    || value.measure !== 'PPD reported incidents'
    || !exactTimestamp(value.source_as_of)
    || value.source_as_of > generatedAt
    || !digest(value.source_vintage)
    || !validCoverage(value.coverage)
    || !exactDate(value.coverage.complete_week_end_exclusive)
    || value.coverage.complete_week_end_exclusive > value.coverage.latest_scope_end_exclusive
    || value.method.grain !== 'spatial-unit-week'
    || value.method.week_definition !== 'UTC Monday 00:00 inclusive to next Monday exclusive'
    || stableSerialization(value.method.unit_types) !== stableSerialization(['tract', 'fixed-grid'])
    || value.method.spatial_holdout_from_count_model_training !== true
    || value.method.incomplete_source_week_excluded !== true
    || value.method.ambiguous_or_unavailable_spatial_assignments_excluded !== true) {
    throw new TypeError('Area Intelligence historical evidence or method drifted.');
  }
}

function validateUnavailableForecast(value) {
  assertExactKeys(value, ['status', 'reason', 'predictions'], 'forecast');
  if (value.status !== 'unavailable'
    || !['local-candidate-has-no-serving-authority', 'promotion-gate-not-passed'].includes(value.reason)
    || !Array.isArray(value.predictions)
    || value.predictions.length !== 0) {
    throw new TypeError('Area Intelligence forecast must remain unavailable with empty predictions.');
  }
}

function validateEvaluationSummary(value) {
  assertExactKeys(value, [
    'promotion_status', 'decision', 'selected_model', 'local_candidate_model', 'local_candidate_only',
    'interval_90_outcome', 'why_unavailable',
  ], 'evaluation summary');
  assertExactKeys(value.interval_90_outcome, ['passed', 'failed_primary_slice_count'], '90% interval outcome');
  assertExactKeys(value.why_unavailable, ['code', 'reason_codes'], 'unavailable summary');
  if (value.promotion_status !== 'not-promoted'
    || !['local-candidate', 'no-promotion'].includes(value.decision)
    || value.selected_model !== null
    || !(value.local_candidate_model === null || modelId(value.local_candidate_model))
    || value.local_candidate_only !== true
    || typeof value.interval_90_outcome.passed !== 'boolean'
    || !Number.isSafeInteger(value.interval_90_outcome.failed_primary_slice_count)
    || value.interval_90_outcome.failed_primary_slice_count < 0
    || value.interval_90_outcome.passed !== (value.interval_90_outcome.failed_primary_slice_count === 0)
    || !['local-candidate-has-no-serving-authority', 'promotion-gate-not-passed'].includes(value.why_unavailable.code)
    || !Array.isArray(value.why_unavailable.reason_codes)
    || value.why_unavailable.reason_codes.length < 1
    || new Set(value.why_unavailable.reason_codes).size !== value.why_unavailable.reason_codes.length
    || value.why_unavailable.reason_codes.some((code) => !WHY_UNAVAILABLE_CODES.has(code))) {
    throw new TypeError('Area Intelligence aggregate-only evaluation summary is invalid.');
  }
  const expectedCode = value.decision === 'local-candidate'
    ? 'local-candidate-has-no-serving-authority'
    : 'promotion-gate-not-passed';
  const expectedReasons = [
    value.decision === 'local-candidate' ? 'local-candidate-only' : 'promotion-gate-not-passed',
    ...(value.interval_90_outcome.passed ? [] : ['primary-interval-90-gate-not-passed']),
    'serving-authority-unavailable',
  ];
  if (value.why_unavailable.code !== expectedCode
    || stableSerialization(value.why_unavailable.reason_codes) !== stableSerialization(expectedReasons)) {
    throw new TypeError('Area Intelligence unavailable reason drifted from its gate outcome.');
  }
}

function validateGovernance(authority, privacy) {
  assertExactKeys(authority, AUTHORITY_KEYS, 'authority');
  assertExactKeys(privacy, PRIVACY_KEYS, 'privacy');
  if (Object.values(authority).some((entry) => entry !== false)
    || privacy.aggregate_only !== true
    || Object.entries(privacy).some(([key, entry]) => key !== 'aggregate_only' && entry !== false)) {
    throw new TypeError('Area Intelligence authority or privacy contract drifted.');
  }
}

function validateLineage(value) {
  assertExactKeys(value, ['protocol', 'evaluation', 'mart', 'm1_receipt'], 'lineage');
  assertExactKeys(value.protocol, ['schema', 'sha256'], 'protocol lineage');
  assertExactKeys(value.evaluation, ['schema', 'manifest_sha256'], 'evaluation lineage');
  assertExactKeys(value.mart, ['schema', 'manifest_sha256', 'artifact_identity', 'part_bindings_identity'], 'mart lineage');
  assertExactKeys(value.m1_receipt, ['schema', 'identity', 'sha256'], 'M1 receipt lineage');
  if (value.protocol.schema !== PROTOCOL_SCHEMA
    || !hashHex(value.protocol.sha256)
    || value.evaluation.schema !== EVALUATION_MANIFEST_SCHEMA
    || !hashHex(value.evaluation.manifest_sha256)
    || value.mart.schema !== MART_SCHEMA
    || !hashHex(value.mart.manifest_sha256)
    || !digest(value.mart.artifact_identity)
    || !digest(value.mart.part_bindings_identity)
    || value.m1_receipt.schema !== M1_RECEIPT_SCHEMA
    || !digest(value.m1_receipt.identity)
    || !digest(value.m1_receipt.sha256)) {
    throw new TypeError('Area Intelligence serving candidate lineage is invalid.');
  }
}

function validateForbiddenClaims(value) {
  if (stableSerialization(value) !== stableSerialization(REQUIRED_FORBIDDEN_CLAIMS)) {
    throw new TypeError('Area Intelligence forbidden claims are incomplete or reordered.');
  }
}

function validateExternalContext(candidate, context) {
  if (!context || Object.keys(context).length === 0) return;
  assertExactKeys(context, [
    'protocol', 'manifest', 'manifestIdentity', 'martManifest', 'martManifestIdentity',
    'm1Receipt', 'm1ReceiptSha256', 'report', 'checkpoint',
  ], 'external validation context');
  const { protocol, manifest, martManifest, m1Receipt, report, checkpoint } = context;
  const expectedCoverage = {
    earliest_scope_start: report.data?.coverage?.earliest_scope_start,
    latest_scope_end_exclusive: report.data?.coverage?.latest_scope_end_exclusive,
    complete_week_end_exclusive: report.data?.complete_week_end_exclusive,
  };
  if (candidate.lineage.protocol.sha256 !== report.protocol?.sha256
    || candidate.lineage.protocol.sha256 !== manifest.protocol_sha256
    || candidate.lineage.protocol.sha256 !== martManifest.protocol?.sha256
    || candidate.lineage.protocol.sha256 !== manifest.lineage_seam?.protocol?.sha256
    || candidate.lineage.protocol.sha256 !== checkpoint.protocol_sha256
    || candidate.lineage.evaluation.manifest_sha256 !== context.manifestIdentity
    || candidate.lineage.mart.manifest_sha256 !== context.martManifestIdentity
    || candidate.lineage.mart.manifest_sha256 !== manifest.mart_manifest_sha256
    || candidate.lineage.mart.manifest_sha256 !== manifest.lineage_seam?.mart?.manifest_sha256
    || candidate.lineage.mart.manifest_sha256 !== checkpoint.mart_manifest_sha256
    || candidate.lineage.mart.artifact_identity !== martManifest.artifact_identity
    || candidate.lineage.mart.artifact_identity !== manifest.mart_artifact_identity
    || candidate.lineage.mart.artifact_identity !== manifest.lineage_seam?.mart?.artifact_identity
    || candidate.lineage.mart.artifact_identity !== checkpoint.mart_artifact_identity
    || candidate.lineage.mart.part_bindings_identity !== martManifest.part_bindings_identity
    || candidate.lineage.mart.part_bindings_identity !== manifest.lineage_seam?.mart?.part_bindings_identity
    || candidate.lineage.m1_receipt.identity !== m1Receipt.identity
    || candidate.lineage.m1_receipt.identity !== protocol.exact_input_gate?.receipt_identity
    || candidate.lineage.m1_receipt.identity !== martManifest.exact_input?.receipt_identity
    || candidate.lineage.m1_receipt.identity !== manifest.lineage_seam?.m1_receipt?.identity
    || candidate.lineage.m1_receipt.sha256 !== context.m1ReceiptSha256
    || candidate.lineage.m1_receipt.sha256 !== protocol.exact_input_gate?.receipt_sha256
    || candidate.lineage.m1_receipt.sha256 !== martManifest.exact_input?.receipt_sha256
    || candidate.lineage.m1_receipt.sha256 !== manifest.lineage_seam?.m1_receipt?.sha256
    || candidate.lineage.m1_receipt.sha256 !== checkpoint.receipt_sha256
    || candidate.historical_evidence.source_as_of !== m1Receipt.clocks?.source_as_of
    || candidate.historical_evidence.source_vintage !== report.data?.source_vintage
    || candidate.historical_evidence.source_vintage !== m1Receipt.warehouse?.current_snapshot_id
    || stableSerialization(candidate.historical_evidence.coverage) !== stableSerialization(expectedCoverage)
    || report.data?.coverage?.earliest_scope_start !== m1Receipt.coverage?.start
    || report.data?.coverage?.latest_scope_end_exclusive !== m1Receipt.coverage?.end_exclusive
    || stableSerialization(report.data?.coverage) !== stableSerialization(martManifest.source_coverage)
    || candidate.generated_at !== report.generated_at
    || candidate.generated_at !== manifest.generated_at
    || candidate.evaluation.promotion_status !== report.promotion?.status
    || candidate.evaluation.promotion_status !== manifest.promotion?.status
    || candidate.evaluation.selected_model !== report.promotion?.selected_model
    || candidate.evaluation.selected_model !== manifest.promotion?.selected_model
    || candidate.evaluation.decision !== report.promotion?.decision
    || candidate.evaluation.local_candidate_model !== report.promotion?.local_candidate_model
    || candidate.evaluation.local_candidate_model !== manifest.promotion?.local_candidate_model
    || manifest.lineage_seam?.outcome?.promotion_status !== candidate.evaluation.promotion_status
    || manifest.lineage_seam?.outcome?.selected_model !== candidate.evaluation.selected_model
    || manifest.lineage_seam?.outcome?.availability !== 'unavailable'
    || stableSerialization(candidate.authority) !== stableSerialization(protocol.authority)
    || stableSerialization(candidate.authority) !== stableSerialization(manifest.authority)
    || stableSerialization(candidate.authority) !== stableSerialization(report.authority)
    || stableSerialization(candidate.privacy) !== stableSerialization(protocol.privacy)
    || stableSerialization(candidate.privacy) !== stableSerialization(manifest.privacy)
    || stableSerialization(candidate.privacy) !== stableSerialization(report.privacy)
    || stableSerialization(candidate.forbidden_claims) !== stableSerialization(protocol.forbidden_claims)
    || candidate.evaluation.interval_90_outcome.failed_primary_slice_count
      !== failedIntervalSliceCount(report, protocol)) {
    throw new TypeError('Area Intelligence public projection drifted from its validated external context.');
  }
}

function failedIntervalSliceCount(report, protocol) {
  const eligible = new Set(protocol.promotion_gate?.eligible_models || []);
  const bounds = protocol.promotion_gate?.acceptable_interval_coverage_inclusive;
  if (!Array.isArray(bounds) || bounds.length !== 2
    || !bounds.every(Number.isFinite)
    || !Array.isArray(report.metrics?.primary_by_fold_space_holdout)) return Number.NaN;
  return report.metrics.primary_by_fold_space_holdout.filter((row) => (
    eligible.has(row?.model)
      && (!Number.isFinite(row.prediction_interval_90_coverage)
        || row.prediction_interval_90_coverage < bounds[0]
        || row.prediction_interval_90_coverage > bounds[1])
  )).length;
}

function assertPlainFiniteJson(value, label, seen = new Set()) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${label} contains a nonfinite number.`);
  if (value == null || typeof value !== 'object') return;
  if (seen.has(value)) throw new TypeError(`${label} contains a cycle or embedded self-reference.`);
  seen.add(value);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} contains a non-plain object.`);
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} contains an accessor.`);
    assertPlainFiniteJson(descriptor.value, label, seen);
  }
  seen.delete(value);
}

function assertNoSensitiveValues(value) {
  const serialized = JSON.stringify(value);
  if (/(?:[A-Za-z]:[\\/]+Users[\\/]+|file:\/\/\/|\\\\Users\\|(?:^|["'])-?\d{1,3}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,})/i.test(serialized)) {
    throw new TypeError('Area Intelligence public projection contains a private or sensitive value.');
  }
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)
    || stableSerialization(Object.keys(value).sort()) !== stableSerialization([...keys].sort())) {
    throw new TypeError(`Area Intelligence ${label} contains missing or unknown fields.`);
  }
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

function exactTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function exactDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
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

function modelId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
