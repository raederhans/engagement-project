from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from engagement_ml.bridge import convert_m2_to_parquet
from engagement_ml.constants import FIXED_TORCH_SEEDS, M7_FORMAL_MODEL_IDS
from engagement_ml.contracts import ContractError
from engagement_ml.governance import frozen_governance_identities
from engagement_ml.governed import run_governed_benchmark
from engagement_ml.m7_contracts import (
    build_unavailable_admission_receipt,
    validate_model_admission_receipt,
    validate_model_benchmark_report,
)
from engagement_ml.parity import run_js_python_parity

from .helpers import build_m2_fixture


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _protocol_path() -> Path:
    return _repo_root() / "scripts" / "data" / "area_intelligence_evaluation_protocol.v2.json"


def _dataset(tmp_path: Path, parity_passed: bool) -> Path:
    registry, registry_root, _ = build_m2_fixture(tmp_path, _protocol_path())
    output = tmp_path / "dataset"
    convert_m2_to_parquet(
        registry_path=registry,
        registry_root=registry_root,
        protocol_path=_protocol_path(),
        output_root=output,
        feature_version="v2",
        legacy_parity_passed=parity_passed,
    )
    return output


def test_frozen_governance_binds_protocol_feature_candidate_seed_and_runtime_identities() -> None:
    identities = frozen_governance_identities(_repo_root())
    assert identities["evaluation_protocol_identity"] == (
        "sha256:997aaf5389ab401d0a87e74b749ab4079e26315d4bb8787ad4e1b7051b457dde"
    )
    assert identities["governance_protocol_identity"] == (
        "sha256:13efc6cdcedbf3f4dd839f5af802c04d72696baaf02efa5c5588d56066b06534"
    )
    assert identities["feature_schema_identity"] == (
        "sha256:08cad80f5015e710fdd107c67eedee63e4b787d1420c9faf82e6cf4cc1cebe9b"
    )
    for name in (
        "split_policy_identity",
        "candidate_set_identity",
        "candidate_implementation_identity",
        "search_space_identity",
        "seed_set_identity",
        "preprocessing_identity",
        "early_stopping_identity",
        "calibration_policy_identity",
        "gate_policy_identity",
        "runtime_memory_policy_identity",
        "environment_lock_identity",
    ):
        assert identities[name].startswith("sha256:")


def test_governed_synthetic_benchmark_reports_five_seed_stability_and_no_promotion(
    tmp_path: Path,
) -> None:
    parity = run_js_python_parity(_repo_root(), tmp_path / "parity.json")
    dataset = _dataset(tmp_path, parity["passed"])
    result = run_governed_benchmark(
        repo_root=_repo_root(),
        dataset_root=dataset,
        protocol_path=_protocol_path(),
        parity_receipt=parity,
        output_root=tmp_path / "governed",
        evaluation_scope="synthetic-fixture",
        torch_device="cpu",
        torch_maximum_epochs=1,
    )
    report = result["report"]
    receipt = result["admission"]
    assert report["schema"] == "ModelBenchmarkReport/v1"
    assert [entry["id"] for entry in report["candidate_catalog"]] == list(M7_FORMAL_MODEL_IDS)
    assert report["torch_stability"]["fixed_seeds"] == list(FIXED_TORCH_SEEDS)
    assert [run["seed"] for run in report["torch_stability"]["runs"]] == list(FIXED_TORCH_SEEDS)
    assert all("runtime_memory" in run and "environment" in run for run in report["torch_stability"]["runs"])
    assert set(report["torch_stability"]["summary"]) == {
        "median",
        "worst",
        "population_std",
        "failed_seeds",
        "relative_instability",
        "epoch_median",
        "epoch_worst",
        "environment_identities",
        "passed",
    }
    assert receipt["decision"] == "no-promotion"
    assert receipt["full_evaluation"] is False
    assert receipt["production_forecast"]["status"] == "unavailable"
    assert receipt["production_forecast"]["predictions"] == []
    assert result["model_card"] is None
    assert (tmp_path / "governed" / "model-benchmark-report.json").is_file()
    assert (tmp_path / "governed" / "calibration-report.json").is_file()
    assert (tmp_path / "governed" / "model-admission-receipt.json").is_file()

    drifted = deepcopy(report)
    drifted["authority"]["serving"] = True
    with pytest.raises(ContractError, match="authority"):
        validate_model_benchmark_report(drifted)
    drifted_receipt = deepcopy(receipt)
    drifted_receipt["benchmark_report_identity"] = "sha256:" + "0" * 64
    with pytest.raises(ContractError, match="content identity"):
        validate_model_admission_receipt(drifted_receipt)

    drifted_protocol = tmp_path / "drifted-protocol.json"
    drifted_protocol.write_text(
        _protocol_path().read_text(encoding="utf-8").replace(
            '"frozen_at": "2026-08-31T00:00:00.000Z"',
            '"frozen_at": "2026-08-31T00:00:00.001Z"',
        ),
        encoding="utf-8",
    )
    with pytest.raises(ContractError, match="protocol drifted from frozen"):
        run_governed_benchmark(
            repo_root=_repo_root(),
            dataset_root=dataset,
            protocol_path=drifted_protocol,
            parity_receipt=parity,
            output_root=tmp_path / "drifted-governed",
            evaluation_scope="synthetic-fixture",
            torch_device="cpu",
            torch_maximum_epochs=1,
        )


def test_unavailable_admission_is_honest_and_m7_ingress_has_no_deserializer() -> None:
    receipt = build_unavailable_admission_receipt(
        _repo_root(), "exact-artifact-registry-unavailable"
    )
    assert receipt["status"] == "unavailable"
    assert receipt["decision"] == "no-promotion"
    assert receipt["lineage"]["artifact_registry_identity"] is None
    assert receipt["lineage"]["m1_receipt_identity"] is None
    assert receipt["lineage"]["m2_mart_identity"] is None
    assert receipt["benchmark_report_identity"] is None
    sources = [
        _repo_root() / "ml" / "src" / "engagement_ml" / "m7_contracts.py",
        _repo_root() / "ml" / "src" / "engagement_ml" / "governed.py",
        _repo_root() / "scripts" / "lib" / "ml_shadow_bridge" / "contracts.mjs",
    ]
    content = "\n".join(path.read_text(encoding="utf-8") for path in sources)
    for prohibited in ("pickle.loads(", "joblib.load(", "torch.load("):
        assert prohibited not in content
