import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accumulateIrls,
  createIrlsAccumulator,
  diagnoseModelNumerics,
  linearPrediction,
  poissonInterval,
  solveIrls,
} from '../lib/area_intelligence_model.mjs';

function healthyDiagnosticInput() {
  let coefficients = [0];
  let result;
  let iterationsCompleted = 0;
  const convergenceTolerance = 1e-7;
  const maximumIterations = 25;
  while (iterationsCompleted < maximumIterations) {
    const accumulator = createIrlsAccumulator(1);
    for (let observation = 0; observation < 12; observation += 1) {
      accumulateIrls(accumulator, [1], 2, coefficients);
    }
    result = solveIrls(accumulator, coefficients);
    coefficients = result.beta;
    iterationsCompleted += 1;
    if (result.changed < convergenceTolerance) break;
  }
  const prediction = linearPrediction(coefficients, [1]).mean;
  const interval = poissonInterval(prediction);
  return {
    irls: {
      iterationsCompleted,
      maximumIterations,
      lastChange: result.changed,
      convergenceTolerance,
      singular: result.singular,
      coefficients,
    },
    coefficientAbsoluteMaximum: 12,
    dispersion: { value: 0.2, minimum: 0.000001, maximum: 10 },
    predictions: [prediction],
    maximumPrediction: 10,
    intervals: [interval],
    coverages: [0, 0.9, 1],
  };
}

test('healthy synthetic fit passes every numerical check without making a promotion decision', () => {
  const diagnostic = diagnoseModelNumerics(healthyDiagnosticInput());
  assert.equal(diagnostic.ok, true);
  assert.deepEqual(diagnostic.failures, []);
  assert.equal(diagnostic.checks.irls.converged, true);
  assert.equal(diagnostic.checks.irls.iteration_cap_exhausted, false);
  assert.equal(diagnostic.checks.irls.coefficients_within_maximum, true);
  assert.equal(diagnostic.checks.negative_binomial_dispersion.within_bounds, true);
  assert.equal(diagnostic.checks.predictions.within_maximum, true);
  assert.equal(diagnostic.checks.intervals.ordered, true);
  assert.equal(diagnostic.checks.coverages.within_unit_interval, true);
  assert.equal('promotion' in diagnostic, false);

  const poissonInput = healthyDiagnosticInput();
  poissonInput.dispersion = null;
  const poissonDiagnostic = diagnoseModelNumerics(poissonInput);
  assert.equal(poissonDiagnostic.ok, true);
  assert.equal(poissonDiagnostic.checks.negative_binomial_dispersion.applicable, false);
});

test('singular IRLS solve remains explicit in the diagnostic', () => {
  const accumulator = createIrlsAccumulator(2);
  accumulateIrls(accumulator, [1, 1], 2, [0, 0]);
  accumulateIrls(accumulator, [2, 2], 3, [0, 0]);
  const solved = solveIrls(accumulator, [0, 0], { ridge: 0 });
  assert.equal(solved.singular, true);

  const input = healthyDiagnosticInput();
  input.irls.singular = solved.singular;
  input.irls.coefficients = solved.beta;
  const diagnostic = diagnoseModelNumerics(input);
  assert.equal(diagnostic.ok, false);
  assert.equal(diagnostic.checks.irls.singular, true);
  assert.ok(diagnostic.failures.includes('irls-singular'));
});

test('non-converged IRLS at the caller-provided iteration cap fails closed', () => {
  const input = healthyDiagnosticInput();
  Object.assign(input.irls, {
    iterationsCompleted: 8,
    maximumIterations: 8,
    lastChange: 0.01,
  });
  const diagnostic = diagnoseModelNumerics(input);
  assert.equal(diagnostic.checks.irls.converged, false);
  assert.equal(diagnostic.checks.irls.reached_iteration_cap, true);
  assert.equal(diagnostic.checks.irls.iteration_cap_exhausted, true);
  assert.ok(diagnostic.failures.includes('irls-non-converged'));
  assert.ok(diagnostic.failures.includes('irls-iteration-cap-exhausted'));
});

test('NaN and Infinity are reported instead of normalized into valid model state', () => {
  const input = healthyDiagnosticInput();
  input.irls.lastChange = Number.NaN;
  input.irls.coefficients = [0, Number.POSITIVE_INFINITY];
  input.dispersion.value = Number.POSITIVE_INFINITY;
  input.predictions = [1, Number.NaN, Number.POSITIVE_INFINITY];
  input.intervals = [
    { lower: 0, upper: Number.POSITIVE_INFINITY },
    { lower: 0, upper: 1 },
    { lower: 0, upper: 1 },
  ];
  input.coverages = [Number.NaN];
  const diagnostic = diagnoseModelNumerics(input);
  assert.equal(diagnostic.ok, false);
  assert.deepEqual(diagnostic.failures, [
    'irls-change-non-finite',
    'irls-non-converged',
    'irls-coefficients-non-finite',
    'nb-dispersion-non-finite',
    'prediction-non-finite',
    'interval-non-finite',
    'coverage-non-finite',
  ]);
});

test('prediction maximum is caller-owned and finite predictions above it fail closed', () => {
  const aboveMaximum = healthyDiagnosticInput();
  aboveMaximum.predictions = [10.000001];
  const exceeded = diagnoseModelNumerics(aboveMaximum);
  assert.equal(exceeded.checks.predictions.finite, true);
  assert.equal(exceeded.checks.predictions.within_maximum, false);
  assert.ok(exceeded.failures.includes('prediction-exceeds-maximum'));

  const missingMaximum = healthyDiagnosticInput();
  delete missingMaximum.maximumPrediction;
  const unbounded = diagnoseModelNumerics(missingMaximum);
  assert.equal(unbounded.checks.predictions.maximum_valid, false);
  assert.ok(unbounded.failures.includes('prediction-maximum-invalid'));
});

test('coefficient absolute maximum is caller-owned, inclusive, and required', () => {
  const atMaximum = healthyDiagnosticInput();
  atMaximum.irls.coefficients = [-12, 12];
  const accepted = diagnoseModelNumerics(atMaximum);
  assert.equal(accepted.checks.irls.coefficients_finite, true);
  assert.equal(accepted.checks.irls.coefficients_within_maximum, true);
  assert.equal(accepted.ok, true);

  const aboveMaximum = healthyDiagnosticInput();
  aboveMaximum.irls.coefficients = [-12.000001];
  const exceeded = diagnoseModelNumerics(aboveMaximum);
  assert.equal(exceeded.checks.irls.coefficients_finite, true);
  assert.equal(exceeded.checks.irls.coefficients_within_maximum, false);
  assert.ok(exceeded.failures.includes('irls-coefficient-exceeds-maximum'));

  const missingMaximum = healthyDiagnosticInput();
  delete missingMaximum.coefficientAbsoluteMaximum;
  const unbounded = diagnoseModelNumerics(missingMaximum);
  assert.equal(unbounded.checks.irls.coefficient_maximum_valid, false);
  assert.ok(unbounded.failures.includes('irls-coefficient-maximum-invalid'));
});

test('predictions and intervals must have one-to-one cardinality', () => {
  const input = healthyDiagnosticInput();
  input.predictions = [1, 2];
  input.intervals = [{ lower: 0, upper: 2 }];
  const diagnostic = diagnoseModelNumerics(input);
  assert.equal(diagnostic.checks.predictions.finite, true);
  assert.equal(diagnostic.checks.intervals.finite, true);
  assert.equal(diagnostic.checks.intervals.matches_prediction_count, false);
  assert.ok(diagnostic.failures.includes('prediction-interval-count-mismatch'));
});

test('finite dispersion, prediction, and interval values still fail when outside their bounds', () => {
  const input = healthyDiagnosticInput();
  input.dispersion.value = 10.000001;
  input.predictions = [-0.01];
  input.intervals = [{ lower: -0.01, upper: 1 }];
  const diagnostic = diagnoseModelNumerics(input);
  assert.equal(diagnostic.checks.negative_binomial_dispersion.finite, true);
  assert.equal(diagnostic.checks.negative_binomial_dispersion.within_bounds, false);
  assert.equal(diagnostic.checks.predictions.finite, true);
  assert.equal(diagnostic.checks.predictions.nonnegative, false);
  assert.equal(diagnostic.checks.intervals.finite, true);
  assert.equal(diagnostic.checks.intervals.lower_nonnegative, false);
  assert.ok(diagnostic.failures.includes('nb-dispersion-out-of-bounds'));
  assert.ok(diagnostic.failures.includes('prediction-negative'));
  assert.ok(diagnostic.failures.includes('interval-negative-lower'));
});

test('inverted intervals and out-of-range coverage remain explicit failures', () => {
  const input = healthyDiagnosticInput();
  input.intervals = [{ lower: 4, upper: 3 }];
  input.coverages = [-0.01, 1.01];
  const diagnostic = diagnoseModelNumerics(input);
  assert.equal(diagnostic.checks.intervals.finite, true);
  assert.equal(diagnostic.checks.intervals.ordered, false);
  assert.equal(diagnostic.checks.coverages.finite, true);
  assert.equal(diagnostic.checks.coverages.within_unit_interval, false);
  assert.ok(diagnostic.failures.includes('interval-inverted'));
  assert.ok(diagnostic.failures.includes('coverage-out-of-bounds'));
});

test('diagnostics rerun deterministically and do not mutate synthetic inputs', () => {
  const input = healthyDiagnosticInput();
  const before = structuredClone(input);
  const first = diagnoseModelNumerics(input);
  const second = diagnoseModelNumerics(input);
  assert.deepEqual(second, first);
  assert.deepEqual(input, before);
});
