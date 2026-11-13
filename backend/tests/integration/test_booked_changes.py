"""A booking can still be edited after it is confirmed: POST /reservations/{number}/changes.

The change is re-checked like any other, the seats and rooms move with it, and a retry with the
same Idempotency-Key is applied once.
"""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))


def _book(client):
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    booked = client.post(f"/api/packages/{built['package_id']}/confirm", headers={"Idempotency-Key": "c"}).json()
    return built["package_id"], booked["reservation_number"], booked["package"]


def _remove_first_attraction(package):
    target = next(i for i in package["items"] if i["type"] == "attraction")
    return {"op": "remove_attraction", "item_id": target["item_id"], "expected_version": package["version"]}


def _flight_id(package, role):
    return next(i["catalog_id"] for i in package["items"] if i.get("role") == role)


def test_a_booked_package_can_be_changed_through_its_reservation_number(client):
    _, number, package = _book(client)
    change = _remove_first_attraction(package)

    response = client.post(f"/api/reservations/{number}/changes", json=change, headers={"Idempotency-Key": "e1"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reservation_number"] == number
    assert len(body["package"]["items"]) == len(package["items"]) - 1
    assert all(i["status"] == "BOOKED" and i["booking"] == {"reference": number} for i in body["package"]["items"])
    # the reservation summary now shows the edited package
    assert client.get(f"/api/reservations/{number}").json()["package"]["items"] == body["package"]["items"]


def test_the_price_total_follows_the_edit(client):
    pid, number, package = _book(client)
    old = _flight_id(package, "arrival_flight")
    options = client.get(f"/api/packages/{pid}/options/flights", params={"role": "arrival_flight"}).json()
    other = next(o for o in options if o["flight_id"] != old and o["price_diff"] != 0)
    change = {"op": "replace_flight", "role": "arrival_flight", "flight_id": other["flight_id"],
              "expected_version": package["version"]}

    body = client.post(f"/api/reservations/{number}/changes", json=change, headers={"Idempotency-Key": "e1"}).json()

    assert body["package"]["total_inr"] == package["total_inr"] + other["price_diff"]
    assert body["price_diff_inr"] == other["price_diff"]
    listed = next(r for r in client.get("/api/reservations").json() if r["reservation_number"] == number)
    assert listed["total_inr"] == body["package"]["total_inr"]


def test_changing_the_flight_moves_the_seats(client):
    pid, number, package = _book(client)
    old = _flight_id(package, "arrival_flight")
    options = client.get(f"/api/packages/{pid}/options/flights", params={"role": "arrival_flight"}).json()
    other = next(o for o in options if o["flight_id"] != old)
    change = {"op": "replace_flight", "role": "arrival_flight", "flight_id": other["flight_id"],
              "expected_version": package["version"]}

    response = client.post(f"/api/reservations/{number}/changes", json=change, headers={"Idempotency-Key": "e1"})

    assert response.status_code == 200, response.text
    holds = client.app.state.store.flight_holds()
    assert old not in holds
    assert holds[other["flight_id"]] == 3


def test_a_retry_with_the_same_key_is_applied_once(client):
    _, number, package = _book(client)
    change = _remove_first_attraction(package)

    first = client.post(f"/api/reservations/{number}/changes", json=change, headers={"Idempotency-Key": "e1"})
    retry = client.post(f"/api/reservations/{number}/changes", json=change, headers={"Idempotency-Key": "e1"})

    assert retry.status_code == 200, retry.text
    assert retry.headers["Idempotent-Replay"] == "true"
    assert retry.json() == first.json()
    assert client.get(f"/api/reservations/{number}").json()["package"]["version"] == package["version"] + 1


def test_a_stale_version_is_a_conflict_and_changes_nothing(client):
    _, number, package = _book(client)
    change = {**_remove_first_attraction(package), "expected_version": package["version"] + 5}

    response = client.post(f"/api/reservations/{number}/changes", json=change, headers={"Idempotency-Key": "e1"})

    assert response.status_code == 409
    assert client.get(f"/api/reservations/{number}").json()["package"] == package


def test_a_refused_change_leaves_the_booking_as_it_was(client):
    _, number, package = _book(client)
    response = client.post(f"/api/reservations/{number}/changes",
                           json={"op": "remove_attraction", "item_id": "nope", "expected_version": package["version"]},
                           headers={"Idempotency-Key": "e1"})
    assert response.status_code == 422
    assert client.get(f"/api/reservations/{number}").json()["package"] == package


def test_an_unknown_reservation_is_not_found(client):
    response = client.post("/api/reservations/0000000000/changes", json={"op": "space_visits"},
                           headers={"Idempotency-Key": "e1"})
    assert response.status_code == 404


def test_deleting_an_edited_booking_gives_back_the_new_seats(client):
    pid, number, package = _book(client)
    old = _flight_id(package, "arrival_flight")
    options = client.get(f"/api/packages/{pid}/options/flights", params={"role": "arrival_flight"}).json()
    other = next(o for o in options if o["flight_id"] != old)
    client.post(f"/api/reservations/{number}/changes", headers={"Idempotency-Key": "e1"},
                json={"op": "replace_flight", "role": "arrival_flight", "flight_id": other["flight_id"],
                      "expected_version": package["version"]})

    assert client.delete(f"/api/reservations/{number}").status_code == 204

    assert client.app.state.store.flight_holds() == {}
    assert client.app.state.store.room_holds() == {}
