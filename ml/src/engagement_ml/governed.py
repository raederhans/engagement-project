from __future__ import annotations

import platform
import time
import tracemalloc
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import scipy
import sklearn
import torch

from .constants import (
    CALIBRATION_REPORT_SCHEMA,
    FIXED_TORCH_SEEDS,
    M7_FORMAL_MODEL_IDS,
    M7_GATE_MODEL_IDS,
    M7_REFERENCE_SEED,
    MODEL_ADMISSION_RECEIPT_SCHEMA,
    MODEL_BENCHMARK_REPORT_SCHEMA,
    MODEL_CARD_SCHEMA,
)
from .contracts import ContractError, validate_ml_dataset_manifest
from .evaluation import evaluate_benchmark
from .governance import frozen_governance_identities, frozen_lineage, load_governance
from .identity import content_identity, file_identity, strict_json_load, write_json
from .m7_contracts import (
    AGGREGATE_PRIVACY,
    AUTHORITY_FALSE,
    PRODUCTION_UNAVAILABLE,
    validate_calibration_report,
    validate_model_admission_receipt,
    validate_model_benchmark_report,
    validate_model_card,
)
from .parity import validate_parity_value

_PRIMARY_FIELDS = (
    "mae",
    "poisson_deviance",
    "negative_binomial_deviance",
    "prediction_interval_90_coverage",
    "mean_actual",
    "mean_predicted",
    "prediction_minimum",
    "prediction_maximum",
    "relative_mae_gain_vs_seasonal_naive",
)


def _environment() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "scikit_learn": sklearn.__version__,
        "torch": torch.__version__,
        "platform": platform.platform(),
    }


def _weighted_mean(rows: Sequence[Mapping[str, Any]], field: str) -> float | None:
    available = [
        (int(row["observations"]), float(row[field]))
        for row in rows
        if row.get(field) is not None and int(row["observations"]) > 0
    ]
    observations = sum(count for count, _ in available)
    if observations == 0:
        return None
    return float(sum(count * value for count, value in available) / observations)


def _condense(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "model": row["model"],
        "fold": row["fold"],
        "unit_type": row["unit_type"],
        "holdout_slice": row["holdout_slice"],
        "observations": int(row["observations"]),
        "status": row["status"],
        **{field: row.get(field) for field in _PRIMARY_FIELDS},
    }


def _median_torch_rows(reports: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    by_slice: dict[tuple[str, str, str], list[Mapping[str, Any]]] = {}
    for report in reports:
        for row in report["primary_results"]:
            if row["model"] != "torch-nb-global-v1":
                continue
            key = (row["fold"], row["unit_type"], row["holdout_slice"])
            by_slice.setdefault(key, []).append(row)
    rows = []
    for key in sorted(by_slice):
        candidates = by_slice[key]
        observations = {int(row["observations"]) for row in candidates}
        statuses = {row["status"] for row in candidates}
        if len(observations) != 1 or len(statuses) != 1:
            raise ContractError("torch seed primary slice identity drifted")
        result = {
            "model": "torch-nb-global-v1",
            "fold": key[0],
            "unit_type": key[1],
            "holdout_slice": key[2],
            "observations": observations.pop(),
            "status": statuses.pop(),
        }
        for field in _PRIMARY_FIELDS:
            values = [float(row[field]) for row in candidates if row.get(field) is not None]
            result[field] = float(np.median(values)) if values else None
        rows.append(result)
    return rows


def _category_gate(
    rows: Sequence[Mapping[str, Any]],
    seasonal_rows: Mapping[tuple[str, str, str], Mapping[str, Any]],
    maximum_regression: float,
) -> bool:
    for row in rows:
        key = (row["fold"], row["unit_type"], row["holdout_slice"])
        seasonal = seasonal_rows[key]
        candidate_categories = row.get("audits", {}).get("category_presence", [])
        seasonal_categories = {
            item["category"]: item
            for item in seasonal.get("audits", {}).get("category_presence", [])
        }
        for item in candidate_categories:
            baseline = seasonal_categories.get(item["category"])
            if not baseline or item.get("mae") is None or baseline.get("mae") in {None, 0}:
                continue
            regression = (float(item["mae"]) - float(baseline["mae"])) / float(baseline["mae"])
            if regression > maximum_regression:
                return False
    return True


def _candidate_spec(governance: Mapping[str, Any], model: str) -> Mapping[str, Any]:
    for entry in governance["v3"]["candidates"]:
        if entry["id"] == model:
            return entry
    raise ContractError(f"v3 candidate specification unavailable: {model}")


def _convergence_passed(
    reports: Sequence[Mapping[str, Any]],
    model: str,
    governance: Mapping[str, Any],
) -> bool:
    if not reports:
        return False
    if model in M7_FORMAL_MODEL_IDS[:3]:
        return True
    if model not in M7_GATE_MODEL_IDS:
        return False
    diagnostics = [
        row
        for report in reports
        for row in report["fit_diagnostics"]
        if row["model"] == model
    ]
    if len(diagnostics) != 8 * len(reports):
        return False
    specification = _candidate_spec(governance, model)
    parameters = specification["hyperparameters"]
    convergence = governance["v3"]["convergence"]
    if model == "sklearn-poisson-l2-v1":
        return all(
            row.get("solver") in parameters["solver"]
            and row.get("alpha_l2") in parameters["alpha"]
            and row.get("maximum_iterations") in parameters["max_iter"]
            and row.get("converged_before_limit") is True
            and row.get("coefficients_finite") is True
            and row.get("predictions_finite") is True
            for row in diagnostics
        )
    if model == "sklearn-hist-gradient-boosting-poisson-v1":
        return all(
            row.get("learning_rate") in parameters["learning_rate"]
            and row.get("max_leaf_nodes") in parameters["max_leaf_nodes"]
            and row.get("l2_regularization") in parameters["l2_regularization"]
            and row.get("maximum_iterations") in parameters["max_iter"]
            and row.get("early_stopping") is True
            and row.get("external_validation") is True
            and row.get("converged_before_limit") is True
            and row.get("predictions_finite") is True
            for row in diagnostics
        )
    return all(
        row.get("architecture", {}).get("hidden_size") in parameters["hidden_width"]
        and row.get("learning_rate") in parameters["learning_rate"]
        and row.get("weight_decay") in parameters["weight_decay"]
        and row.get("maximum_epochs") in parameters["maximum_epochs"]
        and row.get("gradient_clip_norm") in parameters["gradient_clip_norm"]
        and row.get("early_stopping_patience")
        == convergence["torch_early_stopping_patience_epochs"]
        and row.get("best_validation_checkpoint_loaded") is True
        for row in diagnostics
    )


def _prediction_cap_passed(
    reports: Sequence[Mapping[str, Any]],
    model: str,
    governance: Mapping[str, Any],
) -> bool:
    if not reports or model not in M7_FORMAL_MODEL_IDS[:6]:
        return False
    rows = [
        row
        for report in reports
        for row in report["primary_results"]
        if row["model"] == model
    ]
    minimum = float(governance["v3"]["prediction_cap"]["minimum_inclusive"])
    maximum = float(governance["v3"]["prediction_cap"]["maximum_inclusive"])
    return len(rows) == 16 * len(reports) and all(
        row.get("status") == "evaluated"
        and row.get("prediction_minimum") is not None
        and row.get("prediction_maximum") is not None
        and minimum <= float(row["prediction_minimum"])
        and float(row["prediction_maximum"]) <= maximum
        for row in rows
    )


def _candidate_summaries(
    representative: Mapping[str, Any] | None,
    condensed: Sequence[Mapping[str, Any]],
    governance: Mapping[str, Any],
    reports: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    if representative is None:
        return [
            {
                "model": model,
                "evidence_status": "parity-reference" if model in M7_FORMAL_MODEL_IDS[6:] else "unavailable",
                "primary_slice_count": 0,
                "observations": 0,
                "aggregate_mae": None,
                "aggregate_relative_mae_gain": None,
                "worst_relative_mae_gain": None,
                "all_primary_slices_passed": False,
                "calibration_passed": False,
                "convergence_passed": False,
                "prediction_cap_passed": False,
            }
            for model in M7_FORMAL_MODEL_IDS
        ]
    slice_gate = governance["v3"]["slice_gate"]
    minimum_observations = int(slice_gate["minimum_observations_per_primary_slice"])
    minimum_slice_gain = float(slice_gate["minimum_relative_mae_gain_each_primary_slice"])
    minimum_aggregate_gain = float(slice_gate["minimum_aggregate_relative_mae_gain"])
    maximum_category_regression = float(slice_gate["maximum_category_mae_regression_vs_seasonal"])
    coverage_minimum, coverage_maximum = governance["v3"]["interval_calibration"][
        "acceptable_primary_slice_coverage_inclusive"
    ]
    legacy_primary = representative["primary_results"]
    seasonal_legacy = {
        (row["fold"], row["unit_type"], row["holdout_slice"]): row
        for row in legacy_primary
        if row["model"] == "seasonal-naive-52w"
    }
    seasonal_condensed = [row for row in condensed if row["model"] == "seasonal-naive-52w"]
    seasonal_mae = _weighted_mean(seasonal_condensed, "mae")
    summaries = []
    for model in M7_FORMAL_MODEL_IDS:
        rows = [row for row in condensed if row["model"] == model]
        if not rows:
            summaries.append(
                {
                    "model": model,
                    "evidence_status": "parity-reference",
                    "primary_slice_count": 0,
                    "observations": 0,
                    "aggregate_mae": None,
                    "aggregate_relative_mae_gain": None,
                    "worst_relative_mae_gain": None,
                    "all_primary_slices_passed": False,
                    "calibration_passed": False,
                    "convergence_passed": False,
                    "prediction_cap_passed": False,
                }
            )
            continue
        aggregate_mae = _weighted_mean(rows, "mae")
        aggregate_gain = None
        if aggregate_mae is not None and seasonal_mae not in {None, 0}:
            aggregate_gain = float((seasonal_mae - aggregate_mae) / seasonal_mae)
        gains = [
            float(row["relative_mae_gain_vs_seasonal_naive"])
            for row in rows
            if row["relative_mae_gain_vs_seasonal_naive"] is not None
        ]
        coverages = [
            float(row["prediction_interval_90_coverage"])
            for row in rows
            if row["prediction_interval_90_coverage"] is not None
        ]
        legacy_rows = [row for row in legacy_primary if row["model"] == model]
        all_primary = (
            len(rows) == 16
            and all(int(row["observations"]) >= minimum_observations for row in rows)
            and len(gains) == 16
            and min(gains) >= minimum_slice_gain
            and aggregate_gain is not None
            and aggregate_gain >= minimum_aggregate_gain
            and _category_gate(legacy_rows, seasonal_legacy, maximum_category_regression)
        )
        calibration_passed = (
            len(coverages) == 16
            and all(float(coverage_minimum) <= value <= float(coverage_maximum) for value in coverages)
        )
        summaries.append(
            {
                "model": model,
                "evidence_status": "evaluated",
                "primary_slice_count": len(rows),
                "observations": sum(int(row["observations"]) for row in rows),
                "aggregate_mae": aggregate_mae,
                "aggregate_relative_mae_gain": aggregate_gain,
                "worst_relative_mae_gain": min(gains) if gains else None,
                "all_primary_slices_passed": all_primary,
                "calibration_passed": calibration_passed,
                "convergence_passed": _convergence_passed(reports, model, governance),
                "prediction_cap_passed": _prediction_cap_passed(
                    reports, model, governance
                ),
            }
        )
    return summaries


def _stability(runs: list[dict[str, Any]], maximum_instability: float) -> dict[str, Any]:
    values = [float(run["aggregate_primary_mae"]) for run in runs if run["status"] == "evaluated"]
    failed = [int(run["seed"]) for run in runs if run["status"] == "failed"]
    epochs = [int(epoch) for run in runs for epoch in run["epochs_completed"]]
    median = float(np.median(values)) if values else None
    worst = max(values) if values else None
    standard_deviation = float(np.std(values)) if values else None
    instability = (
        float(standard_deviation / median)
        if standard_deviation is not None and median not in {None, 0}
        else None
    )
    environments = sorted(
        {content_identity(run["environment"]) for run in runs if run["status"] == "evaluated"}
    )
    return {
        "fixed_seeds": list(FIXED_TORCH_SEEDS),
        "runs": runs,
        "summary": {
            "median": median,
            "worst": worst,
            "population_std": standard_deviation,
            "failed_seeds": failed,
            "relative_instability": instability,
            "epoch_median": float(np.median(epochs)) if epochs else None,
            "epoch_worst": float(max(epochs)) if epochs else None,
            "environment_identities": environments,
            "passed": not failed
            and len(values) == len(FIXED_TORCH_SEEDS)
            and instability is not None
            and instability <= maximum_instability,
        },
    }


def _calibration_report(report: Mapping[str, Any]) -> dict[str, Any]:
    rows = []
    for model in M7_FORMAL_MODEL_IDS[:6]:
        model_rows = [row for row in report["primary_results"] if row["model"] == model]
        coverages = [
            float(row["prediction_interval_90_coverage"])
            for row in model_rows
            if row["prediction_interval_90_coverage"] is not None
        ]
        failed_slices = [
            f"{row['fold']}|{row['unit_type']}|{row['holdout_slice']}"
            for row in model_rows
            if row["prediction_interval_90_coverage"] is None
            or not 0.85 <= float(row["prediction_interval_90_coverage"]) <= 0.95
        ]
        method = (
            "training-only-nb2-central-90-percent"
            if model == "torch-nb-global-v1"
            else "training-only-calibrated-count-residual-90-percent"
        )
        rows.append(
            {
                "model": model,
                "method": method,
                "primary_slice_count": len(model_rows),
                "coverage_minimum": min(coverages) if coverages else None,
                "coverage_maximum": max(coverages) if coverages else None,
                "coverage_median": float(np.median(coverages)) if coverages else None,
                "failed_slices": failed_slices,
                "passed": len(model_rows) == 16 and not failed_slices,
            }
        )
    selected = report["gate"]["selected_candidate"]
    selected_row = next((row for row in rows if row["model"] == selected), None)
    core = {
        "schema": CALIBRATION_REPORT_SCHEMA,
        "evaluation_scope": report["evaluation_scope"],
        "research_only": True,
        "authority": dict(AUTHORITY_FALSE),
        "privacy": dict(AGGREGATE_PRIVACY),
        "benchmark_report_identity": report["report_identity"],
        "dataset_manifest_identity": report["lineage"]["dataset_manifest_identity"],
        "split_policy_identity": report["lineage"]["split_policy_identity"],
        "calibration_policy_identity": report["lineage"]["calibration_policy_identity"],
        "candidate_calibration": rows,
        "gate": {
            "passed": bool(report["gate"]["passed"] and selected_row and selected_row["passed"]),
            "all_primary_slices_required": True,
        },
    }
    result = {**core, "report_identity": content_identity(core)}
    return validate_calibration_report(result, benchmark=report)


def _model_card(
    report: Mapping[str, Any], calibration: Mapping[str, Any]
) -> dict[str, Any] | None:
    model_id = report["gate"]["selected_candidate"]
    if model_id is None:
        return None
    catalog = {entry["id"]: entry for entry in report["candidate_catalog"]}
    core = {
        "schema": MODEL_CARD_SCHEMA,
        "model_id": model_id,
        "role": catalog[model_id]["role"],
        "research_only": True,
        "authority": dict(AUTHORITY_FALSE),
        "privacy": dict(AGGREGATE_PRIVACY),
        "benchmark_report_identity": report["report_identity"],
        "calibration_report_identity": calibration["report_identity"],
        "lineage": dict(report["lineage"]),
        "intended_use": "aggregate-shadow-evaluation-only",
        "limitations": [
            "reported-incidents-are-not-total-incidence-or-causal-risk",
            "cross-platform-and-cpu-gpu-byte-identity-is-not-guaranteed",
            "shadow-evidence-does-not-authorize-production-serving",
        ],
        "prohibited_uses": [
            "production-forecasting",
            "route-safety-or-routing-decisions",
            "individual-or-event-level-inference",
            "pickle-joblib-or-torch-load-deserialization-at-m7-ingress",
        ],
        "model_artifact": {
            "format": "state-dict-only-or-none",
            "admitted_for_deserialization": False,
            "bridge_consumes_checkpoint": False,
        },
    }
    card = {**core, "card_identity": content_identity(core)}
    return validate_model_card(card, benchmark=report, calibration=calibration)


def _admission(
    report: Mapping[str, Any],
    calibration: Mapping[str, Any],
    model_card: Mapping[str, Any] | None,
) -> dict[str, Any]:
    admitted = bool(report["gate"]["passed"] and calibration["gate"]["passed"] and model_card)
    reasons = ["all-governed-shadow-gates-passed"] if admitted else list(report["gate"]["reason_codes"])
    if not admitted and not calibration["gate"]["passed"]:
        reasons.append("calibration-gate-failed")
    reasons = list(dict.fromkeys(reasons)) or ["governed-gate-failed"]
    core = {
        "schema": MODEL_ADMISSION_RECEIPT_SCHEMA,
        "status": "complete",
        "decision": "shadow-admitted" if admitted else "no-promotion",
        "evaluation_scope": report["evaluation_scope"],
        "full_evaluation": report["evaluation_scope"] == "full-exact-registry",
        "research_only": True,
        "authority": dict(AUTHORITY_FALSE),
        "privacy": dict(AGGREGATE_PRIVACY),
        "lineage": dict(report["lineage"]),
        "benchmark_report_identity": report["report_identity"],
        "calibration_report_identity": calibration["report_identity"],
        "model_card_identity": model_card["card_identity"] if model_card else None,
        "selected_model": model_card["model_id"] if admitted and model_card else None,
        "reason_codes": reasons,
        "production_forecast": dict(PRODUCTION_UNAVAILABLE),
    }
    receipt = {**core, "receipt_identity": content_identity(core)}
    return validate_model_admission_receipt(
        receipt,
        benchmark=report,
        calibration=calibration,
        model_card=model_card,
    )


def run_governed_benchmark(
    *,
    repo_root: Path,
    dataset_root: Path,
    protocol_path: Path,
    parity_receipt: Mapping[str, Any],
    output_root: Path,
    evaluation_scope: str,
    torch_device: str = "cpu",
    torch_maximum_epochs: int = 60,
) -> dict[str, Any]:
    if evaluation_scope not in {"full-exact-registry", "synthetic-fixture"}:
        raise ContractError("governed benchmark evaluation_scope is invalid")
    try:
        parity = validate_parity_value(parity_receipt)
    except ValueError as error:
        raise ContractError("governed benchmark requires exact passed JS/Python parity") from error
    governance = load_governance(repo_root)
    frozen = frozen_governance_identities(repo_root)
    actual_protocol_identity = file_identity(protocol_path)[1]
    if actual_protocol_identity != frozen["evaluation_protocol_identity"]:
        raise ContractError("governed benchmark protocol drifted from frozen evaluation protocol")
    manifest_value = strict_json_load(dataset_root / "manifest.json")
    manifest = validate_ml_dataset_manifest(manifest_value)
    if manifest["source"]["protocol_identity"] != frozen["evaluation_protocol_identity"]:
        raise ContractError("dataset manifest protocol drifted from frozen evaluation protocol")
    lineage = frozen_lineage(
        repo_root,
        dataset_manifest=manifest,
        parity_receipt_identity=parity["receipt_identity"],
    )
    output_root.mkdir(parents=True, exist_ok=True)
    successful_reports: list[dict[str, Any]] = []
    stability_runs: list[dict[str, Any]] = []
    for torch_seed in FIXED_TORCH_SEEDS:
        if torch_device == "cuda" and torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        tracemalloc.start()
        started = time.perf_counter()
        report: dict[str, Any] | None = None
        failure = None
        try:
            report = evaluate_benchmark(
                dataset_root=dataset_root,
                protocol_path=protocol_path,
                output_path=output_root / "_seed_runs" / f"seed-{torch_seed}" / "legacy-benchmark.json",
                seed=M7_REFERENCE_SEED,
                torch_seed=torch_seed,
                include_torch=True,
                torch_device=torch_device,
                torch_maximum_epochs=torch_maximum_epochs,
            )
            successful_reports.append(report)
        except Exception as error:  # one failed fixed seed is governed evidence, not a silent abort
            failure = f"{type(error).__name__}: {str(error)[:240]}"
        wall_seconds = time.perf_counter() - started
        _, peak_bytes = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        torch_rows = [
            row
            for row in (report or {}).get("primary_results", [])
            if row["model"] == "torch-nb-global-v1"
        ]
        epochs = [
            int(row["epochs_completed"])
            for row in (report or {}).get("fit_diagnostics", [])
            if row["model"] == "torch-nb-global-v1"
        ]
        stability_runs.append(
            {
                "seed": torch_seed,
                "status": "evaluated" if report is not None else "failed",
                "aggregate_primary_mae": _weighted_mean(torch_rows, "mae") if report else None,
                "epochs_completed": epochs,
                "environment": dict(report["environment"]) if report else _environment(),
                "runtime_memory": {
                    "wall_seconds": float(wall_seconds),
                    "python_tracemalloc_peak_bytes": int(peak_bytes),
                    "cuda_peak_allocated_bytes": int(torch.cuda.max_memory_allocated())
                    if torch_device == "cuda" and torch.cuda.is_available()
                    else None,
                    "host_rss_claimed": False,
                },
                "failure": failure,
            }
        )
    representative = successful_reports[0] if successful_reports else None
    primary: list[dict[str, Any]] = []
    if representative is not None:
        primary.extend(
            _condense(row)
            for row in representative["primary_results"]
            if row["model"] in M7_FORMAL_MODEL_IDS[:5]
        )
        primary.extend(_median_torch_rows(successful_reports))
    stability = _stability(
        stability_runs,
        float(governance["policy"]["stability"]["maximum_relative_instability_inclusive"]),
    )
    summaries = _candidate_summaries(
        representative, primary, governance, successful_reports
    )
    eligible = [
        row
        for row in summaries
        if row["model"] in M7_GATE_MODEL_IDS
        and row["all_primary_slices_passed"]
        and row["calibration_passed"]
        and row["convergence_passed"]
        and row["prediction_cap_passed"]
        and (row["model"] != "torch-nb-global-v1" or stability["summary"]["passed"])
    ]
    selected = min(eligible, key=lambda row: float(row["aggregate_mae"])) if eligible else None
    reasons = []
    if evaluation_scope != "full-exact-registry":
        reasons.append("synthetic-fixture-cannot-authorize-shadow-admission")
        selected = None
    admitted_registries = governance["policy"]["admission_registry"][
        "exact_full_artifact_registry_identities"
    ]
    if lineage["artifact_registry_identity"] not in admitted_registries:
        reasons.append("exact-full-artifact-registry-not-admitted")
        selected = None
    reasons.append("v3-bounded-search-selection-not-executed")
    selected = None
    if not stability["summary"]["passed"]:
        reasons.append("torch-fixed-seed-stability-gate-failed")
    if not eligible:
        reasons.append("no-candidate-passed-every-primary-slice-gate")
    gate_passed = selected is not None and not reasons
    catalog = []
    for entry in governance["policy"]["candidate_catalog"]:
        evidence_status = (
            "parity-reference"
            if entry["id"] in M7_FORMAL_MODEL_IDS[6:]
            else "evaluated"
            if representative is not None
            else "unavailable"
        )
        catalog.append({**entry, "evidence_status": evidence_status})
    report_core = {
        "schema": MODEL_BENCHMARK_REPORT_SCHEMA,
        "evaluation_scope": evaluation_scope,
        "status": "evaluated" if representative is not None else "unavailable",
        "research_only": True,
        "authority": dict(AUTHORITY_FALSE),
        "privacy": dict(AGGREGATE_PRIVACY),
        "lineage": lineage,
        "candidate_catalog": catalog,
        "search_execution": {
            "status": "fixed-reference-only",
            "search_space_identity": lineage["search_space_identity"],
            "trial_receipt_identity": None,
        },
        "primary_results": primary,
        "candidate_summaries": summaries,
        "torch_stability": stability,
        "gate": {
            "passed": gate_passed,
            "selected_candidate": selected["model"] if gate_passed and selected else None,
            "reason_codes": list(dict.fromkeys(reasons)),
        },
        "production_forecast": dict(PRODUCTION_UNAVAILABLE),
    }
    report = {
        **report_core,
        "report_identity": content_identity(report_core),
    }
    validate_model_benchmark_report(report)
    calibration = _calibration_report(report)
    card = _model_card(report, calibration)
    admission = _admission(report, calibration, card)
    write_json(output_root / "model-benchmark-report.json", report)
    write_json(output_root / "calibration-report.json", calibration)
    if card is not None:
        write_json(output_root / "model-card.json", card)
    write_json(output_root / "model-admission-receipt.json", admission)
    return {
        "report": report,
        "calibration": calibration,
        "model_card": card,
        "admission": admission,
        "representative_legacy_report": representative,
    }
