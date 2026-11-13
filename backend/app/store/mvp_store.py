"""SQLite persistence: packages, reservations and idempotency keys (WAL, busy timeout)."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from app.store.reservations import generate_unique_number

SCHEMA = """
CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reservations (
  number TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL, scope TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY (key, scope));
"""


class Store:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _run(self, fn):
        for attempt in range(5):
            conn = self._conn()
            try:
                return fn(conn)
            except sqlite3.OperationalError as error:
                if "locked" not in str(error) or attempt == 4:
                    raise
                time.sleep(0.05 * (attempt + 1))
            finally:
                conn.close()

    # ----- packages
    def save_package(self, package: dict[str, Any], key: str | None = None) -> str:
        def go(c):
            c.execute("BEGIN IMMEDIATE")
            if key:
                row = c.execute("SELECT response FROM idempotency WHERE key=? AND scope='build'", (key,)).fetchone()
                if row:
                    c.execute("COMMIT")
                    return json.loads(row[0])["package_id"]
            pid = uuid.uuid4().hex[:12]
            package["trip_id"] = pid
            c.execute("INSERT INTO packages VALUES (?, ?)", (pid, json.dumps(package)))
            if key:
                c.execute("INSERT INTO idempotency VALUES (?, 'build', ?)", (key, json.dumps({"package_id": pid})))
            c.execute("COMMIT")
            return pid
        return self._run(go)

    def get_package(self, pid: str) -> dict[str, Any] | None:
        row = self._run(lambda c: c.execute("SELECT body FROM packages WHERE id=?", (pid,)).fetchone())
        return json.loads(row[0]) if row else None

    # ----- reservations
    def get_reservation(self, number: str) -> dict[str, Any] | None:
        row = self._run(lambda c: c.execute("SELECT body FROM reservations WHERE number=?", (number,)).fetchone())
        return json.loads(row[0]) if row else None

    def confirm(self, pid: str, key: str) -> tuple[dict[str, Any] | None, bool]:
        """Returns (reservation, replayed). Idempotent per key and per package."""
        def go(c):
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT response FROM idempotency WHERE key=? AND scope=?", (key, f"confirm:{pid}")).fetchone()
            if row:
                c.execute("COMMIT")
                return json.loads(row[0]), True
            existing = c.execute("SELECT body FROM reservations WHERE package_id=?", (pid,)).fetchone()
            if existing:
                body = json.loads(existing[0])
            else:
                pkg = c.execute("SELECT body FROM packages WHERE id=?", (pid,)).fetchone()
                if not pkg:
                    c.execute("ROLLBACK")
                    return None, False
                package = json.loads(pkg[0])
                number = generate_unique_number(
                    lambda n: c.execute("SELECT 1 FROM reservations WHERE number=?", (n,)).fetchone() is not None
                )
                for item in package["items"]:
                    item["status"], item["booking"] = "BOOKED", {"reference": number}
                body = {"reservation_number": number, "package": package}
                c.execute("UPDATE packages SET body=? WHERE id=?", (json.dumps(package), pid))
                c.execute("INSERT INTO reservations VALUES (?, ?, ?)", (number, pid, json.dumps(body)))
            c.execute("INSERT INTO idempotency VALUES (?, ?, ?)", (key, f"confirm:{pid}", json.dumps(body)))
            c.execute("COMMIT")
            return body, False
        return self._run(go)
