"""The app's persistence facade: packages, idempotent build/confirm, reservations, inventory holds.

Built on the three small pieces in this package: ``Database`` (connections and transactions),
``PackageRepo`` (versioned packages) and ``execute_once`` (idempotency keys). Confirm runs as one
transaction: replay check, re-validation against holds, holds, reservation, booked package.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from app.store.db import Database
from app.store.idempotency import IdempotencyKeyReused, execute_once
from app.store.packages import PackageRepo
from app.store.reservations import generate_unique_number

__all__ = ["ChangeBlocked", "IdempotencyKeyReused", "SoldOut", "Store", "demand"]


class SoldOut(Exception):
    """The last seats or rooms of this package were booked by someone else."""


class ChangeBlocked(Exception):
    """A change cannot be applied: the package is 'missing', 'booked', or in 'conflict' (stale version)."""

    def __init__(self, kind: str, package: dict[str, Any] | None = None) -> None:
        super().__init__(kind)
        self.kind = kind
        self.package = package


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


def _public(stored) -> dict[str, Any]:
    """The package as the API shows it: id and version come from the row, not the stored JSON."""
    return {**stored.package, "trip_id": stored.package_id, "version": stored.version}


class Store:
    def __init__(self, path: Path) -> None:
        self.db = Database(path)
        self.db.migrate()
        self.packages = PackageRepo(self.db)

    # ----- packages
    def save_package(self, package: dict[str, Any], key: str | None = None, request: Any = None) -> str:
        """Store a new package. With a key, a retry returns the package saved the first time."""
        body = request if request is not None else {}

        def create(conn):
            return 200, {"package_id": self.packages.create(body, package, conn=conn).package_id}

        if key is None:
            with self.db.transaction() as conn:
                return create(conn)[1]["package_id"]
        return execute_once(self.db, scope="build", key=key, body=body, action=create).body["package_id"]

    def get_package(self, pid: str) -> dict[str, Any] | None:
        stored = self.packages.get(pid)
        return _public(stored) if stored else None

    def change_package(self, pid: str, key: str | None, body: dict[str, Any], apply, report) -> tuple[dict[str, Any], bool]:
        """Apply one change as a single transaction. Returns (answer, replayed).

        ``apply(package)`` gives the changed package (or raises to refuse); ``report(before, after)``
        gives the extra answer fields. With a key, the answer is stored in the same transaction as
        the new version, so a retry after a lost response gets that answer back instead of a
        version conflict. Keys are scoped to the package. Raises ``ChangeBlocked`` and
        ``IdempotencyKeyReused``; when anything raises, nothing is stored.
        """

        def change(conn):
            stored = self.packages.get(pid, conn=conn)
            if stored is None:
                raise ChangeBlocked("missing")
            current = _public(stored)
            if stored.status == "BOOKED":
                raise ChangeBlocked("booked", current)
            if body.get("expected_version", stored.version) != stored.version:
                raise ChangeBlocked("conflict", current)
            updated = apply(current)
            saved = self.packages.update(pid, stored.version, updated, conn=conn)
            return 200, {"package_id": pid, "package": _public(saved), **report(current, updated)}

        if key is None:
            with self.db.transaction() as conn:
                return change(conn)[1], False
        result = execute_once(self.db, scope=f"change:{pid}", key=key, body=body, action=change)
        return result.body, result.replayed

    # ----- S2 inventory
    def flight_holds(self) -> dict[str, int]:
        with self.db.transaction() as c:
            return {r["flight_id"]: r["seats"] for r in c.execute("SELECT flight_id, seats FROM flight_holds")}

    def room_holds(self) -> dict[tuple[str, str], int]:
        with self.db.transaction() as c:
            return {(r["room_id"], r["night"]): r["rooms"] for r in c.execute("SELECT * FROM room_holds")}

    # ----- reservations
    def get_reservation(self, number: str) -> dict[str, Any] | None:
        with self.db.transaction() as c:
            row = c.execute("SELECT body_json FROM reservations WHERE number=?", (number,)).fetchone()
        return json.loads(row["body_json"]) if row else None

    def list_reservations(self) -> list[dict[str, Any]]:
        """Every reservation, newest first, as a short summary for the bookings list."""
        with self.db.transaction() as c:
            rows = c.execute("SELECT number, body_json, created_at FROM reservations ORDER BY created_at DESC, rowid DESC").fetchall()
        out = []
        for row in rows:
            package = json.loads(row["body_json"])["package"]
            traveler = package.get("traveler") or {}
            out.append({
                "reservation_number": row["number"],
                "created_at": row["created_at"],
                "country": package.get("country"),
                "cities": package.get("cities", []),
                "nights_per_city": package.get("nights_per_city", []),
                "start_date": package.get("start_date"),
                "end_date": package.get("end_date"),
                "adults": traveler.get("adults"),
                "children": len(traveler.get("child_ages") or []),
                "total_inr": package.get("total_inr"),
            })
        return out

    def delete_reservation(self, number: str) -> bool:
        """Delete one booking. False when there is no such number."""
        with self.db.transaction() as conn:
            return self._delete_reservation(conn, number)

    def delete_all_reservations(self) -> int:
        """Delete every booking in one transaction. Returns how many were deleted."""
        with self.db.transaction() as conn:
            numbers = [r["number"] for r in conn.execute("SELECT number FROM reservations")]
            for number in numbers:
                self._delete_reservation(conn, number)
            return len(numbers)

    @staticmethod
    def _delete_reservation(conn, number: str) -> bool:
        """Give the seats and rooms back, then remove the reservation, its package, and the stored
        answers of its build, change and confirm retries (so an old key cannot bring it back)."""
        row = conn.execute("SELECT package_id, body_json FROM reservations WHERE number=?", (number,)).fetchone()
        if row is None:
            return False
        pid = row["package_id"]
        seats, rooms = demand(json.loads(row["body_json"])["package"])
        for flight_id, n in seats.items():
            conn.execute("UPDATE flight_holds SET seats = seats - ? WHERE flight_id=?", (n, flight_id))
        for (room_id, night), n in rooms.items():
            conn.execute("UPDATE room_holds SET rooms = rooms - ? WHERE room_id=? AND night=?", (n, room_id, night))
        conn.execute("DELETE FROM flight_holds WHERE seats <= 0")
        conn.execute("DELETE FROM room_holds WHERE rooms <= 0")
        conn.execute("DELETE FROM reservations WHERE number=?", (number,))
        conn.execute(
            "DELETE FROM idempotency_keys WHERE (scope='confirm' AND json_extract(response_json, '$.reservation_number')=?)"
            " OR (scope='build' AND json_extract(response_json, '$.package_id')=?) OR scope=?",
            (number, pid, f"change:{pid}"),
        )
        conn.execute("DELETE FROM package_versions WHERE package_id=?", (pid,))
        conn.execute("DELETE FROM packages WHERE package_id=?", (pid,))
        return True

    def confirm(self, pid: str, key: str, check=None) -> tuple[dict[str, Any] | None, bool]:
        """Returns (reservation, replayed); (None, False) for an unknown package.

        Raises ``IdempotencyKeyReused`` (same key, other package) and ``SoldOut``.
        """
        if self.packages.get(pid) is None:
            return None, False

        def book(conn):
            existing = conn.execute("SELECT body_json FROM reservations WHERE package_id=?", (pid,)).fetchone()
            if existing:  # this package is already booked: hand back its reservation
                return 200, json.loads(existing["body_json"])
            package = self.packages.get(pid, conn=conn).package
            held_seats = {r["flight_id"]: r["seats"] for r in conn.execute("SELECT flight_id, seats FROM flight_holds")}
            held_rooms = {(r["room_id"], r["night"]): r["rooms"] for r in conn.execute("SELECT * FROM room_holds")}
            if check is not None and (problem := check(package, held_seats, held_rooms)):
                raise SoldOut(problem)  # the transaction rolls back: nothing is stored
            seats, rooms = demand(package)
            for flight_id, n in seats.items():
                conn.execute(
                    "INSERT INTO flight_holds VALUES (?, ?) ON CONFLICT(flight_id) DO UPDATE SET seats = seats + ?",
                    (flight_id, n, n))
            for (room_id, night), n in rooms.items():
                conn.execute(
                    "INSERT INTO room_holds VALUES (?, ?, ?) ON CONFLICT(room_id, night) DO UPDATE SET rooms = rooms + ?",
                    (room_id, night, n, n))
            number = generate_unique_number(
                lambda n: conn.execute("SELECT 1 FROM reservations WHERE number=?", (n,)).fetchone() is not None)
            booked = json.loads(json.dumps(package))
            for item in booked["items"]:
                item["status"], item["booking"] = "BOOKED", {"reference": number}
            body = {"reservation_number": number, "package": {**booked, "trip_id": pid}}
            self.packages.save_booked(pid, booked, conn)
            conn.execute("INSERT INTO reservations VALUES (?, ?, ?, ?)",
                         (number, pid, json.dumps(body), datetime.now(UTC).isoformat()))
            return 200, body

        result = execute_once(self.db, scope="confirm", key=key, body={"package_id": pid}, action=book)
        return result.body, result.replayed
