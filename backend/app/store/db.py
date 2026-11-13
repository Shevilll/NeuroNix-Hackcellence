"""SQLite access: WAL, busy timeout, short IMMEDIATE transactions, bounded retry when locked.

Every transaction opens its own connection, so the code is safe to call from several threads
(FastAPI runs sync endpoints in a thread pool). ``BEGIN IMMEDIATE`` takes the write lock up
front, so two concurrent writers queue instead of failing half-way through.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS packages (
    package_id   TEXT PRIMARY KEY,
    version      INTEGER NOT NULL,
    status       TEXT NOT NULL,
    request_json TEXT NOT NULL,
    package_json TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS package_versions (
    package_id   TEXT NOT NULL REFERENCES packages(package_id),
    version      INTEGER NOT NULL,
    package_json TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (package_id, version)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    scope         TEXT NOT NULL,
    key           TEXT NOT NULL,
    request_hash  TEXT NOT NULL,
    status_code   INTEGER NOT NULL,
    response_json TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS reservations (
    number       TEXT PRIMARY KEY,
    package_id   TEXT NOT NULL UNIQUE REFERENCES packages(package_id),
    body_json    TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flight_holds (
    flight_id TEXT PRIMARY KEY,
    seats     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_holds (
    room_id TEXT NOT NULL,
    night   TEXT NOT NULL,
    rooms   INTEGER NOT NULL,
    PRIMARY KEY (room_id, night)
);
"""


class Database:
    def __init__(self, path: str | Path, *, busy_timeout_ms: int = 5000, lock_retries: int = 5) -> None:
        self.path = Path(path)
        self.busy_timeout_ms = busy_timeout_ms
        self.lock_retries = lock_retries
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=self.busy_timeout_ms / 1000, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"PRAGMA busy_timeout={self.busy_timeout_ms}")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def migrate(self) -> None:
        conn = self._connect()
        try:
            conn.executescript(SCHEMA)
        finally:
            conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            for attempt in range(self.lock_retries):
                try:
                    conn.execute("BEGIN IMMEDIATE")
                    break
                except sqlite3.OperationalError as exc:
                    locked = "locked" in str(exc) or "busy" in str(exc)
                    if not locked or attempt == self.lock_retries - 1:
                        raise
                    time.sleep(min(0.05 * 2**attempt, 0.5))
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            else:
                conn.execute("COMMIT")
        finally:
            conn.close()
