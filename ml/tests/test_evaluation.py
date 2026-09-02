from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from engagement_ml.bridge import convert_m2_to_parquet
from engagement_ml.evaluation import evaluate_benchmark, load_dataset, split_identity, split_masks
from engagement_ml.protocol import load_protocol

from .helpers import build_m2_fixture


def _protocol_path() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts" / "data" / "area_intelligence_evaluation_protocol.v2.json"


def _dataset(tmp_path: Path) -> Path:
    registry, registry_root, _ = build_m2_fixture(tmp_path, _protocol_path())
    output = tmp_path / "dataset"
    convert_m2_to_parquet(
        registry_path=registry,
        registry_root=registry_root,
        protocol_path=_protocol_path(),
        output_root=output,
    )
    return output


def test_unified_evaluator_emits_exact_16_slices_and_baseline_gains(tmp_path: Path) -> None:
    report = evaluate_benchmark(
        dataset_root=_dataset(tmp_path),
        protocol_path=_protocol_path(),
        output_path=tmp_path / "benchmark.json",
        seed=17,
        include_torch=False,
    )
    assert report["research_only"] is True
    assert report["serving_authority"] is False
    assert report["promotion_authority"] is False
    models = {row["model"] for row in report["primary_results"]}
    assert models == {
        "seasonal-naive-52w",
        "moving-average-4w",
        "moving-average-13w",
        "ewma-v1",
        "sklearn-poisson-l2-v1",
        "sklearn-hist-gradient-boosting-poisson-v1",
    }
    for model in models:
        rows = [row for row in report["primary_results"] if row["model"] == model]
        assert len(rows) == 16
        assert all(row["observations"] > 0 for row in rows)
        assert all(row["relative_mae_gain_vs_seasonal_naive"] is not None for row in rows)
    assert all(
        row["interval"]["method"] == "validation-only-absolute-residual-90th-percentile"
        for row in report["primary_results"]
    )
    assert all(
        diagnostic["prediction_minimum"] >= 0
        for diagnostic in report["fit_diagnostics"]
        if "prediction_minimum" in diagnostic
    )


def test_split_identity_is_stable_and_detects_order_drift(tmp_path: Path) -> None:
    _, arrays = load_dataset(_dataset(tmp_path))
    protocol, _ = load_protocol(_protocol_path())
    fold = protocol["rolling_folds"][0]
    masks = split_masks(arrays, fold, "tract", 0)
    first = split_identity(arrays, fold, "tract", masks)
    second = split_identity(arrays, fold, "tract", masks)
    assert first == second
    drifted = replace(arrays, row_identity=arrays.row_identity[::-1])
    assert split_identity(drifted, fold, "tract", masks) != first


def test_unified_evaluator_includes_torch_in_all_16_primary_slices(tmp_path: Path) -> None:
    report = evaluate_benchmark(
        dataset_root=_dataset(tmp_path),
        protocol_path=_protocol_path(),
        output_path=tmp_path / "torch-benchmark.json",
        seed=31,
        include_torch=True,
        torch_device="cpu",
        torch_maximum_epochs=2,
    )
    rows = [row for row in report["primary_results"] if row["model"] == "torch-nb-global-v1"]
    assert len(rows) == 16
    assert all(row["interval"]["method"] == "nb2-distributional-central-90-percent" for row in rows)
    assert all(row["relative_mae_gain_vs_seasonal_naive"] is not None for row in rows)
