from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import date
from statistics import pstdev
from typing import Any

from .constants import CATEGORY_COLUMNS, FEATURE_SCHEMA_V1, FEATURE_SCHEMA_V2, V1_FEATURE_COLUMNS
from .identity import content_identity


class LeakageError(ValueError):
    """Raised when a feature cannot prove a strictly historical cutoff."""


def trailing_mean(counts: Sequence[int | float], index: int, window: int) -> float:
    if window < 1 or index < window:
        return 0.0
    return sum(float(value) for value in counts[index - window : index]) / window


def _week_fraction(week_start: str, fallback_index: int) -> float:
    try:
        observed = date.fromisoformat(week_start)
        start = date(observed.year, 1, 1)
        return ((observed - start).days / 365.2425) % 1
    except ValueError:
        return (fallback_index % 52) / 52


def legacy_feature_vector(
    counts: Sequence[int | float], index: int, week_start: str
) -> tuple[float, ...] | None:
    if index < 52:
        return None
    lag52 = float(counts[index - 52] or 0)
    ma4 = trailing_mean(counts, index, 4)
    ma13 = trailing_mean(counts, index, 13)
    angle = 2 * math.pi * _week_fraction(week_start, index)
    return (
        1.0,
        math.log1p(lag52),
        math.log1p(ma4),
        math.log1p(ma13),
        math.sin(angle),
        math.cos(angle),
    )


def baseline_predictions(
    counts: Sequence[int | float], index: int, ewma_decay: float = 0.3
) -> dict[str, float] | None:
    if index < 52:
        return None
    ewma = float(counts[0]) if index else 0.0
    for value in counts[1:index]:
        ewma = ewma_decay * float(value) + (1 - ewma_decay) * ewma
    return {
        "seasonal_naive_52w": float(counts[index - 52] or 0),
        "moving_average_4w": trailing_mean(counts, index, 4),
        "moving_average_13w": trailing_mean(counts, index, 13),
        "ewma": ewma,
    }


def _zero_streak(counts: Sequence[int | float], index: int) -> int:
    streak = 0
    for value in reversed(counts[:index]):
        if float(value) != 0:
            break
        streak += 1
    return streak


def feature_schema_v1() -> dict[str, Any]:
    core = {
        "schema": FEATURE_SCHEMA_V1,
        "features": [
            {"name": name, "availability": "index>=52", "missing_policy": "row-ineligible", "temporal_cutoff": "strictly-before-predicted-week", "lineage": "M2 aggregate unit-week counts"}
            for name in V1_FEATURE_COLUMNS
        ],
    }
    return {**core, "identity": content_identity(core)}


def feature_schema_v2() -> dict[str, Any]:
    definitions = [
        ("intercept", "1"),
        *[(f"log1p_lag{lag}", f"log1p(y[t-{lag}])") for lag in (1, 2, 4, 13, 26, 52)],
        *[(f"log1p_ma{window}", f"log1p(mean(y[t-{window}:t]))") for window in (4, 13, 26)],
        ("rolling_std13", "population_std(y[t-13:t])"),
        ("ma4_minus_ma13", "mean(y[t-4:t])-mean(y[t-13:t])"),
        ("previous_nonzero_rate13", "mean(y[t-13:t]>0)"),
        ("zero_streak_capped52", "min(consecutive_zero_weeks_before_t,52)/52"),
        ("annual_sin", "sin(2*pi*calendar_year_fraction)"),
        ("annual_cos", "cos(2*pi*calendar_year_fraction)"),
        ("semiannual_sin", "sin(4*pi*calendar_year_fraction)"),
        ("semiannual_cos", "cos(4*pi*calendar_year_fraction)"),
        ("unit_type_tract", "1[unit_type=tract]"),
        ("unit_type_fixed_grid", "1[unit_type=fixed-grid]"),
        ("category_available", "1[category is admitted and available]"),
        *[(f"category_{category}", f"1[category={category}]") for category in CATEGORY_COLUMNS],
        ("neighborhood_available", "1[historical neighborhood series is admitted and available]"),
        ("log1p_neighborhood_ma4", "optional log1p(mean of admitted historical neighbor counts over t-4:t)"),
    ]
    core = {
        "schema": FEATURE_SCHEMA_V2,
        "enabled_after": "FeatureSchema/v1-js-parity receipt with passed=true",
        "features": [
            {
                "name": name,
                "definition": definition,
                "availability": "all required inputs observed strictly before predicted week",
                "missing_policy": "row-ineligible unless optional feature is explicitly zero-with-unavailable-indicator",
                "temporal_cutoff": "strictly-before-predicted-week",
                "lineage": "exact MLDatasetManifest/v1 transformation and M2 aggregate unit-week input",
            }
            for name, definition in definitions
        ],
    }
    return {**core, "identity": content_identity(core)}


def feature_vector_v2(
    counts: Sequence[int | float],
    index: int,
    week_start: str,
    *,
    unit_type: str,
    category: str | None = None,
    neighborhood_history: Sequence[int | float] | None = None,
    legacy_parity_passed: bool,
) -> dict[str, float]:
    if not legacy_parity_passed:
        raise LeakageError("FeatureSchema/v2 requires a passed six-feature parity gate")
    if index < 52 or index > len(counts):
        raise LeakageError("FeatureSchema/v2 requires 52 strictly historical weeks")
    if unit_type not in {"tract", "fixed-grid"}:
        raise LeakageError("unsupported unit type")
    if category is not None and category not in CATEGORY_COLUMNS:
        raise LeakageError("unsupported category")
    history = [float(value) for value in counts[:index]]
    result: dict[str, float] = {"intercept": 1.0}
    for lag in (1, 2, 4, 13, 26, 52):
        result[f"log1p_lag{lag}"] = math.log1p(history[-lag])
    for window in (4, 13, 26):
        result[f"log1p_ma{window}"] = math.log1p(sum(history[-window:]) / window)
    result["rolling_std13"] = pstdev(history[-13:])
    result["ma4_minus_ma13"] = trailing_mean(history, len(history), 4) - trailing_mean(history, len(history), 13)
    result["previous_nonzero_rate13"] = sum(value > 0 for value in history[-13:]) / 13
    result["zero_streak_capped52"] = min(_zero_streak(history, len(history)), 52) / 52
    fraction = _week_fraction(week_start, index)
    result.update(
        annual_sin=math.sin(2 * math.pi * fraction),
        annual_cos=math.cos(2 * math.pi * fraction),
        semiannual_sin=math.sin(4 * math.pi * fraction),
        semiannual_cos=math.cos(4 * math.pi * fraction),
        unit_type_tract=float(unit_type == "tract"),
        unit_type_fixed_grid=float(unit_type == "fixed-grid"),
    )
    result["category_available"] = float(category is not None)
    for name in CATEGORY_COLUMNS:
        result[f"category_{name}"] = float(category == name)
    if neighborhood_history is None:
        result["neighborhood_available"] = 0.0
        result["log1p_neighborhood_ma4"] = 0.0
    else:
        if len(neighborhood_history) != index:
            raise LeakageError("neighborhood history must stop exactly before the predicted week")
        result["neighborhood_available"] = 1.0
        result["log1p_neighborhood_ma4"] = math.log1p(
            trailing_mean(neighborhood_history, index, 4)
        )
    return result


def feature_values_in_schema_order(values: Mapping[str, float], schema: Mapping[str, Any]) -> list[float]:
    return [float(values[entry["name"]]) for entry in schema["features"]]
