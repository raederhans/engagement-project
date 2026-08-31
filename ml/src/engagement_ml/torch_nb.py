from __future__ import annotations

import copy
import os
import platform
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from numpy.typing import NDArray
from torch import Tensor, nn
from torch.nn import functional as torch_functional
from torch.utils.data import DataLoader, Dataset

from .identity import content_identity


def set_determinism(seed: int) -> dict[str, Any]:
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    return {
        "requested": True,
        "deterministic_algorithms": True,
        "cudnn_benchmark": False,
        "cross_platform_byte_identical": False,
    }


def resolve_device(requested: str) -> torch.device:
    if requested == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if requested not in {"cpu", "cuda"}:
        raise ValueError("device must be auto, cpu, or cuda")
    if requested == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA was requested but is unavailable")
    return torch.device(requested)


def nb2_parameters(log_mu: Tensor, log_alpha: Tensor) -> tuple[Tensor, Tensor]:
    return (
        torch_functional.softplus(log_mu) + torch.finfo(log_mu.dtype).eps,
        torch_functional.softplus(log_alpha) + torch.finfo(log_alpha.dtype).eps,
    )


def nb2_mean_variance(mu: Tensor, alpha: Tensor) -> tuple[Tensor, Tensor]:
    return mu, mu + alpha * mu.square()


def nb2_log_prob(target: Tensor, mu: Tensor, alpha: Tensor) -> Tensor:
    size = alpha.reciprocal()
    return (
        torch.lgamma(target + size)
        - torch.lgamma(size)
        - torch.lgamma(target + 1)
        + size * (torch.log(size) - torch.log(size + mu))
        + target * (torch.log(mu) - torch.log(size + mu))
    )


def nb2_nll(target: Tensor, log_mu: Tensor, log_alpha: Tensor) -> Tensor:
    mu, alpha = nb2_parameters(log_mu, log_alpha)
    return -nb2_log_prob(target, mu, alpha).mean()


def torch_distribution(mu: Tensor, alpha: Tensor) -> torch.distributions.NegativeBinomial:
    size = alpha.reciprocal()
    logits = torch.log(mu / size)
    return torch.distributions.NegativeBinomial(total_count=size, logits=logits)


class ArrayDataset(Dataset[tuple[Tensor, Tensor]]):
    def __init__(self, features: NDArray[np.float64], target: NDArray[np.float64]) -> None:
        if len(features) != len(target):
            raise ValueError("features and target must align")
        self.features = torch.as_tensor(features, dtype=torch.float32)
        self.target = torch.as_tensor(target, dtype=torch.float32)

    def __len__(self) -> int:
        return len(self.target)

    def __getitem__(self, index: int) -> tuple[Tensor, Tensor]:
        return self.features[index], self.target[index]


class NB2MLP(nn.Module):
    """Global NB2 MLP. It intentionally contains no unit-id embedding."""

    def __init__(self, input_size: int, hidden_size: int = 32) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.SiLU(),
            nn.Linear(hidden_size, hidden_size),
            nn.SiLU(),
            nn.Linear(hidden_size, 2),
        )

    def forward(self, features: Tensor) -> tuple[Tensor, Tensor]:
        output = self.network(features)
        return output[:, 0], output[:, 1]


def assert_global_model_has_no_embedding(model: nn.Module) -> None:
    if any(isinstance(module, nn.Embedding) for module in model.modules()):
        raise ValueError("torch-nb-global-v1 must not contain a unit embedding")


@dataclass(frozen=True)
class TorchTrainingResult:
    model: NB2MLP
    device: str
    epochs_completed: int
    best_validation_nll: float
    initial_validation_nll: float
    calibration_radius: float
    diagnostics: dict[str, Any]


def _validation_nll(model: NB2MLP, loader: DataLoader[Any], device: torch.device) -> float:
    model.eval()
    weighted_loss = 0.0
    observations = 0
    with torch.no_grad():
        for features, target in loader:
            features = features.to(device)
            target = target.to(device)
            log_mu, log_alpha = model(features)
            loss = nb2_nll(target, log_mu, log_alpha)
            weighted_loss += float(loss) * len(target)
            observations += len(target)
    if observations == 0:
        raise ValueError("validation data is empty")
    return weighted_loss / observations


def train_nb2_mlp(
    train_features: NDArray[np.float64],
    train_target: NDArray[np.float64],
    validation_features: NDArray[np.float64],
    validation_target: NDArray[np.float64],
    *,
    seed: int,
    requested_device: str = "cpu",
    maximum_epochs: int = 100,
    patience: int = 10,
    batch_size: int = 128,
    learning_rate: float = 1e-3,
    gradient_clip_norm: float = 5.0,
    checkpoint_path: Path | None = None,
) -> TorchTrainingResult:
    determinism = set_determinism(seed)
    device = resolve_device(requested_device)
    model = NB2MLP(train_features.shape[1]).to(device)
    assert_global_model_has_no_embedding(model)
    generator = torch.Generator(device="cpu").manual_seed(seed)
    train_loader = DataLoader(
        ArrayDataset(train_features, train_target),
        batch_size=batch_size,
        shuffle=True,
        generator=generator,
        num_workers=0,
    )
    validation_loader = DataLoader(
        ArrayDataset(validation_features, validation_target),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    initial_validation = _validation_nll(model, validation_loader, device)
    best_validation = initial_validation
    best_state = copy.deepcopy(model.state_dict())
    stale_epochs = 0
    epochs_completed = 0
    maximum_gradient = 0.0
    for epoch in range(maximum_epochs):
        model.train()
        for features, target in train_loader:
            features = features.to(device)
            target = target.to(device)
            optimizer.zero_grad(set_to_none=True)
            log_mu, log_alpha = model(features)
            loss = nb2_nll(target, log_mu, log_alpha)
            if not torch.isfinite(loss):
                raise ValueError("NB2 training loss became non-finite")
            loss.backward()
            gradient = nn.utils.clip_grad_norm_(model.parameters(), gradient_clip_norm)
            maximum_gradient = max(maximum_gradient, float(gradient))
            optimizer.step()
        epochs_completed = epoch + 1
        validation_loss = _validation_nll(model, validation_loader, device)
        if validation_loss < best_validation - 1e-6:
            best_validation = validation_loss
            best_state = copy.deepcopy(model.state_dict())
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break
    model.load_state_dict(best_state)
    predictions, _ = predict_nb2(model, validation_features, device=device)
    radius = float(np.quantile(np.abs(validation_target - predictions), 0.9, method="higher"))
    architecture = {
        "model_id": "torch-nb-global-v1",
        "input_size": int(train_features.shape[1]),
        "hidden_size": 32,
        "outputs": ["log_mu", "log_alpha"],
        "mu_transform": "softplus+eps",
        "alpha_transform": "softplus+eps",
        "unit_embedding": False,
    }
    diagnostics = {
        "model_identity": content_identity(architecture),
        "architecture": architecture,
        "optimizer": "AdamW",
        "gradient_clip_norm": gradient_clip_norm,
        "maximum_preclip_gradient_norm": maximum_gradient,
        "early_stopping_patience": patience,
        "determinism": determinism,
        "python": platform.python_version(),
        "torch": torch.__version__,
        "device": str(device),
    }
    if checkpoint_path is not None:
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "schema": "TorchNB2Checkpoint/v1",
                "research_only": True,
                "serving_authority": False,
                "promotion_authority": False,
                "model_id": "torch-nb-global-v1",
                "state_dict": model.state_dict(),
                "diagnostics": diagnostics,
            },
            checkpoint_path,
        )
    return TorchTrainingResult(
        model=model,
        device=str(device),
        epochs_completed=epochs_completed,
        best_validation_nll=best_validation,
        initial_validation_nll=initial_validation,
        calibration_radius=radius,
        diagnostics=diagnostics,
    )


def predict_nb2(
    model: NB2MLP, features: NDArray[np.float64], *, device: torch.device | str
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    resolved = torch.device(device)
    model.eval()
    with torch.no_grad():
        tensor = torch.as_tensor(features, dtype=torch.float32, device=resolved)
        log_mu, log_alpha = model(tensor)
        mu, alpha = nb2_parameters(log_mu, log_alpha)
    means = mu.cpu().numpy().astype(np.float64)
    dispersions = alpha.cpu().numpy().astype(np.float64)
    if not np.all(np.isfinite(means)) or np.any(means < 0):
        raise ValueError("NB2 MLP emitted invalid means")
    if not np.all(np.isfinite(dispersions)) or np.any(dispersions <= 0):
        raise ValueError("NB2 MLP emitted invalid dispersions")
    return means, dispersions
