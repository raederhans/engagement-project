import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  admitRouteSearchDecisionEvaluation,
} from '../evaluator/search_v2.js';

export const ROUTE_DECISION_EXPLANATION_VERSION = 'route-decision-explanation/v1';
export const ROUTE_DECISION_EXPLANATION_EFFECT_VERSION =
  'route-decision-explanation-counterfactual-effect/v1';
export const ROUTE_DECISION_EXPLANATION_CANONICAL_CONTENT_VERSION =
  'route-decision-explanation-canonical-json/v1';
export const ROUTE_DECISION_EXPLANATION_SEARCH_VOCABULARY_VERSIONS = Object.freeze({
  status: 'route-search-status-v1',
  termination: 'route-search-termination-v1',
  completeness: 'route-search-completeness-v1',
  constraintOutcome: 'route-search-constraint-outcome-v1',
  budgetOutcome: 'route-search-budget-outcome-v1',
  capacityOutcome: 'route-search-capacity-outcome-v1',
});
export const ROUTE_DECISION_EXPLANATION_EFFECT_KINDS = Object.freeze([
  'selected-route-changed-under-ablation',
  'rank-changed-under-ablation',
  'candidate-eligibility-changed-under-constraint-ablation',
  'tie-break-decided-rank',
  'score-changed-only',
  'no-effect',
]);

export const ROUTE_DECISION_EXPLANATION_REASON_CODES = Object.freeze([
  'provided-candidate-set-ranked',
  'provided-candidate-set-no-eligible-candidate',
  'provided-candidate-set-incomplete',
  'decision-not-evaluated',
  'hard-constraint-passed',
  'hard-constraint-failed',
  'hard-constraint-unresolved',
]);

export const ROUTE_DECISION_EXPLANATION_LIMITATION_CODES = Object.freeze([
  'synthetic-evidence-only',
  'provided-candidate-set-only',
  'bounded-search-scope-only',
  'route-search-completeness-not-proven',
  'route-search-stopped',
  'constraint-evidence-unknown',
  'constraint-evidence-unavailable',
  'constraint-evidence-partial',
  'constraint-evidence-stale',
  'constraint-evidence-invalid',
  'constraint-evidence-missing',
  'soft-contribution-not-decisive-cause',
  'counterfactual-effect-not-causal',
  'no-user-preference-inference',
  'no-accessibility-outcome-claim',
  'no-safety-claim',
]);

const SEARCH_RESULT_VERSION = 'engagement-route-candidate-search-result/v2';
const ENRICHED_SEARCH_RESULT_VERSION = 'engagement-route-search-enrichment-result/v3';
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REASON_CODE_SET = new Set(ROUTE_DECISION_EXPLANATION_REASON_CODES);
const LIMITATION_CODE_SET = new Set(ROUTE_DECISION_EXPLANATION_LIMITATION_CODES);
const EFFECT_KIND_SET = new Set(ROUTE_DECISION_EXPLANATION_EFFECT_KINDS);
const PRIMARY_WHY_EFFECT_KIND_SET = new Set([
  'selected-route-changed-under-ablation',
  'rank-changed-under-ablation',
  'candidate-eligibility-changed-under-constraint-ablation',
]);

function fail(message) {
  throw new TypeError(`route decision explanation contract: ${message}`);
}

function inspectObject(raw, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label} must be an object`);
  let prototype;
  let descriptors;
  let ownKeys;
  try {
    prototype = Object.getPrototypeOf(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
    ownKeys = Reflect.ownKeys(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (prototype !== Object.prototype || ownKeys.some((key) => typeof key !== 'string')) {
    fail(`${label} must be a plain string-keyed object`);
  }
  for (const key of ownKeys) {
    if (BLOCKED_KEYS.has(key)) fail(`${label}.${key} is prohibited`);
    if (!Object.hasOwn(descriptors[key], 'value')) fail(`${label}.${key} must be a data property`);
  }
  return { descriptors, ownKeys };
}

function exactObject(raw, keys, label) {
  const { descriptors, ownKeys } = inspectObject(raw, label);
  if (ownKeys.length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key))
    || ownKeys.some((key) => !keys.includes(key))) fail(`${label} schema mismatch`);
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function strictArray(raw, label) {
  if (!Array.isArray(raw)) fail(`${label} must be an array`);
  let prototype;
  let descriptors;
  let ownKeys;
  try {
    prototype = Object.getPrototypeOf(raw);
    descriptors = Object.getOwnPropertyDescriptors(raw);
    ownKeys = Reflect.ownKeys(raw);
  } catch {
    fail(`${label} cannot be inspected safely`);
  }
  if (prototype !== Array.prototype || ownKeys.some((key) => typeof key !== 'string')) {
    fail(`${label} must be a standard array`);
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0) fail(`${label} has an invalid length`);
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      fail(`${label}[${index}] must be a data property`);
    }
    result.push(descriptor.value);
  }
  const extras = ownKeys.filter((key) => key !== 'length'
    && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length));
  if (extras.length) fail(`${label} contains unsupported properties`);
  return result;
}

function cloneData(raw, label, depth = 0) {
  if (depth > 24) fail(`${label} exceeds the supported nesting depth`);
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || Object.is(raw, -0)) fail(`${label} contains an invalid number`);
    return raw;
  }
  if (Array.isArray(raw)) {
    return strictArray(raw, label).map((item, index) => cloneData(
      item,
      `${label}[${index}]`,
      depth + 1,
    ));
  }
  const { descriptors, ownKeys } = inspectObject(raw, label);
  return Object.fromEntries(ownKeys.map((key) => [
    key,
    cloneData(descriptors[key].value, `${label}.${key}`, depth + 1),
  ]));
}

function canonicalContent(raw, label, depth = 0) {
  if (depth > 24) fail(`${label} exceeds the supported canonicalization depth`);
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') {
    return JSON.stringify(raw);
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || Object.is(raw, -0)) {
      fail(`${label} contains an invalid canonical number`);
    }
    return String(raw);
  }
  if (Array.isArray(raw)) {
    return `[${strictArray(raw, label).map((item, index) => canonicalContent(
      item,
      `${label}[${index}]`,
      depth + 1,
    )).join(',')}]`;
  }
  const { descriptors, ownKeys } = inspectObject(raw, label);
  return `{${[...ownKeys].sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalContent(
      descriptors[key].value,
      `${label}.${key}`,
      depth + 1,
    )}`
  )).join(',')}}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function same(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => same(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && same(left[key], right[key]));
}

function searchResultFromArtifact(artifact) {
  if (artifact.schemaVersion === SEARCH_RESULT_VERSION) return artifact;
  if (artifact.schemaVersion === ENRICHED_SEARCH_RESULT_VERSION) return artifact.searchResult;
  fail('admitted candidate artifact version is unsupported');
}

function sourceIdentity(artifact) {
  if (artifact.schemaVersion !== ENRICHED_SEARCH_RESULT_VERSION) {
    return {
      sourceReceiptSchemaVersion: null,
      sourceId: null,
      artifactVersion: null,
      mappingPolicyVersion: null,
      clocks: { sourceAsOf: null, retrievedAt: null, builtAt: null, observedAt: null },
    };
  }
  const receipt = artifact.sourceReceipt;
  return {
    sourceReceiptSchemaVersion: receipt.schemaVersion,
    sourceId: receipt.sourceId,
    artifactVersion: receipt.artifactVersion,
    mappingPolicyVersion: receipt.mappingPolicyVersion,
    clocks: {
      sourceAsOf: receipt.sourceAsOf,
      retrievedAt: receipt.retrievedAt,
      builtAt: receipt.builtAt,
      observedAt: receipt.observedAt,
    },
  };
}

function buildInputIdentity(admitted, search) {
  const request = search.request;
  const candidateSet = search.candidateSet;
  return {
    decisionEvaluationSchemaVersion: admitted.schemaVersion,
    policySchemaVersion: admitted.policy.schemaVersion,
    policyId: admitted.policy.policyId,
    candidateArtifactSchemaVersion: admitted.candidateArtifact.schemaVersion,
    searchResultSchemaVersion: search.schemaVersion,
    requestId: request?.requestId ?? null,
    graphId: request?.graphId ?? candidateSet?.graphId ?? null,
    candidateSetId: candidateSet?.candidateSetId ?? null,
    candidateSetRevision: candidateSet?.candidateSetRevision ?? null,
    contentIdentities: {
      canonicalizationVersion: ROUTE_DECISION_EXPLANATION_CANONICAL_CONTENT_VERSION,
      admittedPolicy: canonicalContent(admitted.policy, 'admitted policy content identity'),
      admittedCandidateArtifact: canonicalContent(
        admitted.candidateArtifact,
        'admitted candidate artifact content identity',
      ),
      admittedDecisionEvaluation: canonicalContent(
        admitted,
        'admitted decision evaluation content identity',
      ),
    },
    algorithmVersions: {
      routeDistinctnessVersion: request?.routeDistinctnessVersion
        ?? candidateSet?.routeDistinctnessVersion ?? null,
      searchTieBreakVersion: request?.tieBreakVersion ?? candidateSet?.tieBreakVersion ?? null,
      constraintAggregationVersion: candidateSet?.constraintAggregationVersion ?? null,
      capacityPolicyVersion: candidateSet?.capacityPolicy.version ?? null,
    },
    denominators: {
      requestedCandidateCount: request?.requestedCandidateCount ?? null,
      returnedCandidateCount: candidateSet?.candidateCount ?? null,
    },
    rankingIdentity: {
      primaryCandidateId: admitted.evaluation.decision?.rankedCandidateIds[0] ?? null,
      alternativeCandidateIds: admitted.evaluation.decision?.rankedCandidateIds.slice(1) ?? [],
    },
    searchOutcomeIdentity: {
      vocabularyVersions: { ...ROUTE_DECISION_EXPLANATION_SEARCH_VOCABULARY_VERSIONS },
      status: search.status,
      termination: search.termination,
      completeness: candidateSet?.completeness.routeSearch ?? null,
      constraintOutcome: candidateSet?.constraintOutcome ?? null,
      budgetOutcome: candidateSet?.budgetOutcome ?? null,
      capacityOutcome: candidateSet?.capacityOutcome ?? null,
    },
    source: sourceIdentity(admitted.candidateArtifact),
  };
}

function rawSoftValue(candidate, factorId) {
  if (factorId === 'distance-mm') return candidate.distanceMm;
  if (factorId === 'objective-cost-units') return candidate.objectiveCostUnits;
  fail(`soft factor ${factorId} is unsupported`);
}

function weightedContribution(candidate, preference) {
  const rawValue = rawSoftValue(candidate, preference.factorId);
  const boundedValue = Math.min(preference.rangeMax, Math.max(preference.rangeMin, rawValue));
  const utilityNumerator = (preference.rangeMax - boundedValue) * 10_000;
  const utilityBasisPoints = Math.floor(
    utilityNumerator / (preference.rangeMax - preference.rangeMin),
  );
  const weightedScoreUnits = utilityBasisPoints * preference.weightBasisPoints;
  if (![utilityNumerator, utilityBasisPoints, weightedScoreUnits].every(Number.isSafeInteger)) {
    fail(`soft contribution for ${preference.preferenceId} is unsafe`);
  }
  return { rawValue, utilityBasisPoints, weightedScoreUnits };
}

function compareValues(left, right, factorId, direction) {
  const leftValue = factorId === 'score-units' ? left.scoreUnits
    : factorId === 'distance-mm' ? left.candidate.distanceMm
      : factorId === 'objective-cost-units' ? left.candidate.objectiveCostUnits
        : left.candidate.candidateId;
  const rightValue = factorId === 'score-units' ? right.scoreUnits
    : factorId === 'distance-mm' ? right.candidate.distanceMm
      : factorId === 'objective-cost-units' ? right.candidate.objectiveCostUnits
        : right.candidate.candidateId;
  const comparison = typeof leftValue === 'string'
    ? (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0)
    : leftValue - rightValue;
  return direction === 'ascending' ? comparison : -comparison;
}

function rankCandidates(candidates, policy, omittedPreferenceId = null) {
  return candidates.map((candidate) => {
    const contributions = policy.softPreferences.map((preference) => ({
      preferenceId: preference.preferenceId,
      ...weightedContribution(candidate, preference),
    }));
    return {
      candidate,
      contributions,
      scoreUnits: contributions.reduce((sum, contribution) => (
        contribution.preferenceId === omittedPreferenceId
          ? sum
          : sum + contribution.weightedScoreUnits
      ), 0),
    };
  }).sort((left, right) => {
    for (const tieBreak of policy.tieBreak) {
      const comparison = compareValues(left, right, tieBreak.factorId, tieBreak.direction);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function scoreIdentity(ranking) {
  return ranking.map(({ candidate, scoreUnits }) => ({
    candidateId: candidate.candidateId,
    scoreUnits,
  })).sort((left, right) => (
    left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0
  ));
}

function tieBreakDecisions(ranking, policy) {
  const decisions = [];
  for (let index = 1; index < ranking.length; index += 1) {
    const left = ranking[index - 1];
    const right = ranking[index];
    if (left.scoreUnits !== right.scoreUnits) continue;
    const deciding = policy.tieBreak.slice(1).find((entry) => (
      compareValues(left, right, entry.factorId, entry.direction) !== 0
    ));
    if (deciding) {
      decisions.push({
        higherRankedCandidateId: left.candidate.candidateId,
        lowerRankedCandidateId: right.candidate.candidateId,
        decidingFactorId: deciding.factorId,
      });
    }
  }
  return decisions;
}

function admittedCandidates(admitted, search) {
  const decision = admitted.evaluation.decision;
  if (!decision) return [];
  const candidatesById = new Map(search.candidateFacts.map((candidate) => [candidate.candidateId, candidate]));
  return decision.admittedCandidateIds.map((candidateId) => {
    const candidate = candidatesById.get(candidateId);
    if (!candidate) fail(`admitted candidate ${candidateId} is absent from search facts`);
    return candidate;
  });
}

function buildSoftCounterfactualEffects(admitted, search) {
  const decision = admitted.evaluation.decision;
  const candidates = admittedCandidates(admitted, search);
  if (!decision || candidates.length === 0) return [];
  const baseline = rankCandidates(candidates, admitted.policy);
  if (!same(baseline.map(({ candidate }) => candidate.candidateId), decision.rankedCandidateIds)) {
    fail('independently recomputed baseline ranking does not match the admitted decision');
  }
  return admitted.policy.softPreferences.map((preference) => {
    const counterfactual = rankCandidates(candidates, admitted.policy, preference.preferenceId);
    const baselineTopCandidateId = baseline[0]?.candidate.candidateId ?? null;
    const counterfactualTopCandidateId = counterfactual[0]?.candidate.candidateId ?? null;
    const baselineRankedCandidateIds = baseline.map(({ candidate }) => candidate.candidateId);
    const counterfactualRankedCandidateIds = counterfactual
      .map(({ candidate }) => candidate.candidateId);
    const baselineScores = scoreIdentity(baseline);
    const counterfactualScores = scoreIdentity(counterfactual);
    const baselineTieBreakDecisions = tieBreakDecisions(baseline, admitted.policy);
    const counterfactualTieBreakDecisions = tieBreakDecisions(counterfactual, admitted.policy);
    const selectedChanged = baselineTopCandidateId !== counterfactualTopCandidateId;
    const rankChanged = !same(baselineRankedCandidateIds, counterfactualRankedCandidateIds);
    const scoreChanged = !same(baselineScores, counterfactualScores);
    const tieBreakDecided = baselineTieBreakDecisions.length > 0
      || counterfactualTieBreakDecisions.length > 0;
    const tieBreakChanged = !same(
      baselineTieBreakDecisions,
      counterfactualTieBreakDecisions,
    );
    const effectKind = selectedChanged
      ? 'selected-route-changed-under-ablation'
      : rankChanged
        ? 'rank-changed-under-ablation'
        : tieBreakDecided && scoreChanged
          ? 'tie-break-decided-rank'
          : scoreChanged
            ? 'score-changed-only'
            : 'no-effect';
    return {
      effectVersion: ROUTE_DECISION_EXPLANATION_EFFECT_VERSION,
      effectKind,
      ruleKind: 'soft-preference',
      ruleId: preference.preferenceId,
      operation: 'ablate-one-soft-preference',
      baseline: {
        selectedCandidateId: baselineTopCandidateId,
        rankedCandidateIds: baselineRankedCandidateIds,
        scores: baselineScores,
        tieBreakDecisions: baselineTieBreakDecisions,
      },
      counterfactual: {
        selectedCandidateId: counterfactualTopCandidateId,
        rankedCandidateIds: counterfactualRankedCandidateIds,
        scores: counterfactualScores,
        tieBreakDecisions: counterfactualTieBreakDecisions,
      },
      comparisons: {
        selectedChanged,
        rankChanged,
        scoreChanged,
        tieBreakDecided,
        tieBreakChanged,
      },
      interpretation: 'mechanical-ranking-effect-only',
    };
  });
}

function hardConstraintEligibility(candidate, constraints, omittedConstraintId = null) {
  let unresolved = false;
  for (const constraint of constraints) {
    if (constraint.constraintId === omittedConstraintId) continue;
    const observation = candidate.observations[constraint.factorId];
    if (!observation || observation.state !== 'observed') {
      unresolved = true;
    } else if (observation.value !== constraint.expectedValue) {
      return 'rejected';
    }
  }
  return unresolved ? 'unresolved' : 'eligible';
}

function eligibilityIdentity(candidates, constraints, omittedConstraintId = null) {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    eligibility: hardConstraintEligibility(candidate, constraints, omittedConstraintId),
  }));
}

function buildHardConstraintEffects(admitted, search) {
  if (!search.candidateSet || admitted.policy.hardConstraints.length === 0) return [];
  return admitted.policy.hardConstraints.map((constraint) => {
    const baselineEligibility = eligibilityIdentity(
      search.candidateFacts,
      admitted.policy.hardConstraints,
    );
    const counterfactualEligibility = eligibilityIdentity(
      search.candidateFacts,
      admitted.policy.hardConstraints,
      constraint.constraintId,
    );
    const changedCandidateIds = baselineEligibility
      .filter((entry, index) => entry.eligibility !== counterfactualEligibility[index].eligibility)
      .map(({ candidateId }) => candidateId);
    return {
      effectVersion: ROUTE_DECISION_EXPLANATION_EFFECT_VERSION,
      effectKind: changedCandidateIds.length
        ? 'candidate-eligibility-changed-under-constraint-ablation'
        : 'no-effect',
      ruleKind: 'hard-constraint',
      ruleId: constraint.constraintId,
      operation: 'ablate-one-hard-constraint',
      baselineEligibility,
      counterfactualEligibility,
      changedCandidateIds,
      interpretation: 'mechanical-candidate-eligibility-effect-only',
    };
  });
}

function buildCounterfactualEffects(admitted, search) {
  const effects = [
    ...buildSoftCounterfactualEffects(admitted, search),
    ...buildHardConstraintEffects(admitted, search),
  ];
  for (const effect of effects) {
    if (!EFFECT_KIND_SET.has(effect.effectKind)) fail(`effect kind ${effect.effectKind} is not frozen`);
  }
  return effects;
}

function buildHardConstraintFacts(admitted) {
  const trace = admitted.evaluation.decision?.trace ?? [];
  return trace.filter(({ stage }) => stage === 'hard-constraint').map((entry) => ({
    candidateId: entry.candidateId,
    constraintId: entry.constraintId,
    factorId: entry.factorId,
    observationState: entry.observationState,
    actualValue: entry.actualValue,
    expectedValue: entry.expectedValue,
    outcome: entry.outcome,
    reasonCode: entry.outcome === 'pass'
      ? 'hard-constraint-passed'
      : entry.outcome === 'reject'
        ? 'hard-constraint-failed'
        : 'hard-constraint-unresolved',
  }));
}

function buildSoftContributions(admitted, search) {
  const candidates = admittedCandidates(admitted, search);
  return candidates.flatMap((candidate) => admitted.policy.softPreferences.map((preference) => ({
    candidateId: candidate.candidateId,
    preferenceId: preference.preferenceId,
    factorId: preference.factorId,
    weightBasisPoints: preference.weightBasisPoints,
    ...weightedContribution(candidate, preference),
    meaning: 'score-contribution-not-decisive-reason',
  })));
}

function outcomeReason(admitted) {
  if (admitted.evaluation.status !== 'evaluated') return 'decision-not-evaluated';
  const status = admitted.evaluation.decision.status;
  if (status === 'ranked-in-provided-set') return 'provided-candidate-set-ranked';
  if (status === 'no-eligible-candidate-in-provided-set') {
    return 'provided-candidate-set-no-eligible-candidate';
  }
  return 'provided-candidate-set-incomplete';
}

function limitationCodes(admitted, search, hardConstraintFacts) {
  const codes = [
    'synthetic-evidence-only',
    'bounded-search-scope-only',
    'soft-contribution-not-decisive-cause',
    'counterfactual-effect-not-causal',
    'no-user-preference-inference',
    'no-accessibility-outcome-claim',
    'no-safety-claim',
  ];
  if (admitted.evaluation.status === 'evaluated') codes.splice(1, 0, 'provided-candidate-set-only');
  if (search.candidateSet?.completeness.routeSearch === 'not-proven') {
    codes.push('route-search-completeness-not-proven');
  }
  if (search.status === 'stopped') codes.push('route-search-stopped');
  for (const fact of hardConstraintFacts) {
    if (['unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing']
      .includes(fact.observationState)) codes.push(`constraint-evidence-${fact.observationState}`);
  }
  return [...new Set(codes)];
}

function expectedExplanation(admitted) {
  const search = searchResultFromArtifact(admitted.candidateArtifact);
  const decision = admitted.evaluation.decision;
  const hardConstraintFacts = buildHardConstraintFacts(admitted);
  const reasons = [outcomeReason(admitted), ...hardConstraintFacts.map(({ reasonCode }) => reasonCode)];
  for (const reason of reasons) if (!REASON_CODE_SET.has(reason)) fail(`reason code ${reason} is not frozen`);
  const limitations = limitationCodes(admitted, search, hardConstraintFacts);
  for (const limitation of limitations) {
    if (!LIMITATION_CODE_SET.has(limitation)) fail(`limitation code ${limitation} is not frozen`);
  }
  const counterfactualEffects = buildCounterfactualEffects(admitted, search);
  return {
    outcome: {
      evaluationStatus: admitted.evaluation.status,
      decisionStatus: decision?.status ?? null,
      selectedCandidateId: decision?.rankedCandidateIds[0] ?? null,
      scope: decision?.scope ?? null,
    },
    search: {
      status: search.status,
      termination: search.termination,
      candidateCount: search.candidateSet?.candidateCount ?? null,
      requestedCandidateCount: search.request?.requestedCandidateCount ?? null,
      routeSearchCompleteness: search.candidateSet?.completeness.routeSearch ?? null,
      constraintOutcome: search.candidateSet?.constraintOutcome ?? null,
      budgetOutcome: search.candidateSet?.budgetOutcome ?? null,
      capacityOutcome: search.candidateSet?.capacityOutcome ?? null,
    },
    reasons,
    hardConstraintFacts,
    softContributions: buildSoftContributions(admitted, search),
    counterfactualEffects,
    primaryWhyEffects: counterfactualEffects
      .filter(({ effectKind }) => PRIMARY_WHY_EFFECT_KIND_SET.has(effectKind))
      .map(({ effectKind, ruleKind, ruleId }) => ({ effectKind, ruleKind, ruleId })),
    limitations,
  };
}

export function buildRouteDecisionExplanation(input) {
  const value = exactObject(input, ['decisionEvaluation'], 'explanation build input');
  const admitted = admitRouteSearchDecisionEvaluation(value.decisionEvaluation);
  if (admitted.schemaVersion !== ROUTE_SEARCH_DECISION_EVALUATION_VERSION) {
    fail('decision evaluation version is unsupported');
  }
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_EXPLANATION_VERSION,
    inputIdentity: buildInputIdentity(admitted, searchResultFromArtifact(admitted.candidateArtifact)),
    decisionEvaluation: admitted,
    explanation: expectedExplanation(admitted),
  });
}

export function admitRouteDecisionExplanation(raw) {
  const value = exactObject(
    raw,
    ['schemaVersion', 'inputIdentity', 'decisionEvaluation', 'explanation'],
    'RouteDecisionExplanation',
  );
  if (value.schemaVersion !== ROUTE_DECISION_EXPLANATION_VERSION) {
    fail('RouteDecisionExplanation.schemaVersion is unsupported');
  }
  const expected = buildRouteDecisionExplanation({ decisionEvaluation: value.decisionEvaluation });
  const suppliedIdentity = cloneData(value.inputIdentity, 'RouteDecisionExplanation.inputIdentity');
  const suppliedExplanation = cloneData(value.explanation, 'RouteDecisionExplanation.explanation');
  if (!same(suppliedIdentity, expected.inputIdentity)) fail('input identity does not match admitted input');
  if (!same(suppliedExplanation, expected.explanation)) {
    fail('explanation does not match independently recomputed facts');
  }
  return expected;
}
