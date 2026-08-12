const EVALUATION_SCHEMA_VERSION = 'engagement-route-search-decision-evaluation/v2';
const DECISION_SCHEMA_VERSION = 'engagement-route-search-decision/v1';
const MAX_SAFE_TOTAL = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_FRONTIER_STATES = 4_096;
const MAX_FRONTIER_EDGE_REFERENCES = 65_536;

const ZERO_CANDIDATE_REASON = Object.freeze({
  'invalid-input': 'candidate-search-invalid-input',
  'endpoint-unavailable': 'candidate-search-endpoint-unavailable',
  'no-directed-route-in-bounded-scope': 'candidate-search-no-directed-route-in-bounded-scope',
  'no-eligible-route-in-bounded-scope': 'candidate-search-no-eligible-route-in-bounded-scope',
  'unresolved-constraint-evidence': 'candidate-search-unresolved-constraint-evidence',
  'search-budget-exhausted': 'candidate-search-budget-exhausted',
  'search-capacity-exhausted': 'candidate-search-capacity-exhausted',
});

function compareIdSequences(left, right) {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

function compareLabels(left, right) {
  if (left.objectiveCostUnits < right.objectiveCostUnits) return -1;
  if (left.objectiveCostUnits > right.objectiveCostUnits) return 1;
  return compareIdSequences(left.edgeIds, right.edgeIds);
}

function observationFor(evidenceByEdge, edgeId, factorId) {
  return evidenceByEdge.get(edgeId)?.[factorId] ?? null;
}

function classifyEdge(edgeId, request, evidenceByEdge) {
  let unresolved = false;
  for (const constraint of request.hardConstraints) {
    const observation = observationFor(evidenceByEdge, edgeId, constraint.factorId);
    if (!observation || observation.state !== 'observed') unresolved = true;
    else if (observation.value !== true) return 'failed';
  }
  return unresolved ? 'unresolved' : 'eligible';
}

function popMinimum(frontier) {
  let minimumIndex = 0;
  for (let index = 1; index < frontier.length; index += 1) {
    if (compareLabels(frontier[index], frontier[minimumIndex]) < 0) minimumIndex = index;
  }
  return frontier.splice(minimumIndex, 1)[0];
}

function peekMinimum(frontier) {
  let minimum = frontier[0];
  for (let index = 1; index < frontier.length; index += 1) {
    if (compareLabels(frontier[index], minimum) < 0) minimum = frontier[index];
  }
  return minimum;
}

function enumerateLooplessPaths(context, budget, applyConstraints, requestedCount) {
  const frontier = [{
    nodeId: context.request.originNodeId,
    nodeIds: [context.request.originNodeId],
    edgeIds: [],
    distanceMm: 0n,
    objectiveCostUnits: 0n,
    unresolved: false,
  }];
  const routes = [];
  let frontierEdgeReferences = 0;
  let unresolvedEncountered = false;
  let knownFalseEncountered = false;

  while (frontier.length > 0) {
    const next = peekMinimum(frontier);
    if (next.nodeId === context.request.destinationNodeId) {
      const route = popMinimum(frontier);
      frontierEdgeReferences -= route.edgeIds.length;
      if (applyConstraints && route.unresolved) {
        unresolvedEncountered = true;
        continue;
      }
      routes.push(route);
      if (routes.length === requestedCount) {
        return { outcome: 'requested-count-reached', routes, unresolvedEncountered, knownFalseEncountered };
      }
      continue;
    }
    if (next.edgeIds.length >= context.request.bounds.maxRouteEdgeCount) {
      const bounded = popMinimum(frontier);
      frontierEdgeReferences -= bounded.edgeIds.length;
      continue;
    }
    if (budget.expandedStateCount >= context.request.bounds.maxExpandedStates) {
      return { outcome: 'budget-exhausted', routes, unresolvedEncountered, knownFalseEncountered };
    }

    const current = popMinimum(frontier);
    frontierEdgeReferences -= current.edgeIds.length;
    budget.expandedStateCount += 1;
    for (const edge of context.outgoingByNode.get(current.nodeId) ?? []) {
      if (current.nodeIds.includes(edge.toNodeId)) continue;
      let unresolved = current.unresolved;
      if (applyConstraints) {
        const disposition = classifyEdge(edge.edgeId, context.request, context.evidenceByEdge);
        if (disposition === 'failed') {
          knownFalseEncountered = true;
          continue;
        }
        unresolved ||= disposition === 'unresolved';
      }
      const distanceMm = current.distanceMm + BigInt(edge.distanceMm);
      const objectiveCostUnits = current.objectiveCostUnits + BigInt(edge.objectiveCostUnits);
      if (distanceMm > MAX_SAFE_TOTAL || objectiveCostUnits > MAX_SAFE_TOTAL) {
        return { outcome: 'overflow', routes, unresolvedEncountered, knownFalseEncountered };
      }
      const nextEdgeCount = current.edgeIds.length + 1;
      if (frontier.length >= MAX_FRONTIER_STATES
        || frontierEdgeReferences + nextEdgeCount > MAX_FRONTIER_EDGE_REFERENCES) {
        return { outcome: 'capacity-exhausted', routes, unresolvedEncountered, knownFalseEncountered };
      }
      frontier.push({
        nodeId: edge.toNodeId,
        nodeIds: [...current.nodeIds, edge.toNodeId],
        edgeIds: [...current.edgeIds, edge.edgeId],
        distanceMm,
        objectiveCostUnits,
        unresolved,
      });
      frontierEdgeReferences += nextEdgeCount;
    }
  }
  return { outcome: 'frontier-exhausted', routes, unresolvedEncountered, knownFalseEncountered };
}

function invalidRequest(graph, request) {
  return !graph || !request || request.graphId !== graph.graphId
    || !Number.isSafeInteger(request.requestedCandidateCount)
    || request.requestedCandidateCount < 1
    || !request.bounds
    || !Number.isSafeInteger(request.bounds.maxExpandedStates)
    || request.bounds.maxExpandedStates < 1
    || !Number.isSafeInteger(request.bounds.maxRouteEdgeCount)
    || request.bounds.maxRouteEdgeCount < 0
    || !Array.isArray(request.hardConstraints);
}

function searchIndependent(graph, request, edgeFactorEvidence) {
  if (invalidRequest(graph, request)) {
    return { termination: 'invalid-input', routes: [], expandedStateCount: null, unresolved: null };
  }
  const nodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  if (!nodeIds.has(request.originNodeId) || !nodeIds.has(request.destinationNodeId)) {
    return { termination: 'endpoint-unavailable', routes: [], expandedStateCount: null, unresolved: null };
  }
  if (request.originNodeId === request.destinationNodeId && request.hardConstraints.length > 0) {
    return { termination: 'unresolved-constraint-evidence', routes: [], expandedStateCount: 0, unresolved: true };
  }

  const outgoingByNode = new Map(graph.nodes.map(({ nodeId }) => [nodeId, []]));
  for (const edge of graph.edges) outgoingByNode.get(edge.fromNodeId)?.push(edge);
  for (const edges of outgoingByNode.values()) {
    edges.sort((left, right) => left.edgeId < right.edgeId ? -1 : left.edgeId > right.edgeId ? 1 : 0);
  }
  const evidenceByEdge = new Map(
    edgeFactorEvidence.edgeEvidence.map(({ edgeId, observations }) => [edgeId, observations]),
  );
  const context = { request, outgoingByNode, evidenceByEdge };
  const budget = { expandedStateCount: 0 };
  const constrained = enumerateLooplessPaths(
    context,
    budget,
    true,
    request.requestedCandidateCount,
  );
  if (constrained.outcome === 'overflow') {
    return { termination: 'invalid-input', routes: [], expandedStateCount: null, unresolved: null };
  }
  if (constrained.outcome === 'requested-count-reached') {
    return {
      termination: 'requested-candidate-count-reached', routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount, unresolved: null,
    };
  }
  if (constrained.outcome === 'budget-exhausted') {
    return {
      termination: 'search-budget-exhausted', routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount, unresolved: constrained.unresolvedEncountered,
    };
  }
  if (constrained.outcome === 'capacity-exhausted') {
    return {
      termination: 'search-capacity-exhausted', routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount, unresolved: constrained.unresolvedEncountered,
    };
  }
  if (constrained.routes.length > 0) {
    return {
      termination: constrained.unresolvedEncountered
        ? 'unresolved-constraint-evidence' : 'bounded-search-space-exhausted',
      routes: constrained.routes,
      expandedStateCount: budget.expandedStateCount,
      unresolved: constrained.unresolvedEncountered,
    };
  }
  if (request.hardConstraints.length === 0) {
    return {
      termination: 'no-directed-route-in-bounded-scope', routes: [],
      expandedStateCount: budget.expandedStateCount, unresolved: false,
    };
  }
  if (constrained.unresolvedEncountered) {
    return {
      termination: 'unresolved-constraint-evidence', routes: [],
      expandedStateCount: budget.expandedStateCount, unresolved: true,
    };
  }
  if (!constrained.knownFalseEncountered) {
    return {
      termination: 'no-directed-route-in-bounded-scope', routes: [],
      expandedStateCount: budget.expandedStateCount, unresolved: false,
    };
  }

  const topology = enumerateLooplessPaths(context, budget, false, 1);
  if (topology.outcome === 'overflow') {
    return { termination: 'invalid-input', routes: [], expandedStateCount: null, unresolved: null };
  }
  if (topology.outcome === 'budget-exhausted' || topology.outcome === 'capacity-exhausted') {
    return {
      termination: topology.outcome === 'budget-exhausted'
        ? 'search-budget-exhausted' : 'search-capacity-exhausted',
      routes: [], expandedStateCount: budget.expandedStateCount, unresolved: false,
    };
  }
  return {
    termination: topology.routes.length > 0
      ? 'no-eligible-route-in-bounded-scope' : 'no-directed-route-in-bounded-scope',
    routes: [], expandedStateCount: budget.expandedStateCount, unresolved: false,
  };
}

function constraintOutcome(termination, candidateCount, hasConstraints, unresolved) {
  if (!hasConstraints) return 'not-required';
  if (termination === 'no-directed-route-in-bounded-scope') return 'not-evaluated';
  if (termination === 'no-eligible-route-in-bounded-scope') {
    return 'no-eligible-route-in-bounded-scope-proven';
  }
  if (termination === 'requested-candidate-count-reached') return 'eligible-candidates-returned';
  if (unresolved) return 'unresolved-evidence';
  if (candidateCount > 0) return 'eligible-candidates-returned';
  return 'no-eligible-route-not-proven';
}

function searchMetadata(search, request) {
  if (search.termination === 'invalid-input') {
    return {
      status: 'rejected', requestedCandidateCount: null, candidateCount: 0,
      expandedStateCount: null, routeSearchCompleteness: null, constraintOutcome: null,
      budgetOutcome: null, capacityOutcome: null, unresolvedEvidenceEncountered: null,
    };
  }
  if (search.termination === 'endpoint-unavailable') {
    return {
      status: 'not-started', requestedCandidateCount: request.requestedCandidateCount,
      candidateCount: 0, expandedStateCount: null, routeSearchCompleteness: null,
      constraintOutcome: null, budgetOutcome: null, capacityOutcome: null,
      unresolvedEvidenceEncountered: null,
    };
  }
  const stopped = ['search-budget-exhausted', 'search-capacity-exhausted'].includes(search.termination);
  const complete = ['bounded-search-space-exhausted', 'no-directed-route-in-bounded-scope',
    'no-eligible-route-in-bounded-scope', 'unresolved-constraint-evidence'].includes(search.termination);
  return {
    status: stopped ? 'stopped' : 'completed',
    requestedCandidateCount: request.requestedCandidateCount,
    candidateCount: search.routes.length,
    expandedStateCount: search.expandedStateCount,
    routeSearchCompleteness: complete ? 'complete-within-bounds' : 'not-proven',
    constraintOutcome: constraintOutcome(
      search.termination,
      search.routes.length,
      request.hardConstraints.length > 0,
      search.unresolved,
    ),
    budgetOutcome: search.termination === 'search-budget-exhausted' ? 'exhausted' : 'within-budget',
    capacityOutcome: search.termination === 'search-capacity-exhausted' ? 'exhausted' : 'within-capacity',
    unresolvedEvidenceEncountered: search.unresolved,
  };
}

function routeMetrics(route) {
  return {
    distanceMm: Number(route.distanceMm),
    objectiveCostUnits: Number(route.objectiveCostUnits),
  };
}

function scoreCandidate(candidate, metrics, policy) {
  const contributions = [...policy.softPreferences]
    .sort((left, right) => left.preferenceId < right.preferenceId ? -1 : left.preferenceId > right.preferenceId ? 1 : 0)
    .map((preference) => {
      const rawValue = preference.factorId === 'distance-mm'
        ? metrics.distanceMm : metrics.objectiveCostUnits;
      const clamped = Math.min(preference.rangeMax, Math.max(preference.rangeMin, rawValue));
      const rangeSpan = preference.rangeMax - preference.rangeMin;
      const utilityNumerator = (preference.rangeMax - clamped) * 10_000;
      const utilityBasisPoints = Math.floor(utilityNumerator / rangeSpan);
      const weightedScoreUnits = utilityBasisPoints * preference.weightBasisPoints;
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
  return {
    candidate,
    metrics,
    contributions,
    totalScoreUnits: contributions.reduce((sum, item) => sum + item.weightedScoreUnits, 0),
  };
}

function tieBreakValue(scored, factorId) {
  if (factorId === 'score-units') return scored.totalScoreUnits;
  if (factorId === 'objective-cost-units') return scored.metrics.objectiveCostUnits;
  if (factorId === 'distance-mm') return scored.metrics.distanceMm;
  return scored.candidate.candidateId;
}

function compareScored(left, right, policy) {
  for (const entry of policy.tieBreak) {
    const leftValue = tieBreakValue(left, entry.factorId);
    const rightValue = tieBreakValue(right, entry.factorId);
    const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    if (comparison !== 0) return entry.direction === 'ascending' ? comparison : -comparison;
  }
  return 0;
}

function candidatefulDecision(search, policy) {
  const candidates = search.routes.map((route, index) => ({
    candidateId: `candidate:${index + 1}`,
    edgeIds: [...route.edgeIds],
    metrics: routeMetrics(route),
  }));
  const hardConstraints = [...policy.hardConstraints]
    .sort((left, right) => left.constraintId < right.constraintId ? -1 : left.constraintId > right.constraintId ? 1 : 0);
  const hardConstraintTrace = candidates.flatMap((candidate) => hardConstraints.map((constraint) => ({
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
  })));
  const scored = candidates.map((candidate) => scoreCandidate(candidate, candidate.metrics, policy));
  const ranked = [...scored].sort((left, right) => compareScored(left, right, policy));
  const rankedIds = ranked.map(({ candidate }) => candidate.candidateId);
  return {
    evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationStatus: 'evaluated',
    reasonCode: 'provided-candidate-set-evaluated',
    decisionSchemaVersion: DECISION_SCHEMA_VERSION,
    scope: 'provided-candidate-set',
    decisionStatus: 'ranked-in-provided-set',
    admittedCandidateIds: [...rankedIds],
    rankedCandidateIds: rankedIds,
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
      rankingTrace: ranked.map((item, index) => ({
        candidateId: item.candidate.candidateId,
        stage: 'ranking',
        outcome: 'ranked',
        totalScoreUnits: item.totalScoreUnits,
        rank: index + 1,
        tieBreakValues: policy.tieBreak.map((entry) => ({
          factorId: entry.factorId,
          direction: entry.direction,
          value: tieBreakValue(item, entry.factorId),
        })),
        decidingFactorId: null,
        reasonCode: 'candidate-ranked',
      })),
    },
  };
}

function zeroCandidateDecision(termination) {
  return {
    evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationStatus: 'not-evaluated',
    reasonCode: ZERO_CANDIDATE_REASON[termination],
    decisionSchemaVersion: null,
    scope: null,
    decisionStatus: null,
    admittedCandidateIds: [],
    rankedCandidateIds: [],
    rejectedCandidateIds: [],
    unresolvedCandidateIds: [],
    publicExplanation: {
      hardConstraintTrace: [],
      softPreferenceTrace: [],
      candidateDispositions: [],
      rankingTrace: [],
    },
  };
}

export function evaluateIndependentRouteCase({ graphArtifact, searchRequest, edgeFactorEvidence, decisionPolicy }) {
  const search = searchIndependent(graphArtifact, searchRequest, edgeFactorEvidence);
  const orderedCandidates = search.routes.map((route, index) => ({
    candidateId: `candidate:${index + 1}`,
    edgeIds: [...route.edgeIds],
  }));
  const providedSetDecision = orderedCandidates.length > 0
    ? candidatefulDecision(search, decisionPolicy)
    : zeroCandidateDecision(search.termination);
  return {
    termination: search.termination,
    searchMetadata: searchMetadata(search, searchRequest),
    orderedCandidates,
    providedSetDecision,
  };
}
