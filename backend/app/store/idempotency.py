"""Idempotency keys (plan §6).

``execute_once`` runs the action and stores the key, request hash and response in ONE
transaction. A retry with the same key and body gets the stored answer (``replayed=True``); the
same key with a different body is rejected. Because writers are serialised by BEGIN IMMEDIATE,
concurrent requests with one key run the action exactly once. If the action raises, nothing is
stored, so a retry can succeed.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.store.db import Database


class IdempotencyKeyReused(Exception):
    """The same Idempotency-Key was sent with a different request body."""


@dataclass(frozen=True)
class IdempotentResult:
    status_code: int
    body: dict[str, Any]
    replayed: bool


def request_hash(body: Any) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def execute_once(
    db: Database,
    *,
    scope: str,
    key: str,
    body: Any,
    action: Callable[[Any], tuple[int, dict[str, Any]]],
) -> IdempotentResult:
    digest = request_hash(body)
    with db.transaction() as conn:
        row = conn.execute(
            "SELECT request_hash, status_code, response_json FROM idempotency_keys WHERE scope=? AND key=?",
            (scope, key),
        ).fetchone()
        if row is not None:
            if row["request_hash"] != digest:
                raise IdempotencyKeyReused(key)
            return IdempotentResult(row["status_code"], json.loads(row["response_json"]), True)

        status_code, response = action(conn)
        conn.execute(
            "INSERT INTO idempotency_keys VALUES (?,?,?,?,?,?)",
            (scope, key, digest, status_code, json.dumps(response), datetime.now(UTC).isoformat()),
        )
        return IdempotentResult(status_code, response, False)
