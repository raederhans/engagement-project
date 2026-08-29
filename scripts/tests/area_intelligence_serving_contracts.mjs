import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAreaIntelligenceServingArtifact,
  validateAreaIntelligenceServingCandidate,
} from '../../src/area_intelligence/serving_contract.js';
import { createAreaIntelligencePublicProjection } from '../publish_area_intelligence_evaluation.mjs';

test('healthy synthetic P3 no-promotion becomes a minimal unavailable public projection', () => {
  const context = syntheticContext();
  const projection = createAreaIntelligencePublicProjection(context);
  assert.equal(validateAreaIntelligenceServingArtifact(projection).status, 'not-promoted');
  assert.equal(validateAreaIntelligenceServingCandidate(projection, context).forecast.status, 'unavailable');
  assert.deepEqual(projection.forecast.predictions, []);
  assert.equal(projection.evaluation.selected_model, null);
  assert.equal(projection.evaluation.local_candidate_model, null);
  assert.deepEqual(projection.evaluation.why_unavailable.reason_codes, [
    'promotion-gate-not-passed',
    'primary-interval-90-gate-not-passed',
    'serving-authority-unavailable',
  ]);
  assert.ok(Object.values(projection.authority).every((value) => value === false));
});

test('a synthetic local candidate still has no forecast, serving, ranking, or safety authority', () => {
  const context = syntheticContext({ decision: 'local-candidate', intervalFailures: 0 });
  const projection = createAreaIntelligencePublicProjection(context);
  assert.equal(projection.forecast.status, 'unavailable');
  assert.deepEqual(projection.forecast.predictions, []);
  assert.equal(projection.evaluation.local_candidate_model, 'negative-binomial-log-link-v1');
  assert.equal(projection.authority.serving, false);
  assert.equal(projection.authority.safety, false);
  assert.deepEqual(projection.evaluation.why_unavailable.reason_codes, [
    'local-candidate-only', 'serving-authority-unavailable',
  ]);
  assert.doesNotMatch(JSON.stringify(projection), /aggregate_relative_mae_gain|rank|safety_score/i);
});

test('base and candidate validators reject unknown, gate, governance, numeric, sensitive, and forbidden-claim drift', () => {
  const context = syntheticContext();
  const healthy = createAreaIntelligencePublicProjection(context);
  const cases = [
    ['unknown field', (value) => { value.extra = true; }],
    ['embedded promotion', (value) => { value.promotion = { status: 'not-promoted' }; }],
    ['embedded gate', (value) => { value.evaluation.gate = value.evaluation; }],
    ['authority drift', (value) => { value.authority.serving = true; }],
    ['privacy drift', (value) => { value.privacy.coordinates_included = true; }],
    ['nonfinite', (value) => { value.evaluation.interval_90_outcome.failed_primary_slice_count = Number.NaN; }],
    ['sensitive value', (value) => { value.historical_evidence.source_as_of = 'C:\\Users\\person\\receipt.json'; }],
    ['missing safety score prohibition', (value) => { value.forbidden_claims.splice(2, 1); }],
    ['forecast claim', (value) => { value.forecast.status = 'available'; }],
    ['prediction leak', (value) => { value.forecast.predictions.push({ unit_id: '42101007400' }); }],
  ];
  for (const [label, mutate] of cases) {
    const value = structuredClone(healthy);
    mutate(value);
    assert.throws(() => validateAreaIntelligenceServingArtifact(value), undefined, label);
  }
});

test('candidate validator rejects external protocol, receipt, mart, report, gate, clock, coverage, authority, and privacy drift', () => {
  const context = syntheticContext();
  const healthy = createAreaIntelligencePublicProjection(context);
  const cases = [
    ['protocol identity', (ctx) => { ctx.report.protocol.sha256 = '9'.repeat(64); }],
    ['receipt identity', (ctx) => { ctx.m1Receipt.identity = `sha256:${'9'.repeat(64)}`; }],
    ['mart identity', (ctx) => { ctx.martManifest.artifact_identity = `sha256:${'9'.repeat(64)}`; }],
    ['report outcome', (ctx) => { ctx.report.promotion.decision = 'local-candidate'; }],
    ['gate outcome', (ctx) => { ctx.report.metrics.primary_by_fold_space_holdout[0].prediction_interval_90_coverage = 0.9; }],
    ['source clock', (ctx) => { ctx.m1Receipt.clocks.source_as_of = '2026-08-28T00:00:00.000Z'; }],
    ['coverage', (ctx) => { ctx.report.data.coverage.earliest_scope_start = '2007-01-01'; }],
    ['authority', (ctx) => { ctx.manifest.authority.serving = true; }],
    ['privacy', (ctx) => { ctx.protocol.privacy.aggregate_only = false; }],
  ];
  for (const [label, mutate] of cases) {
    const drifted = structuredClone(context);
    mutate(drifted);
    assert.throws(() => validateAreaIntelligenceServingCandidate(healthy, drifted), /external context|authority|privacy/i, label);
  }
});

test('projection allowlist excludes full metrics, slices, residuals, model state, area ordering, and record/location detail', () => {
  const projection = createAreaIntelligencePublicProjection(syntheticContext({ decision: 'local-candidate' }));
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    'aggregate_primary', 'primary_by_fold_space_holdout', 'by_category', 'by_data_volume',
    'residual_map', 'model_state', 'area_ordering', 'source_record_id', 'event_id',
    'generalized_location', 'coordinates', 'unit_id',
  ]) assert.doesNotMatch(serialized, new RegExp(`"${forbidden}"`, 'i'));
});

test('legacy tracked v1 remains display-readable but fails current-candidate admission', () => {
  const legacy = {
    schema: 'engagement-area-intelligence-serving/v1',
    generated_at: '2026-08-21T07:53:40.810Z',
    status: 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: {
        earliest_scope_start: '2006-01-01',
        latest_scope_end_exclusive: '2026-08-22',
        latest_event_at: '2026-08-20T03:47:00.000Z',
      },
      source_vintage: `sha256:${'1'.repeat(64)}`,
      limitations: ['Historical aggregate evidence only.'],
    },
    forecast: { status: 'unavailable', reason: 'model-did-not-exceed-predefined-seasonal-baseline', predictions: [] },
    evaluation: { promotion_status: 'not-promoted', selected_model: null },
    forbidden_claims: [
      'individual victim probability', 'absolute safety', 'safety score',
      'safest area', 'safest route', 'causal effect',
    ],
  };
  assert.equal(validateAreaIntelligenceServingArtifact(legacy).schema, legacy.schema);
  assert.throws(() => validateAreaIntelligenceServingCandidate(legacy), /Legacy/);
});

function syntheticContext({ decision = 'no-promotion', intervalFailures = 2 } = {}) {
  const authority = Object.fromEntries([
    'local_evaluation', 'serving', 'product_promotion', 'scientific', 'causal', 'safety', 'deletion',
  ].map((key) => [key, false]));
  const privacy = {
    aggregate_only: true,
    event_level_data_included: false,
    coordinates_included: false,
    generalized_locations_included: false,
    raw_or_canonical_events_included: false,
    source_record_ids_included: false,
  };
  const protocolSha = 'a'.repeat(64);
  const receiptIdentity = `sha256:${'d'.repeat(64)}`;
  const receiptSha = `sha256:${'e'.repeat(64)}`;
  const localCandidateModel = decision === 'local-candidate' ? 'negative-binomial-log-link-v1' : null;
  const protocol = {
    schema: 'engagement-area-intelligence-evaluation-protocol/v2',
    exact_input_gate: { receipt_identity: receiptIdentity, receipt_sha256: receiptSha },
    target: {
      grain: 'spatial-unit-week', measure: 'PPD reported incident count',
      week_definition: 'UTC Monday 00:00 inclusive to next Monday exclusive',
      exclude_incomplete_source_week: true,
    },
    marts: { unit_types: ['tract', 'fixed-grid'] },
    spatial_holdout: { training_policy: 'Poisson and negative-binomial fits exclude held-out blocks' },
    admission: { ambiguous_or_unavailable: 'exclude-and-audit-never-force-assign' },
    promotion_gate: {
      eligible_models: ['poisson-log-link-v1', 'negative-binomial-log-link-v1'],
      acceptable_interval_coverage_inclusive: [0.85, 0.95],
    },
    authority,
    privacy,
    forbidden_claims: [
      'individual victim probability', 'absolute safety', 'safety score',
      'safest area', 'safest route', 'causal effect',
    ],
  };
  const generatedAt = '2026-08-30T00:00:00.000Z';
  const manifest = {
    schema: 'engagement-area-intelligence-evaluation-run/v2',
    protocol_sha256: protocolSha,
    generated_at: generatedAt,
    authority: structuredClone(authority),
    privacy: structuredClone(privacy),
  };
  const martManifest = {
    schema: 'engagement-area-intelligence-feature-mart/v2',
    protocol: { sha256: protocolSha },
    exact_input: { receipt_identity: receiptIdentity, receipt_sha256: receiptSha },
    source_coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-29' },
    artifact_identity: `sha256:${'f'.repeat(64)}`,
    part_bindings_identity: `sha256:${'1'.repeat(64)}`,
  };
  const report = {
    generated_at: generatedAt,
    protocol: { sha256: protocolSha },
    data: {
      source_vintage: `sha256:${'2'.repeat(64)}`,
      coverage: { earliest_scope_start: '2006-01-01', latest_scope_end_exclusive: '2026-08-29' },
      complete_week_end_exclusive: '2026-08-24',
    },
    promotion: {
      status: 'not-promoted', decision, selected_model: null,
      local_candidate_model: localCandidateModel, local_candidate_only: true,
    },
    metrics: {
      primary_by_fold_space_holdout: [
        { model: 'poisson-log-link-v1', prediction_interval_90_coverage: intervalFailures > 0 ? 0.8 : 0.9 },
        { model: 'negative-binomial-log-link-v1', prediction_interval_90_coverage: intervalFailures > 1 ? 0.8 : 0.9 },
      ],
    },
    authority: structuredClone(authority),
    privacy: structuredClone(privacy),
  };
  manifest.mart_manifest_sha256 = 'b'.repeat(64);
  manifest.mart_artifact_identity = martManifest.artifact_identity;
  manifest.promotion = structuredClone(report.promotion);
  manifest.lineage_seam = {
    protocol: { sha256: protocolSha },
    mart: {
      manifest_sha256: 'b'.repeat(64),
      artifact_identity: martManifest.artifact_identity,
      part_bindings_identity: martManifest.part_bindings_identity,
    },
    m1_receipt: { identity: receiptIdentity, sha256: receiptSha },
    outcome: { promotion_status: 'not-promoted', selected_model: null, availability: 'unavailable' },
  };
  return {
    protocol,
    manifest,
    manifestIdentity: 'c'.repeat(64),
    martManifest,
    martManifestIdentity: 'b'.repeat(64),
    m1Receipt: {
      schema: 'engagement-phl-crime-warehouse-receipt/v3',
      identity: receiptIdentity,
      clocks: { source_as_of: '2026-08-29T00:00:00.000Z' },
      warehouse: { current_snapshot_id: report.data.source_vintage },
      coverage: { start: '2006-01-01', end_exclusive: '2026-08-29' },
    },
    m1ReceiptSha256: receiptSha,
    report,
    checkpoint: {
      numerical_gate: {
        primary_slices_passed: intervalFailures === 0,
        failed_primary_slice_count: intervalFailures,
      },
      protocol_sha256: protocolSha,
      mart_manifest_sha256: 'b'.repeat(64),
      mart_artifact_identity: martManifest.artifact_identity,
      receipt_sha256: receiptSha,
    },
  };
}
