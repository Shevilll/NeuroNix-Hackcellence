"""S2: a confirmed reservation uses up seats and rooms; a booking for the same last ones is refused."""

from dataclasses import replace
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}


@pytest.fixture
def app(tmp_path):
    return create_app(replace(load_settings(), db_path=tmp_path / "t.db"))


def test_with_holds_reduces_seats_and_rooms(app):
    catalog = app.state.catalog
    flight = catalog.flights["FL-401"]
    room_id = next(iter(catalog.rooms))
    night = date(2027, 4, 10)
    before = catalog.rooms_left(room_id, night)
    view = catalog.with_holds({"FL-401": 4}, {(room_id, night): before + 5})
    assert view.flights["FL-401"].seats_left == flight.seats_left - 4
    assert view.rooms_left(room_id, night) == 0
    assert catalog.flights["FL-401"].seats_left == flight.seats_left  # the original is untouched
    assert [f.flight_id for f in view.arrival_flights("BLR", ["NRT"], date(2027, 4, 10))]


def test_last_seats_go_to_the_first_confirm_only(app):
    # Leave exactly 3 seats on the flight Menon's package uses, then book two identical packages.
    app.state.catalog = app.state.catalog.with_holds({"FL-401": app.state.catalog.flights["FL-401"].seats_left - 3}, {})
    client = TestClient(app)
    first = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "a"}).json()
    second = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    flight_ids = {i["catalog_id"] for i in first["package"]["items"] if i["role"] == "arrival_flight"}
    assert flight_ids == {"FL-401"}

    ok = client.post(f"/api/packages/{first['package_id']}/confirm", headers={"Idempotency-Key": "c1"})
    assert ok.status_code == 200
    refused = client.post(f"/api/packages/{second['package_id']}/confirm", headers={"Idempotency-Key": "c2"})
    assert refused.status_code == 409
    assert refused.json()["detail"]["code"] == "SOLD_OUT"
    # nothing was booked for the loser
    assert client.get(f"/api/packages/{second['package_id']}").json()["items"][0]["status"] == "PLANNED"


def test_replayed_confirm_does_not_use_seats_twice(app):
    client = TestClient(app)
    pkg = client.post("/api/packages", json=MENON).json()
    for _ in range(3):
        client.post(f"/api/packages/{pkg['package_id']}/confirm", headers={"Idempotency-Key": "same"})
    seats = lambda: client.app.state.store.flight_holds()  # noqa: E731
    flight_id = next(i["catalog_id"] for i in pkg["package"]["items"] if i["role"] == "arrival_flight")
    assert seats()[flight_id] == 3


def test_later_builds_see_the_reduced_inventory(app):
    client = TestClient(app)
    for n in range(40):
        built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": f"b{n}"}).json()
        if built["status"] != "OK":
            break
        res = client.post(f"/api/packages/{built['package_id']}/confirm", headers={"Idempotency-Key": f"c{n}"})
        assert res.status_code == 200, res.text
    catalog = app.state.catalog
    store = app.state.store
    for flight_id, seats in store.flight_holds().items():
        assert seats <= catalog.flights[flight_id].seats_left
    for (room_id, night), rooms in store.room_holds().items():
        assert rooms <= catalog.rooms_left(room_id, date.fromisoformat(night))
