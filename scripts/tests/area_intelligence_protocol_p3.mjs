import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv from 'ajv';

import {
  AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SCHEMA,
  AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SEMANTIC_SHA256,
  AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
  AREA_INTELLIGENCE_EVALUATION_RECEIPT_SHA256,
  AreaIntelligenceEvaluationProtocolError,
  areaIntelligenceEvaluationProtocolIdentity,
  loadAreaIntelligenceEvaluationProtocol,
  stableSerialization,
  validateAreaIntelligenceEvaluationProtocol,
} from '../lib/area_intelligence_evaluation_protocol.mjs';

const protocolUrl = new URL(
  '../data/area_intelligence_evaluation_protocol.v2.json',
  import.meta.url,
);
const schemaUrl = new URL(
  '../data/area_intelligence_evaluation_protocol.schema.json',
  import.meta.url,
);
const protocolBytes = await readFile(protocolUrl);
const protocol = JSON.parse(protocolBytes.toString('utf8'));
const publishedSchema = JSON.parse(await readFile(schemaUrl, 'utf8'));

test('P3 protocol bytes, schema, receipt, freeze point, and no-authority state are exact', async () => {
  assert.equal(protocolBytes.includes(13), false, 'protocol bytes must remain LF-only');
  assert.equal(protocolBytes.at(-1), 10, 'protocol bytes must end in LF');
  assert.equal(areaIntelligenceEvaluationProtocolIdentity(protocolBytes), AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256);
  assert.equal(
    `sha256:${createHash('sha256').update(stableSerialization(protocol)).digest('hex')}`,
    AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SEMANTIC_SHA256,
  );
  assert.equal(protocol.schema, AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SCHEMA);
  assert.equal(protocol.schema_version, 2);
  assert.equal(protocol.frozen_before_model_performance, true);
  assert.equal(protocol.exact_input_gate.receipt_sha256, AREA_INTELLIGENCE_EVALUATION_RECEIPT_SHA256);
  assert.deepEqual(protocol.authority, {
    local_evaluation: false,
    serving: false,
    product_promotion: false,
    scientific: false,
    causal: false,
    safety: false,
    deletion: false,
  });
  assert.deepEqual(protocol.current_evaluation_state, {
    status: 'not-promoted',
    availability: 'unavailable',
    selected_model: null,
    failure_result: 'honest-no-promotion-historical-trends-only',
  });
  const loaded = await loadAreaIntelligenceEvaluationProtocol();
  assert.deepEqual(loaded, protocol);
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded.authority));
});

test('published schema compiles in Ajv strict mode and every object shape rejects extras', () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(publishedSchema);
  assert.equal(validate(protocol), true, JSON.stringify(validate.errors));
  assert.equal(publishedSchema.additionalProperties, false);
  assertStrictObjectShapes(publishedSchema);
});

test('primary tuple vocabulary is the exact four-fold by unit by holdout Cartesian product', () => {
  const expected = [];
  for (const fold of ['fold-2019', 'fold-2021', 'fold-2023', 'fold-2025-2026']) {
    for (const unit_type of ['tract', 'fixed-grid']) {
      for (const holdout_slice of ['temporal-non-heldout', 'spatial-heldout']) {
        expected.push({ fold, unit_type, holdout_slice });
      }
    }
  }
  assert.deepEqual(protocol.primary_tuple_vocabulary, expected);
  assert.equal(protocol.primary_tuple_vocabulary.length, 16);
  assert.deepEqual(
    protocol.primary_tuple_vocabulary.map((value) => stableSerialization(value)),
    [...new Set(protocol.primary_tuple_vocabulary.map((value) => stableSerialization(value)))],
  );
});

test('folds are exact Monday-aligned adjacent train/test windows with disjoint tests', () => {
  let previousTestEnd = null;
  for (const fold of protocol.rolling_folds) {
    for (const value of [fold.train_start, fold.train_end_exclusive, fold.test_start, fold.test_end_exclusive]) {
      assert.equal(new Date(`${value}T00:00:00.000Z`).getUTCDay(), 1, `${fold.id}/${value} must be Monday`);
    }
    assert.equal(fold.train_end_exclusive, fold.test_start);
    assert.ok(fold.train_start < fold.train_end_exclusive);
    assert.ok(fold.test_start < fold.test_end_exclusive);
    if (previousTestEnd !== null) assert.ok(previousTestEnd <= fold.test_start);
    previousTestEnd = fold.test_end_exclusive;
  }
});

test('numerical, prediction, interval, and singular gates match executable model bounds', () => {
  const gate = protocol.numerical_stability_gate;
  assert.equal(gate.finite_coefficients_required, true);
  assert.equal(gate.coefficient_abs_limit_inclusive, 12);
  assert.equal(gate.convergence.threshold_exclusive, 1e-7);
  assert.equal(gate.convergence.required_before_iteration_limit, true);
  assert.equal(gate.singular_fit_allowed, false);
  assert.equal(gate.prediction.finite_required, true);
  assert.equal(gate.prediction.minimum_inclusive, 0);
  assert.equal(gate.prediction.maximum_inclusive, Math.exp(12));
  assert.deepEqual(gate.dispersion_alpha_inclusive, [0.000001, 10]);
  assert.equal(gate.interval.nominal_probability, 0.9);
  assert.deepEqual(gate.interval.primary_slice_coverage_inclusive, [0.85, 0.95]);
  assert.equal(gate.interval.aggregate_bypass_allowed, false);
  assert.equal(protocol.promotion_gate.all_primary_slices_must_pass, true);
});

test('strict runtime validator rejects schema, vocabulary, dates, model, numerical, and governance drift', () => {
  const hostileCases = [
    ['unknown top-level field', (value) => { value.unknown = true; }],
    ['missing nested field', (value) => { delete value.authority.serving; }],
    ['schema drift', (value) => { value.schema = 'engagement-area-intelligence-evaluation-protocol/v3'; }],
    ['version drift', (value) => { value.schema_version = 3; }],
    ['freeze drift', (value) => { value.frozen_before_model_performance = false; }],
    ['receipt identity drift', (value) => { value.exact_input_gate.receipt_identity = digest('other-receipt'); }],
    ['receipt SHA drift', (value) => { value.exact_input_gate.receipt_sha256 = digest('other-receipt-bytes'); }],
    ['invalid fold date', (value) => { value.rolling_folds[0].train_start = '2019-02-31'; }],
    ['non-Monday fold date', (value) => { value.rolling_folds[0].train_start = '2016-01-05'; }],
    ['overlapping fold test', (value) => { value.rolling_folds[1].test_start = '2019-12-30'; }],
    ['model id drift', (value) => { value.models[0].id = 'seasonal-naive-53w'; }],
    ['model kind drift', (value) => { value.models[3].kind = 'negative-binomial-nb2'; }],
    ['model config drift', (value) => { value.models[1].window_weeks = 5; }],
    ['unit vocabulary drift', (value) => { value.marts.unit_types[1] = 'hex-grid'; }],
    ['holdout vocabulary drift', (value) => { value.spatial_holdout.report_slices[1] = 'random-heldout'; }],
    ['primary tuple drift', (value) => { value.primary_tuple_vocabulary[15].unit_type = 'tract'; }],
    ['non-finite threshold', (value) => { value.numerical_stability_gate.convergence.threshold_exclusive = Number.NaN; }],
    ['out-of-domain threshold', (value) => { value.numerical_stability_gate.convergence.threshold_exclusive = -1; }],
    ['maximum prediction drift', (value) => { value.numerical_stability_gate.prediction.maximum_inclusive = 1e9; }],
    ['singular gate drift', (value) => { value.numerical_stability_gate.singular_fit_allowed = true; }],
    ['interval nominal drift', (value) => { value.metrics.interval_nominal = 0.8; }],
    ['interval coverage drift', (value) => { value.promotion_gate.acceptable_interval_coverage_inclusive = [0.8, 1]; }],
    ['artifact boundary missing', (value) => { value.artifact_policy.forbidden = []; }],
    ['privacy drift', (value) => { value.privacy.coordinates_included = true; }],
    ['authority upgrade', (value) => { value.authority.local_evaluation = true; }],
    ['serving authority upgrade', (value) => { value.authority.serving = true; }],
    ['promotion state upgrade', (value) => { value.current_evaluation_state.status = 'promoted'; }],
    ['forbidden claims missing', (value) => { value.forbidden_claims.pop(); }],
  ];
  for (const [label, mutate] of hostileCases) {
    const candidate = structuredClone(protocol);
    mutate(candidate);
    assert.throws(
      () => validateAreaIntelligenceEvaluationProtocol(candidate),
      AreaIntelligenceEvaluationProtocolError,
      label,
    );
  }
});

test('runtime validator binds observed receipt and exact protocol bytes without authority inference', () => {
  assert.throws(
    () => validateAreaIntelligenceEvaluationProtocol(protocol, { receiptSha256: digest('different-observed-receipt') }),
    (error) => error instanceof AreaIntelligenceEvaluationProtocolError
      && error.code === 'receipt-sha256-drift',
  );
  const crlf = Buffer.from(protocolBytes.toString('utf8').replaceAll('\n', '\r\n'));
  assert.throws(
    () => validateAreaIntelligenceEvaluationProtocol(protocol, { protocolBytes: crlf }),
    (error) => error instanceof AreaIntelligenceEvaluationProtocolError
      && error.code === 'protocol-byte-format-drift',
  );
  const byteDrift = Buffer.from(protocolBytes.toString('utf8').replace(
    '2026-08-29T15:13:38.184Z',
    '2026-08-29T15:13:38.185Z',
  ));
  assert.throws(
    () => validateAreaIntelligenceEvaluationProtocol(protocol, { protocolBytes: byteDrift }),
    AreaIntelligenceEvaluationProtocolError,
  );
  assert.deepEqual(Object.values(protocol.authority), Array(7).fill(false));
});

test('stable serialization is key-order independent but array-order preserving', () => {
  assert.equal(stableSerialization({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(stableSerialization({ a: [2, 1] }), '{"a":[2,1]}');
  assert.notEqual(stableSerialization({ a: [2, 1] }), stableSerialization({ a: [1, 2] }));
});

function assertStrictObjectShapes(node, location = '#', seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (node.type === 'object') {
    assert.equal(node.additionalProperties, false, `${location} must set additionalProperties=false`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const' || key === 'enum') continue;
    if (Array.isArray(value)) {
      value.forEach((child, index) => assertStrictObjectShapes(child, `${location}/${key}/${index}`, seen));
    } else {
      assertStrictObjectShapes(value, `${location}/${key}`, seen);
    }
  }
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
