from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from .constants import ML_DATASET_MANIFEST_SCHEMA, ML_RESEARCH_RUN_SCHEMA
from .identity import content_identity

_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_SAFE_PATH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$")


class ContractError(ValueError):
    """A fail-closed contract rejection."""


def _exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        raise ContractError(
            f"{label} schema mismatch; missing={sorted(expected - actual)}, "
            f"unknown={sorted(actual - expected)}"
        )


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ContractError(f"{label} must be a sha256 identity")
    return value


def _timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ContractError(f"{label} must be an exact UTC timestamp")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractError(f"{label} must be an exact UTC timestamp") from error
    return value


def validate_ml_research_run(value: Mapping[str, Any]) -> dict[str, Any]:
    expected = {
        "schema",
        "research_only",
        "serving_authority",
        "promotion_authority",
        "input_identity",
        "protocol_identity",
        "dataset_manifest_identity",
        "feature_schema_identity",
        "model_identity",
        "environment",
        "hardware",
        "device",
        "seed",
        "determinism",
        "started_at",
        "completed_at",
    }
    _exact_keys(value, expected, "MLResearchRun/v1")
    if value["schema"] != ML_RESEARCH_RUN_SCHEMA:
        raise ContractError("unsupported MLResearchRun schema")
    if value["research_only"] is not True:
        raise ContractError("research_only must be exactly true")
    for authority in ("serving_authority", "promotion_authority"):
        if value[authority] is not False:
            raise ContractError(f"{authority} must be exactly false")
    for identity in (
        "input_identity",
        "protocol_identity",
        "dataset_manifest_identity",
        "feature_schema_identity",
        "model_identity",
    ):
        _digest(value[identity], identity)
    for name in ("environment", "hardware", "determinism"):
        if not isinstance(value[name], Mapping) or not value[name]:
            raise ContractError(f"{name} must be a non-empty object")
    if value["device"] not in {"cpu", "cuda", "mps"}:
        raise ContractError("device must be cpu, cuda, or mps")
    if not isinstance(value["seed"], int) or isinstance(value["seed"], bool) or value["seed"] < 0:
        raise ContractError("seed must be a non-negative integer")
    determinism = value["determinism"]
    if determinism.get("cross_platform_byte_identical") is not False:
        raise ContractError("cross_platform_byte_identical must be exactly false")
    _timestamp(value["started_at"], "started_at")
    if value["completed_at"] is not None:
        _timestamp(value["completed_at"], "completed_at")
    return dict(value)


def validate_ml_dataset_manifest(value: Mapping[str, Any]) -> dict[str, Any]:
    expected = {
        "schema",
        "research_only",
        "serving_authority",
        "promotion_authority",
        "source",
        "transformation",
        "input_parts",
        "input_part_bindings_identity",
        "output_parts",
        "row_count",
        "unit_count",
        "feature_columns",
        "target_columns",
        "date_range",
        "privacy",
        "dataset_identity",
    }
    _exact_keys(value, expected, "MLDatasetManifest/v1")
    if value["schema"] != ML_DATASET_MANIFEST_SCHEMA:
        raise ContractError("unsupported MLDatasetManifest schema")
    if value["research_only"] is not True:
        raise ContractError("dataset manifest must remain research_only")
    if value["serving_authority"] is not False or value["promotion_authority"] is not False:
        raise ContractError("dataset manifest cannot grant authority")
    source = value["source"]
    if not isinstance(source, Mapping):
        raise ContractError("source must be an object")
    _exact_keys(
        source,
        {"artifact_registry_identity", "m1_receipt_identity", "m2_mart_identity", "protocol_identity"},
        "source",
    )
    for key, identity in source.items():
        _digest(identity, f"source.{key}")
    transformation = value["transformation"]
    if not isinstance(transformation, Mapping):
        raise ContractError("transformation must be an object")
    _exact_keys(transformation, {"name", "version", "identity"}, "transformation")
    _digest(transformation["identity"], "transformation.identity")
    for name in ("input_parts", "output_parts"):
        parts = value[name]
        if not isinstance(parts, Sequence) or isinstance(parts, (str, bytes)):
            raise ContractError(f"{name} must be an array")
        seen_paths: set[str] = set()
        row_total = 0
        for index, part in enumerate(parts):
            if not isinstance(part, Mapping):
                raise ContractError(f"{name}[{index}] must be an object")
            _exact_keys(
                part,
                {"path", "unit_type", "partition", "row_count", "bytes", "sha256"},
                f"{name}[{index}]",
            )
            path = part["path"]
            if not isinstance(path, str) or not _SAFE_PATH.fullmatch(path) or path in seen_paths:
                raise ContractError(f"{name}[{index}].path is invalid or duplicated")
            seen_paths.add(path)
            if part["unit_type"] not in {"tract", "fixed-grid"}:
                raise ContractError(f"{name}[{index}].unit_type is invalid")
            for field in ("partition", "row_count", "bytes"):
                field_value = part[field]
                if (
                    not isinstance(field_value, int)
                    or isinstance(field_value, bool)
                    or field_value < 0
                ):
                    raise ContractError(f"{name}[{index}].{field} is invalid")
            _digest(part["sha256"], f"{name}[{index}].sha256")
            row_total += part["row_count"]
        if name == "output_parts" and row_total != value["row_count"]:
            raise ContractError("output part row total drifted")
    for name in ("feature_columns", "target_columns"):
        columns = value[name]
        if not isinstance(columns, Sequence) or isinstance(columns, (str, bytes)):
            raise ContractError(f"{name} must be an array")
        if any(not isinstance(column, str) or not column for column in columns):
            raise ContractError(f"{name} must contain non-empty strings")
        if len(columns) != len(set(columns)):
            raise ContractError(f"{name} must be unique")
    if list(value["target_columns"]) != ["reported_incident_count"]:
        raise ContractError("target_columns drifted")
    _digest(value["input_part_bindings_identity"], "input_part_bindings_identity")
    if not isinstance(value["row_count"], int) or value["row_count"] < 0:
        raise ContractError("row_count must be a non-negative integer")
    unit_count = value["unit_count"]
    if not isinstance(unit_count, Mapping):
        raise ContractError("unit_count must be an object")
    _exact_keys(unit_count, {"tract", "fixed-grid"}, "unit_count")
    if any(not isinstance(count, int) or isinstance(count, bool) or count < 0 for count in unit_count.values()):
        raise ContractError("unit_count values must be non-negative integers")
    date_range = value["date_range"]
    if not isinstance(date_range, Mapping):
        raise ContractError("date_range must be an object")
    _exact_keys(date_range, {"start", "end_inclusive"}, "date_range")
    if value["row_count"] > 0 and (
        not isinstance(date_range["start"], str)
        or not isinstance(date_range["end_inclusive"], str)
        or date_range["start"] > date_range["end_inclusive"]
    ):
        raise ContractError("date_range is invalid")
    privacy = value["privacy"]
    expected_privacy = {
        "aggregate_only": True,
        "event_level_data_included": False,
        "coordinates_included": False,
        "generalized_locations_included": False,
        "raw_or_canonical_events_included": False,
        "source_record_ids_included": False,
    }
    if privacy != expected_privacy:
        raise ContractError("privacy must be exact aggregate-only semantics")
    core = dict(value)
    declared = core.pop("dataset_identity")
    if declared != content_identity(core):
        raise ContractError("dataset_identity drifted")
    return dict(value)
