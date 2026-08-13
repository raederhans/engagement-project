import { admitRouteDecisionExplanation } from './contract_v1.js';

export const ROUTE_DECISION_EXPLANATION_PRESENTATION_VERSION =
  'route-decision-explanation-presentation/v1';

function line(code, text) {
  return Object.freeze({ code, text });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function projectRouteDecisionExplanationPresentation(rawExplanation) {
  const artifact = admitRouteDecisionExplanation(rawExplanation);
  const { explanation, inputIdentity } = artifact;
  const identity = [
    line('policy-identity', `Policy: ${inputIdentity.policyId}; ${inputIdentity.policySchemaVersion}.`),
    line('request-identity', `Request: ${inputIdentity.requestId ?? 'not available'}; graph: ${inputIdentity.graphId ?? 'not available'}.`),
    line('candidate-set-identity', `Candidate set: ${inputIdentity.candidateSetId ?? 'not available'}; revision: ${inputIdentity.candidateSetRevision ?? 'not available'}.`),
    line('content-identity', `Canonical content identity: ${inputIdentity.contentIdentities.canonicalizationVersion}; policy, candidate artifact, and decision evaluation are bound.`),
    line('artifact-identity', `Artifacts: ${inputIdentity.decisionEvaluationSchemaVersion}; ${inputIdentity.candidateArtifactSchemaVersion}; ${inputIdentity.searchResultSchemaVersion}.`),
    line('algorithm-identity', `Algorithms: distinctness=${inputIdentity.algorithmVersions.routeDistinctnessVersion ?? 'not available'}; tieBreak=${inputIdentity.algorithmVersions.searchTieBreakVersion ?? 'not available'}; constraintAggregation=${inputIdentity.algorithmVersions.constraintAggregationVersion ?? 'not available'}; capacity=${inputIdentity.algorithmVersions.capacityPolicyVersion ?? 'not available'}.`),
    line('denominator-identity', `Candidate denominator: requested=${inputIdentity.denominators.requestedCandidateCount ?? 'not available'}; returned=${inputIdentity.denominators.returnedCandidateCount ?? 'not available'}.`),
    line('ranking-identity', `Primary candidate: ${inputIdentity.rankingIdentity.primaryCandidateId ?? 'not available'}; alternatives: ${inputIdentity.rankingIdentity.alternativeCandidateIds.length ? inputIdentity.rankingIdentity.alternativeCandidateIds.join(', ') : 'none'}.`),
    line('search-vocabulary-identity', `Search vocabularies: status=${inputIdentity.searchOutcomeIdentity.vocabularyVersions.status}; termination=${inputIdentity.searchOutcomeIdentity.vocabularyVersions.termination}; completeness=${inputIdentity.searchOutcomeIdentity.vocabularyVersions.completeness}; budget=${inputIdentity.searchOutcomeIdentity.vocabularyVersions.budgetOutcome}; capacity=${inputIdentity.searchOutcomeIdentity.vocabularyVersions.capacityOutcome}.`),
    line('source-identity', `Source: ${inputIdentity.source.sourceId ?? 'not available'}; artifact: ${inputIdentity.source.artifactVersion ?? 'not available'}; mapping: ${inputIdentity.source.mappingPolicyVersion ?? 'not available'}.`),
    line('source-clocks', `Source clocks: sourceAsOf=${inputIdentity.source.clocks.sourceAsOf ?? 'not available'}; retrievedAt=${inputIdentity.source.clocks.retrievedAt ?? 'not available'}; builtAt=${inputIdentity.source.clocks.builtAt ?? 'not available'}; observedAt=${inputIdentity.source.clocks.observedAt ?? 'not available'}.`),
  ];
  const summary = [
    line('evaluation-status', `Evaluation status: ${explanation.outcome.evaluationStatus}.`),
    line('decision-status', `Decision status: ${explanation.outcome.decisionStatus ?? 'not available'}.`),
    line('selected-candidate', `Top-ranked candidate in the provided set: ${explanation.outcome.selectedCandidateId ?? 'none'}.`),
    line('search-status', `Search status and termination: ${explanation.search.status}; ${explanation.search.termination}.`),
    line('search-completeness', `Bounded search completeness: ${explanation.search.routeSearchCompleteness ?? 'not available'}.`),
    line('candidate-count', `Returned candidates: ${explanation.search.candidateCount ?? 'not available'}; requested maximum: ${explanation.search.requestedCandidateCount ?? 'not available'}.`),
    line('constraint-outcome', `Search constraint outcome: ${explanation.search.constraintOutcome ?? 'not available'}.`),
    line('resource-outcomes', `Search budget: ${explanation.search.budgetOutcome ?? 'not available'}; capacity: ${explanation.search.capacityOutcome ?? 'not available'}.`),
  ];
  const reasons = explanation.reasons.map((code) => line(code, `Verified reason: ${code}.`));
  const hardConstraints = explanation.hardConstraintFacts.map((fact) => line(
    fact.reasonCode,
    `Candidate ${fact.candidateId}; constraint ${fact.constraintId}; factor ${fact.factorId}; evidence ${fact.observationState}; outcome ${fact.outcome}.`,
  ));
  const primaryWhyEffects = explanation.primaryWhyEffects.map((effect) => line(
    effect.effectKind,
    `Primary mechanical why effect: ${effect.effectKind}; ${effect.ruleKind} ${effect.ruleId}.`,
  ));
  const counterfactualEffects = explanation.counterfactualEffects.map((effect) => {
    if (effect.ruleKind === 'soft-preference') {
      return line(
        effect.effectKind,
        `Soft-preference ablation ${effect.ruleId}: ${effect.effectKind}; selected changed=${effect.comparisons.selectedChanged}; full rank changed=${effect.comparisons.rankChanged}; score changed=${effect.comparisons.scoreChanged}; tie-break decided rank=${effect.comparisons.tieBreakDecided}; tie-break decision changed=${effect.comparisons.tieBreakChanged}. This is a mechanical ranking effect only.`,
      );
    }
    return line(
      effect.effectKind,
      `Hard-constraint ablation ${effect.ruleId}: ${effect.effectKind}; changed candidate eligibility=${effect.changedCandidateIds.length ? effect.changedCandidateIds.join(', ') : 'none'}. This is a mechanical candidate-eligibility effect only.`,
    );
  });
  const softContributions = explanation.softContributions.map((contribution) => line(
    'score-contribution-not-decisive-reason',
    `Candidate ${contribution.candidateId}; soft preference ${contribution.preferenceId}; factor ${contribution.factorId}; evidence ${contribution.evidenceState}; raw value ${contribution.rawValue}; utility basis points ${contribution.utilityBasisPoints}; weight basis points ${contribution.weightBasisPoints}; weighted score units ${contribution.weightedScoreUnits}. This contribution is not a decisive reason.`,
  ));
  const claimBoundary = [line(
    explanation.claimBoundary.interpretation,
    `No claim is eligible from explanation v1. Prohibited claim tags: ${explanation.claimBoundary.prohibitedClaimTags.join(', ')}.`,
  )];
  const limitations = explanation.limitations.map((code) => line(
    code,
    `Limitation: ${code}.`,
  ));
  return deepFreeze({
    schemaVersion: ROUTE_DECISION_EXPLANATION_PRESENTATION_VERSION,
    textComplete: true,
    sections: {
      identity,
      summary,
      reasons,
      primaryWhyEffects,
      hardConstraints,
      softContributions,
      counterfactualEffects,
      claimBoundary,
      limitations,
    },
    mapModel: null,
  });
}
