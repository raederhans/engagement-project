from __future__ import annotations

import json
import os
import shutil
import stat
from collections.abc import Callable, Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest

from engagement_ml.cli import main
from engagement_ml.output_paths import _is_link_or_reparse


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _protocol() -> Path:
    return _repo_root() / "scripts" / "data" / "area_intelligence_evaluation_protocol.v2.json"


@pytest.fixture
def full_output_factory() -> Iterator[Callable[[str], Path]]:
    parent = _repo_root() / "ml" / ".artifacts"
    parent.mkdir(parents=False, exist_ok=True)
    owned: list[Path] = []

    def factory(label: str) -> Path:
        output = parent / f"pytest-{label}-{uuid4().hex}"
        owned.append(output)
        return output

    yield factory
    for output in reversed(owned):
        try:
            if output.is_symlink():
                output.unlink()
            elif output.is_dir():
                shutil.rmtree(output)
            elif output.exists():
                output.unlink()
        except FileNotFoundError:
            pass


def _full_args(output: Path, temporary_root: Path) -> list[str]:
    return [
        "full-benchmark",
        "--repo-root",
        str(_repo_root()),
        "--registry",
        str(temporary_root / "missing-registry.json"),
        "--registry-root",
        str(temporary_root),
        "--protocol",
        str(_protocol()),
        "--output",
        str(output),
    ]


def test_full_benchmark_writes_unavailable_receipt_before_data_read(
    tmp_path: Path, full_output_factory: Callable[[str], Path]
) -> None:
    output = full_output_factory("missing-registry")
    exit_code = main(_full_args(output, tmp_path))
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


def test_full_benchmark_rejects_non_frozen_feature_or_reference_seed(
    tmp_path: Path, full_output_factory: Callable[[str], Path]
) -> None:
    cases = (
        ("feature-v1", ["--feature-version", "v1"], "FeatureSchema/v2"),
        ("seed", ["--seed", "7"], "reference seed 20260831"),
    )
    for name, extra_args, expected_detail in cases:
        output = full_output_factory(name)
        exit_code = main([*_full_args(output, tmp_path), *extra_args])
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
        _protocol().read_text(encoding="utf-8").replace(
            '"frozen_at": "2026-08-31T00:00:00.000Z"',
            '"frozen_at": "2026-08-31T00:00:00.001Z"',
        ),
        encoding="utf-8",
    )
    output = full_output_factory("protocol-drift")
    args = _full_args(output, tmp_path)
    args[args.index(str(_protocol()))] = str(drifted_protocol)
    exit_code = main(args)
    assert exit_code == 2
    receipt = json.loads(
        (output / "full-benchmark-receipt.json").read_text(encoding="utf-8")
    )
    assert "protocol drifted from frozen" in receipt["detail"]


def test_full_benchmark_output_guard_rejects_public_tracked_escape_and_existing(
    tmp_path: Path, full_output_factory: Callable[[str], Path]
) -> None:
    public_target = _repo_root() / "public" / f"m7-guard-{uuid4().hex}"
    tracked_target = _repo_root() / "package.json"
    tracked_bytes = tracked_target.read_bytes()
    outside_target = tmp_path / "outside-output"
    existing_target = full_output_factory("existing")
    existing_target.mkdir()
    sentinel = existing_target / "sentinel.txt"
    sentinel.write_text("owned\n", encoding="utf-8")

    for target in (public_target, tracked_target, outside_target, existing_target):
        assert main(_full_args(target, tmp_path)) == 2

    assert not public_target.exists()
    assert tracked_target.read_bytes() == tracked_bytes
    assert not outside_target.exists()
    assert sentinel.read_text(encoding="utf-8") == "owned\n"
    assert not (existing_target / "model-admission-receipt.json").exists()


def test_full_benchmark_output_guard_rejects_link_or_reparse_target(
    tmp_path: Path, full_output_factory: Callable[[str], Path]
) -> None:
    outside = tmp_path / "outside-link-target"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("outside\n", encoding="utf-8")
    linked_output = full_output_factory("linked")
    try:
        linked_output.symlink_to(outside, target_is_directory=True)
    except (NotImplementedError, OSError) as error:
        pytest.skip(f"directory symlink is unavailable: {error}")

    assert main(_full_args(linked_output, tmp_path)) == 2
    assert sentinel.read_text(encoding="utf-8") == "outside\n"
    assert not (outside / "model-admission-receipt.json").exists()


def test_full_benchmark_output_guard_recognizes_windows_reparse_attribute() -> None:
    info = cast(
        os.stat_result,
        SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400),
    )
    assert _is_link_or_reparse(Path("synthetic-reparse"), info) is True
