const BASIS_POINTS_TOTAL = 10_000;
const DECISION_RESULT_SCHEMA_VERSION = 'route-decision-result/v1';
const MAX_SCORING_ABSOLUTE_VALUE = Math.floor(
  Number.MAX_SAFE_INTEGER / (BASIS_POINTS_TOTAL * 2),
);

const KNOWN_OBSERVATION_STATE = 'known';
const NON_KNOWN_OBSERVATION_STATES = new Set([
  'unknown',
  'unavailable',
  'partial',
  'stale',
  'invalid',
  'malformed',
  'unsupported',
  'missing',
]);
const FORBIDDEN_FACTOR_TOKENS = new Set([
  'crime',
  'hin',
  'acs',
  'diary',
  'safety',
  'safer',
  'safest',
  'risk',
]);
const FORBIDDEN_FACTOR_COMPOUNDS = [
  'highinjurynetwork',
  'americacommunitysurvey',
  'realestate',
  'houseprice',
  'housingprice',
  'propertyvalue',
];
const HARD_OPERATORS = new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']);
const SOFT_DIRECTIONS = new Set(['minimize', 'maximize']);
const TIE_BREAK_FIELDS = new Set([
  'scoreUnits',
  'distanceMm',
  'objectiveCostUnits',
  'candidateId',
]);

function compareCodeUnits(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
}

function compareNumbers(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return ownKeys.every((key) => Object.hasOwn(descriptors[key], 'value'));
  } catch {
    return false;
  }
}

function isDataArray(value) {
  if (!Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(descriptors, String(index))
        || !Object.hasOwn(descriptors[String(index)], 'value')) return false;
    }
    return ownKeys.every((key) => key === 'length'
      || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
  } catch {
    return false;
  }
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function isNonEmptyId(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function factorIdParts(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isForbiddenFactorId(factorId) {
  const parts = factorIdParts(factorId);
  const compact = parts.join('');
  return parts.some((part) => FORBIDDEN_FACTOR_TOKENS.has(part))
    || FORBIDDEN_FACTOR_COMPOUNDS.some((compound) => compact.includes(compound));
}

function invalidPolicy(reasonCode, details = {}) {
  return Object.freeze({ ok: false, reasonCode, details: Object.freeze({ ...details }) });
}

function validateUniqueRuleIds(rules) {
  const seen = new Set();
  for (const rule of rules) {
    if (!isPlainRecord(rule) || !isNonEmptyId(rule.id)) {
      return invalidPolicy('policy_rule_id_invalid');
    }
    if (seen.has(rule.id)) {
      return invalidPolicy('policy_rule_id_duplicate', { ruleId: rule.id });
    }
    seen.add(rule.id);
  }
  return Object.freeze({ ok: true });
}

function validateTieBreak(tieBreak) {
  if (!isDataArray(tieBreak) || tieBreak.length < 2) {
    return invalidPolicy('policy_tie_break_invalid');
  }
  const normalized = [];
  const seen = new Set();
  for (const entry of tieBreak) {
    if (!isPlainRecord(entry)
      || !TIE_BREAK_FIELDS.has(entry.field)
      || !['asc', 'desc'].includes(entry.direction)
      || seen.has(entry.field)) {
      return invalidPolicy('policy_tie_break_invalid');
    }
    seen.add(entry.field);
    normalized.push(Object.freeze({ field: entry.field, direction: entry.direction }));
  }
  if (normalized[0].field !== 'scoreUnits' || normalized[0].direction !== 'desc') {
    return invalidPolicy('policy_tie_break_score_first_required');
  }
  if (normalized.at(-1).field !== 'candidateId'
    || normalized.at(-1).direction !== 'asc') {
    return invalidPolicy('policy_tie_break_candidate_id_required');
  }
  return Object.freeze({ ok: true, value: Object.freeze(normalized) });
}

function validatePolicy(policy) {
  if (!isPlainRecord(policy)
    || !isNonEmptyId(policy.schemaVersion)
    || !isNonEmptyId(policy.policyId)
    || !isDataArray(policy.hardConstraints)
    || !isDataArray(policy.softPreferences)) {
    return invalidPolicy('policy_shape_invalid');
  }
  if (policy.weightBasisPointsTotal !== BASIS_POINTS_TOTAL) {
    return invalidPolicy('policy_weight_total_invalid', {
      expected: BASIS_POINTS_TOTAL,
      actual: policy.weightBasisPointsTotal,
    });
  }

  const allRules = [...policy.hardConstraints, ...policy.softPreferences];
  const uniqueIds = validateUniqueRuleIds(allRules);
  if (!uniqueIds.ok) return uniqueIds;

  for (const rule of policy.hardConstraints) {
    if (!isNonEmptyId(rule.factorId)
      || !HARD_OPERATORS.has(rule.operator)
      || !isSafeInteger(rule.value)) {
      return invalidPolicy('hard_constraint_invalid', { ruleId: rule.id });
    }
    if (isForbiddenFactorId(rule.factorId)) {
      return invalidPolicy('factor_forbidden', { factorId: rule.factorId, ruleId: rule.id });
    }
  }

  let weightSum = 0;
  for (const rule of policy.softPreferences) {
    if (!isNonEmptyId(rule.factorId)
      || !SOFT_DIRECTIONS.has(rule.direction)
      || !isSafeInteger(rule.weightBasisPoints)
      || rule.weightBasisPoints < 0
      || !isSafeInteger(rule.rangeMin)
      || !isSafeInteger(rule.rangeMax)
      || Math.abs(rule.rangeMin) > MAX_SCORING_ABSOLUTE_VALUE
      || Math.abs(rule.rangeMax) > MAX_SCORING_ABSOLUTE_VALUE
      || rule.rangeMin >= rule.rangeMax) {
      return invalidPolicy('soft_preference_invalid', { ruleId: rule.id });
    }
    if (isForbiddenFactorId(rule.factorId)) {
      return invalidPolicy('factor_forbidden', { factorId: rule.factorId, ruleId: rule.id });
    }
    if (!isSafeInteger(weightSum + rule.weightBasisPoints)) {
      return invalidPolicy('policy_weight_sum_unsafe');
    }
    weightSum += rule.weightBasisPoints;
  }
  if (policy.softPreferences.length > 0 && weightSum !== policy.weightBasisPointsTotal) {
    return invalidPolicy('policy_weight_sum_mismatch', {
      expected: policy.weightBasisPointsTotal,
      actual: weightSum,
    });
  }

  const tieBreak = validateTieBreak(policy.tieBreak);
  if (!tieBreak.ok) return tieBreak;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      schemaVersion: policy.schemaVersion,
      policyId: policy.policyId,
      hardConstraints: Object.freeze(
        [...policy.hardConstraints].sort((left, right) => compareCodeUnits(left.id, right.id)),
      ),
      softPreferences: Object.freeze(
        [...policy.softPreferences].sort((left, right) => compareCodeUnits(left.id, right.id)),
      ),
      weightBasisPointsTotal: policy.weightBasisPointsTotal,
      tieBreak: tieBreak.value,
    }),
  });
}

function normalizeObservation(candidate, factorId) {
  if (!Object.hasOwn(candidate.observations, factorId)) {
    return Object.freeze({ state: 'missing' });
  }
  const observation = candidate.observations[factorId];
  if (!isPlainRecord(observation) || !isNonEmptyId(observation.state)) {
    return Object.freeze({ state: 'malformed' });
  }
  if (observation.state === KNOWN_OBSERVATION_STATE) {
    return isSafeInteger(observation.value)
      ? Object.freeze({ state: KNOWN_OBSERVATION_STATE, value: observation.value })
      : Object.freeze({ state: 'malformed' });
  }
  if (NON_KNOWN_OBSERVATION_STATES.has(observation.state)) {
    return Object.freeze({ state: observation.state });
  }
  return Object.freeze({ state: 'unsupported' });
}

function validateCandidate(candidate) {
  return isPlainRecord(candidate)
    && isNonEmptyId(candidate.schemaVersion)
    && isNonEmptyId(candidate.candidateId)
    && isDataArray(candidate.edgeIds)
    && candidate.edgeIds.every(isNonEmptyId)
    && isSafeInteger(candidate.distanceMm)
    && candidate.distanceMm >= 0
    && isSafeInteger(candidate.objectiveCostUnits)
    && candidate.objectiveCostUnits >= 0
    && isPlainRecord(candidate.observations)
    && isPlainRecord(candidate.provenance);
}

function evaluateHardOperator(operator, actual, expected) {
  switch (operator) {
    case 'eq': return actual === expected;
    case 'neq': return actual !== expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    default: return false;
  }
}

function hardTraceEntry(candidateId, rule, observation) {
  if (observation.state !== KNOWN_OBSERVATION_STATE) {
    return Object.freeze({
      phase: 'hard_constraint',
      candidateId,
      ruleId: rule.id,
      factorId: rule.factorId,
      observationState: observation.state,
      operator: rule.operator,
      expectedValue: rule.value,
      outcome: 'unresolved',
      reasonCode: `hard_constraint_${observation.state}_unresolved`,
    });
  }
  const passed = evaluateHardOperator(rule.operator, observation.value, rule.value);
  return Object.freeze({
    phase: 'hard_constraint',
    candidateId,
    ruleId: rule.id,
    factorId: rule.factorId,
    observationState: observation.state,
    actualValue: observation.value,
    operator: rule.operator,
    expectedValue: rule.value,
    outcome: passed ? 'pass' : 'fail',
    reasonCode: passed ? 'hard_constraint_known_pass' : 'hard_constraint_known_fail',
  });
}

function softUtility(rule, value) {
  const boundedValue = Math.min(rule.rangeMax, Math.max(rule.rangeMin, value));
  const rangeSpan = rule.rangeMax - rule.rangeMin;
  const utilityDistance = rule.direction === 'maximize'
    ? boundedValue - rule.rangeMin
    : rule.rangeMax - boundedValue;
  const utilityNumerator = utilityDistance * BASIS_POINTS_TOTAL;
  if (!isSafeInteger(rangeSpan)
    || !isSafeInteger(utilityDistance)
    || !isSafeInteger(utilityNumerator)) {
    return Object.freeze({ ok: false });
  }
  return Object.freeze({
    ok: true,
    utilityBasisPoints: Math.floor(utilityNumerator / rangeSpan),
    utilityNumerator,
    rangeSpan,
  });
}

function softTraceEntry(candidateId, rule, observation) {
  if (observation.state !== KNOWN_OBSERVATION_STATE) {
    return Object.freeze({
      phase: 'soft_preference',
      candidateId,
      ruleId: rule.id,
      factorId: rule.factorId,
      observationState: observation.state,
      direction: rule.direction,
      rangeMin: rule.rangeMin,
      rangeMax: rule.rangeMax,
      weightBasisPoints: rule.weightBasisPoints,
      outcome: 'unresolved',
      reasonCode: `soft_preference_${observation.state}_unresolved`,
    });
  }
  const utility = softUtility(rule, observation.value);
  if (!utility.ok) {
    return Object.freeze({
      phase: 'soft_preference',
      candidateId,
      ruleId: rule.id,
      factorId: rule.factorId,
      observationState: observation.state,
      outcome: 'malformed',
      reasonCode: 'soft_preference_score_unsafe',
    });
  }
  const weightedScoreUnits = utility.utilityBasisPoints * rule.weightBasisPoints;
  if (!isSafeInteger(weightedScoreUnits)) {
    return Object.freeze({
      phase: 'soft_preference',
      candidateId,
      ruleId: rule.id,
      factorId: rule.factorId,
      observationState: observation.state,
      outcome: 'malformed',
      reasonCode: 'soft_preference_score_unsafe',
    });
  }
  return Object.freeze({
    phase: 'soft_preference',
    candidateId,
    ruleId: rule.id,
    factorId: rule.factorId,
    observationState: observation.state,
    actualValue: observation.value,
    direction: rule.direction,
    rangeMin: rule.rangeMin,
    rangeMax: rule.rangeMax,
    rangeSpan: utility.rangeSpan,
    utilityNumerator: utility.utilityNumerator,
    utilityBasisPoints: utility.utilityBasisPoints,
    weightBasisPoints: rule.weightBasisPoints,
    weightedScoreUnits,
    outcome: 'scored',
    reasonCode: 'soft_preference_known_scored',
  });
}

function compareRanked(left, right, tieBreak) {
  for (const entry of tieBreak) {
    const comparison = entry.field === 'candidateId'
      ? compareCodeUnits(left.candidateId, right.candidateId)
      : compareNumbers(left[entry.field], right[entry.field]);
    if (comparison !== 0) return entry.direction === 'asc' ? comparison : -comparison;
  }
  return 0;
}

function candidateReasonSummary(candidateId, entries) {
  return Object.freeze({
    candidateId,
    reasonCodes: Object.freeze(entries.map((entry) => entry.reasonCode)),
  });
}

function dispositionTraceEntry(candidateId, outcome, reasonCode, entries = [], scoreUnits = null) {
  const entry = {
    phase: 'candidate_disposition',
    candidateId,
    outcome,
    reasonCode,
    ruleIds: Object.freeze(entries.map(({ ruleId }) => ruleId).filter(Boolean)),
  };
  if (isSafeInteger(scoreUnits)) entry.scoreUnits = scoreUnits;
  return Object.freeze(entry);
}

function rankTraceEntry(rankedCandidate, rank, tieBreak) {
  return Object.freeze({
    phase: 'ranking',
    candidateId: rankedCandidate.candidateId,
    outcome: 'ranked',
    reasonCode: 'candidate_ranked',
    rank,
    scoreUnits: rankedCandidate.scoreUnits,
    tieBreakValues: Object.freeze(tieBreak.map((entry) => Object.freeze({
      field: entry.field,
      direction: entry.direction,
      value: rankedCandidate[entry.field],
    }))),
  });
}

function freezeResult(result) {
  return Object.freeze({
    ...result,
    admittedCandidateIds: Object.freeze(result.admittedCandidateIds),
    rankedCandidateIds: Object.freeze(result.rankedCandidateIds),
    rejected: Object.freeze(result.rejected),
    unresolved: Object.freeze(result.unresolved),
    trace: Object.freeze(result.trace),
  });
}

function emptyResult(status, policyId, reasonCode, details) {
  return freezeResult({
    schemaVersion: DECISION_RESULT_SCHEMA_VERSION,
    status,
    policyId,
    reasonCode,
    ...(details ? { details } : {}),
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    rejected: [],
    unresolved: [],
    trace: [],
  });
}

/**
 * Evaluates pre-generated route candidate facts against a plain-object policy.
 * This module deliberately owns no shared schema; S0 validation can be adapted
 * at the call boundary without changing the deterministic evaluation rules.
 */
export function evaluate(input = {}) {
  const candidates = isPlainRecord(input) ? input.candidates : undefined;
  const policy = isPlainRecord(input) ? input.policy : undefined;
  const policyReview = validatePolicy(policy);
  if (!policyReview.ok) {
    return emptyResult(
      'invalid_policy',
      isPlainRecord(policy) && isNonEmptyId(policy.policyId) ? policy.policyId : null,
      policyReview.reasonCode,
      policyReview.details,
    );
  }
  if (!isDataArray(candidates)) {
    return emptyResult(
      'invalid_candidates',
      policyReview.value.policyId,
      'candidate_list_invalid',
    );
  }

  const candidateIds = new Set();
  for (const candidate of candidates) {
    if (!validateCandidate(candidate)) {
      return emptyResult(
        'invalid_candidates',
        policyReview.value.policyId,
        'candidate_shape_invalid',
      );
    }
    if (candidateIds.has(candidate.candidateId)) {
      return emptyResult(
        'invalid_candidates',
        policyReview.value.policyId,
        'candidate_id_duplicate',
      );
    }
    candidateIds.add(candidate.candidateId);
  }
  const sortedCandidates = [...candidates].sort((left, right) => (
    compareCodeUnits(left.candidateId, right.candidateId)
  ));

  const trace = [];
  const rejected = [];
  const unresolved = [];
  const hardAdmitted = [];
  for (const candidate of sortedCandidates) {
    const hardEntries = policyReview.value.hardConstraints.map((rule) => (
      hardTraceEntry(candidate.candidateId, rule, normalizeObservation(candidate, rule.factorId))
    ));
    trace.push(...hardEntries);
    const failedEntries = hardEntries.filter((entry) => entry.outcome === 'fail');
    const unresolvedEntries = hardEntries.filter((entry) => entry.outcome === 'unresolved');
    if (failedEntries.length > 0) {
      const reasonEntries = [...failedEntries, ...unresolvedEntries];
      rejected.push(candidateReasonSummary(candidate.candidateId, reasonEntries));
      trace.push(dispositionTraceEntry(
        candidate.candidateId,
        'rejected',
        'candidate_hard_constraint_rejected',
        reasonEntries,
      ));
    } else if (unresolvedEntries.length > 0) {
      unresolved.push(candidateReasonSummary(candidate.candidateId, unresolvedEntries));
      trace.push(dispositionTraceEntry(
        candidate.candidateId,
        'unresolved',
        'candidate_hard_constraint_unresolved',
        unresolvedEntries,
      ));
    } else {
      hardAdmitted.push(candidate);
    }
  }

  const ranked = [];
  for (const candidate of hardAdmitted) {
    const softEntries = policyReview.value.softPreferences.map((rule) => (
      softTraceEntry(candidate.candidateId, rule, normalizeObservation(candidate, rule.factorId))
    ));
    trace.push(...softEntries);
    const unscoredEntries = softEntries.filter((entry) => entry.outcome !== 'scored');
    if (unscoredEntries.length > 0) {
      unresolved.push(candidateReasonSummary(candidate.candidateId, unscoredEntries));
      trace.push(dispositionTraceEntry(
        candidate.candidateId,
        'unresolved',
        'candidate_soft_preference_unresolved',
        unscoredEntries,
      ));
      continue;
    }
    const scoreUnits = softEntries.reduce((sum, entry) => sum + entry.weightedScoreUnits, 0);
    if (!isSafeInteger(scoreUnits)) {
      const scoreEntry = Object.freeze({
        phase: 'soft_preference',
        candidateId: candidate.candidateId,
        outcome: 'malformed',
        reasonCode: 'candidate_score_unsafe',
      });
      trace.push(scoreEntry);
      unresolved.push(candidateReasonSummary(candidate.candidateId, [scoreEntry]));
      trace.push(dispositionTraceEntry(
        candidate.candidateId,
        'unresolved',
        'candidate_soft_preference_unresolved',
        [scoreEntry],
      ));
      continue;
    }
    ranked.push(Object.freeze({
      candidateId: candidate.candidateId,
      scoreUnits,
      distanceMm: candidate.distanceMm,
      objectiveCostUnits: candidate.objectiveCostUnits,
    }));
    trace.push(dispositionTraceEntry(
      candidate.candidateId,
      'admitted',
      'candidate_admitted',
      [],
      scoreUnits,
    ));
  }
  ranked.sort((left, right) => compareRanked(left, right, policyReview.value.tieBreak));
  trace.push(...ranked.map((rankedCandidate, index) => (
    rankTraceEntry(rankedCandidate, index + 1, policyReview.value.tieBreak)
  )));

  const rankedCandidateIds = ranked.map(({ candidateId }) => candidateId);
  const admittedCandidateIds = [...rankedCandidateIds];
  const status = admittedCandidateIds.length > 0 ? 'ranked' : 'no_admitted_candidate';
  return freezeResult({
    schemaVersion: DECISION_RESULT_SCHEMA_VERSION,
    status,
    policyId: policyReview.value.policyId,
    reasonCode: status === 'ranked' ? 'candidates_ranked' : 'no_admitted_candidate',
    admittedCandidateIds,
    rankedCandidateIds,
    rejected,
    unresolved,
    trace,
  });
}

export const evaluateRouteCandidates = evaluate;

export { BASIS_POINTS_TOTAL };
