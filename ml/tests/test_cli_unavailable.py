from __future__ import annotations

import json
from pathlib import Path

from engagement_ml.cli import main


def test_full_benchmark_writes_unavailable_receipt_before_data_read(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    output = tmp_path / "full"
    exit_code = main(
        [
            "full-benchmark",
            "--repo-root",
            str(repo_root),
            "--registry",
            str(tmp_path / "missing-registry.json"),
            "--registry-root",
            str(tmp_path),
            "--protocol",
            str(repo_root / "scripts" / "data" / "area_intelligence_evaluation_protocol.v2.json"),
            "--output",
            str(output),
        ]
    )
    assert exit_code == 2
    receipt = json.loads((output / "full-benchmark-receipt.json").read_text(encoding="utf-8"))
    assert receipt["status"] == "unavailable"
    assert receipt["full_training_run"] is False
    assert receipt["serving_authority"] is False
    assert receipt["promotion_authority"] is False
    admission = json.loads(
        (output / "model-admission-receipt.json").read_text(encoding="utf-8")
    )
    assert admission["schema"] == "ModelAdmissionReceipt/v1"
    assert admission["status"] == "unavailable"
    assert admission["decision"] == "no-promotion"
    assert admission["production_forecast"]["status"] == "unavailable"


def test_full_benchmark_rejects_non_frozen_feature_or_reference_seed(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    protocol = repo_root / "scripts" / "data" / "area_intelligence_evaluation_protocol.v2.json"
    cases = (
        ("feature-v1", ["--feature-version", "v1"], "FeatureSchema/v2"),
        ("seed", ["--seed", "7"], "reference seed 20260831"),
    )
    for name, extra_args, expected_detail in cases:
        output = tmp_path / name
        exit_code = main(
            [
                "full-benchmark",
                "--repo-root",
                str(repo_root),
                "--registry",
                str(tmp_path / "missing-registry.json"),
                "--registry-root",
                str(tmp_path),
                "--protocol",
                str(protocol),
                "--output",
                str(output),
                *extra_args,
            ]
        )
        assert exit_code == 2
        receipt = json.loads(
            (output / "full-benchmark-receipt.json").read_text(encoding="utf-8")
        )
        assert receipt["status"] == "unavailable"
        assert expected_detail in receipt["detail"]
        admission = json.loads(
            (output / "model-admission-receipt.json").read_text(encoding="utf-8")
        )
        assert admission["decision"] == "no-promotion"
        assert admission["production_forecast"]["status"] == "unavailable"

    drifted_protocol = tmp_path / "drifted-protocol.json"
    drifted_protocol.write_text(
        protocol.read_text(encoding="utf-8").replace(
            '"frozen_at": "2026-08-31T00:00:00.000Z"',
            '"frozen_at": "2026-08-31T00:00:00.001Z"',
        ),
        encoding="utf-8",
    )
    output = tmp_path / "protocol-drift"
    exit_code = main(
        [
            "full-benchmark",
            "--repo-root",
            str(repo_root),
            "--registry",
            str(tmp_path / "missing-registry.json"),
            "--registry-root",
            str(tmp_path),
            "--protocol",
            str(drifted_protocol),
            "--output",
            str(output),
        ]
    )
    assert exit_code == 2
    receipt = json.loads(
        (output / "full-benchmark-receipt.json").read_text(encoding="utf-8")
    )
    assert "protocol drifted from frozen" in receipt["detail"]
