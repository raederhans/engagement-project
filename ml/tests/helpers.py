from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any

from engagement_ml.constants import CATEGORY_COLUMNS
from engagement_ml.identity import content_identity, file_identity, write_json
from engagement_ml.protocol import load_protocol
from engagement_ml.registry import create_registry


def _block_for_remainder(remainder: int) -> str:
    from engagement_ml.evaluation import is_spatial_holdout

    for index in range(10_000):
        candidate = f"fixture-block:{remainder}:{index}"
        if is_spatial_holdout(candidate) is (remainder == 0):
            return candidate
    raise AssertionError("unable to construct holdout fixture")


def _weekly_rows(
    *, unit_type: str, unit_id: str, block_id: str, start: date, end: date
) -> list[dict[str, Any]]:
    rows = []
    cursor = start
    index = 0
    while cursor < end:
        count = 1 + ((index * 7 + len(unit_id)) % 9)
        category = CATEGORY_COLUMNS[index % len(CATEGORY_COLUMNS)]
        rows.append(
            {
                "schema": "engagement-area-intelligence-unit-week/v1",
                "unit_type": unit_type,
                "unit_id": unit_id,
                "spatial_block_id": block_id,
                "week_start": cursor.isoformat(),
                "week_end_exclusive": (cursor + timedelta(weeks=1)).isoformat(),
                "reported_incident_count": count,
                "category_counts": {category: count},
                "acs": {
                    "status": "available" if unit_type == "tract" else "unavailable",
                    "estimate": 3100 if unit_type == "tract" else None,
                    "moe90": 150 if unit_type == "tract" else None,
                    "model_input_eligible": False,
                    "reason": "audit-only",
                },
                "source_snapshot_indexes": [0],
                "lineage_ref": "manifest.source_snapshot_index",
            }
        )
        cursor += timedelta(weeks=1)
        index += 1
    return rows


def build_m2_fixture(
    temporary_root: Path,
    protocol_path: Path,
    *,
    order_drift: bool = False,
    manifest_row_drift: bool = False,
) -> tuple[Path, Path, Path]:
    protocol, protocol_identity = load_protocol(protocol_path)
    registry_root = temporary_root / "registry-root"
    artifact_base = registry_root / "artifact-sets" / "m2-fixture"
    artifact_base.mkdir(parents=True)
    start = date(2015, 1, 5)
    end = date(2026, 8, 24)
    holdout = _block_for_remainder(0)
    non_holdout = _block_for_remainder(1)
    unit_sets = {
        "fixed-grid": [
            ("grid-a", holdout),
            ("grid-b", non_holdout),
        ],
        "tract": [
            ("42101000001", holdout),
            ("42101000002", non_holdout),
        ],
    }
    parts = []
    total_rows = 0
    total_bytes = 0
    for unit_type in ("fixed-grid", "tract"):
        rows = []
        for unit_id, block_id in unit_sets[unit_type]:
            rows.extend(
                _weekly_rows(
                    unit_type=unit_type,
                    unit_id=unit_id,
                    block_id=block_id,
                    start=start,
                    end=end,
                )
            )
        rows.sort(key=lambda row: (row["unit_id"], row["week_start"]))
        if order_drift and unit_type == "fixed-grid":
            rows[0], rows[1] = rows[1], rows[0]
        relative = f"marts/{unit_type}/part-000.jsonl"
        destination = artifact_base / Path(*relative.split("/"))
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            "".join(
                __import__("json").dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                for row in rows
            ),
            encoding="utf-8",
            newline="\n",
        )
        size, digest = file_identity(destination)
        declared_rows = len(rows) + (1 if manifest_row_drift and unit_type == "fixed-grid" else 0)
        parts.append(
            {
                "path": relative,
                "unit_type": unit_type,
                "partition": 0,
                "row_count": declared_rows,
                "unit_ids": sorted(unit_id for unit_id, _ in unit_sets[unit_type]),
                "first_week": start.isoformat(),
                "last_week": (end - timedelta(weeks=1)).isoformat(),
                "bytes": size,
                "mtime_ms": 0,
                "sha256": digest.removeprefix("sha256:"),
            }
        )
        total_rows += declared_rows
        total_bytes += size
    part_bindings = [
        {
            "path": part["path"],
            "unit_type": part["unit_type"],
            "partition": part["partition"],
            "row_count": part["row_count"],
            "bytes": part["bytes"],
            "sha256": part["sha256"],
        }
        for part in parts
    ]
    manifest_core = {
        "schema": "engagement-area-intelligence-feature-mart/v2",
        "protocol": {
            "schema": protocol["schema"],
            "sha256": protocol_identity,
            "receipt_sha256": protocol["exact_input_gate"]["receipt_sha256"],
            "frozen_at": protocol["frozen_at"],
            "frozen_before_model_performance": True,
        },
        "exact_input": {
            "receipt_schema": protocol["exact_input_gate"]["receipt_schema"],
            "receipt_identity": protocol["exact_input_gate"]["receipt_identity"],
            "receipt_sha256": protocol["exact_input_gate"]["receipt_sha256"],
            "counts": {"canonical_rows": total_rows},
            "canonical": {"row_count": total_rows},
        },
        "source_coverage": {"start": start.isoformat(), "end_exclusive": end.isoformat()},
        "evaluation_complete_week_end_exclusive": end.isoformat(),
        "source_snapshot_index": [{"index": 0, "snapshot_id": "sha256:" + "1" * 64}],
        "transforms": {"week": protocol["target"]["week_definition"]},
        "admission": {
            "canonical_rows_seen": total_rows,
            "tract": {"admitted": total_rows // 2, "ambiguous_excluded": 0, "unmapped_excluded": 0},
            "fixed-grid": {"admitted": total_rows // 2, "unavailable_excluded": 0},
            "unknown_category": 0,
            "invalid_event_time": 0,
            "non_active": 0,
        },
        "output_partition_count": 1,
        "parts": parts,
        "part_bindings_identity": content_identity(part_bindings),
        "row_count": total_rows,
        "bytes": total_bytes,
        "unit_count": {"tract": 2, "fixed-grid": 2},
        "artifact_policy": {
            "event_level_data_included": False,
            "coordinates_included": False,
            "generalized_locations_included": False,
            "git_policy": "fixture",
        },
    }
    manifest = {
        **manifest_core,
        "artifact_identity": content_identity(manifest_core),
        "generated_at": "2026-08-31T00:00:00.000Z",
    }
    write_json(artifact_base / "manifest.json", manifest)
    objects = []
    partitions = []
    for index, relative in enumerate(["manifest.json", *[part["path"] for part in parts]]):
        path = artifact_base / Path(*relative.split("/"))
        size, digest = file_identity(path)
        row_count = None if relative == "manifest.json" else sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line)
        object_id = "manifest" if relative == "manifest.json" else f"part-{index:03d}"
        objects.append(
            {
                "objectId": object_id,
                "relativePath": relative,
                "mediaType": "application/json" if row_count is None else "application/x-ndjson",
                "bytes": size,
                "sha256": digest,
                "rowCount": row_count,
            }
        )
        if row_count is not None:
            partitions.append(
                {"partitionId": f"partition-{index:03d}", "objectIds": [object_id], "rowCount": row_count}
            )
    registry_core = {
        "protocol": "ArtifactRegistry/v1",
        "artifactSetId": "artifact-set:m2-fixture",
        "sourceScope": {
            "sourceId": "m2-fixture",
            "scopeId": "aggregate-unit-week",
            "revision": "fixture-20260831",
            "dataClassification": "synthetic-test",
        },
        "clocks": {
            "sourceAsOf": "2026-08-28T00:00:00.000Z",
            "retrievedAt": "2026-08-29T00:00:00.000Z",
            "builtAt": "2026-08-30T00:00:00.000Z",
            "observedAt": "2026-08-31T00:00:00.000Z",
        },
        "versions": {
            "producer": {"name": "synthetic-fixture", "version": "1.0.0"},
            "schema": {"name": "engagement-area-intelligence-unit-week", "version": "1.0.0"},
            "transform": {"name": "fixture-partitioner", "version": "1.0.0"},
        },
        "locations": [{"scheme": "file", "basePath": "artifact-sets/m2-fixture"}],
        "objects": objects,
        "partitionInventory": {
            "partitions": partitions,
            "unpartitionedObjectIds": ["manifest"],
            "totalObjectCount": len(objects),
            "totalBytes": sum(item["bytes"] for item in objects),
            "totalRowCount": sum(item["rowCount"] or 0 for item in objects),
        },
        "retention": {
            "state": "retained",
            "decisionOwner": "ml-fixture-owner",
            "deletePrerequisites": [
                "artifact-integrity-rechecked",
                "downstream-dependencies-cleared",
                "explicit-owner-decision-recorded",
                "retention-period-satisfied",
            ],
        },
        "authority": {"serving": False, "promotion": False, "deletion": False},
    }
    registry = create_registry(registry_core)
    registry_path = temporary_root / "registry.json"
    write_json(registry_path, registry)
    return registry_path, registry_root, artifact_base
