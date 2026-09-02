from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .constants import (
    FIXED_TORCH_SEEDS,
    M7_FORMAL_MODEL_IDS,
    MODEL_GOVERNANCE_POLICY_SCHEMA,
)
from .contracts import ContractError
from .identity import bytes_identity, content_identity, strict_json_load

_POLICY_RELATIVE = Path("ml/contracts/model_governance_policy.v1.json")
_V2_RELATIVE = Path("scripts/data/area_intelligence_evaluation_protocol.v2.json")
_V3_RELATIVE = Path("scripts/data/area_intelligence_evaluation_protocol.v3.json")
_FEATURE_RELATIVE = Path("ml/contracts/feature_schema.v2.json")
_LOCK_RELATIVE = Path("ml/uv.lock")

_IMPLEMENTATION_PATHS = {
    "baselines_and_features": Path("ml/src/engagement_ml/features.py"),
    "sklearn_models": Path("ml/src/engagement_ml/sklearn_models.py"),
    "torch_nb2": Path("ml/src/engagement_ml/torch_nb.py"),
    "benchmark_evaluation": Path("ml/src/engagement_ml/evaluation.py"),
    "governance_identity": Path("ml/src/engagement_ml/governance.py"),
    "governed_admission": Path("ml/src/engagement_ml/governed.py"),
    "governed_contracts": Path("ml/src/engagement_ml/m7_contracts.py"),
    "js_poisson_nb_references": Path("scripts/lib/area_intelligence_model.mjs"),
}

LINEAGE_KEYS = (
    "artifact_registry_identity",
    "m1_receipt_identity",
    "m2_mart_identity",
    "dataset_manifest_identity",
    "evaluation_protocol_identity",
    "governance_protocol_identity",
    "feature_schema_identity",
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
    "parity_receipt_identity",
)


def _object(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{label} must be an object")
    return value


def _file(repo_root: Path, relative: Path) -> Path:
    root = repo_root.resolve(strict=True)
    path = (root / relative).resolve(strict=True)
    if root not in path.parents:
        raise ContractError(f"governance input escaped repository root: {relative.as_posix()}")
    if path.is_symlink() or not path.is_file():
        raise ContractError(f"governance input must be a real file: {relative.as_posix()}")
    return path


def _identity(repo_root: Path, relative: Path) -> str:
    raw = _file(repo_root, relative).read_bytes()
    canonical = raw.replace(b"\r\n", b"\n")
    if b"\r" in canonical:
        raise ContractError(f"governance input contains unsupported bare CR: {relative.as_posix()}")
    return bytes_identity(canonical)


def load_governance(repo_root: Path) -> dict[str, Any]:
    policy_value = strict_json_load(_file(repo_root, _POLICY_RELATIVE))
    v2_value = strict_json_load(_file(repo_root, _V2_RELATIVE))
    v3_value = strict_json_load(_file(repo_root, _V3_RELATIVE))
    feature_value = strict_json_load(_file(repo_root, _FEATURE_RELATIVE))
    policy = dict(_object(policy_value, "ModelGovernancePolicy/v1"))
    v2 = dict(_object(v2_value, "evaluation protocol v2"))
    v3 = dict(_object(v3_value, "governance protocol v3"))
    feature = dict(_object(feature_value, "FeatureSchema/v2"))
    if policy.get("schema") != MODEL_GOVERNANCE_POLICY_SCHEMA:
        raise ContractError("unsupported ModelGovernancePolicy schema")
    if v2.get("schema") != "engagement-area-intelligence-evaluation-protocol/v2":
        raise ContractError("evaluation protocol v2 schema drifted")
    if v3.get("schema") != "engagement-area-intelligence-evaluation-protocol/v3":
        raise ContractError("governance protocol v3 schema drifted")
    if feature.get("schema") != "FeatureSchema/v2":
        raise ContractError("FeatureSchema/v2 schema drifted")

    expected_inputs = _object(policy.get("expected_inputs"), "expected_inputs")
    observed_inputs = {
        "evaluation_protocol_v2_identity": _identity(repo_root, _V2_RELATIVE),
        "governance_protocol_v3_identity": _identity(repo_root, _V3_RELATIVE),
        "feature_schema_v2_identity": _identity(repo_root, _FEATURE_RELATIVE),
    }
    if expected_inputs != observed_inputs:
        raise ContractError("frozen governance input identity drifted")

    catalog = policy.get("candidate_catalog")
    if not isinstance(catalog, list):
        raise ContractError("candidate_catalog must be an array")
    catalog_ids = tuple(entry.get("id") for entry in catalog if isinstance(entry, Mapping))
    if catalog_ids != M7_FORMAL_MODEL_IDS:
        raise ContractError("M7 formal candidate catalog drifted")
    v3_candidates = v3.get("candidates")
    if not isinstance(v3_candidates, list):
        raise ContractError("protocol v3 candidates must be an array")
    expected_v3 = (*M7_FORMAL_MODEL_IDS[:6], M7_FORMAL_MODEL_IDS[7])
    if tuple(entry.get("id") for entry in v3_candidates if isinstance(entry, Mapping)) != expected_v3:
        raise ContractError("protocol v3 candidate identity/order drifted")
    if tuple(policy.get("fixed_torch_seeds", ())) != FIXED_TORCH_SEEDS:
        raise ContractError("fixed torch seed set drifted")
    admission_registry = _object(policy.get("admission_registry"), "admission_registry")
    if set(admission_registry) != {
        "exact_full_artifact_registry_identities",
        "empty_allowlist_result",
    }:
        raise ContractError("admission registry policy drifted")
    registry_allowlist = admission_registry["exact_full_artifact_registry_identities"]
    if not isinstance(registry_allowlist, list) or registry_allowlist:
        raise ContractError("M7 exact full ArtifactRegistry allowlist must remain empty")
    if admission_registry["empty_allowlist_result"] != "no-promotion":
        raise ContractError("empty ArtifactRegistry allowlist must fail closed")
    ingress = _object(policy.get("ingress"), "ingress")
    if ingress != {
        "formats": ["strict-json"],
        "checkpoint_consumption": False,
        "pickle_deserialization": False,
        "joblib_deserialization": False,
        "torch_load_deserialization": False,
    }:
        raise ContractError("M7 deserialization boundary drifted")
    return {"policy": policy, "v2": v2, "v3": v3, "feature": feature}


def frozen_governance_identities(repo_root: Path) -> dict[str, str]:
    values = load_governance(repo_root)
    policy = values["policy"]
    v2 = values["v2"]
    v3 = values["v3"]
    v2_models = _object({entry["id"]: entry for entry in v2["models"]}, "v2 models")
    implementations = {
        name: _identity(repo_root, relative) for name, relative in _IMPLEMENTATION_PATHS.items()
    }
    return {
        "evaluation_protocol_identity": _identity(repo_root, _V2_RELATIVE),
        "governance_protocol_identity": _identity(repo_root, _V3_RELATIVE),
        "feature_schema_identity": _identity(repo_root, _FEATURE_RELATIVE),
        "split_policy_identity": content_identity(
            {
                "inner_validation": v3["inner_validation"],
                "rolling_folds": v3["rolling_folds"],
                "spatial_holdout": v3["spatial_holdout"],
            }
        ),
        "candidate_set_identity": content_identity(policy["candidate_catalog"]),
        "candidate_implementation_identity": content_identity(implementations),
        "search_space_identity": content_identity(
            {
                "v3_candidates": v3["candidates"],
                "js_poisson_reference": v2_models["poisson-log-link-v1"],
                "diagnostic_ma4": v2_models["moving-average-4w"],
            }
        ),
        "seed_set_identity": content_identity(policy["fixed_torch_seeds"]),
        "preprocessing_identity": content_identity(
            {
                "feature_schema": v3["feature_schema"],
                "inner_validation": v3["inner_validation"],
            }
        ),
        "early_stopping_identity": content_identity(v3["convergence"]),
        "calibration_policy_identity": content_identity(v3["interval_calibration"]),
        "gate_policy_identity": content_identity(
            {
                "prediction_cap": v3["prediction_cap"],
                "slice_gate": v3["slice_gate"],
                "decision": v3["decision"],
                "stability": policy["stability"],
                "admission_registry": policy["admission_registry"],
            }
        ),
        "runtime_memory_policy_identity": content_identity(
            {"runtime": v3["runtime"], "measurement": policy["runtime_memory"]}
        ),
        "environment_lock_identity": _identity(repo_root, _LOCK_RELATIVE),
        "governance_policy_identity": _identity(repo_root, _POLICY_RELATIVE),
    }


def frozen_lineage(
    repo_root: Path,
    *,
    dataset_manifest: Mapping[str, Any] | None = None,
    parity_receipt_identity: str | None = None,
) -> dict[str, str | None]:
    frozen = frozen_governance_identities(repo_root)
    source: Mapping[str, Any] = {}
    dataset_identity = None
    if dataset_manifest is not None:
        source = _object(dataset_manifest.get("source"), "dataset manifest source")
        dataset_identity = dataset_manifest.get("dataset_identity")
    lineage: dict[str, str | None] = {
        "artifact_registry_identity": source.get("artifact_registry_identity"),
        "m1_receipt_identity": source.get("m1_receipt_identity"),
        "m2_mart_identity": source.get("m2_mart_identity"),
        "dataset_manifest_identity": dataset_identity,
        "evaluation_protocol_identity": frozen["evaluation_protocol_identity"],
        "governance_protocol_identity": frozen["governance_protocol_identity"],
        "feature_schema_identity": frozen["feature_schema_identity"],
        "split_policy_identity": frozen["split_policy_identity"],
        "candidate_set_identity": frozen["candidate_set_identity"],
        "candidate_implementation_identity": frozen["candidate_implementation_identity"],
        "search_space_identity": frozen["search_space_identity"],
        "seed_set_identity": frozen["seed_set_identity"],
        "preprocessing_identity": frozen["preprocessing_identity"],
        "early_stopping_identity": frozen["early_stopping_identity"],
        "calibration_policy_identity": frozen["calibration_policy_identity"],
        "gate_policy_identity": frozen["gate_policy_identity"],
        "runtime_memory_policy_identity": frozen["runtime_memory_policy_identity"],
        "environment_lock_identity": frozen["environment_lock_identity"],
        "parity_receipt_identity": parity_receipt_identity,
    }
    if tuple(lineage) != LINEAGE_KEYS:
        raise AssertionError("M7 lineage key order drifted")
    return lineage
