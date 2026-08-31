from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from engagement_ml.torch_nb import (
    NB2MLP,
    assert_global_model_has_no_embedding,
    nb2_log_prob,
    nb2_mean_variance,
    predict_nb2,
    torch_distribution,
    train_nb2_mlp,
)


def test_nb2_parameterization_matches_torch_distribution() -> None:
    mu = torch.tensor([0.25, 2.0, 11.0], dtype=torch.float64)
    alpha = torch.tensor([0.1, 0.5, 1.2], dtype=torch.float64)
    target = torch.tensor([0.0, 3.0, 9.0], dtype=torch.float64)
    distribution = torch_distribution(mu, alpha)
    mean, variance = nb2_mean_variance(mu, alpha)
    assert torch.allclose(distribution.mean, mean, rtol=1e-12, atol=1e-12)
    assert torch.allclose(distribution.variance, variance, rtol=1e-12, atol=1e-12)
    assert torch.allclose(
        distribution.log_prob(target), nb2_log_prob(target, mu, alpha), rtol=1e-12, atol=1e-12
    )


def _synthetic(seed: int = 9) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    generator = np.random.default_rng(seed)
    features = generator.normal(size=(420, 6))
    log_mu = 0.5 + 0.55 * features[:, 0] - 0.3 * features[:, 1] + 0.2 * features[:, 2]
    mu = np.exp(np.clip(log_mu, -2, 3))
    alpha = 0.25
    size = 1 / alpha
    target = generator.negative_binomial(size, size / (size + mu)).astype(np.float64)
    return features[:320], target[:320], features[320:], target[320:]


def test_nb2_mlp_cpu_smoke_synthetic_recovery_checkpoint_and_repeatability(tmp_path: Path) -> None:
    train_x, train_y, validation_x, validation_y = _synthetic()
    first = train_nb2_mlp(
        train_x,
        train_y,
        validation_x,
        validation_y,
        seed=23,
        requested_device="cpu",
        maximum_epochs=50,
        patience=8,
        checkpoint_path=tmp_path / "checkpoint.pt",
    )
    assert first.best_validation_nll < first.initial_validation_nll
    assert first.calibration_radius >= 0
    assert (tmp_path / "checkpoint.pt").is_file()
    assert_global_model_has_no_embedding(first.model)
    prediction, alpha = predict_nb2(first.model, validation_x, device="cpu")
    assert np.all(prediction >= 0)
    assert np.all(alpha > 0)
    assert np.corrcoef(prediction, validation_y)[0, 1] > 0.25

    second = train_nb2_mlp(
        train_x,
        train_y,
        validation_x,
        validation_y,
        seed=23,
        requested_device="cpu",
        maximum_epochs=50,
        patience=8,
    )
    repeated, repeated_alpha = predict_nb2(second.model, validation_x, device="cpu")
    assert np.array_equal(prediction, repeated)
    assert np.array_equal(alpha, repeated_alpha)


def test_global_candidate_architecture_has_no_unit_embedding() -> None:
    model = NB2MLP(6)
    assert_global_model_has_no_embedding(model)
    assert not any(isinstance(module, torch.nn.Embedding) for module in model.modules())
