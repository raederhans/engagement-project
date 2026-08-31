from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any


class DuplicateKeyError(ValueError):
    """Raised when strict JSON contains a duplicate object key."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(f"duplicate JSON key: {key}")
        if key in {"__proto__", "constructor", "prototype"}:
            raise ValueError(f"blocked JSON key: {key}")
        result[key] = value
    return result


def strict_json_loads(value: str | bytes) -> Any:
    text = value.decode("utf-8") if isinstance(value, bytes) else value
    return json.loads(text, object_pairs_hook=_reject_duplicate_keys)


def strict_json_load(path: Path) -> Any:
    return strict_json_loads(path.read_bytes())


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def content_identity(value: Any) -> str:
    return f"sha256:{hashlib.sha256(canonical_json_bytes(value)).hexdigest()}"


def bytes_identity(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def file_identity(path: Path, chunk_size: int = 1024 * 1024) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            size += len(chunk)
            digest.update(chunk)
    return size, f"sha256:{digest.hexdigest()}"


def line_count(path: Path) -> int:
    count = 0
    with path.open("rb") as stream:
        for line in stream:
            if line.strip():
                count += 1
    return count


def bindings_identity(bindings: Iterable[dict[str, Any]]) -> str:
    return content_identity(list(bindings))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True)
    path.write_text(f"{payload}\n", encoding="utf-8", newline="\n")
