from __future__ import annotations

import copy

import pytest

from engagement_ml.contracts import ContractError, validate_ml_research_run
from engagement_ml.features import LeakageError, feature_schema_v2, feature_vector_v2
from engagement_ml.identity import content_identity


def valid_run() -> dict:
    digest = "sha256:" + "1" * 64
    return {
        "schema": "MLResearchRun/v1",
        "research_only": True,
        "serving_authority": False,
        "promotion_authority": False,
        "input_identity": digest,
        "protocol_identity": digest,
        "dataset_manifest_identity": digest,
        "feature_schema_identity": digest,
        "model_identity": digest,
        "environment": {"python": "3.12"},
        "hardware": {"machine": "fixture"},
        "device": "cpu",
        "seed": 7,
        "determinism": {"cross_platform_byte_identical": False},
        "started_at": "2026-08-31T00:00:00.000Z",
        "completed_at": "2026-08-31T00:01:00.000Z",
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("research_only", False),
        ("serving_authority", True),
        ("promotion_authority", True),
        ("input_identity", "sha256:bad"),
        ("seed", -1),
    ],
)
def test_research_run_rejects_authority_and_identity_drift(field: str, value: object) -> None:
    run = valid_run()
    run[field] = value
    with pytest.raises(ContractError):
        validate_ml_research_run(run)


def test_feature_v2_requires_parity_and_strict_historical_neighbor_cutoff() -> None:
    counts = list(range(70))
    with pytest.raises(LeakageError, match="parity"):
        feature_vector_v2(counts, 60, "2026-01-05", unit_type="tract", legacy_parity_passed=False)
    with pytest.raises(LeakageError, match="stop exactly"):
        feature_vector_v2(
            counts,
            60,
            "2026-01-05",
            unit_type="tract",
            neighborhood_history=counts[:61],
            legacy_parity_passed=True,
        )
    before = copy.deepcopy(counts)
    values = feature_vector_v2(
        counts,
        60,
        "2026-01-05",
        unit_type="tract",
        neighborhood_history=counts[:60],
        legacy_parity_passed=True,
    )
    counts[60:] = [999] * 10
    after = feature_vector_v2(
        counts,
        60,
        "2026-01-05",
        unit_type="tract",
        neighborhood_history=before[:60],
        legacy_parity_passed=True,
    )
    assert values == after
    assert values["category_available"] == 0.0
    assert values["neighborhood_available"] == 1.0
    unavailable = feature_vector_v2(
        before,
        60,
        "2026-01-05",
        unit_type="tract",
        legacy_parity_passed=True,
    )
    assert unavailable["category_available"] == 0.0
    assert unavailable["neighborhood_available"] == 0.0
    assert unavailable["log1p_neighborhood_ma4"] == 0.0
    schema = feature_schema_v2()
    core = dict(schema)
    declared = core.pop("identity")
    assert declared == content_identity(core)
