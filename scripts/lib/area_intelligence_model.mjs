import { createHash } from 'node:crypto';

const TWO_PI = 2 * Math.PI;
const EPSILON = 1e-9;

export function featureVector(counts, index, weekStart = null) {
  if (!(counts instanceof Int32Array || counts instanceof Float64Array || Array.isArray(counts)) || index < 52) return null;
  const lag52 = Number(counts[index - 52] || 0);
  const ma4 = trailingMean(counts, index, 4);
  const ma13 = trailingMean(counts, index, 13);
  const weekAngle = TWO_PI * calendarWeekFraction(weekStart, index);
  return [1, Math.log1p(lag52), Math.log1p(ma4), Math.log1p(ma13), Math.sin(weekAngle), Math.cos(weekAngle)];
}

function calendarWeekFraction(weekStart, fallbackIndex) {
  if (typeof weekStart !== 'string') return (fallbackIndex % 52) / 52;
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return (fallbackIndex % 52) / 52;
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return ((date.getTime() - start) / (365.2425 * 24 * 60 * 60 * 1000)) % 1;
}

export function baselinePredictions(counts, index) {
  if (index < 52) return null;
  return {
    'seasonal-naive-52w': Number(counts[index - 52] || 0),
    'moving-average-4w': trailingMean(counts, index, 4),
    'moving-average-13w': trailingMean(counts, index, 13),
  };
}

export function trailingMean(counts, index, window) {
  if (!Number.isInteger(window) || window < 1 || index < window) return 0;
  let sum = 0;
  for (let cursor = index - window; cursor < index; cursor += 1) sum += Number(counts[cursor] || 0);
  return sum / window;
}

export function linearPrediction(beta, features) {
  let eta = 0;
  for (let index = 0; index < features.length; index += 1) eta += beta[index] * features[index];
  eta = clamp(eta, -12, 12);
  return { eta, mean: Math.exp(eta) };
}

export function createIrlsAccumulator(size = 6) {
  return {
    matrix: Array.from({ length: size }, () => Array(size).fill(0)),
    vector: Array(size).fill(0),
    observations: 0,
    weight_sum: 0,
  };
}

export function accumulateIrls(accumulator, features, actual, beta, { alpha = 0 } = {}) {
  const { eta, mean } = linearPrediction(beta, features);
  const safeMean = Math.max(mean, EPSILON);
  const weight = safeMean / (1 + Math.max(0, alpha) * safeMean);
  const working = eta + (actual - safeMean) / safeMean;
  for (let row = 0; row < features.length; row += 1) {
    accumulator.vector[row] += weight * features[row] * working;
    for (let column = 0; column < features.length; column += 1) {
      accumulator.matrix[row][column] += weight * features[row] * features[column];
    }
  }
  accumulator.observations += 1;
  accumulator.weight_sum += weight;
}

export function solveIrls(accumulator, prior, { coefficientLimit = 12, ridge = 1e-6 } = {}) {
  if (accumulator.observations === 0) return { beta: [...prior], changed: 0, observations: 0 };
  const matrix = accumulator.matrix.map((row, index) => row.map((value, column) => (
    value + (index === column ? ridge : 0)
  )));
  const solved = solveLinearSystem(matrix, accumulator.vector);
  if (!solved || solved.some((value) => !Number.isFinite(value))) {
    return { beta: [...prior], changed: 0, observations: accumulator.observations, singular: true };
  }
  const beta = solved.map((value) => clamp(value, -coefficientLimit, coefficientLimit));
  return {
    beta,
    changed: Math.max(...beta.map((value, index) => Math.abs(value - prior[index]))),
    observations: accumulator.observations,
    singular: false,
  };
}

export function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-12) return null;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      if (factor === 0) continue;
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function createDispersionAccumulator() {
  return { numerator: 0, denominator: 0, observations: 0 };
}

export function accumulateDispersion(accumulator, actual, mean) {
  const safeMean = Math.max(mean, EPSILON);
  accumulator.numerator += ((actual - safeMean) ** 2) - actual;
  accumulator.denominator += safeMean ** 2;
  accumulator.observations += 1;
}

export function finalizeDispersion(accumulator, { minimum = 0.000001, maximum = 10 } = {}) {
  if (accumulator.observations === 0 || accumulator.denominator <= 0) return minimum;
  return clamp(accumulator.numerator / accumulator.denominator, minimum, maximum);
}

export function createResidualHistogram(maximum = 1000) {
  return { bins: new Uint32Array(maximum + 1), observations: 0, maximum };
}

export function accumulateResidualHistogram(histogram, actual, predicted) {
  const bin = Math.min(histogram.maximum, Math.ceil(Math.abs(actual - predicted)));
  histogram.bins[bin] += 1;
  histogram.observations += 1;
}

export function residualQuantile(histogram, probability = 0.9) {
  if (!histogram || histogram.observations === 0) return 0;
  const target = Math.ceil(histogram.observations * probability);
  let cumulative = 0;
  for (let index = 0; index < histogram.bins.length; index += 1) {
    cumulative += histogram.bins[index];
    if (cumulative >= target) return index;
  }
  return histogram.maximum;
}

export function empiricalInterval(mean, radius) {
  return {
    lower: Math.max(0, mean - radius),
    upper: mean + radius,
    nominal: 0.9,
    method: 'training-only-absolute-residual-90th-percentile',
  };
}

export function poissonInterval(mean, probability = 0.9) {
  const tail = (1 - probability) / 2;
  return {
    lower: poissonQuantile(mean, tail),
    upper: poissonQuantile(mean, 1 - tail),
    nominal: probability,
    method: 'poisson-central-interval',
  };
}

export function negativeBinomialInterval(mean, alpha, probability = 0.9) {
  if (alpha <= 0.0000015) return { ...poissonInterval(mean, probability), method: 'negative-binomial-poisson-limit-central-interval' };
  const tail = (1 - probability) / 2;
  return {
    lower: negativeBinomialQuantile(mean, alpha, tail),
    upper: negativeBinomialQuantile(mean, alpha, 1 - tail),
    nominal: probability,
    method: 'negative-binomial-nb2-central-interval',
  };
}

export function poissonQuantile(mean, probability) {
  if (!Number.isFinite(mean) || mean < 0 || probability < 0 || probability > 1) throw new Error('Invalid Poisson quantile input.');
  if (probability <= 0 || mean === 0) return 0;
  if (probability >= 1) return Math.ceil(mean + 12 * Math.sqrt(mean + 1));
  if (mean > 100) return Math.max(0, Math.floor(mean + inverseNormal(probability) * Math.sqrt(mean) + 0.5));
  let probabilityMass = Math.exp(-mean);
  let cumulative = probabilityMass;
  let value = 0;
  const maximum = Math.ceil(mean + 16 * Math.sqrt(mean + 1) + 100);
  while (cumulative < probability && value < maximum) {
    value += 1;
    probabilityMass *= mean / value;
    cumulative += probabilityMass;
  }
  return value;
}

export function negativeBinomialQuantile(mean, alpha, probability) {
  if (!Number.isFinite(mean) || mean < 0 || !Number.isFinite(alpha) || alpha <= 0 || probability < 0 || probability > 1) {
    throw new Error('Invalid negative-binomial quantile input.');
  }
  if (mean === 0 || probability <= 0) return 0;
  const variance = mean + alpha * mean * mean;
  if (mean > 200 || alpha * mean > 50) {
    return Math.max(0, Math.floor(mean + inverseNormal(probability) * Math.sqrt(variance) + 0.5));
  }
  const size = 1 / alpha;
  const success = size / (size + mean);
  let probabilityMass = success ** size;
  let cumulative = probabilityMass;
  let value = 0;
  const maximum = Math.ceil(mean + 20 * Math.sqrt(variance + 1) + 200);
  while (cumulative < probability && value < maximum) {
    probabilityMass *= ((value + size) / (value + 1)) * (1 - success);
    value += 1;
    cumulative += probabilityMass;
  }
  return value;
}

export function poissonDeviance(actual, mean) {
  const safeMean = Math.max(mean, EPSILON);
  if (actual === 0) return 2 * safeMean;
  return 2 * (actual * Math.log(actual / safeMean) - (actual - safeMean));
}

export function negativeBinomialDeviance(actual, mean, alpha) {
  if (alpha <= 0.0000015) return poissonDeviance(actual, mean);
  const safeMean = Math.max(mean, EPSILON);
  const size = 1 / alpha;
  const first = actual === 0 ? 0 : actual * Math.log(actual / safeMean);
  const second = (actual + size) * Math.log((actual + size) / (safeMean + size));
  return Math.max(0, 2 * (first - second));
}

export function createMetricAccumulator() {
  return {
    observations: 0,
    absolute_error_sum: 0,
    poisson_deviance_sum: 0,
    negative_binomial_deviance_sum: 0,
    interval_covered: 0,
    residual_sum: 0,
    actual_sum: 0,
    predicted_sum: 0,
    over_estimate_count: 0,
    under_estimate_count: 0,
  };
}

export function accumulateMetric(accumulator, { actual, predicted, interval, alpha }) {
  const residual = actual - predicted;
  accumulator.observations += 1;
  accumulator.absolute_error_sum += Math.abs(residual);
  accumulator.poisson_deviance_sum += poissonDeviance(actual, predicted);
  accumulator.negative_binomial_deviance_sum += negativeBinomialDeviance(actual, predicted, alpha);
  accumulator.interval_covered += actual >= interval.lower && actual <= interval.upper ? 1 : 0;
  accumulator.residual_sum += residual;
  accumulator.actual_sum += actual;
  accumulator.predicted_sum += predicted;
  accumulator.over_estimate_count += predicted > actual ? 1 : 0;
  accumulator.under_estimate_count += predicted < actual ? 1 : 0;
}

export function finalizeMetric(accumulator) {
  const n = accumulator.observations;
  return {
    observations: n,
    mae: n ? accumulator.absolute_error_sum / n : null,
    poisson_deviance: n ? accumulator.poisson_deviance_sum / n : null,
    negative_binomial_deviance: n ? accumulator.negative_binomial_deviance_sum / n : null,
    prediction_interval_90_coverage: n ? accumulator.interval_covered / n : null,
    mean_residual_actual_minus_predicted: n ? accumulator.residual_sum / n : null,
    mean_actual: n ? accumulator.actual_sum / n : null,
    mean_predicted: n ? accumulator.predicted_sum / n : null,
    over_estimate_rate: n ? accumulator.over_estimate_count / n : null,
    under_estimate_rate: n ? accumulator.under_estimate_count / n : null,
    _sums: { ...accumulator },
  };
}

export function diagnoseModelNumerics({
  irls,
  coefficientAbsoluteMaximum,
  dispersion = null,
  predictions,
  maximumPrediction,
  intervals,
  coverages,
} = {}) {
  const failures = [];
  const iterationsValid = Number.isInteger(irls?.iterationsCompleted)
    && irls.iterationsCompleted > 0
    && Number.isInteger(irls?.maximumIterations)
    && irls.maximumIterations > 0
    && irls.iterationsCompleted <= irls.maximumIterations;
  const toleranceValid = Number.isFinite(irls?.convergenceTolerance) && irls.convergenceTolerance > 0;
  const changeFinite = Number.isFinite(irls?.lastChange);
  const singularKnown = typeof irls?.singular === 'boolean';
  const coefficientsFinite = nonEmptyFiniteArray(irls?.coefficients);
  const coefficientMaximumValid = Number.isFinite(coefficientAbsoluteMaximum)
    && coefficientAbsoluteMaximum >= 0;
  const coefficientsWithinMaximum = coefficientsFinite
    && coefficientMaximumValid
    && irls.coefficients.every((value) => Math.abs(value) <= coefficientAbsoluteMaximum);
  const converged = iterationsValid
    && toleranceValid
    && changeFinite
    && irls.lastChange < irls.convergenceTolerance;
  const reachedIterationCap = iterationsValid && irls.iterationsCompleted === irls.maximumIterations;

  if (!iterationsValid) failures.push('irls-iterations-invalid');
  if (!toleranceValid) failures.push('irls-tolerance-invalid');
  if (!changeFinite) failures.push('irls-change-non-finite');
  if (!converged) failures.push('irls-non-converged');
  if (reachedIterationCap && !converged) failures.push('irls-iteration-cap-exhausted');
  if (!singularKnown) failures.push('irls-singular-state-invalid');
  else if (irls.singular) failures.push('irls-singular');
  if (!coefficientsFinite) failures.push('irls-coefficients-non-finite');
  if (!coefficientMaximumValid) failures.push('irls-coefficient-maximum-invalid');
  if (coefficientsFinite && coefficientMaximumValid && !coefficientsWithinMaximum) {
    failures.push('irls-coefficient-exceeds-maximum');
  }

  const dispersionApplicable = dispersion !== null;
  const dispersionBoundsValid = !dispersionApplicable || (
    Number.isFinite(dispersion?.minimum)
    && Number.isFinite(dispersion?.maximum)
    && dispersion.minimum >= 0
    && dispersion.maximum >= dispersion.minimum
  );
  const dispersionFinite = !dispersionApplicable || Number.isFinite(dispersion?.value);
  const dispersionWithinBounds = !dispersionApplicable || (
    dispersionBoundsValid
    && dispersionFinite
    && dispersion.value >= dispersion.minimum
    && dispersion.value <= dispersion.maximum
  );
  if (!dispersionBoundsValid) failures.push('nb-dispersion-bounds-invalid');
  if (!dispersionFinite) failures.push('nb-dispersion-non-finite');
  else if (dispersionBoundsValid && !dispersionWithinBounds) failures.push('nb-dispersion-out-of-bounds');

  const predictionsPresent = Array.isArray(predictions) && predictions.length > 0;
  const predictionMaximumValid = Number.isFinite(maximumPrediction) && maximumPrediction >= 0;
  const predictionsFinite = predictionsPresent && predictions.every(Number.isFinite);
  const predictionsNonnegative = predictionsFinite && predictions.every((value) => value >= 0);
  const predictionsWithinMaximum = predictionsFinite
    && predictionMaximumValid
    && predictions.every((value) => value <= maximumPrediction);
  if (!predictionsPresent) failures.push('predictions-missing');
  if (!predictionMaximumValid) failures.push('prediction-maximum-invalid');
  if (predictionsPresent && !predictionsFinite) failures.push('prediction-non-finite');
  if (predictionsFinite && !predictionsNonnegative) failures.push('prediction-negative');
  if (predictionsFinite && predictionMaximumValid && !predictionsWithinMaximum) {
    failures.push('prediction-exceeds-maximum');
  }

  const intervalsPresent = Array.isArray(intervals) && intervals.length > 0;
  const intervalsFinite = intervalsPresent && intervals.every((interval) => (
    Number.isFinite(interval?.lower) && Number.isFinite(interval?.upper)
  ));
  const intervalLowersNonnegative = intervalsFinite && intervals.every((interval) => interval.lower >= 0);
  const intervalsOrdered = intervalsFinite && intervals.every((interval) => interval.upper >= interval.lower);
  const predictionIntervalCountsMatch = predictionsPresent
    && intervalsPresent
    && predictions.length === intervals.length;
  if (!intervalsPresent) failures.push('intervals-missing');
  if (predictionsPresent && intervalsPresent && !predictionIntervalCountsMatch) {
    failures.push('prediction-interval-count-mismatch');
  }
  if (intervalsPresent && !intervalsFinite) failures.push('interval-non-finite');
  if (intervalsFinite && !intervalLowersNonnegative) failures.push('interval-negative-lower');
  if (intervalsFinite && !intervalsOrdered) failures.push('interval-inverted');

  const coveragesPresent = Array.isArray(coverages) && coverages.length > 0;
  const coveragesFinite = coveragesPresent && coverages.every(Number.isFinite);
  const coveragesWithinUnitInterval = coveragesFinite
    && coverages.every((value) => value >= 0 && value <= 1);
  if (!coveragesPresent) failures.push('coverages-missing');
  if (coveragesPresent && !coveragesFinite) failures.push('coverage-non-finite');
  if (coveragesFinite && !coveragesWithinUnitInterval) failures.push('coverage-out-of-bounds');

  return {
    ok: failures.length === 0,
    checks: {
      irls: {
        iterations_valid: iterationsValid,
        tolerance_valid: toleranceValid,
        change_finite: changeFinite,
        converged,
        reached_iteration_cap: reachedIterationCap,
        iteration_cap_exhausted: reachedIterationCap && !converged,
        singular_known: singularKnown,
        singular: singularKnown ? irls.singular : null,
        coefficients_finite: coefficientsFinite,
        coefficient_maximum_valid: coefficientMaximumValid,
        coefficients_within_maximum: coefficientsWithinMaximum,
      },
      negative_binomial_dispersion: {
        applicable: dispersionApplicable,
        bounds_valid: dispersionBoundsValid,
        finite: dispersionFinite,
        within_bounds: dispersionWithinBounds,
      },
      predictions: {
        present: predictionsPresent,
        maximum_valid: predictionMaximumValid,
        finite: predictionsFinite,
        nonnegative: predictionsNonnegative,
        within_maximum: predictionsWithinMaximum,
      },
      intervals: {
        present: intervalsPresent,
        finite: intervalsFinite,
        lower_nonnegative: intervalLowersNonnegative,
        ordered: intervalsOrdered,
        matches_prediction_count: predictionIntervalCountsMatch,
      },
      coverages: {
        present: coveragesPresent,
        finite: coveragesFinite,
        within_unit_interval: coveragesWithinUnitInterval,
      },
    },
    failures,
  };
}

export function mergeMetricAccumulators(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key];
  return target;
}

export function isSpatialHoldout(blockId, remainder = 0) {
  const value = createHash('sha256').update(blockId).digest().readUInt32BE(0);
  return value % 5 === remainder;
}

export function dataVolumeBand(mean) {
  if (mean < 1) return 'low';
  if (mean < 5) return 'medium';
  return 'high';
}

export function populationBand(estimate) {
  if (!Number.isFinite(estimate)) return 'unavailable';
  if (estimate < 2500) return 'low';
  if (estimate < 4500) return 'medium';
  return 'high';
}

function solveNormalApproximationProbability(probability) {
  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;
  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;
  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;
  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6)
      / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6)
      / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q
    / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
}

function inverseNormal(probability) {
  if (probability <= 0) return -Infinity;
  if (probability >= 1) return Infinity;
  return solveNormalApproximationProbability(probability);
}

function nonEmptyFiniteArray(values) {
  return Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
