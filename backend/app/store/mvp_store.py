"""SQLite persistence: packages, reservations and idempotency keys (WAL, busy timeout)."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from app.store.reservations import generate_unique_number

SCHEMA = """
CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reservations (
  number TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS flight_holds (flight_id TEXT PRIMARY KEY, seats INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS room_holds (
  room_id TEXT NOT NULL, night TEXT NOT NULL, rooms INTEGER NOT NULL, PRIMARY KEY (room_id, night));
CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL, scope TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY (key, scope));
"""


class SoldOut(Exception):
    """The last seats or rooms of this package were booked by someone else."""


def demand(package: dict[str, Any]) -> tuple[dict[str, int], dict[tuple[str, str], int]]:
    """Seats per flight and rooms per (room, night) that a package uses."""
    seats: dict[str, int] = {}
    rooms: dict[tuple[str, str], int] = {}
    for item in package["items"]:
        if item["type"] == "flight":
            seats[item["catalog_id"]] = seats.get(item["catalog_id"], 0) + item["quantity"]
        elif item["type"] == "hotel":
            start = date.fromisoformat(item["start"])
            for n in range((date.fromisoformat(item["end"]) - start).days):
                key = (item["room_id"], (start + timedelta(days=n)).isoformat())
                rooms[key] = rooms.get(key, 0) + item["quantity"]
    return seats, rooms


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
            package["trip_id"], package["version"] = pid, 1
            c.execute("INSERT INTO packages VALUES (?, ?)", (pid, json.dumps(package)))
            if key:
                c.execute("INSERT INTO idempotency VALUES (?, 'build', ?)", (key, json.dumps({"package_id": pid})))
            c.execute("COMMIT")
            return pid
        return self._run(go)

    def get_package(self, pid: str) -> dict[str, Any] | None:
        row = self._run(lambda c: c.execute("SELECT body FROM packages WHERE id=?", (pid,)).fetchone())
        return json.loads(row[0]) if row else None

    def update_package(self, pid: str, package: dict[str, Any], expected_version: int) -> str:
        """Optimistic update: 'ok', 'conflict' (stale version), 'booked' or 'missing'."""
        def go(c):
            c.execute("BEGIN IMMEDIATE")
            row = c.execute("SELECT body FROM packages WHERE id=?", (pid,)).fetchone()
            current = json.loads(row[0]) if row else None
            if current is None:
                c.execute("ROLLBACK")
                return "missing"
            if c.execute("SELECT 1 FROM reservations WHERE package_id=?", (pid,)).fetchone():
                c.execute("ROLLBACK")
                return "booked"
            if current.get("version", 1) != expected_version:
                c.execute("ROLLBACK")
                return "conflict"
            package["trip_id"], package["version"] = pid, expected_version + 1
            c.execute("UPDATE packages SET body=? WHERE id=?", (json.dumps(package), pid))
            c.execute("COMMIT")
            return "ok"
        return self._run(go)

    # ----- S2 inventory
    def flight_holds(self) -> dict[str, int]:
        return dict(self._run(lambda c: c.execute("SELECT flight_id, seats FROM flight_holds").fetchall()))

    def room_holds(self) -> dict[tuple[str, str], int]:
        rows = self._run(lambda c: c.execute("SELECT room_id, night, rooms FROM room_holds").fetchall())
        return {(r, n): k for r, n, k in rows}

    # ----- reservations
    def get_reservation(self, number: str) -> dict[str, Any] | None:
        row = self._run(lambda c: c.execute("SELECT body FROM reservations WHERE number=?", (number,)).fetchone())
        return json.loads(row[0]) if row else None

    def confirm(self, pid: str, key: str, check=None) -> tuple[dict[str, Any] | None, bool]:
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
                held_seats = dict(c.execute("SELECT flight_id, seats FROM flight_holds").fetchall())
                held_rooms = {(r, n): k for r, n, k in c.execute("SELECT room_id, night, rooms FROM room_holds")}
                if check is not None:
                    problem = check(package, held_seats, held_rooms)
                    if problem:
                        c.execute("ROLLBACK")
                        raise SoldOut(problem)
                seats, rooms = demand(package)
                for fid, n in seats.items():
                    c.execute("INSERT INTO flight_holds VALUES (?, ?) ON CONFLICT(flight_id) DO UPDATE SET seats = seats + ?", (fid, n, n))
                for (rid, night), n in rooms.items():
                    c.execute("INSERT INTO room_holds VALUES (?, ?, ?) ON CONFLICT(room_id, night) DO UPDATE SET rooms = rooms + ?", (rid, night, n, n))
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
