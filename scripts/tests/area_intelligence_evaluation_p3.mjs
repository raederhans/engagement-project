import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  diagnoseEvaluationSlice,
  evaluateAreaIntelligence,
  evaluatePromotion,
  validateAreaIntelligenceEvaluationCheckpoint,
  validateAreaIntelligenceEvaluationManifest,
  validateAreaIntelligenceEvaluationServingArtifact,
  validateEvaluationObservation,
  validateModelEvaluationReport,
} from '../lib/area_intelligence_evaluation.mjs';
import { diagnoseModelNumerics } from '../lib/area_intelligence_model.mjs';
import {
  AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
  loadAreaIntelligenceEvaluationProtocol,
  stableSerialization,
} from '../lib/area_intelligence_evaluation_protocol.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const protocolPath = path.join(repoRoot, 'scripts/data/area_intelligence_evaluation_protocol.v2.json');
const protocol = await loadAreaIntelligenceEvaluationProtocol({ protocolPath });

test('healthy exact synthetic evaluation remains a local candidate with all authority false', () => {
  const finalized = healthyFinalized();
  const first = evaluatePromotion(finalized, protocol);
  const second = evaluatePromotion(structuredClone(finalized), protocol);
  assert.deepEqual(second, first);
  assert.equal(first.status, 'not-promoted');
  assert.equal(first.decision, 'local-candidate');
  assert.equal(first.selected_model, null);
  assert.ok(protocol.promotion_gate.eligible_models.includes(first.local_candidate_model));
  assert.ok(Object.values(first.authority).every((value) => value === false));
  assert.ok(first.candidates.every(({ passed, aggregate_evaluated }) => passed && aggregate_evaluated));
});

test('primary tuples reject same-length duplicates, missing tuples, and unknown tuples', () => {
  const duplicate = healthyFinalized();
  duplicate.primary[15] = structuredClone(duplicate.primary[14]);
  const duplicateResult = evaluatePromotion(duplicate, protocol);
  assert.match(candidateReasons(duplicateResult), /primary-tuple-duplicate/);
  assert.match(candidateReasons(duplicateResult), /primary-tuple-missing/);
  assert.equal(duplicateResult.candidates[0].aggregate_evaluated, false);

  const missing = healthyFinalized();
  missing.primary.splice(0, 1);
  assert.match(candidateReasons(evaluatePromotion(missing, protocol)), /primary-tuple-missing/);

  const unknown = healthyFinalized();
  unknown.primary[0].holdout_slice = 'unknown-heldout';
  const unknownResult = evaluatePromotion(unknown, protocol);
  assert.match(candidateReasons(unknownResult), /primary-tuple-unknown/);
  assert.match(candidateReasons(unknownResult), /primary-tuple-missing/);

  const reordered = healthyFinalized();
  [reordered.primary[0], reordered.primary[1]] = [reordered.primary[1], reordered.primary[0]];
  assert.match(candidateReasons(evaluatePromotion(reordered, protocol)), /primary-tuple-order-invalid/);
});

test('every exact fit state is required and numerical failures cannot be bypassed by aggregate metrics', () => {
  for (const failure of [
    'irls-singular',
    'irls-non-converged',
    'irls-iteration-cap-exhausted',
    'irls-coefficient-exceeds-maximum',
    'nb-dispersion-out-of-bounds',
  ]) {
    const finalized = healthyFinalized();
    const row = finalized.numerical_diagnostics.fit_states.find(({ model }) => model === 'poisson-log-link-v1');
    row.failures = [failure];
    row.passed = false;
    finalized.aggregate[0].relative_mae_gain_vs_seasonal_naive = 1;
    const result = evaluatePromotion(finalized, protocol);
    assert.equal(result.status, 'not-promoted', failure);
    assert.equal(result.candidates[0].aggregate_evaluated, false, failure);
    assert.match(result.candidates[0].reasons.join(','), /fit-state-numerical-gate-failed/, failure);
  }

  const missing = healthyFinalized();
  missing.numerical_diagnostics.fit_states.shift();
  const result = evaluatePromotion(missing, protocol);
  assert.match(candidateReasons(result), /fit-state-missing/);
  assert.equal(result.candidates[0].aggregate_evaluated, false);
});

test('fit-state diagnostics reject singular, non-converged, coefficient overflow, and invalid dispersion states', () => {
  const cases = [
    ['irls-singular', (input) => { input.irls.singular = true; }],
    ['irls-non-converged', (input) => {
      input.irls.iterationsCompleted = input.irls.maximumIterations;
      input.irls.lastChange = 0.01;
    }],
    ['irls-coefficient-exceeds-maximum', (input) => { input.irls.coefficients = [12.000001]; }],
    ['nb-dispersion-out-of-bounds', (input) => { input.dispersion.value = 10.000001; }],
  ];
  for (const [failure, mutate] of cases) {
    const input = healthyFitDiagnosticInput();
    mutate(input);
    const diagnostic = diagnoseModelNumerics(input);
    assert.equal(diagnostic.ok, false, failure);
    assert.ok(diagnostic.failures.includes(failure), failure);
  }
});

test('all model predictions and intervals fail streaming gates before metric accumulation', () => {
  const maximum = protocol.numerical_stability_gate.prediction.maximum_inclusive;
  for (const [label, input, expected] of [
    ['NaN', { predicted: Number.NaN, interval: { lower: 0, upper: 1 }, maximumPrediction: maximum }, 'prediction-non-finite'],
    ['Infinity', { predicted: Number.POSITIVE_INFINITY, interval: { lower: 0, upper: 1 }, maximumPrediction: maximum }, 'prediction-non-finite'],
    ['negative', { predicted: -1, interval: { lower: 0, upper: 1 }, maximumPrediction: maximum }, 'prediction-negative'],
    ['over maximum', { predicted: maximum + 1, interval: { lower: 0, upper: 1 }, maximumPrediction: maximum }, 'prediction-exceeds-maximum'],
    ['negative interval', { predicted: 1, interval: { lower: -1, upper: 1 }, maximumPrediction: maximum }, 'interval-negative-lower'],
    ['inverted interval', { predicted: 1, interval: { lower: 2, upper: 1 }, maximumPrediction: maximum }, 'interval-inverted'],
    ['non-finite interval', { predicted: 1, interval: { lower: 0, upper: Number.NaN }, maximumPrediction: maximum }, 'interval-non-finite'],
  ]) {
    assert.ok(validateEvaluationObservation(input).includes(expected), label);
  }
  assert.deepEqual(validateEvaluationObservation({
    predicted: 1,
    interval: { lower: 0, upper: 2 },
    maximumPrediction: maximum,
  }), []);
});

test('interval cardinality, order, finite bounds, and coverage remain explicit diagnostics', () => {
  const maximumPrediction = protocol.numerical_stability_gate.prediction.maximum_inclusive;
  const cases = [
    [{ predictions: [1, 2], intervals: [{ lower: 0, upper: 2 }], coverages: [0.9], maximumPrediction }, 'prediction-interval-count-mismatch'],
    [{ predictions: [1], intervals: [{ lower: 2, upper: 1 }], coverages: [0.9], maximumPrediction }, 'interval-inverted'],
    [{ predictions: [1], intervals: [{ lower: -1, upper: 1 }], coverages: [0.9], maximumPrediction }, 'interval-negative-lower'],
    [{ predictions: [1], intervals: [{ lower: 0, upper: Number.POSITIVE_INFINITY }], coverages: [0.9], maximumPrediction }, 'interval-non-finite'],
    [{ predictions: [1], intervals: [{ lower: 0, upper: 1 }], coverages: [-0.01, 1.01], maximumPrediction }, 'coverage-out-of-bounds'],
    [{ predictions: [1], intervals: [{ lower: 0, upper: 1 }], coverages: [Number.NaN], maximumPrediction }, 'coverage-non-finite'],
  ];
  for (const [input, failure] of cases) {
    assert.ok(diagnoseEvaluationSlice(input).failures.includes(failure), failure);
  }
});

test('primary numerical failure blocks aggregate bypass and produces honest no-promotion', () => {
  const finalized = healthyFinalized();
  for (const model of protocol.promotion_gate.eligible_models) {
    const slice = finalized.numerical_diagnostics.primary_slices.find((row) => row.model === model);
    slice.failures = ['prediction-exceeds-maximum'];
    slice.passed = false;
  }
  finalized.aggregate.find(({ model }) => model === 'poisson-log-link-v1').relative_mae_gain_vs_seasonal_naive = 1;
  const result = evaluatePromotion(finalized, protocol);
  assert.equal(result.decision, 'no-promotion');
  assert.equal(result.candidates[0].aggregate_evaluated, false);
  assert.match(result.candidates[0].reasons.join(','), /primary-slice-numerical-gate-failed/);
});

test('report validator deep-checks exact fit states, coverage, finite JSON, and aggregate-only privacy', () => {
  const fixture = healthyValidationFixture();
  const { report } = fixture;
  assert.equal(validateModelEvaluationReport(report, fixture), true);
  assert.equal(JSON.stringify(report), JSON.stringify(structuredClone(report)));

  const missingFit = structuredClone(report);
  missingFit.numerical_diagnostics.fit_states.splice(3, 1);
  assert.throws(() => validateModelEvaluationReport(missingFit, { ...fixture, report: missingFit }), /fit state set/);

  const invalidCoverage = structuredClone(report);
  invalidCoverage.numerical_diagnostics.primary_slices[0].coverage = 1.01;
  assert.throws(() => validateModelEvaluationReport(invalidCoverage, { ...fixture, report: invalidCoverage }), /checks drifted/);

  const nonfinite = structuredClone(report);
  nonfinite.metrics.aggregate_primary[0].mae = Number.NaN;
  assert.throws(() => validateModelEvaluationReport(nonfinite, { ...fixture, report: nonfinite }), /non-finite/);

  const raw = structuredClone(report);
  raw.event_id = 'must-not-escape';
  assert.throws(() => validateModelEvaluationReport(raw, { ...fixture, report: raw }), /aggregate-only/);

  const synchronizedGateTamper = structuredClone(report);
  synchronizedGateTamper.promotion.gate.minimum_aggregate_relative_mae_gain = 0;
  synchronizedGateTamper.promotion.candidates.forEach((candidate) => { candidate.passed = true; });
  assert.throws(() => validateModelEvaluationReport(synchronizedGateTamper, {
    ...fixture, report: synchronizedGateTamper,
  }), /embedded protocol gates/);

  const synchronizedAggregateTamper = structuredClone(report);
  synchronizedAggregateTamper.metrics.aggregate_primary[0].mae = 0;
  synchronizedAggregateTamper.promotion.candidates.forEach((candidate) => {
    candidate.aggregate_relative_mae_gain = 1;
  });
  assert.throws(() => validateModelEvaluationReport(synchronizedAggregateTamper, {
    ...fixture, report: synchronizedAggregateTamper,
  }), /aggregate mae/);

  const synchronizedDiagnosticTamper = structuredClone(report);
  synchronizedDiagnosticTamper.numerical_diagnostics.fit_states[0].checks.irls.singular = true;
  synchronizedDiagnosticTamper.numerical_diagnostics.fit_states[0].failures = [];
  synchronizedDiagnosticTamper.numerical_diagnostics.fit_states[0].passed = true;
  assert.throws(() => validateModelEvaluationReport(synchronizedDiagnosticTamper, {
    ...fixture, report: synchronizedDiagnosticTamper,
  }), /checkpoint state/);

  const synchronizedPassFailureTamper = structuredClone(report);
  synchronizedPassFailureTamper.numerical_diagnostics.fit_states[0].failures = ['irls-singular'];
  synchronizedPassFailureTamper.numerical_diagnostics.fit_states[0].passed = false;
  synchronizedPassFailureTamper.numerical_diagnostics.all_applicable_fit_states_passed = false;
  const synchronizedCheckpoint = structuredClone(fixture.checkpoint);
  synchronizedCheckpoint.numerical_gate.fit_states_passed = false;
  synchronizedCheckpoint.numerical_gate.failed_fit_state_count = 1;
  assert.throws(() => validateModelEvaluationReport(synchronizedPassFailureTamper, {
    ...fixture,
    report: synchronizedPassFailureTamper,
    checkpoint: synchronizedCheckpoint,
  }), /failures drifted/);
});

test('checkpoint, manifest, and serving validators preserve candidate-only authority', () => {
  const { report, martManifest, martManifestIdentity, checkpoint } = healthyValidationFixture();
  assert.equal(validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
    martManifestIdentity,
    martArtifactIdentity: martManifest.artifact_identity,
    receiptSha256: protocol.exact_input_gate.receipt_sha256,
    protocol,
    report,
  }), true);
  const missingCheckpointState = structuredClone(checkpoint);
  delete missingCheckpointState.states[Object.keys(missingCheckpointState.states)[0]];
  assert.throws(() => validateAreaIntelligenceEvaluationCheckpoint(missingCheckpointState, {
    martManifestIdentity,
    martArtifactIdentity: martManifest.artifact_identity,
    receiptSha256: protocol.exact_input_gate.receipt_sha256,
    protocol,
  }), /checkpoint fit state/);

  const serving = healthyServing(report);
  assert.equal(validateAreaIntelligenceEvaluationServingArtifact(serving, {
    report, protocol, martManifest, martManifestIdentity, checkpoint,
  }), true);
  const manifest = {
    schema: 'engagement-area-intelligence-evaluation-run/v2',
    protocol: {
      schema: protocol.schema,
      sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
      receipt_sha256: protocol.exact_input_gate.receipt_sha256,
    },
    protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    promotion: report.promotion,
    availability: 'unavailable',
    local_candidate_only: true,
    authority: structuredClone(protocol.authority),
    privacy: structuredClone(protocol.privacy),
    artifacts: [
      'bias-error-audit.json',
      'data-lineage-summary.json',
      'model-card.md',
      'model-evaluation-report.json',
      'model-state.json',
      'residual-map.json',
      'serving-artifact.json',
    ].map((name) => ({ name, bytes: 1, sha256: '0'.repeat(64) })),
  };
  assert.equal(validateAreaIntelligenceEvaluationManifest(manifest, {
    protocol, martManifest, martManifestIdentity, report, servingArtifact: serving, checkpoint,
  }), true);
  const fittingCheckpoint = structuredClone(checkpoint);
  fittingCheckpoint.status = 'fitting';
  assert.throws(() => validateAreaIntelligenceEvaluationManifest(manifest, {
    protocol, martManifest, martManifestIdentity, report, servingArtifact: serving, checkpoint: fittingCheckpoint,
  }), /cannot complete before/);
  manifest.authority.serving = true;
  assert.throws(() => validateAreaIntelligenceEvaluationManifest(manifest, {
    protocol, martManifest, martManifestIdentity, report, servingArtifact: serving, checkpoint,
  }), /exact P3 contract/);
});

test('existing-run recovery never treats a fitting checkpoint beside a manifest as complete', async (t) => {
  const root = path.join(repoRoot, '.dfev1', `p3-interruption-${process.pid}-${Date.now()}`);
  const martRoot = path.join(root, 'mart');
  const outputRoot = path.join(root, 'evaluation');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { martManifest, martManifestIdentity, martInventory } = await writeExactEmptyMart(martRoot);
  const states = healthyCheckpointStates();
  const report = healthyReport({ martManifest, martManifestIdentity, states });
  const checkpoint = healthyCheckpoint({ martManifest, martManifestIdentity, states, status: 'fitting' });
  const serving = healthyServing(report);
  await fs.mkdir(outputRoot, { recursive: true });
  const artifactContents = {
    'bias-error-audit.json': '{}\n',
    'data-lineage-summary.json': '{}\n',
    'model-card.md': 'local candidate only\n',
    'model-evaluation-report.json': `${JSON.stringify(report, null, 2)}\n`,
    'model-state.json': '{}\n',
    'residual-map.json': '{}\n',
    'serving-artifact.json': `${JSON.stringify(serving, null, 2)}\n`,
  };
  const artifacts = [];
  for (const [name, contents] of Object.entries(artifactContents)) {
    await fs.writeFile(path.join(outputRoot, name), contents);
    artifacts.push({ name, bytes: Buffer.byteLength(contents), sha256: hashHex(contents) });
  }
  artifacts.sort((left, right) => left.name.localeCompare(right.name));
  const manifest = healthyEvaluationManifest({
    report, martManifest, martManifestIdentity, martInventory, artifacts,
  });
  await fs.writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(outputRoot, 'checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);

  await assert.rejects(evaluateAreaIntelligence({ martRoot, outputRoot, protocolPath }), /invalid completed run/);

  checkpoint.status = 'complete';
  await fs.writeFile(path.join(outputRoot, 'checkpoint.json'), `${JSON.stringify(checkpoint, null, 2)}\n`);
  const recovered = await evaluateAreaIntelligence({ martRoot, outputRoot, protocolPath });
  assert.equal(recovered.idempotent, true);
});

test('legacy protocol-bound M2 is rejected before part access and before output creation', async (t) => {
  const root = path.join(repoRoot, '.dfev1', `p3-preflight-${process.pid}-${Date.now()}`);
  const martRoot = path.join(root, 'mart');
  const outputRoot = path.join(root, 'evaluation');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(martRoot, { recursive: true });
  await fs.writeFile(path.join(martRoot, 'manifest.json'), `${JSON.stringify({
    schema: 'engagement-area-intelligence-feature-mart/v2',
    protocol: {
      schema: protocol.schema,
      sha256: '5c6361a3be6c03058592703d574dfcd2b921f520c381fbfde539b443b5be7eac',
      frozen_before_model_performance: true,
    },
    exact_input: {
      receipt_schema: protocol.exact_input_gate.receipt_schema,
      receipt_identity: protocol.exact_input_gate.receipt_identity,
      receipt_sha256: protocol.exact_input_gate.receipt_sha256,
    },
    parts: [{ path: 'marts/tract/part-000.jsonl' }],
  }, null, 2)}\n`);
  await assert.rejects(
    evaluateAreaIntelligence({ martRoot, outputRoot, protocolPath }),
    /frozen evaluation gate/,
  );
  await assert.rejects(fs.access(outputRoot));
});

test('evaluation output rejects a symlink or junction escape before creating external files', async (t) => {
  const ownedRoot = path.join(repoRoot, '.dfev1', `p3-path-${process.pid}-${Date.now()}`);
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'area-intelligence-p3-outside-'));
  const linkPath = path.join(ownedRoot, 'escape');
  t.after(() => fs.rm(ownedRoot, { recursive: true, force: true }));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  await fs.mkdir(ownedRoot, { recursive: true });
  try {
    await fs.symlink(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    assert.deepEqual(await fs.readdir(outsideRoot), []);
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`environment cannot create a directory link: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(evaluateAreaIntelligence({
    martRoot: path.join(ownedRoot, 'missing-mart'),
    outputRoot: path.join(linkPath, 'evaluation'),
    protocolPath,
  }), /symbolic link or junction/);
  assert.deepEqual(await fs.readdir(outsideRoot), []);
});

test('CLI rejects unknown, duplicate, empty, and missing output arguments without path disclosure', async () => {
  const script = path.join(repoRoot, 'scripts/evaluate_area_intelligence.mjs');
  const secret = 'private-sensitive-path-do-not-echo';
  const cases = [
    [`--unknown=${secret}`],
    ['--output=.dfev1/a', '--output=.dfev1/b'],
    ['--output='],
    [`--mart=${secret}`],
  ];
  for (const args of cases) {
    await assert.rejects(execFileAsync(process.execPath, [script, ...args], { cwd: repoRoot }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /area-intelligence-evaluation-error/);
      assert.doesNotMatch(error.stderr, new RegExp(secret));
      return true;
    });
  }
});

function healthyFinalized() {
  const primary = [];
  for (const model of protocol.promotion_gate.eligible_models) {
    for (const tuple of protocol.primary_tuple_vocabulary) primary.push(metricRow(model, tuple));
  }
  const fitStateVocabulary = protocol.promotion_gate.eligible_models.flatMap((model) => fitDescriptors(model));
  const primarySliceVocabulary = protocol.promotion_gate.eligible_models.flatMap((model) => (
    protocol.primary_tuple_vocabulary.map((tuple) => ({ model, ...tuple }))
  ));
  return {
    primary,
    category: protocol.promotion_gate.eligible_models.map((model) => ({
      model, fold: 'fold-2019', category: 'person', holdout_slice: 'spatial-heldout',
      relative_mae_gain_vs_seasonal_naive: 0,
    })),
    aggregate: protocol.promotion_gate.eligible_models.map((model) => ({
      model, relative_mae_gain_vs_seasonal_naive: 0.08,
    })),
    numerical_diagnostics: {
      schema: 'engagement-area-intelligence-numerical-diagnostics/v1',
      protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
      fit_state_vocabulary: fitStateVocabulary,
      primary_slice_vocabulary: primarySliceVocabulary,
      fit_states: fitStateVocabulary.map((value) => diagnosticFit(value)),
      primary_slices: primarySliceVocabulary.map((value) => diagnosticSlice(value)),
      authority: structuredClone(protocol.authority),
      local_candidate_only: true,
    },
  };
}

async function writeExactEmptyMart(martRoot) {
  const partPath = 'marts/tract/part-000.jsonl';
  const absolutePartPath = path.join(martRoot, ...partPath.split('/'));
  await fs.mkdir(path.dirname(absolutePartPath), { recursive: true });
  await fs.mkdir(path.join(martRoot, 'marts/fixed-grid'), { recursive: true });
  await fs.writeFile(absolutePartPath, '');
  const part = {
    path: partPath,
    unit_type: 'tract',
    partition: 0,
    row_count: 0,
    bytes: 0,
    sha256: hashHex(''),
  };
  const partBindingsIdentity = stableIdentity([part]);
  const martManifest = {
    schema: 'engagement-area-intelligence-feature-mart/v2',
    protocol: {
      schema: protocol.schema,
      sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
      receipt_sha256: protocol.exact_input_gate.receipt_sha256,
      frozen_before_model_performance: true,
    },
    exact_input: {
      receipt_schema: protocol.exact_input_gate.receipt_schema,
      receipt_identity: protocol.exact_input_gate.receipt_identity,
      receipt_sha256: protocol.exact_input_gate.receipt_sha256,
      warehouse_current_snapshot_id: digest('snapshot'),
      canonical: { row_count: 0 },
      counts: { canonical_rows: 0 },
    },
    source_coverage: { first: null, last: null },
    evaluation_complete_week_end_exclusive: '2026-01-05',
    unit_count: { tract: 0, 'fixed-grid': 0 },
    admission: {
      canonical_rows_seen: 0,
      tract: { admitted: 0, ambiguous_excluded: 0, unmapped_excluded: 0 },
      'fixed-grid': { admitted: 0, unavailable_excluded: 0 },
      unknown_category: 0,
      invalid_event_time: 0,
      non_active: 0,
    },
    parts: [part],
    row_count: 0,
    bytes: 0,
    part_bindings_identity: partBindingsIdentity,
    artifact_policy: { event_level_data_included: false },
    generated_at: '2026-08-29T00:00:00.000Z',
  };
  const core = structuredClone(martManifest);
  delete core.generated_at;
  martManifest.artifact_identity = stableIdentity(core);
  const manifestContents = `${JSON.stringify(martManifest, null, 2)}\n`;
  await fs.writeFile(path.join(martRoot, 'manifest.json'), manifestContents);
  return {
    martManifest,
    martManifestIdentity: hashHex(manifestContents),
    martInventory: { parts: [part], row_count: 0, bytes: 0, part_bindings_identity: partBindingsIdentity },
  };
}

function healthyCheckpoint({ martManifest, martManifestIdentity, states, status = 'complete' }) {
  return {
    schema: 'engagement-area-intelligence-evaluation-checkpoint/v2',
    status,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    protocol_schema: protocol.schema,
    protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    receipt_sha256: protocol.exact_input_gate.receipt_sha256,
    poisson_iterations_completed: 2,
    dispersion_completed: true,
    nb_iterations_completed: 2,
    baseline_intervals_completed: true,
    numerical_gate: {
      fit_states_passed: true,
      primary_slices_passed: true,
      failed_fit_state_count: 0,
      failed_primary_slice_count: 0,
    },
    states,
  };
}

function healthyEvaluationManifest({ report, martManifest, martManifestIdentity, martInventory, artifacts }) {
  return {
    schema: 'engagement-area-intelligence-evaluation-run/v2',
    protocol: {
      schema: protocol.schema,
      sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
      receipt_sha256: protocol.exact_input_gate.receipt_sha256,
    },
    protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    lineage_seam: {
      schema: 'engagement-area-intelligence-lineage-seam/v1',
      protocol: { schema: protocol.schema, sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256 },
      mart: {
        schema: martManifest.schema,
        manifest_sha256: martManifestIdentity,
        artifact_identity: martManifest.artifact_identity,
        part_bindings_identity: martInventory.part_bindings_identity,
        part_count: martInventory.parts.length,
        row_count: martInventory.row_count,
        bytes: martInventory.bytes,
        parts: martInventory.parts,
      },
      m1_receipt: {
        schema: martManifest.exact_input.receipt_schema,
        identity: martManifest.exact_input.receipt_identity,
        sha256: martManifest.exact_input.receipt_sha256,
      },
      outcome: {
        promotion_status: report.promotion.status,
        selected_model: report.promotion.selected_model,
        availability: 'unavailable',
      },
    },
    promotion: report.promotion,
    availability: 'unavailable',
    selected_audit_model: 'negative-binomial-log-link-v1',
    local_candidate_only: true,
    authority: structuredClone(protocol.authority),
    privacy: structuredClone(protocol.privacy),
    artifacts,
    generated_at: '2026-08-29T00:00:00.000Z',
    identity_meaning: 'Artifact byte identity only.',
  };
}

function healthyFitDiagnosticInput() {
  return {
    irls: {
      iterationsCompleted: 2,
      maximumIterations: 6,
      lastChange: 1e-8,
      convergenceTolerance: protocol.numerical_stability_gate.convergence.threshold_exclusive,
      singular: false,
      coefficients: [0.5],
    },
    coefficientAbsoluteMaximum: protocol.numerical_stability_gate.coefficient_abs_limit_inclusive,
    dispersion: {
      value: 0.2,
      minimum: protocol.numerical_stability_gate.dispersion_alpha_inclusive[0],
      maximum: protocol.numerical_stability_gate.dispersion_alpha_inclusive[1],
    },
    predictions: [1],
    maximumPrediction: protocol.numerical_stability_gate.prediction.maximum_inclusive,
    intervals: [{ lower: 0, upper: 2 }],
    coverages: [0.9],
  };
}

function healthyValidationFixture() {
  const martManifest = healthyMartManifest();
  const martManifestIdentity = digest('manifest');
  const states = healthyCheckpointStates();
  const report = healthyReport({ martManifest, martManifestIdentity, states });
  const checkpoint = {
    schema: 'engagement-area-intelligence-evaluation-checkpoint/v2',
    status: 'complete',
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    protocol_schema: protocol.schema,
    protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    receipt_sha256: protocol.exact_input_gate.receipt_sha256,
    poisson_iterations_completed: 2,
    dispersion_completed: true,
    nb_iterations_completed: 2,
    baseline_intervals_completed: true,
    numerical_gate: {
      fit_states_passed: true,
      primary_slices_passed: true,
      failed_fit_state_count: 0,
      failed_primary_slice_count: 0,
    },
    states,
  };
  return { protocol, martManifest, martManifestIdentity, report, checkpoint };
}

function healthyMartManifest() {
  return {
    artifact_identity: digest('mart'),
    exact_input: { warehouse_current_snapshot_id: digest('snapshot') },
    source_coverage: { first: '2018-01-01', last: '2026-01-01' },
    evaluation_complete_week_end_exclusive: '2026-01-05',
    unit_count: { tract: 1, 'fixed-grid': 1 },
    row_count: 32,
    admission: { canonical_rows_seen: 32 },
  };
}

function healthyReport({ martManifest, martManifestIdentity, states }) {
  const allPrimary = protocol.models.flatMap(({ id }) => (
    protocol.primary_tuple_vocabulary.map((tuple) => metricRow(id, tuple))
  ));
  const fitStateVocabulary = protocol.promotion_gate.eligible_models.flatMap((model) => fitDescriptors(model));
  const primarySliceVocabulary = protocol.models.flatMap(({ id: model }) => (
    protocol.primary_tuple_vocabulary.map((tuple) => ({ model, ...tuple }))
  ));
  const numericalDiagnostics = {
    schema: 'engagement-area-intelligence-numerical-diagnostics/v1',
    protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    gate: structuredClone(protocol.numerical_stability_gate),
    fit_state_vocabulary: fitStateVocabulary,
    primary_slice_vocabulary: primarySliceVocabulary,
    fit_states: fitStateVocabulary.map((value) => diagnosticFit(value, states)),
    primary_slices: primarySliceVocabulary.map((value) => diagnosticSlice(value)),
    all_applicable_fit_states_passed: true,
    all_primary_slices_passed: true,
    expected_fit_state_count_per_count_model: fitDescriptors(protocol.promotion_gate.eligible_models[0]).length,
    local_candidate_only: true,
    authority: structuredClone(protocol.authority),
  };
  const report = {
    schema: 'ModelEvaluationReport/v1',
    generated_at: '2026-08-29T00:00:00.000Z',
    protocol: {
      schema: protocol.schema,
      sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
      frozen_at: protocol.frozen_at,
      frozen_before_model_performance: true,
    },
    target: structuredClone(protocol.target),
    data: {
      mart_artifact_identity: martManifest.artifact_identity,
      mart_manifest_sha256: martManifestIdentity,
      source_vintage: martManifest.exact_input.warehouse_current_snapshot_id,
      coverage: structuredClone(martManifest.source_coverage),
      complete_week_end_exclusive: martManifest.evaluation_complete_week_end_exclusive,
      unit_count: structuredClone(martManifest.unit_count),
      mart_rows: martManifest.row_count,
      admission: structuredClone(martManifest.admission),
    },
    folds: structuredClone(protocol.rolling_folds),
    spatial_holdout: structuredClone(protocol.spatial_holdout),
    primary_tuple_vocabulary: structuredClone(protocol.primary_tuple_vocabulary),
    models: protocol.models.map((value) => ({ ...structuredClone(value), fit_diagnostics: {} })),
    metrics: {
      aggregate_primary: protocol.models.map(({ id: model }) => ({
        model,
        observations: protocol.primary_tuple_vocabulary.length * 2000,
        ...metricTotals(model),
      })).sort((left, right) => left.model.localeCompare(right.model)),
      primary_by_fold_space_holdout: allPrimary,
      by_category: [],
      by_data_volume: [],
      by_acs_population_when_temporally_compatible: [],
    },
    numerical_diagnostics: numericalDiagnostics,
    promotion: null,
    privacy: structuredClone(protocol.privacy),
    authority: structuredClone(protocol.authority),
    limitations: [],
  };
  report.promotion = evaluatePromotion({
    primary: report.metrics.primary_by_fold_space_holdout,
    category: report.metrics.by_category,
    aggregate: report.metrics.aggregate_primary,
    numerical_diagnostics: numericalDiagnostics,
  }, protocol);
  return report;
}

function fitDescriptors(model) {
  const rows = [];
  for (const { id: fold } of protocol.rolling_folds) {
    for (const unit_type of protocol.marts.unit_types) {
      const categories = unit_type === 'tract' ? ['all', ...protocol.marts.categories.tract_audit] : ['all'];
      for (const category of categories) rows.push({ model, fold, unit_type, category });
    }
  }
  return rows;
}

function metricRow(model, tuple) {
  return { model, ...structuredClone(tuple), observations: 2000, ...metricTotals(model) };
}

function metricTotals(model) {
  const seasonal = model === 'seasonal-naive-52w';
  return {
    mae: seasonal ? 1 : 0.92,
    poisson_deviance: 1,
    negative_binomial_deviance: 1,
    prediction_interval_90_coverage: 0.9,
    mean_residual_actual_minus_predicted: 0,
    mean_actual: 2,
    mean_predicted: 2,
    over_estimate_rate: 0.5,
    under_estimate_rate: 0.5,
    relative_mae_gain_vs_seasonal_naive: seasonal ? 0 : (1 - 0.92) / 1,
  };
}

function diagnosticFit(value, states = healthyCheckpointStates()) {
  const state = states[`${value.fold}|${value.unit_type}|${value.category}`];
  const isPoisson = value.model === 'poisson-log-link-v1';
  const definition = protocol.models.find(({ id }) => id === value.model);
  const diagnostic = diagnoseModelNumerics({
    irls: {
      iterationsCompleted: isPoisson ? state.poisson_iterations_completed : state.nb_iterations_completed,
      maximumIterations: definition.max_iterations,
      lastChange: isPoisson ? state.poisson_last_change : state.nb_last_change,
      convergenceTolerance: protocol.numerical_stability_gate.convergence.threshold_exclusive,
      singular: isPoisson ? state.poisson_singular : state.nb_singular,
      coefficients: isPoisson ? state.poisson_beta : state.nb_beta,
    },
    coefficientAbsoluteMaximum: protocol.numerical_stability_gate.coefficient_abs_limit_inclusive,
    dispersion: isPoisson ? null : {
      value: state.alpha,
      minimum: protocol.numerical_stability_gate.dispersion_alpha_inclusive[0],
      maximum: protocol.numerical_stability_gate.dispersion_alpha_inclusive[1],
    },
    predictions: [1],
    maximumPrediction: protocol.numerical_stability_gate.prediction.maximum_inclusive,
    intervals: [{ lower: 0, upper: 2 }],
    coverages: [protocol.numerical_stability_gate.interval.nominal_probability],
  });
  return {
    ...structuredClone(value), observations: 2000, prediction_count: 2000, interval_count: 2000,
    checks: diagnostic.checks, failures: diagnostic.failures, passed: diagnostic.ok,
  };
}

function diagnosticSlice(value) {
  const diagnostic = diagnoseEvaluationSlice({
    predictions: [1],
    intervals: [{ lower: 0, upper: 2 }],
    coverages: [0.9],
    maximumPrediction: protocol.numerical_stability_gate.prediction.maximum_inclusive,
  });
  return {
    ...structuredClone(value), prediction_count: 2000, interval_count: 2000,
    maximum_prediction_observed: 2,
    coverage: 0.9,
    checks: {
      predictions: diagnostic.checks.predictions,
      intervals: diagnostic.checks.intervals,
      coverages: diagnostic.checks.coverages,
    },
    failures: diagnostic.failures,
    passed: diagnostic.ok,
  };
}

function healthyServing(report) {
  return {
    schema: 'engagement-area-intelligence-serving/v1',
    status: 'not-promoted',
    historical_evidence: { status: 'available' },
    forecast: { status: 'unavailable', reason: 'local-candidate-has-no-serving-authority', predictions: [] },
    evaluation: {
      promotion_status: 'not-promoted',
      selected_model: null,
      local_candidate_model: report.promotion.local_candidate_model,
      local_candidate_only: true,
      protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    },
    authority: structuredClone(protocol.authority),
    privacy: structuredClone(protocol.privacy),
  };
}

function healthyCheckpointStates() {
  const states = {};
  for (const { id, ...foldFields } of protocol.rolling_folds) {
    for (const unit_type of protocol.marts.unit_types) {
      const categories = unit_type === 'tract' ? ['all', ...protocol.marts.categories.tract_audit] : ['all'];
      for (const category of categories) {
        states[`${id}|${unit_type}|${category}`] = {
          fold: { id, ...structuredClone(foldFields) },
          unit_type,
          category,
          poisson_beta: [0, 0, 0, 0, 0, 0],
          nb_beta: [0, 0, 0, 0, 0, 0],
          alpha: 0.2,
          poisson_fit_observations: 2000,
          poisson_last_change: 1e-8,
          poisson_singular: false,
          poisson_iterations_completed: 2,
          nb_fit_observations: 2000,
          nb_last_change: 1e-8,
          nb_singular: false,
          nb_iterations_completed: 2,
          baseline_interval_radii: Object.fromEntries([
            'seasonal-naive-52w', 'moving-average-4w', 'moving-average-13w',
          ].map((model) => [model, 1])),
        };
      }
    }
  }
  return Object.fromEntries(Object.entries(states).sort(([left], [right]) => left.localeCompare(right)));
}

function candidateReasons(result) {
  return result.candidates.map(({ reasons }) => reasons.join(',')).join('|');
}

function digest(value) {
  return `sha256:${String(value).padEnd(64, '0').slice(0, 64)}`;
}

function hashHex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableIdentity(value) {
  return `sha256:${hashHex(stableSerialization(value))}`;
}
