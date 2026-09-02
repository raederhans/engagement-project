from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .constants import PROTOCOL_SCHEMA
from .contracts import ContractError
from .identity import bytes_identity, strict_json_loads

FOLD_IDS = ("fold-2019", "fold-2021", "fold-2023", "fold-2025-2026")
UNIT_TYPES = ("tract", "fixed-grid")
HOLDOUT_SLICES = ("temporal-non-heldout", "spatial-heldout")


def load_protocol(path: Path) -> tuple[dict[str, Any], str]:
    payload = path.read_bytes()
    value = strict_json_loads(payload)
    if not isinstance(value, Mapping):
        raise ContractError("evaluation protocol must be an object")
    protocol = dict(value)
    if protocol.get("schema") != PROTOCOL_SCHEMA or protocol.get("schema_version") != 2:
        raise ContractError("unsupported evaluation protocol")
    if protocol.get("frozen_before_model_performance") is not True:
        raise ContractError("protocol must be frozen before model performance")
    folds = protocol.get("rolling_folds")
    if not isinstance(folds, list) or tuple(fold.get("id") for fold in folds) != FOLD_IDS:
        raise ContractError("rolling fold identity or order drifted")
    expected = [
        {"fold": fold, "unit_type": unit_type, "holdout_slice": holdout}
        for fold in FOLD_IDS
        for unit_type in UNIT_TYPES
        for holdout in HOLDOUT_SLICES
    ]
    if protocol.get("primary_tuple_vocabulary") != expected:
        raise ContractError("primary tuple vocabulary drifted")
    privacy = protocol.get("privacy")
    if not isinstance(privacy, Mapping) or privacy.get("aggregate_only") is not True:
        raise ContractError("protocol privacy is not aggregate-only")
    if any(value is not False for key, value in privacy.items() if key != "aggregate_only"):
        raise ContractError("protocol privacy authority drifted")
    authority = protocol.get("authority")
    if not isinstance(authority, Mapping) or any(value is not False for value in authority.values()):
        raise ContractError("protocol authority must remain false")
    if protocol.get("current_evaluation_state", {}).get("status") != "not-promoted":
        raise ContractError("protocol unexpectedly grants promotion")
    return protocol, bytes_identity(payload)


def primary_slices(protocol: Mapping[str, Any]) -> list[dict[str, str]]:
    return [dict(value) for value in protocol["primary_tuple_vocabulary"]]
