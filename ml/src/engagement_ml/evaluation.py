from __future__ import annotations

import hashlib
import platform
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import scipy
import sklearn
import torch
from numpy.typing import NDArray
from scipy.stats import nbinom

from .constants import BENCHMARK_REPORT_SCHEMA, CATEGORY_COLUMNS
from .contracts import ContractError, validate_ml_dataset_manifest, validate_ml_research_run
from .identity import content_identity, file_identity, strict_json_load, write_json
from .protocol import HOLDOUT_SLICES, UNIT_TYPES, load_protocol, primary_slices
from .sklearn_models import (
    calibration_radius,
    conformal_interval,
    fit_hist_gradient_boosting_poisson,
    fit_poisson_regressor,
)
from .torch_nb import predict_nb2, train_nb2_mlp

_EPSILON = 1e-9
_CALIBRATION_WEEKS = 13


@dataclass(frozen=True)
class DatasetArrays:
    feature_columns: list[str]
    features: NDArray[np.float64]
    target: NDArray[np.float64]
    unit_type: NDArray[np.str_]
    unit_id: NDArray[np.str_]
    spatial_block_id: NDArray[np.str_]
    week_start: NDArray[np.str_]
    acs_estimate: NDArray[np.float64]
    categories: dict[str, NDArray[np.float64]]
    baselines: dict[str, NDArray[np.float64]]
    row_identity: NDArray[np.str_]


def is_spatial_holdout(block_id: str, remainder: int = 0) -> bool:
    prefix = int.from_bytes(hashlib.sha256(block_id.encode("utf-8")).digest()[:4], "big")
    return prefix % 5 == remainder


def _safe_dataset_path(root: Path, relative: str) -> Path:
    path = (root / Path(*relative.split("/"))).resolve(strict=True)
    if root != path and root not in path.parents:
        raise ContractError("dataset part escaped dataset root")
    if path.is_symlink() or not path.is_file():
        raise ContractError("dataset part must be a real file")
    return path


def load_dataset(dataset_root: Path) -> tuple[dict[str, Any], DatasetArrays]:
    root = dataset_root.resolve(strict=True)
    manifest_value = strict_json_load(root / "manifest.json")
    if not isinstance(manifest_value, Mapping):
        raise ContractError("dataset manifest must be an object")
    manifest = validate_ml_dataset_manifest(manifest_value)
    tables = []
    observed_rows = 0
    for part in manifest["output_parts"]:
        path = _safe_dataset_path(root, part["path"])
        size, digest = file_identity(path)
        if size != part["bytes"] or digest != part["sha256"]:
            raise ContractError(f"dataset part identity drifted: {part['path']}")
        table = pq.read_table(path, memory_map=True)
        if table.num_rows != part["row_count"]:
            raise ContractError(f"dataset part row count drifted: {part['path']}")
        observed_rows += table.num_rows
        tables.append(table)
    if observed_rows != manifest["row_count"] or not tables:
        raise ContractError("dataset row inventory drifted")
    table = pa.concat_tables(tables, promote_options="none").combine_chunks()
    columns = set(table.column_names)
    required = {
        "unit_type",
        "unit_id",
        "spatial_block_id",
        "week_start",
        "reported_incident_count",
        "acs_estimate",
        *manifest["feature_columns"],
        *[f"category_{name}" for name in CATEGORY_COLUMNS],
        "baseline_seasonal_naive_52w",
        "baseline_moving_average_4w",
        "baseline_moving_average_13w",
        "baseline_ewma",
    }
    if not required.issubset(columns):
        raise ContractError(f"dataset columns missing: {sorted(required - columns)}")

    def numpy_column(name: str, *, fill_nan: bool = False) -> NDArray[Any]:
        values = table[name].to_numpy(zero_copy_only=False)
        if fill_nan:
            return np.asarray([np.nan if value is None else value for value in values], dtype=np.float64)
        return np.asarray(values)

    unit_type = numpy_column("unit_type").astype(str)
    unit_id = numpy_column("unit_id").astype(str)
    week_start = numpy_column("week_start").astype(str)
    row_identity = np.asarray(
        [f"{unit_type[index]}|{unit_id[index]}|{week_start[index]}" for index in range(len(unit_id))],
        dtype=str,
    )
    if len(set(row_identity.tolist())) != len(row_identity):
        raise ContractError("dataset row identity is duplicated")
    arrays = DatasetArrays(
        feature_columns=list(manifest["feature_columns"]),
        features=np.column_stack(
            [numpy_column(name).astype(np.float64) for name in manifest["feature_columns"]]
        ),
        target=numpy_column("reported_incident_count").astype(np.float64),
        unit_type=unit_type,
        unit_id=unit_id,
        spatial_block_id=numpy_column("spatial_block_id").astype(str),
        week_start=week_start,
        acs_estimate=numpy_column("acs_estimate", fill_nan=True),
        categories={
            name: numpy_column(f"category_{name}").astype(np.float64) for name in CATEGORY_COLUMNS
        },
        baselines={
            "seasonal-naive-52w": numpy_column("baseline_seasonal_naive_52w").astype(np.float64),
            "moving-average-4w": numpy_column("baseline_moving_average_4w").astype(np.float64),
            "moving-average-13w": numpy_column("baseline_moving_average_13w").astype(np.float64),
            "ewma-v1": numpy_column("baseline_ewma").astype(np.float64),
        },
        row_identity=row_identity,
    )
    if not np.all(np.isfinite(arrays.features)) or not np.all(np.isfinite(arrays.target)):
        raise ContractError("dataset contains non-finite features or targets")
    return manifest, arrays


def _date_mask(values: NDArray[np.str_], start: str, end_exclusive: str) -> NDArray[np.bool_]:
    return (values >= start) & (values < end_exclusive)


def split_masks(
    arrays: DatasetArrays, fold: Mapping[str, str], unit_type: str, holdout_remainder: int
) -> dict[str, NDArray[np.bool_]]:
    calibration_start = (
        date.fromisoformat(fold["train_end_exclusive"]) - timedelta(weeks=_CALIBRATION_WEEKS)
    ).isoformat()
    unit_mask = arrays.unit_type == unit_type
    heldout = np.asarray(
        [is_spatial_holdout(value, holdout_remainder) for value in arrays.spatial_block_id],
        dtype=bool,
    )
    fit = unit_mask & ~heldout & _date_mask(arrays.week_start, fold["train_start"], calibration_start)
    calibration = unit_mask & ~heldout & _date_mask(
        arrays.week_start, calibration_start, fold["train_end_exclusive"]
    )
    test_time = unit_mask & _date_mask(
        arrays.week_start, fold["test_start"], fold["test_end_exclusive"]
    )
    masks = {
        "fit": fit,
        "calibration": calibration,
        "temporal-non-heldout": test_time & ~heldout,
        "spatial-heldout": test_time & heldout,
    }
    if np.any(fit & calibration) or any(np.any(fit & masks[name]) for name in HOLDOUT_SLICES):
        raise ContractError("temporal split leakage detected")
    return masks


def split_identity(
    arrays: DatasetArrays, fold: Mapping[str, str], unit_type: str, masks: Mapping[str, NDArray[np.bool_]]
) -> str:
    return content_identity(
        {
            "fold": dict(fold),
            "unit_type": unit_type,
            "calibration_weeks": _CALIBRATION_WEEKS,
            "rows": {
                name: arrays.row_identity[mask].tolist()
                for name, mask in sorted(masks.items())
            },
        }
    )


def poisson_deviance(actual: NDArray[np.float64], predicted: NDArray[np.float64]) -> NDArray[np.float64]:
    mean = np.maximum(predicted, _EPSILON)
    return 2 * np.where(
        actual == 0,
        mean,
        actual * np.log(np.maximum(actual, _EPSILON) / mean) - (actual - mean),
    )


def negative_binomial_deviance(
    actual: NDArray[np.float64],
    predicted: NDArray[np.float64],
    alpha: float | NDArray[np.float64],
) -> NDArray[np.float64]:
    dispersion = np.asarray(alpha, dtype=np.float64)
    mean = np.maximum(predicted, _EPSILON)
    safe_dispersion = np.maximum(dispersion, 1.5e-6)
    size = 1 / safe_dispersion
    first = np.where(actual == 0, 0.0, actual * np.log(np.maximum(actual, _EPSILON) / mean))
    second = (actual + size) * np.log((actual + size) / (mean + size))
    nb2 = np.maximum(0.0, 2 * (first - second))
    return np.where(dispersion <= 1.5e-6, poisson_deviance(actual, predicted), nb2)


def training_dispersion(target: NDArray[np.float64]) -> float:
    mean = float(np.mean(target))
    if mean <= 0:
        return 1e-6
    return float(np.clip((float(np.var(target)) - mean) / (mean * mean), 1e-6, 10.0))


def metric_summary(
    actual: NDArray[np.float64],
    predicted: NDArray[np.float64],
    lower: NDArray[np.float64],
    upper: NDArray[np.float64],
    *,
    alpha: float | NDArray[np.float64],
) -> dict[str, Any]:
    observations = int(actual.size)
    if observations == 0:
        return {
            "observations": 0,
            "status": "unavailable",
            "mae": None,
            "poisson_deviance": None,
            "negative_binomial_deviance": None,
            "prediction_interval_90_coverage": None,
            "mean_residual_actual_minus_predicted": None,
            "mean_actual": None,
            "mean_predicted": None,
            "prediction_minimum": None,
            "prediction_maximum": None,
            "over_estimate_rate": None,
            "under_estimate_rate": None,
        }
    residual = actual - predicted
    return {
        "observations": observations,
        "status": "evaluated",
        "mae": float(np.mean(np.abs(residual))),
        "poisson_deviance": float(np.mean(poisson_deviance(actual, predicted))),
        "negative_binomial_deviance": float(
            np.mean(negative_binomial_deviance(actual, predicted, alpha))
        ),
        "prediction_interval_90_coverage": float(np.mean((actual >= lower) & (actual <= upper))),
        "mean_residual_actual_minus_predicted": float(np.mean(residual)),
        "mean_actual": float(np.mean(actual)),
        "mean_predicted": float(np.mean(predicted)),
        "prediction_minimum": float(np.min(predicted)),
        "prediction_maximum": float(np.max(predicted)),
        "over_estimate_rate": float(np.mean(predicted > actual)),
        "under_estimate_rate": float(np.mean(predicted < actual)),
    }


def _volume_band(means: NDArray[np.float64]) -> NDArray[np.str_]:
    return np.where(means < 1, "low", np.where(means < 5, "medium", "high")).astype(str)


def _population_band(values: NDArray[np.float64]) -> NDArray[np.str_]:
    return np.where(
        np.isnan(values),
        "unavailable",
        np.where(values < 2500, "low", np.where(values < 4500, "medium", "high")),
    ).astype(str)


def _audit_metrics(
    arrays: DatasetArrays,
    test_mask: NDArray[np.bool_],
    actual: NDArray[np.float64],
    predicted: NDArray[np.float64],
    lower: NDArray[np.float64],
    upper: NDArray[np.float64],
    alpha: float | NDArray[np.float64],
    training_means: Mapping[str, float],
) -> dict[str, list[dict[str, Any]]]:
    indexes = np.flatnonzero(test_mask)
    volumes = _volume_band(
        np.asarray([training_means.get(arrays.unit_id[index], 0.0) for index in indexes])
    )
    populations = _population_band(arrays.acs_estimate[indexes])

    def selected_alpha(mask: NDArray[np.bool_]) -> float | NDArray[np.float64]:
        if isinstance(alpha, np.ndarray):
            return alpha[mask]
        return alpha

    def group(labels: NDArray[np.str_], name: str) -> list[dict[str, Any]]:
        result = []
        for label in sorted(set(labels.tolist())):
            mask = labels == label
            result.append(
                {
                    name: label,
                    **metric_summary(
                        actual[mask],
                        predicted[mask],
                        lower[mask],
                        upper[mask],
                        alpha=selected_alpha(mask),
                    ),
                }
            )
        return result

    categories = []
    for category in CATEGORY_COLUMNS:
        mask = arrays.categories[category][indexes] > 0
        categories.append(
            {
                "category": category,
                **metric_summary(
                    actual[mask],
                    predicted[mask],
                    lower[mask],
                    upper[mask],
                    alpha=selected_alpha(mask),
                ),
            }
        )
    return {
        "data_volume": group(volumes, "band"),
        "population": group(populations, "band"),
        "category_presence": categories,
    }


def _training_means(arrays: DatasetArrays, mask: NDArray[np.bool_]) -> dict[str, float]:
    values: dict[str, list[float]] = defaultdict(list)
    for unit, target in zip(arrays.unit_id[mask], arrays.target[mask], strict=True):
        values[str(unit)].append(float(target))
    return {unit: float(np.mean(target)) for unit, target in values.items()}


def _point_interval(
    calibration_actual: NDArray[np.float64],
    calibration_predicted: NDArray[np.float64],
    test_predicted: NDArray[np.float64],
) -> tuple[NDArray[np.float64], NDArray[np.float64], float]:
    radius = calibration_radius(calibration_actual, calibration_predicted)
    lower, upper = conformal_interval(test_predicted, radius)
    return lower, upper, radius


def evaluate_benchmark(
    *,
    dataset_root: Path,
    protocol_path: Path,
    output_path: Path,
    seed: int = 20260831,
    torch_seed: int | None = None,
    include_torch: bool = True,
    torch_device: str = "cpu",
    torch_maximum_epochs: int = 60,
) -> dict[str, Any]:
    manifest, arrays = load_dataset(dataset_root)
    protocol, protocol_identity = load_protocol(protocol_path)
    if manifest["source"]["protocol_identity"] != protocol_identity:
        raise ContractError("dataset/protocol identity drifted")
    results: list[dict[str, Any]] = []
    fit_diagnostics: list[dict[str, Any]] = []
    split_receipts: list[dict[str, Any]] = []
    holdout_remainder = int(protocol["spatial_holdout"]["holdout_remainder"])
    for fold in protocol["rolling_folds"]:
        for unit_type in UNIT_TYPES:
            masks = split_masks(arrays, fold, unit_type, holdout_remainder)
            if not np.any(masks["fit"]) or not np.any(masks["calibration"]):
                raise ContractError(f"fit/calibration unavailable for {fold['id']} {unit_type}")
            split_receipts.append(
                {
                    "fold": fold["id"],
                    "unit_type": unit_type,
                    "identity": split_identity(arrays, fold, unit_type, masks),
                    "counts": {name: int(np.sum(mask)) for name, mask in masks.items()},
                }
            )
            fit_x = arrays.features[masks["fit"]]
            fit_y = arrays.target[masks["fit"]]
            calibration_x = arrays.features[masks["calibration"]]
            calibration_y = arrays.target[masks["calibration"]]
            dispersion = training_dispersion(fit_y)
            training_means = _training_means(arrays, masks["fit"] | masks["calibration"])
            fitted = [fit_poisson_regressor(fit_x, fit_y)]
            fitted.append(
                fit_hist_gradient_boosting_poisson(
                    fit_x,
                    fit_y,
                    validation_features=calibration_x,
                    validation_target=calibration_y,
                    seed=seed,
                )
            )
            fitted_by_id = {model.model_id: model for model in fitted}
            for model in fitted:
                fit_diagnostics.append(
                    {
                        "fold": fold["id"],
                        "unit_type": unit_type,
                        "model": model.model_id,
                        **model.diagnostics,
                    }
                )

            torch_result = None
            if include_torch:
                torch_result = train_nb2_mlp(
                    fit_x,
                    fit_y,
                    calibration_x,
                    calibration_y,
                    seed=torch_seed if torch_seed is not None else seed,
                    requested_device=torch_device,
                    maximum_epochs=torch_maximum_epochs,
                    gradient_clip_norm=1.0,
                    checkpoint_path=output_path.parent
                    / "checkpoints"
                    / f"{fold['id']}-{unit_type}.pt",
                )
                fit_diagnostics.append(
                    {
                        "fold": fold["id"],
                        "unit_type": unit_type,
                        "model": "torch-nb-global-v1",
                        "epochs_completed": torch_result.epochs_completed,
                        "initial_validation_nll": torch_result.initial_validation_nll,
                        "best_validation_nll": torch_result.best_validation_nll,
                        **torch_result.diagnostics,
                    }
                )

            model_ids = [*arrays.baselines, *fitted_by_id]
            if torch_result is not None:
                model_ids.append("torch-nb-global-v1")
            for holdout_slice in HOLDOUT_SLICES:
                test_mask = masks[holdout_slice]
                test_x = arrays.features[test_mask]
                actual = arrays.target[test_mask]
                for model_id in model_ids:
                    alpha: float | NDArray[np.float64]
                    if model_id in arrays.baselines:
                        calibration_predicted = arrays.baselines[model_id][masks["calibration"]]
                        predicted = arrays.baselines[model_id][test_mask]
                        lower, upper, radius = _point_interval(
                            calibration_y, calibration_predicted, predicted
                        )
                        interval = {
                            "method": "validation-only-absolute-residual-90th-percentile",
                            "radius": radius,
                        }
                        alpha = dispersion
                    elif model_id in fitted_by_id:
                        point_model = fitted_by_id[model_id]
                        calibration_predicted = point_model.predict(calibration_x)
                        predicted = point_model.predict(test_x)
                        lower, upper, radius = _point_interval(
                            calibration_y, calibration_predicted, predicted
                        )
                        interval = {
                            "method": "validation-only-absolute-residual-90th-percentile",
                            "radius": radius,
                        }
                        alpha = dispersion
                    else:
                        assert torch_result is not None
                        predicted, alpha_values = predict_nb2(
                            torch_result.model, test_x, device=torch_result.device
                        )
                        size = 1 / alpha_values
                        probability = size / (size + predicted)
                        lower = np.asarray(nbinom.ppf(0.05, size, probability), dtype=np.float64)
                        upper = np.asarray(nbinom.ppf(0.95, size, probability), dtype=np.float64)
                        alpha = alpha_values
                        interval = {"method": "nb2-distributional-central-90-percent"}
                    metrics = metric_summary(actual, predicted, lower, upper, alpha=alpha)
                    results.append(
                        {
                            "model": model_id,
                            "fold": fold["id"],
                            "unit_type": unit_type,
                            "holdout_slice": holdout_slice,
                            "interval": interval,
                            **metrics,
                            "relative_mae_gain_vs_seasonal_naive": None,
                            "audits": _audit_metrics(
                                arrays,
                                test_mask,
                                actual,
                                predicted,
                                lower,
                                upper,
                                alpha,
                                training_means,
                            ),
                        }
                    )

    seasonal = {
        (row["fold"], row["unit_type"], row["holdout_slice"]): row
        for row in results
        if row["model"] == "seasonal-naive-52w"
    }
    for row in results:
        baseline = seasonal[(row["fold"], row["unit_type"], row["holdout_slice"])]
        if row["mae"] is not None and baseline["mae"] not in {None, 0}:
            row["relative_mae_gain_vs_seasonal_naive"] = float(
                (baseline["mae"] - row["mae"]) / baseline["mae"]
            )
    expected_slice_count = 16
    model_counts: dict[str, int] = defaultdict(int)
    for row in results:
        model_counts[row["model"]] += 1
    if any(count != expected_slice_count for count in model_counts.values()):
        raise ContractError("primary slice count drifted from 16 per model")
    expected_primary = primary_slices(protocol)
    for model_id in model_counts:
        observed = [
            {"fold": row["fold"], "unit_type": row["unit_type"], "holdout_slice": row["holdout_slice"]}
            for row in results
            if row["model"] == model_id
        ]
        if observed != expected_primary:
            raise ContractError(f"primary slice ordering drifted for {model_id}")

    report_core = {
        "schema": BENCHMARK_REPORT_SCHEMA,
        "research_only": True,
        "serving_authority": False,
        "promotion_authority": False,
        "dataset_identity": manifest["dataset_identity"],
        "protocol_identity": protocol_identity,
        "feature_columns": arrays.feature_columns,
        "seed": seed,
        "torch_seed": torch_seed if torch_seed is not None else seed,
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "scikit_learn": sklearn.__version__,
            "torch": torch.__version__,
            "platform": platform.platform(),
        },
        "repeatability": {
            "same_environment_seeded_determinism_requested": True,
            "cross_platform_byte_identical": False,
            "cpu_gpu_byte_identical": False,
        },
        "primary_slices_per_model": expected_slice_count,
        "primary_results": results,
        "fit_diagnostics": fit_diagnostics,
        "split_receipts": split_receipts,
    }
    report = {**report_core, "report_identity": content_identity(report_core)}
    write_json(output_path, report)
    return report


def build_research_run(
    *,
    report: Mapping[str, Any],
    model_identity: str,
    feature_schema_identity: str,
    started_at: str,
    completed_at: str,
    device: str,
) -> dict[str, Any]:
    run = {
        "schema": "MLResearchRun/v1",
        "research_only": True,
        "serving_authority": False,
        "promotion_authority": False,
        "input_identity": report["dataset_identity"],
        "protocol_identity": report["protocol_identity"],
        "dataset_manifest_identity": report["dataset_identity"],
        "feature_schema_identity": feature_schema_identity,
        "model_identity": model_identity,
        "environment": dict(report["environment"]),
        "hardware": {
            "machine": platform.machine() or "unknown",
            "processor": platform.processor() or "unknown",
            "platform": platform.platform(),
        },
        "device": device,
        "seed": report["seed"],
        "determinism": dict(report["repeatability"]),
        "started_at": started_at,
        "completed_at": completed_at,
    }
    return validate_ml_research_run(run)
