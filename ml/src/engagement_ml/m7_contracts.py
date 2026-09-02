from __future__ import annotations

import math
import re
import statistics
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .constants import (
    CALIBRATION_REPORT_SCHEMA,
    FIXED_TORCH_SEEDS,
    M7_FORMAL_MODEL_IDS,
    MODEL_ADMISSION_RECEIPT_SCHEMA,
    MODEL_BENCHMARK_REPORT_SCHEMA,
    MODEL_CARD_SCHEMA,
)
from .contracts import ContractError
from .governance import LINEAGE_KEYS, frozen_lineage, load_governance
from .identity import content_identity

_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")

AUTHORITY_FALSE = {
    "serving": False,
    "promotion": False,
    "production": False,
    "routing": False,
    "scientific": False,
}

AGGREGATE_PRIVACY = {
    "aggregate_only": True,
    "event_level_data_included": False,
    "coordinates_included": False,
    "raw_or_canonical_events_included": False,
    "source_record_ids_included": False,
}

PRODUCTION_UNAVAILABLE = {
    "status": "unavailable",
    "predictions": [],
    "reason": "m7-shadow-only-no-production-authority",
}

_CATALOG_ROLES = {
    "seasonal-naive-52w": ("baseline", False, "v3"),
    "moving-average-13w": ("baseline", False, "v3"),
    "ewma-v1": ("baseline", False, "v3"),
    "sklearn-poisson-l2-v1": ("gate-candidate", True, "v3"),
    "sklearn-hist-gradient-boosting-poisson-v1": ("gate-candidate", True, "v3"),
    "torch-nb-global-v1": ("gate-candidate", True, "v3"),
    "poisson-log-link-v1": ("reference-only", False, "v2-js-reference"),
    "js-negative-binomial-log-link-v1-repaired": (
        "optional-reference",
        False,
        "v3-optional-js-reference",
    ),
}


def _exact(value: Mapping[str, Any], keys: set[str], label: str) -> None:
    actual = set(value)
    if actual != keys:
        raise ContractError(
            f"{label} schema mismatch; missing={sorted(keys - actual)}, "
            f"unknown={sorted(actual - keys)}"
        )


def _object(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{label} must be an object")
    return value


def _array(value: Any, label: str) -> Sequence[Any]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ContractError(f"{label} must be an array")
    return value


def _sha(value: Any, label: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ContractError(f"{label} must be a sha256 identity")
    return value


def _finite(value: Any, label: str, *, nullable: bool = False) -> float | None:
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ContractError(f"{label} must be finite")
    return float(value)


def _nullable_close(value: Any, expected: float | None) -> bool:
    if expected is None:
        return value is None
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isclose(float(value), expected, rel_tol=1e-12, abs_tol=1e-12)
    )


def _identity(value: Mapping[str, Any], field: str, label: str) -> None:
    declared = _sha(value.get(field), f"{label}.{field}")
    core = dict(value)
    core.pop(field)
    if declared != content_identity(core):
        raise ContractError(f"{label} content identity drifted")


def validate_lineage(
    value: Any, *, allow_unavailable: bool = False, repo_root: Path | None = None
) -> dict[str, Any]:
    lineage = dict(_object(value, "lineage"))
    _exact(lineage, set(LINEAGE_KEYS), "lineage")
    nullable = {
        "artifact_registry_identity",
        "m1_receipt_identity",
        "m2_mart_identity",
        "dataset_manifest_identity",
        "parity_receipt_identity",
    }
    for key, identity in lineage.items():
        _sha(identity, f"lineage.{key}", nullable=allow_unavailable and key in nullable)
    if not allow_unavailable and any(identity is None for identity in lineage.values()):
        raise ContractError("evaluated lineage must bind every exact identity")
    if repo_root is not None:
        expected = frozen_lineage(repo_root)
        for key, identity in expected.items():
            if identity is not None and lineage[key] != identity:
                raise ContractError(f"lineage.{key} drifted from the frozen M7 input")
    return lineage


def _common(value: Mapping[str, Any]) -> None:
    if value.get("research_only") is not True:
        raise ContractError("M7 artifacts must remain research_only")
    if value.get("authority") != AUTHORITY_FALSE:
        raise ContractError("M7 authority must remain exactly false")
    if value.get("privacy") != AGGREGATE_PRIVACY:
        raise ContractError("M7 privacy must remain exact aggregate-only")


def _production(value: Any) -> None:
    if value != PRODUCTION_UNAVAILABLE:
        raise ContractError("production forecast must remain unavailable with no predictions")


def validate_model_benchmark_report(
    value: Mapping[str, Any], *, repo_root: Path | None = None
) -> dict[str, Any]:
    expected = {
        "schema",
        "evaluation_scope",
        "status",
        "research_only",
        "authority",
        "privacy",
        "lineage",
        "candidate_catalog",
        "search_execution",
        "primary_results",
        "candidate_summaries",
        "torch_stability",
        "gate",
        "production_forecast",
        "report_identity",
    }
    _exact(value, expected, MODEL_BENCHMARK_REPORT_SCHEMA)
    if value["schema"] != MODEL_BENCHMARK_REPORT_SCHEMA:
        raise ContractError("unsupported ModelBenchmarkReport schema")
    if value["evaluation_scope"] not in {"full-exact-registry", "synthetic-fixture"}:
        raise ContractError("invalid benchmark evaluation_scope")
    if value["status"] not in {"evaluated", "unavailable"}:
        raise ContractError("invalid benchmark status")
    _common(value)
    validate_lineage(value["lineage"], repo_root=repo_root)
    catalog = _array(value["candidate_catalog"], "candidate_catalog")
    if tuple(entry.get("id") for entry in catalog if isinstance(entry, Mapping)) != M7_FORMAL_MODEL_IDS:
        raise ContractError("formal candidate catalog identity/order drifted")
    for entry in catalog:
        item = _object(entry, "candidate_catalog entry")
        _exact(
            item,
            {"id", "role", "admission_eligible", "source_protocol", "evidence_status"},
            "candidate_catalog entry",
        )
        expected_role = _CATALOG_ROLES[item["id"]]
        if (item["role"], item["admission_eligible"], item["source_protocol"]) != expected_role:
            raise ContractError(f"candidate role drifted: {item['id']}")
        if item["evidence_status"] not in {"evaluated", "parity-reference", "unavailable"}:
            raise ContractError("candidate evidence_status is invalid")
    search = _object(value["search_execution"], "search_execution")
    _exact(
        search,
        {"status", "search_space_identity", "trial_receipt_identity"},
        "search_execution",
    )
    if search["status"] not in {"complete", "fixed-reference-only"}:
        raise ContractError("search execution status is invalid")
    if search["search_space_identity"] != value["lineage"]["search_space_identity"]:
        raise ContractError("search execution identity drifted")
    _sha(search["trial_receipt_identity"], "trial_receipt_identity", nullable=True)
    if (search["status"] == "complete") != (search["trial_receipt_identity"] is not None):
        raise ContractError("complete search requires an exact trial receipt")

    primary = _array(value["primary_results"], "primary_results")
    primary_keys = {
        "model",
        "fold",
        "unit_type",
        "holdout_slice",
        "observations",
        "status",
        "mae",
        "poisson_deviance",
        "negative_binomial_deviance",
        "prediction_interval_90_coverage",
        "mean_actual",
        "mean_predicted",
        "prediction_minimum",
        "prediction_maximum",
        "relative_mae_gain_vs_seasonal_naive",
    }
    counts: dict[str, int] = {}
    for row in primary:
        item = _object(row, "primary result")
        _exact(item, primary_keys, "primary result")
        if item["model"] not in M7_FORMAL_MODEL_IDS[:6]:
            raise ContractError("primary result is not an evaluated M7 candidate")
        if item["unit_type"] not in {"tract", "fixed-grid"} or item["holdout_slice"] not in {
            "temporal-non-heldout",
            "spatial-heldout",
        }:
            raise ContractError("primary slice vocabulary drifted")
        if not isinstance(item["observations"], int) or isinstance(item["observations"], bool) or item["observations"] < 0:
            raise ContractError("primary observations must be a non-negative integer")
        for field in primary_keys - {
            "model",
            "fold",
            "unit_type",
            "holdout_slice",
            "observations",
            "status",
        }:
            _finite(item[field], f"primary.{field}", nullable=True)
        counts[item["model"]] = counts.get(item["model"], 0) + 1
        if item["status"] == "evaluated" and (
            item["prediction_minimum"] is None
            or item["prediction_maximum"] is None
            or float(item["prediction_minimum"]) < 0
            or float(item["prediction_minimum"]) > float(item["prediction_maximum"])
        ):
            raise ContractError("evaluated primary prediction range is invalid")
    if value["status"] == "evaluated" and any(counts.get(model) != 16 for model in M7_FORMAL_MODEL_IDS[:6]):
        raise ContractError("evaluated M7 report requires 16 primary slices for each evaluated model")
    if value["status"] == "unavailable" and primary:
        raise ContractError("unavailable report cannot contain primary results")

    summaries = _array(value["candidate_summaries"], "candidate_summaries")
    if tuple(entry.get("model") for entry in summaries if isinstance(entry, Mapping)) != M7_FORMAL_MODEL_IDS:
        raise ContractError("candidate summary identity/order drifted")
    summary_keys = {
        "model",
        "evidence_status",
        "primary_slice_count",
        "observations",
        "aggregate_mae",
        "aggregate_relative_mae_gain",
        "worst_relative_mae_gain",
        "all_primary_slices_passed",
        "calibration_passed",
        "convergence_passed",
        "prediction_cap_passed",
    }
    for row in summaries:
        item = _object(row, "candidate summary")
        _exact(item, summary_keys, "candidate summary")
        for field in ("primary_slice_count", "observations"):
            if not isinstance(item[field], int) or isinstance(item[field], bool) or item[field] < 0:
                raise ContractError(f"candidate summary {field} is invalid")
        for field in ("aggregate_mae", "aggregate_relative_mae_gain", "worst_relative_mae_gain"):
            _finite(item[field], f"candidate summary {field}", nullable=True)
        for field in (
            "all_primary_slices_passed",
            "calibration_passed",
            "convergence_passed",
            "prediction_cap_passed",
        ):
            if not isinstance(item[field], bool):
                raise ContractError(f"candidate summary {field} must be boolean")

    stability = _object(value["torch_stability"], "torch_stability")
    _exact(stability, {"fixed_seeds", "runs", "summary"}, "torch_stability")
    if tuple(stability["fixed_seeds"]) != FIXED_TORCH_SEEDS:
        raise ContractError("torch fixed seed set drifted")
    runs = _array(stability["runs"], "torch_stability.runs")
    if tuple(run.get("seed") for run in runs if isinstance(run, Mapping)) != FIXED_TORCH_SEEDS:
        raise ContractError("torch stability run order drifted")
    run_keys = {
        "seed",
        "status",
        "aggregate_primary_mae",
        "epochs_completed",
        "environment",
        "runtime_memory",
        "failure",
    }
    for run in runs:
        item = _object(run, "torch stability run")
        _exact(item, run_keys, "torch stability run")
        _finite(item["aggregate_primary_mae"], "aggregate_primary_mae", nullable=True)
        if item["status"] not in {"evaluated", "failed"}:
            raise ContractError("invalid torch stability status")
        if item["status"] == "evaluated" and (
            item["aggregate_primary_mae"] is None or item["failure"] is not None
        ):
            raise ContractError("evaluated torch stability run is incomplete")
        if item["status"] == "failed" and (
            item["aggregate_primary_mae"] is not None or not isinstance(item["failure"], str)
        ):
            raise ContractError("failed torch stability run lacks exact failure evidence")
        runtime = _object(item["runtime_memory"], "runtime_memory")
        _exact(
            runtime,
            {"wall_seconds", "python_tracemalloc_peak_bytes", "cuda_peak_allocated_bytes", "host_rss_claimed"},
            "runtime_memory",
        )
        _finite(runtime["wall_seconds"], "wall_seconds")
        if runtime["host_rss_claimed"] is not False:
            raise ContractError("runtime evidence cannot claim unmeasured host RSS")
    summary = _object(stability["summary"], "torch stability summary")
    _exact(
        summary,
        {"median", "worst", "population_std", "failed_seeds", "relative_instability", "epoch_median", "epoch_worst", "environment_identities", "passed"},
        "torch stability summary",
    )
    for field in ("median", "worst", "population_std", "relative_instability", "epoch_median", "epoch_worst"):
        _finite(summary[field], f"stability.{field}", nullable=True)
    for identity in _array(summary["environment_identities"], "environment_identities"):
        _sha(identity, "environment identity")
    evaluated_values = [
        float(run["aggregate_primary_mae"])
        for run in runs
        if run["status"] == "evaluated"
    ]
    expected_failed = [run["seed"] for run in runs if run["status"] == "failed"]
    expected_epochs = [epoch for run in runs for epoch in run["epochs_completed"]]
    expected_median = statistics.median(evaluated_values) if evaluated_values else None
    expected_worst = max(evaluated_values) if evaluated_values else None
    expected_std = statistics.pstdev(evaluated_values) if evaluated_values else None
    expected_instability = (
        expected_std / expected_median
        if expected_std is not None and expected_median not in {None, 0}
        else None
    )
    expected_environment_ids = sorted(
        {content_identity(run["environment"]) for run in runs if run["status"] == "evaluated"}
    )
    expected_passed = (
        not expected_failed
        and len(evaluated_values) == len(FIXED_TORCH_SEEDS)
        and expected_instability is not None
        and expected_instability <= 0.25
    )
    expected_summary = {
        "median": expected_median,
        "worst": expected_worst,
        "population_std": expected_std,
        "failed_seeds": expected_failed,
        "relative_instability": expected_instability,
        "epoch_median": statistics.median(expected_epochs) if expected_epochs else None,
        "epoch_worst": max(expected_epochs) if expected_epochs else None,
        "environment_identities": expected_environment_ids,
        "passed": expected_passed,
    }
    for field, expected_value in expected_summary.items():
        observed_value = summary[field]
        if isinstance(expected_value, float):
            if not isinstance(observed_value, (int, float)) or not math.isclose(
                float(observed_value), expected_value, rel_tol=1e-12, abs_tol=1e-12
            ):
                raise ContractError(f"torch stability summary {field} drifted")
        elif observed_value != expected_value:
            raise ContractError(f"torch stability summary {field} drifted")

    gate = _object(value["gate"], "gate")
    _exact(gate, {"passed", "selected_candidate", "reason_codes"}, "gate")
    if gate["passed"] is True and (
        value["evaluation_scope"] != "full-exact-registry"
        or search["status"] != "complete"
        or gate["selected_candidate"] not in M7_FORMAL_MODEL_IDS[3:6]
    ):
        raise ContractError("benchmark gate cannot pass outside full exact-registry evaluation")
    if gate["passed"] is True:
        selected = next(
            (row for row in summaries if row["model"] == gate["selected_candidate"]), None
        )
        if selected is None or not all(
            selected[field]
            for field in (
                "all_primary_slices_passed",
                "calibration_passed",
                "convergence_passed",
                "prediction_cap_passed",
            )
        ):
            raise ContractError("benchmark gate selected a candidate without all governed evidence")
    if gate["passed"] is False and gate["selected_candidate"] is not None:
        raise ContractError("failed benchmark gate cannot select a candidate")
    _production(value["production_forecast"])
    _identity(value, "report_identity", MODEL_BENCHMARK_REPORT_SCHEMA)
    return dict(value)


def validate_calibration_report(
    value: Mapping[str, Any], *, benchmark: Mapping[str, Any]
) -> dict[str, Any]:
    expected = {
        "schema",
        "evaluation_scope",
        "research_only",
        "authority",
        "privacy",
        "benchmark_report_identity",
        "dataset_manifest_identity",
        "split_policy_identity",
        "calibration_policy_identity",
        "candidate_calibration",
        "gate",
        "report_identity",
    }
    _exact(value, expected, CALIBRATION_REPORT_SCHEMA)
    if value["schema"] != CALIBRATION_REPORT_SCHEMA:
        raise ContractError("unsupported CalibrationReport schema")
    _common(value)
    for field in (
        "benchmark_report_identity",
        "dataset_manifest_identity",
        "split_policy_identity",
        "calibration_policy_identity",
    ):
        _sha(value[field], field)
    if value["evaluation_scope"] != benchmark["evaluation_scope"]:
        raise ContractError("calibration evaluation scope drifted")
    if value["benchmark_report_identity"] != benchmark["report_identity"]:
        raise ContractError("calibration benchmark identity drifted")
    lineage = benchmark["lineage"]
    if value["dataset_manifest_identity"] != lineage["dataset_manifest_identity"]:
        raise ContractError("calibration dataset identity drifted")
    if value["split_policy_identity"] != lineage["split_policy_identity"]:
        raise ContractError("calibration split identity drifted")
    if value["calibration_policy_identity"] != lineage["calibration_policy_identity"]:
        raise ContractError("calibration policy identity drifted")
    rows = _array(value["candidate_calibration"], "candidate_calibration")
    if tuple(row.get("model") for row in rows if isinstance(row, Mapping)) != M7_FORMAL_MODEL_IDS[:6]:
        raise ContractError("calibration candidate order drifted")
    row_keys = {
        "model",
        "method",
        "primary_slice_count",
        "coverage_minimum",
        "coverage_maximum",
        "coverage_median",
        "failed_slices",
        "passed",
    }
    normalized_rows = []
    for row in rows:
        item = _object(row, "candidate calibration")
        _exact(item, row_keys, "candidate calibration")
        if (
            isinstance(item["primary_slice_count"], bool)
            or not isinstance(item["primary_slice_count"], int)
            or item["primary_slice_count"] < 0
        ):
            raise ContractError("calibration primary_slice_count must be a non-negative integer")
        for field in ("coverage_minimum", "coverage_maximum", "coverage_median"):
            value_number = _finite(item[field], field, nullable=True)
            if value_number is not None and not 0 <= value_number <= 1:
                raise ContractError(f"{field} must be within [0,1]")
        failed_slices = _array(item["failed_slices"], "calibration failed_slices")
        if (
            any(not isinstance(entry, str) for entry in failed_slices)
            or len(set(failed_slices)) != len(failed_slices)
            or not isinstance(item["passed"], bool)
        ):
            raise ContractError("candidate calibration evidence is invalid")
        primary = [
            result
            for result in benchmark["primary_results"]
            if result["model"] == item["model"]
        ]
        coverages = [
            float(result["prediction_interval_90_coverage"])
            for result in primary
            if result["prediction_interval_90_coverage"] is not None
        ]
        expected_failed = [
            f"{result['fold']}|{result['unit_type']}|{result['holdout_slice']}"
            for result in primary
            if result["prediction_interval_90_coverage"] is None
            or not 0.85 <= float(result["prediction_interval_90_coverage"]) <= 0.95
        ]
        expected_passed = len(primary) == 16 and not expected_failed
        expected_minimum = min(coverages) if coverages else None
        expected_maximum = max(coverages) if coverages else None
        expected_median = float(statistics.median(coverages)) if coverages else None
        if (
            item["primary_slice_count"] != len(primary)
            or not _nullable_close(item["coverage_minimum"], expected_minimum)
            or not _nullable_close(item["coverage_maximum"], expected_maximum)
            or not _nullable_close(item["coverage_median"], expected_median)
            or list(failed_slices) != expected_failed
            or item["passed"] is not expected_passed
        ):
            raise ContractError("candidate calibration evidence drifted from benchmark")
        normalized_rows.append(item)
    gate = _object(value["gate"], "calibration gate")
    _exact(gate, {"passed", "all_primary_slices_required"}, "calibration gate")
    if gate["all_primary_slices_required"] is not True or not isinstance(gate["passed"], bool):
        raise ContractError("aggregate calibration bypass is prohibited")
    selected = next(
        (
            row
            for row in normalized_rows
            if row["model"] == benchmark["gate"]["selected_candidate"]
        ),
        None,
    )
    expected_gate = benchmark["gate"]["passed"] is True and bool(
        selected and selected["passed"] is True
    )
    if gate["passed"] is not expected_gate:
        raise ContractError("calibration gate drifted from benchmark evidence")
    _identity(value, "report_identity", CALIBRATION_REPORT_SCHEMA)
    return dict(value)


def validate_model_card(
    value: Mapping[str, Any],
    *,
    benchmark: Mapping[str, Any],
    calibration: Mapping[str, Any],
    repo_root: Path | None = None,
) -> dict[str, Any]:
    expected = {
        "schema",
        "model_id",
        "role",
        "research_only",
        "authority",
        "privacy",
        "benchmark_report_identity",
        "calibration_report_identity",
        "lineage",
        "intended_use",
        "limitations",
        "prohibited_uses",
        "model_artifact",
        "card_identity",
    }
    _exact(value, expected, MODEL_CARD_SCHEMA)
    if value["schema"] != MODEL_CARD_SCHEMA:
        raise ContractError("unsupported ModelCard schema")
    _common(value)
    if value["model_id"] not in M7_FORMAL_MODEL_IDS or value["role"] != _CATALOG_ROLES[value["model_id"]][0]:
        raise ContractError("model card candidate role drifted")
    if value["benchmark_report_identity"] != benchmark["report_identity"]:
        raise ContractError("model card benchmark identity drifted")
    if value["calibration_report_identity"] != calibration["report_identity"]:
        raise ContractError("model card calibration identity drifted")
    if validate_lineage(value["lineage"], repo_root=repo_root) != benchmark["lineage"]:
        raise ContractError("model card lineage drifted")
    if value["intended_use"] != "aggregate-shadow-evaluation-only":
        raise ContractError("model card intended use drifted")
    if value["model_artifact"] != {
        "format": "state-dict-only-or-none",
        "admitted_for_deserialization": False,
        "bridge_consumes_checkpoint": False,
    }:
        raise ContractError("model artifact deserialization boundary drifted")
    if (
        benchmark["gate"]["passed"] is not True
        or calibration["gate"]["passed"] is not True
        or benchmark["gate"]["selected_candidate"] != value["model_id"]
        or value["model_id"] not in M7_FORMAL_MODEL_IDS[3:6]
    ):
        raise ContractError("model card lacks the exact selected governed candidate")
    _identity(value, "card_identity", MODEL_CARD_SCHEMA)
    return dict(value)


def validate_model_admission_receipt(
    value: Mapping[str, Any],
    *,
    repo_root: Path | None = None,
    benchmark: Mapping[str, Any] | None = None,
    calibration: Mapping[str, Any] | None = None,
    model_card: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    expected = {
        "schema",
        "status",
        "decision",
        "evaluation_scope",
        "full_evaluation",
        "research_only",
        "authority",
        "privacy",
        "lineage",
        "benchmark_report_identity",
        "calibration_report_identity",
        "model_card_identity",
        "selected_model",
        "reason_codes",
        "production_forecast",
        "receipt_identity",
    }
    _exact(value, expected, MODEL_ADMISSION_RECEIPT_SCHEMA)
    if value["schema"] != MODEL_ADMISSION_RECEIPT_SCHEMA:
        raise ContractError("unsupported ModelAdmissionReceipt schema")
    if value["decision"] not in {"no-promotion", "shadow-admitted"}:
        raise ContractError("invalid model admission decision")
    _common(value)
    allow_unavailable = value["status"] == "unavailable"
    receipt_lineage = validate_lineage(
        value["lineage"], allow_unavailable=allow_unavailable, repo_root=repo_root
    )
    for field in ("benchmark_report_identity", "calibration_report_identity", "model_card_identity"):
        _sha(value[field], field, nullable=True)
    if value["decision"] == "shadow-admitted":
        if (
            value["status"] != "complete"
            or value["evaluation_scope"] != "full-exact-registry"
            or value["full_evaluation"] is not True
            or value["selected_model"] not in M7_FORMAL_MODEL_IDS[3:6]
            or any(value[field] is None for field in ("benchmark_report_identity", "calibration_report_identity", "model_card_identity"))
        ):
            raise ContractError("shadow admission lacks exact full-evaluation evidence")
        if repo_root is None:
            raise ContractError("shadow admission requires the frozen governance policy")
        if benchmark is None or calibration is None or model_card is None:
            raise ContractError(
                "shadow admission requires its exact benchmark, calibration, and model card evidence"
            )
        governance = load_governance(repo_root)
        admitted_registries = governance["policy"]["admission_registry"][
            "exact_full_artifact_registry_identities"
        ]
        if receipt_lineage["artifact_registry_identity"] not in admitted_registries:
            raise ContractError(
                "shadow admission is blocked until an exact full ArtifactRegistry identity is frozen"
            )
    elif value["selected_model"] is not None:
        raise ContractError("no-promotion receipt cannot select a model")

    evidence = (
        ("benchmark_report_identity", benchmark),
        ("calibration_report_identity", calibration),
        ("model_card_identity", model_card),
    )
    for field, artifact in evidence:
        if value[field] is None and artifact is not None:
            raise ContractError(f"admission supplied {field} evidence without a declared identity")
        if value[field] is not None and artifact is None:
            raise ContractError(f"admission declared {field} without its exact evidence")

    validated_benchmark = None
    validated_calibration = None
    validated_card = None
    if benchmark is not None:
        validated_benchmark = validate_model_benchmark_report(benchmark, repo_root=repo_root)
        if value["benchmark_report_identity"] != validated_benchmark["report_identity"]:
            raise ContractError("admission benchmark identity drifted")
        if receipt_lineage != validated_benchmark["lineage"]:
            raise ContractError("admission benchmark lineage drifted")
    if calibration is not None:
        if validated_benchmark is None:
            raise ContractError("admission calibration evidence requires its exact benchmark")
        validated_calibration = validate_calibration_report(
            calibration, benchmark=validated_benchmark
        )
        if value["calibration_report_identity"] != validated_calibration["report_identity"]:
            raise ContractError("admission calibration identity drifted")
    if model_card is not None:
        if validated_benchmark is None or validated_calibration is None:
            raise ContractError("admission model card requires exact benchmark and calibration")
        validated_card = validate_model_card(
            model_card,
            benchmark=validated_benchmark,
            calibration=validated_calibration,
            repo_root=repo_root,
        )
        if value["model_card_identity"] != validated_card["card_identity"]:
            raise ContractError("admission model card identity drifted")
        if value["selected_model"] != validated_card["model_id"]:
            raise ContractError("admission selected model drifted from its model card")
    if value["decision"] == "shadow-admitted" and (
        validated_benchmark is None
        or validated_calibration is None
        or validated_card is None
        or validated_benchmark["gate"]["passed"] is not True
        or validated_calibration["gate"]["passed"] is not True
    ):
        raise ContractError("shadow admission lacks passed cross-bound evidence")
    _production(value["production_forecast"])
    _identity(value, "receipt_identity", MODEL_ADMISSION_RECEIPT_SCHEMA)
    return dict(value)


def build_unavailable_admission_receipt(repo_root: Path, reason_code: str) -> dict[str, Any]:
    core = {
        "schema": MODEL_ADMISSION_RECEIPT_SCHEMA,
        "status": "unavailable",
        "decision": "no-promotion",
        "evaluation_scope": "unavailable",
        "full_evaluation": False,
        "research_only": True,
        "authority": dict(AUTHORITY_FALSE),
        "privacy": dict(AGGREGATE_PRIVACY),
        "lineage": frozen_lineage(repo_root),
        "benchmark_report_identity": None,
        "calibration_report_identity": None,
        "model_card_identity": None,
        "selected_model": None,
        "reason_codes": [reason_code],
        "production_forecast": dict(PRODUCTION_UNAVAILABLE),
    }
    receipt = {**core, "receipt_identity": content_identity(core)}
    return validate_model_admission_receipt(receipt, repo_root=repo_root)
