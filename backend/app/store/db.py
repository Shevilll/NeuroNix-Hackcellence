"""SQLite access: WAL, busy timeout, short IMMEDIATE transactions, bounded retry when locked.

Every transaction opens its own connection, so the code is safe to call from several threads
(FastAPI runs sync endpoints in a thread pool). ``BEGIN IMMEDIATE`` takes the write lock up
front, so two concurrent writers queue instead of failing half-way through.
"""

from __future__ import annotations

import re
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

_REFERENCES_LEGACY = re.compile(r'REFERENCES\s+"?\w+_legacy"?')


def _free_name(tables: dict[str, str], table: str) -> str:
    """``<table>_legacy``, or ``<table>_legacy2`` and so on if that name is already taken."""
    name, n = f"{table}_legacy", 1
    while name in tables:
        n += 1
        name = f"{table}_legacy{n}"
    tables[name] = ""
    return name


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
            self._set_aside_legacy_tables(conn)
            conn.executescript(SCHEMA)
        finally:
            conn.close()

    @staticmethod
    def _set_aside_legacy_tables(conn: sqlite3.Connection) -> None:
        """An early development build stored packages as ``packages(id, body)``. Rename its tables
        to ``*_legacy`` so the current schema can be created beside them. Nothing is deleted.

        SQLite rewrites the ``REFERENCES`` clauses of other tables when a parent table is renamed,
        which would leave ``package_versions`` pointing at ``packages_legacy``. Both pragmas below
        switch that off for the duration of the rename, and any table that an earlier run already
        left pointing at a legacy table is set aside too, so the schema can recreate it.
        """
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("PRAGMA legacy_alter_table=ON")
        try:
            tables = {row[0]: row[1] or "" for row in
                      conn.execute("SELECT name, sql FROM sqlite_master WHERE type='table'")}
            columns = {row[1] for row in conn.execute("PRAGMA table_info(packages)")}
            if columns and "package_id" not in columns:
                for table in ("packages", "reservations", "idempotency"):
                    if table in tables:
                        conn.execute(f'ALTER TABLE "{table}" RENAME TO "{_free_name(tables, table)}"')
            for name, sql in list(tables.items()):
                if not name.endswith("_legacy") and _REFERENCES_LEGACY.search(sql):
                    conn.execute(f'ALTER TABLE "{name}" RENAME TO "{_free_name(tables, name)}"')
        finally:
            conn.execute("PRAGMA legacy_alter_table=OFF")
            conn.execute("PRAGMA foreign_keys=ON")

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
