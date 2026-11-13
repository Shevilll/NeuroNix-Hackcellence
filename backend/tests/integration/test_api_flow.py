"""Build -> export -> confirm (idempotent) -> reservation, also after an app restart."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}


@pytest.fixture
def settings(tmp_path):
    return replace(load_settings(), db_path=tmp_path / "t.db")


def test_full_flow_and_restart(settings):
    client = TestClient(create_app(settings))
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b1"}).json()
    assert built["status"] == "OK"
    pid = built["package_id"]
    again = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b1"}).json()
    assert again["package_id"] == pid

    export = client.get(f"/api/packages/{pid}/export")
    assert export.status_code == 200 and "attachment" in export.headers["content-disposition"]

    assert client.post(f"/api/packages/{pid}/confirm").status_code == 400
    first = client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "k1"})
    second = client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "k1"})
    number = first.json()["reservation_number"]
    assert len(number) == 10 and number[0] != "0"
    assert second.json()["reservation_number"] == number
    assert second.headers["Idempotent-Replay"] == "true"
    other_key = client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "k2"})
    assert other_key.json()["reservation_number"] == number

    restarted = TestClient(create_app(settings))
    got = restarted.get(f"/api/reservations/{number}").json()
    assert got["reservation_number"] == number
    assert all(i["status"] == "BOOKED" and i["booking"]["reference"] == number for i in got["package"]["items"])
    assert restarted.get("/api/reservations/1234567890").status_code == 404


def test_invalid_request_is_422_with_field_messages(settings):
    client = TestClient(create_app(settings))
    res = client.post("/api/packages", json={**MENON, "nights": 2})
    assert res.status_code == 422
    assert any("nights" in d["loc"] for d in res.json()["detail"])


def test_unknown_package_is_404(settings):
    assert TestClient(create_app(settings)).get("/api/packages/nope").status_code == 404


def test_change_flow_versions_and_booked_lock(settings):
    client = TestClient(create_app(settings))
    built = client.post("/api/packages", json=MENON).json()
    pid, pkg = built["package_id"], built["package"]
    assert pkg["version"] == 1
    city = pkg["cities"][0]
    opts = client.get(f"/api/packages/{pid}/options/hotels", params={"city": city}).json()
    pick = opts[-1]
    body = {"op": "replace_hotel", "city": city, "hotel_id": pick["hotel_id"], "room_id": pick["room_id"],
            "expected_version": 1}
    done = client.post(f"/api/packages/{pid}/changes", json=body)
    assert done.status_code == 200 and done.json()["package"]["version"] == 2
    assert client.post(f"/api/packages/{pid}/changes", json=body).status_code == 409  # stale version
    refused = client.post(f"/api/packages/{pid}/changes",
                          json={"op": "replace_hotel", "city": city, "hotel_id": "X", "room_id": "Y", "expected_version": 2})
    assert refused.status_code == 422 and refused.json()["detail"]["message"]
    client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "z"})
    locked = client.post(f"/api/packages/{pid}/changes", json={**body, "expected_version": 2})
    assert locked.status_code == 409


def test_build_returns_three_bookable_alternatives(settings):
    client = TestClient(create_app(settings))
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "alt"}).json()
    assert set(built["alternatives"]) == {"cheapest", "fastest", "best_rated"}
    replay = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "alt"}).json()
    assert replay["alternatives"]["fastest"]["package_id"] == built["alternatives"]["fastest"]["package_id"]
    alt = built["alternatives"]["cheapest"]
    assert client.get(f"/api/packages/{alt['package_id']}").json()["total_inr"] == alt["package"]["total_inr"]
