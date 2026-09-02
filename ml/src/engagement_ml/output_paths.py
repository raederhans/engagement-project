from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path

from .contracts import ContractError

_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_WINDOWS_RESERVED = {
    "AUX",
    "CON",
    "NUL",
    "PRN",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def _same_path(left: Path, right: Path) -> bool:
    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(os.path.abspath(right))


def _lstat(path: Path) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        return None
    except OSError as error:
        raise ContractError(f"could not inspect output path component: {path}") from error


def _is_link_or_reparse(path: Path, info: os.stat_result) -> bool:
    if stat.S_ISLNK(info.st_mode):
        return True
    is_junction = getattr(path, "is_junction", None)
    try:
        if callable(is_junction) and is_junction():
            return True
    except OSError as error:
        raise ContractError(f"could not inspect output path reparse state: {path}") from error
    attributes = int(getattr(info, "st_file_attributes", 0))
    reparse_flag = int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
    return bool(attributes & reparse_flag)


def _assert_real_directory(path: Path, label: str) -> None:
    info = _lstat(path)
    if info is None or not stat.S_ISDIR(info.st_mode) or _is_link_or_reparse(path, info):
        raise ContractError(f"{label} must be a pre-existing real directory")


def _git(repo_root: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", "-C", str(repo_root), *arguments],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except OSError as error:
        raise ContractError("git is required to admit a full benchmark output root") from error


def _assert_git_worktree(repo_root: Path) -> None:
    result = _git(repo_root, "rev-parse", "--show-toplevel")
    if result.returncode != 0 or not result.stdout.strip():
        raise ContractError("full benchmark repo root must be an exact Git worktree root")
    try:
        observed = Path(result.stdout.strip()).resolve(strict=True)
    except OSError as error:
        raise ContractError("could not resolve the Git worktree root") from error
    if not _same_path(observed, repo_root):
        raise ContractError("full benchmark repo root drifted from the Git worktree root")


def _assert_ignored_and_untracked(repo_root: Path, output_root: Path) -> None:
    relative = output_root.relative_to(repo_root).as_posix()
    ignored = _git(repo_root, "check-ignore", "--no-index", "--quiet", "--", relative)
    if ignored.returncode != 0:
        raise ContractError("full benchmark output must remain under a Git-ignored root")
    tracked = _git(repo_root, "ls-files", "-z")
    if tracked.returncode != 0:
        raise ContractError("could not verify that the full benchmark output is untracked")
    prefix = f"{relative}/"
    tracked_paths = tracked.stdout.split("\0")
    if any(item == relative or item.startswith(prefix) for item in tracked_paths if item):
        raise ContractError("full benchmark output overlaps tracked repository content")


def prepare_full_benchmark_output(repo_root: Path, output_root: Path) -> Path:
    """Admit and exclusively create one ignored, task-owned full benchmark root."""

    try:
        repo_lexical = Path(os.path.abspath(repo_root))
        repo_real = repo_lexical.resolve(strict=True)
    except (OSError, ValueError) as error:
        raise ContractError("full benchmark repo root could not be resolved") from error
    if not repo_real.is_dir() or not _same_path(repo_lexical, repo_real):
        raise ContractError("full benchmark repo root must not traverse a link or reparse point")
    _assert_real_directory(repo_real, "full benchmark repo root")
    _assert_git_worktree(repo_real)

    if output_root.drive and not output_root.is_absolute():
        raise ContractError("drive-relative full benchmark output paths are prohibited")
    candidate_input = output_root if output_root.is_absolute() else repo_real / output_root
    try:
        candidate = Path(os.path.abspath(candidate_input))
    except (OSError, ValueError) as error:
        raise ContractError("full benchmark output path could not be normalized") from error

    allowed_parent = repo_real / "ml" / ".artifacts"
    run_id = candidate.name
    if candidate.parent != allowed_parent or not _RUN_ID.fullmatch(run_id):
        raise ContractError(
            "full benchmark output must be a fresh direct child of repo/ml/.artifacts"
        )
    device_stem = run_id.rstrip(" .").split(".", 1)[0].upper()
    if run_id != run_id.rstrip(" .") or device_stem in _WINDOWS_RESERVED:
        raise ContractError("full benchmark output run id is not cross-platform safe")

    _assert_ignored_and_untracked(repo_real, candidate)
    if _lstat(candidate) is not None:
        raise ContractError("full benchmark output root must not already exist")

    ml_root = repo_real / "ml"
    _assert_real_directory(ml_root, "ML root")
    if _lstat(allowed_parent) is None:
        try:
            allowed_parent.mkdir(mode=0o700, parents=False, exist_ok=False)
        except FileExistsError:
            pass
        except OSError as error:
            raise ContractError("could not create the ignored ML artifact root") from error
    _assert_real_directory(allowed_parent, "ignored ML artifact root")
    try:
        parent_real = allowed_parent.resolve(strict=True)
    except OSError as error:
        raise ContractError("could not resolve the ignored ML artifact root") from error
    if not _same_path(parent_real, allowed_parent):
        raise ContractError("ignored ML artifact root must not traverse a link or reparse point")
    if _lstat(candidate) is not None:
        raise ContractError("full benchmark output root appeared during admission")

    try:
        candidate.mkdir(mode=0o700, parents=False, exist_ok=False)
    except FileExistsError as error:
        raise ContractError("full benchmark output root appeared during admission") from error
    except OSError as error:
        raise ContractError("could not create the admitted full benchmark output root") from error
    _assert_real_directory(candidate, "full benchmark output root")
    try:
        candidate_real = candidate.resolve(strict=True)
    except OSError as error:
        raise ContractError("could not resolve the created full benchmark output root") from error
    if not _same_path(candidate_real, candidate):
        raise ContractError("created full benchmark output root traversed a link or reparse point")
    return candidate
