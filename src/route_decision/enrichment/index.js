import {
  ROUTE_DECISION_SCHEMA_VERSIONS,
  ROUTE_OBSERVATION_TAGS,
  admitRouteCandidateFacts,
  admitSourceObservation,
} from '../contracts/index.js';
import {
  ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS,
  admitRouteCandidateSearchRequest,
  admitRouteCandidateSearchResult,
} from '../contracts/candidate_search_v2.js';

const MAX_ID_LENGTH = 120;
const MAX_CANDIDATES = 16;
const MAX_EDGE_OBSERVATIONS = 250_000;
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,119})$/;
const BLOCKED_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const FACTOR_SET = new Set(ROUTE_OBSERVATION_TAGS);
const FACTOR_ORDER = new Map(ROUTE_OBSERVATION_TAGS.map((factorId, index) => [factorId, index]));
const SEARCH_CAPABILITY_FACTOR_SET = new Set(ROUTE_SEARCH_ADMISSIBLE_FACTOR_IDS);
const SOURCE_STATES = new Set([
  'observed',
  'zero',
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
  'missing',
]);
const UNRESOLVED_PRECEDENCE = Object.freeze([
  'invalid',
  'unavailable',
  'partial',
  'stale',
  'unknown',
  'missing',
]);
const UNRESOLVED_REASON_BY_STATE = Object.freeze({
  unknown: 'not-observed',
  unavailable: 'source-unavailable',
  partial: 'coverage-partial',
  stale: 'observation-stale',
  invalid: 'source-invalid',
});

export const ROUTE_ENRICHMENT_SCHEMA_VERSIONS = Object.freeze({
  syntheticSource: 'engagement-route-synthetic-observation-source/v1',
  sourceReceipt: 'engagement-route-enrichment-source-receipt/v1',
  sourceIdentityBinding: 'engagement-route-enrichment-source-identity-binding/v1',
  searchEvidence: 'engagement-route-search-evidence/v1',
  candidateBatchResult: 'engagement-route-candidate-enrichment-result/v2',
  searchResult: 'engagement-route-search-enrichment-result/v3',
});

export const ROUTE_ENRICHMENT_AGGREGATION_VERSION =
  'every-directed-edge-complete-evidence/v1';

export const ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY = Object.freeze({
  version: 'route-search-edge-aggregation-source-identity/v1',
  sourceId: 'synthetic-route-search-edge-aggregation',
});

function fail(message) {
  throw new TypeError(`route decision enrichment: ${message}`);
}

function inspectPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of ownKeys) {
    if (!Object.hasOwn(descriptors[key], 'value')) {
      fail(`${label} must contain data properties only`);
    }
  }
  return { ownKeys, descriptors };
}

function exactObject(value, label, requiredKeys) {
  const { ownKeys, descriptors } = inspectPlainObject(value, label);
  const allowed = new Set(requiredKeys);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(descriptors, key));
  const unknown = ownKeys.filter((key) => !allowed.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} schema mismatch (missing: ${missing.join(',') || 'none'}; unknown: ${unknown.join(',') || 'none'})`);
  }
  return Object.fromEntries(requiredKeys.map((key) => [key, descriptors[key].value]));
}

function strictArray(value, label, { max } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be an array`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must not contain symbol properties`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || (max !== undefined && length > max)) {
    fail(`${label} length is outside the supported range`);
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor) fail(`${label} must not contain sparse entries`);
    if (!Object.hasOwn(descriptor, 'value')) {
      fail(`${label} must contain data properties only`);
    }
    items.push(descriptor.value);
  }
  const extra = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
  if (extra.length) fail(`${label} contains unsupported properties`);
  return items;
}

function boundedId(value, label) {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value) || BLOCKED_PROPERTY_NAMES.has(value)) {
    fail(`${label} must be a bounded canonical id`);
  }
  return value;
}

function syntheticId(value, label) {
  const id = boundedId(value, label);
  if (!id.startsWith('synthetic-')) fail(`${label} must identify a synthetic source`);
  return id;
}

function boundedText(value, label, { nullable = false, max = 2_048 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(`${label} must be ${nullable ? 'null or ' : ''}bounded text`);
  }
  return value;
}

function canonicalTimestampOrNull(value, label) {
  if (value === null) return null;
  const text = boundedText(value, label, { max: 64 });
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(text);
  if (!match) {
    fail(`${label} must be null or a canonical ISO timestamp`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) {
    fail(`${label} must be null or a canonical ISO timestamp`);
  }
  return text;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function admitReceipt(raw, sourceId) {
  const value = exactObject(raw, 'SyntheticObservationSource.receipt', [
    'schemaVersion',
    'sourceId',
    'artifactVersion',
    'dataClassification',
    'sourceAsOf',
    'retrievedAt',
    'builtAt',
    'observedAt',
    'mappingPolicyVersion',
    'coverage',
    'limitations',
  ]);
  if (value.schemaVersion !== ROUTE_ENRICHMENT_SCHEMA_VERSIONS.sourceReceipt) {
    fail('SyntheticObservationSource.receipt.schemaVersion is unsupported');
  }
  if (syntheticId(value.sourceId, 'SyntheticObservationSource.receipt.sourceId') !== sourceId) {
    fail('SyntheticObservationSource receipt sourceId must match sourceId');
  }
  if (value.dataClassification !== 'synthetic') {
    fail('SyntheticObservationSource receipt must be synthetic');
  }
  const coverage = exactObject(value.coverage, 'SyntheticObservationSource.receipt.coverage', [
    'graphId',
    'edgeIds',
  ]);
  const edgeIds = strictArray(coverage.edgeIds, 'SyntheticObservationSource.receipt.coverage.edgeIds', {
    max: MAX_EDGE_OBSERVATIONS,
  }).map((edgeId, index) => boundedId(
    edgeId,
    `SyntheticObservationSource.receipt.coverage.edgeIds[${index}]`,
  )).sort();
  if (new Set(edgeIds).size !== edgeIds.length) {
    fail('SyntheticObservationSource receipt coverage edgeIds must be unique');
  }
  const limitations = strictArray(
    value.limitations,
    'SyntheticObservationSource.receipt.limitations',
    { max: 32 },
  ).map((item, index) => boundedText(
    item,
    `SyntheticObservationSource.receipt.limitations[${index}]`,
    { max: 500 },
  ));
  if (limitations.length === 0) {
    fail('SyntheticObservationSource.receipt.limitations must not be empty');
  }
  return {
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.sourceReceipt,
    sourceId,
    artifactVersion: boundedId(
      value.artifactVersion,
      'SyntheticObservationSource.receipt.artifactVersion',
    ),
    dataClassification: 'synthetic',
    sourceAsOf: canonicalTimestampOrNull(
      value.sourceAsOf,
      'SyntheticObservationSource.receipt.sourceAsOf',
    ),
    retrievedAt: canonicalTimestampOrNull(
      value.retrievedAt,
      'SyntheticObservationSource.receipt.retrievedAt',
    ),
    builtAt: canonicalTimestampOrNull(
      value.builtAt,
      'SyntheticObservationSource.receipt.builtAt',
    ),
    observedAt: canonicalTimestampOrNull(
      value.observedAt,
      'SyntheticObservationSource.receipt.observedAt',
    ),
    mappingPolicyVersion: boundedId(
      value.mappingPolicyVersion,
      'SyntheticObservationSource.receipt.mappingPolicyVersion',
    ),
    coverage: {
      graphId: boundedId(coverage.graphId, 'SyntheticObservationSource.receipt.coverage.graphId'),
      edgeIds,
    },
    limitations,
  };
}

function admitEdgeObservation(raw, index, sourceId, labelOverride = null) {
  const label = labelOverride || `SyntheticObservationSource.edgeObservations[${index}]`;
  const value = exactObject(raw, label, [
    'edgeId',
    'factorId',
    'state',
    'value',
    'unit',
    'reasonCode',
  ]);
  const factorId = boundedId(value.factorId, `${label}.factorId`);
  if (!FACTOR_SET.has(factorId)) fail(`${label}.factorId is unsupported`);
  if (!SOURCE_STATES.has(value.state)) fail(`${label}.state is unsupported`);
  const unit = factorId === 'stairs-count' ? 'count' : 'boolean';
  if (value.unit !== unit) fail(`${label}.unit must be ${unit}`);
  if (value.state === 'missing') {
    if (value.value !== null || value.reasonCode !== 'field-missing') {
      fail(`${label}.missing must carry null and field-missing`);
    }
  } else {
    admitSourceObservation({
      schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
      factorId,
      state: value.state,
      value: value.value,
      unit,
      reasonCode: value.reasonCode,
      sourceId,
    });
  }
  return {
    edgeId: boundedId(value.edgeId, `${label}.edgeId`),
    factorId,
    state: value.state,
    value: value.state === 'missing' ? null : value.value,
    unit,
    reasonCode: value.state === 'missing' ? 'field-missing' : value.reasonCode,
  };
}

export function admitSyntheticObservationSource(raw) {
  const value = exactObject(raw, 'SyntheticObservationSource', [
    'schemaVersion',
    'sourceId',
    'receipt',
    'edgeObservations',
  ]);
  if (value.schemaVersion !== ROUTE_ENRICHMENT_SCHEMA_VERSIONS.syntheticSource) {
    fail('SyntheticObservationSource.schemaVersion is unsupported');
  }
  const sourceId = syntheticId(value.sourceId, 'SyntheticObservationSource.sourceId');
  const receipt = admitReceipt(value.receipt, sourceId);
  const edgeObservations = strictArray(
    value.edgeObservations,
    'SyntheticObservationSource.edgeObservations',
    { max: MAX_EDGE_OBSERVATIONS },
  ).map((observation, index) => admitEdgeObservation(observation, index, sourceId));
  const coveredEdges = new Set(receipt.coverage.edgeIds);
  const identities = new Set();
  for (const observation of edgeObservations) {
    if (!coveredEdges.has(observation.edgeId)) {
      fail('SyntheticObservationSource observation edgeId is outside receipt coverage');
    }
    const identity = `${observation.edgeId}\u0000${observation.factorId}`;
    if (identities.has(identity)) {
      fail('SyntheticObservationSource edge/factor observations must be unique');
    }
    identities.add(identity);
  }
  edgeObservations.sort((left, right) => (
    left.edgeId < right.edgeId ? -1
      : left.edgeId > right.edgeId ? 1
        : FACTOR_ORDER.get(left.factorId) - FACTOR_ORDER.get(right.factorId)
  ));
  return deepFreeze({
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.syntheticSource,
    sourceId,
    receipt,
    edgeObservations,
  });
}

function edgeObservationIndex(source) {
  return new Map(source.edgeObservations.map((observation) => [
    `${observation.edgeId}\u0000${observation.factorId}`,
    observation,
  ]));
}

function toSearchObservation(observation, sourceId) {
  return admitSourceObservation({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId: observation.factorId,
    state: observation.state,
    value: observation.value,
    unit: 'boolean',
    reasonCode: observation.reasonCode,
    sourceId,
  });
}

export function projectSyntheticSearchEvidence(raw) {
  const value = exactObject(raw, 'SyntheticSearchEvidenceProjection', [
    'source',
    'request',
  ]);
  const source = admitSyntheticObservationSource(value.source);
  const request = admitRouteCandidateSearchRequest(value.request);
  if (source.receipt.coverage.graphId !== request.graphId) {
    fail('source receipt graphId must match search request graphId');
  }

  const requestedFactorIds = new Set(
    request.hardConstraints.map(({ factorId }) => factorId),
  );
  const edgeObservationsByEdgeId = {};
  for (const observation of source.edgeObservations) {
    if (!requestedFactorIds.has(observation.factorId) || observation.state === 'missing') {
      continue;
    }
    edgeObservationsByEdgeId[observation.edgeId] ||= {};
    edgeObservationsByEdgeId[observation.edgeId][observation.factorId] =
      toSearchObservation(observation, source.sourceId);
  }

  return deepFreeze({
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.searchEvidence,
    graphId: request.graphId,
    requestIdentity: {
      requestId: request.requestId,
      hardConstraints: request.hardConstraints.map(({ constraintId, factorId }) => ({
        constraintId,
        factorId,
      })),
    },
    sourceReceipt: structuredClone(source.receipt),
    edgeObservationsByEdgeId,
  });
}

function mappedMissing(edgeId, factorId) {
  return Object.freeze({
    edgeId,
    factorId,
    state: 'missing',
    value: null,
    unit: factorId === 'stairs-count' ? 'count' : 'boolean',
    reasonCode: 'field-missing',
  });
}

function aggregateBoolean(evidence) {
  if (evidence.length === 0) return { state: 'missing', value: null };
  const explicitFalse = evidence.find(({ state, value }) => state === 'observed' && value === false);
  if (explicitFalse) return { state: 'observed', value: false };
  for (const state of UNRESOLVED_PRECEDENCE) {
    if (evidence.some((item) => item.state === state)) return { state, value: null };
  }
  if (evidence.every(({ state, value }) => state === 'observed' && value === true)) {
    return { state: 'observed', value: true };
  }
  return { state: 'invalid', value: null };
}

function aggregateCount(evidence) {
  if (evidence.length === 0) return { state: 'missing', value: null };
  for (const state of UNRESOLVED_PRECEDENCE) {
    if (evidence.some((item) => item.state === state)) return { state, value: null };
  }
  if (!evidence.every(({ state }) => state === 'observed' || state === 'zero')) {
    return { state: 'invalid', value: null };
  }
  const total = evidence.reduce((sum, item) => sum + item.value, 0);
  if (!Number.isSafeInteger(total)) return { state: 'invalid', value: null };
  return total === 0 ? { state: 'zero', value: 0 } : { state: 'observed', value: total };
}

function toPublicObservation(factorId, aggregate, sourceId) {
  if (aggregate.state === 'missing') return null;
  const unit = factorId === 'stairs-count' ? 'count' : 'boolean';
  return admitSourceObservation({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.sourceObservation,
    factorId,
    state: aggregate.state,
    value: aggregate.value,
    unit,
    reasonCode: ['observed', 'zero'].includes(aggregate.state)
      ? null
      : UNRESOLVED_REASON_BY_STATE[aggregate.state],
    sourceId,
  });
}

function sameObservationSemantics(left, right) {
  return left.schemaVersion === right.schemaVersion
    && left.factorId === right.factorId
    && left.state === right.state
    && left.value === right.value
    && left.unit === right.unit
    && left.reasonCode === right.reasonCode;
}

function sourceIdentityBinding(sourceId) {
  return {
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.sourceIdentityBinding,
    outputSourceId: sourceId,
    acceptedInputSourceIds: [
      sourceId,
      ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId,
    ],
    aggregateIdentityVersion: ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.version,
  };
}

function candidateAudit(candidate, source, index) {
  const factorIds = [...FACTOR_ORDER.keys()];
  const observations = {};
  const factors = [];
  for (const factorId of factorIds) {
    const edgeEvidence = candidate.edgeIds.map((edgeId) => (
      index.get(`${edgeId}\u0000${factorId}`) || mappedMissing(edgeId, factorId)
    ));
    const aggregate = factorId === 'stairs-count'
      ? aggregateCount(edgeEvidence)
      : aggregateBoolean(edgeEvidence);
    const publicObservation = toPublicObservation(factorId, aggregate, source.sourceId);
    const existingObservation = candidate.observations[factorId];
    if (existingObservation) {
      const allowedSourceIds = new Set([source.sourceId]);
      if (SEARCH_CAPABILITY_FACTOR_SET.has(factorId)
        && existingObservation.state === 'observed'
        && existingObservation.value === true) {
        allowedSourceIds.add(ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId);
      }
      if (!publicObservation
        || !sameObservationSemantics(existingObservation, publicObservation)
        || !allowedSourceIds.has(existingObservation.sourceId)) {
        fail(`candidate ${candidate.candidateId} existing ${factorId} observation conflicts with source`);
      }
    }
    if (publicObservation) observations[factorId] = publicObservation;
    factors.push({
      factorId,
      state: aggregate.state,
      value: aggregate.value,
      unit: factorId === 'stairs-count' ? 'count' : 'boolean',
      reasonCode: ['observed', 'zero'].includes(aggregate.state)
        ? null
        : aggregate.state === 'missing'
          ? 'field-missing'
          : UNRESOLVED_REASON_BY_STATE[aggregate.state],
      inputSourceId: existingObservation?.sourceId ?? null,
      outputSourceId: publicObservation?.sourceId ?? null,
      edgeEvidence: edgeEvidence.map((item) => ({ ...item })),
    });
  }
  const enrichedCandidate = admitRouteCandidateFacts({
    schemaVersion: candidate.schemaVersion,
    candidateId: candidate.candidateId,
    edgeIds: [...candidate.edgeIds],
    distanceMm: candidate.distanceMm,
    objectiveCostUnits: candidate.objectiveCostUnits,
    observations,
    provenance: { ...candidate.provenance },
    ...(candidate.geometry ? { geometry: structuredClone(candidate.geometry) } : {}),
  });
  return {
    inputCandidate: candidate,
    enrichedCandidate,
    audit: { candidateId: candidate.candidateId, factors },
  };
}

function enrichCandidates(rawCandidates, graphId, source) {
  if (source.receipt.coverage.graphId !== graphId) {
    fail('source receipt graphId must match candidate graphId');
  }
  const candidates = strictArray(rawCandidates, 'RouteCandidateEnrichment.candidateFacts', {
    max: MAX_CANDIDATES,
  }).map((candidate) => admitRouteCandidateFacts(candidate));
  const candidateIds = candidates.map(({ candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    fail('candidate facts candidateIds must be unique');
  }
  if (candidates.some(({ provenance }) => provenance.graphId !== graphId)) {
    fail('candidate facts graphId must match requested graphId');
  }
  const coveredEdges = new Set(source.receipt.coverage.edgeIds);
  const candidateEdges = new Set(candidates.flatMap(({ edgeIds }) => edgeIds));
  for (const edgeId of candidateEdges) {
    if (!coveredEdges.has(edgeId)) fail('source receipt does not cover every candidate edge');
  }
  const index = edgeObservationIndex(source);
  return candidates.map((candidate) => candidateAudit(candidate, source, index));
}

function admitEnvelopeReceipt(raw) {
  const value = exactObject(raw, 'RouteCandidateEnrichmentResult.sourceReceipt', [
    'schemaVersion',
    'sourceId',
    'artifactVersion',
    'dataClassification',
    'sourceAsOf',
    'retrievedAt',
    'builtAt',
    'observedAt',
    'mappingPolicyVersion',
    'coverage',
    'limitations',
  ]);
  const sourceId = syntheticId(
    value.sourceId,
    'RouteCandidateEnrichmentResult.sourceReceipt.sourceId',
  );
  return admitReceipt(raw, sourceId);
}

function admitSourceIdentityBinding(raw, sourceId) {
  const value = exactObject(raw, 'RouteCandidateEnrichmentResult.sourceIdentityBinding', [
    'schemaVersion',
    'outputSourceId',
    'acceptedInputSourceIds',
    'aggregateIdentityVersion',
  ]);
  const expected = sourceIdentityBinding(sourceId);
  const acceptedInputSourceIds = strictArray(
    value.acceptedInputSourceIds,
    'RouteCandidateEnrichmentResult.sourceIdentityBinding.acceptedInputSourceIds',
    { max: 2 },
  ).map((item, index) => syntheticId(
    item,
    `RouteCandidateEnrichmentResult.sourceIdentityBinding.acceptedInputSourceIds[${index}]`,
  ));
  if (value.schemaVersion !== expected.schemaVersion
    || value.outputSourceId !== expected.outputSourceId
    || value.aggregateIdentityVersion !== expected.aggregateIdentityVersion
    || acceptedInputSourceIds.length !== expected.acceptedInputSourceIds.length
    || !acceptedInputSourceIds.every(
      (item, index) => item === expected.acceptedInputSourceIds[index],
    )) {
    fail('source identity binding must exactly match the admitted source receipt');
  }
  return expected;
}

function admitEnrichedCandidateFacts(raw, label) {
  const candidates = strictArray(raw, label, { max: MAX_CANDIDATES })
    .map((candidate) => admitRouteCandidateFacts(candidate));
  const candidateIds = candidates.map(({ candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    fail(`${label} candidateIds must be unique`);
  }
  return candidates;
}

function expectedAuditReason(state) {
  if (state === 'observed' || state === 'zero') return null;
  if (state === 'missing') return 'field-missing';
  return UNRESOLVED_REASON_BY_STATE[state];
}

function admitCandidateAuditFactor(
  raw,
  auditIndex,
  factorIndex,
  inputCandidate,
  candidate,
  receipt,
) {
  const label = `RouteCandidateEnrichmentResult.candidateAudits[${auditIndex}].factors[${factorIndex}]`;
  const value = exactObject(raw, label, [
    'factorId',
    'state',
    'value',
    'unit',
    'reasonCode',
    'inputSourceId',
    'outputSourceId',
    'edgeEvidence',
  ]);
  const factorId = [...FACTOR_ORDER.keys()][factorIndex];
  if (value.factorId !== factorId) {
    fail(`${label}.factorId must follow canonical factor order`);
  }
  const edgeEvidence = strictArray(value.edgeEvidence, `${label}.edgeEvidence`, {
    max: MAX_EDGE_OBSERVATIONS,
  }).map((item, evidenceIndex) => admitEdgeObservation(
    item,
    evidenceIndex,
    receipt.sourceId,
    `${label}.edgeEvidence[${evidenceIndex}]`,
  ));
  if (edgeEvidence.length !== candidate.edgeIds.length
    || !edgeEvidence.every((item, index) => (
      item.edgeId === candidate.edgeIds[index] && item.factorId === factorId
    ))) {
    fail(`${label}.edgeEvidence must exactly bind the candidate edge sequence and factor`);
  }

  const aggregate = factorId === 'stairs-count'
    ? aggregateCount(edgeEvidence)
    : aggregateBoolean(edgeEvidence);
  const unit = factorId === 'stairs-count' ? 'count' : 'boolean';
  const reasonCode = expectedAuditReason(aggregate.state);
  if (value.state !== aggregate.state
    || value.value !== aggregate.value
    || value.unit !== unit
    || value.reasonCode !== reasonCode) {
    fail(`${label} aggregate fields drift from edge evidence`);
  }

  const publicObservation = toPublicObservation(factorId, aggregate, receipt.sourceId);
  const candidateObservation = candidate.observations[factorId];
  if (publicObservation) {
    if (!candidateObservation
      || candidateObservation.sourceId !== receipt.sourceId
      || !sameObservationSemantics(candidateObservation, publicObservation)) {
      fail(`${label} aggregate must exactly match the enriched candidate observation`);
    }
  } else if (candidateObservation) {
    fail(`${label} missing aggregate must remain omitted from candidate observations`);
  }

  const inputObservation = inputCandidate.observations[factorId];
  if (inputObservation) {
    const aggregateInputAllowed = SEARCH_CAPABILITY_FACTOR_SET.has(factorId)
      && inputObservation.state === 'observed'
      && inputObservation.value === true
      && inputObservation.sourceId
        === ROUTE_ENRICHMENT_SEARCH_AGGREGATE_SOURCE_IDENTITY.sourceId;
    if (!publicObservation
      || !sameObservationSemantics(inputObservation, publicObservation)
      || (inputObservation.sourceId !== receipt.sourceId && !aggregateInputAllowed)) {
      fail(`${label}.inputCandidateFacts observation conflicts with edge evidence`);
    }
  }
  const expectedInputSourceId = inputObservation?.sourceId ?? null;
  const inputSourceId = value.inputSourceId === null
    ? null
    : syntheticId(value.inputSourceId, `${label}.inputSourceId`);
  if (inputSourceId !== expectedInputSourceId) {
    fail(`${label}.inputSourceId must match inputCandidateFacts`);
  }
  const outputSourceId = value.outputSourceId === null
    ? null
    : syntheticId(value.outputSourceId, `${label}.outputSourceId`);
  const expectedOutputSourceId = publicObservation ? receipt.sourceId : null;
  if (outputSourceId !== expectedOutputSourceId) {
    fail(`${label}.outputSourceId must match the enriched candidate observation`);
  }

  return {
    factorId,
    state: aggregate.state,
    value: aggregate.value,
    unit,
    reasonCode,
    inputSourceId,
    outputSourceId,
    edgeEvidence,
  };
}

function admitCandidateAudits(raw, inputCandidates, candidates, receipt) {
  const rawAudits = strictArray(
    raw,
    'RouteCandidateEnrichmentResult.candidateAudits',
    { max: MAX_CANDIDATES },
  );
  if (rawAudits.length !== candidates.length || inputCandidates.length !== candidates.length) {
    fail('candidate audits must exactly match candidate count');
  }
  return rawAudits.map((rawAudit, auditIndex) => {
    const label = `RouteCandidateEnrichmentResult.candidateAudits[${auditIndex}]`;
    const value = exactObject(rawAudit, label, ['candidateId', 'factors']);
    const inputCandidate = inputCandidates[auditIndex];
    const candidate = candidates[auditIndex];
    if (boundedId(value.candidateId, `${label}.candidateId`) !== candidate.candidateId) {
      fail(`${label}.candidateId must match candidate order`);
    }
    const rawFactors = strictArray(value.factors, `${label}.factors`, {
      max: FACTOR_ORDER.size,
    });
    if (rawFactors.length !== FACTOR_ORDER.size) {
      fail(`${label}.factors must contain every controlled factor`);
    }
    return {
      candidateId: candidate.candidateId,
      factors: rawFactors.map((factor, factorIndex) => admitCandidateAuditFactor(
        factor,
        auditIndex,
        factorIndex,
        inputCandidate,
        candidate,
        receipt,
      )),
    };
  });
}

function sameDataTree(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameDataTree(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && sameDataTree(left[key], right[key])
    ));
}

function assertCandidateTransformationBindings(inputCandidates, candidates) {
  if (inputCandidates.length !== candidates.length) {
    fail('inputCandidateFacts must exactly match enriched candidate count');
  }
  for (let index = 0; index < candidates.length; index += 1) {
    const input = inputCandidates[index];
    const output = candidates[index];
    if (input.schemaVersion !== output.schemaVersion
      || input.candidateId !== output.candidateId
      || input.distanceMm !== output.distanceMm
      || input.objectiveCostUnits !== output.objectiveCostUnits
      || !sameDataTree(input.edgeIds, output.edgeIds)
      || !sameDataTree(input.provenance, output.provenance)
      || !sameDataTree(input.geometry ?? null, output.geometry ?? null)) {
      fail('inputCandidateFacts must preserve candidate route identity and provenance');
    }
  }
}

function assertEnrichmentEnvelopeBindings(graphId, candidates, receipt) {
  if (receipt.coverage.graphId !== graphId) {
    fail('source receipt graphId must match enriched candidate graphId');
  }
  const coveredEdges = new Set(receipt.coverage.edgeIds);
  for (const candidate of candidates) {
    if (candidate.provenance.graphId !== graphId) {
      fail('enriched candidate graphId must match envelope graphId');
    }
    for (const edgeId of candidate.edgeIds) {
      if (!coveredEdges.has(edgeId)) {
        fail('source receipt must cover every enriched candidate edge');
      }
    }
  }
}

export function admitRouteCandidateEnrichmentResult(raw) {
  const value = exactObject(raw, 'RouteCandidateEnrichmentResult', [
    'schemaVersion',
    'aggregationVersion',
    'graphId',
    'inputCandidateFacts',
    'candidateFacts',
    'sourceReceipt',
    'sourceIdentityBinding',
    'candidateAudits',
  ]);
  if (value.schemaVersion !== ROUTE_ENRICHMENT_SCHEMA_VERSIONS.candidateBatchResult) {
    fail('RouteCandidateEnrichmentResult.schemaVersion is unsupported');
  }
  if (value.aggregationVersion !== ROUTE_ENRICHMENT_AGGREGATION_VERSION) {
    fail('RouteCandidateEnrichmentResult.aggregationVersion is unsupported');
  }
  const graphId = boundedId(value.graphId, 'RouteCandidateEnrichmentResult.graphId');
  const inputCandidates = admitEnrichedCandidateFacts(
    value.inputCandidateFacts,
    'RouteCandidateEnrichmentResult.inputCandidateFacts',
  );
  const candidates = admitEnrichedCandidateFacts(
    value.candidateFacts,
    'RouteCandidateEnrichmentResult.candidateFacts',
  );
  assertCandidateTransformationBindings(inputCandidates, candidates);
  const receipt = admitEnvelopeReceipt(value.sourceReceipt);
  const identityBinding = admitSourceIdentityBinding(
    value.sourceIdentityBinding,
    receipt.sourceId,
  );
  assertEnrichmentEnvelopeBindings(graphId, candidates, receipt);
  const candidateAudits = admitCandidateAudits(
    value.candidateAudits,
    inputCandidates,
    candidates,
    receipt,
  );
  return deepFreeze({
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.candidateBatchResult,
    aggregationVersion: ROUTE_ENRICHMENT_AGGREGATION_VERSION,
    graphId,
    inputCandidateFacts: inputCandidates,
    candidateFacts: candidates,
    sourceReceipt: receipt,
    sourceIdentityBinding: identityBinding,
    candidateAudits,
  });
}

export function admitRouteCandidateSearchEnrichmentResult(raw) {
  const value = exactObject(raw, 'RouteCandidateSearchEnrichmentResult', [
    'schemaVersion',
    'aggregationVersion',
    'inputCandidateFacts',
    'searchResult',
    'sourceReceipt',
    'sourceIdentityBinding',
    'candidateAudits',
  ]);
  if (value.schemaVersion !== ROUTE_ENRICHMENT_SCHEMA_VERSIONS.searchResult) {
    fail('RouteCandidateSearchEnrichmentResult.schemaVersion is unsupported');
  }
  if (value.aggregationVersion !== ROUTE_ENRICHMENT_AGGREGATION_VERSION) {
    fail('RouteCandidateSearchEnrichmentResult.aggregationVersion is unsupported');
  }
  const searchResult = admitRouteCandidateSearchResult(value.searchResult);
  if (!searchResult.request || !searchResult.candidateSet) {
    fail('RouteCandidateSearchEnrichmentResult must contain a searched result');
  }
  const inputCandidates = admitEnrichedCandidateFacts(
    value.inputCandidateFacts,
    'RouteCandidateSearchEnrichmentResult.inputCandidateFacts',
  );
  assertCandidateTransformationBindings(inputCandidates, searchResult.candidateFacts);
  const receipt = admitEnvelopeReceipt(value.sourceReceipt);
  const identityBinding = admitSourceIdentityBinding(
    value.sourceIdentityBinding,
    receipt.sourceId,
  );
  assertEnrichmentEnvelopeBindings(
    searchResult.request.graphId,
    searchResult.candidateFacts,
    receipt,
  );
  const candidateAudits = admitCandidateAudits(
    value.candidateAudits,
    inputCandidates,
    searchResult.candidateFacts,
    receipt,
  );
  return deepFreeze({
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.searchResult,
    aggregationVersion: ROUTE_ENRICHMENT_AGGREGATION_VERSION,
    inputCandidateFacts: inputCandidates,
    searchResult,
    sourceReceipt: receipt,
    sourceIdentityBinding: identityBinding,
    candidateAudits,
  });
}

export function enrichRouteCandidateFacts(raw) {
  const value = exactObject(raw, 'RouteCandidateEnrichment', [
    'graphId',
    'candidateFacts',
    'source',
  ]);
  const graphId = boundedId(value.graphId, 'RouteCandidateEnrichment.graphId');
  const source = admitSyntheticObservationSource(value.source);
  const enriched = enrichCandidates(value.candidateFacts, graphId, source);
  return deepFreeze({
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.candidateBatchResult,
    aggregationVersion: ROUTE_ENRICHMENT_AGGREGATION_VERSION,
    graphId,
    inputCandidateFacts: enriched.map(({ inputCandidate }) => inputCandidate),
    candidateFacts: enriched.map(({ enrichedCandidate }) => enrichedCandidate),
    sourceReceipt: structuredClone(source.receipt),
    sourceIdentityBinding: sourceIdentityBinding(source.sourceId),
    candidateAudits: enriched.map(({ audit }) => audit),
  });
}

export function enrichRouteCandidateSearchResult(raw) {
  const value = exactObject(raw, 'RouteCandidateSearchEnrichment', ['searchResult', 'source']);
  const admittedSearchResult = admitRouteCandidateSearchResult(value.searchResult);
  const admittedSource = admitSyntheticObservationSource(value.source);
  if (!admittedSearchResult.request || !admittedSearchResult.candidateSet) {
    fail('only searched CandidateSearchResult values can be enriched');
  }
  const enriched = enrichCandidates(
    admittedSearchResult.candidateFacts,
    admittedSearchResult.request.graphId,
    admittedSource,
  );
  const nextSearchResult = admitRouteCandidateSearchResult({
    schemaVersion: admittedSearchResult.schemaVersion,
    status: admittedSearchResult.status,
    termination: admittedSearchResult.termination,
    request: admittedSearchResult.request,
    candidateSet: admittedSearchResult.candidateSet,
    candidateFacts: enriched.map(({ enrichedCandidate }) => enrichedCandidate),
  });
  return deepFreeze({
    schemaVersion: ROUTE_ENRICHMENT_SCHEMA_VERSIONS.searchResult,
    aggregationVersion: ROUTE_ENRICHMENT_AGGREGATION_VERSION,
    inputCandidateFacts: enriched.map(({ inputCandidate }) => inputCandidate),
    searchResult: nextSearchResult,
    sourceReceipt: structuredClone(admittedSource.receipt),
    sourceIdentityBinding: sourceIdentityBinding(admittedSource.sourceId),
    candidateAudits: enriched.map(({ audit }) => audit),
  });
}
