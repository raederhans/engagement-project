from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

from .constants import ARTIFACT_REGISTRY_PROTOCOL
from .contracts import ContractError
from .identity import content_identity, file_identity, line_count, strict_json_load

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$")
_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$")
_RELATIVE_PATH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)*$")
_SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
_MEDIA_TYPE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")
_LINE_MEDIA_TYPES = {"application/jsonl", "application/ndjson", "application/x-ndjson"}
_CORE_KEYS = {
    "protocol",
    "artifactSetId",
    "sourceScope",
    "clocks",
    "versions",
    "locations",
    "objects",
    "partitionInventory",
    "retention",
    "authority",
}
_DELETE_PREREQUISITES = {
    "artifact-integrity-rechecked",
    "downstream-dependencies-cleared",
    "explicit-owner-decision-recorded",
    "retention-period-satisfied",
}


def _exact(value: Any, keys: set[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != keys:
        actual = set(value) if isinstance(value, Mapping) else set()
        raise ContractError(
            f"{label} schema mismatch; missing={sorted(keys - actual)}, unknown={sorted(actual - keys)}"
        )
    return value


def _text(value: Any, pattern: re.Pattern[str], label: str, maximum: int = 128) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or len(value) > maximum
        or not pattern.fullmatch(value)
    ):
        raise ContractError(f"{label} has an unsupported value")
    return value


def _count(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > 2**53 - 1:
        raise ContractError(f"{label} must be a non-negative safe integer")
    return value


def _timestamp(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ContractError(f"{label} must be an exact UTC timestamp")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ContractError(f"{label} must be an exact UTC timestamp") from error
    return value


def _relative_path(value: Any, label: str) -> str:
    return _text(value, _RELATIVE_PATH, label, 512)


def _normalise_core(value: Mapping[str, Any]) -> dict[str, Any]:
    core = _exact(value, _CORE_KEYS, "artifact registry core")
    if core["protocol"] != ARTIFACT_REGISTRY_PROTOCOL:
        raise ContractError("unsupported ArtifactRegistry protocol")
    artifact_set_id = _text(core["artifactSetId"], _IDENTIFIER, "artifactSetId")
    if not artifact_set_id.startswith("artifact-set:"):
        raise ContractError("artifactSetId must use artifact-set: namespace")

    source = _exact(
        core["sourceScope"],
        {"sourceId", "scopeId", "revision", "dataClassification"},
        "sourceScope",
    )
    source_scope = {
        key: _text(source[key], _IDENTIFIER, f"sourceScope.{key}")
        for key in ("sourceId", "scopeId", "revision", "dataClassification")
    }

    clocks_value = _exact(
        core["clocks"], {"sourceAsOf", "retrievedAt", "builtAt", "observedAt"}, "clocks"
    )
    clocks = {key: _timestamp(clocks_value[key], f"clocks.{key}") for key in clocks_value}
    clock_order = [clocks[key] for key in ("sourceAsOf", "retrievedAt", "builtAt", "observedAt")]
    if clock_order != sorted(clock_order):
        raise ContractError("registry clocks are out of order")

    versions_value = _exact(core["versions"], {"producer", "schema", "transform"}, "versions")
    versions: dict[str, dict[str, str]] = {}
    for key in ("producer", "schema", "transform"):
        descriptor = _exact(versions_value[key], {"name", "version"}, f"versions.{key}")
        versions[key] = {
            "name": _text(descriptor["name"], _IDENTIFIER, f"versions.{key}.name"),
            "version": _text(descriptor["version"], _VERSION, f"versions.{key}.version"),
        }

    locations_value = core["locations"]
    if not isinstance(locations_value, Sequence) or isinstance(locations_value, (str, bytes)):
        raise ContractError("locations must be an array")
    if not 1 <= len(locations_value) <= 2:
        raise ContractError("locations must contain one or two entries")
    locations: list[dict[str, str]] = []
    for index, location_value in enumerate(locations_value):
        location = _exact(location_value, {"scheme", "basePath"}, f"locations[{index}]")
        if location["scheme"] != "file":
            raise ContractError("ML input permits only an exact local file registry location")
        locations.append({"scheme": "file", "basePath": _relative_path(location["basePath"], "basePath")})
    if len({entry["scheme"] for entry in locations}) != len(locations):
        raise ContractError("duplicate registry location scheme")
    locations.sort(key=lambda entry: entry["scheme"])

    objects_value = core["objects"]
    if not isinstance(objects_value, Sequence) or isinstance(objects_value, (str, bytes)) or not objects_value:
        raise ContractError("objects must be a non-empty array")
    objects: list[dict[str, Any]] = []
    object_ids: set[str] = set()
    object_paths: set[str] = set()
    object_hashes: set[str] = set()
    for index, object_value in enumerate(objects_value):
        item = _exact(
            object_value,
            {"objectId", "relativePath", "mediaType", "bytes", "sha256", "rowCount"},
            f"objects[{index}]",
        )
        object_id = _text(item["objectId"], _IDENTIFIER, "objectId")
        relative_path = _relative_path(item["relativePath"], "relativePath")
        media_type = _text(item["mediaType"], _MEDIA_TYPE, "mediaType", 127)
        digest = _text(item["sha256"], _SHA256, "sha256", 71)
        row_count_value = item["rowCount"]
        row_count = None if row_count_value is None else _count(row_count_value, "rowCount")
        if row_count is not None and media_type not in _LINE_MEDIA_TYPES and not relative_path.endswith((".jsonl", ".ndjson")):
            raise ContractError("rowCount is only valid for line-delimited JSON")
        if object_id in object_ids or relative_path in object_paths or digest in object_hashes:
            raise ContractError("registry object id, path, and digest must each be unique")
        object_ids.add(object_id)
        object_paths.add(relative_path)
        object_hashes.add(digest)
        objects.append(
            {
                "objectId": object_id,
                "relativePath": relative_path,
                "mediaType": media_type,
                "bytes": _count(item["bytes"], "bytes"),
                "sha256": digest,
                "rowCount": row_count,
            }
        )
    objects.sort(key=lambda item: item["objectId"])
    objects_by_id = {item["objectId"]: item for item in objects}

    inventory_value = _exact(
        core["partitionInventory"],
        {"partitions", "unpartitionedObjectIds", "totalObjectCount", "totalBytes", "totalRowCount"},
        "partitionInventory",
    )
    partitions_value = inventory_value["partitions"]
    unpartitioned_value = inventory_value["unpartitionedObjectIds"]
    if not isinstance(partitions_value, list) or not isinstance(unpartitioned_value, list):
        raise ContractError("partition inventory arrays are required")
    assigned: set[str] = set()
    partitions: list[dict[str, Any]] = []
    partition_ids: set[str] = set()
    for index, partition_value in enumerate(partitions_value):
        partition = _exact(
            partition_value, {"partitionId", "objectIds", "rowCount"}, f"partitions[{index}]"
        )
        partition_id = _text(partition["partitionId"], _IDENTIFIER, "partitionId")
        if partition_id in partition_ids:
            raise ContractError("duplicate partition id")
        partition_ids.add(partition_id)
        if not isinstance(partition["objectIds"], list) or not partition["objectIds"]:
            raise ContractError("partition objectIds must be non-empty")
        ids = []
        expected_rows = 0
        for object_id_value in partition["objectIds"]:
            object_id = _text(object_id_value, _IDENTIFIER, "partition objectId")
            if object_id in assigned or object_id not in objects_by_id:
                raise ContractError("partition inventory contains duplicate or unknown object")
            row_count = objects_by_id[object_id]["rowCount"]
            if row_count is None:
                raise ContractError("partitioned object must declare rowCount")
            assigned.add(object_id)
            ids.append(object_id)
            expected_rows += row_count
        if _count(partition["rowCount"], "partition rowCount") != expected_rows:
            raise ContractError("partition rowCount drifted")
        partitions.append({"partitionId": partition_id, "objectIds": sorted(ids), "rowCount": expected_rows})
    partitions.sort(key=lambda item: item["partitionId"])
    unpartitioned: list[str] = []
    for object_id_value in unpartitioned_value:
        object_id = _text(object_id_value, _IDENTIFIER, "unpartitioned objectId")
        if object_id in assigned or object_id not in objects_by_id:
            raise ContractError("unpartitioned inventory contains duplicate or unknown object")
        assigned.add(object_id)
        unpartitioned.append(object_id)
    if assigned != set(objects_by_id):
        raise ContractError("partition inventory is incomplete")
    totals = {
        "totalObjectCount": len(objects),
        "totalBytes": sum(item["bytes"] for item in objects),
        "totalRowCount": sum(item["rowCount"] or 0 for item in objects),
    }
    for key, expected in totals.items():
        if _count(inventory_value[key], key) != expected:
            raise ContractError(f"partitionInventory.{key} drifted")
    partition_inventory = {
        "partitions": partitions,
        "unpartitionedObjectIds": sorted(unpartitioned),
        **totals,
    }

    retention_value = _exact(
        core["retention"], {"state", "decisionOwner", "deletePrerequisites"}, "retention"
    )
    if retention_value["state"] not in {"hold", "retained", "review-required"}:
        raise ContractError("unsupported retention state")
    prerequisites_value = retention_value["deletePrerequisites"]
    if not isinstance(prerequisites_value, list):
        raise ContractError("deletePrerequisites must be an array")
    prerequisites = [_text(item, _IDENTIFIER, "delete prerequisite") for item in prerequisites_value]
    if len(prerequisites) != len(set(prerequisites)) or not _DELETE_PREREQUISITES.issubset(prerequisites):
        raise ContractError("deletePrerequisites are incomplete or duplicated")
    retention = {
        "state": retention_value["state"],
        "decisionOwner": _text(retention_value["decisionOwner"], _IDENTIFIER, "decisionOwner"),
        "deletePrerequisites": sorted(prerequisites),
    }

    authority = _exact(core["authority"], {"serving", "promotion", "deletion"}, "authority")
    if any(value is not False for value in authority.values()):
        raise ContractError("ArtifactRegistry authority must remain exactly false")

    return {
        "protocol": ARTIFACT_REGISTRY_PROTOCOL,
        "artifactSetId": artifact_set_id,
        "sourceScope": source_scope,
        "clocks": clocks,
        "versions": versions,
        "locations": locations,
        "objects": objects,
        "partitionInventory": partition_inventory,
        "retention": retention,
        "authority": {"serving": False, "promotion": False, "deletion": False},
    }


def create_registry(core: Mapping[str, Any]) -> dict[str, Any]:
    normalised = _normalise_core(core)
    return {**normalised, "registryIdentity": content_identity(normalised)}


def admit_registry(value: Mapping[str, Any]) -> dict[str, Any]:
    registry = _exact(value, _CORE_KEYS | {"registryIdentity"}, "artifact registry")
    normalised = _normalise_core({key: registry[key] for key in _CORE_KEYS})
    declared = _text(registry["registryIdentity"], _SHA256, "registryIdentity", 71)
    expected = content_identity(normalised)
    if declared != expected:
        raise ContractError("registryIdentity drifted")
    return {**normalised, "registryIdentity": expected}


def load_registry(path: Path) -> dict[str, Any]:
    value = strict_json_load(path)
    if not isinstance(value, Mapping):
        raise ContractError("artifact registry must be an object")
    return admit_registry(value)


def resolve_artifact_base(registry: Mapping[str, Any], registry_root: Path) -> Path:
    root = registry_root.resolve(strict=True)
    location = registry["locations"][0]
    unresolved = root / Path(*location["basePath"].split("/"))
    current = root
    for component in location["basePath"].split("/"):
        current /= component
        if current.is_symlink() or (hasattr(current, "is_junction") and current.is_junction()):
            raise ContractError("registry basePath must not traverse a link or junction")
    candidate = unresolved.resolve(strict=True)
    if candidate == root or root not in candidate.parents:
        raise ContractError("registry basePath escaped registry root")
    if candidate.is_symlink() or not candidate.is_dir():
        raise ContractError("registry basePath must be a real directory")
    return candidate


def observe_registry(registry: Mapping[str, Any], artifact_base: Path) -> list[dict[str, Any]]:
    observed: list[dict[str, Any]] = []
    for item in registry["objects"]:
        unresolved = artifact_base / Path(*item["relativePath"].split("/"))
        current = artifact_base
        for component in item["relativePath"].split("/"):
            current /= component
            if current.is_symlink() or (hasattr(current, "is_junction") and current.is_junction()):
                raise ContractError(f"registry object traverses a link: {item['relativePath']}")
        path = unresolved.resolve(strict=True)
        if artifact_base != path and artifact_base not in path.parents:
            raise ContractError("registry object escaped artifact base")
        if path.is_symlink() or not path.is_file():
            raise ContractError(f"registry object is not a real file: {item['relativePath']}")
        size, digest = file_identity(path)
        rows = line_count(path) if item["rowCount"] is not None else None
        if size != item["bytes"]:
            raise ContractError(f"object bytes drifted: {item['relativePath']}")
        if digest != item["sha256"]:
            raise ContractError(f"object hash drifted: {item['relativePath']}")
        if rows != item["rowCount"]:
            raise ContractError(f"object row count drifted: {item['relativePath']}")
        observed.append(
            {
                "objectId": item["objectId"],
                "relativePath": item["relativePath"],
                "bytes": size,
                "sha256": digest,
                "rowCount": rows,
            }
        )
    return observed
