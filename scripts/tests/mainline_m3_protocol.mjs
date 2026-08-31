import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadAreaIntelligenceEvaluationProtocolV3,
  validateAreaIntelligenceEvaluationProtocolV3,
} from '../lib/area_intelligence_evaluation_protocol_v3.mjs';

test('M3 Evaluation Protocol v3 freezes runtime, candidates, folds, and no-promotion authority', async () => {
  const { protocol, sha256 } = await loadAreaIntelligenceEvaluationProtocolV3();
  assert.match(sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(protocol.frozen_before_v3_candidate_performance, true);
  assert.equal(protocol.runtime.scikit_learn, '1.9.0');
  assert.equal(protocol.runtime.torch, '2.13.0');
  assert.equal(protocol.feature_schema.features.length, 27);
  assert.equal(protocol.candidates.length, 7);
  assert.equal(protocol.candidates.some(({ id }) => id === 'moving-average-4w'), false);
  assert.equal(protocol.rolling_folds.length, 4);
  assert.equal(protocol.inner_validation.test_fold_access, false);
  assert.equal(protocol.decision.eligibility_is_promotion, false);
  assert.equal(protocol.decision.current_state, 'unavailable');
  assert.ok(Object.values(protocol.authority).every((value) => value === false));
});

test('M3 rejects candidate, runtime, test-fold, and promotion drift', async () => {
  const { protocol } = await loadAreaIntelligenceEvaluationProtocolV3();
  for (const mutate of [
    (value) => { value.runtime.torch = 'latest'; },
    (value) => { value.candidates[0].id = 'new-after-results'; },
    (value) => { value.inner_validation.test_fold_access = true; },
    (value) => { value.decision.eligibility_is_promotion = true; },
  ]) {
    const hostile = structuredClone(protocol);
    mutate(hostile);
    assert.throws(() => validateAreaIntelligenceEvaluationProtocolV3(hostile));
  }
});
