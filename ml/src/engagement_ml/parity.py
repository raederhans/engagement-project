from __future__ import annotations

import json
import math
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from .evaluation import is_spatial_holdout, negative_binomial_deviance, poisson_deviance
from .features import baseline_predictions, feature_schema_v1, legacy_feature_vector
from .identity import content_identity, file_identity, strict_json_load, write_json


def _linear_prediction(beta: list[float], features: list[float]) -> tuple[float, float]:
    eta = max(-12.0, min(12.0, sum(value * features[index] for index, value in enumerate(beta))))
    return eta, math.exp(eta)


def _solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    size = len(vector)
    augmented = [row[:] + [vector[index]] for index, row in enumerate(matrix)]
    for pivot in range(size):
        best = pivot
        for row in range(pivot + 1, size):
            if abs(augmented[row][pivot]) > abs(augmented[best][pivot]):
                best = row
        if abs(augmented[best][pivot]) < 1e-12:
            return None
        augmented[pivot], augmented[best] = augmented[best], augmented[pivot]
        divisor = augmented[pivot][pivot]
        for column in range(pivot, size + 1):
            augmented[pivot][column] /= divisor
        for row in range(size):
            if row == pivot:
                continue
            factor = augmented[row][pivot]
            if factor == 0:
                continue
            for column in range(pivot, size + 1):
                augmented[row][column] -= factor * augmented[pivot][column]
    return [row[size] for row in augmented]


def _reference_fit(
    features: list[list[float]],
    target: list[float],
    *,
    iterations: int,
    alpha: float,
    coefficient_limit: float,
    ridge: float,
) -> tuple[list[float], list[float]]:
    beta = [0.0] * len(features[0])
    for _ in range(iterations):
        matrix = [[0.0] * len(beta) for _ in beta]
        vector = [0.0] * len(beta)
        for row_features, actual in zip(features, target, strict=True):
            eta, mean = _linear_prediction(beta, row_features)
            safe_mean = max(mean, 1e-9)
            weight = safe_mean / (1 + max(0.0, alpha) * safe_mean)
            working = eta + (actual - safe_mean) / safe_mean
            for row in range(len(beta)):
                vector[row] += weight * row_features[row] * working
                for column in range(len(beta)):
                    matrix[row][column] += weight * row_features[row] * row_features[column]
        regularized = [
            [value + (ridge if row == column else 0.0) for column, value in enumerate(values)]
            for row, values in enumerate(matrix)
        ]
        solved = _solve_linear_system(regularized, vector)
        if solved is None:
            break
        beta = [max(-coefficient_limit, min(coefficient_limit, value)) for value in solved]
    predictions = [_linear_prediction(beta, row)[1] for row in features]
    return beta, predictions


def _dispersion(target: list[float], predicted: list[float]) -> float:
    numerator = 0.0
    denominator = 0.0
    for actual, mean in zip(target, predicted, strict=True):
        safe_mean = max(mean, 1e-9)
        numerator += ((actual - safe_mean) ** 2) - actual
        denominator += safe_mean**2
    if denominator <= 0:
        return 0.000001
    return max(0.000001, min(10.0, numerator / denominator))


def _histogram_quantile(
    actual: list[float], predicted: list[float], probability: float, maximum: int
) -> float:
    bins = [0] * (maximum + 1)
    for observed, estimate in zip(actual, predicted, strict=True):
        bins[min(maximum, math.ceil(abs(observed - estimate)))] += 1
    target = math.ceil(len(actual) * probability)
    cumulative = 0
    for index, count in enumerate(bins):
        cumulative += count
        if cumulative >= target:
            return float(index)
    return float(maximum)


def run_js_python_parity(repo_root: Path, output_path: Path | None = None) -> dict[str, Any]:
    source = repo_root / "scripts" / "lib" / "area_intelligence_model.mjs"
    _, source_identity = file_identity(source)
    fixture_path = repo_root / "ml" / "fixtures" / "js_python_parity.v1.json"
    fixture_value = strict_json_load(fixture_path)
    if not isinstance(fixture_value, dict) or fixture_value.get("schema") != "JSPythonParityFixture/v1":
        raise ValueError("unsupported JS/Python parity fixture")
    _, fixture_identity = file_identity(fixture_path)
    cases = fixture_value["feature_cases"]
    blocks = fixture_value["spatial_blocks"]
    observations = fixture_value["metric_cases"]
    reference_fit = fixture_value["reference_fit"]
    calibration = fixture_value["calibration"]
    script = """
import {
  baselinePredictions, featureVector, isSpatialHoldout,
  accumulateDispersion, accumulateIrls, accumulateResidualHistogram,
  createDispersionAccumulator, createIrlsAccumulator, createResidualHistogram,
  finalizeDispersion, negativeBinomialDeviance, poissonDeviance,
  residualQuantile, solveIrls, linearPrediction,
} from './scripts/lib/area_intelligence_model.mjs';
const input = JSON.parse(process.argv[1]);
function fitReference(alpha, iterations) {
  let beta = Array(input.reference_fit.features[0].length).fill(0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const accumulator = createIrlsAccumulator(beta.length);
    for (let index = 0; index < input.reference_fit.target.length; index += 1) {
      accumulateIrls(accumulator, input.reference_fit.features[index], input.reference_fit.target[index], beta, { alpha });
    }
    beta = solveIrls(accumulator, beta, {
      coefficientLimit: input.reference_fit.coefficient_limit,
      ridge: input.reference_fit.ridge,
    }).beta;
  }
  return { beta, predictions: input.reference_fit.features.map((features) => linearPrediction(beta, features).mean) };
}
const poisson = fitReference(0, input.reference_fit.poisson_iterations);
const dispersionAccumulator = createDispersionAccumulator();
for (let index = 0; index < input.reference_fit.target.length; index += 1) {
  accumulateDispersion(dispersionAccumulator, input.reference_fit.target[index], poisson.predictions[index]);
}
const alpha = finalizeDispersion(dispersionAccumulator);
const negativeBinomial = fitReference(alpha, input.reference_fit.negative_binomial_iterations);
const histogram = createResidualHistogram(input.calibration.histogram_maximum);
for (let index = 0; index < input.calibration.actual.length; index += 1) {
  accumulateResidualHistogram(histogram, input.calibration.actual[index], input.calibration.predicted[index]);
}
const result = {
  cases: input.feature_cases.map((entry) => ({
    features: featureVector(entry.counts, entry.index, entry.week_start),
    baselines: baselinePredictions(entry.counts, entry.index),
  })),
  blocks: input.spatial_blocks.map((value) => isSpatialHoldout(value)),
  observations: input.metric_cases.map((entry) => ({
    poisson: poissonDeviance(entry.actual, entry.predicted),
    nb2: negativeBinomialDeviance(entry.actual, entry.predicted, entry.alpha),
  })),
  references: { poisson, negativeBinomial, alpha },
  calibrationRadius: residualQuantile(histogram, input.calibration.probability),
};
process.stdout.write(JSON.stringify(result));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(fixture_value)],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    js = json.loads(completed.stdout)
    checks: list[dict[str, Any]] = []
    for index, case in enumerate(cases):
        counts = case["counts"]
        case_index = case["index"]
        week_start = case["week_start"]
        if not isinstance(counts, list) or not isinstance(case_index, int) or not isinstance(week_start, str):
            raise TypeError("invalid parity fixture")
        python_features = legacy_feature_vector(counts, case_index, week_start)
        python_baselines = baseline_predictions(counts, case_index)
        if python_features is None or python_baselines is None:
            raise ValueError("parity fixture lacks required history")
        js_baselines = js["cases"][index]["baselines"]
        baseline_values = {
            "seasonal_naive_52w": js_baselines["seasonal-naive-52w"],
            "moving_average_4w": js_baselines["moving-average-4w"],
            "moving_average_13w": js_baselines["moving-average-13w"],
        }
        passed = bool(
            np.allclose(python_features, js["cases"][index]["features"], rtol=0, atol=1e-12)
            and all(
                abs(float(python_baselines[name]) - float(value)) <= 1e-12
                for name, value in baseline_values.items()
            )
        )
        checks.append({"kind": "features-and-baselines", "case": index, "passed": passed})
    checks.append(
        {
            "kind": "spatial-holdout",
            "passed": [is_spatial_holdout(value) for value in blocks] == js["blocks"],
        }
    )
    for index, observation in enumerate(observations):
        actual = np.asarray([observation["actual"]], dtype=np.float64)
        predicted = np.asarray([observation["predicted"]], dtype=np.float64)
        checks.append(
            {
                "kind": "deviance",
                "case": index,
                "passed": bool(
                    abs(float(poisson_deviance(actual, predicted)[0]) - js["observations"][index]["poisson"]) <= 1e-12
                    and abs(
                        float(negative_binomial_deviance(actual, predicted, observation["alpha"])[0])
                        - js["observations"][index]["nb2"]
                    )
                    <= 1e-12
                ),
            }
        )
    fit_features = [[float(value) for value in row] for row in reference_fit["features"]]
    fit_target = [float(value) for value in reference_fit["target"]]
    poisson_beta, poisson_predictions = _reference_fit(
        fit_features,
        fit_target,
        iterations=int(reference_fit["poisson_iterations"]),
        alpha=0.0,
        coefficient_limit=float(reference_fit["coefficient_limit"]),
        ridge=float(reference_fit["ridge"]),
    )
    alpha = _dispersion(fit_target, poisson_predictions)
    nb_beta, nb_predictions = _reference_fit(
        fit_features,
        fit_target,
        iterations=int(reference_fit["negative_binomial_iterations"]),
        alpha=alpha,
        coefficient_limit=float(reference_fit["coefficient_limit"]),
        ridge=float(reference_fit["ridge"]),
    )
    checks.extend(
        [
            {
                "kind": "js-poisson-reference",
                "passed": bool(
                    np.allclose(poisson_beta, js["references"]["poisson"]["beta"], rtol=0, atol=1e-9)
                    and np.allclose(
                        poisson_predictions,
                        js["references"]["poisson"]["predictions"],
                        rtol=0,
                        atol=1e-9,
                    )
                ),
            },
            {
                "kind": "js-negative-binomial-reference",
                "passed": bool(
                    abs(alpha - js["references"]["alpha"]) <= 1e-9
                    and np.allclose(nb_beta, js["references"]["negativeBinomial"]["beta"], rtol=0, atol=1e-9)
                    and np.allclose(
                        nb_predictions,
                        js["references"]["negativeBinomial"]["predictions"],
                        rtol=0,
                        atol=1e-9,
                    )
                ),
            },
            {
                "kind": "calibration-radius",
                "passed": _histogram_quantile(
                    [float(value) for value in calibration["actual"]],
                    [float(value) for value in calibration["predicted"]],
                    float(calibration["probability"]),
                    int(calibration["histogram_maximum"]),
                )
                == js["calibrationRadius"],
            },
        ]
    )
    core = {
        "schema": "FeatureParityReceipt/v1",
        "passed": all(check["passed"] for check in checks),
        "js_source_identity": source_identity,
        "fixture_identity": fixture_identity,
        "python_feature_schema_identity": feature_schema_v1()["identity"],
        "absolute_tolerance": 1e-12,
        "checks": checks,
    }
    receipt = {**core, "receipt_identity": content_identity(core)}
    if not receipt["passed"]:
        raise ValueError("JS/Python parity failed")
    if output_path is not None:
        write_json(output_path, receipt)
    return receipt


def validate_parity_value(value: Mapping[str, Any]) -> dict[str, Any]:
    if value.get("schema") != "FeatureParityReceipt/v1" or value.get("passed") is not True:
        raise ValueError("FeatureSchema/v2 requires a passed parity receipt")
    core = dict(value)
    declared = core.pop("receipt_identity", None)
    if declared != content_identity(core):
        raise ValueError("parity receipt identity drifted")
    return dict(value)


def validate_parity_receipt(path: Path) -> dict[str, Any]:
    value = strict_json_load(path)
    if not isinstance(value, Mapping):
        raise ValueError("FeatureSchema/v2 parity receipt must be an object")
    return validate_parity_value(value)
