import { ROUTE_SEARCH_CAPACITY_POLICY } from '../../../src/route_decision/contracts/candidate_search_v2.js';

export const UNRESOLVED_STATES = Object.freeze([
  'unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing',
]);

export function observation(factorId, value = true, state = 'observed') {
  return {
    schemaVersion: 'engagement-route-source-observation/v1',
    factorId,
    state,
    value: state === 'observed' ? value : null,
    unit: 'boolean',
    reasonCode: state === 'observed' ? null : {
      unknown: 'not-observed',
      unavailable: 'source-unavailable',
      partial: 'coverage-partial',
      stale: 'observation-stale',
      invalid: 'source-invalid',
    }[state],
    sourceId: 'synthetic-s4-explanation',
  };
}

export function candidate(candidateId, objectiveCostUnits, distanceMm, observations = {}) {
  return {
    schemaVersion: 'engagement-route-candidate-facts/v1',
    candidateId,
    edgeIds: [`${candidateId}-edge`],
    distanceMm,
    objectiveCostUnits,
    observations,
    provenance: { graphId: 'graph-s4-explanation', dataClassification: 'synthetic' },
  };
}

export function policy(overrides = {}) {
  return {
    schemaVersion: 'engagement-route-decision-policy/v1',
    policyId: 'policy-s4-explanation',
    hardConstraints: [],
    softPreferences: [
      {
        preferenceId: 'objective',
        needTag: 'minimize-objective-cost',
        factorId: 'objective-cost-units',
        operator: 'minimize',
        rangeMin: 0,
        rangeMax: 1_000,
        weightBasisPoints: 5_000,
      },
      {
        preferenceId: 'distance',
        needTag: 'minimize-distance',
        factorId: 'distance-mm',
        operator: 'minimize',
        rangeMin: 0,
        rangeMax: 10_000,
        weightBasisPoints: 5_000,
      },
    ],
    weightBasisPointsTotal: 10_000,
    tieBreak: [
      { factorId: 'score-units', direction: 'descending' },
      { factorId: 'distance-mm', direction: 'ascending' },
      { factorId: 'candidate-id', direction: 'ascending' },
    ],
    ...overrides,
  };
}

export function hardConstraint() {
  return {
    constraintId: 'requires-step-free',
    needTag: 'require-capability',
    factorId: 'step-free',
    operator: 'equals',
    expectedValue: true,
    unresolvedStates: [...UNRESOLVED_STATES],
  };
}

export function request(overrides = {}) {
  return {
    schemaVersion: 'engagement-route-candidate-search-request/v1',
    requestId: 'request-s4-explanation',
    graphId: 'graph-s4-explanation',
    mode: 'walk',
    originNodeId: 'origin',
    destinationNodeId: 'destination',
    decisionPolicyId: 'policy-s4-explanation',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 2,
    routeDistinctnessVersion: 'ordered-directed-edge-id-sequence/v1',
    tieBreakVersion: 'route-candidate-search-tie-break/v1',
    bounds: { maxExpandedStates: 20, maxRouteEdgeCount: 8 },
    hardConstraints: [],
    ...overrides,
  };
}

export function candidateSet(rawRequest, candidates, overrides = {}) {
  return {
    schemaVersion: 'engagement-route-candidate-set/v3',
    candidateSetId: 'set-s4-explanation',
    candidateSetRevision: 'revision-s4-explanation',
    requestId: rawRequest.requestId,
    graphId: rawRequest.graphId,
    strategy: 'bounded-loopless-k-candidates',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: rawRequest.requestedCandidateCount,
    candidateIds: candidates.map(({ candidateId }) => candidateId),
    candidateCount: candidates.length,
    routeDistinctnessVersion: 'ordered-directed-edge-id-sequence/v1',
    searchConstraintIds: rawRequest.hardConstraints.map(({ constraintId }) => constraintId),
    constraintAggregationVersion: 'every-directed-edge-fail-dominates-unresolved/v1',
    tieBreakVersion: 'route-candidate-search-tie-break/v1',
    bounds: { ...rawRequest.bounds },
    expandedStateCount: 4,
    completeness: {
      routeSearch: candidates.length === rawRequest.requestedCandidateCount
        ? 'not-proven'
        : 'complete-within-bounds',
      scope: 'loopless-directed-routes-within-max-route-edge-count',
    },
    constraintOutcome: rawRequest.hardConstraints.length ? 'eligible-candidates-returned' : 'not-required',
    budgetOutcome: 'within-budget',
    capacityPolicy: { ...ROUTE_SEARCH_CAPACITY_POLICY },
    capacityOutcome: 'within-capacity',
    ...overrides,
  };
}

export function searchResult(overrides = {}) {
  const rawRequest = overrides.request ?? request();
  const candidates = overrides.candidateFacts ?? [
    candidate('candidate-a', 100, 9_000),
    candidate('candidate-b', 200, 1_000),
  ];
  return {
    schemaVersion: 'engagement-route-candidate-search-result/v2',
    status: 'completed',
    termination: candidates.length === rawRequest.requestedCandidateCount
      ? 'requested-candidate-count-reached'
      : 'bounded-search-space-exhausted',
    request: rawRequest,
    candidateSet: candidateSet(rawRequest, candidates),
    candidateFacts: candidates,
    ...overrides,
  };
}

export function syntheticSource(candidates) {
  const edgeIds = candidates.flatMap(({ edgeIds }) => edgeIds);
  return {
    schemaVersion: 'engagement-route-synthetic-observation-source/v1',
    sourceId: 'synthetic-s4-explanation',
    receipt: {
      schemaVersion: 'engagement-route-enrichment-source-receipt/v1',
      sourceId: 'synthetic-s4-explanation',
      artifactVersion: 'synthetic-explanation-fixture-v1',
      dataClassification: 'synthetic',
      sourceAsOf: null,
      retrievedAt: null,
      builtAt: '2026-08-13T00:00:00.000Z',
      observedAt: null,
      mappingPolicyVersion: 'direct-synthetic-edge-map-v1',
      coverage: { graphId: 'graph-s4-explanation', edgeIds },
      limitations: ['Synthetic explanation fixture only.'],
    },
    edgeObservations: edgeIds.flatMap((edgeId) => [
      ['step-free', true], ['curb-ramp-present', true], ['paved-surface', true],
    ].map(([factorId, value]) => ({
      edgeId, factorId, state: 'observed', value, unit: 'boolean', reasonCode: null,
    })).concat({
      edgeId, factorId: 'stairs-count', state: 'zero', value: 0, unit: 'count', reasonCode: null,
    })),
  };
}

function fixtureSearch(candidates) {
  const rawRequest = request({ requestedCandidateCount: candidates.length });
  return searchResult({
    request: rawRequest,
    candidateFacts: candidates,
    candidateSet: candidateSet(rawRequest, candidates),
  });
}

export function explanationDifferentialFixtures() {
  const rankChangeCandidates = [
    candidate('rank-a', 100, 1_000),
    candidate('rank-b', 100, 3_000),
    candidate('rank-c', 300, 1_000),
  ];
  const tieBreakCandidates = [
    candidate('tie-a', 100, 9_000),
    candidate('tie-b', 100, 1_000),
  ];
  const noEffectPolicy = policy({
    softPreferences: [
      { ...policy().softPreferences[0], weightBasisPoints: 0 },
      { ...policy().softPreferences[1], weightBasisPoints: 10_000 },
    ],
  });
  const constraint = hardConstraint();
  const hardCandidates = [
    candidate('hard-a', 100, 2_000, { 'step-free': observation('step-free', false) }),
    candidate('hard-b', 200, 1_000, { 'step-free': observation('step-free') }),
  ];
  return Object.freeze([
    Object.freeze({
      id: 'selected-and-score',
      policy: policy(),
      searchResult: searchResult(),
      expectedEffects: Object.freeze([
        Object.freeze({
          ruleId: 'objective',
          effectKind: 'score-changed-only',
          baselineRank: Object.freeze(['candidate-b', 'candidate-a']),
          counterfactualRank: Object.freeze(['candidate-b', 'candidate-a']),
          scoreTransition: Object.freeze({
            candidateId: 'candidate-b', baseline: 85_000_000, counterfactual: 45_000_000,
          }),
        }),
        Object.freeze({
          ruleId: 'distance',
          effectKind: 'selected-route-changed-under-ablation',
          baselineRank: Object.freeze(['candidate-b', 'candidate-a']),
          counterfactualRank: Object.freeze(['candidate-a', 'candidate-b']),
          scoreTransition: Object.freeze({
            candidateId: 'candidate-a', baseline: 50_000_000, counterfactual: 45_000_000,
          }),
        }),
      ]),
    }),
    Object.freeze({
      id: 'rank-change',
      policy: policy(),
      searchResult: fixtureSearch(rankChangeCandidates),
      expectedEffects: Object.freeze([
        Object.freeze({
          ruleId: 'objective',
          effectKind: 'tie-break-decided-rank',
          baselineRank: Object.freeze(['rank-a', 'rank-c', 'rank-b']),
          counterfactualRank: Object.freeze(['rank-a', 'rank-c', 'rank-b']),
          scoreTransition: Object.freeze({
            candidateId: 'rank-a', baseline: 90_000_000, counterfactual: 45_000_000,
          }),
        }),
        Object.freeze({
          ruleId: 'distance',
          effectKind: 'rank-changed-under-ablation',
          baselineRank: Object.freeze(['rank-a', 'rank-c', 'rank-b']),
          counterfactualRank: Object.freeze(['rank-a', 'rank-b', 'rank-c']),
          scoreTransition: Object.freeze({
            candidateId: 'rank-a', baseline: 90_000_000, counterfactual: 45_000_000,
          }),
        }),
      ]),
    }),
    Object.freeze({
      id: 'tie-break',
      policy: policy(),
      searchResult: fixtureSearch(tieBreakCandidates),
      expectedEffects: Object.freeze([
        Object.freeze({
          ruleId: 'objective',
          effectKind: 'score-changed-only',
          baselineRank: Object.freeze(['tie-b', 'tie-a']),
          counterfactualRank: Object.freeze(['tie-b', 'tie-a']),
          scoreTransition: Object.freeze({
            candidateId: 'tie-b', baseline: 90_000_000, counterfactual: 45_000_000,
          }),
        }),
        Object.freeze({
          ruleId: 'distance',
          effectKind: 'tie-break-decided-rank',
          baselineRank: Object.freeze(['tie-b', 'tie-a']),
          counterfactualRank: Object.freeze(['tie-b', 'tie-a']),
          scoreTransition: Object.freeze({
            candidateId: 'tie-b', baseline: 90_000_000, counterfactual: 45_000_000,
          }),
        }),
      ]),
    }),
    Object.freeze({
      id: 'no-effect',
      policy: noEffectPolicy,
      searchResult: searchResult(),
      expectedEffects: Object.freeze([
        Object.freeze({
          ruleId: 'objective',
          effectKind: 'no-effect',
          baselineRank: Object.freeze(['candidate-b', 'candidate-a']),
          counterfactualRank: Object.freeze(['candidate-b', 'candidate-a']),
          scoreTransition: Object.freeze({
            candidateId: 'candidate-b', baseline: 90_000_000, counterfactual: 90_000_000,
          }),
        }),
        Object.freeze({
          ruleId: 'distance',
          effectKind: 'tie-break-decided-rank',
          baselineRank: Object.freeze(['candidate-b', 'candidate-a']),
          counterfactualRank: Object.freeze(['candidate-b', 'candidate-a']),
          scoreTransition: Object.freeze({
            candidateId: 'candidate-b', baseline: 90_000_000, counterfactual: 0,
          }),
        }),
      ]),
    }),
    Object.freeze({
      id: 'hard-eligibility',
      policy: policy({ hardConstraints: [constraint] }),
      searchResult: fixtureSearch(hardCandidates),
      expectedEffects: Object.freeze([
        Object.freeze({
          ruleId: 'objective',
          effectKind: 'score-changed-only',
          baselineRank: Object.freeze(['hard-b']),
          counterfactualRank: Object.freeze(['hard-b']),
          scoreTransition: Object.freeze({
            candidateId: 'hard-b', baseline: 85_000_000, counterfactual: 45_000_000,
          }),
        }),
        Object.freeze({
          ruleId: 'distance',
          effectKind: 'score-changed-only',
          baselineRank: Object.freeze(['hard-b']),
          counterfactualRank: Object.freeze(['hard-b']),
          scoreTransition: Object.freeze({
            candidateId: 'hard-b', baseline: 85_000_000, counterfactual: 40_000_000,
          }),
        }),
        Object.freeze({
          ruleId: 'requires-step-free',
          effectKind: 'candidate-eligibility-changed-under-constraint-ablation',
          eligibilityTransition: Object.freeze({
            candidateId: 'hard-a', baseline: 'rejected', counterfactual: 'eligible',
          }),
        }),
      ]),
    }),
  ]);
}
