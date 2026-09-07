import {
  ROUTE_SEARCH_TERMINATIONS,
} from '../candidate_search_v2.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  ROUTE_SEARCH_DECISION_VERSION,
} from '../../evaluator/search_v2.js';
import {
  S3_ZERO_CANDIDATE_REASON_BY_TERMINATION,
  admitExactLiteral,
  booleanValue,
  enumValue,
  exactObject,
  fail,
  id,
  integer,
  strictArray,
  uniqueIds,
} from './model_v1.js';

const ROUTE_SEARCH_TERMINATION_SET = new Set(ROUTE_SEARCH_TERMINATIONS);

function admitCanonicalCandidate(raw, index, label) {
  const value = exactObject(raw, `${label}[${index}]`, ['candidateId', 'edgeIds']);
  const candidateId = id(value.candidateId, `${label}[${index}].candidateId`);
  const expectedCandidateId = `candidate:${index + 1}`;
  if (candidateId !== expectedCandidateId) {
    fail(`${label}[${index}].candidateId must be ${expectedCandidateId} under the frozen oracle candidate-id rule`);
  }
  return {
    candidateId,
    edgeIds: uniqueIds(value.edgeIds, `${label}[${index}].edgeIds`, 100_000),
  };
}

export function emptyPublicExplanation() {
  return {
    hardConstraintTrace: [],
    softPreferenceTrace: [],
    candidateDispositions: [],
    rankingTrace: [],
  };
}

function expectedConstraintOutcome(
  termination,
  candidateCount,
  hasConstraints,
  unresolvedEvidenceEncountered,
) {
  if (!hasConstraints) return 'not-required';
  if (termination === 'no-directed-route-in-bounded-scope') return 'not-evaluated';
  if (termination === 'no-eligible-route-in-bounded-scope') {
    return 'no-eligible-route-in-bounded-scope-proven';
  }
  if (termination === 'requested-candidate-count-reached') {
    return 'eligible-candidates-returned';
  }
  if (unresolvedEvidenceEncountered) return 'unresolved-evidence';
  if (candidateCount > 0) return 'eligible-candidates-returned';
  return 'no-eligible-route-not-proven';
}

function admitCanonicalSearchMetadata(raw, termination, candidateCount, context, label) {
  if (!context?.searchRequest) fail(`${label} requires the frozen oracle search request`);
  const value = exactObject(raw, label, [
    'status', 'requestedCandidateCount', 'candidateCount', 'expandedStateCount',
    'routeSearchCompleteness', 'constraintOutcome', 'budgetOutcome', 'capacityOutcome',
    'unresolvedEvidenceEncountered',
  ]);
  const request = context.searchRequest;
  const requestedCandidateCount = request.requestedCandidateCount;
  const hasConstraints = request.hardConstraints.length > 0;
  let expected;
  if (termination === 'invalid-input') {
    if (candidateCount !== 0) fail(`${label} invalid-input must have zero candidates`);
    if (context.denominatorKind !== 'conformance' || context.probeKind !== 'invalid-input') {
      fail(`${label} invalid-input is only applicable to the invalid-input conformance probe`);
    }
    expected = {
      status: 'rejected', requestedCandidateCount: null, candidateCount: 0,
      expandedStateCount: null, routeSearchCompleteness: null, constraintOutcome: null,
      budgetOutcome: null, capacityOutcome: null, unresolvedEvidenceEncountered: null,
    };
  } else if (termination === 'endpoint-unavailable') {
    fail(`${label} endpoint-unavailable is not applicable in S3 v1 admitted graph scenarios`);
  } else {
    const unresolvedEvidenceEncountered = termination === 'requested-candidate-count-reached'
      ? admitExactLiteral(
        value.unresolvedEvidenceEncountered,
        null,
        `${label}.unresolvedEvidenceEncountered`,
      )
      : booleanValue(
        value.unresolvedEvidenceEncountered,
        `${label}.unresolvedEvidenceEncountered`,
      );
    const expandedStateCount = integer(
      value.expandedStateCount,
      `${label}.expandedStateCount`,
      { max: request.bounds.maxExpandedStates },
    );
    const constraintOutcome = expectedConstraintOutcome(
      termination,
      candidateCount,
      hasConstraints,
      unresolvedEvidenceEncountered,
    );
    if (!hasConstraints && unresolvedEvidenceEncountered) {
      fail(`${label} unresolved evidence cannot be reported without hard constraints`);
    }
    if (unresolvedEvidenceEncountered && ![
      'unresolved-constraint-evidence',
      'search-budget-exhausted',
      'search-capacity-exhausted',
    ].includes(termination)) {
      fail(`${label} unresolved evidence is inconsistent with the terminal`);
    }
    if (termination === 'requested-candidate-count-reached') {
      if (candidateCount !== requestedCandidateCount) {
        fail(`${label} requested-count terminal requires exactly requestedCandidateCount candidates`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'not-proven', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'bounded-search-space-exhausted') {
      if (candidateCount === 0 || candidateCount >= requestedCandidateCount) {
        fail(`${label} bounded-search-space terminal requires between one and K-1 candidates`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'no-directed-route-in-bounded-scope') {
      if (candidateCount !== 0) fail(`${label} no-directed-route terminal requires zero candidates`);
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount: 0, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'no-eligible-route-in-bounded-scope') {
      if (candidateCount !== 0 || !hasConstraints) {
        fail(`${label} no-eligible-route terminal requires zero candidates and hard constraints`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount: 0, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'unresolved-constraint-evidence') {
      if (candidateCount >= requestedCandidateCount || !hasConstraints) {
        fail(`${label} unresolved-constraint terminal requires fewer than K candidates and hard constraints`);
      }
      if (!unresolvedEvidenceEncountered) {
        fail(`${label} unresolved-constraint terminal requires encountered unresolved evidence`);
      }
      expected = {
        status: 'completed', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'complete-within-bounds', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'search-budget-exhausted') {
      if (candidateCount >= requestedCandidateCount
        || expandedStateCount !== request.bounds.maxExpandedStates) {
        fail(`${label} budget terminal requires fewer than K candidates and the exact expansion bound`);
      }
      expected = {
        status: 'stopped', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'not-proven', constraintOutcome,
        budgetOutcome: 'exhausted', capacityOutcome: 'within-capacity',
        unresolvedEvidenceEncountered,
      };
    } else if (termination === 'search-capacity-exhausted') {
      if (candidateCount >= requestedCandidateCount) {
        fail(`${label} capacity terminal requires fewer than K candidates`);
      }
      expected = {
        status: 'stopped', requestedCandidateCount, candidateCount, expandedStateCount,
        routeSearchCompleteness: 'not-proven', constraintOutcome,
        budgetOutcome: 'within-budget', capacityOutcome: 'exhausted',
        unresolvedEvidenceEncountered,
      };
    } else {
      fail(`${label} termination is outside the frozen S2 termination set`);
    }
  }
  return admitExactLiteral(value, expected, label);
}

export function canonicalSearchMetadata(result) {
  const candidateSet = result.candidateSet;
  return {
    status: result.status,
    requestedCandidateCount: result.request?.requestedCandidateCount ?? null,
    candidateCount: result.candidateFacts.length,
    expandedStateCount: candidateSet?.expandedStateCount ?? null,
    routeSearchCompleteness: candidateSet?.completeness.routeSearch ?? null,
    constraintOutcome: candidateSet?.constraintOutcome ?? null,
    budgetOutcome: candidateSet?.budgetOutcome ?? null,
    capacityOutcome: candidateSet?.capacityOutcome ?? null,
    unresolvedEvidenceEncountered: candidateSet === null
      || result.termination === 'requested-candidate-count-reached'
      ? null
      : candidateSet.constraintOutcome === 'unresolved-evidence',
  };
}

function expectedZeroCandidateDecision(termination, label) {
  const reasonCode = S3_ZERO_CANDIDATE_REASON_BY_TERMINATION[termination];
  if (!reasonCode) fail(`${label} zero-candidate termination has no frozen evaluator mapping`);
  return {
    evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
    evaluationStatus: 'not-evaluated',
    reasonCode,
    decisionSchemaVersion: null,
    scope: null,
    decisionStatus: null,
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    rejectedCandidateIds: [],
    unresolvedCandidateIds: [],
    publicExplanation: emptyPublicExplanation(),
  };
}

function canonicalCandidateMetrics(candidate, context, label) {
  const edgeById = new Map(context.graphArtifact.edges.map((edge) => [edge.edgeId, edge]));
  const evidenceByEdge = new Map(
    context.edgeFactorEvidence.edgeEvidence.map((entry) => [entry.edgeId, entry.observations]),
  );
  let cursor = context.originNodeId;
  let distanceMm = 0;
  let objectiveCostUnits = 0;
  const visitedNodes = new Set([cursor]);
  for (const edgeId of candidate.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge || edge.fromNodeId !== cursor) {
      fail(`${label} edge path is not contiguous in the frozen oracle graph`);
    }
    cursor = edge.toNodeId;
    if (visitedNodes.has(cursor)) fail(`${label} edge path must be loopless`);
    visitedNodes.add(cursor);
    distanceMm += edge.distanceMm;
    objectiveCostUnits += edge.objectiveCostUnits;
    if (!Number.isSafeInteger(distanceMm) || !Number.isSafeInteger(objectiveCostUnits)) {
      fail(`${label} path metrics exceed safe integer bounds`);
    }
    const observations = evidenceByEdge.get(edgeId);
    if (!observations) fail(`${label} edge path is outside the frozen evidence artifact`);
    for (const constraint of context.policy.hardConstraints) {
      const observation = observations[constraint.factorId];
      if (!observation || observation.state !== 'observed'
        || observation.value !== constraint.expectedValue) {
        fail(`${label} returned oracle candidate violates its frozen hard-constraint evidence`);
      }
    }
  }
  if (cursor !== context.destinationNodeId) {
    fail(`${label} edge path does not terminate at the frozen oracle destination`);
  }
  return { distanceMm, objectiveCostUnits };
}

function preferenceRawValue(metrics, factorId, label) {
  if (factorId === 'distance-mm') return metrics.distanceMm;
  if (factorId === 'objective-cost-units') return metrics.objectiveCostUnits;
  fail(`${label} uses an unsupported frozen scoring factor`);
}

function scoreCanonicalCandidate(candidate, metrics, policy, label) {
  const contributions = [...policy.softPreferences]
    .sort((left, right) => left.preferenceId < right.preferenceId ? -1 : left.preferenceId > right.preferenceId ? 1 : 0)
    .map((preference) => {
      const rawValue = preferenceRawValue(metrics, preference.factorId, label);
      const clampedValue = Math.min(preference.rangeMax, Math.max(preference.rangeMin, rawValue));
      const rangeSpan = preference.rangeMax - preference.rangeMin;
      const utilityNumerator = (preference.rangeMax - clampedValue) * 10_000;
      const utilityBasisPoints = Math.floor(utilityNumerator / rangeSpan);
      const weightedScoreUnits = utilityBasisPoints * preference.weightBasisPoints;
      if (![rangeSpan, utilityNumerator, utilityBasisPoints, weightedScoreUnits]
        .every(Number.isSafeInteger)) {
        fail(`${label} scoring arithmetic is not a safe integer`);
      }
      return {
        candidateId: candidate.candidateId,
        stage: 'soft-preference',
        preferenceId: preference.preferenceId,
        factorId: preference.factorId,
        observationState: rawValue === 0 ? 'zero' : 'observed',
        rawValue,
        unit: preference.factorId === 'distance-mm' ? 'millimetres' : 'cost-units',
        direction: 'minimize',
        rangeMin: preference.rangeMin,
        rangeMax: preference.rangeMax,
        rangeSpan,
        utilityNumerator,
        utilityBasisPoints,
        weightBasisPoints: preference.weightBasisPoints,
        weightedScoreUnits,
        outcome: 'scored',
        reasonCode: 'soft-preference-scored',
      };
    });
  const totalScoreUnits = contributions.reduce(
    (sum, contribution) => sum + contribution.weightedScoreUnits,
    0,
  );
  if (!Number.isSafeInteger(totalScoreUnits)) fail(`${label} total score is not a safe integer`);
  return { candidate, metrics, contributions, totalScoreUnits };
}

function tieBreakValue(scored, factorId) {
  if (factorId === 'score-units') return scored.totalScoreUnits;
  if (factorId === 'objective-cost-units') return scored.metrics.objectiveCostUnits;
  if (factorId === 'distance-mm') return scored.metrics.distanceMm;
  if (factorId === 'candidate-id') return scored.candidate.candidateId;
  fail('frozen evaluator tie-break contains an unsupported factor');
}

function compareScoredCandidates(left, right, policy) {
  for (const entry of policy.tieBreak) {
    const leftValue = tieBreakValue(left, entry.factorId);
    const rightValue = tieBreakValue(right, entry.factorId);
    const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    if (comparison !== 0) return entry.direction === 'ascending' ? comparison : -comparison;
  }
  return 0;
}

function compareEdgeIdSequences(left, right) {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

function assertOracleCandidateGenerationOrder(scored, label) {
  const routeKeys = new Set();
  for (let index = 0; index < scored.length; index += 1) {
    const current = scored[index];
    const routeKey = JSON.stringify(current.candidate.edgeIds);
    if (routeKeys.has(routeKey)) {
      fail(`${label}.orderedCandidates must contain distinct directed-edge sequences`);
    }
    routeKeys.add(routeKey);
    if (index === 0) continue;
    const previous = scored[index - 1];
    const objectiveComparison = previous.metrics.objectiveCostUnits
      - current.metrics.objectiveCostUnits;
    if (objectiveComparison > 0 || (objectiveComparison === 0
      && compareEdgeIdSequences(previous.candidate.edgeIds, current.candidate.edgeIds) >= 0)) {
      fail(`${label}.orderedCandidates must preserve objective-cost then directed-edge-sequence generation order`);
    }
  }
}

function expectedCandidatefulDecision(orderedCandidates, context, label) {
  if (!context) fail(`${label} candidateful outcome requires frozen graph/evidence/policy context`);
  const candidatesById = [...orderedCandidates]
    .sort((left, right) => left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0);
  const hardConstraints = [...context.policy.hardConstraints]
    .sort((left, right) => left.constraintId < right.constraintId ? -1 : left.constraintId > right.constraintId ? 1 : 0);
  const hardConstraintTrace = [];
  const scored = candidatesById.map((candidate, index) => {
    const candidateLabel = `${label}.orderedCandidates[${index}]`;
    const metrics = canonicalCandidateMetrics(candidate, context, candidateLabel);
    for (const constraint of hardConstraints) {
      hardConstraintTrace.push({
        candidateId: candidate.candidateId,
        stage: 'hard-constraint',
        constraintId: constraint.constraintId,
        factorId: constraint.factorId,
        observationState: 'observed',
        actualValue: constraint.expectedValue,
        operator: 'equals',
        expectedValue: constraint.expectedValue,
        outcome: 'pass',
        reasonCode: 'hard-constraint-passed',
      });
    }
    return scoreCanonicalCandidate(candidate, metrics, context.policy, candidateLabel);
  });
  assertOracleCandidateGenerationOrder(scored, label);
  const ranked = [...scored].sort((left, right) => compareScoredCandidates(left, right, context.policy));
  const rankedCandidateIds = ranked.map(({ candidate }) => candidate.candidateId);
  return {
    evaluationSchemaVersion: ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
    evaluationStatus: 'evaluated',
    reasonCode: 'provided-candidate-set-evaluated',
    decisionSchemaVersion: ROUTE_SEARCH_DECISION_VERSION,
    scope: 'provided-candidate-set',
    decisionStatus: 'ranked-in-provided-set',
    admittedCandidateIds: [...rankedCandidateIds],
    rankedCandidateIds,
    rejectedCandidateIds: [],
    unresolvedCandidateIds: [],
    publicExplanation: {
      hardConstraintTrace,
      softPreferenceTrace: scored.flatMap(({ contributions }) => contributions),
      candidateDispositions: scored.map(({ candidate, totalScoreUnits }) => ({
        candidateId: candidate.candidateId,
        stage: 'candidate-disposition',
        outcome: 'admitted',
        constraintIds: [],
        preferenceIds: [],
        totalScoreUnits,
        reasonCode: 'candidate-admitted',
      })),
      rankingTrace: ranked.map((candidate, index) => ({
        candidateId: candidate.candidate.candidateId,
        stage: 'ranking',
        outcome: 'ranked',
        totalScoreUnits: candidate.totalScoreUnits,
        rank: index + 1,
        tieBreakValues: context.policy.tieBreak.map((entry) => ({
          factorId: entry.factorId,
          direction: entry.direction,
          value: tieBreakValue(candidate, entry.factorId),
        })),
        decidingFactorId: null,
        reasonCode: 'candidate-ranked',
      })),
    },
  };
}

export function admitCanonicalOutcome(raw, label, context = null) {
  const value = exactObject(raw, label, [
    'termination', 'searchMetadata', 'orderedCandidates', 'providedSetDecision',
  ]);
  const termination = enumValue(
    value.termination,
    ROUTE_SEARCH_TERMINATION_SET,
    `${label}.termination`,
  );
  const orderedCandidates = strictArray(value.orderedCandidates, `${label}.orderedCandidates`, { max: 5 })
    .map((candidate, index) => admitCanonicalCandidate(candidate, index, `${label}.orderedCandidates`));
  if (new Set(orderedCandidates.map(({ candidateId }) => candidateId)).size !== orderedCandidates.length) {
    fail(`${label}.orderedCandidates candidateIds must be unique`);
  }
  const searchMetadata = admitCanonicalSearchMetadata(
    value.searchMetadata,
    termination,
    orderedCandidates.length,
    context,
    `${label}.searchMetadata`,
  );
  const expectedDecision = orderedCandidates.length === 0
    ? expectedZeroCandidateDecision(termination, label)
    : expectedCandidatefulDecision(orderedCandidates, context, label);
  const providedSetDecision = admitExactLiteral(
    value.providedSetDecision,
    expectedDecision,
    `${label}.providedSetDecision`,
  );
  return {
    termination,
    searchMetadata,
    orderedCandidates,
    providedSetDecision,
  };
}
