const EXPLANATION_BY_REASON_CODE = Object.freeze({
  'hard-constraint-passed': 'The observed value passed this hard constraint.',
  'hard-constraint-failed': 'The observed value failed this hard constraint.',
  'hard-constraint-unknown-unresolved': 'The hard constraint has an unknown observation.',
  'hard-constraint-unavailable-unresolved': 'The hard constraint observation is unavailable.',
  'hard-constraint-partial-unresolved': 'The hard constraint observation is partial.',
  'hard-constraint-stale-unresolved': 'The hard constraint observation is stale.',
  'hard-constraint-invalid-unresolved': 'The hard constraint observation is invalid.',
  'hard-constraint-missing-unresolved': 'The hard constraint observation is missing.',
  'soft-preference-scored': 'The observed value contributed to the fixed-point score.',
  'soft-preference-unknown-unresolved': 'The preference has an unknown observation.',
  'soft-preference-unavailable-unresolved': 'The preference observation is unavailable.',
  'soft-preference-partial-unresolved': 'The preference observation is partial.',
  'soft-preference-stale-unresolved': 'The preference observation is stale.',
  'soft-preference-invalid-unresolved': 'The preference observation is invalid.',
  'soft-preference-missing-unresolved': 'The preference observation is missing.',
  'candidate-hard-constraint-rejected': 'The candidate failed at least one hard constraint.',
  'candidate-hard-constraint-unresolved': 'The candidate has an unresolved hard constraint.',
  'candidate-soft-preference-unresolved': 'The candidate has an unresolved active preference.',
  'candidate-admitted': 'The candidate passed hard constraints and active preferences were scored.',
  'candidate-ranked': 'The candidate received a deterministic rank.',
  hard_constraint_known_pass: 'The known observation passed this hard constraint.',
  hard_constraint_known_fail: 'The known observation failed this hard constraint.',
  hard_constraint_unknown_unresolved: 'The hard constraint has an unknown observation.',
  hard_constraint_unavailable_unresolved: 'The hard constraint observation is unavailable.',
  hard_constraint_partial_unresolved: 'The hard constraint observation is partial.',
  hard_constraint_stale_unresolved: 'The hard constraint observation is stale.',
  hard_constraint_invalid_unresolved: 'The hard constraint observation is invalid.',
  hard_constraint_malformed_unresolved: 'The hard constraint observation is malformed.',
  hard_constraint_unsupported_unresolved: 'The hard constraint observation state is unsupported.',
  hard_constraint_missing_unresolved: 'The hard constraint observation is missing.',
  soft_preference_known_scored: 'The known observation contributed to the fixed-point score.',
  soft_preference_unknown_unresolved: 'The preference has an unknown observation.',
  soft_preference_unavailable_unresolved: 'The preference observation is unavailable.',
  soft_preference_partial_unresolved: 'The preference observation is partial.',
  soft_preference_stale_unresolved: 'The preference observation is stale.',
  soft_preference_invalid_unresolved: 'The preference observation is invalid.',
  soft_preference_malformed_unresolved: 'The preference observation is malformed.',
  soft_preference_unsupported_unresolved: 'The preference observation state is unsupported.',
  soft_preference_missing_unresolved: 'The preference observation is missing.',
  soft_preference_score_unsafe: 'The preference score exceeds the supported integer range.',
  candidate_score_unsafe: 'The candidate score exceeds the supported integer range.',
  candidate_hard_constraint_rejected: 'The candidate failed at least one hard constraint.',
  candidate_hard_constraint_unresolved: 'The candidate has an unresolved hard constraint.',
  candidate_soft_preference_unresolved: 'The candidate has an unresolved active preference.',
  candidate_admitted: 'The candidate passed hard constraints and all active preferences were scored.',
  candidate_ranked: 'The candidate received a deterministic rank.',
});

/**
 * Maps already-produced trace records to copy-neutral explanation records.
 * It never reads candidates or policies and therefore cannot re-run a rule.
 */
export function explainDecisionTrace(trace) {
  if (!Array.isArray(trace)) return Object.freeze([]);
  return Object.freeze(trace.map((entry) => {
    const publicOrPrivateRuleId = entry?.ruleId ?? entry?.constraintId ?? entry?.preferenceId;
    return Object.freeze({
      candidateId: typeof entry?.candidateId === 'string' ? entry.candidateId : null,
      ruleId: typeof publicOrPrivateRuleId === 'string' ? publicOrPrivateRuleId : null,
      reasonCode: typeof entry?.reasonCode === 'string' ? entry.reasonCode : 'trace_reason_unsupported',
      message: EXPLANATION_BY_REASON_CODE[entry?.reasonCode]
        ?? 'No explanation is available for this trace reason.',
    });
  }));
}
