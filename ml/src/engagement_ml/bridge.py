from __future__ import annotations

import math
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from .constants import (
    CATEGORY_COLUMNS,
    MART_MANIFEST_SCHEMA,
    MART_ROW_SCHEMA,
    ML_DATASET_MANIFEST_SCHEMA,
    V1_FEATURE_COLUMNS,
)
from .contracts import ContractError, validate_ml_dataset_manifest
from .features import (
    baseline_predictions,
    feature_schema_v1,
    feature_schema_v2,
    feature_values_in_schema_order,
    feature_vector_v2,
    legacy_feature_vector,
)
from .identity import (
    bindings_identity,
    content_identity,
    file_identity,
    strict_json_load,
    strict_json_loads,
    write_json,
)
from .protocol import load_protocol
from .registry import load_registry, observe_registry, resolve_artifact_base

_MART_KEYS = {
    "schema",
    "protocol",
    "exact_input",
    "source_coverage",
    "evaluation_complete_week_end_exclusive",
    "source_snapshot_index",
    "transforms",
    "admission",
    "output_partition_count",
    "parts",
    "part_bindings_identity",
    "row_count",
    "bytes",
    "unit_count",
    "artifact_policy",
    "artifact_identity",
    "generated_at",
}
_ROW_KEYS = {
    "schema",
    "unit_type",
    "unit_id",
    "spatial_block_id",
    "week_start",
    "week_end_exclusive",
    "reported_incident_count",
    "category_counts",
    "acs",
    "source_snapshot_indexes",
    "lineage_ref",
}
_FORBIDDEN_KEYS = {
    "event_id",
    "event_ids",
    "source_record_id",
    "source_record_ids",
    "coordinate",
    "coordinates",
    "latitude",
    "longitude",
    "raw_row",
    "raw_rows",
    "canonical_event",
    "canonical_events",
}


@dataclass(frozen=True)
class M2Admission:
    registry: dict[str, Any]
    artifact_base: Path
    manifest: dict[str, Any]
    protocol: dict[str, Any]
    protocol_identity: str


def _assert_no_forbidden_keys(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key in _FORBIDDEN_KEYS:
                raise ContractError("aggregate-only artifact contains a forbidden event-level key")
            _assert_no_forbidden_keys(child)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for child in value:
            _assert_no_forbidden_keys(child)


def _mart_part_bindings(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "path": part["path"],
            "unit_type": part["unit_type"],
            "partition": part["partition"],
            "row_count": part["row_count"],
            "bytes": part["bytes"],
            "sha256": part["sha256"],
        }
        for part in manifest["parts"]
    ]


def admit_m2_artifact_set(
    *, registry_path: Path, registry_root: Path, protocol_path: Path
) -> M2Admission:
    registry = load_registry(registry_path)
    artifact_base = resolve_artifact_base(registry, registry_root)
    observe_registry(registry, artifact_base)
    protocol, protocol_identity = load_protocol(protocol_path)

    object_paths = {item["relativePath"] for item in registry["objects"]}
    if "manifest.json" not in object_paths:
        raise ContractError("ArtifactRegistry must bind manifest.json")
    manifest_value = strict_json_load(artifact_base / "manifest.json")
    if not isinstance(manifest_value, Mapping):
        raise ContractError("M2 manifest must be an object")
    manifest = dict(manifest_value)
    if set(manifest) != _MART_KEYS:
        raise ContractError("M2 manifest schema drifted")
    _assert_no_forbidden_keys(manifest)
    if manifest["schema"] != MART_MANIFEST_SCHEMA:
        raise ContractError("unsupported M2 mart schema")
    if manifest.get("protocol", {}).get("sha256") != protocol_identity:
        raise ContractError("M2 protocol identity drifted")
    receipt_sha = protocol["exact_input_gate"]["receipt_sha256"]
    if manifest["protocol"].get("receipt_sha256", receipt_sha) != receipt_sha:
        raise ContractError("M2 protocol receipt binding drifted")
    exact_input = manifest["exact_input"]
    if exact_input.get("receipt_identity") != protocol["exact_input_gate"]["receipt_identity"]:
        raise ContractError("M1 receipt identity drifted")
    if exact_input.get("receipt_sha256") != receipt_sha:
        raise ContractError("M1 receipt bytes drifted")
    if manifest.get("artifact_policy", {}).get("event_level_data_included") is not False:
        raise ContractError("M2 mart is not aggregate-only")
    if manifest["admission"].get("unknown_category") != 0:
        raise ContractError("M2 admission contains unknown categories")
    if manifest["admission"].get("invalid_event_time") != 0:
        raise ContractError("M2 admission contains invalid event time")
    if manifest["admission"].get("non_active") != 0:
        raise ContractError("M2 admission contains non-active rows")

    parts = manifest["parts"]
    if not isinstance(parts, list) or not parts:
        raise ContractError("M2 mart must contain parts")
    expected_paths = {"manifest.json"}
    row_count = 0
    byte_count = 0
    previous_path = ""
    registry_by_path = {item["relativePath"]: item for item in registry["objects"]}
    for part in parts:
        if not isinstance(part, Mapping):
            raise ContractError("M2 part binding must be an object")
        path = part.get("path")
        unit_type = part.get("unit_type")
        partition = part.get("partition")
        expected_path = f"marts/{unit_type}/part-{partition:03d}.jsonl" if isinstance(partition, int) else ""
        if path != expected_path or unit_type not in {"tract", "fixed-grid"} or path <= previous_path:
            raise ContractError("M2 part path, unit type, partition, or ordering drifted")
        previous_path = path
        expected_paths.add(path)
        registry_object = registry_by_path.get(path)
        if registry_object is None:
            raise ContractError(f"ArtifactRegistry does not bind M2 part: {path}")
        if registry_object["rowCount"] != part.get("row_count"):
            raise ContractError(f"registry/manifest row drift: {path}")
        if registry_object["bytes"] != part.get("bytes"):
            raise ContractError(f"registry/manifest byte drift: {path}")
        if registry_object["sha256"] != f"sha256:{part.get('sha256')}":
            raise ContractError(f"registry/manifest hash drift: {path}")
        row_count += int(part["row_count"])
        byte_count += int(part["bytes"])
    if object_paths != expected_paths:
        raise ContractError("ArtifactRegistry object set must exactly equal manifest plus M2 parts")
    if manifest["row_count"] != row_count or manifest["bytes"] != byte_count:
        raise ContractError("M2 manifest totals drifted")
    if manifest["part_bindings_identity"] != bindings_identity(_mart_part_bindings(manifest)):
        raise ContractError("M2 part bindings identity drifted")
    manifest_core = dict(manifest)
    manifest_core.pop("artifact_identity")
    manifest_core.pop("generated_at")
    if manifest["artifact_identity"] != content_identity(manifest_core):
        raise ContractError("M2 artifact identity drifted")
    return M2Admission(
        registry=registry,
        artifact_base=artifact_base,
        manifest=manifest,
        protocol=protocol,
        protocol_identity=protocol_identity,
    )


def _validate_row(value: Any, expected_unit_type: str) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != _ROW_KEYS:
        raise ContractError("M2 row schema drifted")
    row = dict(value)
    _assert_no_forbidden_keys(row)
    if row["schema"] != MART_ROW_SCHEMA or row["unit_type"] != expected_unit_type:
        raise ContractError("M2 row schema or unit type drifted")
    for name in ("unit_id", "spatial_block_id", "week_start", "week_end_exclusive"):
        if not isinstance(row[name], str) or not row[name]:
            raise ContractError(f"M2 row {name} is invalid")
    start = date.fromisoformat(row["week_start"])
    end = date.fromisoformat(row["week_end_exclusive"])
    if start.weekday() != 0 or end - start != timedelta(days=7):
        raise ContractError("M2 row week is not Monday-aligned")
    count = row["reported_incident_count"]
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise ContractError("M2 sparse row count must be a positive integer")
    categories = row["category_counts"]
    if not isinstance(categories, Mapping) or any(key not in CATEGORY_COLUMNS for key in categories):
        raise ContractError("M2 category vocabulary drifted")
    if any(not isinstance(item, int) or isinstance(item, bool) or item < 1 for item in categories.values()):
        raise ContractError("M2 category counts must be positive integers")
    if sum(categories.values()) != count:
        raise ContractError("M2 category counts do not sum to target")
    indexes = row["source_snapshot_indexes"]
    if not isinstance(indexes, list) or indexes != sorted(set(indexes)):
        raise ContractError("M2 snapshot indexes drifted")
    if row["lineage_ref"] != "manifest.source_snapshot_index":
        raise ContractError("M2 row lineage reference drifted")
    acs = row["acs"]
    if not isinstance(acs, Mapping) or not {"status", "estimate", "moe90"}.issubset(acs):
        raise ContractError("M2 ACS audit fields drifted")
    return row


def _iter_part_units(path: Path, expected_unit_type: str) -> Iterator[list[dict[str, Any]]]:
    current_unit: str | None = None
    previous_unit = ""
    previous_week = ""
    rows: list[dict[str, Any]] = []
    with path.open("rb") as stream:
        for raw_line in stream:
            if not raw_line.strip():
                continue
            row = _validate_row(strict_json_loads(raw_line), expected_unit_type)
            unit = row["unit_id"]
            week = row["week_start"]
            if current_unit is not None and unit != current_unit:
                if unit <= previous_unit:
                    raise ContractError("M2 unit ordering drifted")
                yield rows
                rows = []
                previous_week = ""
            if unit == current_unit and week <= previous_week:
                raise ContractError("M2 week ordering or uniqueness drifted")
            current_unit = unit
            previous_unit = unit
            previous_week = week
            rows.append(row)
    if rows:
        yield rows


def _feature_schema(feature_version: str) -> dict[str, Any]:
    if feature_version == "v1":
        return feature_schema_v1()
    if feature_version == "v2":
        return feature_schema_v2()
    raise ContractError("feature version must be v1 or v2")


def _dense_rows(
    sparse_rows: list[dict[str, Any]],
    *,
    complete_end: date,
    feature_version: str,
    legacy_parity_passed: bool,
) -> list[dict[str, Any]]:
    first = sparse_rows[0]
    start = date.fromisoformat(first["week_start"])
    admitted = {date.fromisoformat(row["week_start"]): row for row in sparse_rows if date.fromisoformat(row["week_start"]) < complete_end}
    if not admitted:
        return []
    weeks = (complete_end - start).days // 7
    counts = [int(admitted.get(start + timedelta(weeks=index), {}).get("reported_incident_count", 0)) for index in range(weeks)]
    category_counts = {
        category: [int(admitted.get(start + timedelta(weeks=index), {}).get("category_counts", {}).get(category, 0)) for index in range(weeks)]
        for category in CATEGORY_COLUMNS
    }
    acs_estimate: float | None = None
    acs_moe90: float | None = None
    for row in sparse_rows:
        estimate = row["acs"].get("estimate")
        moe90 = row["acs"].get("moe90")
        if isinstance(estimate, (int, float)) and math.isfinite(float(estimate)):
            acs_estimate = float(estimate)
        if isinstance(moe90, (int, float)) and math.isfinite(float(moe90)):
            acs_moe90 = float(moe90)
    schema = _feature_schema(feature_version)
    dense: list[dict[str, Any]] = []
    for index in range(52, weeks):
        week = start + timedelta(weeks=index)
        week_text = week.isoformat()
        v1 = legacy_feature_vector(counts, index, week_text)
        baselines = baseline_predictions(counts, index)
        if v1 is None or baselines is None:
            continue
        record: dict[str, Any] = {
            "unit_type": first["unit_type"],
            "unit_id": first["unit_id"],
            "spatial_block_id": first["spatial_block_id"],
            "week_start": week_text,
            "reported_incident_count": counts[index],
            "acs_estimate": acs_estimate,
            "acs_moe90": acs_moe90,
            "baseline_seasonal_naive_52w": baselines["seasonal_naive_52w"],
            "baseline_moving_average_4w": baselines["moving_average_4w"],
            "baseline_moving_average_13w": baselines["moving_average_13w"],
            "baseline_ewma": baselines["ewma"],
        }
        for category in CATEGORY_COLUMNS:
            record[f"category_{category}"] = category_counts[category][index]
        if feature_version == "v1":
            record.update(dict(zip(V1_FEATURE_COLUMNS, v1, strict=True)))
        else:
            values = feature_vector_v2(
                counts,
                index,
                week_text,
                unit_type=first["unit_type"],
                legacy_parity_passed=legacy_parity_passed,
            )
            record.update(dict(zip((item["name"] for item in schema["features"]), feature_values_in_schema_order(values, schema), strict=True)))
        dense.append(record)
    return dense


def _arrow_table(records: list[dict[str, Any]], feature_columns: list[str]) -> pa.Table:
    fields = [
        pa.field("unit_type", pa.string(), nullable=False),
        pa.field("unit_id", pa.string(), nullable=False),
        pa.field("spatial_block_id", pa.string(), nullable=False),
        pa.field("week_start", pa.string(), nullable=False),
        pa.field("reported_incident_count", pa.int64(), nullable=False),
        pa.field("acs_estimate", pa.float64()),
        pa.field("acs_moe90", pa.float64()),
        *[pa.field(f"category_{category}", pa.int64(), nullable=False) for category in CATEGORY_COLUMNS],
        pa.field("baseline_seasonal_naive_52w", pa.float64(), nullable=False),
        pa.field("baseline_moving_average_4w", pa.float64(), nullable=False),
        pa.field("baseline_moving_average_13w", pa.float64(), nullable=False),
        pa.field("baseline_ewma", pa.float64(), nullable=False),
        *[pa.field(name, pa.float64(), nullable=False) for name in feature_columns],
    ]
    schema = pa.schema(fields)
    columns = {field.name: [record[field.name] for record in records] for field in fields}
    return pa.table(columns, schema=schema)


def convert_m2_to_parquet(
    *,
    registry_path: Path,
    registry_root: Path,
    protocol_path: Path,
    output_root: Path,
    feature_version: str = "v1",
    legacy_parity_passed: bool = False,
) -> dict[str, Any]:
    admission = admit_m2_artifact_set(
        registry_path=registry_path, registry_root=registry_root, protocol_path=protocol_path
    )
    if feature_version == "v2" and not legacy_parity_passed:
        raise ContractError("FeatureSchema/v2 is blocked until six-feature parity passes")
    if output_root.exists() and any(output_root.iterdir()):
        raise ContractError("dataset output root must be absent or empty")
    output_root.mkdir(parents=True, exist_ok=True)
    schema = _feature_schema(feature_version)
    feature_columns = [item["name"] for item in schema["features"]]
    complete_end = date.fromisoformat(admission.manifest["evaluation_complete_week_end_exclusive"])

    output_parts: list[dict[str, Any]] = []
    total_rows = 0
    units = {"tract": 0, "fixed-grid": 0}
    minimum_week: str | None = None
    maximum_week: str | None = None
    for part in admission.manifest["parts"]:
        input_path = admission.artifact_base / Path(*part["path"].split("/"))
        records: list[dict[str, Any]] = []
        for unit_rows in _iter_part_units(input_path, part["unit_type"]):
            units[part["unit_type"]] += 1
            records.extend(
                _dense_rows(
                    unit_rows,
                    complete_end=complete_end,
                    feature_version=feature_version,
                    legacy_parity_passed=legacy_parity_passed,
                )
            )
        relative = f"data/{part['unit_type']}/part-{part['partition']:03d}.parquet"
        destination = output_root / Path(*relative.split("/"))
        destination.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(
            _arrow_table(records, feature_columns),
            destination,
            compression="zstd",
            compression_level=3,
            data_page_version="1.0",
            row_group_size=65_536,
            use_dictionary=False,
            version="2.6",
            write_statistics=True,
        )
        size, digest = file_identity(destination)
        output_parts.append(
            {
                "path": relative,
                "unit_type": part["unit_type"],
                "partition": part["partition"],
                "row_count": len(records),
                "bytes": size,
                "sha256": digest,
            }
        )
        total_rows += len(records)
        if records:
            part_weeks = [record["week_start"] for record in records]
            minimum_week = min(minimum_week or min(part_weeks), min(part_weeks))
            maximum_week = max(maximum_week or max(part_weeks), max(part_weeks))

    if units != admission.manifest["unit_count"]:
        raise ContractError("M2 observed unit inventory drifted")
    observe_registry(admission.registry, admission.artifact_base)

    input_parts = [
        {
            "path": part["path"],
            "unit_type": part["unit_type"],
            "partition": part["partition"],
            "row_count": part["row_count"],
            "bytes": part["bytes"],
            "sha256": f"sha256:{part['sha256']}",
        }
        for part in admission.manifest["parts"]
    ]
    transformation_core = {
        "name": "engagement-aggregate-m2-jsonl-to-parquet",
        "version": "1.0.0",
        "feature_schema_identity": schema["identity"],
        "zero_fill": "from each admitted unit first observed week to complete end, features strictly before target",
        "parquet": {
            "version": "2.6",
            "compression": "zstd-3",
            "row_group_size": 65_536,
            "dictionary": False,
        },
    }
    transformation = {
        "name": transformation_core["name"],
        "version": transformation_core["version"],
        "identity": content_identity(transformation_core),
    }
    manifest_core: dict[str, Any] = {
        "schema": ML_DATASET_MANIFEST_SCHEMA,
        "research_only": True,
        "serving_authority": False,
        "promotion_authority": False,
        "source": {
            "artifact_registry_identity": admission.registry["registryIdentity"],
            "m1_receipt_identity": admission.manifest["exact_input"]["receipt_identity"],
            "m2_mart_identity": admission.manifest["artifact_identity"],
            "protocol_identity": admission.protocol_identity,
        },
        "transformation": transformation,
        "input_parts": input_parts,
        "input_part_bindings_identity": admission.manifest["part_bindings_identity"],
        "output_parts": output_parts,
        "row_count": total_rows,
        "unit_count": units,
        "feature_columns": feature_columns,
        "target_columns": ["reported_incident_count"],
        "date_range": {"start": minimum_week, "end_inclusive": maximum_week},
        "privacy": {
            "aggregate_only": True,
            "event_level_data_included": False,
            "coordinates_included": False,
            "generalized_locations_included": False,
            "raw_or_canonical_events_included": False,
            "source_record_ids_included": False,
        },
    }
    dataset_manifest = {**manifest_core, "dataset_identity": content_identity(manifest_core)}
    validate_ml_dataset_manifest(dataset_manifest)
    write_json(output_root / "manifest.json", dataset_manifest)
    return dataset_manifest
