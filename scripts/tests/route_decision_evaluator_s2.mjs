#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { evaluateAdmittedRouteDecision } from '../../src/route_decision/evaluator/index.js';
import {
  enrichRouteCandidateSearchResult,
} from '../../src/route_decision/enrichment/index.js';
import {
  ROUTE_SEARCH_DECISION_EVALUATION_VERSION,
  admitRouteSearchDecisionEvaluation,
  evaluateAdmittedRouteSearchDecision,
} from '../../src/route_decision/evaluator/search_v2.js';

const UNRESOLVED = ['unknown', 'unavailable', 'partial', 'stale', 'invalid', 'missing'];

function observation(factorId, value = true) {
  return {
    schemaVersion: 'engagement-route-source-observation/v1',
    factorId,
    state: 'observed',
    value,
    unit: 'boolean',
    reasonCode: null,
    sourceId: 'synthetic-s2-evaluator-test',
  };
}

function candidate(candidateId, objectiveCostUnits, distanceMm, observations = {}) {
  return {
    schemaVersion: 'engagement-route-candidate-facts/v1',
    candidateId,
    edgeIds: [`${candidateId}-edge`],
    distanceMm,
    objectiveCostUnits,
    observations,
    provenance: {
      graphId: 'graph-s2',
      dataClassification: 'synthetic',
    },
  };
}

function policy(overrides = {}) {
  return {
    schemaVersion: 'engagement-route-decision-policy/v1',
    policyId: 'policy-s2',
    hardConstraints: [],
    softPreferences: [{
      preferenceId: 'distance',
      needTag: 'minimize-distance',
      factorId: 'distance-mm',
      operator: 'minimize',
      rangeMin: 0,
      rangeMax: 10_000,
      weightBasisPoints: 10_000,
    }],
    weightBasisPointsTotal: 10_000,
    tieBreak: [
      { factorId: 'score-units', direction: 'descending' },
      { factorId: 'distance-mm', direction: 'ascending' },
      { factorId: 'candidate-id', direction: 'ascending' },
    ],
    ...overrides,
  };
}

function searchConstraint(overrides = {}) {
  return {
    constraintId: 'requires-step-free',
    factorId: 'step-free',
    locality: 'edge-local',
    edgeEvidenceRequirement: 'complete',
    operator: 'equals',
    expectedValue: true,
    routeAggregation: 'every-directed-edge',
    aggregationVersion: 'every-directed-edge-fail-dominates-unresolved/v1',
    unresolvedStates: [...UNRESOLVED],
    unresolvedDisposition: 'exclude-and-report',
    ...overrides,
  };
}

function policyConstraint(overrides = {}) {
  return {
    constraintId: 'requires-step-free',
    needTag: 'require-capability',
    factorId: 'step-free',
    operator: 'equals',
    expectedValue: true,
    unresolvedStates: [...UNRESOLVED],
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    schemaVersion: 'engagement-route-candidate-search-request/v1',
    requestId: 'request-s2',
    graphId: 'graph-s2',
    mode: 'walk',
    originNodeId: 'origin',
    destinationNodeId: 'destination',
    decisionPolicyId: 'policy-s2',
    objectiveFactorId: 'objective-cost-units',
    requestedCandidateCount: 2,
    routeDistinctnessVersion: 'ordered-directed-edge-id-sequence/v1',
    tieBreakVersion: 'route-candidate-search-tie-break/v1',
    bounds: { maxExpandedStates: 20, maxRouteEdgeCount: 8 },
    hardConstraints: [],
    ...overrides,
  };
}

function candidateSet(rawRequest, candidates, overrides = {}) {
  return {
    schemaVersion: 'engagement-route-candidate-set/v2',
    candidateSetId: 'set-s2',
    candidateSetRevision: 'revision-s2',
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
    constraintOutcome: rawRequest.hardConstraints.length
      ? 'eligible-candidates-returned'
      : 'not-required',
    budgetOutcome: 'within-budget',
    ...overrides,
  };
}

function searchResult(overrides = {}) {
  const rawRequest = overrides.request ?? request();
  const candidates = overrides.candidateFacts ?? [
    candidate('candidate-a', 100, 9_000),
    candidate('candidate-b', 200, 1_000),
  ];
  return {
    schemaVersion: 'engagement-route-candidate-search-result/v1',
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

function evaluate(rawPolicy = policy(), artifact = searchResult()) {
  return evaluateAdmittedRouteSearchDecision({ policy: rawPolicy, candidateArtifact: artifact });
}

function syntheticSourceFor(candidates) {
  const edgeIds = candidates.flatMap(({ edgeIds }) => edgeIds);
  const edgeObservations = [];
  for (const edgeId of edgeIds) {
    for (const factorId of ['step-free', 'curb-ramp-present', 'paved-surface']) {
      edgeObservations.push({
        edgeId,
        factorId,
        state: 'observed',
        value: true,
        unit: 'boolean',
        reasonCode: null,
      });
    }
    edgeObservations.push({
      edgeId,
      factorId: 'stairs-count',
      state: 'zero',
      value: 0,
      unit: 'count',
      reasonCode: null,
    });
  }
  return {
    schemaVersion: 'engagement-route-synthetic-observation-source/v1',
    sourceId: 'synthetic-s2-evaluator-source',
    receipt: {
      schemaVersion: 'engagement-route-enrichment-source-receipt/v1',
      sourceId: 'synthetic-s2-evaluator-source',
      artifactVersion: 'synthetic-edge-observations-v1',
      dataClassification: 'synthetic',
      sourceAsOf: null,
      retrievedAt: null,
      builtAt: '2026-08-12T00:00:00.000Z',
      observedAt: null,
      mappingPolicyVersion: 'direct-synthetic-edge-map-v1',
      coverage: { graphId: 'graph-s2', edgeIds },
      limitations: ['Synthetic evaluator seam fixture; no real-world route claim.'],
    },
    edgeObservations,
  };
}

test('S2 evaluates and ranks every provided K>1 candidate without changing search metadata', () => {
  const artifact = searchResult();
  const result = evaluate(policy(), artifact);
  assert.equal(result.schemaVersion, ROUTE_SEARCH_DECISION_EVALUATION_VERSION);
  assert.equal(result.evaluation.status, 'evaluated');
  assert.equal(result.evaluation.decision.scope, 'provided-candidate-set');
  assert.deepEqual(result.evaluation.decision.candidateIds, ['candidate-a', 'candidate-b']);
  assert.deepEqual(result.evaluation.decision.rankedCandidateIds, ['candidate-b', 'candidate-a']);
  assert.equal(result.candidateArtifact.termination, 'requested-candidate-count-reached');
  assert.equal(result.candidateArtifact.candidateSet.completeness.routeSearch, 'not-proven');
});

test('an admitted enrichment wrapper is preserved whole while only its search result is evaluated', () => {
  const rawSearch = searchResult();
  const enriched = enrichRouteCandidateSearchResult({
    searchResult: rawSearch,
    source: syntheticSourceFor(rawSearch.candidateFacts),
  });
  const result = evaluate(policy(), enriched);
  assert.equal(
    result.candidateArtifact.schemaVersion,
    'engagement-route-search-enrichment-result/v1',
  );
  assert.equal(result.candidateArtifact.sourceReceipt.sourceId, 'synthetic-s2-evaluator-source');
  assert.deepEqual(
    result.candidateArtifact.searchResult.candidateSet.candidateIds,
    ['candidate-a', 'candidate-b'],
  );
  assert.deepEqual(result.evaluation.decision.rankedCandidateIds, ['candidate-b', 'candidate-a']);
  assert.equal(Object.isFrozen(result.candidateArtifact.candidateAudits), true);
});

test('the unchanged v1 adapter still rejects CandidateSet v2', () => {
  const artifact = searchResult();
  assert.throws(() => evaluateAdmittedRouteDecision({
    policy: policy(),
    candidateSet: artifact.candidateSet,
    candidates: artifact.candidateFacts,
  }), TypeError);
});

test('policy identity and search hard constraints must exactly bind the decision policy', () => {
  assert.throws(
    () => evaluate(policy({ policyId: 'different-policy' }), searchResult()),
    /decisionPolicyId must match/,
  );

  const constrainedRequest = request({
    hardConstraints: [searchConstraint({ factorId: 'curb-ramp-present' })],
  });
  const facts = [candidate('candidate-a', 100, 1_000, {
    'curb-ramp-present': observation('curb-ramp-present'),
  })];
  const artifact = searchResult({
    request: constrainedRequest,
    candidateFacts: facts,
    candidateSet: candidateSet(constrainedRequest, facts),
    termination: 'bounded-search-space-exhausted',
  });
  assert.throws(
    () => evaluate(policy({ hardConstraints: [policyConstraint()] }), artifact),
    /must exactly match a policy constraint/,
  );
});

test('zero-candidate terminals remain explicit not-evaluated search outcomes', () => {
  const invalid = {
    schemaVersion: 'engagement-route-candidate-search-result/v1',
    status: 'rejected',
    termination: 'invalid-input',
    request: null,
    candidateSet: null,
    candidateFacts: [],
  };
  const endpointRequest = request();
  const endpoint = {
    schemaVersion: 'engagement-route-candidate-search-result/v1',
    status: 'not-started',
    termination: 'endpoint-unavailable',
    request: endpointRequest,
    candidateSet: null,
    candidateFacts: [],
  };
  const noRouteRequest = request();
  const noRoute = searchResult({
    request: noRouteRequest,
    candidateFacts: [],
    candidateSet: candidateSet(noRouteRequest, [], {
      expandedStateCount: 3,
      completeness: {
        routeSearch: 'complete-within-bounds',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
    }),
    termination: 'no-directed-route-in-bounded-scope',
  });
  const constrainedRequest = request({ hardConstraints: [searchConstraint()] });
  const zeroConstrainedSet = (constraintOutcome, completeness = 'complete-within-bounds') => (
    candidateSet(constrainedRequest, [], {
      constraintOutcome,
      completeness: {
        routeSearch: completeness,
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
    })
  );
  const noEligible = searchResult({
    request: constrainedRequest,
    candidateFacts: [],
    candidateSet: zeroConstrainedSet('no-eligible-route-in-bounded-scope-proven'),
    termination: 'no-eligible-route-in-bounded-scope',
  });
  const unresolved = searchResult({
    request: constrainedRequest,
    candidateFacts: [],
    candidateSet: zeroConstrainedSet('unresolved-evidence'),
    termination: 'unresolved-constraint-evidence',
  });
  const budgetRequest = request();
  const budget = searchResult({
    status: 'stopped',
    request: budgetRequest,
    candidateFacts: [],
    candidateSet: candidateSet(budgetRequest, [], {
      expandedStateCount: budgetRequest.bounds.maxExpandedStates,
      completeness: {
        routeSearch: 'not-proven',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
      budgetOutcome: 'exhausted',
    }),
    termination: 'search-budget-exhausted',
  });
  const constrainedPolicy = policy({ hardConstraints: [policyConstraint()] });
  const cases = [
    [invalid, policy(), 'candidate-search-invalid-input'],
    [endpoint, policy(), 'candidate-search-endpoint-unavailable'],
    [noRoute, policy(), 'candidate-search-no-directed-route-in-bounded-scope'],
    [noEligible, constrainedPolicy, 'candidate-search-no-eligible-route-in-bounded-scope'],
    [unresolved, constrainedPolicy, 'candidate-search-unresolved-constraint-evidence'],
    [budget, policy(), 'candidate-search-budget-exhausted'],
  ];
  for (const [artifact, rawPolicy, reasonCode] of cases) {
    const result = evaluate(rawPolicy, artifact);
    assert.deepEqual(result.evaluation, { status: 'not-evaluated', reasonCode, decision: null });
  }
});

test('a budget-stopped partial candidate set remains evaluable and preserves search truth', () => {
  const rawRequest = request();
  const facts = [candidate('candidate-a', 100, 2_000)];
  const artifact = searchResult({
    status: 'stopped',
    termination: 'search-budget-exhausted',
    request: rawRequest,
    candidateFacts: facts,
    candidateSet: candidateSet(rawRequest, facts, {
      expandedStateCount: rawRequest.bounds.maxExpandedStates,
      completeness: {
        routeSearch: 'not-proven',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
      budgetOutcome: 'exhausted',
    }),
  });
  const result = evaluate(policy(), artifact);
  assert.equal(result.evaluation.status, 'evaluated');
  assert.deepEqual(result.evaluation.decision.rankedCandidateIds, ['candidate-a']);
  assert.equal(result.candidateArtifact.status, 'stopped');
  assert.equal(result.candidateArtifact.candidateSet.budgetOutcome, 'exhausted');
});

test('provided-set elimination does not become a global route infeasibility claim', () => {
  const rawRequest = request();
  const facts = [candidate('candidate-a', 100, 2_000, {
    'step-free': observation('step-free', false),
  })];
  const artifact = searchResult({
    request: rawRequest,
    candidateFacts: facts,
    candidateSet: candidateSet(rawRequest, facts),
    termination: 'bounded-search-space-exhausted',
  });
  const result = evaluate(policy({ hardConstraints: [policyConstraint()] }), artifact);
  assert.equal(
    result.evaluation.decision.status,
    'no-eligible-candidate-in-provided-set',
  );
  assert.equal(result.candidateArtifact.termination, 'bounded-search-space-exhausted');
  assert.equal(result.evaluation.decision.scope, 'provided-candidate-set');
});

test('mixed rejected and unresolved candidates remain incomplete rather than no-eligible', () => {
  const required = policyConstraint();
  const constrainedPolicy = policy({ hardConstraints: [required] });
  const artifact = searchResult({
    candidateFacts: [
      candidate('candidate-a', 100, 9_000, {
        'step-free': observation('step-free', false),
      }),
      candidate('candidate-b', 200, 1_000),
    ],
  });

  const result = evaluate(constrainedPolicy, artifact);
  assert.equal(result.evaluation.decision.status, 'candidate-search-incomplete');
  assert.deepEqual(
    result.evaluation.decision.rejected.map(({ candidateId }) => candidateId),
    ['candidate-a'],
  );
  assert.deepEqual(
    result.evaluation.decision.unresolved.map(({ candidateId }) => candidateId),
    ['candidate-b'],
  );
});

test('input and envelope admission invoke no getters and reject decision tampering', () => {
  let getterCalls = 0;
  const accessorInput = { policy: policy() };
  Object.defineProperty(accessorInput, 'candidateArtifact', {
    enumerable: true,
    get() { getterCalls += 1; return searchResult(); },
  });
  assert.throws(() => evaluateAdmittedRouteSearchDecision(accessorInput), TypeError);
  assert.equal(getterCalls, 0);

  const result = evaluate();
  const tampered = structuredClone(result);
  tampered.evaluation.decision.rankedCandidateIds.reverse();
  assert.throws(() => admitRouteSearchDecisionEvaluation(tampered), /does not match/);

  const accessorEnvelope = structuredClone(result);
  Object.defineProperty(accessorEnvelope.evaluation, 'decision', {
    enumerable: true,
    get() { getterCalls += 1; return result.evaluation.decision; },
  });
  assert.throws(() => admitRouteSearchDecisionEvaluation(accessorEnvelope), TypeError);
  assert.equal(getterCalls, 0);

  const prohibited = structuredClone(result);
  Object.defineProperty(prohibited.evaluation.decision.trace[0], '__proto__', {
    enumerable: true,
    value: { polluted: true },
  });
  assert.throws(() => admitRouteSearchDecisionEvaluation(prohibited), /prohibited/);
  assert.equal({}.polluted, undefined);
});

test('envelope admission is independent of object insertion order', () => {
  const result = evaluate();
  const evaluation = result.evaluation;
  const reordered = {
    ...structuredClone(result),
    evaluation: {
      decision: structuredClone(evaluation.decision),
      reasonCode: evaluation.reasonCode,
      status: evaluation.status,
    },
  };
  assert.deepEqual(admitRouteSearchDecisionEvaluation(reordered), result);
});

test('the returned envelope is detached, deeply frozen, deterministic, and has no forbidden back-edge', async () => {
  const rawPolicy = policy();
  const artifact = searchResult();
  const first = evaluate(rawPolicy, artifact);
  const second = evaluate(rawPolicy, artifact);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.policy.hardConstraints), true);
  assert.equal(Object.isFrozen(first.candidateArtifact.candidateFacts), true);
  assert.equal(Object.isFrozen(first.evaluation.decision.trace), true);

  rawPolicy.policyId = 'mutated';
  artifact.candidateFacts[0].distanceMm = 0;
  assert.equal(first.policy.policyId, 'policy-s2');
  assert.equal(first.candidateArtifact.candidateFacts[0].distanceMm, 9_000);

  const source = await readFile(
    new URL('../../src/route_decision/evaluator/search_v2.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /route_generation|enrichRouteCandidate|Date\.|Math\.random|fetch\(|document\.|localStorage/);
});
