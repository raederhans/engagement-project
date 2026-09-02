from __future__ import annotations

from pathlib import Path

from engagement_ml.parity import run_js_python_parity


def test_js_python_feature_metric_split_parity(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    receipt = run_js_python_parity(repo_root, tmp_path / "parity.json")
    assert receipt["passed"] is True
    assert all(check["passed"] for check in receipt["checks"])
