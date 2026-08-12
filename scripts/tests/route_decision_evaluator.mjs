#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASIS_POINTS_TOTAL,
  evaluate,
  evaluateRouteCandidates,
  explainDecisionTrace,
} from '../../src/route_decision/evaluator/index.js';

function observation(value) {
  return { state: 'known', value };
}

function candidate(candidateId, observations = {}, overrides = {}) {
  return {
    schemaVersion: 'route-candidate-facts/v1',
    candidateId,
    edgeIds: [`${candidateId}-edge`],
    distanceMm: 1_000,
    objectiveCostUnits: 1_000,
    observations,
    provenance: { fixture: 'evaluator-test' },
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    schemaVersion: 'route-decision-policy/v1',
    policyId: 'test-policy',
    hardConstraints: [],
    softPreferences: [{
      id: 'prefer-short-distance',
      factorId: 'distance_mm',
      direction: 'minimize',
      rangeMin: 0,
      rangeMax: 10_000,
      weightBasisPoints: BASIS_POINTS_TOTAL,
    }],
    weightBasisPointsTotal: BASIS_POINTS_TOTAL,
    tieBreak: [
      { field: 'scoreUnits', direction: 'desc' },
      { field: 'distanceMm', direction: 'asc' },
      { field: 'candidateId', direction: 'asc' },
    ],
    ...overrides,
  };
}

test('hard-constraint operator truth tables evaluate only known integer observations', () => {
  const cases = [
    ['eq', 4, 4, true], ['eq', 4, 5, false],
    ['neq', 4, 5, true], ['neq', 4, 4, false],
    ['lt', 4, 5, true], ['lt', 5, 5, false],
    ['lte', 5, 5, true], ['lte', 6, 5, false],
    ['gt', 6, 5, true], ['gt', 5, 5, false],
    ['gte', 5, 5, true], ['gte', 4, 5, false],
  ];
  for (const [operator, actual, expected, passes] of cases) {
    const result = evaluateRouteCandidates({
      candidates: [candidate('only', {
        capability_units: observation(actual),
        distance_mm: observation(2_000),
      })],
      policy: policy({
        hardConstraints: [{
          id: `hard-${operator}`,
          factorId: 'capability_units',
          operator,
          value: expected,
        }],
      }),
    });
    assert.equal(result.trace[0].outcome, passes ? 'pass' : 'fail', operator);
    assert.equal(result.status, passes ? 'ranked' : 'no_admitted_candidate', operator);
  }
});

test('unknown, unavailable, partial, stale, malformed, unsupported, and missing hard observations are unresolved', () => {
  const candidates = [
    candidate('unknown', { capability_units: { state: 'unknown' }, distance_mm: observation(1_000) }),
    candidate('unavailable', { capability_units: { state: 'unavailable' }, distance_mm: observation(1_000) }),
    candidate('partial', { capability_units: { state: 'partial' }, distance_mm: observation(1_000) }),
    candidate('stale', { capability_units: { state: 'stale' }, distance_mm: observation(1_000) }),
    candidate('malformed-state', { capability_units: { state: 'malformed' }, distance_mm: observation(1_000) }),
    candidate('malformed-value', { capability_units: { state: 'known', value: 1.5 }, distance_mm: observation(1_000) }),
    candidate('unsupported-state', { capability_units: { state: 'future-state' }, distance_mm: observation(1_000) }),
    candidate('missing', { distance_mm: observation(1_000) }),
  ];
  const result = evaluateRouteCandidates({
    candidates,
    policy: policy({
      hardConstraints: [{ id: 'requires-capability', factorId: 'capability_units', operator: 'gte', value: 1 }],
    }),
  });

  assert.equal(result.status, 'no_admitted_candidate');
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.unresolved.map(({ candidateId }) => candidateId), [
    'malformed-state', 'malformed-value', 'missing', 'partial', 'stale', 'unavailable', 'unknown', 'unsupported-state',
  ]);
  const hardTrace = result.trace.filter(({ phase }) => phase === 'hard_constraint');
  assert.deepEqual(
    hardTrace.map(({ candidateId, observationState, reasonCode }) => [
      candidateId,
      observationState,
      reasonCode,
    ]),
    [
      ['malformed-state', 'malformed', 'hard_constraint_malformed_unresolved'],
      ['malformed-value', 'malformed', 'hard_constraint_malformed_unresolved'],
      ['missing', 'missing', 'hard_constraint_missing_unresolved'],
      ['partial', 'partial', 'hard_constraint_partial_unresolved'],
      ['stale', 'stale', 'hard_constraint_stale_unresolved'],
      ['unavailable', 'unavailable', 'hard_constraint_unavailable_unresolved'],
      ['unknown', 'unknown', 'hard_constraint_unknown_unresolved'],
      ['unsupported-state', 'unsupported', 'hard_constraint_unsupported_unresolved'],
    ],
  );
});

test('a candidate with any known hard failure is rejected before soft scoring', () => {
  const result = evaluateRouteCandidates({
    candidates: [candidate('blocked', {
      step_free: observation(0),
      width_mm: { state: 'unknown' },
      distance_mm: observation(1_000),
    })],
    policy: policy({
      hardConstraints: [
        { id: 'step-free', factorId: 'step_free', operator: 'eq', value: 1 },
        { id: 'minimum-width', factorId: 'width_mm', operator: 'gte', value: 900 },
      ],
    }),
  });

  assert.equal(result.status, 'no_admitted_candidate');
  assert.deepEqual(result.rejected.map(({ candidateId }) => candidateId), ['blocked']);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.trace.some(({ phase }) => phase === 'soft_preference'), false);
  assert.equal(
    result.trace.find(({ phase }) => phase === 'candidate_disposition').outcome,
    'rejected',
  );
});

test('invalid policies fail closed without silently renormalizing weights', () => {
  const invalidPolicies = [
    [policy({ weightBasisPointsTotal: 9_999 }), 'policy_weight_total_invalid'],
    [policy({ softPreferences: [{
      id: 'distance', factorId: 'distance_mm', direction: 'minimize',
      rangeMin: 0, rangeMax: 10_000, weightBasisPoints: 9_999,
    }] }), 'policy_weight_sum_mismatch'],
    [policy({ softPreferences: [{
      id: 'distance', factorId: 'distance_mm', direction: 'sideways',
      rangeMin: 0, rangeMax: 10_000, weightBasisPoints: 10_000,
    }] }), 'soft_preference_invalid'],
    [policy({ hardConstraints: [{
      id: 'bad-operator', factorId: 'distance_mm', operator: 'approximately', value: 1,
    }] }), 'hard_constraint_invalid'],
    [policy({ tieBreak: [
      { field: 'scoreUnits', direction: 'desc' },
      { field: 'candidateId', direction: 'desc' },
    ] }), 'policy_tie_break_candidate_id_required'],
    [policy({ tieBreak: [
      { field: 'distanceMm', direction: 'asc' },
      { field: 'candidateId', direction: 'asc' },
    ] }), 'policy_tie_break_score_first_required'],
  ];
  for (const [inputPolicy, reasonCode] of invalidPolicies) {
    const result = evaluateRouteCandidates({ candidates: [], policy: inputPolicy });
    assert.equal(result.status, 'invalid_policy');
    assert.equal(result.reasonCode, reasonCode);
    assert.deepEqual(result.trace, []);
  }
});

test('policy validation short-circuits before candidate access', () => {
  const unreadableCandidate = {};
  Object.defineProperty(unreadableCandidate, 'candidateId', {
    enumerable: true,
    get() { throw new Error('candidate must not be read'); },
  });
  const result = evaluate({
    candidates: [unreadableCandidate],
    policy: policy({ weightBasisPointsTotal: 9_999 }),
  });
  assert.equal(result.status, 'invalid_policy');
  assert.equal(result.reasonCode, 'policy_weight_total_invalid');
  assert.equal(evaluate(null).status, 'invalid_policy');
});

test('a missing active soft factor makes that candidate unresolved rather than changing the denominator', () => {
  const result = evaluateRouteCandidates({
    candidates: [
      candidate('complete', { distance_mm: observation(2_000), turns_count: observation(2) }),
      candidate('missing-turns', { distance_mm: observation(1_000) }),
    ],
    policy: policy({
      softPreferences: [
        {
          id: 'distance', factorId: 'distance_mm', direction: 'minimize',
          rangeMin: 0, rangeMax: 10_000, weightBasisPoints: 6_000,
        },
        {
          id: 'turns', factorId: 'turns_count', direction: 'minimize',
          rangeMin: 0, rangeMax: 20, weightBasisPoints: 4_000,
        },
      ],
    }),
  });

  assert.deepEqual(result.admittedCandidateIds, ['complete']);
  assert.deepEqual(result.unresolved.map(({ candidateId }) => candidateId), ['missing-turns']);
  const unresolvedTrace = result.trace.find(({ candidateId, outcome }) => (
    candidateId === 'missing-turns' && outcome === 'unresolved'
  ));
  assert.equal(unresolvedTrace.observationState, 'missing');
  assert.equal(unresolvedTrace.weightBasisPoints, 4_000);
  const completeScore = result.trace.find(({ phase, candidateId }) => (
    phase === 'ranking' && candidateId === 'complete'
  )).scoreUnits;
  assert.equal(completeScore, (8_000 * 6_000) + (9_000 * 4_000));
  const retainedDistanceWeight = result.trace.find(({ phase, candidateId, ruleId }) => (
    phase === 'soft_preference'
      && candidateId === 'missing-turns'
      && ruleId === 'distance'
  ));
  assert.equal(retainedDistanceWeight.weightBasisPoints, 6_000);
  assert.equal(retainedDistanceWeight.weightedScoreUnits, 9_000 * 6_000);
});

test('empty, all-rejected, all-unresolved, and mixed elimination use only no_admitted_candidate', () => {
  const hardPolicy = policy({
    hardConstraints: [{ id: 'step-free', factorId: 'step_free', operator: 'eq', value: 1 }],
  });
  const cases = [
    [],
    [candidate('failed', { step_free: observation(0), distance_mm: observation(1_000) })],
    [candidate('unknown', { step_free: { state: 'unknown' }, distance_mm: observation(1_000) })],
    [
      candidate('failed', { step_free: observation(0), distance_mm: observation(1_000) }),
      candidate('unknown', { step_free: { state: 'unknown' }, distance_mm: observation(1_000) }),
    ],
  ];
  for (const candidates of cases) {
    const result = evaluateRouteCandidates({ candidates, policy: hardPolicy });
    assert.equal(result.status, 'no_admitted_candidate');
    assert.equal(result.reasonCode, 'no_admitted_candidate');
    assert.deepEqual(result.admittedCandidateIds, []);
    assert.deepEqual(result.rankedCandidateIds, []);
    assert.equal(JSON.stringify(result).includes('no_feasible_route'), false);
  }
});

test('hard-only policies rank admitted candidates by explicit deterministic tie-breaks', () => {
  const result = evaluate({
    candidates: [
      candidate('route-b', { step_free: observation(1) }, { distanceMm: 900 }),
      candidate('route-a', { step_free: observation(1) }, { distanceMm: 900 }),
    ],
    policy: policy({
      hardConstraints: [{ id: 'step-free', factorId: 'step_free', operator: 'eq', value: 1 }],
      softPreferences: [],
    }),
  });
  assert.equal(result.status, 'ranked');
  assert.deepEqual(result.rankedCandidateIds, ['route-a', 'route-b']);
  assert.equal(
    result.trace.filter(({ phase }) => phase === 'ranking').every(({ scoreUnits }) => scoreUnits === 0),
    true,
  );
});

test('fixed-point basis-point scores are trace-recomputable without floating-point values', () => {
  const result = evaluateRouteCandidates({
    candidates: [candidate('route-a', {
      distance_mm: observation(2_500),
      turns_count: observation(5),
    })],
    policy: policy({
      softPreferences: [
        {
          id: 'distance', factorId: 'distance_mm', direction: 'minimize',
          rangeMin: 0, rangeMax: 10_000, weightBasisPoints: 7_000,
        },
        {
          id: 'turns', factorId: 'turns_count', direction: 'minimize',
          rangeMin: 0, rangeMax: 20, weightBasisPoints: 3_000,
        },
      ],
    }),
  });
  const entries = result.trace.filter(({ phase }) => phase === 'soft_preference');
  for (const entry of entries) {
    assert.equal(Number.isSafeInteger(entry.actualValue), true);
    assert.equal(Number.isSafeInteger(entry.utilityBasisPoints), true);
    assert.equal(Number.isSafeInteger(entry.utilityNumerator), true);
    assert.equal(Number.isSafeInteger(entry.weightedScoreUnits), true);
    assert.equal(entry.utilityBasisPoints, Math.floor(entry.utilityNumerator / entry.rangeSpan));
    assert.equal(entry.weightedScoreUnits, entry.utilityBasisPoints * entry.weightBasisPoints);
  }
  const recomputedScore = entries.reduce((sum, entry) => sum + entry.weightedScoreUnits, 0);
  assert.equal(recomputedScore, 75_000_000);
  const rankTrace = result.trace.find(({ phase }) => phase === 'ranking');
  assert.equal(rankTrace.scoreUnits, recomputedScore);
  assert.deepEqual(rankTrace.tieBreakValues, [
    { field: 'scoreUnits', direction: 'desc', value: recomputedScore },
    { field: 'distanceMm', direction: 'asc', value: 1_000 },
    { field: 'candidateId', direction: 'asc', value: 'route-a' },
  ]);
  assert.equal(result.rankedCandidateIds[0], 'route-a');
});

test('fixed-point linear utility clamps endpoints and floors non-divisible ratios', () => {
  const maximizePolicy = policy({
    softPreferences: [{
      id: 'maximize-capability',
      factorId: 'capability_units',
      direction: 'maximize',
      rangeMin: 0,
      rangeMax: 3,
      weightBasisPoints: BASIS_POINTS_TOTAL,
    }],
  });
  const result = evaluate({
    candidates: [
      candidate('above-best', { capability_units: observation(4) }),
      candidate('middle', { capability_units: observation(1) }),
      candidate('below-worst', { capability_units: observation(-1) }),
    ],
    policy: maximizePolicy,
  });
  assert.deepEqual(result.rankedCandidateIds, ['above-best', 'middle', 'below-worst']);
  const scoreByCandidate = new Map(
    result.trace
      .filter(({ phase }) => phase === 'ranking')
      .map(({ candidateId, scoreUnits }) => [candidateId, scoreUnits]),
  );
  assert.equal(scoreByCandidate.get('above-best'), 10_000 * 10_000);
  assert.equal(scoreByCandidate.get('middle'), 3_333 * 10_000);
  assert.equal(scoreByCandidate.get('below-worst'), 0);
});

test('tie-break order is stable and candidateId is the required final total-order key', () => {
  const candidates = [
    candidate('route-z', { distance_mm: observation(2_000) }, { distanceMm: 1_000 }),
    candidate('route-b', { distance_mm: observation(2_000) }, { distanceMm: 900 }),
    candidate('route-a', { distance_mm: observation(2_000) }, { distanceMm: 900 }),
  ];
  const inputPolicy = policy();
  const forward = evaluateRouteCandidates({ candidates, policy: inputPolicy });
  const reverse = evaluateRouteCandidates({ candidates: [...candidates].reverse(), policy: inputPolicy });

  assert.deepEqual(forward.rankedCandidateIds, ['route-a', 'route-b', 'route-z']);
  assert.deepEqual(reverse, forward);
  assert.deepEqual(
    forward.trace.filter(({ phase }) => phase === 'ranking').map(({ candidateId, rank }) => [candidateId, rank]),
    [['route-a', 1], ['route-b', 2], ['route-z', 3]],
  );
});

test('rule and reason order is canonical rather than caller-array dependent', () => {
  const hardConstraints = [
    { id: 'z-step-free', factorId: 'step_free', operator: 'eq', value: 1 },
    { id: 'a-width', factorId: 'width_mm', operator: 'gte', value: 900 },
  ];
  const candidates = [candidate('blocked', {
    step_free: observation(0),
    width_mm: { state: 'unknown' },
    distance_mm: observation(1_000),
  })];
  const forward = evaluate({ candidates, policy: policy({ hardConstraints }) });
  const reverse = evaluate({
    candidates,
    policy: policy({ hardConstraints: [...hardConstraints].reverse() }),
  });
  assert.deepEqual(reverse, forward);
  assert.deepEqual(forward.rejected[0].reasonCodes, [
    'hard_constraint_known_fail',
    'hard_constraint_unknown_unresolved',
  ]);
});

test('repeated execution is byte-stable and does not mutate candidates or policy', () => {
  const candidates = [candidate('route-a', { distance_mm: observation(1_500) })];
  const inputPolicy = policy();
  const beforeCandidates = structuredClone(candidates);
  const beforePolicy = structuredClone(inputPolicy);

  Object.freeze(candidates[0].observations.distance_mm);
  Object.freeze(candidates[0].observations);
  Object.freeze(candidates[0].edgeIds);
  Object.freeze(candidates[0].provenance);
  Object.freeze(candidates[0]);
  Object.freeze(candidates);
  Object.freeze(inputPolicy.softPreferences[0]);
  Object.freeze(inputPolicy.softPreferences);
  Object.freeze(inputPolicy.hardConstraints);
  for (const entry of inputPolicy.tieBreak) Object.freeze(entry);
  Object.freeze(inputPolicy.tieBreak);
  Object.freeze(inputPolicy);

  const first = evaluate({ candidates, policy: inputPolicy });
  const second = evaluateRouteCandidates({ candidates, policy: inputPolicy });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(candidates, beforeCandidates);
  assert.deepEqual(inputPolicy, beforePolicy);
});

test('explanations map trace reason codes and cannot re-evaluate candidate or policy data', () => {
  const trace = [{
    phase: 'hard_constraint',
    candidateId: 'route-a',
    ruleId: 'width',
    reasonCode: 'hard_constraint_known_fail',
    outcome: 'fail',
  }];
  const explanations = explainDecisionTrace(trace);
  assert.deepEqual(explanations, [{
    candidateId: 'route-a',
    ruleId: 'width',
    reasonCode: 'hard_constraint_known_fail',
    message: 'The known observation failed this hard constraint.',
  }]);
  assert.deepEqual(explainDecisionTrace(null), []);
});

test('Crime, HIN, ACS, Diary, real-estate, safety, and risk observations cannot enter ranking', () => {
  const forbiddenFactorIds = [
    'crime_count',
    'hin_segment',
    'acs_population',
    'diary_rating',
    'real_estate_price',
    'house_price_proxy',
    'safety_score',
    'predicted_risk_units',
  ];
  for (const factorId of forbiddenFactorIds) {
    const result = evaluateRouteCandidates({
      candidates: [candidate('only', { [factorId]: observation(1) })],
      policy: policy({
        softPreferences: [{
          id: `prefer-${factorId}`,
          factorId,
          direction: 'minimize',
          rangeMin: 0,
          rangeMax: 10,
          weightBasisPoints: BASIS_POINTS_TOTAL,
        }],
      }),
    });
    assert.equal(result.status, 'invalid_policy', factorId);
    assert.equal(result.reasonCode, 'factor_forbidden', factorId);
    assert.deepEqual(result.rankedCandidateIds, []);
  }

  const ignoredObservation = evaluate({
    candidates: [candidate('only', {
      distance_mm: observation(1_000),
      crime_count: observation(999_999),
      diary_rating: observation(5),
    })],
    policy: policy(),
  });
  assert.deepEqual(ignoredObservation.rankedCandidateIds, ['only']);
  assert.equal(
    ignoredObservation.trace.some(({ factorId }) => ['crime_count', 'diary_rating'].includes(factorId)),
    false,
  );
});

test('soft non-known states stay distinct and never produce a numeric score', () => {
  for (const state of ['unknown', 'unavailable', 'partial', 'stale', 'malformed', 'unsupported', 'missing']) {
    const observations = state === 'missing'
      ? {}
      : { distance_mm: { state } };
    const result = evaluate({ candidates: [candidate(state, observations)], policy: policy() });
    assert.equal(result.status, 'no_admitted_candidate', state);
    assert.deepEqual(result.rejected, [], state);
    assert.deepEqual(result.unresolved.map(({ candidateId }) => candidateId), [state], state);
    const entry = result.trace.find(({ phase }) => phase === 'soft_preference');
    assert.equal(entry.observationState, state);
    assert.equal(entry.reasonCode, `soft_preference_${state}_unresolved`);
    assert.equal(Object.hasOwn(entry, 'weightedScoreUnits'), false);
  }
});

test('evaluation does not use clock, randomness, or locale-dependent comparison', () => {
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  const originalLocaleCompare = String.prototype.localeCompare;
  try {
    Date.now = () => { throw new Error('clock access'); };
    Math.random = () => { throw new Error('random access'); };
    String.prototype.localeCompare = () => { throw new Error('locale access'); };
    const result = evaluate({
      candidates: [candidate('route-a', { distance_mm: observation(1_000) })],
      policy: policy(),
    });
    assert.deepEqual(result.rankedCandidateIds, ['route-a']);
  } finally {
    Date.now = originalDateNow;
    Math.random = originalRandom;
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test('candidate contract rejects malformed inputs and duplicate IDs before evaluation', () => {
  const malformed = evaluateRouteCandidates({
    candidates: [candidate('bad', { distance_mm: observation(1_000) }, { distanceMm: 1.5 })],
    policy: policy(),
  });
  assert.equal(malformed.status, 'invalid_candidates');
  assert.equal(malformed.reasonCode, 'candidate_shape_invalid');

  const duplicate = evaluateRouteCandidates({
    candidates: [
      candidate('same', { distance_mm: observation(1_000) }),
      candidate('same', { distance_mm: observation(2_000) }),
    ],
    policy: policy(),
  });
  assert.equal(duplicate.status, 'invalid_candidates');
  assert.equal(duplicate.reasonCode, 'candidate_id_duplicate');
});
