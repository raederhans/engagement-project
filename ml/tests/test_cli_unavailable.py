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
