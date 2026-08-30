import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {
  accumulateDispersion,
  accumulateIrls,
  accumulateMetric,
  accumulateResidualHistogram,
  baselinePredictions,
  createDispersionAccumulator,
  createIrlsAccumulator,
  createMetricAccumulator,
  createResidualHistogram,
  dataVolumeBand,
  diagnoseModelNumerics,
  empiricalInterval,
  featureVector,
  finalizeDispersion,
  finalizeMetric,
  isSpatialHoldout,
  linearPrediction,
  mergeMetricAccumulators,
  negativeBinomialInterval,
  poissonInterval,
  populationBand,
  residualQuantile,
  solveIrls,
} from './area_intelligence_model.mjs';
import { addWeeks } from './area_intelligence_mart.mjs';
import {
  AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
  loadAreaIntelligenceEvaluationProtocol,
  stableSerialization,
  validateAreaIntelligenceEvaluationProtocol,
} from './area_intelligence_evaluation_protocol.mjs';
import { assertTaskOwnedDfev1Path } from './dfev1_path.mjs';

const EVALUATION_SCHEMA = 'ModelEvaluationReport/v1';
const EVALUATION_MANIFEST_SCHEMA = 'engagement-area-intelligence-evaluation-run/v2';
const CHECKPOINT_SCHEMA = 'engagement-area-intelligence-evaluation-checkpoint/v2';
const PROTOCOL_SCHEMA = 'engagement-area-intelligence-evaluation-protocol/v2';
const MART_SCHEMA = 'engagement-area-intelligence-feature-mart/v2';
const LINEAGE_SEAM_SCHEMA = 'engagement-area-intelligence-lineage-seam/v1';
const NUMERICAL_DIAGNOSTICS_SCHEMA = 'engagement-area-intelligence-numerical-diagnostics/v1';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BASELINE_MODELS = ['seasonal-naive-52w', 'moving-average-4w', 'moving-average-13w'];
const COUNT_MODELS = ['poisson-log-link-v1', 'negative-binomial-log-link-v1'];
const ALL_MODELS = [...BASELINE_MODELS, ...COUNT_MODELS];
const TRACT_CATEGORIES = ['all', 'person', 'property', 'vehicle', 'financial', 'public_order', 'other'];
const AUTHORITY_KEYS = ['local_evaluation', 'serving', 'product_promotion', 'scientific', 'causal', 'safety', 'deletion'];
const PRIVACY_KEYS = [
  'aggregate_only',
  'event_level_data_included',
  'coordinates_included',
  'generalized_locations_included',
  'raw_or_canonical_events_included',
  'source_record_ids_included',
];
const EVALUATION_ARTIFACT_NAMES = [
  'bias-error-audit.json',
  'data-lineage-summary.json',
  'model-card.md',
  'model-evaluation-report.json',
  'model-state.json',
  'residual-map.json',
  'serving-artifact.json',
];

export async function validateAreaIntelligenceMartForEvaluation({ martRoot, protocolPath } = {}) {
  const resolvedMartRoot = path.resolve(martRoot || '');
  const protocol = await loadAreaIntelligenceEvaluationProtocol({ protocolPath });
  const protocolIdentity = AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256;
  const martManifestBytes = await fs.readFile(path.join(resolvedMartRoot, 'manifest.json'));
  const martManifest = JSON.parse(martManifestBytes.toString('utf8'));
  validateMartManifest(martManifest, protocol, protocolIdentity);
  const martInventory = await validateExactMartFiles(resolvedMartRoot, martManifest);
  validateMartArtifactIdentity(martManifest);
  return {
    martRoot: resolvedMartRoot,
    protocol,
    protocolIdentity,
    martManifest,
    martManifestIdentity: sha256(martManifestBytes),
    martInventory,
  };
}

export async function evaluateAreaIntelligence({
  martRoot,
  outputRoot,
  protocolPath,
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  const resolvedOutput = await assertTaskOwnedDfev1Path(outputRoot, {
    workspace: process.cwd(),
    label: 'Area Intelligence evaluation output',
  });
  const {
    martRoot: resolvedMartRoot,
    protocol,
    protocolIdentity,
    martManifest,
    martManifestIdentity,
    martInventory,
  } = await validateAreaIntelligenceMartForEvaluation({ martRoot, protocolPath });

  const existing = await readJsonIfExists(path.join(resolvedOutput, 'manifest.json'));
  if (existing) {
    if (await validateExistingEvaluation(existing, resolvedOutput, {
      martManifestIdentity,
      protocolIdentity,
      protocol,
      martManifest,
      martInventory,
    })) {
      return { manifest: existing, idempotent: true };
    }
    throw new Error('Area Intelligence evaluation output root contains a different or invalid completed run; use a new task-owned root.');
  }

  await fs.mkdir(resolvedOutput, { recursive: true });
  const checkpointPath = path.join(resolvedOutput, 'checkpoint.json');
  const checkpoint = await loadOrCreateCheckpoint(checkpointPath, {
    martManifestIdentity,
    martArtifactIdentity: martManifest.artifact_identity,
    protocolIdentity,
    protocol,
    now,
  });
  const states = deserializeStates(checkpoint.states, protocol);

  const poissonIterations = protocol.models.find((model) => model.id === 'poisson-log-link-v1').max_iterations;
  while (checkpoint.poisson_iterations_completed < poissonIterations) {
    const accumulators = new Map([...states].map(([key]) => [key, createIrlsAccumulator()]));
    await scanMartUnits(resolvedMartRoot, martManifest, martInventory, (series) => {
      accumulateFitSeries(series, states, accumulators, 'poisson');
    });
    for (const [key, state] of states) {
      const result = solveIrls(accumulators.get(key), state.poisson_beta, {
        coefficientLimit: protocol.numerical_stability_gate.coefficient_abs_limit_inclusive,
      });
      state.poisson_beta = result.beta;
      state.poisson_fit_observations = result.observations;
      state.poisson_last_change = result.changed;
      state.poisson_singular = Boolean(state.poisson_singular || result.singular);
      state.poisson_iterations_completed = checkpoint.poisson_iterations_completed + 1;
    }
    checkpoint.poisson_iterations_completed += 1;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'poisson-fit', iteration: checkpoint.poisson_iterations_completed, iterations: poissonIterations });
    if ([...states.values()].every((state) => (
      state.poisson_last_change < protocol.numerical_stability_gate.convergence.threshold_exclusive
    ))) break;
  }

  if (!checkpoint.dispersion_completed) {
    const accumulators = new Map([...states].map(([key]) => [key, createDispersionAccumulator()]));
    await scanMartUnits(resolvedMartRoot, martManifest, martInventory, (series) => {
      accumulateDispersionSeries(series, states, accumulators);
    });
    for (const [key, state] of states) {
      const [minimum, maximum] = protocol.numerical_stability_gate.dispersion_alpha_inclusive;
      state.alpha = finalizeDispersion(accumulators.get(key), { minimum, maximum });
      state.nb_beta = [...state.poisson_beta];
    }
    checkpoint.dispersion_completed = true;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'dispersion-fit' });
  }

  const nbIterations = protocol.models.find((model) => model.id === 'negative-binomial-log-link-v1').max_iterations;
  while (checkpoint.nb_iterations_completed < nbIterations) {
    const accumulators = new Map([...states].map(([key]) => [key, createIrlsAccumulator()]));
    await scanMartUnits(resolvedMartRoot, martManifest, martInventory, (series) => {
      accumulateFitSeries(series, states, accumulators, 'negative-binomial');
    });
    for (const [key, state] of states) {
      const result = solveIrls(accumulators.get(key), state.nb_beta, {
        coefficientLimit: protocol.numerical_stability_gate.coefficient_abs_limit_inclusive,
      });
      state.nb_beta = result.beta;
      state.nb_fit_observations = result.observations;
      state.nb_last_change = result.changed;
      state.nb_singular = Boolean(state.nb_singular || result.singular);
      state.nb_iterations_completed = checkpoint.nb_iterations_completed + 1;
    }
    checkpoint.nb_iterations_completed += 1;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'negative-binomial-fit', iteration: checkpoint.nb_iterations_completed, iterations: nbIterations });
    if ([...states.values()].every((state) => (
      state.nb_last_change < protocol.numerical_stability_gate.convergence.threshold_exclusive
    ))) break;
  }

  if (!checkpoint.baseline_intervals_completed) {
    const histograms = new Map();
    for (const [key] of states) {
      for (const model of BASELINE_MODELS) histograms.set(`${key}|${model}`, createResidualHistogram());
    }
    await scanMartUnits(resolvedMartRoot, martManifest, martInventory, (series) => {
      accumulateBaselineResiduals(series, states, histograms);
    });
    for (const [key, state] of states) {
      state.baseline_interval_radii = Object.fromEntries(BASELINE_MODELS.map((model) => [
        model,
        residualQuantile(histograms.get(`${key}|${model}`), protocol.metrics.interval_nominal),
      ]));
    }
    checkpoint.baseline_intervals_completed = true;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'baseline-interval-fit' });
  }

  const metrics = createMetricCollections();
  const numericalEvidence = createNumericalEvidence();
  await scanMartUnits(resolvedMartRoot, martManifest, martInventory, (series) => {
    evaluateSeries(series, states, protocol, metrics, numericalEvidence);
  });
  const finalized = finalizeMetricCollections(metrics, protocol);
  finalized.numerical_diagnostics = buildNumericalDiagnostics({
    states,
    finalized,
    numericalEvidence,
    protocol,
    checkpoint,
  });
  checkpoint.numerical_gate = {
    fit_states_passed: finalized.numerical_diagnostics.all_applicable_fit_states_passed,
    primary_slices_passed: finalized.numerical_diagnostics.all_primary_slices_passed,
    failed_fit_state_count: finalized.numerical_diagnostics.fit_states.filter(({ passed }) => !passed).length,
    failed_primary_slice_count: finalized.numerical_diagnostics.primary_slices.filter(({ passed }) => !passed).length,
  };
  const promotion = evaluatePromotion(finalized, protocol);
  const generatedAt = exactNow(now);
  const selectedAuditModel = promotion.selected_model || selectBestAuditModel(finalized.aggregate);
  await assertMartInventoryUnchanged(resolvedMartRoot, martManifest, martInventory);

  const report = buildEvaluationReport({
    protocol,
    protocolIdentity,
    martManifest,
    martManifestIdentity,
    states,
    finalized,
    promotion,
    generatedAt,
  });
  validateModelEvaluationReport(report, {
    protocol,
    martManifest,
    martManifestIdentity,
    checkpoint,
  });
  const residualMap = buildResidualMap(finalized.block, selectedAuditModel, promotion, martManifest, generatedAt);
  const biasAudit = buildBiasAudit(finalized, selectedAuditModel, promotion, generatedAt);
  const lineageSummary = buildLineageSummary(martManifest, martManifestIdentity, protocolIdentity, generatedAt);
  const servingArtifact = buildServingArtifact({
    report,
    selectedAuditModel,
    generatedAt,
  });
  validateAreaIntelligenceEvaluationServingArtifact(servingArtifact, {
    report,
    protocol,
    martManifest,
    martManifestIdentity,
    checkpoint,
  });
  const modelCard = buildModelCard({ report, selectedAuditModel });
  const modelState = buildModelState(states, protocolIdentity, martManifestIdentity, generatedAt);

  const artifacts = {
    'model-evaluation-report.json': serializeJson(report, 'model evaluation report'),
    'residual-map.json': serializeJson(residualMap, 'residual map'),
    'bias-error-audit.json': serializeJson(biasAudit, 'bias/error audit'),
    'data-lineage-summary.json': serializeJson(lineageSummary, 'data lineage summary'),
    'serving-artifact.json': serializeJson(servingArtifact, 'serving artifact'),
    'model-state.json': serializeJson(modelState, 'model state'),
    'model-card.md': modelCard,
  };
  const artifactRecords = [];
  for (const [name, contents] of Object.entries(artifacts)) {
    const destination = path.join(resolvedOutput, name);
    await writeTextAtomic(destination, contents);
    artifactRecords.push({ name, bytes: Buffer.byteLength(contents), sha256: sha256(Buffer.from(contents)) });
  }
  artifactRecords.sort((left, right) => left.name.localeCompare(right.name));
  const availability = 'unavailable';
  const lineageSeam = buildEvaluationLineageSeam({
    protocol,
    protocolIdentity,
    martManifest,
    martManifestIdentity,
    martInventory,
    promotion,
    availability,
  });
  const evaluationManifest = {
    schema: EVALUATION_MANIFEST_SCHEMA,
    protocol: {
      schema: protocol.schema,
      sha256: protocolIdentity,
      receipt_sha256: protocol.exact_input_gate.receipt_sha256,
    },
    protocol_sha256: protocolIdentity,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    lineage_seam: lineageSeam,
    promotion,
    availability,
    selected_audit_model: selectedAuditModel,
    local_candidate_only: true,
    authority: structuredClone(protocol.authority),
    privacy: structuredClone(protocol.privacy),
    artifacts: artifactRecords,
    generated_at: generatedAt,
    identity_meaning: 'Artifact byte identity only; model correctness is established by the frozen evaluation protocol and reported metrics, not this identity.',
  };
  checkpoint.status = 'complete';
  checkpoint.updated_at = generatedAt;
  validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
    protocolIdentity,
    martManifestIdentity,
    martArtifactIdentity: martManifest.artifact_identity,
    receiptSha256: protocol.exact_input_gate.receipt_sha256,
    protocol,
    report,
  });
  await writeJsonAtomic(checkpointPath, checkpoint);
  validateAreaIntelligenceEvaluationManifest(evaluationManifest, {
    protocol,
    martManifest,
    martManifestIdentity,
    martInventory,
    report,
    servingArtifact,
    checkpoint,
  });
  await writeJsonAtomic(path.join(resolvedOutput, 'manifest.json'), evaluationManifest);
  onProgress({ phase: 'complete', promotion: promotion.status, selectedModel: promotion.selected_model });
  return { manifest: evaluationManifest, report, idempotent: false };
}

function createStates(protocol) {
  const states = new Map();
  for (const fold of protocol.rolling_folds) {
    for (const unitType of ['tract', 'fixed-grid']) {
      const categories = unitType === 'tract' ? ['all', ...protocol.marts.categories.tract_audit] : ['all'];
      for (const category of categories) {
        const key = stateKey(fold.id, unitType, category);
        states.set(key, {
          fold: structuredClone(fold),
          unit_type: unitType,
          category,
          poisson_beta: [0, 0, 0, 0, 0, 0],
          nb_beta: [0, 0, 0, 0, 0, 0],
          alpha: protocol.numerical_stability_gate.dispersion_alpha_inclusive[0],
          poisson_fit_observations: 0,
          poisson_last_change: null,
          poisson_singular: false,
          poisson_iterations_completed: 0,
          nb_fit_observations: 0,
          nb_last_change: null,
          nb_singular: false,
          nb_iterations_completed: 0,
          baseline_interval_radii: {},
        });
      }
    }
  }
  return states;
}

function deserializeStates(value, protocol) {
  if (!value || Object.keys(value).length === 0) return createStates(protocol);
  const states = new Map(Object.entries(value));
  const expected = createStates(protocol);
  if (states.size !== expected.size || [...expected.keys()].some((key) => !states.has(key))) {
    throw new Error('Area Intelligence evaluation checkpoint model-state set does not match the frozen protocol.');
  }
  return states;
}

function serializeStates(states) {
  return Object.fromEntries([...states].sort(([left], [right]) => left.localeCompare(right)));
}

function stateKey(fold, unitType, category) {
  return `${fold}|${unitType}|${category}`;
}

function accumulateFitSeries(series, states, accumulators, kind) {
  if (isSpatialHoldout(series.spatial_block_id)) return;
  for (const [key, state] of states) {
    if (state.unit_type !== series.unit_type) continue;
    const counts = seriesCounts(series, state.category);
    visitFoldWeeks(series, counts, state.fold.train_start, state.fold.train_end_exclusive, ({ index, actual, weekStart }) => {
      const features = featureVector(counts, index, weekStart);
      if (!features) return;
      const beta = kind === 'poisson' ? state.poisson_beta : state.nb_beta;
      accumulateIrls(accumulators.get(key), features, actual, beta, {
        alpha: kind === 'poisson' ? 0 : state.alpha,
      });
    });
  }
}

function accumulateDispersionSeries(series, states, accumulators) {
  if (isSpatialHoldout(series.spatial_block_id)) return;
  for (const [key, state] of states) {
    if (state.unit_type !== series.unit_type) continue;
    const counts = seriesCounts(series, state.category);
    visitFoldWeeks(series, counts, state.fold.train_start, state.fold.train_end_exclusive, ({ index, actual, weekStart }) => {
      const features = featureVector(counts, index, weekStart);
      if (!features) return;
      const mean = linearPrediction(state.poisson_beta, features).mean;
      accumulateDispersion(accumulators.get(key), actual, mean);
    });
  }
}

function accumulateBaselineResiduals(series, states, histograms) {
  if (isSpatialHoldout(series.spatial_block_id)) return;
  for (const [key, state] of states) {
    if (state.unit_type !== series.unit_type) continue;
    const counts = seriesCounts(series, state.category);
    visitFoldWeeks(series, counts, state.fold.train_start, state.fold.train_end_exclusive, ({ index, actual }) => {
      const predictions = baselinePredictions(counts, index);
      if (!predictions) return;
      for (const model of BASELINE_MODELS) {
        accumulateResidualHistogram(histograms.get(`${key}|${model}`), actual, predictions[model]);
      }
    });
  }
}

function createMetricCollections() {
  return Object.fromEntries(['primary', 'category', 'volume', 'acs_population', 'block'].map((name) => [
    name,
    { values: new Map(), descriptors: new Map() },
  ]));
}

function evaluateSeries(series, states, protocol, metrics, numericalEvidence) {
  const heldout = isSpatialHoldout(series.spatial_block_id, protocol.spatial_holdout.holdout_remainder);
  const holdoutSlice = heldout ? 'spatial-heldout' : 'temporal-non-heldout';
  for (const state of states.values()) {
    if (state.unit_type !== series.unit_type) continue;
    const counts = seriesCounts(series, state.category);
    const trainingMean = meanForRange(series, counts, state.fold.train_start, state.fold.train_end_exclusive);
    const volume = dataVolumeBand(trainingMean);
    visitFoldWeeks(series, counts, state.fold.test_start, state.fold.test_end_exclusive, ({ index, actual, weekStart }) => {
      const features = featureVector(counts, index, weekStart);
      const baselines = baselinePredictions(counts, index);
      if (!features || !baselines) return;
      const predictions = {
        ...baselines,
        'poisson-log-link-v1': linearPrediction(state.poisson_beta, features).mean,
        'negative-binomial-log-link-v1': linearPrediction(state.nb_beta, features).mean,
      };
      for (const model of ALL_MODELS) {
        const predicted = predictions[model];
        const interval = baselineIntervalOrDistribution(state, model, predicted, protocol.metrics.interval_nominal);
        const observation = { actual, predicted, interval, alpha: state.alpha };
        const failures = validateEvaluationObservation({
          predicted,
          interval,
          maximumPrediction: protocol.numerical_stability_gate.prediction.maximum_inclusive,
        });
        recordNumericalObservation(numericalEvidence, {
          model,
          state,
          holdoutSlice,
          predicted,
          interval,
          failures,
          fitStateApplicable: COUNT_MODELS.includes(model),
        });
        const admittedObservation = failures.length === 0 ? observation : null;
        if (state.category === 'all') {
          addMetric(metrics.primary, {
            model, fold: state.fold.id, unit_type: state.unit_type, holdout_slice: holdoutSlice,
          }, admittedObservation);
          addMetric(metrics.volume, {
            model, fold: state.fold.id, unit_type: state.unit_type, holdout_slice: holdoutSlice, data_volume_band: volume,
          }, admittedObservation);
          addMetric(metrics.block, {
            model, unit_type: state.unit_type, spatial_block_id: series.spatial_block_id,
          }, admittedObservation);
          const year = Number(weekStart.slice(0, 4));
          if (state.unit_type === 'tract' && year >= 2020 && year <= 2024 && Number.isFinite(series.acs_estimate)) {
            addMetric(metrics.acs_population, {
              model, fold: state.fold.id, holdout_slice: holdoutSlice, population_band: populationBand(series.acs_estimate),
            }, admittedObservation);
          }
        } else {
          addMetric(metrics.category, {
            model, fold: state.fold.id, category: state.category, holdout_slice: holdoutSlice,
          }, admittedObservation);
        }
      }
    });
  }
}

function baselineIntervalOrDistribution(state, model, predicted, nominalProbability) {
  if (BASELINE_MODELS.includes(model)) {
    const radius = state.baseline_interval_radii[model];
    if (!Number.isFinite(radius) || radius < 0) {
      return { lower: Number.NaN, upper: Number.NaN };
    }
    return empiricalInterval(predicted, radius);
  }
  if (model === 'poisson-log-link-v1') return poissonInterval(predicted, nominalProbability);
  return negativeBinomialInterval(predicted, state.alpha, nominalProbability);
}

export function validateEvaluationObservation({ predicted, interval, maximumPrediction } = {}) {
  const failures = [];
  if (!Number.isFinite(predicted)) failures.push('prediction-non-finite');
  else {
    if (predicted < 0) failures.push('prediction-negative');
    if (!Number.isFinite(maximumPrediction) || maximumPrediction < 0) {
      failures.push('prediction-maximum-invalid');
    } else if (predicted > maximumPrediction) {
      failures.push('prediction-exceeds-maximum');
    }
  }
  if (!Number.isFinite(interval?.lower) || !Number.isFinite(interval?.upper)) {
    failures.push('interval-non-finite');
  } else {
    if (interval.lower < 0) failures.push('interval-negative-lower');
    if (interval.lower > interval.upper) failures.push('interval-inverted');
  }
  return failures;
}

export function diagnoseEvaluationSlice({ predictions, intervals, coverages, maximumPrediction } = {}) {
  return diagnoseModelNumerics({
    irls: {
      iterationsCompleted: 1,
      maximumIterations: 2,
      lastChange: 0,
      convergenceTolerance: 1e-7,
      singular: false,
      coefficients: [0],
    },
    coefficientAbsoluteMaximum: 12,
    dispersion: null,
    predictions,
    maximumPrediction,
    intervals,
    coverages,
  });
}

function createNumericalEvidence() {
  return { fit_states: new Map(), primary_slices: new Map() };
}

function recordNumericalObservation(evidence, {
  model,
  state,
  holdoutSlice,
  predicted,
  interval,
  failures,
  fitStateApplicable,
}) {
  const stateDescriptor = {
    model,
    fold: state.fold.id,
    unit_type: state.unit_type,
    category: state.category,
  };
  if (fitStateApplicable) {
    accumulateNumericalEvidence(evidence.fit_states, stateDescriptor, predicted, interval, failures);
  }
  if (state.category === 'all') {
    accumulateNumericalEvidence(evidence.primary_slices, {
      model,
      fold: state.fold.id,
      unit_type: state.unit_type,
      holdout_slice: holdoutSlice,
    }, predicted, interval, failures);
  }
}

function accumulateNumericalEvidence(collection, descriptor, predicted, interval, failures) {
  const key = stableSerialization(descriptor);
  if (!collection.has(key)) {
    collection.set(key, {
      descriptor,
      prediction_count: 0,
      interval_count: 0,
      maximum_prediction_observed: 0,
      representative_prediction: null,
      representative_interval: null,
      failures: new Set(),
    });
  }
  const value = collection.get(key);
  value.prediction_count += 1;
  value.interval_count += 1;
  if (Number.isFinite(predicted)) {
    value.maximum_prediction_observed = Math.max(value.maximum_prediction_observed, predicted);
    value.representative_prediction = predicted;
  }
  if (Number.isFinite(interval?.lower) && Number.isFinite(interval?.upper)) {
    value.representative_interval = { lower: interval.lower, upper: interval.upper };
  }
  for (const failure of failures) value.failures.add(failure);
}

function addMetric(collection, descriptor, observation) {
  const key = Object.entries(descriptor).map(([name, value]) => `${name}=${value}`).join('|');
  if (!collection.values.has(key)) {
    collection.values.set(key, createMetricAccumulator());
    collection.descriptors.set(key, descriptor);
  }
  if (observation) accumulateMetric(collection.values.get(key), observation);
}

function finalizeMetricCollections(collections, protocol) {
  const output = {};
  for (const [name, collection] of Object.entries(collections)) {
    const rows = [];
    for (const [key, accumulator] of collection.values) {
      rows.push({ ...collection.descriptors.get(key), ...finalizeMetric(accumulator) });
    }
    rows.sort((left, right) => stableSerialization(leftDescriptor(left)).localeCompare(stableSerialization(leftDescriptor(right))));
    addRelativeSeasonalGain(rows);
    output[name] = rows;
  }
  output.primary = orderPrimaryRows(output.primary, protocol);
  output.aggregate = aggregatePrimary(output.primary);
  return output;
}

function orderPrimaryRows(rows, protocol) {
  const modelOrder = new Map(protocol.models.map(({ id }, index) => [id, index]));
  const tupleOrder = new Map(protocol.primary_tuple_vocabulary.map((tuple, index) => [stableSerialization(tuple), index]));
  return [...rows].sort((left, right) => {
    const modelDifference = (modelOrder.get(left.model) ?? Number.MAX_SAFE_INTEGER)
      - (modelOrder.get(right.model) ?? Number.MAX_SAFE_INTEGER);
    if (modelDifference) return modelDifference;
    const leftTuple = stableSerialization(primaryTupleOf(left));
    const rightTuple = stableSerialization(primaryTupleOf(right));
    return (tupleOrder.get(leftTuple) ?? Number.MAX_SAFE_INTEGER)
      - (tupleOrder.get(rightTuple) ?? Number.MAX_SAFE_INTEGER)
      || leftTuple.localeCompare(rightTuple);
  });
}

function addRelativeSeasonalGain(rows) {
  const seasonal = new Map();
  for (const row of rows) {
    if (row.model === 'seasonal-naive-52w') seasonal.set(metricComparisonKey(row), row.mae);
  }
  for (const row of rows) {
    const baseline = seasonal.get(metricComparisonKey(row));
    row.relative_mae_gain_vs_seasonal_naive = Number.isFinite(baseline) && baseline > 0
      ? (baseline - row.mae) / baseline
      : null;
  }
}

function metricComparisonKey(row) {
  return stableSerialization(Object.fromEntries(Object.entries(leftDescriptor(row)).filter(([key]) => key !== 'model')));
}

function leftDescriptor(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => ![
    'observations', 'mae', 'poisson_deviance', 'negative_binomial_deviance',
    'prediction_interval_90_coverage', 'mean_residual_actual_minus_predicted',
    'mean_actual', 'mean_predicted', 'over_estimate_rate', 'under_estimate_rate',
    'relative_mae_gain_vs_seasonal_naive', '_sums',
  ].includes(key)));
}

function aggregatePrimary(rows) {
  const accumulators = new Map();
  for (const row of rows) {
    if (!accumulators.has(row.model)) accumulators.set(row.model, createMetricAccumulator());
    mergeMetricAccumulators(accumulators.get(row.model), row._sums);
  }
  const output = [...accumulators].map(([model, accumulator]) => ({ model, ...finalizeMetric(accumulator) }));
  output.sort((left, right) => left.model.localeCompare(right.model));
  addRelativeSeasonalGain(output);
  return output;
}

function buildNumericalDiagnostics({ states, finalized, numericalEvidence, protocol }) {
  const gate = protocol.numerical_stability_gate;
  const fitStates = [];
  for (const model of COUNT_MODELS) {
    const definition = protocol.models.find(({ id }) => id === model);
    const expectedDescriptors = expectedFitStateDescriptors(protocol, model);
    for (const descriptor of expectedDescriptors) {
      const state = states.get(stateKey(descriptor.fold, descriptor.unit_type, descriptor.category));
      const isPoisson = model === 'poisson-log-link-v1';
      const evidence = numericalEvidence.fit_states.get(stableSerialization(descriptor));
      if (!state) {
        fitStates.push({
          ...descriptor,
          observations: 0,
          prediction_count: evidence?.prediction_count || 0,
          interval_count: evidence?.interval_count || 0,
          checks: null,
          failures: ['fit-state-missing'],
          passed: false,
        });
        continue;
      }
      const diagnostic = diagnoseModelNumerics({
        irls: {
          iterationsCompleted: isPoisson ? state.poisson_iterations_completed : state.nb_iterations_completed,
          maximumIterations: definition.max_iterations,
          lastChange: isPoisson ? state.poisson_last_change : state.nb_last_change,
          convergenceTolerance: gate.convergence.threshold_exclusive,
          singular: isPoisson ? state.poisson_singular : state.nb_singular,
          coefficients: isPoisson ? state.poisson_beta : state.nb_beta,
        },
        coefficientAbsoluteMaximum: gate.coefficient_abs_limit_inclusive,
        dispersion: isPoisson ? null : {
          value: state.alpha,
          minimum: gate.dispersion_alpha_inclusive[0],
          maximum: gate.dispersion_alpha_inclusive[1],
        },
        predictions: evidence?.prediction_count ? [evidence.representative_prediction] : [],
        maximumPrediction: gate.prediction.maximum_inclusive,
        intervals: evidence?.interval_count ? [evidence.representative_interval] : [],
        coverages: [gate.interval.nominal_probability],
      });
      applyEvidenceFailuresToChecks(diagnostic.checks, evidence?.failures);
      if ((evidence?.prediction_count || 0) !== (evidence?.interval_count || 0)) {
        diagnostic.checks.intervals.matches_prediction_count = false;
      }
      const failures = new Set([...diagnostic.failures, ...(evidence?.failures || [])]);
      if ((evidence?.prediction_count || 0) !== (evidence?.interval_count || 0)) {
        failures.add('prediction-interval-count-mismatch');
      }
      if (diagnostic.checks.irls.reached_iteration_cap) {
        failures.add('irls-convergence-not-before-iteration-limit');
      }
      fitStates.push({
        ...descriptor,
        observations: isPoisson ? state.poisson_fit_observations : state.nb_fit_observations,
        prediction_count: evidence?.prediction_count || 0,
        interval_count: evidence?.interval_count || 0,
        checks: diagnostic.checks,
        failures: [...failures].sort(),
        passed: failures.size === 0,
      });
    }
  }
  const primarySlices = [];
  for (const model of protocol.models.map(({ id }) => id)) {
    for (const tuple of protocol.primary_tuple_vocabulary) {
      const descriptor = { model, ...tuple };
      const evidence = numericalEvidence.primary_slices.get(stableSerialization(descriptor));
      const metric = finalized.primary.find((row) => row.model === model
        && stableSerialization(primaryTupleOf(row)) === stableSerialization(tuple));
      const diagnostic = diagnoseEvaluationSlice({
        predictions: evidence?.prediction_count ? [evidence.representative_prediction] : [],
        intervals: evidence?.interval_count ? [evidence.representative_interval] : [],
        coverages: metric?.prediction_interval_90_coverage == null
          ? []
          : [metric.prediction_interval_90_coverage],
        maximumPrediction: gate.prediction.maximum_inclusive,
      });
      applyEvidenceFailuresToChecks(diagnostic.checks, evidence?.failures);
      if ((evidence?.prediction_count || 0) !== (evidence?.interval_count || 0)) {
        diagnostic.checks.intervals.matches_prediction_count = false;
      }
      const failures = new Set([...diagnostic.failures, ...(evidence?.failures || [])]);
      if (!metric) failures.add('primary-metric-missing');
      if ((evidence?.prediction_count || 0) !== (evidence?.interval_count || 0)) {
        failures.add('prediction-interval-count-mismatch');
      }
      primarySlices.push({
        ...descriptor,
        prediction_count: evidence?.prediction_count || 0,
        interval_count: evidence?.interval_count || 0,
        maximum_prediction_observed: evidence?.maximum_prediction_observed ?? null,
        coverage: metric?.prediction_interval_90_coverage ?? null,
        checks: {
          predictions: diagnostic.checks.predictions,
          intervals: diagnostic.checks.intervals,
          coverages: diagnostic.checks.coverages,
        },
        failures: [...failures].sort(),
        passed: failures.size === 0,
      });
    }
  }
  return {
    schema: NUMERICAL_DIAGNOSTICS_SCHEMA,
    protocol_sha256: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    gate: structuredClone(gate),
    fit_state_vocabulary: COUNT_MODELS.flatMap((model) => expectedFitStateDescriptors(protocol, model)),
    primary_slice_vocabulary: protocol.models.flatMap(({ id: model }) => (
      protocol.primary_tuple_vocabulary.map((tuple) => ({ model, ...tuple }))
    )),
    fit_states: fitStates,
    primary_slices: primarySlices,
    all_applicable_fit_states_passed: fitStates.every(({ passed }) => passed),
    all_primary_slices_passed: primarySlices.every(({ passed }) => passed),
    expected_fit_state_count_per_count_model: expectedFitStateDescriptors(protocol, COUNT_MODELS[0]).length,
    local_candidate_only: true,
    authority: structuredClone(protocol.authority),
  };
}

function applyEvidenceFailuresToChecks(checks, failures = []) {
  const observed = new Set(failures);
  if (checks.predictions.present) {
    checks.predictions.finite = !observed.has('prediction-non-finite');
    checks.predictions.nonnegative = !observed.has('prediction-negative');
    checks.predictions.maximum_valid = !observed.has('prediction-maximum-invalid');
    checks.predictions.within_maximum = !observed.has('prediction-exceeds-maximum');
  }
  if (checks.intervals.present) {
    checks.intervals.finite = !observed.has('interval-non-finite');
    checks.intervals.lower_nonnegative = !observed.has('interval-negative-lower');
    checks.intervals.ordered = !observed.has('interval-inverted');
    checks.intervals.matches_prediction_count = !observed.has('prediction-interval-count-mismatch');
  }
}

function expectedFitStateDescriptors(protocol, model) {
  const descriptors = [];
  for (const fold of protocol.rolling_folds.map(({ id }) => id)) {
    for (const unitType of protocol.marts.unit_types) {
      const categories = unitType === 'tract' ? ['all', ...protocol.marts.categories.tract_audit] : ['all'];
      for (const category of categories) {
        descriptors.push({ model, fold, unit_type: unitType, category });
      }
    }
  }
  return descriptors;
}

function primaryTupleOf(row) {
  return { fold: row.fold, unit_type: row.unit_type, holdout_slice: row.holdout_slice };
}

export function evaluatePromotion(finalized, protocol) {
  const gate = protocol.promotion_gate;
  const candidates = [];
  for (const model of gate.eligible_models) {
    const reasons = [];
    const primary = finalized.primary.filter((row) => row.model === model);
    const expectedKeys = protocol.primary_tuple_vocabulary.map(stableSerialization);
    const actualKeys = primary.map((row) => stableSerialization(primaryTupleOf(row)));
    const actualKeySet = new Set(actualKeys);
    if (actualKeys.length !== actualKeySet.size) reasons.push('primary-tuple-duplicate');
    for (const expected of expectedKeys) if (!actualKeySet.has(expected)) reasons.push('primary-tuple-missing');
    for (const actual of actualKeySet) if (!expectedKeys.includes(actual)) reasons.push('primary-tuple-unknown');
    if (actualKeys.some((key, index) => key !== expectedKeys[index])) reasons.push('primary-tuple-order-invalid');
    if (actualKeys.length !== expectedKeys.length) {
      reasons.push(`expected-${expectedKeys.length}-primary-slices-received-${actualKeys.length}`);
    }

    const numerical = finalized.numerical_diagnostics;
    if (numerical?.schema !== NUMERICAL_DIAGNOSTICS_SCHEMA) {
      reasons.push('numerical-diagnostics-missing');
    } else {
      const fitStates = numerical.fit_states.filter((row) => row.model === model);
      const expectedFitKeys = expectedFitStateDescriptors(protocol, model).map(stableSerialization);
      const actualFitKeys = fitStates.map((row) => stableSerialization({
        model: row.model,
        fold: row.fold,
        unit_type: row.unit_type,
        category: row.category,
      }));
      const actualFitKeySet = new Set(actualFitKeys);
      if (actualFitKeys.length !== actualFitKeySet.size) reasons.push('fit-state-duplicate');
      if (expectedFitKeys.some((key) => !actualFitKeySet.has(key))) reasons.push('fit-state-missing');
      if ([...actualFitKeySet].some((key) => !expectedFitKeys.includes(key))) reasons.push('fit-state-unknown');
      if (actualFitKeys.some((key, index) => key !== expectedFitKeys[index])) reasons.push('fit-state-order-invalid');
      if (actualFitKeys.length !== expectedFitKeys.length || fitStates.some((row) => !row.passed)) {
        reasons.push('fit-state-numerical-gate-failed');
      }
      const slices = numerical.primary_slices.filter((row) => row.model === model);
      const sliceKeys = slices.map((row) => stableSerialization(primaryTupleOf(row)));
      if (sliceKeys.length !== expectedKeys.length
        || new Set(sliceKeys).size !== expectedKeys.length
        || expectedKeys.some((key) => !sliceKeys.includes(key))
        || sliceKeys.some((key, index) => key !== expectedKeys[index])
        || slices.some((row) => !row.passed)) {
        reasons.push('primary-slice-numerical-gate-failed');
      }
    }

    for (const row of primary) {
      const label = `${row.fold}/${row.unit_type}/${row.holdout_slice}`;
      if (row.observations < gate.minimum_observations_per_primary_slice) reasons.push(`${label}:insufficient-observations`);
      if (!(row.relative_mae_gain_vs_seasonal_naive >= gate.minimum_relative_mae_gain_each_fold_unit_and_holdout_slice)) reasons.push(`${label}:mae-gain-below-gate`);
      const [minimumCoverage, maximumCoverage] = gate.acceptable_interval_coverage_inclusive;
      if (!Number.isFinite(row.prediction_interval_90_coverage)
        || row.prediction_interval_90_coverage < 0
        || row.prediction_interval_90_coverage > 1) reasons.push(`${label}:coverage-invalid`);
      else if (!(row.prediction_interval_90_coverage >= minimumCoverage && row.prediction_interval_90_coverage <= maximumCoverage)) reasons.push(`${label}:interval-coverage-outside-gate`);
      if (![row.poisson_deviance, row.negative_binomial_deviance].every(Number.isFinite)) reasons.push(`${label}:non-finite-deviance`);
    }
    const foundationalPassed = reasons.length === 0;
    const aggregate = finalized.aggregate.find((row) => row.model === model);
    if (foundationalPassed) {
      if (!(aggregate?.relative_mae_gain_vs_seasonal_naive >= gate.minimum_aggregate_relative_mae_gain)) reasons.push('aggregate-mae-gain-below-gate');
      for (const row of finalized.category.filter((entry) => entry.model === model)) {
        if (!(row.relative_mae_gain_vs_seasonal_naive >= -gate.maximum_category_mae_regression_vs_seasonal)) {
          reasons.push(`${row.fold}/${row.category}/${row.holdout_slice}:category-mae-regression`);
        }
      }
    }
    candidates.push({
      model,
      passed: reasons.length === 0,
      aggregate_evaluated: foundationalPassed,
      aggregate_relative_mae_gain: aggregate?.relative_mae_gain_vs_seasonal_naive ?? null,
      reasons: [...new Set(reasons)].sort(),
    });
  }
  const passing = candidates.filter((candidate) => candidate.passed)
    .sort((left, right) => right.aggregate_relative_mae_gain - left.aggregate_relative_mae_gain);
  return {
    status: 'not-promoted',
    decision: passing.length ? 'local-candidate' : 'no-promotion',
    selected_model: null,
    local_candidate_model: passing[0]?.model || null,
    local_candidate_only: true,
    failure_result: passing.length ? null : gate.failure_result,
    candidates,
    gate: structuredClone(gate),
    authority: structuredClone(protocol.authority),
  };
}

function selectBestAuditModel(aggregate) {
  return aggregate
    .filter((row) => COUNT_MODELS.includes(row.model) && Number.isFinite(row.relative_mae_gain_vs_seasonal_naive))
    .sort((left, right) => right.relative_mae_gain_vs_seasonal_naive - left.relative_mae_gain_vs_seasonal_naive)[0]?.model
    || 'negative-binomial-log-link-v1';
}

function buildEvaluationReport({ protocol, protocolIdentity, martManifest, martManifestIdentity, states, finalized, promotion, generatedAt }) {
  return {
    schema: EVALUATION_SCHEMA,
    generated_at: generatedAt,
    protocol: {
      schema: protocol.schema,
      sha256: protocolIdentity,
      frozen_at: protocol.frozen_at,
      frozen_before_model_performance: true,
    },
    target: structuredClone(protocol.target),
    data: {
      mart_artifact_identity: martManifest.artifact_identity,
      mart_manifest_sha256: martManifestIdentity,
      source_vintage: martManifest.exact_input.warehouse_current_snapshot_id,
      coverage: martManifest.source_coverage,
      complete_week_end_exclusive: martManifest.evaluation_complete_week_end_exclusive,
      unit_count: martManifest.unit_count,
      mart_rows: martManifest.row_count,
      admission: martManifest.admission,
    },
    folds: protocol.rolling_folds,
    spatial_holdout: protocol.spatial_holdout,
    primary_tuple_vocabulary: protocol.primary_tuple_vocabulary,
    models: protocol.models.map((definition) => ({
      ...definition,
      fit_diagnostics: summarizeStateDiagnostics(states, definition.id),
    })),
    metrics: {
      aggregate_primary: stripSums(finalized.aggregate),
      primary_by_fold_space_holdout: stripSums(finalized.primary),
      by_category: stripSums(finalized.category),
      by_data_volume: stripSums(finalized.volume),
      by_acs_population_when_temporally_compatible: stripSums(finalized.acs_population),
    },
    numerical_diagnostics: finalized.numerical_diagnostics,
    promotion,
    privacy: structuredClone(protocol.privacy),
    authority: structuredClone(protocol.authority),
    limitations: [
      'Targets are weekly counts of preliminary PPD reported incidents, not a complete account of harm, individual victim probability, or absolute safety.',
      'Spatial units inherit hundred-block generalization and fail-closed admission; ambiguous tract events are excluded rather than assigned.',
      'Temporal and spatial holdouts measure bounded historical generalization only and do not establish causality, future stability, deployment readiness, or scientific validity.',
      'ACS race, income, and poverty attributes are unavailable; population estimate/MOE are used only for compatible-period error audit and never as ranking weights.',
    ],
  };
}

function summarizeStateDiagnostics(states, model) {
  if (BASELINE_MODELS.includes(model)) return { fit: 'training-only empirical residual interval calibration' };
  const rows = [...states.values()].map((state) => ({
    fold: state.fold.id,
    unit_type: state.unit_type,
    category: state.category,
    observations: model === 'poisson-log-link-v1' ? state.poisson_fit_observations : state.nb_fit_observations,
    last_coefficient_change: model === 'poisson-log-link-v1' ? state.poisson_last_change : state.nb_last_change,
    singular: model === 'poisson-log-link-v1' ? state.poisson_singular : state.nb_singular,
    alpha: model === 'negative-binomial-log-link-v1' ? state.alpha : undefined,
  }));
  return {
    state_count: rows.length,
    minimum_fit_observations: Math.min(...rows.map((row) => row.observations)),
    maximum_last_coefficient_change: Math.max(...rows.map((row) => row.last_coefficient_change)),
    singular_state_count: rows.filter((row) => row.singular).length,
    alpha_range: model === 'negative-binomial-log-link-v1'
      ? [Math.min(...rows.map((row) => row.alpha)), Math.max(...rows.map((row) => row.alpha))]
      : undefined,
  };
}

function buildResidualMap(blockRows, selectedModel, promotion, martManifest, generatedAt) {
  const selected = blockRows.filter((row) => row.model === selectedModel)
    .map((row) => ({
      unit_type: row.unit_type,
      spatial_block_id: row.spatial_block_id,
      observations: row.observations,
      mean_residual_actual_minus_predicted: row.mean_residual_actual_minus_predicted,
      over_estimate_rate: row.over_estimate_rate,
      under_estimate_rate: row.under_estimate_rate,
      mean_actual: row.mean_actual,
      mean_predicted: row.mean_predicted,
    }))
    .sort((left, right) => left.spatial_block_id.localeCompare(right.spatial_block_id));
  return {
    schema: 'engagement-area-intelligence-residual-map/v1',
    generated_at: generatedAt,
    model: selectedModel,
    promotion_status: promotion.status,
    source_vintage: martManifest.exact_input.warehouse_current_snapshot_id,
    residual_definition: 'actual reported incident count minus modeled count; positive means under-estimation',
    geometry: '2km EPSG:3857 block identifiers only; no event coordinates or addresses',
    blocks: selected,
  };
}

function buildBiasAudit(finalized, selectedModel, promotion, generatedAt) {
  return {
    schema: 'engagement-area-intelligence-bias-error-audit/v1',
    generated_at: generatedAt,
    model: selectedModel,
    promotion_status: promotion.status,
    protected_or_sensitive_attributes: {
      race: 'unavailable',
      income: 'unavailable',
      poverty: 'unavailable',
      product_weight_use: 'forbidden',
    },
    category_error: stripSums(finalized.category.filter((row) => row.model === selectedModel)),
    spatial_and_data_volume_error: stripSums(finalized.volume.filter((row) => row.model === selectedModel)),
    acs_population_error_when_temporally_compatible: stripSums(finalized.acs_population.filter((row) => row.model === selectedModel)),
    caveats: [
      'Absence of admitted race, income, or poverty data means those disparities were not measured, not that they are absent.',
      'ACS population estimate and 90% MOE remain distinct; only 2020-2024 compatible weeks enter this audit.',
      'Reported-incident patterns reflect reporting, enforcement, classification, revision, and source-coverage processes.',
    ],
  };
}

function buildLineageSummary(martManifest, martManifestIdentity, protocolIdentity, generatedAt) {
  return {
    schema: 'engagement-area-intelligence-lineage-summary/v1',
    generated_at: generatedAt,
    protocol_sha256: protocolIdentity,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    exact_input: martManifest.exact_input,
    source_coverage: martManifest.source_coverage,
    source_snapshot_index: martManifest.source_snapshot_index,
    transforms: martManifest.transforms,
    admission: martManifest.admission,
    privacy: {
      event_level_coordinates: false,
      generalized_locations: false,
      source_record_ids: false,
    },
    identity_note: 'Identities bind exact manifests/artifacts only; they do not prove model correctness, data truth, freshness, completeness, or authority.',
  };
}

function buildServingArtifact({ report, selectedAuditModel, generatedAt }) {
  return {
    schema: 'engagement-area-intelligence-serving/v1',
    generated_at: generatedAt,
    status: 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: report.data.coverage,
      source_vintage: report.data.source_vintage,
      limitations: report.limitations.slice(0, 2),
    },
    forecast: {
      status: 'unavailable',
      reason: report.promotion.decision === 'local-candidate'
        ? 'local-candidate-has-no-serving-authority'
        : 'model-did-not-exceed-predefined-seasonal-baseline',
      predictions: [],
    },
    evaluation: {
      promotion_status: report.promotion.status,
      selected_model: report.promotion.selected_model,
      local_candidate_model: report.promotion.local_candidate_model,
      local_candidate_only: true,
      audit_model: selectedAuditModel,
      protocol_sha256: report.protocol.sha256,
    },
    authority: structuredClone(report.authority),
    privacy: structuredClone(report.privacy),
    forbidden_claims: report.target.forbidden_claims,
  };
}

function buildModelState(states, protocolIdentity, martManifestIdentity, generatedAt) {
  return {
    schema: 'engagement-area-intelligence-model-state/v1',
    generated_at: generatedAt,
    protocol_sha256: protocolIdentity,
    mart_manifest_sha256: martManifestIdentity,
    states: serializeStates(states),
    limitations: 'Local baseline fit state only; not a deployed model, scheduled training system, or scientific-validity claim.',
  };
}

function buildModelCard({ report, selectedAuditModel }) {
  const aggregate = report.metrics.aggregate_primary;
  const lines = [
    '# Area Intelligence baseline model card',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## Decision',
    '',
    report.promotion.decision === 'local-candidate'
      ? `The frozen local evaluation gate identified \`${report.promotion.local_candidate_model}\` as a candidate only. Every authority flag remains false; product serving stays historical-only and forecast is explicitly unavailable.`
      : 'No count model passed every pre-defined temporal, spatial, numerical, interval-coverage, and category gate. Product serving remains historical-only and forecast is explicitly unavailable.',
    '',
    '## Intended use',
    '',
    'This baseline estimates weekly counts of preliminary PPD reported incidents for admitted census-tract and fixed-grid units. It is not an individual victim probability, safety score, safest-area or safest-route tool, live alert, causal model, or complete measure of harm.',
    '',
    '## Data and evaluation',
    '',
    `- Source coverage: ${report.data.coverage.earliest_scope_start} to ${report.data.coverage.latest_scope_end_exclusive} (exclusive upper bound); complete evaluation weeks end before ${report.data.complete_week_end_exclusive}.`,
    `- Units: ${report.data.unit_count.tract} tracts and ${report.data.unit_count['fixed-grid']} fixed-grid cells with admitted event evidence.`,
    `- Admission excludes ${report.data.admission.tract.ambiguous_excluded} ambiguous tract rows and ${report.data.admission.tract.unmapped_excluded} unmapped tract rows; they are never force-assigned.`,
    '- Four frozen rolling temporal folds and contiguous spatial-block holdouts are evaluated with MAE, Poisson/NB deviance, 90% interval coverage, relative seasonal gain, and category/space/data-volume residual slices.',
    '',
    '## Aggregate primary metrics',
    '',
    '| Model | MAE | Poisson deviance | NB deviance | 90% coverage | Gain vs seasonal |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...aggregate.map((row) => `| ${row.model} | ${format(row.mae)} | ${format(row.poisson_deviance)} | ${format(row.negative_binomial_deviance)} | ${percent(row.prediction_interval_90_coverage)} | ${percent(row.relative_mae_gain_vs_seasonal_naive)} |`),
    '',
    '## Error and fairness boundaries',
    '',
    `Residual and bias/error artifacts use \`${selectedAuditModel}\` for diagnostic display even when it is not promoted. ACS population estimate and 90% MOE are audited only for temporally compatible 2020-2024 weeks and never used as ranking weights. Race, income, and poverty inputs are unavailable, so related disparities remain unmeasured rather than cleared.`,
    '',
    '## Governance and source limitations',
    '',
    '- The model follows the use-case scoping, measurement, documentation, and stop/no-promotion posture of the [NIST AI Risk Management Framework 1.0](https://doi.org/10.6028/NIST.AI.100-1). NIST currently notes that AI RMF 1.0 is being revised; this card does not claim certification or compliance.',
    '- The [Philadelphia official Crime Incidents page](https://data.phila.gov/visualizations/crime-incidents/) describes preliminary records, later reclassification, and hundred-block generalized locations.',
    '- The [Census Bureau ACS methodology](https://www.census.gov/programs-surveys/acs/methodology/sample-size-and-data-quality/sample-size-definitions.html) publishes 90% margins of error; estimate and MOE remain distinct here.',
    '',
    'Local fitting and backtesting do not establish main integration, remote CI, continuous retraining, production runtime, deployment, causal validity, future performance, scientific validity, or user decision quality.',
    '',
  ];
  return lines.join('\n');
}

export function validateModelEvaluationReport(report, {
  protocol,
  martManifest,
  martManifestIdentity,
  checkpoint,
} = {}) {
  if (!protocol) throw new Error('ModelEvaluationReport validation requires the caller-loaded frozen protocol.');
  validateAreaIntelligenceEvaluationProtocol(protocol);
  if (report?.schema !== EVALUATION_SCHEMA
    || report.protocol?.sha256 !== AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256
    || report.protocol?.schema !== protocol.schema
    || report.protocol?.frozen_at !== protocol.frozen_at
    || report.protocol?.frozen_before_model_performance !== true
    || !Array.isArray(report.metrics?.primary_by_fold_space_holdout)
    || !Array.isArray(report.metrics?.by_category)
    || !Array.isArray(report.metrics?.by_data_volume)
    || report.promotion?.status !== 'not-promoted'
    || report.promotion?.selected_model !== null
    || report.promotion?.local_candidate_only !== true
    || !allAuthorityFalse(report.authority)
    || !isAggregateOnlyPrivacy(report.privacy)) {
    throw new Error('ModelEvaluationReport failed its machine-checkable contract.');
  }
  if (!martManifest || !martManifestIdentity || !checkpoint) {
    throw new Error('ModelEvaluationReport validation requires exact mart lineage and its evaluation checkpoint.');
  }
  const reportModelDefinitions = report.models?.map(({ fit_diagnostics: ignored, ...definition }) => definition);
  if (stableSerialization(report.target) !== stableSerialization(protocol.target)
    || stableSerialization(report.folds) !== stableSerialization(protocol.rolling_folds)
    || stableSerialization(report.spatial_holdout) !== stableSerialization(protocol.spatial_holdout)
    || stableSerialization(report.primary_tuple_vocabulary) !== stableSerialization(protocol.primary_tuple_vocabulary)
    || stableSerialization(reportModelDefinitions) !== stableSerialization(protocol.models)
    || stableSerialization(report.authority) !== stableSerialization(protocol.authority)
    || stableSerialization(report.privacy) !== stableSerialization(protocol.privacy)
    || stableSerialization(report.promotion?.gate) !== stableSerialization(protocol.promotion_gate)
    || stableSerialization(report.numerical_diagnostics?.gate) !== stableSerialization(protocol.numerical_stability_gate)
    || protocol.numerical_stability_gate.interval.aggregate_bypass_allowed !== false
    || protocol.promotion_gate.all_primary_slices_must_pass !== true
    || stableSerialization(protocol.numerical_stability_gate.interval.primary_slice_coverage_inclusive)
      !== stableSerialization(protocol.promotion_gate.acceptable_interval_coverage_inclusive)
    || protocol.numerical_stability_gate.interval.nominal_probability !== protocol.metrics.interval_nominal) {
    throw new Error('ModelEvaluationReport embedded protocol gates drifted from the caller-loaded frozen protocol.');
  }
  if (report.data?.mart_artifact_identity !== martManifest.artifact_identity
    || report.data?.mart_manifest_sha256 !== martManifestIdentity
    || report.data?.source_vintage !== martManifest.exact_input?.warehouse_current_snapshot_id
    || stableSerialization(report.data?.coverage) !== stableSerialization(martManifest.source_coverage)
    || report.data?.complete_week_end_exclusive !== martManifest.evaluation_complete_week_end_exclusive
    || stableSerialization(report.data?.unit_count) !== stableSerialization(martManifest.unit_count)
    || report.data?.mart_rows !== martManifest.row_count
    || stableSerialization(report.data?.admission) !== stableSerialization(martManifest.admission)) {
    throw new Error('ModelEvaluationReport data lineage drifted from the exact validated mart.');
  }
  assertFiniteJsonValue(report, 'ModelEvaluationReport');
  assertAggregateOnlyArtifact(report, 'ModelEvaluationReport');
  const required = ['mae', 'poisson_deviance', 'negative_binomial_deviance', 'prediction_interval_90_coverage', 'relative_mae_gain_vs_seasonal_naive'];
  for (const row of report.metrics.primary_by_fold_space_holdout) {
    const numericalRow = report.numerical_diagnostics?.primary_slices?.find((candidate) => (
      candidate.model === row.model
        && stableSerialization(primaryTupleOf(candidate)) === stableSerialization(primaryTupleOf(row))
    ));
    if (numericalRow?.passed && required.some((field) => row[field] == null || !Number.isFinite(row[field]))) {
      throw new Error(`ModelEvaluationReport primary metric is missing or non-finite for ${row.model}/${row.fold}.`);
    }
    if (row.prediction_interval_90_coverage != null
      && (row.prediction_interval_90_coverage < 0 || row.prediction_interval_90_coverage > 1)) {
      throw new Error('ModelEvaluationReport coverage is outside [0,1].');
    }
  }
  const modelIds = report.models?.map(({ id }) => id) || [];
  const tupleVocabulary = report.primary_tuple_vocabulary;
  if (stableSerialization(modelIds) !== stableSerialization(ALL_MODELS)
    || !Array.isArray(tupleVocabulary)
    || tupleVocabulary.length !== 16) {
    throw new Error('ModelEvaluationReport model or primary tuple vocabulary is invalid.');
  }
  const expectedPrimaryKeys = modelIds.flatMap((model) => tupleVocabulary.map((tuple) => (
    stableSerialization({ model, ...tuple })
  )));
  const actualPrimaryKeys = report.metrics.primary_by_fold_space_holdout.map((row) => (
    stableSerialization({ model: row.model, ...primaryTupleOf(row) })
  ));
  assertExactKeySequence(actualPrimaryKeys, expectedPrimaryKeys, 'ModelEvaluationReport primary tuple');

  const numerical = report.numerical_diagnostics;
  if (numerical?.schema !== NUMERICAL_DIAGNOSTICS_SCHEMA
    || numerical.protocol_sha256 !== report.protocol.sha256
    || !Array.isArray(numerical.fit_state_vocabulary)
    || !Array.isArray(numerical.primary_slice_vocabulary)
    || !Array.isArray(numerical.fit_states)
    || !Array.isArray(numerical.primary_slices)
    || numerical.local_candidate_only !== true
    || !allAuthorityFalse(numerical.authority)) {
    throw new Error('ModelEvaluationReport numerical diagnostics contract is invalid.');
  }
  const expectedFitKeys = numerical.fit_state_vocabulary.map(stableSerialization);
  const frozenExpectedFitKeys = COUNT_MODELS.flatMap((model) => (
    report.folds.flatMap(({ id: fold }) => [
      ...TRACT_CATEGORIES.map((category) => ({ model, fold, unit_type: 'tract', category })),
      { model, fold, unit_type: 'fixed-grid', category: 'all' },
    ])
  )).map(stableSerialization);
  assertExactKeySequence(expectedFitKeys, frozenExpectedFitKeys, 'ModelEvaluationReport fit state vocabulary');
  const actualFitKeys = numerical.fit_states.map((row) => stableSerialization({
    model: row.model, fold: row.fold, unit_type: row.unit_type, category: row.category,
  }));
  assertExactKeySequence(actualFitKeys, expectedFitKeys, 'ModelEvaluationReport fit state');
  const expectedSliceKeys = numerical.primary_slice_vocabulary.map(stableSerialization);
  const frozenExpectedSliceKeys = ALL_MODELS.flatMap((model) => tupleVocabulary.map((tuple) => (
    stableSerialization({ model, ...tuple })
  )));
  assertExactKeySequence(expectedSliceKeys, frozenExpectedSliceKeys, 'ModelEvaluationReport numerical primary slice vocabulary');
  const actualSliceKeys = numerical.primary_slices.map((row) => stableSerialization({
    model: row.model, ...primaryTupleOf(row),
  }));
  assertExactKeySequence(actualSliceKeys, expectedSliceKeys, 'ModelEvaluationReport numerical primary slice');
  for (const row of numerical.fit_states) {
    validateDiagnosticRow(row, 'fit state');
    validateFitStateDiagnostic(row, { protocol, checkpoint });
  }
  for (const row of numerical.primary_slices) {
    validateDiagnosticRow(row, 'primary slice');
    validatePrimarySliceDiagnostic(row, report.metrics.primary_by_fold_space_holdout, protocol);
    if (!Number.isInteger(row.prediction_count) || row.prediction_count < 0
      || !Number.isInteger(row.interval_count) || row.interval_count < 0
      || (row.passed && row.prediction_count < 1)
      || row.interval_count !== row.prediction_count
      || (row.passed && (!Number.isFinite(row.coverage) || row.coverage < 0 || row.coverage > 1))
      || (row.passed && (!Number.isFinite(row.maximum_prediction_observed)
        || row.maximum_prediction_observed < 0
        || row.maximum_prediction_observed > numerical.gate.prediction.maximum_inclusive))) {
      throw new Error('ModelEvaluationReport numerical primary slice bounds are invalid.');
    }
  }
  const failedFitStateCount = numerical.fit_states.filter(({ passed }) => !passed).length;
  const failedPrimarySliceCount = numerical.primary_slices.filter(({ passed }) => !passed).length;
  if (numerical.all_applicable_fit_states_passed !== (failedFitStateCount === 0)
    || numerical.all_primary_slices_passed !== (failedPrimarySliceCount === 0)
    || numerical.expected_fit_state_count_per_count_model !== expectedFitStateDescriptors(protocol, COUNT_MODELS[0]).length) {
    throw new Error('ModelEvaluationReport numerical diagnostic summary drifted from its validated rows.');
  }
  const recomputedAggregate = recomputeAggregatePrimary(report.metrics.primary_by_fold_space_holdout);
  validateRecomputedAggregate(report.metrics.aggregate_primary, recomputedAggregate);
  const expectedPromotion = evaluatePromotion({
    primary: report.metrics.primary_by_fold_space_holdout,
    category: report.metrics.by_category,
    aggregate: recomputedAggregate,
    numerical_diagnostics: numerical,
  }, protocol);
  if (stableSerialization(report.promotion) !== stableSerialization(expectedPromotion)) {
    throw new Error('ModelEvaluationReport promotion drifted from exact tuples and numerical gates.');
  }
  if (checkpoint) validateCheckpointNumericalGate(checkpoint, numerical);
  return true;
}

function validateFitStateDiagnostic(row, { protocol, checkpoint }) {
  if (!checkpoint) throw new Error('ModelEvaluationReport fit-state validation requires its exact checkpoint.');
  const state = checkpoint.states?.[stateKey(row.fold, row.unit_type, row.category)];
  const definition = protocol.models.find(({ id }) => id === row.model);
  if (!state || !definition || !COUNT_MODELS.includes(row.model)) {
    throw new Error('ModelEvaluationReport fit state is not backed by the exact checkpoint.');
  }
  const isPoisson = row.model === 'poisson-log-link-v1';
  const expected = diagnoseModelNumerics({
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
    predictions: [0],
    maximumPrediction: protocol.numerical_stability_gate.prediction.maximum_inclusive,
    intervals: [{ lower: 0, upper: 0 }],
    coverages: [protocol.numerical_stability_gate.interval.nominal_probability],
  });
  if (stableSerialization(row.checks?.irls) !== stableSerialization(expected.checks.irls)
    || stableSerialization(row.checks?.negative_binomial_dispersion)
      !== stableSerialization(expected.checks.negative_binomial_dispersion)
    || row.observations !== (isPoisson ? state.poisson_fit_observations : state.nb_fit_observations)) {
    throw new Error('ModelEvaluationReport fit-state checks drifted from the exact checkpoint state.');
  }
  const expectedFailures = failuresFromDiagnosticChecks(row.checks);
  if (row.checks.irls.reached_iteration_cap) {
    expectedFailures.add('irls-convergence-not-before-iteration-limit');
  }
  assertDiagnosticFailures(row, expectedFailures, 'fit state');
}

function validatePrimarySliceDiagnostic(row, primaryRows, protocol) {
  const metric = primaryRows.find((candidate) => candidate.model === row.model
    && stableSerialization(primaryTupleOf(candidate)) === stableSerialization(primaryTupleOf(row)));
  if (!metric) throw new Error('ModelEvaluationReport numerical primary slice has no exact primary metric.');
  const coverageChecks = {
    present: metric.prediction_interval_90_coverage != null,
    finite: Number.isFinite(metric.prediction_interval_90_coverage),
    within_unit_interval: Number.isFinite(metric.prediction_interval_90_coverage)
      && metric.prediction_interval_90_coverage >= 0
      && metric.prediction_interval_90_coverage <= 1,
  };
  if (row.coverage !== metric.prediction_interval_90_coverage
    || stableSerialization(row.checks?.coverages) !== stableSerialization(coverageChecks)
    || row.checks?.predictions?.present !== (row.prediction_count > 0)
    || row.checks?.predictions?.maximum_valid !== true
    || row.checks?.intervals?.present !== (row.interval_count > 0)
    || row.checks?.intervals?.matches_prediction_count !== (
      row.prediction_count > 0 && row.interval_count > 0 && row.prediction_count === row.interval_count
    )) {
    throw new Error('ModelEvaluationReport numerical primary slice checks drifted from its primary metric and counts.');
  }
  const maximum = protocol.numerical_stability_gate.prediction.maximum_inclusive;
  if (row.checks.predictions.finite && row.checks.predictions.nonnegative
    && row.checks.predictions.within_maximum
    && (!Number.isFinite(row.maximum_prediction_observed)
      || row.maximum_prediction_observed < 0 || row.maximum_prediction_observed > maximum)) {
    throw new Error('ModelEvaluationReport maximum prediction evidence is invalid.');
  }
  assertDiagnosticFailures(row, failuresFromDiagnosticChecks(row.checks), 'primary slice');
}

function failuresFromDiagnosticChecks(checks) {
  const failures = new Set();
  const irls = checks?.irls;
  if (irls) {
    if (!irls.iterations_valid) failures.add('irls-iterations-invalid');
    if (!irls.tolerance_valid) failures.add('irls-tolerance-invalid');
    if (!irls.change_finite) failures.add('irls-change-non-finite');
    if (!irls.converged) failures.add('irls-non-converged');
    if (irls.iteration_cap_exhausted) failures.add('irls-iteration-cap-exhausted');
    if (!irls.singular_known) failures.add('irls-singular-state-invalid');
    else if (irls.singular) failures.add('irls-singular');
    if (!irls.coefficients_finite) failures.add('irls-coefficients-non-finite');
    if (!irls.coefficient_maximum_valid) failures.add('irls-coefficient-maximum-invalid');
    if (irls.coefficients_finite && irls.coefficient_maximum_valid && !irls.coefficients_within_maximum) {
      failures.add('irls-coefficient-exceeds-maximum');
    }
  }
  const dispersion = checks?.negative_binomial_dispersion;
  if (dispersion) {
    if (!dispersion.bounds_valid) failures.add('nb-dispersion-bounds-invalid');
    if (!dispersion.finite) failures.add('nb-dispersion-non-finite');
    else if (dispersion.bounds_valid && !dispersion.within_bounds) failures.add('nb-dispersion-out-of-bounds');
  }
  const predictions = checks?.predictions;
  if (!predictions?.present) failures.add('predictions-missing');
  if (!predictions?.maximum_valid) failures.add('prediction-maximum-invalid');
  if (predictions?.present && !predictions.finite) failures.add('prediction-non-finite');
  if (predictions?.present && !predictions.nonnegative) failures.add('prediction-negative');
  if (predictions?.present && predictions.maximum_valid && !predictions.within_maximum) {
    failures.add('prediction-exceeds-maximum');
  }
  const intervals = checks?.intervals;
  if (!intervals?.present) failures.add('intervals-missing');
  if ((predictions?.present || intervals?.present) && !intervals?.matches_prediction_count) {
    failures.add('prediction-interval-count-mismatch');
  }
  if (intervals?.present && !intervals.finite) failures.add('interval-non-finite');
  if (intervals?.present && !intervals.lower_nonnegative) failures.add('interval-negative-lower');
  if (intervals?.present && !intervals.ordered) failures.add('interval-inverted');
  const coverages = checks?.coverages;
  if (!coverages?.present) failures.add('coverages-missing');
  if (coverages?.present && !coverages.finite) failures.add('coverage-non-finite');
  if (coverages?.finite && !coverages.within_unit_interval) failures.add('coverage-out-of-bounds');
  return failures;
}

function assertDiagnosticFailures(row, expectedFailures, label) {
  const expected = [...expectedFailures].sort();
  if (stableSerialization(row.failures) !== stableSerialization(expected)
    || row.passed !== (expected.length === 0)) {
    throw new Error(`ModelEvaluationReport ${label} failures drifted from diagnostic checks.`);
  }
}

function recomputeAggregatePrimary(primaryRows) {
  const metricFields = [
    'mae', 'poisson_deviance', 'negative_binomial_deviance',
    'prediction_interval_90_coverage', 'mean_residual_actual_minus_predicted',
    'mean_actual', 'mean_predicted', 'over_estimate_rate', 'under_estimate_rate',
  ];
  const byModel = new Map();
  for (const row of primaryRows) {
    if (!Number.isInteger(row.observations) || row.observations < 0) {
      throw new Error('ModelEvaluationReport primary observations are invalid.');
    }
    if (!byModel.has(row.model)) {
      byModel.set(row.model, { model: row.model, observations: 0, sums: Object.fromEntries(metricFields.map((field) => [field, 0])) });
    }
    const target = byModel.get(row.model);
    target.observations += row.observations;
    for (const field of metricFields) {
      if (row.observations === 0 && row[field] == null) continue;
      if (!Number.isFinite(row[field])) throw new Error(`ModelEvaluationReport primary ${field} is non-finite.`);
      target.sums[field] += row[field] * row.observations;
    }
  }
  const aggregate = [...byModel.values()].map(({ model, observations, sums }) => ({
    model,
    observations,
    ...Object.fromEntries(metricFields.map((field) => [field, observations ? sums[field] / observations : null])),
  })).sort((left, right) => left.model.localeCompare(right.model));
  addRelativeSeasonalGain(aggregate);
  return aggregate;
}

function validateRecomputedAggregate(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error('ModelEvaluationReport aggregate primary rows are incomplete.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actualRow = actual[index];
    const expectedRow = expected[index];
    if (stableSerialization(Object.keys(actualRow || {}).sort()) !== stableSerialization(Object.keys(expectedRow).sort())
      || actualRow?.model !== expectedRow.model || actualRow.observations !== expectedRow.observations) {
      throw new Error('ModelEvaluationReport aggregate primary identity or observation count drifted.');
    }
    for (const [field, expectedValue] of Object.entries(expectedRow)) {
      if (['model', 'observations'].includes(field)) continue;
      const actualValue = actualRow[field];
      const tolerance = 1e-12 * Math.max(1, Math.abs(expectedValue || 0));
      if (expectedValue === null ? actualValue !== null : !Number.isFinite(actualValue) || Math.abs(actualValue - expectedValue) > tolerance) {
        throw new Error(`ModelEvaluationReport aggregate ${field} was not recomputed from primary rows.`);
      }
    }
  }
}

function validateCheckpointNumericalGate(checkpoint, numerical) {
  const expected = {
    fit_states_passed: numerical.fit_states.every(({ passed }) => passed),
    primary_slices_passed: numerical.primary_slices.every(({ passed }) => passed),
    failed_fit_state_count: numerical.fit_states.filter(({ passed }) => !passed).length,
    failed_primary_slice_count: numerical.primary_slices.filter(({ passed }) => !passed).length,
  };
  if (stableSerialization(checkpoint.numerical_gate) !== stableSerialization(expected)) {
    throw new Error('Area Intelligence evaluation checkpoint numerical gate drifted from the validated report.');
  }
}

export function validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
  protocolIdentity = AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
  martManifestIdentity,
  martArtifactIdentity,
  receiptSha256,
  protocol,
  report,
} = {}) {
  if (checkpoint?.schema !== CHECKPOINT_SCHEMA
    || checkpoint.protocol_sha256 !== protocolIdentity
    || checkpoint.protocol_schema !== PROTOCOL_SCHEMA
    || checkpoint.receipt_sha256 !== receiptSha256
    || checkpoint.mart_manifest_sha256 !== martManifestIdentity
    || checkpoint.mart_artifact_identity !== martArtifactIdentity
    || !['fitting', 'complete'].includes(checkpoint.status)
    || !Number.isInteger(checkpoint.poisson_iterations_completed)
    || !Number.isInteger(checkpoint.nb_iterations_completed)
    || typeof checkpoint.dispersion_completed !== 'boolean'
    || typeof checkpoint.baseline_intervals_completed !== 'boolean'
    || !checkpoint.states || typeof checkpoint.states !== 'object') {
    throw new Error('Area Intelligence evaluation checkpoint failed its exact protocol and mart contract.');
  }
  assertFiniteJsonValue(checkpoint, 'Area Intelligence evaluation checkpoint');
  assertAggregateOnlyArtifact(checkpoint, 'Area Intelligence evaluation checkpoint');
  if (protocol) {
    const expectedStateKeys = [...createStates(protocol).keys()].sort();
    const actualStateKeys = Object.keys(checkpoint.states).sort();
    assertExactKeySequence(actualStateKeys, expectedStateKeys, 'Area Intelligence evaluation checkpoint fit state');
    const coefficientLimit = protocol.numerical_stability_gate.coefficient_abs_limit_inclusive;
    const [minimumAlpha, maximumAlpha] = protocol.numerical_stability_gate.dispersion_alpha_inclusive;
    for (const [key, state] of Object.entries(checkpoint.states)) {
      if (!Array.isArray(state.poisson_beta) || state.poisson_beta.length !== 6
        || !Array.isArray(state.nb_beta) || state.nb_beta.length !== 6
        || ![...state.poisson_beta, ...state.nb_beta].every((value) => (
          Number.isFinite(value) && Math.abs(value) <= coefficientLimit
        ))
        || !Number.isFinite(state.alpha) || state.alpha < minimumAlpha || state.alpha > maximumAlpha
        || typeof state.poisson_singular !== 'boolean'
        || typeof state.nb_singular !== 'boolean'
        || state.poisson_iterations_completed !== checkpoint.poisson_iterations_completed
        || state.nb_iterations_completed !== checkpoint.nb_iterations_completed
        || key !== stateKey(state.fold?.id, state.unit_type, state.category)) {
        throw new Error('Area Intelligence evaluation checkpoint model state is invalid.');
      }
    }
    if (checkpoint.status === 'complete') {
      const numericalGate = checkpoint.numerical_gate;
      if (typeof numericalGate?.fit_states_passed !== 'boolean'
        || typeof numericalGate?.primary_slices_passed !== 'boolean'
        || !Number.isInteger(numericalGate?.failed_fit_state_count)
        || numericalGate.failed_fit_state_count < 0
        || !Number.isInteger(numericalGate?.failed_primary_slice_count)
        || numericalGate.failed_primary_slice_count < 0
        || numericalGate.fit_states_passed !== (numericalGate.failed_fit_state_count === 0)
        || numericalGate.primary_slices_passed !== (numericalGate.failed_primary_slice_count === 0)) {
        throw new Error('Area Intelligence evaluation checkpoint numerical gate summary is invalid.');
      }
      if (report) validateCheckpointNumericalGate(checkpoint, report.numerical_diagnostics);
    }
  }
  return true;
}

export function validateAreaIntelligenceEvaluationServingArtifact(artifact, {
  report,
  protocol,
  martManifest,
  martManifestIdentity,
  checkpoint,
} = {}) {
  if (!report || !protocol || !martManifest || !martManifestIdentity || !checkpoint) {
    throw new Error('Area Intelligence evaluation serving validation requires exact report, protocol, mart, and checkpoint context.');
  }
  validateModelEvaluationReport(report, { protocol, martManifest, martManifestIdentity, checkpoint });
  if (artifact?.schema !== 'engagement-area-intelligence-serving/v1'
    || artifact.status !== 'not-promoted'
    || artifact.forecast?.status !== 'unavailable'
    || !Array.isArray(artifact.forecast?.predictions)
    || artifact.forecast.predictions.length !== 0
    || artifact.evaluation?.promotion_status !== 'not-promoted'
    || artifact.evaluation?.selected_model !== null
    || artifact.evaluation?.local_candidate_only !== true
    || artifact.evaluation?.protocol_sha256 !== AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256
    || !allAuthorityFalse(artifact.authority)
    || !isAggregateOnlyPrivacy(artifact.privacy)) {
    throw new Error('Area Intelligence evaluation serving artifact failed closed candidate-only validation.');
  }
  if (artifact.evaluation.local_candidate_model !== report.promotion.local_candidate_model
    || artifact.evaluation.protocol_sha256 !== report.protocol.sha256
    || artifact.forecast.reason !== (report.promotion.decision === 'local-candidate'
      ? 'local-candidate-has-no-serving-authority'
      : 'model-did-not-exceed-predefined-seasonal-baseline')) {
    throw new Error('Area Intelligence evaluation serving artifact drifted from its report.');
  }
  if (stableSerialization(artifact.authority) !== stableSerialization(protocol.authority)) {
    throw new Error('Area Intelligence evaluation serving artifact authority drifted from the frozen protocol.');
  }
  assertFiniteJsonValue(artifact, 'Area Intelligence evaluation serving artifact');
  assertAggregateOnlyArtifact(artifact, 'Area Intelligence evaluation serving artifact');
  return true;
}

export function validateAreaIntelligenceEvaluationManifest(manifest, {
  protocol,
  martManifest,
  martManifestIdentity,
  martInventory,
  report,
  servingArtifact,
  checkpoint,
} = {}) {
  if (!protocol || !martManifest || !martManifestIdentity || !report || !checkpoint) {
    throw new Error('Area Intelligence evaluation manifest validation requires exact protocol, mart, report, and checkpoint context.');
  }
  validateAreaIntelligenceEvaluationProtocol(protocol);
  if (manifest?.schema !== EVALUATION_MANIFEST_SCHEMA
    || manifest.protocol?.schema !== PROTOCOL_SCHEMA
    || manifest.protocol?.sha256 !== AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256
    || manifest.protocol_sha256 !== manifest.protocol.sha256
    || manifest.protocol?.receipt_sha256 !== protocol?.exact_input_gate?.receipt_sha256
    || manifest.mart_manifest_sha256 !== martManifestIdentity
    || manifest.mart_artifact_identity !== martManifest?.artifact_identity
    || manifest.availability !== 'unavailable'
    || manifest.promotion?.status !== 'not-promoted'
    || manifest.promotion?.selected_model !== null
    || manifest.local_candidate_only !== true
    || !allAuthorityFalse(manifest.authority)
    || !isAggregateOnlyPrivacy(manifest.privacy)
    || !Array.isArray(manifest.artifacts)
    || stableSerialization(manifest.artifacts.map(({ name }) => name)) !== stableSerialization(EVALUATION_ARTIFACT_NAMES)
    || manifest.artifacts.some((artifact) => (
      !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')
    ))) {
    throw new Error('Area Intelligence evaluation manifest failed its exact P3 contract.');
  }
  if (checkpoint.status !== 'complete') {
    throw new Error('Area Intelligence evaluation manifest cannot complete before its validated checkpoint.');
  }
  if (martInventory) {
    const expectedSeam = buildEvaluationLineageSeam({
      protocol,
      protocolIdentity: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
      martManifest,
      martManifestIdentity,
      martInventory,
      promotion: manifest.promotion,
      availability: 'unavailable',
    });
    if (stableSerialization(manifest.lineage_seam) !== stableSerialization(expectedSeam)) {
      throw new Error('Area Intelligence evaluation manifest lineage seam drifted.');
    }
  }
  if (protocol && (stableSerialization(manifest.authority) !== stableSerialization(protocol.authority)
    || stableSerialization(manifest.privacy) !== stableSerialization(protocol.privacy))) {
    throw new Error('Area Intelligence evaluation manifest governance drifted from the frozen protocol.');
  }
  validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
    protocolIdentity: AREA_INTELLIGENCE_EVALUATION_PROTOCOL_SHA256,
    martManifestIdentity,
    martArtifactIdentity: martManifest.artifact_identity,
    receiptSha256: protocol.exact_input_gate.receipt_sha256,
    protocol,
    report,
  });
  validateModelEvaluationReport(report, {
    protocol,
    martManifest,
    martManifestIdentity,
    checkpoint,
  });
  if (stableSerialization(manifest.promotion) !== stableSerialization(report.promotion)) {
    throw new Error('Area Intelligence evaluation manifest promotion drifted from its report.');
  }
  if (servingArtifact) validateAreaIntelligenceEvaluationServingArtifact(servingArtifact, {
    report, protocol, martManifest, martManifestIdentity, checkpoint,
  });
  assertFiniteJsonValue(manifest, 'Area Intelligence evaluation manifest');
  assertAggregateOnlyArtifact(manifest, 'Area Intelligence evaluation manifest');
  return true;
}

function validateDiagnosticRow(row, label) {
  if (typeof row?.passed !== 'boolean'
    || !Array.isArray(row.failures)
    || new Set(row.failures).size !== row.failures.length
    || row.passed !== (row.failures.length === 0)) {
    throw new Error(`ModelEvaluationReport ${label} pass/failure state is invalid.`);
  }
}

function assertExactKeySequence(actual, expected, label) {
  if (actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} set, uniqueness, or stable ordering is invalid.`);
  }
}

function allAuthorityFalse(value) {
  return value
    && stableSerialization(Object.keys(value)) === stableSerialization(AUTHORITY_KEYS)
    && Object.values(value).every((entry) => entry === false);
}

function isAggregateOnlyPrivacy(value) {
  return value
    && stableSerialization(Object.keys(value)) === stableSerialization(PRIVACY_KEYS)
    && value.aggregate_only === true
    && Object.entries(value).every(([key, entry]) => key === 'aggregate_only' || entry === false);
}

function assertFiniteJsonValue(value, label, seen = new Set()) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`${label} contains a non-finite number.`);
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) assertFiniteJsonValue(child, label, seen);
}

function assertAggregateOnlyArtifact(value, label, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  const forbiddenKeys = new Set([
    'event_id', 'event_ids', 'source_record_id', 'source_record_ids',
    'coordinate', 'coordinates', 'latitude', 'longitude', 'raw_row', 'raw_rows',
    'canonical_event', 'canonical_events',
  ]);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error(`${label} violates the aggregate-only privacy contract.`);
    assertAggregateOnlyArtifact(child, label, seen);
  }
}

async function scanMartUnits(martRoot, manifest, martInventory, callback) {
  const inventory = new Map(martInventory.parts.map((part) => [part.path, part]));
  for (const part of manifest.parts) {
    const partPath = path.resolve(martRoot, ...part.path.split('/'));
    if (!isInside(martRoot, partPath)) throw new Error('Area Intelligence mart part path escaped the mart root.');
    await assertMartPartUnchanged(partPath, inventory.get(part.path));
    const input = readline.createInterface({ input: createReadStream(partPath, 'utf8'), crlfDelay: Infinity });
    let currentUnit = null;
    let rows = [];
    for await (const line of input) {
      if (!line) continue;
      const row = JSON.parse(line);
      validateMartRow(row, part.unit_type);
      if (currentUnit != null && row.unit_id !== currentUnit) {
        await callback(buildSeries(rows, manifest));
        rows = [];
      }
      currentUnit = row.unit_id;
      rows.push(row);
    }
    if (rows.length) await callback(buildSeries(rows, manifest));
    await assertMartPartUnchanged(partPath, inventory.get(part.path));
  }
}

function buildSeries(rows, manifest) {
  const first = rows[0];
  const completeEnd = manifest.evaluation_complete_week_end_exclusive;
  const admittedRows = rows.filter((row) => row.week_start < completeEnd);
  if (!admittedRows.length) {
    return {
      unit_type: first.unit_type,
      unit_id: first.unit_id,
      spatial_block_id: first.spatial_block_id,
      start: completeEnd,
      counts: new Int32Array(0),
      categories: {},
      acs_estimate: null,
      acs_moe90: null,
    };
  }
  const start = admittedRows[0].week_start;
  const length = weekDifference(start, completeEnd);
  const counts = new Int32Array(length);
  const categoryNames = first.unit_type === 'tract' ? ['person', 'property', 'vehicle', 'financial', 'public_order', 'other'] : [];
  const categories = Object.fromEntries(categoryNames.map((name) => [name, new Int32Array(length)]));
  let acsEstimate = null;
  let acsMoe90 = null;
  for (const row of admittedRows) {
    if (row.spatial_block_id !== first.spatial_block_id) throw new Error(`Mart block drift for ${row.unit_id}.`);
    const index = weekDifference(start, row.week_start);
    if (index < 0 || index >= length) throw new Error(`Mart week is outside dense series coverage for ${row.unit_id}.`);
    counts[index] = row.reported_incident_count;
    for (const [category, value] of Object.entries(row.category_counts)) {
      if (categories[category]) categories[category][index] = value;
    }
    if (Number.isFinite(row.acs?.estimate)) acsEstimate = row.acs.estimate;
    if (Number.isFinite(row.acs?.moe90)) acsMoe90 = row.acs.moe90;
  }
  return {
    unit_type: first.unit_type,
    unit_id: first.unit_id,
    spatial_block_id: first.spatial_block_id,
    start,
    counts,
    categories,
    acs_estimate: acsEstimate,
    acs_moe90: acsMoe90,
  };
}

function seriesCounts(series, category) {
  return category === 'all' ? series.counts : series.categories[category];
}

function visitFoldWeeks(series, counts, start, endExclusive, visitor) {
  if (!counts?.length) return;
  const startIndex = Math.max(52, weekDifference(series.start, start));
  const endIndex = Math.min(counts.length, weekDifference(series.start, endExclusive));
  for (let index = Math.max(0, startIndex); index < endIndex; index += 1) {
    visitor({ index, actual: counts[index], weekStart: addWeeks(series.start, index) });
  }
}

function meanForRange(series, counts, start, endExclusive) {
  let sum = 0;
  let observations = 0;
  visitFoldWeeks(series, counts, start, endExclusive, ({ actual }) => {
    sum += actual;
    observations += 1;
  });
  return observations ? sum / observations : 0;
}

function weekDifference(start, end) {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const difference = (endMs - startMs) / WEEK_MS;
  if (!Number.isInteger(difference)) throw new Error(`Area Intelligence week boundary is not Monday-aligned: ${start} -> ${end}`);
  return difference;
}

function validateMartRow(row, expectedUnitType) {
  if (row?.schema !== 'engagement-area-intelligence-unit-week/v1'
    || row.unit_type !== expectedUnitType
    || typeof row.unit_id !== 'string'
    || typeof row.spatial_block_id !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(row.week_start || '')
    || !Number.isInteger(row.reported_incident_count) || row.reported_incident_count < 1
    || !row.category_counts || typeof row.category_counts !== 'object'
    || !Array.isArray(row.source_snapshot_indexes)) {
    throw new Error('Area Intelligence mart row failed its serving-safe feature contract.');
  }
  const categoryTotal = Object.values(row.category_counts).reduce((sum, value) => sum + Number(value || 0), 0);
  if (categoryTotal !== row.reported_incident_count) {
    throw new Error('Area Intelligence mart category counts do not sum to the admitted reported-incident count.');
  }
}

async function validateExactMartFiles(martRoot, manifest) {
  const declaredPaths = new Set();
  const parts = [];
  for (const part of manifest.parts) {
    if (typeof part?.path !== 'string'
      || !/^marts\/(tract|fixed-grid)\/part-\d{3}\.jsonl$/.test(part.path)
      || part.path !== `marts/${part.unit_type}/part-${String(part.partition).padStart(3, '0')}.jsonl`
      || declaredPaths.has(part.path)
      || !Number.isSafeInteger(part.row_count) || part.row_count < 0
      || !Number.isSafeInteger(part.bytes) || part.bytes < 0
      || !/^[a-f0-9]{64}$/.test(part.sha256 || '')) {
      throw new Error('Area Intelligence mart part binding is invalid or duplicated.');
    }
    declaredPaths.add(part.path);
    const partPath = path.resolve(martRoot, ...part.path.split('/'));
    if (!isInside(martRoot, partPath)) throw new Error('Area Intelligence mart part path escaped the mart root.');
    const observed = await inspectMartFile(partPath);
    if (observed.row_count !== part.row_count
      || observed.bytes !== part.bytes
      || observed.sha256 !== part.sha256) {
      throw new Error(`Area Intelligence mart part rows, bytes, or SHA-256 drifted: ${part.path}.`);
    }
    parts.push({ ...part, mtime_ms: observed.mtime_ms });
  }
  const actualPaths = await listMartPartPaths(path.join(martRoot, 'marts'), martRoot);
  if (stableSerialization([...declaredPaths].sort()) !== stableSerialization(actualPaths)) {
    throw new Error('Area Intelligence actual mart part set does not match the manifest.');
  }
  const rowCount = parts.reduce((sum, part) => sum + part.row_count, 0);
  const bytes = parts.reduce((sum, part) => sum + part.bytes, 0);
  const partBindingsIdentity = identityOf(parts.map((part) => ({
    path: part.path,
    unit_type: part.unit_type,
    partition: part.partition,
    row_count: part.row_count,
    bytes: part.bytes,
    sha256: part.sha256,
  })));
  if (rowCount !== manifest.row_count
    || bytes !== manifest.bytes
    || partBindingsIdentity !== manifest.part_bindings_identity) {
    throw new Error('Area Intelligence mart aggregate rows, bytes, or part bindings drifted.');
  }
  return { parts, row_count: rowCount, bytes, part_bindings_identity: partBindingsIdentity };
}

async function inspectMartFile(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Area Intelligence mart part is not a real file.');
  const hash = createHash('sha256');
  let bytes = 0;
  let rowCount = 0;
  const source = createReadStream(filePath);
  source.on('data', (chunk) => {
    hash.update(chunk);
    bytes += chunk.length;
  });
  const input = readline.createInterface({ input: source, crlfDelay: Infinity });
  for await (const line of input) if (line) rowCount += 1;
  return { row_count: rowCount, bytes, sha256: hash.digest('hex'), mtime_ms: stat.mtimeMs };
}

async function listMartPartPaths(directory, martRoot) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Area Intelligence mart tree contains a symbolic link.');
    if (entry.isDirectory()) result.push(...await listMartPartPaths(absolute, martRoot));
    else if (entry.isFile() && /^part-\d{3}\.jsonl$/.test(entry.name)) {
      result.push(path.relative(martRoot, absolute).replaceAll('\\', '/'));
    }
  }
  return result.sort();
}

function validateMartArtifactIdentity(manifest) {
  const core = structuredClone(manifest);
  delete core.artifact_identity;
  delete core.generated_at;
  if (manifest.artifact_identity !== identityOf(core)) {
    throw new Error('Area Intelligence mart artifact identity drifted from its manifest fields.');
  }
}

async function assertMartPartUnchanged(filePath, expected) {
  const stat = await fs.lstat(filePath);
  if (!expected || !stat.isFile() || stat.isSymbolicLink()
    || stat.size !== expected.bytes || stat.mtimeMs !== expected.mtime_ms) {
    throw new Error(`Area Intelligence mart part changed after exact validation: ${expected?.path || filePath}.`);
  }
}

async function assertMartInventoryUnchanged(martRoot, manifest, martInventory) {
  const actualPaths = await listMartPartPaths(path.join(martRoot, 'marts'), martRoot);
  if (stableSerialization(actualPaths) !== stableSerialization(martInventory.parts.map(({ path: partPath }) => partPath).sort())) {
    throw new Error('Area Intelligence mart part set changed after exact validation.');
  }
  for (const part of martInventory.parts) {
    await assertMartPartUnchanged(path.resolve(martRoot, ...part.path.split('/')), part);
  }
  if (manifest.part_bindings_identity !== martInventory.part_bindings_identity) {
    throw new Error('Area Intelligence mart binding identity changed after exact validation.');
  }
}

function validateMartManifest(manifest, protocol, protocolIdentity) {
  if (manifest?.schema !== MART_SCHEMA
    || manifest.protocol?.schema !== PROTOCOL_SCHEMA
    || manifest.protocol?.sha256 !== protocolIdentity
    || manifest.protocol?.receipt_sha256 !== protocol.exact_input_gate.receipt_sha256
    || manifest.protocol?.frozen_before_model_performance !== true
    || manifest.exact_input?.receipt_schema !== protocol.exact_input_gate.receipt_schema
    || manifest.exact_input?.receipt_identity !== protocol.exact_input_gate.receipt_identity
    || manifest.exact_input?.receipt_sha256 !== protocol.exact_input_gate.receipt_sha256
    || manifest.exact_input?.canonical?.row_count !== manifest.admission?.canonical_rows_seen
    || manifest.exact_input?.counts?.canonical_rows !== manifest.admission?.canonical_rows_seen
    || manifest.admission?.tract?.admitted + manifest.admission?.tract?.ambiguous_excluded
      + manifest.admission?.tract?.unmapped_excluded !== manifest.admission?.canonical_rows_seen
    || manifest.admission?.['fixed-grid']?.admitted + manifest.admission?.['fixed-grid']?.unavailable_excluded
      !== manifest.admission?.canonical_rows_seen
    || manifest.admission?.unknown_category !== 0
    || manifest.admission?.invalid_event_time !== 0
    || manifest.admission?.non_active !== 0
    || !Array.isArray(manifest.parts) || manifest.parts.length === 0
    || manifest.artifact_policy?.event_level_data_included !== false) {
    throw new Error('Area Intelligence mart manifest failed the frozen evaluation gate.');
  }
}

async function loadOrCreateCheckpoint(checkpointPath, options) {
  const existing = await readJsonIfExists(checkpointPath);
  if (existing) {
    try {
      validateAreaIntelligenceEvaluationCheckpoint(existing, {
        protocolIdentity: options.protocolIdentity,
        martManifestIdentity: options.martManifestIdentity,
        martArtifactIdentity: options.martArtifactIdentity,
        receiptSha256: options.protocol.exact_input_gate.receipt_sha256,
        protocol: options.protocol,
      });
    } catch {
      throw new Error('Area Intelligence evaluation checkpoint belongs to a different exact mart or protocol.');
    }
    return existing;
  }
  const checkpoint = {
    schema: CHECKPOINT_SCHEMA,
    status: 'fitting',
    mart_manifest_sha256: options.martManifestIdentity,
    mart_artifact_identity: options.martArtifactIdentity,
    protocol_schema: options.protocol.schema,
    protocol_sha256: options.protocolIdentity,
    receipt_sha256: options.protocol.exact_input_gate.receipt_sha256,
    poisson_iterations_completed: 0,
    dispersion_completed: false,
    nb_iterations_completed: 0,
    baseline_intervals_completed: false,
    states: serializeStates(createStates(options.protocol)),
    created_at: exactNow(options.now),
    updated_at: exactNow(options.now),
    resume: 'Re-run the identical command with the same exact mart, output root, and frozen protocol.',
  };
  validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
    protocolIdentity: options.protocolIdentity,
    martManifestIdentity: options.martManifestIdentity,
    martArtifactIdentity: options.martArtifactIdentity,
    receiptSha256: options.protocol.exact_input_gate.receipt_sha256,
    protocol: options.protocol,
  });
  await writeJsonAtomic(checkpointPath, checkpoint);
  return checkpoint;
}

async function validateExistingEvaluation(manifest, outputRoot, {
  martManifestIdentity,
  protocolIdentity,
  protocol,
  martManifest,
  martInventory,
}) {
  if (manifest?.promotion?.status !== 'not-promoted') return false;
  const expectedAvailability = 'unavailable';
  const expectedLineageSeam = buildEvaluationLineageSeam({
    protocol: { schema: PROTOCOL_SCHEMA },
    protocolIdentity,
    martManifest,
    martManifestIdentity,
    martInventory,
    promotion: manifest.promotion,
    availability: expectedAvailability,
  });
  if (manifest?.schema !== EVALUATION_MANIFEST_SCHEMA
    || manifest.mart_manifest_sha256 !== martManifestIdentity
    || manifest.protocol_sha256 !== protocolIdentity
    || manifest.mart_artifact_identity !== martManifest.artifact_identity
    || manifest.availability !== expectedAvailability
    || stableSerialization(manifest.lineage_seam) !== stableSerialization(expectedLineageSeam)
    || !Array.isArray(manifest.artifacts)) return false;
  for (const artifact of manifest.artifacts) {
    const filePath = path.join(outputRoot, artifact.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size !== artifact.bytes || await hashFile(filePath) !== artifact.sha256) return false;
  }
  try {
    const report = JSON.parse(await fs.readFile(path.join(outputRoot, 'model-evaluation-report.json'), 'utf8'));
    const servingArtifact = JSON.parse(await fs.readFile(path.join(outputRoot, 'serving-artifact.json'), 'utf8'));
    const checkpoint = JSON.parse(await fs.readFile(path.join(outputRoot, 'checkpoint.json'), 'utf8'));
    if (checkpoint.status !== 'complete') return false;
    validateAreaIntelligenceEvaluationManifest(manifest, {
      protocol,
      martManifest,
      martManifestIdentity,
      martInventory,
      report,
      servingArtifact,
      checkpoint,
    });
    validateAreaIntelligenceEvaluationCheckpoint(checkpoint, {
      protocolIdentity,
      martManifestIdentity,
      martArtifactIdentity: martManifest.artifact_identity,
      receiptSha256: protocol.exact_input_gate.receipt_sha256,
      protocol,
      report,
    });
  } catch {
    return false;
  }
  return true;
}

function buildEvaluationLineageSeam({
  protocol,
  protocolIdentity,
  martManifest,
  martManifestIdentity,
  martInventory,
  promotion,
  availability,
}) {
  return {
    schema: LINEAGE_SEAM_SCHEMA,
    protocol: {
      schema: protocol.schema,
      sha256: protocolIdentity,
    },
    mart: {
      schema: martManifest.schema,
      manifest_sha256: martManifestIdentity,
      artifact_identity: martManifest.artifact_identity,
      part_bindings_identity: martInventory.part_bindings_identity,
      part_count: martInventory.parts.length,
      row_count: martInventory.row_count,
      bytes: martInventory.bytes,
      parts: martInventory.parts.map((part) => ({
        path: part.path,
        unit_type: part.unit_type,
        partition: part.partition,
        row_count: part.row_count,
        bytes: part.bytes,
        sha256: part.sha256,
      })),
    },
    m1_receipt: {
      schema: martManifest.exact_input.receipt_schema,
      identity: martManifest.exact_input.receipt_identity,
      sha256: martManifest.exact_input.receipt_sha256,
    },
    outcome: {
      promotion_status: promotion?.status,
      selected_model: promotion?.selected_model ?? null,
      availability,
    },
  };
}

function stripSums(rows) {
  return rows.map(({ _sums, ...row }) => row);
}

function format(value) {
  return Number.isFinite(value) ? value.toFixed(4) : '—';
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function writeJsonAtomic(destination, value) {
  await writeTextAtomic(destination, serializeJson(value, 'JSON artifact'));
}

function serializeJson(value, label) {
  assertFiniteJsonValue(value, label);
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeTextAtomic(destination, contents) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, 'utf8');
  await fs.rename(temporary, destination);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identityOf(value) {
  return `sha256:${sha256(Buffer.from(stableSerialization(value)))}`;
}

function exactNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Area Intelligence evaluation clock returned an invalid Date.');
  return value.toISOString();
}
