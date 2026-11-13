"""Versioned package storage. Every change bumps ``version`` and keeps the old one in history.

``update`` takes the version the caller last saw (optimistic concurrency): a stale version from
another tab raises ``VersionConflict`` carrying the current package.
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.store.db import Database


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


@dataclass(frozen=True)
class StoredPackage:
    package_id: str
    version: int
    status: str  # "DRAFT" or "BOOKED"
    request: dict[str, Any]
    package: dict[str, Any]


@dataclass(frozen=True)
class PackageVersion:
    version: int
    package: dict[str, Any]


class VersionConflict(Exception):
    def __init__(self, current: StoredPackage) -> None:
        super().__init__(f"package {current.package_id} is at version {current.version}")
        self.current = current


def _row_to_stored(row) -> StoredPackage:
    return StoredPackage(
        package_id=row["package_id"],
        version=row["version"],
        status=row["status"],
        request=json.loads(row["request_json"]),
        package=json.loads(row["package_json"]),
    )


class PackageRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    def create(self, request: dict[str, Any], package: dict[str, Any], conn=None) -> StoredPackage:
        """Insert version 1. Pass ``conn`` to take part in an open transaction."""
        package_id = "pkg_" + secrets.token_hex(8)
        now = _now()
        stored = StoredPackage(package_id, 1, "DRAFT", request, package)

        def write(c) -> None:
            c.execute(
                "INSERT INTO packages VALUES (?,?,?,?,?,?,?)",
                (package_id, 1, "DRAFT", json.dumps(request), json.dumps(package), now, now),
            )
            c.execute(
                "INSERT INTO package_versions VALUES (?,?,?,?)",
                (package_id, 1, json.dumps(package), now),
            )

        if conn is not None:
            write(conn)
        else:
            with self.db.transaction() as c:
                write(c)
        return stored

    def get(self, package_id: str, conn=None) -> StoredPackage | None:
        def read(c) -> StoredPackage | None:
            row = c.execute("SELECT * FROM packages WHERE package_id=?", (package_id,)).fetchone()
            return _row_to_stored(row) if row else None

        if conn is not None:
            return read(conn)
        with self.db.transaction() as c:
            return read(c)

    def update(self, package_id: str, expected_version: int, package: dict[str, Any]) -> StoredPackage:
        with self.db.transaction() as c:
            current = self.get(package_id, conn=c)
            if current is None:
                raise KeyError(package_id)
            if current.version != expected_version:
                raise VersionConflict(current)
            version = current.version + 1
            now = _now()
            c.execute(
                "UPDATE packages SET version=?, package_json=?, updated_at=? WHERE package_id=?",
                (version, json.dumps(package), now, package_id),
            )
            c.execute(
                "INSERT INTO package_versions VALUES (?,?,?,?)",
                (package_id, version, json.dumps(package), now),
            )
            return StoredPackage(package_id, version, current.status, current.request, package)

    def set_status(self, package_id: str, status: str, conn=None) -> None:
        def write(c) -> None:
            c.execute(
                "UPDATE packages SET status=?, updated_at=? WHERE package_id=?",
                (status, _now(), package_id),
            )

        if conn is not None:
            write(conn)
        else:
            with self.db.transaction() as c:
                write(c)

    def save_booked(self, package_id: str, package: dict[str, Any], conn) -> None:
        """Store the booked copy (items marked BOOKED) inside the confirm transaction."""
        conn.execute(
            "UPDATE packages SET status='BOOKED', package_json=?, updated_at=? WHERE package_id=?",
            (json.dumps(package), _now(), package_id),
        )

    def history(self, package_id: str) -> list[PackageVersion]:
        with self.db.transaction() as c:
            rows = c.execute(
                "SELECT version, package_json FROM package_versions WHERE package_id=? ORDER BY version",
                (package_id,),
            ).fetchall()
        return [PackageVersion(r["version"], json.loads(r["package_json"])) for r in rows]
