import {
  CAPABILITY_OBSERVATION_TAGS,
  DECISION_TIE_BREAK_TAGS,
  MAX_POLICY_RULES,
  MAX_RESULT_CANDIDATES,
  MAX_RESULT_TRACE_ITEMS,
  MAX_SCORING_ABSOLUTE_VALUE,
  ROUTE_DECISION_SCHEMA_VERSIONS,
  ROUTE_RANKING_FACTOR_IDS,
  SOFT_PREFERENCE_BINDINGS,
  UNRESOLVED_OBSERVATION_STATES,
} from './model_v1.js';
import {
  booleanValue,
  boundedId,
  deepFreeze,
  exactEnum,
  exactObject,
  exactSchemaVersion,
  fail,
  inspectPlainObject,
  safeInteger,
  strictArray,
  uniqueStrings,
} from './internal/route_decision_validator_v1.js';

const CAPABILITY_OBSERVATION_TAG_SET = new Set(CAPABILITY_OBSERVATION_TAGS);
const TIE_BREAK_DIRECTIONS = new Set(['ascending', 'descending']);
const TIE_BREAK_TAG_SET = new Set(DECISION_TIE_BREAK_TAGS);
const UNRESOLVED_STATE_SET = new Set(UNRESOLVED_OBSERVATION_STATES);

const RESULT_STATUS_SET = new Set([
  'ranked-in-provided-set',
  'no-eligible-candidate-in-provided-set',
  'candidate-search-incomplete',
]);

const HARD_TRACE_KEYS = Object.freeze([
  'candidateId',
  'stage',
  'constraintId',
  'factorId',
  'observationState',
  'actualValue',
  'operator',
  'expectedValue',
  'outcome',
  'reasonCode',
]);

const SOFT_TRACE_KEYS = Object.freeze([
  'candidateId',
  'stage',
  'preferenceId',
  'factorId',
  'observationState',
  'rawValue',
  'unit',
  'direction',
  'rangeMin',
  'rangeMax',
  'rangeSpan',
  'utilityNumerator',
  'utilityBasisPoints',
  'weightBasisPoints',
  'weightedScoreUnits',
  'outcome',
  'reasonCode',
]);

function unresolvedReason(prefix, observationState) {
  return `${prefix}-${observationState}-unresolved`;
}

function admitHardTraceItem(raw, label) {
  const value = exactObject(raw, label, HARD_TRACE_KEYS);
  if (value.stage !== 'hard-constraint') fail(`${label}.stage must be hard-constraint`);
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const constraintId = boundedId(value.constraintId, `${label}.constraintId`);
  const factorId = exactEnum(value.factorId, CAPABILITY_OBSERVATION_TAG_SET, `${label}.factorId`);
  if (value.operator !== 'equals') fail(`${label}.operator must be equals`);
  const expectedValue = booleanValue(value.expectedValue, `${label}.expectedValue`);
  const outcome = exactEnum(
    value.outcome,
    new Set(['pass', 'reject', 'unresolved']),
    `${label}.outcome`,
  );

  if (outcome === 'unresolved') {
    const observationState = exactEnum(
      value.observationState,
      UNRESOLVED_STATE_SET,
      `${label}.observationState`,
    );
    if (value.actualValue !== null) fail(`${label}.actualValue must be null when unresolved`);
    const reasonCode = unresolvedReason('hard-constraint', observationState);
    if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
    return {
      candidateId,
      stage: 'hard-constraint',
      constraintId,
      factorId,
      observationState,
      actualValue: null,
      operator: 'equals',
      expectedValue,
      outcome: 'unresolved',
      reasonCode,
    };
  }

  if (value.observationState !== 'observed') {
    fail(`${label}.observationState must be observed for ${outcome}`);
  }
  const actualValue = booleanValue(value.actualValue, `${label}.actualValue`);
  const equalityHolds = actualValue === expectedValue;
  if ((outcome === 'pass') !== equalityHolds) {
    fail(`${label}.outcome is inconsistent with actualValue and expectedValue`);
  }
  const reasonCode = outcome === 'pass'
    ? 'hard-constraint-passed'
    : 'hard-constraint-failed';
  if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
  return {
    candidateId,
    stage: 'hard-constraint',
    constraintId,
    factorId,
    observationState: 'observed',
    actualValue,
    operator: 'equals',
    expectedValue,
    outcome,
    reasonCode,
  };
}

function admitSoftTraceItem(raw, label) {
  const value = exactObject(raw, label, SOFT_TRACE_KEYS);
  if (value.stage !== 'soft-preference') fail(`${label}.stage must be soft-preference`);
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const preferenceId = boundedId(value.preferenceId, `${label}.preferenceId`);
  const factorId = exactEnum(
    value.factorId,
    new Set(ROUTE_RANKING_FACTOR_IDS),
    `${label}.factorId`,
  );
  const binding = Object.values(SOFT_PREFERENCE_BINDINGS)
    .find((definition) => definition.factorId === factorId);
  if (value.unit !== binding.unit) fail(`${label}.unit is unsupported for ${factorId}`);
  if (value.direction !== binding.direction) fail(`${label}.direction is unsupported`);
  const rangeMin = safeInteger(value.rangeMin, `${label}.rangeMin`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  const rangeMax = safeInteger(value.rangeMax, `${label}.rangeMax`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  if (rangeMin >= rangeMax) fail(`${label} normalization range must increase`);
  const rangeSpan = safeInteger(value.rangeSpan, `${label}.rangeSpan`, { min: 1 });
  if (rangeSpan !== rangeMax - rangeMin) fail(`${label}.rangeSpan is inconsistent`);
  const weightBasisPoints = safeInteger(
    value.weightBasisPoints,
    `${label}.weightBasisPoints`,
    { min: 0, max: 10_000 },
  );
  const outcome = exactEnum(
    value.outcome,
    new Set(['scored', 'unresolved']),
    `${label}.outcome`,
  );

  if (outcome === 'unresolved') {
    const observationState = exactEnum(
      value.observationState,
      UNRESOLVED_STATE_SET,
      `${label}.observationState`,
    );
    for (const field of [
      'rawValue',
      'utilityNumerator',
      'utilityBasisPoints',
      'weightedScoreUnits',
    ]) {
      if (value[field] !== null) fail(`${label}.${field} must be null when unresolved`);
    }
    const reasonCode = unresolvedReason('soft-preference', observationState);
    if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
    return {
      candidateId,
      stage: 'soft-preference',
      preferenceId,
      factorId,
      observationState,
      rawValue: null,
      unit: binding.unit,
      direction: 'minimize',
      rangeMin,
      rangeMax,
      rangeSpan,
      utilityNumerator: null,
      utilityBasisPoints: null,
      weightBasisPoints,
      weightedScoreUnits: null,
      outcome: 'unresolved',
      reasonCode,
    };
  }

  const rawValue = safeInteger(value.rawValue, `${label}.rawValue`, {
    min: 0,
    max: MAX_SCORING_ABSOLUTE_VALUE,
  });
  const observationState = exactEnum(
    value.observationState,
    new Set(['observed', 'zero']),
    `${label}.observationState`,
  );
  if ((rawValue === 0) !== (observationState === 'zero')) {
    fail(`${label}.observationState must distinguish zero from observed non-zero values`);
  }
  const boundedRawValue = Math.min(rangeMax, Math.max(rangeMin, rawValue));
  const utilityNumerator = safeInteger(
    value.utilityNumerator,
    `${label}.utilityNumerator`,
    { min: 0 },
  );
  const expectedNumerator = (rangeMax - boundedRawValue) * 10_000;
  if (utilityNumerator !== expectedNumerator) fail(`${label}.utilityNumerator is inconsistent`);
  const utilityBasisPoints = safeInteger(
    value.utilityBasisPoints,
    `${label}.utilityBasisPoints`,
    { min: 0, max: 10_000 },
  );
  if (utilityBasisPoints !== Math.floor(utilityNumerator / rangeSpan)) {
    fail(`${label}.utilityBasisPoints is inconsistent`);
  }
  const weightedScoreUnits = safeInteger(
    value.weightedScoreUnits,
    `${label}.weightedScoreUnits`,
    { min: 0 },
  );
  if (weightedScoreUnits !== utilityBasisPoints * weightBasisPoints) {
    fail(`${label}.weightedScoreUnits is inconsistent`);
  }
  if (value.reasonCode !== 'soft-preference-scored') {
    fail(`${label}.reasonCode is unsupported`);
  }
  return {
    candidateId,
    stage: 'soft-preference',
    preferenceId,
    factorId,
    observationState,
    rawValue,
    unit: binding.unit,
    direction: 'minimize',
    rangeMin,
    rangeMax,
    rangeSpan,
    utilityNumerator,
    utilityBasisPoints,
    weightBasisPoints,
    weightedScoreUnits,
    outcome: 'scored',
    reasonCode: 'soft-preference-scored',
  };
}

function admitCandidateDispositionTraceItem(raw, label) {
  const value = exactObject(raw, label, [
    'candidateId',
    'stage',
    'outcome',
    'constraintIds',
    'preferenceIds',
    'totalScoreUnits',
    'reasonCode',
  ]);
  if (value.stage !== 'candidate-disposition') {
    fail(`${label}.stage must be candidate-disposition`);
  }
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const outcome = exactEnum(
    value.outcome,
    new Set(['admitted', 'rejected', 'unresolved']),
    `${label}.outcome`,
  );
  const constraintIds = uniqueStrings(value.constraintIds, `${label}.constraintIds`, {
    max: MAX_POLICY_RULES,
  });
  const preferenceIds = uniqueStrings(value.preferenceIds, `${label}.preferenceIds`, {
    max: MAX_POLICY_RULES,
  });

  if (outcome === 'admitted') {
    if (constraintIds.length || preferenceIds.length) {
      fail(`${label} admitted disposition cannot cite unresolved or rejected rules`);
    }
    const totalScoreUnits = safeInteger(value.totalScoreUnits, `${label}.totalScoreUnits`, {
      min: 0,
    });
    if (value.reasonCode !== 'candidate-admitted') fail(`${label}.reasonCode is unsupported`);
    return {
      candidateId,
      stage: 'candidate-disposition',
      outcome: 'admitted',
      constraintIds,
      preferenceIds,
      totalScoreUnits,
      reasonCode: 'candidate-admitted',
    };
  }

  if (value.totalScoreUnits !== null) fail(`${label}.totalScoreUnits must be null for ${outcome}`);
  if (outcome === 'rejected') {
    if (!constraintIds.length || preferenceIds.length) {
      fail(`${label} rejected disposition must cite only rejected constraints`);
    }
    if (value.reasonCode !== 'candidate-hard-constraint-rejected') {
      fail(`${label}.reasonCode is unsupported`);
    }
    return {
      candidateId,
      stage: 'candidate-disposition',
      outcome: 'rejected',
      constraintIds,
      preferenceIds,
      totalScoreUnits: null,
      reasonCode: 'candidate-hard-constraint-rejected',
    };
  }

  if ((constraintIds.length === 0) === (preferenceIds.length === 0)) {
    fail(`${label} unresolved disposition must cite exactly one rule category`);
  }
  const reasonCode = constraintIds.length
    ? 'candidate-hard-constraint-unresolved'
    : 'candidate-soft-preference-unresolved';
  if (value.reasonCode !== reasonCode) fail(`${label}.reasonCode is unsupported`);
  return {
    candidateId,
    stage: 'candidate-disposition',
    outcome: 'unresolved',
    constraintIds,
    preferenceIds,
    totalScoreUnits: null,
    reasonCode,
  };
}

function admitTieBreakValue(raw, label) {
  const value = exactObject(raw, label, ['factorId', 'direction', 'value']);
  const factorId = exactEnum(value.factorId, TIE_BREAK_TAG_SET, `${label}.factorId`);
  const direction = exactEnum(value.direction, TIE_BREAK_DIRECTIONS, `${label}.direction`);
  if (factorId === 'score-units' && direction !== 'descending') {
    fail(`${label}.direction must be descending for score-units`);
  }
  if (factorId === 'candidate-id' && direction !== 'ascending') {
    fail(`${label}.direction must be ascending for candidate-id`);
  }
  const admittedValue = factorId === 'candidate-id'
    ? boundedId(value.value, `${label}.value`)
    : safeInteger(value.value, `${label}.value`, { min: 0 });
  return { factorId, direction, value: admittedValue };
}

function admitRankingTraceItem(raw, label) {
  const value = exactObject(raw, label, [
    'candidateId',
    'stage',
    'outcome',
    'totalScoreUnits',
    'rank',
    'tieBreakValues',
    'decidingFactorId',
    'reasonCode',
  ]);
  if (value.stage !== 'ranking') fail(`${label}.stage must be ranking`);
  if (value.outcome !== 'ranked') fail(`${label}.outcome must be ranked`);
  const candidateId = boundedId(value.candidateId, `${label}.candidateId`);
  const totalScoreUnits = safeInteger(value.totalScoreUnits, `${label}.totalScoreUnits`, {
    min: 0,
  });
  const rank = safeInteger(value.rank, `${label}.rank`, { min: 1, max: MAX_RESULT_CANDIDATES });
  const tieBreakValues = strictArray(value.tieBreakValues, `${label}.tieBreakValues`, {
    min: 2,
    max: DECISION_TIE_BREAK_TAGS.length,
  }).map((rawEntry, index) => admitTieBreakValue(
    rawEntry,
    `${label}.tieBreakValues[${index}]`,
  ));
  const factorIds = tieBreakValues.map(({ factorId }) => factorId);
  if (new Set(factorIds).size !== factorIds.length) {
    fail(`${label}.tieBreakValues factorIds must be unique`);
  }
  if (tieBreakValues[0].factorId !== 'score-units'
    || tieBreakValues[0].value !== totalScoreUnits) {
    fail(`${label}.tieBreakValues must begin with the candidate total score`);
  }
  const lastTieBreak = tieBreakValues.at(-1);
  if (lastTieBreak.factorId !== 'candidate-id' || lastTieBreak.value !== candidateId) {
    fail(`${label}.tieBreakValues must end with the candidate ID`);
  }
  let decidingFactorId = null;
  if (value.decidingFactorId !== null) {
    decidingFactorId = exactEnum(
      value.decidingFactorId,
      new Set(factorIds),
      `${label}.decidingFactorId`,
    );
  }
  if (value.reasonCode !== 'candidate-ranked') fail(`${label}.reasonCode is unsupported`);
  return {
    candidateId,
    stage: 'ranking',
    outcome: 'ranked',
    totalScoreUnits,
    rank,
    tieBreakValues,
    decidingFactorId,
    reasonCode: 'candidate-ranked',
  };
}

function admitTraceItem(raw, index) {
  const label = `DecisionResult.trace[${index}]`;
  inspectPlainObject(raw, label);
  const stageDescriptor = Object.getOwnPropertyDescriptor(raw, 'stage');
  if (!stageDescriptor || !Object.hasOwn(stageDescriptor, 'value')) {
    fail(`${label}.stage must be a data property`);
  }
  if (stageDescriptor.value === 'hard-constraint') return admitHardTraceItem(raw, label);
  if (stageDescriptor.value === 'soft-preference') return admitSoftTraceItem(raw, label);
  if (stageDescriptor.value === 'candidate-disposition') {
    return admitCandidateDispositionTraceItem(raw, label);
  }
  if (stageDescriptor.value === 'ranking') return admitRankingTraceItem(raw, label);
  fail(`${label}.stage is unsupported`);
}

function admitRejectedItem(raw, index) {
  const item = admitHardTraceItem(raw, `DecisionResult.rejected[${index}]`);
  if (item.outcome !== 'reject') fail(`DecisionResult.rejected[${index}].outcome must be reject`);
  return item;
}

function admitUnresolvedItem(raw, index) {
  const label = `DecisionResult.unresolved[${index}]`;
  inspectPlainObject(raw, label);
  const stageDescriptor = Object.getOwnPropertyDescriptor(raw, 'stage');
  if (!stageDescriptor || !Object.hasOwn(stageDescriptor, 'value')) {
    fail(`${label}.stage must be a data property`);
  }
  const item = stageDescriptor.value === 'hard-constraint'
    ? admitHardTraceItem(raw, label)
    : stageDescriptor.value === 'soft-preference'
      ? admitSoftTraceItem(raw, label)
      : fail(`${label}.stage must identify a hard constraint or soft preference`);
  if (item.outcome !== 'unresolved') fail(`${label}.outcome must be unresolved`);
  return item;
}

function duplicateComposite(items, fields) {
  const keys = items.map((item) => fields.map((field) => item[field]).join('\u0000'));
  return new Set(keys).size !== keys.length;
}

function sameIdentifierSet(actual, expected) {
  return actual.length === expected.length
    && actual.every((identifier) => expected.includes(identifier));
}

function sameTraceRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function admitCandidateSetReference(raw) {
  const value = exactObject(raw, 'DecisionResult.candidateSet', [
    'schemaVersion',
    'candidateSetId',
    'candidateSetRevision',
    'candidateIds',
    'candidateCount',
    'completeness',
  ]);
  exactSchemaVersion(
    value.schemaVersion,
    ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    'DecisionResult.candidateSet',
  );
  const candidateIds = uniqueStrings(
    value.candidateIds,
    'DecisionResult.candidateSet.candidateIds',
    { max: 1 },
  );
  const candidateCount = safeInteger(
    value.candidateCount,
    'DecisionResult.candidateSet.candidateCount',
    { min: 0, max: 1 },
  );
  if (candidateCount !== candidateIds.length) {
    fail('DecisionResult.candidateSet.candidateCount must equal candidateIds length');
  }
  if (value.completeness !== 'incomplete') {
    fail('DecisionResult.candidateSet.completeness must be incomplete');
  }
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.candidateSet,
    candidateSetId: boundedId(
      value.candidateSetId,
      'DecisionResult.candidateSet.candidateSetId',
    ),
    candidateSetRevision: boundedId(
      value.candidateSetRevision,
      'DecisionResult.candidateSet.candidateSetRevision',
    ),
    candidateIds,
    candidateCount,
    completeness: 'incomplete',
  };
}

export function admitDecisionResult(raw) {
  const value = exactObject(raw, 'DecisionResult', [
    'schemaVersion',
    'policyId',
    'candidateSet',
    'status',
    'admittedCandidateIds',
    'rankedCandidateIds',
    'rejected',
    'unresolved',
    'trace',
  ]);
  exactSchemaVersion(value.schemaVersion, ROUTE_DECISION_SCHEMA_VERSIONS.decisionResult, 'DecisionResult');
  const policyId = boundedId(value.policyId, 'DecisionResult.policyId');
  const candidateSet = admitCandidateSetReference(value.candidateSet);
  const status = exactEnum(value.status, RESULT_STATUS_SET, 'DecisionResult.status');
  const admittedCandidateIds = uniqueStrings(
    value.admittedCandidateIds,
    'DecisionResult.admittedCandidateIds',
    { max: MAX_RESULT_CANDIDATES },
  );
  const rankedCandidateIds = uniqueStrings(
    value.rankedCandidateIds,
    'DecisionResult.rankedCandidateIds',
    { max: MAX_RESULT_CANDIDATES },
  );
  if (rankedCandidateIds.length !== admittedCandidateIds.length
    || rankedCandidateIds.some((candidateId) => !admittedCandidateIds.includes(candidateId))) {
    fail('DecisionResult.rankedCandidateIds must contain every admitted candidate exactly once');
  }

  const rejected = strictArray(value.rejected, 'DecisionResult.rejected', {
    max: MAX_RESULT_TRACE_ITEMS,
  }).map(admitRejectedItem);
  if (duplicateComposite(rejected, ['candidateId', 'constraintId'])) {
    fail('DecisionResult.rejected items must be unique');
  }
  const unresolved = strictArray(value.unresolved, 'DecisionResult.unresolved', {
    max: MAX_RESULT_TRACE_ITEMS,
  }).map(admitUnresolvedItem);
  const unresolvedKeys = unresolved.map((item) => ({
    candidateId: item.candidateId,
    stage: item.stage,
    ruleId: item.stage === 'hard-constraint' ? item.constraintId : item.preferenceId,
  }));
  if (duplicateComposite(unresolvedKeys, ['candidateId', 'stage', 'ruleId'])) {
    fail('DecisionResult.unresolved items must be unique');
  }
  const rejectedIds = new Set(rejected.map(({ candidateId }) => candidateId));
  const unresolvedIds = new Set(unresolved.map(({ candidateId }) => candidateId));
  for (const candidateId of admittedCandidateIds) {
    if (rejectedIds.has(candidateId)) fail(`DecisionResult candidate ${candidateId} is both admitted and rejected`);
    if (unresolvedIds.has(candidateId)) fail(`DecisionResult candidate ${candidateId} is both admitted and unresolved`);
  }
  if ([...rejectedIds].some((candidateId) => unresolvedIds.has(candidateId))) {
    fail('DecisionResult candidates cannot be both rejected and unresolved');
  }

  const dispositionCandidateIds = [
    ...admittedCandidateIds,
    ...rejectedIds,
    ...unresolvedIds,
  ];
  if (!sameIdentifierSet(dispositionCandidateIds, candidateSet.candidateIds)) {
    fail('DecisionResult dispositions must exactly cover the referenced candidate set');
  }

  const trace = strictArray(value.trace, 'DecisionResult.trace', {
    max: MAX_RESULT_TRACE_ITEMS,
  }).map(admitTraceItem);
  const dispositionIds = new Set(dispositionCandidateIds);
  if (trace.some(({ candidateId }) => !dispositionIds.has(candidateId))) {
    fail('DecisionResult.trace references a candidate without a disposition');
  }

  const traceIdentities = trace.map((item) => ({
    candidateId: item.candidateId,
    stage: item.stage,
    ruleId: item.constraintId ?? item.preferenceId ?? '',
  }));
  if (duplicateComposite(traceIdentities, ['candidateId', 'stage', 'ruleId'])) {
    fail('DecisionResult.trace items must have unique public identities');
  }

  for (const item of rejected) {
    if (!trace.some((traceItem) => sameTraceRecord(traceItem, item))) {
      fail('DecisionResult.rejected must have a matching rejection trace');
    }
  }
  for (const item of unresolved) {
    if (!trace.some((traceItem) => sameTraceRecord(traceItem, item))) {
      fail('DecisionResult.unresolved must have a matching unresolved trace');
    }
  }

  const dispositionTrace = trace.filter((item) => item.stage === 'candidate-disposition');
  if (dispositionTrace.length !== dispositionIds.size
    || [...dispositionIds].some((candidateId) => !dispositionTrace.some(
      (item) => item.candidateId === candidateId,
    ))) {
    fail('DecisionResult.trace must include one disposition for every candidate');
  }

  for (const disposition of dispositionTrace) {
    const candidateRejected = rejected.filter(
      (item) => item.candidateId === disposition.candidateId,
    );
    const candidateUnresolved = unresolved.filter(
      (item) => item.candidateId === disposition.candidateId,
    );
    const expectedOutcome = admittedCandidateIds.includes(disposition.candidateId)
      ? 'admitted'
      : candidateRejected.length
        ? 'rejected'
        : 'unresolved';
    if (disposition.outcome !== expectedOutcome) {
      fail('DecisionResult candidate disposition outcome is inconsistent');
    }
    if (expectedOutcome === 'rejected') {
      const constraintIds = candidateRejected.map(({ constraintId }) => constraintId);
      if (!sameIdentifierSet(disposition.constraintIds, constraintIds)) {
        fail('DecisionResult rejected disposition must cite every rejected constraint');
      }
    }
    if (expectedOutcome === 'unresolved') {
      const constraintIds = candidateUnresolved
        .filter((item) => item.stage === 'hard-constraint')
        .map(({ constraintId }) => constraintId);
      const preferenceIds = candidateUnresolved
        .filter((item) => item.stage === 'soft-preference')
        .map(({ preferenceId }) => preferenceId);
      if (!sameIdentifierSet(disposition.constraintIds, constraintIds)
        || !sameIdentifierSet(disposition.preferenceIds, preferenceIds)) {
        fail('DecisionResult unresolved disposition must cite every unresolved public rule');
      }
    }
  }

  const hasAdmitted = admittedCandidateIds.length > 0;
  const hasRejected = rejected.length > 0;
  const hasUnresolved = unresolved.length > 0;
  const statusIsConsistent = (
    (status === 'ranked-in-provided-set' && hasAdmitted && !hasRejected && !hasUnresolved)
    || (status === 'no-eligible-candidate-in-provided-set'
      && !hasAdmitted && hasRejected && !hasUnresolved)
    || (status === 'candidate-search-incomplete'
      && !hasAdmitted && !hasRejected && (hasUnresolved || candidateSet.candidateCount === 0))
  );
  if (!statusIsConsistent) fail('DecisionResult.status is inconsistent with candidate dispositions');

  const rankingTrace = trace.filter((item) => item.stage === 'ranking');
  if (rankingTrace.length !== rankedCandidateIds.length) {
    fail('DecisionResult.trace must include one ranking item for every ranked candidate');
  }
  const orderedRankingTrace = [...rankingTrace].sort((left, right) => left.rank - right.rank);
  const rankingOrder = orderedRankingTrace.map(({ candidateId }) => candidateId);
  if (!sameIdentifierSet(rankingOrder, rankedCandidateIds)
    || rankingOrder.some((candidateId, index) => rankedCandidateIds[index] !== candidateId)) {
    fail('DecisionResult.rankedCandidateIds must follow trace rank order');
  }
  if (orderedRankingTrace.some((item, index) => item.rank !== index + 1)) {
    fail('DecisionResult ranking trace ranks must be contiguous from one');
  }

  for (const candidateId of dispositionIds) {
    const candidateTrace = trace.filter((item) => item.candidateId === candidateId);
    const hardFailures = candidateTrace.filter(
      (item) => item.stage === 'hard-constraint' && item.outcome === 'reject',
    );
    const hardUnresolved = candidateTrace.filter(
      (item) => item.stage === 'hard-constraint' && item.outcome === 'unresolved',
    );
    const softScored = candidateTrace.filter(
      (item) => item.stage === 'soft-preference' && item.outcome === 'scored',
    );
    const softUnresolved = candidateTrace.filter(
      (item) => item.stage === 'soft-preference' && item.outcome === 'unresolved',
    );
    const ranking = candidateTrace.filter((item) => item.stage === 'ranking');
    const disposition = dispositionTrace.find((item) => item.candidateId === candidateId);

    if (disposition.outcome === 'rejected'
      && (hardFailures.length === 0 || softScored.length || softUnresolved.length || ranking.length)) {
      fail('DecisionResult rejected candidate trace must stop after hard-constraint rejection');
    }
    if (disposition.outcome === 'unresolved') {
      if (hardFailures.length || (!hardUnresolved.length && !softUnresolved.length) || ranking.length) {
        fail('DecisionResult unresolved candidate trace is inconsistent');
      }
      if (hardUnresolved.length && (softScored.length || softUnresolved.length)) {
        fail('DecisionResult hard-unresolved candidate cannot have soft-preference trace');
      }
    }
    if (disposition.outcome === 'admitted') {
      if (hardFailures.length || hardUnresolved.length || softUnresolved.length
        || softScored.length === 0 || ranking.length !== 1) {
        fail('DecisionResult admitted candidate trace is incomplete');
      }
      const totalScoreUnits = softScored.reduce(
        (sum, item) => sum + item.weightedScoreUnits,
        0,
      );
      if (!Number.isSafeInteger(totalScoreUnits)
        || disposition.totalScoreUnits !== totalScoreUnits
        || ranking[0].totalScoreUnits !== totalScoreUnits) {
        fail('DecisionResult total score is inconsistent with scored contributions');
      }
    }
  }

  return deepFreeze({
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSIONS.decisionResult,
    policyId,
    candidateSet,
    status,
    admittedCandidateIds,
    rankedCandidateIds,
    rejected,
    unresolved,
    trace,
  });
}
