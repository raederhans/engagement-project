import {
  assertSafeData,
  deterministicIdentity,
} from './known_route_evidence_contract.js';

export const KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA =
  'KnownRouteModeLegalityQualityEvidence/v1';

export const KNOWN_ROUTE_MODE_RESTRICTION_EVIDENCE_SCHEMA =
  'KnownRouteModeRestrictionEvidence/v1';

export const KNOWN_ROUTE_MODE_RESTRICTION_RECEIPT_SCHEMA =
  'KnownRouteModeRestrictionSourceReceipt/v1';

export const KNOWN_ROUTE_LEGALITY_MODES = Object.freeze([
  'walking',
  'cycling',
  'driving',
  'transit',
]);

const CENTERLINE_SOURCE_ID = 'philadelphia-street-centerline';
const IDENTITY = /^[a-z][a-z0-9-]*:[a-f0-9]{16}$/;
const SOURCE_VERSION = /^city-street-centerline:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;
const KNOWN_INSUFFICIENT_RESTRICTION_SOURCES = new Set([
  CENTERLINE_SOURCE_ID,
  'osm-walking-strict-candidate-v1',
  'm5-route-alternatives',
]);
const RECEIPT_FIELDS = Object.freeze([
  'schema',
  'source_id',
  'source_version',
  'mode',
  'route_identity',
  'corridor_identity',
  'centerline_identity',
  'encoded_evidence',
  'receipt_identity',
]);
const ENCODED_FIELDS = Object.freeze([
  'mode_restrictions',
  'oneway',
  'access',
  'temporal',
  'turn',
  'boundary',
]);
const MODE_UNAVAILABLE_REASONS = new Set([
  'mode-restriction-source-unavailable',
  'mode-restriction-contract-mismatch',
  'mode-restriction-source-version-missing',
  'mode-restriction-source-version-mismatch',
  'mode-restriction-source-mismatch',
  'mode-restriction-source-insufficient',
  'mode-restriction-mode-mismatch',
  'mode-restriction-route-mismatch',
  'mode-restriction-corridor-mismatch',
  'mode-restriction-centerline-mismatch',
  'incomplete-mode-restriction-evidence',
  'mode-restriction-receipt-identity-mismatch',
]);
const AUTHORITY = Object.freeze({
  mode: false,
  routing: false,
  safety: false,
});
const PRIVACY = Object.freeze({
  aggregate_only: true,
  route_coordinates_included: false,
  geometry_included: false,
  edge_ids_included: false,
  raw_rows_included: false,
  private_fields_included: false,
});

/**
 * Builds a route-free evidence projection from the existing reference-only
 * centerline match. Candidate restriction receipts are admitted per mode so a
 * bad or absent mode cannot promote any sibling mode.
 */
export function createKnownRouteModeLegalityQualityEvidence({
  normalizedRoute,
  catalog,
  match,
  modeRestrictionEvidence = null,
} = {}) {
  const binding = admitCoreBinding({ normalizedRoute, catalog, match });
  const restrictionEnvelope = admitRestrictionEnvelope(modeRestrictionEvidence);
  const modeLegality = {};
  for (const mode of KNOWN_ROUTE_LEGALITY_MODES) {
    modeLegality[mode] = evaluateModeLegality({
      mode,
      binding,
      envelope: restrictionEnvelope,
    });
  }
  const evidence = {
    schema: KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA,
    route_identity: binding.routeIdentity,
    corridor_identity: binding.corridorIdentity,
    centerline_identity: binding.centerlineIdentity,
    mode_legality: modeLegality,
    match_quality: createMatchQuality(match, binding.sourceVersion),
    authority: { ...AUTHORITY },
    privacy: { ...PRIVACY },
  };
  evidence.semantic_identity = semanticIdentityOf(evidence);
  return validateKnownRouteModeLegalityQualityEvidence(evidence);
}

export function validateKnownRouteModeLegalityQualityEvidence(value) {
  assertSafeData(value, 'Known Route mode legality and match quality evidence');
  exactObject(value, [
    'schema',
    'semantic_identity',
    'route_identity',
    'corridor_identity',
    'centerline_identity',
    'mode_legality',
    'match_quality',
    'authority',
    'privacy',
  ], 'Known Route mode legality and match quality evidence');
  assertFiniteNumbers(value, 'Known Route mode legality and match quality evidence');
  exactObject(value.mode_legality, KNOWN_ROUTE_LEGALITY_MODES, 'mode legality');
  exactObject(value.authority, Object.keys(AUTHORITY), 'authority');
  exactObject(value.privacy, Object.keys(PRIVACY), 'privacy');
  exactObject(value.match_quality, [
    'status',
    'reason',
    'source_id',
    'source_version',
    'match_status',
    'candidate_margin_m',
    'maximum_distance_m',
    'ambiguity_count',
    'off_network_count',
    'disconnect_count',
    'calibration_status',
  ], 'match quality');

  if (value.schema !== KNOWN_ROUTE_MODE_LEGALITY_QUALITY_SCHEMA
    || !IDENTITY.test(value.semantic_identity || '')
    || !IDENTITY.test(value.route_identity || '')
    || !IDENTITY.test(value.corridor_identity || '')
    || !IDENTITY.test(value.centerline_identity || '')
    || stableText(value.authority) !== stableText(AUTHORITY)
    || stableText(value.privacy) !== stableText(PRIVACY)) {
    throw new Error('Known Route mode legality evidence schema, identity, authority, or privacy boundary is invalid.');
  }

  for (const mode of KNOWN_ROUTE_LEGALITY_MODES) {
    validateModeLegality(value.mode_legality[mode], mode, value);
  }
  validateMatchQuality(value.match_quality);
  if (value.semantic_identity !== semanticIdentityOf(value)) {
    throw new Error('Known Route mode legality evidence semantic identity drifted.');
  }
  rejectPrivateProjection(value);
  return deepFreeze(structuredClone(value));
}

export function createKnownRouteModeRestrictionReceipt({
  sourceId,
  sourceVersion,
  mode,
  routeIdentity,
  corridorIdentity,
  centerlineIdentity,
  encodedEvidence,
} = {}) {
  const receipt = {
    schema: KNOWN_ROUTE_MODE_RESTRICTION_RECEIPT_SCHEMA,
    source_id: sourceId,
    source_version: sourceVersion,
    mode,
    route_identity: routeIdentity,
    corridor_identity: corridorIdentity,
    centerline_identity: centerlineIdentity,
    encoded_evidence: structuredClone(encodedEvidence),
  };
  receipt.receipt_identity = receiptIdentityOf(receipt);
  validateReceiptShape(receipt);
  return deepFreeze(receipt);
}

function admitCoreBinding({ normalizedRoute, catalog, match }) {
  assertSafeData({ normalizedRoute, catalog, match }, 'Known Route legality inputs');
  if (normalizedRoute?.schema !== 'known-route-evidence-request/v1'
    || catalog?.schema !== 'philadelphia-centerline-session-catalog/v1'
    || !IDENTITY.test(normalizedRoute.sessionRouteIdentity || '')
    || !IDENTITY.test(catalog.catalogIdentity || '')
    || catalog.source?.sourceId !== CENTERLINE_SOURCE_ID
    || !SOURCE_VERSION.test(catalog.source?.dataVersion || '')) {
    throw new Error('Known Route legality inputs do not contain an admitted route and centerline catalog.');
  }
  if (!match || !['matched', 'unavailable'].includes(match.status)) {
    throw new Error('Known Route legality input does not contain a bounded map-match result.');
  }
  if (match.status === 'matched'
    && (match.normalizedRoute?.sessionRouteIdentity !== normalizedRoute.sessionRouteIdentity
      || match.catalogIdentity !== catalog.catalogIdentity
      || match.dataVersion !== catalog.source.dataVersion
      || !IDENTITY.test(match.corridorIdentity || ''))) {
    throw new Error('Known Route map-match route, source, centerline, or corridor binding mismatched.');
  }
  const corridorIdentity = match.status === 'matched'
    ? match.corridorIdentity
    : deterministicIdentity('known-route-corridor-unavailable', {
      route_identity: normalizedRoute.sessionRouteIdentity,
      centerline_identity: catalog.catalogIdentity,
      source_version: catalog.source.dataVersion,
      match_reason: typeof match.reason === 'string' ? match.reason : 'map-match-unavailable',
    });
  return Object.freeze({
    routeIdentity: normalizedRoute.sessionRouteIdentity,
    corridorIdentity,
    centerlineIdentity: catalog.catalogIdentity,
    sourceVersion: catalog.source.dataVersion,
  });
}

function admitRestrictionEnvelope(value) {
  if (value === null || value === undefined) return null;
  assertSafeData(value, 'mode restriction evidence');
  if (!isPlainRecord(value)) {
    throw new Error('Mode restriction evidence must be a plain object.');
  }
  exactObject(value, ['schema', 'source_id', 'source_version', 'modes'], 'mode restriction evidence');
  if (!isPlainRecord(value.modes)) {
    throw new Error('Mode restriction evidence modes must be a plain object.');
  }
  for (const mode of Object.keys(value.modes)) {
    if (!KNOWN_ROUTE_LEGALITY_MODES.includes(mode)) {
      throw new Error('Mode restriction evidence contains an unknown mode.');
    }
    if (!isPlainRecord(value.modes[mode])) {
      throw new Error('Mode restriction receipt must be a plain object.');
    }
    const unknown = Object.keys(value.modes[mode]).filter((key) => !RECEIPT_FIELDS.includes(key));
    if (unknown.length) throw new Error('Mode restriction receipt contains unknown fields.');
  }
  return value;
}

function evaluateModeLegality({ mode, binding, envelope }) {
  if (!envelope) return unavailableMode('mode-restriction-source-unavailable');
  if (envelope.schema !== KNOWN_ROUTE_MODE_RESTRICTION_EVIDENCE_SCHEMA
    || !SOURCE_ID.test(envelope.source_id || '')) {
    return unavailableMode('mode-restriction-contract-mismatch');
  }
  if (KNOWN_INSUFFICIENT_RESTRICTION_SOURCES.has(envelope.source_id)) {
    return unavailableMode('mode-restriction-source-insufficient');
  }
  if (typeof envelope.source_version !== 'string' || !envelope.source_version) {
    return unavailableMode('mode-restriction-source-version-missing');
  }
  if (envelope.source_version !== binding.sourceVersion) {
    return unavailableMode('mode-restriction-source-version-mismatch');
  }
  const receipt = envelope.modes[mode];
  if (!receipt) return unavailableMode('mode-restriction-source-unavailable');
  const missing = RECEIPT_FIELDS.filter((field) => !Object.hasOwn(receipt, field));
  if (missing.includes('source_version') || receipt.source_version === '') {
    return unavailableMode('mode-restriction-source-version-missing');
  }
  if (missing.length || !isPlainRecord(receipt.encoded_evidence)) {
    return unavailableMode('incomplete-mode-restriction-evidence');
  }
  if (receipt.schema !== KNOWN_ROUTE_MODE_RESTRICTION_RECEIPT_SCHEMA) {
    return unavailableMode('mode-restriction-contract-mismatch');
  }
  if (receipt.source_id !== envelope.source_id) {
    return unavailableMode('mode-restriction-source-mismatch');
  }
  if (receipt.source_version !== envelope.source_version) {
    return unavailableMode('mode-restriction-source-version-mismatch');
  }
  if (receipt.mode !== mode) return unavailableMode('mode-restriction-mode-mismatch');
  if (receipt.route_identity !== binding.routeIdentity) {
    return unavailableMode('mode-restriction-route-mismatch');
  }
  if (receipt.corridor_identity !== binding.corridorIdentity) {
    return unavailableMode('mode-restriction-corridor-mismatch');
  }
  if (receipt.centerline_identity !== binding.centerlineIdentity) {
    return unavailableMode('mode-restriction-centerline-mismatch');
  }
  const encodedKeys = Object.keys(receipt.encoded_evidence).sort();
  if (stableText(encodedKeys) !== stableText([...ENCODED_FIELDS].sort())
    || ENCODED_FIELDS.some((field) => receipt.encoded_evidence[field] !== true)) {
    return unavailableMode('incomplete-mode-restriction-evidence');
  }
  if (receipt.receipt_identity !== receiptIdentityOf(receipt)) {
    return unavailableMode('mode-restriction-receipt-identity-mismatch');
  }
  return deepFreeze({
    status: 'available',
    reason: 'complete-version-bound-mode-restriction-receipt',
    source_receipt: structuredClone(receipt),
  });
}

function validateModeLegality(value, mode, evidence) {
  if (!isPlainRecord(value)) throw new Error(`Mode legality ${mode} must be a plain object.`);
  if (value.status === 'unavailable') {
    exactObject(value, ['status', 'reason'], `mode legality ${mode}`);
    if (!MODE_UNAVAILABLE_REASONS.has(value.reason)) {
      throw new Error(`Mode legality ${mode} has an unsupported unavailable reason.`);
    }
    return;
  }
  exactObject(value, ['status', 'reason', 'source_receipt'], `mode legality ${mode}`);
  if (value.status !== 'available'
    || value.reason !== 'complete-version-bound-mode-restriction-receipt') {
    throw new Error(`Mode legality ${mode} has an unsupported available state.`);
  }
  validateReceiptShape(value.source_receipt);
  if (value.source_receipt.mode !== mode
    || value.source_receipt.route_identity !== evidence.route_identity
    || value.source_receipt.corridor_identity !== evidence.corridor_identity
    || value.source_receipt.centerline_identity !== evidence.centerline_identity
    || value.source_receipt.source_version !== evidence.match_quality.source_version) {
    throw new Error(`Mode legality ${mode} receipt binding mismatched.`);
  }
}

function validateReceiptShape(receipt) {
  exactObject(receipt, RECEIPT_FIELDS, 'mode restriction source receipt');
  exactObject(receipt.encoded_evidence, ENCODED_FIELDS, 'encoded mode restriction evidence');
  if (receipt.schema !== KNOWN_ROUTE_MODE_RESTRICTION_RECEIPT_SCHEMA
    || !SOURCE_ID.test(receipt.source_id || '')
    || !SOURCE_VERSION.test(receipt.source_version || '')
    || !KNOWN_ROUTE_LEGALITY_MODES.includes(receipt.mode)
    || !IDENTITY.test(receipt.route_identity || '')
    || !IDENTITY.test(receipt.corridor_identity || '')
    || !IDENTITY.test(receipt.centerline_identity || '')
    || !IDENTITY.test(receipt.receipt_identity || '')
    || ENCODED_FIELDS.some((field) => receipt.encoded_evidence[field] !== true)
    || receipt.receipt_identity !== receiptIdentityOf(receipt)) {
    throw new Error('Mode restriction source receipt is incomplete, mismatched, or invalid.');
  }
}

function createMatchQuality(match, sourceVersion) {
  const reason = typeof match.reason === 'string' ? match.reason : null;
  const ambiguous = reason === 'multiple-candidate-ambiguity' ? 1 : 0;
  const offNetwork = reason === 'off-network' ? 1 : 0;
  const disconnected = reason === 'disconnected-centerline-chain' ? 1 : 0;
  let candidateMarginM = null;
  if (ambiguous && Number.isFinite(match.nearestDistanceM)
    && Number.isFinite(match.alternativeDistanceM)) {
    candidateMarginM = boundedRound(
      Math.max(0, match.alternativeDistanceM - match.nearestDistanceM),
    );
  }
  const distance = match.status === 'matched'
    ? match.maximumMatchDistanceM
    : (match.maximumObservedDistanceM ?? match.nearestDistanceM);
  return deepFreeze({
    status: 'unavailable',
    reason: match.status === 'matched'
      ? 'uncalibrated-deterministic-candidate'
      : qualityFailureReason(reason),
    source_id: CENTERLINE_SOURCE_ID,
    source_version: sourceVersion,
    match_status: match.status,
    candidate_margin_m: candidateMarginM,
    maximum_distance_m: Number.isFinite(distance) ? boundedRound(distance) : null,
    ambiguity_count: ambiguous,
    off_network_count: offNetwork,
    disconnect_count: disconnected,
    calibration_status: 'uncalibrated',
  });
}

function validateMatchQuality(value) {
  const validReason = new Set([
    'uncalibrated-deterministic-candidate',
    'ambiguous-map-match-candidate',
    'off-network-map-match-candidate',
    'disconnected-map-match-candidate',
    'map-match-unavailable',
  ]);
  if (value.status !== 'unavailable'
    || !validReason.has(value.reason)
    || value.source_id !== CENTERLINE_SOURCE_ID
    || !SOURCE_VERSION.test(value.source_version || '')
    || !['matched', 'unavailable'].includes(value.match_status)
    || !nullableBoundedNumber(value.candidate_margin_m)
    || !nullableBoundedNumber(value.maximum_distance_m)
    || !binaryCounter(value.ambiguity_count)
    || !binaryCounter(value.off_network_count)
    || !binaryCounter(value.disconnect_count)
    || value.calibration_status !== 'uncalibrated') {
    throw new Error('Map-match quality must remain a bounded, unavailable, uncalibrated aggregate.');
  }
  const expectedCounters = {
    'ambiguous-map-match-candidate': [1, 0, 0],
    'off-network-map-match-candidate': [0, 1, 0],
    'disconnected-map-match-candidate': [0, 0, 1],
    'uncalibrated-deterministic-candidate': [0, 0, 0],
    'map-match-unavailable': [0, 0, 0],
  }[value.reason];
  if (stableText(expectedCounters) !== stableText([
    value.ambiguity_count,
    value.off_network_count,
    value.disconnect_count,
  ]) || (value.match_status === 'matched')
    !== (value.reason === 'uncalibrated-deterministic-candidate')) {
    throw new Error('Map-match quality status and counters are inconsistent.');
  }
}

function qualityFailureReason(reason) {
  if (reason === 'multiple-candidate-ambiguity') return 'ambiguous-map-match-candidate';
  if (reason === 'off-network') return 'off-network-map-match-candidate';
  if (reason === 'disconnected-centerline-chain') return 'disconnected-map-match-candidate';
  return 'map-match-unavailable';
}

function unavailableMode(reason) {
  return Object.freeze({ status: 'unavailable', reason });
}

function semanticIdentityOf(value) {
  const projection = structuredClone(value);
  delete projection.semantic_identity;
  return deterministicIdentity('known-route-mode-legality-quality', projection);
}

function receiptIdentityOf(value) {
  const projection = structuredClone(value);
  delete projection.receipt_identity;
  return deterministicIdentity('mode-restriction-receipt', projection);
}

function rejectPrivateProjection(value) {
  const blocked = /^(coordinates?|geometry|matchedEdges|sourceEdgeKey|edge_ids?|raw_rows?|private_fields?|address|destination|source_record_id)$/i;
  const visit = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    for (const [key, child] of Object.entries(entry)) {
      if (blocked.test(key)) {
        throw new Error('Known Route mode legality evidence contains a prohibited private or route-level field.');
      }
      visit(child);
    }
  };
  visit(value);
}

function assertFiniteNumbers(value, label) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${label} contains NaN or Infinity.`);
  }
  if (!value || typeof value !== 'object') return;
  for (const child of Object.values(value)) assertFiniteNumbers(child, label);
}

function exactObject(value, keys, label) {
  if (!isPlainRecord(value)
    || stableText(Object.keys(value).sort()) !== stableText([...keys].sort())) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableText(value) {
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableText(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function nullableBoundedNumber(value) {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 100_000);
}

function binaryCounter(value) {
  return value === 0 || value === 1;
}

function boundedRound(value) {
  return Math.min(100_000, Math.round((value + Number.EPSILON) * 100) / 100);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
