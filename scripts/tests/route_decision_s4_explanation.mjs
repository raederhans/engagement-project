import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { enrichRouteCandidateSearchResult } from '../../src/route_decision/enrichment/index.js';
import { evaluateAdmittedRouteSearchDecision } from '../../src/route_decision/evaluator/search_v2.js';
import {
  ROUTE_DECISION_EXPLANATION_EFFECT_VERSION,
  ROUTE_DECISION_EXPLANATION_EFFECT_KINDS,
  ROUTE_DECISION_EXPLANATION_CANONICAL_CONTENT_VERSION,
  ROUTE_DECISION_EXPLANATION_LIMITATION_CODES,
  ROUTE_DECISION_EXPLANATION_PRESENTATION_VERSION,
  ROUTE_DECISION_EXPLANATION_PROHIBITED_CLAIM_TAGS,
  ROUTE_DECISION_EXPLANATION_REASON_CODES,
  ROUTE_DECISION_EXPLANATION_VERSION,
  ROUTE_DECISION_EXPLANATION_SEARCH_VOCABULARY_VERSIONS,
  admitRouteDecisionExplanation,
  buildRouteDecisionExplanation,
  projectRouteDecisionExplanationPresentation,
} from '../../src/route_decision/explanation/index.js';
import { independentlyComputeCounterfactualEffects } from '../lib/route_s4_explanation_oracle.mjs';
import {
  candidate,
  candidateSet,
  explanationDifferentialFixtures,
  hardConstraint,
  observation,
  policy,
  request,
  searchResult,
  syntheticSource,
} from '../fixtures/route-s4-explanation/fixture.mjs';

function evaluate(rawPolicy = policy(), artifact = searchResult()) {
  return evaluateAdmittedRouteSearchDecision({ policy: rawPolicy, candidateArtifact: artifact });
}

function explain(rawPolicy = policy(), artifact = searchResult()) {
  return buildRouteDecisionExplanation({ decisionEvaluation: evaluate(rawPolicy, artifact) });
}

function reverseObjectKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeyOrder(item)]),
  );
}

function effectExpectationProjection(effects) {
  return effects.map((effect) => {
    if (effect.ruleKind === 'hard-constraint') {
      const candidateId = effect.changedCandidateIds[0]
        ?? effect.baselineEligibility[0]?.candidateId;
      return {
        ruleId: effect.ruleId,
        effectKind: effect.effectKind,
        eligibilityTransition: {
          candidateId,
          baseline: effect.baselineEligibility
            .find((entry) => entry.candidateId === candidateId)?.eligibility,
          counterfactual: effect.counterfactualEligibility
            .find((entry) => entry.candidateId === candidateId)?.eligibility,
        },
      };
    }
    const candidateId = effect.effectKind === 'selected-route-changed-under-ablation'
      ? effect.counterfactual.selectedCandidateId
      : effect.counterfactual.rankedCandidateIds[0];
    return {
      ruleId: effect.ruleId,
      effectKind: effect.effectKind,
      baselineRank: effect.baseline.rankedCandidateIds,
      counterfactualRank: effect.counterfactual.rankedCandidateIds,
      scoreTransition: {
        candidateId,
        baseline: effect.baseline.scores
          .find((entry) => entry.candidateId === candidateId)?.scoreUnits,
        counterfactual: effect.counterfactual.scores
          .find((entry) => entry.candidateId === candidateId)?.scoreUnits,
      },
    };
  });
}

test('v1 freezes exact identities, source versions, and clocks from an admitted enrichment artifact', () => {
  const rawSearch = searchResult();
  const enriched = enrichRouteCandidateSearchResult({
    searchResult: rawSearch,
    source: syntheticSource(rawSearch.candidateFacts),
  });
  const artifact = explain(policy(), enriched);

  assert.equal(artifact.schemaVersion, ROUTE_DECISION_EXPLANATION_VERSION);
  assert.deepEqual(artifact.inputIdentity, {
    decisionEvaluationSchemaVersion: 'engagement-route-search-decision-evaluation/v2',
    policySchemaVersion: 'engagement-route-decision-policy/v1',
    policyId: 'policy-s4-explanation',
    candidateArtifactSchemaVersion: 'engagement-route-search-enrichment-result/v3',
    searchResultSchemaVersion: 'engagement-route-candidate-search-result/v2',
    requestId: 'request-s4-explanation',
    graphId: 'graph-s4-explanation',
    candidateSetId: 'set-s4-explanation',
    candidateSetRevision: 'revision-s4-explanation',
    contentIdentities: artifact.inputIdentity.contentIdentities,
    algorithmVersions: {
      routeDistinctnessVersion: 'ordered-directed-edge-id-sequence/v1',
      searchTieBreakVersion: 'route-candidate-search-tie-break/v1',
      constraintAggregationVersion: 'every-directed-edge-fail-dominates-unresolved/v1',
      capacityPolicyVersion: 'bounded-frontier-capacity/v1',
    },
    denominators: { requestedCandidateCount: 2, returnedCandidateCount: 2 },
    rankingIdentity: {
      primaryCandidateId: 'candidate-b',
      alternativeCandidateIds: ['candidate-a'],
    },
    searchOutcomeIdentity: {
      vocabularyVersions: { ...ROUTE_DECISION_EXPLANATION_SEARCH_VOCABULARY_VERSIONS },
      status: 'completed',
      termination: 'requested-candidate-count-reached',
      completeness: 'not-proven',
      constraintOutcome: 'not-required',
      budgetOutcome: 'within-budget',
      capacityOutcome: 'within-capacity',
    },
    source: {
      sourceReceiptSchemaVersion: 'engagement-route-enrichment-source-receipt/v1',
      sourceId: 'synthetic-s4-explanation',
      artifactVersion: 'synthetic-explanation-fixture-v1',
      mappingPolicyVersion: 'direct-synthetic-edge-map-v1',
      clocks: {
        sourceAsOf: null,
        retrievedAt: null,
        builtAt: '2026-08-13T00:00:00.000Z',
        observedAt: null,
      },
    },
  });
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(
    artifact.inputIdentity.contentIdentities.canonicalizationVersion,
    ROUTE_DECISION_EXPLANATION_CANONICAL_CONTENT_VERSION,
  );
  assert.deepEqual(
    JSON.parse(artifact.inputIdentity.contentIdentities.admittedPolicy),
    artifact.decisionEvaluation.policy,
  );
  assert.deepEqual(
    JSON.parse(artifact.inputIdentity.contentIdentities.admittedCandidateArtifact),
    artifact.decisionEvaluation.candidateArtifact,
  );
  assert.deepEqual(
    JSON.parse(artifact.inputIdentity.contentIdentities.admittedDecisionEvaluation),
    artifact.decisionEvaluation,
  );
  assert.equal(Object.isFrozen(artifact.inputIdentity.source.clocks), true);
  assert.equal(Object.isFrozen(artifact.decisionEvaluation.candidateArtifact), true);
});

test('same policy ID with different admitted weights has a different canonical content identity', () => {
  const first = explain();
  const driftedPolicy = policy({
    softPreferences: [
      { ...policy().softPreferences[0], weightBasisPoints: 6_000 },
      { ...policy().softPreferences[1], weightBasisPoints: 4_000 },
    ],
  });
  const second = explain(driftedPolicy);
  assert.equal(first.inputIdentity.policyId, second.inputIdentity.policyId);
  assert.notEqual(
    first.inputIdentity.contentIdentities.admittedPolicy,
    second.inputIdentity.contentIdentities.admittedPolicy,
  );
  assert.notEqual(
    first.inputIdentity.contentIdentities.admittedDecisionEvaluation,
    second.inputIdentity.contentIdentities.admittedDecisionEvaluation,
  );
  assert.notDeepEqual(first.explanation, second.explanation);

  const driftedFacts = [
    candidate('candidate-a', 100, 8_000),
    candidate('candidate-b', 200, 1_000),
  ];
  const artifactDrift = explain(policy(), searchResult({ candidateFacts: driftedFacts }));
  assert.deepEqual(
    first.decisionEvaluation.candidateArtifact.candidateSet.candidateIds,
    artifactDrift.decisionEvaluation.candidateArtifact.candidateSet.candidateIds,
  );
  assert.equal(
    first.inputIdentity.candidateSetRevision,
    artifactDrift.inputIdentity.candidateSetRevision,
  );
  assert.notEqual(
    first.inputIdentity.contentIdentities.admittedCandidateArtifact,
    artifactDrift.inputIdentity.contentIdentities.admittedCandidateArtifact,
  );
  assert.notEqual(
    first.inputIdentity.contentIdentities.admittedDecisionEvaluation,
    artifactDrift.inputIdentity.contentIdentities.admittedDecisionEvaluation,
  );
});

test('counterfactual effects are independently reproducible and never promoted to decisive reasons', () => {
  const artifact = explain();
  assert.equal(artifact.explanation.outcome.selectedCandidateId, 'candidate-b');
  assert.deepEqual(artifact.explanation.counterfactualEffects,
    independentlyComputeCounterfactualEffects(artifact.decisionEvaluation));
  assert.deepEqual(
    artifact.explanation.counterfactualEffects.map(({ effectVersion }) => effectVersion),
    [ROUTE_DECISION_EXPLANATION_EFFECT_VERSION, ROUTE_DECISION_EXPLANATION_EFFECT_VERSION],
  );
  assert.deepEqual(artifact.explanation.counterfactualEffects.map(({ effectKind }) => effectKind), [
    'score-changed-only',
    'selected-route-changed-under-ablation',
  ]);
  assert.deepEqual(artifact.explanation.primaryWhyEffects, [{
    effectKind: 'selected-route-changed-under-ablation',
    ruleKind: 'soft-preference',
    ruleId: 'distance',
  }]);
  assert.ok(artifact.explanation.softContributions.every(
    ({ meaning }) => meaning === 'score-contribution-not-decisive-reason',
  ));
  assert.ok(artifact.explanation.softContributions.every(
    ({ evidenceState }) => ['observed', 'zero'].includes(evidenceState),
  ));
  assert.deepEqual(artifact.explanation.claimBoundary, {
    interpretation: 'no-claim-eligible-from-explanation-v1',
    prohibitedClaimTags: [...ROUTE_DECISION_EXPLANATION_PROHIBITED_CLAIM_TAGS],
  });
  assert.ok(artifact.explanation.reasons.every((code) => !code.includes('preference')));
  assert.ok(artifact.explanation.limitations.includes('counterfactual-effect-not-causal'));
  assert.ok(artifact.explanation.limitations.includes('no-user-preference-inference'));
  assert.ok(artifact.explanation.limitations.includes('no-accessibility-outcome-claim'));
  assert.ok(artifact.explanation.limitations.includes('no-safety-claim'));
});

test('hard constraints preserve pass, failure, unavailable, and provided-set scope truth', () => {
  const constraint = hardConstraint();
  const constrainedPolicy = policy({ hardConstraints: [constraint] });
  const rawRequest = request({ requestedCandidateCount: 4 });
  const facts = [
    candidate('candidate-a', 100, 9_000, { 'step-free': observation('step-free', null, 'unavailable') }),
    candidate('candidate-b', 200, 5_000, {}),
    candidate('candidate-c', 300, 1_000, {
      'step-free': {
        schemaVersion: 'engagement-route-source-observation/v1',
        factorId: 'step-free',
        state: 'observed',
        value: false,
        unit: 'boolean',
        reasonCode: null,
        sourceId: 'synthetic-s4-explanation',
      },
    }),
    candidate('candidate-d', 400, 500, { 'step-free': observation('step-free') }),
  ];
  const artifact = explain(constrainedPolicy, searchResult({
    request: rawRequest,
    candidateFacts: facts,
    candidateSet: candidateSet(rawRequest, facts),
  }));

  assert.equal(artifact.explanation.outcome.decisionStatus, 'ranked-in-provided-set');
  assert.deepEqual(
    artifact.explanation.hardConstraintFacts.map(({ candidateId, outcome, reasonCode }) => ({
      candidateId, outcome, reasonCode,
    })),
    [
      { candidateId: 'candidate-a', outcome: 'unresolved', reasonCode: 'hard-constraint-unresolved' },
      { candidateId: 'candidate-b', outcome: 'unresolved', reasonCode: 'hard-constraint-unresolved' },
      { candidateId: 'candidate-c', outcome: 'reject', reasonCode: 'hard-constraint-failed' },
      { candidateId: 'candidate-d', outcome: 'pass', reasonCode: 'hard-constraint-passed' },
    ],
  );
  assert.ok(artifact.explanation.limitations.includes('constraint-evidence-unavailable'));
  assert.ok(artifact.explanation.limitations.includes('constraint-evidence-missing'));
  assert.ok(artifact.explanation.limitations.includes('provided-candidate-set-only'));
  assert.equal(artifact.explanation.reasons[0], 'provided-candidate-set-ranked');
  assert.equal(
    artifact.explanation.counterfactualEffects.at(-1).effectKind,
    'candidate-eligibility-changed-under-constraint-ablation',
  );
  assert.ok(artifact.explanation.primaryWhyEffects.every(({ effectKind }) => [
    'selected-route-changed-under-ablation',
    'rank-changed-under-ablation',
    'candidate-eligibility-changed-under-constraint-ablation',
  ].includes(effectKind)));
});

test('unavailable, invalid, admitted empty, and stopped candidateful denominators stay distinct', () => {
  const rawRequest = request();
  const endpoint = {
    schemaVersion: 'engagement-route-candidate-search-result/v2',
    status: 'not-started',
    termination: 'endpoint-unavailable',
    request: rawRequest,
    candidateSet: null,
    candidateFacts: [],
  };
  const noRoute = searchResult({
    candidateFacts: [],
    candidateSet: candidateSet(rawRequest, [], {
      expandedStateCount: 4,
      completeness: {
        routeSearch: 'complete-within-bounds',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
    }),
    termination: 'no-directed-route-in-bounded-scope',
  });
  const invalid = {
    schemaVersion: 'engagement-route-candidate-search-result/v2',
    status: 'rejected',
    termination: 'invalid-input',
    request: null,
    candidateSet: null,
    candidateFacts: [],
  };
  const stoppedFacts = [candidate('candidate-a', 100, 9_000)];
  const stopped = searchResult({
    status: 'stopped',
    termination: 'search-budget-exhausted',
    candidateFacts: stoppedFacts,
    candidateSet: candidateSet(rawRequest, stoppedFacts, {
      expandedStateCount: rawRequest.bounds.maxExpandedStates,
      completeness: {
        routeSearch: 'not-proven',
        scope: 'loopless-directed-routes-within-max-route-edge-count',
      },
      budgetOutcome: 'exhausted',
    }),
  });

  const endpointArtifact = explain(policy(), endpoint);
  const invalidArtifact = explain(policy(), invalid);
  const noRouteArtifact = explain(policy(), noRoute);
  const stoppedArtifact = explain(policy(), stopped);
  const endpointExplanation = endpointArtifact.explanation;
  const invalidExplanation = invalidArtifact.explanation;
  const noRouteExplanation = noRouteArtifact.explanation;
  const stoppedExplanation = stoppedArtifact.explanation;
  assert.equal(endpointExplanation.search.termination, 'endpoint-unavailable');
  assert.equal(endpointExplanation.outcome.evaluationStatus, 'not-evaluated');
  assert.equal(endpointExplanation.search.candidateCount, null);
  assert.equal(endpointArtifact.inputIdentity.denominators.returnedCandidateCount, null);
  assert.equal(invalidExplanation.search.candidateCount, null);
  assert.equal(invalidExplanation.search.requestedCandidateCount, null);
  assert.equal(invalidArtifact.inputIdentity.denominators.requestedCandidateCount, null);
  assert.equal(noRouteExplanation.search.routeSearchCompleteness, 'complete-within-bounds');
  assert.equal(noRouteExplanation.search.candidateCount, 0);
  assert.equal(noRouteExplanation.outcome.evaluationStatus, 'not-evaluated');
  assert.equal(stoppedExplanation.outcome.evaluationStatus, 'evaluated');
  assert.equal(stoppedExplanation.search.candidateCount, 1);
  assert.equal(stoppedExplanation.outcome.scope, 'provided-candidate-set');
  assert.ok(stoppedExplanation.limitations.includes('route-search-stopped'));
  assert.ok(stoppedExplanation.limitations.includes('route-search-completeness-not-proven'));
  const unavailableText = projectRouteDecisionExplanationPresentation(endpointArtifact)
    .sections.summary.find(({ code }) => code === 'candidate-count').text;
  const invalidText = projectRouteDecisionExplanationPresentation(invalidArtifact)
    .sections.summary.find(({ code }) => code === 'candidate-count').text;
  const emptyText = projectRouteDecisionExplanationPresentation(noRouteArtifact)
    .sections.summary.find(({ code }) => code === 'candidate-count').text;
  assert.match(unavailableText, /Returned candidates: not available/);
  assert.match(invalidText, /Returned candidates: not available/);
  assert.match(emptyText, /Returned candidates: 0/);
});

test('fixture-owned literal expectations independently constrain product and oracle effects', () => {
  const observed = new Set();
  for (const fixture of explanationDifferentialFixtures()) {
    const artifact = explain(fixture.policy, fixture.searchResult);
    const oracle = independentlyComputeCounterfactualEffects(artifact.decisionEvaluation);
    assert.deepEqual(
      effectExpectationProjection(artifact.explanation.counterfactualEffects),
      fixture.expectedEffects,
      `${fixture.id}: product must match fixture-owned literal expectations`,
    );
    assert.deepEqual(
      effectExpectationProjection(oracle),
      fixture.expectedEffects,
      `${fixture.id}: oracle must match fixture-owned literal expectations`,
    );
    for (const { effectKind } of oracle) observed.add(effectKind);

    const productMutation = structuredClone(artifact.explanation.counterfactualEffects);
    productMutation[0].effectKind = productMutation[0].effectKind === 'no-effect'
      ? 'score-changed-only' : 'no-effect';
    assert.throws(
      () => assert.deepEqual(effectExpectationProjection(productMutation), fixture.expectedEffects),
      assert.AssertionError,
      `${fixture.id}: product mapping mutation must fail literal expectations`,
    );

    const oracleMutation = structuredClone(oracle);
    oracleMutation[0].effectKind = oracleMutation[0].effectKind === 'no-effect'
      ? 'rank-changed-under-ablation' : 'no-effect';
    assert.throws(
      () => assert.deepEqual(effectExpectationProjection(oracleMutation), fixture.expectedEffects),
      assert.AssertionError,
      `${fixture.id}: oracle mapping mutation must fail literal expectations`,
    );
  }
  assert.deepEqual([...observed].sort(), [...ROUTE_DECISION_EXPLANATION_EFFECT_KINDS].sort());
});

test('admission is exact, detached, deeply frozen, getter-safe, and rejects tampering', () => {
  const artifact = explain();
  assert.deepEqual(admitRouteDecisionExplanation(structuredClone(artifact)), artifact);

  const identityTamper = structuredClone(artifact);
  identityTamper.inputIdentity.candidateSetRevision = 'forged';
  assert.throws(() => admitRouteDecisionExplanation(identityTamper), /identity does not match/);

  const factTamper = structuredClone(artifact);
  factTamper.explanation.counterfactualEffects[1].effectKind = 'no-effect';
  assert.throws(() => admitRouteDecisionExplanation(factTamper), /recomputed facts/);

  const rankTamper = structuredClone(artifact);
  rankTamper.explanation.counterfactualEffects[1]
    .counterfactual.rankedCandidateIds.reverse();
  assert.throws(() => admitRouteDecisionExplanation(rankTamper), /recomputed facts/);

  const scoreTamper = structuredClone(artifact);
  scoreTamper.explanation.counterfactualEffects[0].counterfactual.scores[0].scoreUnits += 1;
  assert.throws(() => admitRouteDecisionExplanation(scoreTamper), /recomputed facts/);

  const whyTamper = structuredClone(artifact);
  whyTamper.explanation.primaryWhyEffects.push({
    effectKind: 'score-changed-only', ruleKind: 'soft-preference', ruleId: 'objective',
  });
  assert.throws(() => admitRouteDecisionExplanation(whyTamper), /recomputed facts/);

  const extra = structuredClone(artifact);
  extra.explanation.extra = true;
  assert.throws(() => admitRouteDecisionExplanation(extra), /recomputed facts/);

  let getterCalls = 0;
  const accessor = structuredClone(artifact);
  Object.defineProperty(accessor, 'explanation', {
    enumerable: true,
    get() { getterCalls += 1; return artifact.explanation; },
  });
  assert.throws(() => admitRouteDecisionExplanation(accessor), /data property/);
  assert.equal(getterCalls, 0);

  const getTrap = new Proxy(structuredClone(artifact), {
    get() { getterCalls += 1; throw new Error('must not call get trap'); },
  });
  assert.throws(() => admitRouteDecisionExplanation(getTrap), /must not be a Proxy/);
  assert.equal(getterCalls, 0);

  const polluted = structuredClone(artifact);
  Object.defineProperty(polluted.explanation, '__proto__', {
    enumerable: true,
    value: { polluted: true },
  });
  assert.throws(() => admitRouteDecisionExplanation(polluted), /prohibited/);
  assert.equal({}.polluted, undefined);

  const rawEvaluation = structuredClone(artifact.decisionEvaluation);
  const rebuilt = buildRouteDecisionExplanation({ decisionEvaluation: rawEvaluation });
  rawEvaluation.policy.policyId = 'mutated';
  assert.equal(rebuilt.inputIdentity.policyId, 'policy-s4-explanation');
  assert.equal(Object.isFrozen(rebuilt.explanation.counterfactualEffects), true);

  const reorderedEvaluation = reverseObjectKeyOrder(structuredClone(artifact.decisionEvaluation));
  const reordered = buildRouteDecisionExplanation({ decisionEvaluation: reorderedEvaluation });
  assert.equal(
    reordered.inputIdentity.contentIdentities.admittedDecisionEvaluation,
    artifact.inputIdentity.contentIdentities.admittedDecisionEvaluation,
  );
  assert.deepEqual(reordered, artifact);
});

test('all public roots and nested arrays reject hostile descriptors without invoking getters', () => {
  const artifact = explain();
  let getterCalls = 0;
  const trapCounts = {
    get: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
    getOwnPropertyDescriptor: 0,
    isExtensible: 0,
  };
  const hostileProxy = (value) => new Proxy(value, {
    get() { trapCounts.get += 1; throw new Error('direct get is forbidden'); },
    getPrototypeOf() { trapCounts.getPrototypeOf += 1; throw new Error('prototype trap'); },
    ownKeys() { trapCounts.ownKeys += 1; throw new Error('ownKeys trap'); },
    getOwnPropertyDescriptor() {
      trapCounts.getOwnPropertyDescriptor += 1;
      throw new Error('descriptor trap');
    },
    isExtensible() { trapCounts.isExtensible += 1; throw new Error('extensible trap'); },
  });
  const assertZeroTraps = () => assert.deepEqual(trapCounts, {
    get: 0,
    getPrototypeOf: 0,
    ownKeys: 0,
    getOwnPropertyDescriptor: 0,
    isExtensible: 0,
  });

  assert.throws(() => buildRouteDecisionExplanation(hostileProxy({
    decisionEvaluation: artifact.decisionEvaluation,
  })), /must not be a Proxy/);
  assertZeroTraps();
  assert.throws(
    () => admitRouteDecisionExplanation(hostileProxy(structuredClone(artifact))),
    /must not be a Proxy/,
  );
  assertZeroTraps();
  assert.throws(
    () => projectRouteDecisionExplanationPresentation(hostileProxy(structuredClone(artifact))),
    /must not be a Proxy/,
  );
  assertZeroTraps();

  const nestedPolicyProxy = structuredClone(artifact.decisionEvaluation);
  nestedPolicyProxy.policy = hostileProxy(nestedPolicyProxy.policy);
  assert.throws(() => buildRouteDecisionExplanation({
    decisionEvaluation: nestedPolicyProxy,
  }), /must not be a Proxy/);
  assertZeroTraps();

  const nestedDecisionArrayProxy = structuredClone(artifact.decisionEvaluation);
  nestedDecisionArrayProxy.policy.softPreferences = hostileProxy(
    nestedDecisionArrayProxy.policy.softPreferences,
  );
  assert.throws(() => buildRouteDecisionExplanation({
    decisionEvaluation: nestedDecisionArrayProxy,
  }), /must not be a Proxy/);
  assertZeroTraps();

  const nestedExplanationArrayProxy = structuredClone(artifact);
  nestedExplanationArrayProxy.explanation.limitations = hostileProxy(
    nestedExplanationArrayProxy.explanation.limitations,
  );
  assert.throws(
    () => admitRouteDecisionExplanation(nestedExplanationArrayProxy),
    /must not be a Proxy/,
  );
  assertZeroTraps();

  const rootAccessor = {};
  Object.defineProperty(rootAccessor, 'decisionEvaluation', {
    enumerable: true,
    get() { getterCalls += 1; return artifact.decisionEvaluation; },
  });
  assert.throws(() => buildRouteDecisionExplanation(rootAccessor), /data property/);
  assert.equal(getterCalls, 0);

  const hiddenRoot = { decisionEvaluation: artifact.decisionEvaluation };
  Object.defineProperty(hiddenRoot, 'hidden', { value: true });
  assert.throws(() => buildRouteDecisionExplanation(hiddenRoot), /enumerable/);
  const symbolRoot = { decisionEvaluation: artifact.decisionEvaluation };
  Object.defineProperty(symbolRoot, Symbol('hidden'), { value: true });
  assert.throws(() => buildRouteDecisionExplanation(symbolRoot), /string-keyed/);
  assert.throws(
    () => buildRouteDecisionExplanation(Object.assign(Object.create(null), {
      decisionEvaluation: artifact.decisionEvaluation,
    })),
    /plain string-keyed/,
  );
  assert.equal(getterCalls, 0);

  const hiddenRequiredRoot = {};
  Object.defineProperty(hiddenRequiredRoot, 'decisionEvaluation', {
    enumerable: false,
    writable: true,
    configurable: true,
    value: artifact.decisionEvaluation,
  });
  assert.throws(() => buildRouteDecisionExplanation(hiddenRequiredRoot), /enumerable/);

  const hiddenIndex = structuredClone(artifact);
  Object.defineProperty(hiddenIndex.explanation.limitations, '0', {
    enumerable: false,
    writable: true,
    configurable: true,
    value: hiddenIndex.explanation.limitations[0],
  });
  assert.throws(() => admitRouteDecisionExplanation(hiddenIndex), /enumerable/);

  const readonlyIndex = structuredClone(artifact);
  Object.defineProperty(readonlyIndex.explanation.limitations, '0', {
    enumerable: true,
    writable: false,
    configurable: false,
    value: readonlyIndex.explanation.limitations[0],
  });
  assert.throws(() => admitRouteDecisionExplanation(readonlyIndex), /mutable container mode/);

  const readonlyLength = structuredClone(artifact);
  Object.defineProperty(readonlyLength.explanation.limitations, 'length', { writable: false });
  assert.throws(() => admitRouteDecisionExplanation(readonlyLength), /mutable container mode/);

  const emptyReadonlyLength = structuredClone(artifact);
  Object.defineProperty(emptyReadonlyLength.explanation.hardConstraintFacts, 'length', {
    writable: false,
  });
  assert.equal(emptyReadonlyLength.explanation.hardConstraintFacts.length, 0);
  assert.throws(
    () => admitRouteDecisionExplanation(emptyReadonlyLength),
    /mutable container mode/,
  );

  const readonlyRequiredRoot = {};
  Object.defineProperty(readonlyRequiredRoot, 'decisionEvaluation', {
    enumerable: true,
    writable: false,
    configurable: false,
    value: artifact.decisionEvaluation,
  });
  assert.equal(Object.isExtensible(readonlyRequiredRoot), true);
  assert.throws(
    () => buildRouteDecisionExplanation(readonlyRequiredRoot),
    /mutable container mode/,
  );

  const preventedRoot = { decisionEvaluation: artifact.decisionEvaluation };
  Object.preventExtensions(preventedRoot);
  assert.equal(Object.isFrozen(preventedRoot), false);
  assert.throws(
    () => buildRouteDecisionExplanation(preventedRoot),
    /either extensible mutable data or fully frozen data/,
  );

  const preventedArray = structuredClone(artifact);
  Object.preventExtensions(preventedArray.explanation.limitations);
  assert.equal(Object.isFrozen(preventedArray.explanation.limitations), false);
  assert.throws(
    () => admitRouteDecisionExplanation(preventedArray),
    /either extensible mutable data or fully frozen data/,
  );

  const preventedEmptyArray = structuredClone(artifact);
  Object.preventExtensions(preventedEmptyArray.explanation.hardConstraintFacts);
  assert.equal(preventedEmptyArray.explanation.hardConstraintFacts.length, 0);
  assert.equal(Object.isFrozen(preventedEmptyArray.explanation.hardConstraintFacts), true);
  assert.throws(
    () => admitRouteDecisionExplanation(preventedEmptyArray),
    /length does not match the frozen container mode/,
  );

  assert.deepEqual(admitRouteDecisionExplanation(structuredClone(artifact)), artifact);
  assert.deepEqual(admitRouteDecisionExplanation(artifact), artifact);
  assertZeroTraps();
});

test('presentation is pure, text-complete, map-optional, and carries every limitation', () => {
  const artifact = explain();
  const first = projectRouteDecisionExplanationPresentation(artifact);
  const second = projectRouteDecisionExplanationPresentation(structuredClone(artifact));
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, ROUTE_DECISION_EXPLANATION_PRESENTATION_VERSION);
  assert.equal(first.textComplete, true);
  assert.equal(first.mapModel, null);
  assert.equal(Object.isFrozen(first.sections.limitations), true);
  assert.equal(first.sections.identity.length, 11);
  assert.equal(first.sections.softContributions.length, artifact.explanation.softContributions.length);
  assert.ok(first.sections.softContributions.every(({ text }) => text.includes('not a decisive reason')));
  assert.deepEqual(
    first.sections.limitations.map(({ code }) => code),
    artifact.explanation.limitations,
  );
  assert.deepEqual(first.sections.claimBoundary.map(({ code }) => code), [
    'no-claim-eligible-from-explanation-v1',
  ]);
  assert.ok(first.sections.counterfactualEffects.every(({ text }) => text.includes('mechanical')));
  assert.deepEqual(
    first.sections.primaryWhyEffects.map(({ code }) => code),
    artifact.explanation.primaryWhyEffects.map(({ effectKind }) => effectKind),
  );
});

test('canonical vocabularies and import isolation stay frozen', async () => {
  assert.equal(new Set(ROUTE_DECISION_EXPLANATION_REASON_CODES).size, 7);
  assert.equal(new Set(ROUTE_DECISION_EXPLANATION_LIMITATION_CODES).size, 16);
  assert.deepEqual(ROUTE_DECISION_EXPLANATION_EFFECT_KINDS, [
    'selected-route-changed-under-ablation',
    'rank-changed-under-ablation',
    'candidate-eligibility-changed-under-constraint-ablation',
    'tie-break-decided-rank',
    'score-changed-only',
    'no-effect',
  ]);
  assert.deepEqual(ROUTE_DECISION_EXPLANATION_PROHIBITED_CLAIM_TAGS, [
    'safe-route',
    'safer-route',
    'recommended-route',
    'risk-prediction',
    'accessibility-validated',
    'city-validated',
    'scientifically-validated',
    'user-research-validated',
    'production-validated',
  ]);
  const source = await readFile(
    new URL('../../src/route_decision/explanation/contract_v1.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /document\.|localStorage|fetch\(|route_generation|Date\.|Math\.random/);
  const publicBarrel = await readFile(
    new URL('../../src/route_decision/contracts/index.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(publicBarrel, /route-decision-explanation|explanation\/index/);
  const oracleSource = await readFile(
    new URL('../lib/route_s4_explanation_oracle.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(oracleSource, /^\s*import\s/m);
  assert.doesNotMatch(oracleSource, /src\/route_decision|explanation\/contract/);
});
