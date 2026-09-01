from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import PoissonRegressor


@dataclass(frozen=True)
class FittedPointModel:
    model_id: str
    estimator: Any
    diagnostics: dict[str, Any]

    def predict(self, features: NDArray[np.float64]) -> NDArray[np.float64]:
        values = np.asarray(self.estimator.predict(features), dtype=np.float64)
        if not np.all(np.isfinite(values)):
            raise ValueError(f"{self.model_id} emitted non-finite predictions")
        if np.any(values < 0):
            raise ValueError(f"{self.model_id} emitted negative predictions")
        return values


def fit_poisson_regressor(
    features: NDArray[np.float64],
    target: NDArray[np.float64],
    *,
    alpha: float = 1.0,
    maximum_iterations: int = 300,
    tolerance: float = 1e-8,
) -> FittedPointModel:
    estimator = PoissonRegressor(
        alpha=alpha,
        fit_intercept=False,
        solver="lbfgs",
        max_iter=maximum_iterations,
        tol=tolerance,
    )
    estimator.fit(features, target)
    predictions = np.asarray(estimator.predict(features), dtype=np.float64)
    coefficients = np.asarray(estimator.coef_, dtype=np.float64)
    diagnostics: dict[str, Any] = {
        "solver": "lbfgs",
        "same_model_as_js_irls": "poisson-log-link-with-identical-six-feature-contract",
        "different_solver_from_js_irls": True,
        "alpha_l2": alpha,
        "n_iter": int(estimator.n_iter_),
        "maximum_iterations": maximum_iterations,
        "converged_before_limit": int(estimator.n_iter_) < maximum_iterations,
        "coefficients": coefficients.tolist(),
        "coefficients_finite": bool(np.all(np.isfinite(coefficients))),
        "coefficient_absolute_maximum": float(np.max(np.abs(coefficients))),
        "predictions_finite": bool(np.all(np.isfinite(predictions))),
        "prediction_minimum": float(np.min(predictions)),
        "prediction_maximum": float(np.max(predictions)),
    }
    if not diagnostics["coefficients_finite"] or not diagnostics["predictions_finite"]:
        raise ValueError("PoissonRegressor numerical diagnostics failed")
    if diagnostics["prediction_minimum"] < 0:
        raise ValueError("PoissonRegressor emitted a negative prediction")
    return FittedPointModel("sklearn-poisson-l2-v1", estimator, diagnostics)


def fit_hist_gradient_boosting_poisson(
    features: NDArray[np.float64],
    target: NDArray[np.float64],
    *,
    validation_features: NDArray[np.float64],
    validation_target: NDArray[np.float64],
    seed: int,
    maximum_iterations: int = 100,
) -> FittedPointModel:
    estimator = HistGradientBoostingRegressor(
        loss="poisson",
        learning_rate=0.05,
        max_iter=maximum_iterations,
        max_leaf_nodes=15,
        min_samples_leaf=20,
        l2_regularization=1.0,
        early_stopping=True,
        n_iter_no_change=10,
        random_state=seed,
    )
    estimator.fit(
        features,
        target,
        X_val=validation_features,
        y_val=validation_target,
    )
    predictions = np.asarray(estimator.predict(features), dtype=np.float64)
    diagnostics: dict[str, Any] = {
        "loss": "poisson",
        "random_state": seed,
        "n_iter": int(estimator.n_iter_),
        "maximum_iterations": maximum_iterations,
        "converged_before_limit": int(estimator.n_iter_) < maximum_iterations,
        "learning_rate": 0.05,
        "max_leaf_nodes": 15,
        "l2_regularization": 1.0,
        "early_stopping": True,
        "external_validation": True,
        "predictions_finite": bool(np.all(np.isfinite(predictions))),
        "prediction_minimum": float(np.min(predictions)),
        "prediction_maximum": float(np.max(predictions)),
        "nonlinear_interactions": True,
    }
    if not diagnostics["predictions_finite"] or diagnostics["prediction_minimum"] < 0:
        raise ValueError("HistGradientBoostingRegressor poisson predictions failed numerical gate")
    return FittedPointModel(
        "sklearn-hist-gradient-boosting-poisson-v1", estimator, diagnostics
    )


def calibration_radius(actual: NDArray[np.float64], predicted: NDArray[np.float64]) -> float:
    if actual.size == 0 or actual.shape != predicted.shape:
        raise ValueError("calibration requires aligned non-empty validation predictions")
    residuals = np.abs(actual - predicted)
    return float(np.quantile(residuals, 0.9, method="higher"))


def conformal_interval(
    predicted: NDArray[np.float64], radius: float
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if not np.isfinite(radius) or radius < 0:
        raise ValueError("calibration radius must be finite and non-negative")
    return np.maximum(0.0, predicted - radius), predicted + radius
