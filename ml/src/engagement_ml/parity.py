from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from .evaluation import is_spatial_holdout, negative_binomial_deviance, poisson_deviance
from .features import baseline_predictions, feature_schema_v1, legacy_feature_vector
from .identity import content_identity, file_identity, write_json


def run_js_python_parity(repo_root: Path, output_path: Path | None = None) -> dict[str, Any]:
    source = repo_root / "scripts" / "lib" / "area_intelligence_model.mjs"
    _, source_identity = file_identity(source)
    cases: list[dict[str, Any]] = [
        {
            "counts": [int((index * 7 + index // 5) % 11) for index in range(96)],
            "index": 60,
            "week_start": "2025-03-03",
        },
        {
            "counts": [0 if index % 3 else index % 9 for index in range(140)],
            "index": 104,
            "week_start": "2026-02-02",
        },
    ]
    blocks = ["epsg3857-2km:-4175:2438", "tract-block:alpha", "tract-block:beta"]
    observations = [
        {"actual": 0.0, "predicted": 0.25, "alpha": 0.2},
        {"actual": 7.0, "predicted": 5.5, "alpha": 0.4},
        {"actual": 21.0, "predicted": 16.25, "alpha": 0.08},
    ]
    script = """
import {
  baselinePredictions, featureVector, isSpatialHoldout,
  negativeBinomialDeviance, poissonDeviance,
} from './scripts/lib/area_intelligence_model.mjs';
const input = JSON.parse(process.argv[1]);
const result = {
  cases: input.cases.map((entry) => ({
    features: featureVector(entry.counts, entry.index, entry.week_start),
    baselines: baselinePredictions(entry.counts, entry.index),
  })),
  blocks: input.blocks.map((value) => isSpatialHoldout(value)),
  observations: input.observations.map((entry) => ({
    poisson: poissonDeviance(entry.actual, entry.predicted),
    nb2: negativeBinomialDeviance(entry.actual, entry.predicted, entry.alpha),
  })),
};
process.stdout.write(JSON.stringify(result));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps({"cases": cases, "blocks": blocks, "observations": observations})],
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
    core = {
        "schema": "FeatureParityReceipt/v1",
        "passed": all(check["passed"] for check in checks),
        "js_source_identity": source_identity,
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


def validate_parity_receipt(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema") != "FeatureParityReceipt/v1" or value.get("passed") is not True:
        raise ValueError("FeatureSchema/v2 requires a passed parity receipt")
    core = dict(value)
    declared = core.pop("receipt_identity", None)
    if declared != content_identity(core):
        raise ValueError("parity receipt identity drifted")
    return value
