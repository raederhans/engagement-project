const EFFECT_VERSION = 'route-decision-explanation-counterfactual-effect/v1';

function unwrapSearch(envelope) {
  const artifact = envelope.candidateArtifact;
  return artifact.schemaVersion === 'engagement-route-search-enrichment-result/v3'
    ? artifact.searchResult
    : artifact;
}

function rawMetric(candidate, factorId) {
  return factorId === 'distance-mm' ? candidate.distanceMm : candidate.objectiveCostUnits;
}

function buildContributionMatrix(candidates, preferences) {
  const matrix = new Map(candidates.map((candidate) => [candidate.candidateId, new Map()]));
  for (const preference of preferences) {
    const span = preference.rangeMax - preference.rangeMin;
    for (const candidate of candidates) {
      const raw = rawMetric(candidate, preference.factorId);
      const clamped = raw < preference.rangeMin
        ? preference.rangeMin
        : raw > preference.rangeMax ? preference.rangeMax : raw;
      const basisPoints = ((preference.rangeMax - clamped) * 10_000 - (
        (preference.rangeMax - clamped) * 10_000 % span
      )) / span;
      matrix.get(candidate.candidateId).set(
        preference.preferenceId,
        basisPoints * preference.weightBasisPoints,
      );
    }
  }
  return matrix;
}

function metricValue(row, factorId) {
  if (factorId === 'score-units') return row.scoreUnits;
  if (factorId === 'distance-mm') return row.candidate.distanceMm;
  if (factorId === 'objective-cost-units') return row.candidate.objectiveCostUnits;
  return row.candidate.candidateId;
}

function orderedRows(candidates, policy, contributionMatrix, omittedPreferenceId = null) {
  const rows = candidates.map((candidate) => ({
    candidate,
    scoreUnits: [...contributionMatrix.get(candidate.candidateId)]
      .reduce((total, [preferenceId, score]) => (
        preferenceId === omittedPreferenceId ? total : total + score
      ), 0),
  }));
  rows.sort((left, right) => {
    for (const key of policy.tieBreak) {
      const a = metricValue(left, key.factorId);
      const b = metricValue(right, key.factorId);
      const delta = typeof a === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : a - b;
      if (delta) return key.direction === 'ascending' ? delta : -delta;
    }
    return 0;
  });
  return rows;
}

function scoreSnapshot(rows) {
  return [...rows]
    .sort((left, right) => left.candidate.candidateId < right.candidate.candidateId ? -1 : 1)
    .map(({ candidate, scoreUnits }) => ({ candidateId: candidate.candidateId, scoreUnits }));
}

function tieBreakSnapshot(rows, policy) {
  const result = [];
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const higher = rows[index];
    const lower = rows[index + 1];
    if (higher.scoreUnits !== lower.scoreUnits) continue;
    for (const key of policy.tieBreak.slice(1)) {
      if (metricValue(higher, key.factorId) !== metricValue(lower, key.factorId)) {
        result.push({
          higherRankedCandidateId: higher.candidate.candidateId,
          lowerRankedCandidateId: lower.candidate.candidateId,
          decidingFactorId: key.factorId,
        });
        break;
      }
    }
  }
  return result;
}

function rankingSnapshot(rows, policy) {
  return {
    selectedCandidateId: rows[0]?.candidate.candidateId ?? null,
    rankedCandidateIds: rows.map(({ candidate }) => candidate.candidateId),
    scores: scoreSnapshot(rows),
    tieBreakDecisions: tieBreakSnapshot(rows, policy),
  };
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function softEffects(envelope, search) {
  const decision = envelope.evaluation.decision;
  if (!decision?.admittedCandidateIds.length) return [];
  const facts = new Map(search.candidateFacts.map((candidate) => [candidate.candidateId, candidate]));
  const candidates = decision.admittedCandidateIds.map((candidateId) => facts.get(candidateId));
  const matrix = buildContributionMatrix(candidates, envelope.policy.softPreferences);
  const baseline = rankingSnapshot(orderedRows(candidates, envelope.policy, matrix), envelope.policy);
  return envelope.policy.softPreferences.map((preference) => {
    const counterfactual = rankingSnapshot(
      orderedRows(candidates, envelope.policy, matrix, preference.preferenceId),
      envelope.policy,
    );
    const selectedChanged = baseline.selectedCandidateId !== counterfactual.selectedCandidateId;
    const rankChanged = !jsonEqual(baseline.rankedCandidateIds, counterfactual.rankedCandidateIds);
    const scoreChanged = !jsonEqual(baseline.scores, counterfactual.scores);
    const tieBreakDecided = baseline.tieBreakDecisions.length > 0
      || counterfactual.tieBreakDecisions.length > 0;
    const tieBreakChanged = !jsonEqual(
      baseline.tieBreakDecisions,
      counterfactual.tieBreakDecisions,
    );
    return {
      effectVersion: EFFECT_VERSION,
      effectKind: selectedChanged
        ? 'selected-route-changed-under-ablation'
        : rankChanged
          ? 'rank-changed-under-ablation'
          : tieBreakDecided && scoreChanged
            ? 'tie-break-decided-rank'
            : scoreChanged ? 'score-changed-only' : 'no-effect',
      ruleKind: 'soft-preference',
      ruleId: preference.preferenceId,
      operation: 'ablate-one-soft-preference',
      baseline,
      counterfactual,
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

function eligibility(candidate, constraints, excludedId) {
  const outcomes = constraints
    .filter(({ constraintId }) => constraintId !== excludedId)
    .map((constraint) => {
      const value = candidate.observations[constraint.factorId];
      if (!value || value.state !== 'observed') return 'unresolved';
      return value.value === constraint.expectedValue ? 'pass' : 'reject';
    });
  return outcomes.includes('reject') ? 'rejected'
    : outcomes.includes('unresolved') ? 'unresolved' : 'eligible';
}

function hardEffects(envelope, search) {
  if (!search.candidateSet) return [];
  const constraints = envelope.policy.hardConstraints;
  return constraints.map((constraint) => {
    const baselineEligibility = search.candidateFacts.map((candidate) => ({
      candidateId: candidate.candidateId,
      eligibility: eligibility(candidate, constraints, null),
    }));
    const counterfactualEligibility = search.candidateFacts.map((candidate) => ({
      candidateId: candidate.candidateId,
      eligibility: eligibility(candidate, constraints, constraint.constraintId),
    }));
    const changedCandidateIds = baselineEligibility
      .filter((entry, index) => entry.eligibility !== counterfactualEligibility[index].eligibility)
      .map(({ candidateId }) => candidateId);
    return {
      effectVersion: EFFECT_VERSION,
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

export function independentlyComputeCounterfactualEffects(decisionEvaluation) {
  const search = unwrapSearch(decisionEvaluation);
  return Object.freeze([
    ...softEffects(decisionEvaluation, search),
    ...hardEffects(decisionEvaluation, search),
  ].map(Object.freeze));
}
