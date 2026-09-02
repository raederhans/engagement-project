from __future__ import annotations

from pathlib import Path

import pytest

from engagement_ml.bridge import admit_m2_artifact_set, convert_m2_to_parquet
from engagement_ml.contracts import ContractError
from engagement_ml.registry import load_registry

from .helpers import build_m2_fixture


def protocol_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "data" / "area_intelligence_evaluation_protocol.v2.json"


def test_python_admits_repository_artifact_registry_identity() -> None:
    registry = Path(__file__).resolve().parents[2] / "scripts" / "fixtures" / "artifact-registry-contracts" / "valid-file-registry.json"
    admitted = load_registry(registry)
    assert admitted["registryIdentity"] == "sha256:8456f1ca391509fbe47c1a5a55679dd6668d8e4586a4ce2405657297ca57b2dc"


def test_registry_bound_bridge_writes_deterministic_manifest(tmp_path: Path) -> None:
    registry, registry_root, _ = build_m2_fixture(tmp_path, protocol_path())
    admission = admit_m2_artifact_set(
        registry_path=registry, registry_root=registry_root, protocol_path=protocol_path()
    )
    assert admission.manifest["row_count"] > 0
    manifest = convert_m2_to_parquet(
        registry_path=registry,
        registry_root=registry_root,
        protocol_path=protocol_path(),
        output_root=tmp_path / "dataset",
    )
    assert manifest["research_only"] is True
    assert manifest["serving_authority"] is False
    assert manifest["promotion_authority"] is False
    assert manifest["row_count"] > 0
    assert len(manifest["feature_columns"]) == 6

    v2_manifest = convert_m2_to_parquet(
        registry_path=registry,
        registry_root=registry_root,
        protocol_path=protocol_path(),
        output_root=tmp_path / "dataset-v2",
        feature_version="v2",
        legacy_parity_passed=True,
    )
    assert len(v2_manifest["feature_columns"]) > 6
    assert "log1p_lag1" in v2_manifest["feature_columns"]
    assert "zero_streak_capped52" in v2_manifest["feature_columns"]


def test_bridge_rejects_hash_order_and_row_drift(tmp_path: Path) -> None:
    hash_root = tmp_path / "hash"
    registry, registry_root, artifact_base = build_m2_fixture(hash_root, protocol_path())
    part = artifact_base / "marts" / "fixed-grid" / "part-000.jsonl"
    part.write_text(part.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    with pytest.raises(ContractError, match="bytes drifted|hash drifted"):
        admit_m2_artifact_set(
            registry_path=registry, registry_root=registry_root, protocol_path=protocol_path()
        )

    order_root = tmp_path / "order"
    registry, registry_root, _ = build_m2_fixture(order_root, protocol_path(), order_drift=True)
    with pytest.raises(ContractError, match="week ordering"):
        convert_m2_to_parquet(
            registry_path=registry,
            registry_root=registry_root,
            protocol_path=protocol_path(),
            output_root=order_root / "dataset",
        )

    row_root = tmp_path / "row"
    registry, registry_root, _ = build_m2_fixture(row_root, protocol_path(), manifest_row_drift=True)
    with pytest.raises(ContractError, match="registry/manifest row drift"):
        admit_m2_artifact_set(
            registry_path=registry, registry_root=registry_root, protocol_path=protocol_path()
        )
