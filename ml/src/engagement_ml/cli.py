from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .bridge import convert_m2_to_parquet
from .constants import M7_REFERENCE_SEED
from .contracts import ContractError
from .evaluation import build_research_run, evaluate_benchmark
from .features import feature_schema_v2
from .governance import frozen_governance_identities
from .governed import run_governed_benchmark
from .identity import file_identity, write_json
from .m7_contracts import build_unavailable_admission_receipt
from .output_paths import prepare_full_benchmark_output
from .parity import run_js_python_parity, validate_parity_receipt


def _timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="engagement-ml")
    commands = parser.add_subparsers(dest="command", required=True)
    parity = commands.add_parser("parity")
    parity.add_argument("--repo-root", type=Path, required=True)
    parity.add_argument("--output", type=Path, required=True)

    bridge = commands.add_parser("bridge")
    bridge.add_argument("--registry", type=Path, required=True)
    bridge.add_argument("--registry-root", type=Path, required=True)
    bridge.add_argument("--protocol", type=Path, required=True)
    bridge.add_argument("--output", type=Path, required=True)
    bridge.add_argument("--feature-version", choices=("v1", "v2"), default="v1")
    bridge.add_argument("--parity-receipt", type=Path)

    benchmark = commands.add_parser("benchmark")
    benchmark.add_argument("--dataset", type=Path, required=True)
    benchmark.add_argument("--protocol", type=Path, required=True)
    benchmark.add_argument("--output", type=Path, required=True)
    benchmark.add_argument("--seed", type=int, default=20260831)
    benchmark.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    benchmark.add_argument("--skip-torch", action="store_true")

    full = commands.add_parser("full-benchmark")
    full.add_argument("--repo-root", type=Path, required=True)
    full.add_argument("--registry", type=Path, required=True)
    full.add_argument("--registry-root", type=Path, required=True)
    full.add_argument("--protocol", type=Path, required=True)
    full.add_argument("--output", type=Path, required=True)
    full.add_argument("--feature-version", choices=("v1", "v2"), default="v2")
    full.add_argument("--seed", type=int, default=20260831)
    full.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    return parser


def _full_benchmark(args: argparse.Namespace) -> dict[str, Any]:
    if args.feature_version != "v2":
        raise ContractError("governed full benchmark requires frozen FeatureSchema/v2")
    if args.seed != M7_REFERENCE_SEED:
        raise ContractError(
            f"governed full benchmark requires frozen reference seed {M7_REFERENCE_SEED}"
        )
    frozen = frozen_governance_identities(args.repo_root)
    if file_identity(args.protocol)[1] != frozen["evaluation_protocol_identity"]:
        raise ContractError("full benchmark protocol drifted from frozen evaluation protocol")
    started_at = _timestamp()
    parity = run_js_python_parity(args.repo_root, args.output / "feature-parity-receipt.json")
    dataset_manifest = convert_m2_to_parquet(
        registry_path=args.registry,
        registry_root=args.registry_root,
        protocol_path=args.protocol,
        output_root=args.output / "dataset",
        feature_version=args.feature_version,
        legacy_parity_passed=parity["passed"],
    )
    governed = run_governed_benchmark(
        repo_root=args.repo_root,
        dataset_root=args.output / "dataset",
        protocol_path=args.protocol,
        parity_receipt=parity,
        output_root=args.output,
        evaluation_scope="full-exact-registry",
        torch_device=args.device,
    )
    report = governed["representative_legacy_report"]
    if report is None:
        raise ContractError("all fixed PyTorch seed runs failed")
    write_json(args.output / "benchmark-report.json", report)
    schema = feature_schema_v2()
    model_identity = governed["report"]["lineage"]["candidate_implementation_identity"]
    completed_at = _timestamp()
    run = build_research_run(
        report=report,
        model_identity=model_identity,
        feature_schema_identity=schema["identity"],
        started_at=started_at,
        completed_at=completed_at,
        device=args.device,
    )
    write_json(args.output / "research-run.json", run)
    receipt = {
        "schema": "MLFullBenchmarkReceipt/v1",
        "status": "complete",
        "research_only": True,
        "serving_authority": False,
        "promotion_authority": False,
        "dataset_identity": dataset_manifest["dataset_identity"],
        "report_identity": report["report_identity"],
        "model_benchmark_report_identity": governed["report"]["report_identity"],
        "model_admission_receipt_identity": governed["admission"]["receipt_identity"],
        "admission_decision": governed["admission"]["decision"],
        "production_forecast": governed["admission"]["production_forecast"],
        "started_at": started_at,
        "completed_at": completed_at,
    }
    write_json(args.output / "full-benchmark-receipt.json", receipt)
    return receipt


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    admitted_full_output: Path | None = None
    try:
        if args.command == "full-benchmark":
            admitted_full_output = prepare_full_benchmark_output(args.repo_root, args.output)
            args.output = admitted_full_output
        if args.command == "parity":
            run_js_python_parity(args.repo_root, args.output)
        elif args.command == "bridge":
            parity_passed = False
            if args.parity_receipt is not None:
                parity_passed = validate_parity_receipt(args.parity_receipt)["passed"]
            convert_m2_to_parquet(
                registry_path=args.registry,
                registry_root=args.registry_root,
                protocol_path=args.protocol,
                output_root=args.output,
                feature_version=args.feature_version,
                legacy_parity_passed=parity_passed,
            )
        elif args.command == "benchmark":
            evaluate_benchmark(
                dataset_root=args.dataset,
                protocol_path=args.protocol,
                output_path=args.output,
                seed=args.seed,
                include_torch=not args.skip_torch,
                torch_device=args.device,
            )
        else:
            _full_benchmark(args)
    except (ContractError, FileNotFoundError, ValueError) as error:
        if args.command == "full-benchmark" and admitted_full_output is not None:
            unavailable = build_unavailable_admission_receipt(
                args.repo_root,
                "exact-artifact-registry-or-full-evaluation-unavailable",
            )
            write_json(args.output / "model-admission-receipt.json", unavailable)
            write_json(
                args.output / "full-benchmark-receipt.json",
                {
                    "schema": "MLFullBenchmarkReceipt/v1",
                    "status": "unavailable",
                    "research_only": True,
                    "serving_authority": False,
                    "promotion_authority": False,
                    "full_training_run": False,
                    "reason": type(error).__name__,
                    "detail": str(error),
                    "observed_at": _timestamp(),
                },
            )
        print(f"engagement-ml: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
