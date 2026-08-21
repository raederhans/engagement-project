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

const EVALUATION_SCHEMA = 'ModelEvaluationReport/v1';
const EVALUATION_MANIFEST_SCHEMA = 'engagement-area-intelligence-evaluation-run/v1';
const CHECKPOINT_SCHEMA = 'engagement-area-intelligence-evaluation-checkpoint/v1';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BASELINE_MODELS = ['seasonal-naive-52w', 'moving-average-4w', 'moving-average-13w'];
const COUNT_MODELS = ['poisson-log-link-v1', 'negative-binomial-log-link-v1'];
const ALL_MODELS = [...BASELINE_MODELS, ...COUNT_MODELS];

export async function evaluateAreaIntelligence({
  martRoot,
  outputRoot,
  protocolPath,
  now = () => new Date(),
  onProgress = () => {},
} = {}) {
  const resolvedMartRoot = path.resolve(martRoot || '');
  const resolvedOutput = assertOwnedOutputRoot(outputRoot);
  const protocolBytes = await fs.readFile(protocolPath);
  const protocol = JSON.parse(protocolBytes.toString('utf8'));
  const protocolIdentity = sha256(protocolBytes);
  validateProtocol(protocol);
  const martManifestBytes = await fs.readFile(path.join(resolvedMartRoot, 'manifest.json'));
  const martManifest = JSON.parse(martManifestBytes.toString('utf8'));
  validateMartManifest(martManifest, protocolIdentity);
  const martManifestIdentity = sha256(martManifestBytes);

  const existing = await readJsonIfExists(path.join(resolvedOutput, 'manifest.json'));
  if (existing) {
    if (await validateExistingEvaluation(existing, resolvedOutput, martManifestIdentity, protocolIdentity)) {
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
    await scanMartUnits(resolvedMartRoot, martManifest, (series) => {
      accumulateFitSeries(series, states, accumulators, 'poisson');
    });
    for (const [key, state] of states) {
      const result = solveIrls(accumulators.get(key), state.poisson_beta, { coefficientLimit: 12 });
      state.poisson_beta = result.beta;
      state.poisson_fit_observations = result.observations;
      state.poisson_last_change = result.changed;
      state.poisson_singular = Boolean(result.singular);
    }
    checkpoint.poisson_iterations_completed += 1;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'poisson-fit', iteration: checkpoint.poisson_iterations_completed, iterations: poissonIterations });
    if ([...states.values()].every((state) => state.poisson_last_change < 1e-7)) break;
  }

  if (!checkpoint.dispersion_completed) {
    const accumulators = new Map([...states].map(([key]) => [key, createDispersionAccumulator()]));
    await scanMartUnits(resolvedMartRoot, martManifest, (series) => {
      accumulateDispersionSeries(series, states, accumulators);
    });
    for (const [key, state] of states) {
      state.alpha = finalizeDispersion(accumulators.get(key));
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
    await scanMartUnits(resolvedMartRoot, martManifest, (series) => {
      accumulateFitSeries(series, states, accumulators, 'negative-binomial');
    });
    for (const [key, state] of states) {
      const result = solveIrls(accumulators.get(key), state.nb_beta, { coefficientLimit: 12 });
      state.nb_beta = result.beta;
      state.nb_fit_observations = result.observations;
      state.nb_last_change = result.changed;
      state.nb_singular = Boolean(result.singular);
    }
    checkpoint.nb_iterations_completed += 1;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'negative-binomial-fit', iteration: checkpoint.nb_iterations_completed, iterations: nbIterations });
    if ([...states.values()].every((state) => state.nb_last_change < 1e-7)) break;
  }

  if (!checkpoint.baseline_intervals_completed) {
    const histograms = new Map();
    for (const [key] of states) {
      for (const model of BASELINE_MODELS) histograms.set(`${key}|${model}`, createResidualHistogram());
    }
    await scanMartUnits(resolvedMartRoot, martManifest, (series) => {
      accumulateBaselineResiduals(series, states, histograms);
    });
    for (const [key, state] of states) {
      state.baseline_interval_radii = Object.fromEntries(BASELINE_MODELS.map((model) => [
        model,
        residualQuantile(histograms.get(`${key}|${model}`), 0.9),
      ]));
    }
    checkpoint.baseline_intervals_completed = true;
    checkpoint.states = serializeStates(states);
    checkpoint.updated_at = exactNow(now);
    await writeJsonAtomic(checkpointPath, checkpoint);
    onProgress({ phase: 'baseline-interval-fit' });
  }

  const metrics = createMetricCollections();
  await scanMartUnits(resolvedMartRoot, martManifest, (series) => {
    evaluateSeries(series, states, protocol, metrics);
  });
  const finalized = finalizeMetricCollections(metrics);
  const promotion = evaluatePromotion(finalized, protocol);
  const generatedAt = exactNow(now);
  const selectedAuditModel = promotion.selected_model || selectBestAuditModel(finalized.aggregate);
  const forecasts = promotion.status === 'promoted'
    ? await buildPromotedForecasts(resolvedMartRoot, martManifest, states, promotion.selected_model, generatedAt)
    : [];

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
  validateModelEvaluationReport(report);
  const residualMap = buildResidualMap(finalized.block, selectedAuditModel, promotion, martManifest, generatedAt);
  const biasAudit = buildBiasAudit(finalized, selectedAuditModel, promotion, generatedAt);
  const lineageSummary = buildLineageSummary(martManifest, martManifestIdentity, protocolIdentity, generatedAt);
  const servingArtifact = buildServingArtifact({
    report,
    forecasts,
    selectedAuditModel,
    generatedAt,
  });
  const modelCard = buildModelCard({ report, selectedAuditModel });
  const modelState = buildModelState(states, protocolIdentity, martManifestIdentity, generatedAt);

  const artifacts = {
    'model-evaluation-report.json': `${JSON.stringify(report, null, 2)}\n`,
    'residual-map.json': `${JSON.stringify(residualMap, null, 2)}\n`,
    'bias-error-audit.json': `${JSON.stringify(biasAudit, null, 2)}\n`,
    'data-lineage-summary.json': `${JSON.stringify(lineageSummary, null, 2)}\n`,
    'serving-artifact.json': `${JSON.stringify(servingArtifact, null, 2)}\n`,
    'model-state.json': `${JSON.stringify(modelState, null, 2)}\n`,
    'model-card.md': modelCard,
  };
  const artifactRecords = [];
  for (const [name, contents] of Object.entries(artifacts)) {
    const destination = path.join(resolvedOutput, name);
    await writeTextAtomic(destination, contents);
    artifactRecords.push({ name, bytes: Buffer.byteLength(contents), sha256: sha256(Buffer.from(contents)) });
  }
  artifactRecords.sort((left, right) => left.name.localeCompare(right.name));
  const evaluationManifest = {
    schema: EVALUATION_MANIFEST_SCHEMA,
    protocol_sha256: protocolIdentity,
    mart_manifest_sha256: martManifestIdentity,
    mart_artifact_identity: martManifest.artifact_identity,
    promotion,
    selected_audit_model: selectedAuditModel,
    artifacts: artifactRecords,
    generated_at: generatedAt,
    identity_meaning: 'Artifact byte identity only; model correctness is established by the frozen evaluation protocol and reported metrics, not this identity.',
  };
  await writeJsonAtomic(path.join(resolvedOutput, 'manifest.json'), evaluationManifest);
  checkpoint.status = 'complete';
  checkpoint.updated_at = generatedAt;
  await writeJsonAtomic(checkpointPath, checkpoint);
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
          alpha: 0.000001,
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

function evaluateSeries(series, states, protocol, metrics) {
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
        const interval = baselineIntervalOrDistribution(state, model, predicted);
        const observation = { actual, predicted, interval, alpha: state.alpha };
        if (state.category === 'all') {
          addMetric(metrics.primary, {
            model, fold: state.fold.id, unit_type: state.unit_type, holdout_slice: holdoutSlice,
          }, observation);
          addMetric(metrics.volume, {
            model, fold: state.fold.id, unit_type: state.unit_type, holdout_slice: holdoutSlice, data_volume_band: volume,
          }, observation);
          addMetric(metrics.block, {
            model, unit_type: state.unit_type, spatial_block_id: series.spatial_block_id,
          }, observation);
          const year = Number(weekStart.slice(0, 4));
          if (state.unit_type === 'tract' && year >= 2020 && year <= 2024 && Number.isFinite(series.acs_estimate)) {
            addMetric(metrics.acs_population, {
              model, fold: state.fold.id, holdout_slice: holdoutSlice, population_band: populationBand(series.acs_estimate),
            }, observation);
          }
        } else {
          addMetric(metrics.category, {
            model, fold: state.fold.id, category: state.category, holdout_slice: holdoutSlice,
          }, observation);
        }
      }
    });
  }
}

function baselineIntervalOrDistribution(state, model, predicted) {
  if (BASELINE_MODELS.includes(model)) {
    return empiricalInterval(predicted, state.baseline_interval_radii[model] || 0);
  }
  if (model === 'poisson-log-link-v1') return poissonInterval(predicted, 0.9);
  return negativeBinomialInterval(predicted, state.alpha, 0.9);
}

function addMetric(collection, descriptor, observation) {
  const key = Object.entries(descriptor).map(([name, value]) => `${name}=${value}`).join('|');
  if (!collection.values.has(key)) {
    collection.values.set(key, createMetricAccumulator());
    collection.descriptors.set(key, descriptor);
  }
  accumulateMetric(collection.values.get(key), observation);
}

function finalizeMetricCollections(collections) {
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
  output.aggregate = aggregatePrimary(output.primary);
  return output;
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

export function evaluatePromotion(finalized, protocol) {
  const gate = protocol.promotion_gate;
  const candidates = [];
  for (const model of gate.eligible_models) {
    const reasons = [];
    const primary = finalized.primary.filter((row) => row.model === model);
    const expectedPrimarySlices = protocol.rolling_folds.length * 2 * protocol.spatial_holdout.report_slices.length;
    if (primary.length !== expectedPrimarySlices) reasons.push(`expected-${expectedPrimarySlices}-primary-slices-received-${primary.length}`);
    for (const row of primary) {
      const label = `${row.fold}/${row.unit_type}/${row.holdout_slice}`;
      if (row.observations < gate.minimum_observations_per_primary_slice) reasons.push(`${label}:insufficient-observations`);
      if (!(row.relative_mae_gain_vs_seasonal_naive >= gate.minimum_relative_mae_gain_each_fold_unit_and_holdout_slice)) reasons.push(`${label}:mae-gain-below-gate`);
      const [minimumCoverage, maximumCoverage] = gate.acceptable_interval_coverage_inclusive;
      if (!(row.prediction_interval_90_coverage >= minimumCoverage && row.prediction_interval_90_coverage <= maximumCoverage)) reasons.push(`${label}:interval-coverage-outside-gate`);
      if (![row.poisson_deviance, row.negative_binomial_deviance].every(Number.isFinite)) reasons.push(`${label}:non-finite-deviance`);
    }
    const aggregate = finalized.aggregate.find((row) => row.model === model);
    if (!(aggregate?.relative_mae_gain_vs_seasonal_naive >= gate.minimum_aggregate_relative_mae_gain)) reasons.push('aggregate-mae-gain-below-gate');
    for (const row of finalized.category.filter((entry) => entry.model === model)) {
      if (!(row.relative_mae_gain_vs_seasonal_naive >= -gate.maximum_category_mae_regression_vs_seasonal)) {
        reasons.push(`${row.fold}/${row.category}/${row.holdout_slice}:category-mae-regression`);
      }
    }
    candidates.push({
      model,
      passed: reasons.length === 0,
      aggregate_relative_mae_gain: aggregate?.relative_mae_gain_vs_seasonal_naive ?? null,
      reasons: [...new Set(reasons)].sort(),
    });
  }
  const passing = candidates.filter((candidate) => candidate.passed)
    .sort((left, right) => right.aggregate_relative_mae_gain - left.aggregate_relative_mae_gain);
  return {
    status: passing.length ? 'promoted' : 'not-promoted',
    selected_model: passing[0]?.model || null,
    failure_result: passing.length ? null : gate.failure_result,
    candidates,
    gate: structuredClone(gate),
  };
}

function selectBestAuditModel(aggregate) {
  return aggregate
    .filter((row) => COUNT_MODELS.includes(row.model) && Number.isFinite(row.relative_mae_gain_vs_seasonal_naive))
    .sort((left, right) => right.relative_mae_gain_vs_seasonal_naive - left.relative_mae_gain_vs_seasonal_naive)[0]?.model
    || 'negative-binomial-log-link-v1';
}

async function buildPromotedForecasts(martRoot, manifest, states, model, generatedAt) {
  const latestFold = [...new Set([...states.values()].map((state) => state.fold.id))].at(-1);
  const state = states.get(stateKey(latestFold, 'tract', 'all'));
  const forecasts = [];
  await scanMartUnits(martRoot, manifest, (series) => {
    if (series.unit_type !== 'tract') return;
    const index = series.counts.length;
    const features = featureVector(series.counts, index, manifest.evaluation_complete_week_end_exclusive);
    if (!features) return;
    const predicted = model === 'poisson-log-link-v1'
      ? linearPrediction(state.poisson_beta, features).mean
      : linearPrediction(state.nb_beta, features).mean;
    const interval = model === 'poisson-log-link-v1'
      ? poissonInterval(predicted, 0.9)
      : negativeBinomialInterval(predicted, state.alpha, 0.9);
    forecasts.push({
      unit_type: 'tract',
      unit_id: series.unit_id,
      target_week_start: manifest.evaluation_complete_week_end_exclusive,
      predicted_reported_incident_count: predicted,
      prediction_interval_90: { lower: interval.lower, upper: interval.upper },
      trained_through: state.fold.train_end_exclusive,
      feature_observed_through: manifest.evaluation_complete_week_end_exclusive,
      model_version: model,
      generated_at: generatedAt,
      source_vintage: manifest.exact_input.warehouse_current_snapshot_id,
      limitations: [
        'Modeled count of PPD reported incidents, not individual risk or absolute safety.',
        'One-week forecast inherits preliminary-data, reporting, revision, and spatial-generalization limits.',
      ],
    });
  });
  return forecasts.sort((left, right) => left.unit_id.localeCompare(right.unit_id));
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
    promotion,
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
    minimum_fit_observations: Math.min(...rows.map((row) => row.observations || 0)),
    maximum_last_coefficient_change: Math.max(...rows.map((row) => row.last_coefficient_change || 0)),
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

function buildServingArtifact({ report, forecasts, selectedAuditModel, generatedAt }) {
  const promoted = report.promotion.status === 'promoted';
  return {
    schema: 'engagement-area-intelligence-serving/v1',
    generated_at: generatedAt,
    status: promoted ? 'promoted' : 'not-promoted',
    historical_evidence: {
      status: 'available',
      measure: 'PPD reported incidents',
      coverage: report.data.coverage,
      source_vintage: report.data.source_vintage,
      limitations: report.limitations.slice(0, 2),
    },
    forecast: promoted ? {
      status: 'available',
      model_version: report.promotion.selected_model,
      predictions: forecasts,
    } : {
      status: 'unavailable',
      reason: 'model-did-not-exceed-predefined-seasonal-baseline',
      predictions: [],
    },
    evaluation: {
      promotion_status: report.promotion.status,
      selected_model: report.promotion.selected_model,
      audit_model: selectedAuditModel,
      protocol_sha256: report.protocol.sha256,
    },
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
    report.promotion.status === 'promoted'
      ? `The frozen gate promoted \`${report.promotion.selected_model}\` for one-week tract forecasts.`
      : 'No count model passed every pre-defined temporal, spatial, interval-coverage, and category gate. Product serving remains historical-only and forecast is explicitly unavailable.',
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

export function validateModelEvaluationReport(report) {
  if (report?.schema !== EVALUATION_SCHEMA
    || report.protocol?.frozen_before_model_performance !== true
    || !Array.isArray(report.metrics?.primary_by_fold_space_holdout)
    || !Array.isArray(report.metrics?.by_category)
    || !Array.isArray(report.metrics?.by_data_volume)
    || !['promoted', 'not-promoted'].includes(report.promotion?.status)) {
    throw new Error('ModelEvaluationReport failed its machine-checkable contract.');
  }
  const required = ['mae', 'poisson_deviance', 'negative_binomial_deviance', 'prediction_interval_90_coverage', 'relative_mae_gain_vs_seasonal_naive'];
  for (const row of report.metrics.primary_by_fold_space_holdout) {
    if (required.some((field) => row[field] == null || !Number.isFinite(row[field]))) {
      throw new Error(`ModelEvaluationReport primary metric is missing or non-finite for ${row.model}/${row.fold}.`);
    }
  }
  return true;
}

async function scanMartUnits(martRoot, manifest, callback) {
  for (const part of manifest.parts) {
    const partPath = path.resolve(martRoot, ...part.path.split('/'));
    if (!isInside(martRoot, partPath)) throw new Error('Area Intelligence mart part path escaped the mart root.');
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

function validateMartManifest(manifest, protocolIdentity) {
  if (manifest?.schema !== 'engagement-area-intelligence-feature-mart/v1'
    || manifest.protocol?.sha256 !== protocolIdentity
    || manifest.protocol?.frozen_before_model_performance !== true
    || manifest.admission?.canonical_rows_seen !== 3583548
    || manifest.admission?.tract?.ambiguous_excluded !== 549594
    || !Array.isArray(manifest.parts) || manifest.parts.length === 0
    || manifest.artifact_policy?.event_level_data_included !== false) {
    throw new Error('Area Intelligence mart manifest failed the frozen evaluation gate.');
  }
}

function validateProtocol(protocol) {
  if (protocol?.schema !== 'engagement-area-intelligence-evaluation-protocol/v1'
    || protocol.frozen_before_model_performance !== true
    || protocol.rolling_folds?.length !== 4
    || protocol.models?.length !== 5) {
    throw new Error('Area Intelligence evaluation protocol is invalid.');
  }
}

async function loadOrCreateCheckpoint(checkpointPath, options) {
  const existing = await readJsonIfExists(checkpointPath);
  if (existing) {
    if (existing.schema !== CHECKPOINT_SCHEMA
      || existing.mart_manifest_sha256 !== options.martManifestIdentity
      || existing.mart_artifact_identity !== options.martArtifactIdentity
      || existing.protocol_sha256 !== options.protocolIdentity) {
      throw new Error('Area Intelligence evaluation checkpoint belongs to a different exact mart or protocol.');
    }
    return existing;
  }
  const checkpoint = {
    schema: CHECKPOINT_SCHEMA,
    status: 'fitting',
    mart_manifest_sha256: options.martManifestIdentity,
    mart_artifact_identity: options.martArtifactIdentity,
    protocol_sha256: options.protocolIdentity,
    poisson_iterations_completed: 0,
    dispersion_completed: false,
    nb_iterations_completed: 0,
    baseline_intervals_completed: false,
    states: serializeStates(createStates(options.protocol)),
    created_at: exactNow(options.now),
    updated_at: exactNow(options.now),
    resume: 'Re-run the identical command with the same exact mart, output root, and frozen protocol.',
  };
  await writeJsonAtomic(checkpointPath, checkpoint);
  return checkpoint;
}

async function validateExistingEvaluation(manifest, outputRoot, martManifestIdentity, protocolIdentity) {
  if (manifest?.schema !== EVALUATION_MANIFEST_SCHEMA
    || manifest.mart_manifest_sha256 !== martManifestIdentity
    || manifest.protocol_sha256 !== protocolIdentity
    || !Array.isArray(manifest.artifacts)) return false;
  for (const artifact of manifest.artifacts) {
    const filePath = path.join(outputRoot, artifact.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size !== artifact.bytes || await hashFile(filePath) !== artifact.sha256) return false;
  }
  return true;
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

function assertOwnedOutputRoot(outputRoot) {
  const resolved = path.resolve(outputRoot || '');
  if (!isInside(process.cwd(), resolved) || !resolved.split(path.sep).includes('.dfev1')) {
    throw new Error('Area Intelligence evaluation output must be a task-owned .dfev1 directory inside the current worktree.');
  }
  return resolved;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function writeJsonAtomic(destination, value) {
  await writeTextAtomic(destination, `${JSON.stringify(value, null, 2)}\n`);
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

function exactNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Area Intelligence evaluation clock returned an invalid Date.');
  return value.toISOString();
}

function stableSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
