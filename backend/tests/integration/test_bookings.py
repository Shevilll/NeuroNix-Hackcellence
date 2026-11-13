"""Bookings list and delete: see every reservation, and delete one or all of them for a clean demo.

Deleting a booking gives its seats and rooms back, removes its package, and forgets the stored
answers of its retries, so an old Idempotency-Key can never bring a deleted number back.
"""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}
UAE = {"origin": "DEL", "country": "United Arab Emirates", "start_date": "2027-04-05", "nights": 5,
       "adults": 2, "children_ages": [], "budget": 250000}


@pytest.fixture
def app(tmp_path):
    return create_app(replace(load_settings(), db_path=tmp_path / "t.db"))


@pytest.fixture
def client(app):
    return TestClient(app)


def book(client, request, key):
    built = client.post("/api/packages", json=request, headers={"Idempotency-Key": f"build-{key}"}).json()
    pid = built["package_id"]
    confirmed = client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": f"confirm-{key}"}).json()
    return pid, confirmed["reservation_number"]


def test_the_list_starts_empty(client):
    assert client.get("/api/reservations").json() == []


def test_lists_every_booking_newest_first_with_a_summary(client):
    _, first = book(client, MENON, "a")
    _, second = book(client, UAE, "b")
    rows = client.get("/api/reservations").json()
    assert [r["reservation_number"] for r in rows] == [second, first]
    menon = rows[1]
    assert menon["cities"] == ["Tokyo", "Kyoto", "Osaka"]
    assert menon["country"] == "Japan"
    assert (menon["start_date"], menon["end_date"]) == ("2027-04-10", "2027-04-16")
    assert menon["total_inr"] == 231924
    assert (menon["adults"], menon["children"]) == (2, 1)
    assert menon["created_at"]


def test_deleting_a_booking_removes_it_and_gives_its_seats_and_rooms_back(app, client):
    store = app.state.store
    _, keep = book(client, UAE, "keep")
    seats_before, rooms_before = store.flight_holds(), store.room_holds()
    pid, gone = book(client, MENON, "gone")

    assert client.delete(f"/api/reservations/{gone}").status_code == 204

    assert client.get(f"/api/reservations/{gone}").status_code == 404
    assert client.get(f"/api/packages/{pid}").status_code == 404
    assert [r["reservation_number"] for r in client.get("/api/reservations").json()] == [keep]
    assert store.flight_holds() == seats_before
    assert store.room_holds() == rooms_before
    assert client.get(f"/api/reservations/{keep}").status_code == 200


def test_a_deleted_booking_frees_the_last_seats_for_someone_else(app):
    # Leave exactly 3 seats on Menon's arrival flight: the second identical booking is sold out
    # until the first one is deleted.
    app.state.catalog = app.state.catalog.with_holds({"FL-401": app.state.catalog.flights["FL-401"].seats_left - 3}, {})
    client = TestClient(app)
    first = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "a"}).json()
    second = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    assert "FL-401" in {i["catalog_id"] for i in first["package"]["items"]}
    number = client.post(f"/api/packages/{first['package_id']}/confirm", headers={"Idempotency-Key": "c1"}).json()["reservation_number"]
    assert client.post(f"/api/packages/{second['package_id']}/confirm", headers={"Idempotency-Key": "c2"}).status_code == 409

    client.delete(f"/api/reservations/{number}")

    assert client.post(f"/api/packages/{second['package_id']}/confirm", headers={"Idempotency-Key": "c3"}).status_code == 200


def test_an_old_retry_key_cannot_bring_a_deleted_booking_back(client):
    pid, number = book(client, MENON, "a")
    client.delete(f"/api/reservations/{number}")
    retry = client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "confirm-a"})
    assert retry.status_code == 404
    rebuilt = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "build-a"}).json()
    assert rebuilt["package_id"] != pid
    assert client.get(f"/api/packages/{rebuilt['package_id']}").status_code == 200


def test_deleting_an_unknown_or_already_deleted_number_is_not_found(client):
    _, number = book(client, MENON, "a")
    assert client.delete("/api/reservations/1234567890").status_code == 404
    assert client.delete(f"/api/reservations/{number}").status_code == 204
    assert client.delete(f"/api/reservations/{number}").status_code == 404


def test_deleting_all_bookings_empties_the_list_and_every_hold(app, client):
    book(client, MENON, "a")
    book(client, UAE, "b")
    answer = client.delete("/api/reservations")
    assert answer.status_code == 200
    assert answer.json() == {"deleted": 2}
    assert client.get("/api/reservations").json() == []
    assert app.state.store.flight_holds() == {}
    assert app.state.store.room_holds() == {}
    assert client.delete("/api/reservations").json() == {"deleted": 0}


def test_packages_that_were_never_booked_are_kept(client):
    draft = client.post("/api/packages", json=UAE).json()["package_id"]
    book(client, MENON, "a")
    client.delete("/api/reservations")
    assert client.get(f"/api/packages/{draft}").status_code == 200
