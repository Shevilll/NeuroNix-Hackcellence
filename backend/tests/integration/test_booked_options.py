"""The change options of a confirmed booking: its own seats and rooms count as free for it.

Confirming holds the booking's seats and rooms. Checking an alternative against stock that still
counts those holds would see the booking's own flight as sold out and refuse every option.
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


def _options(client, pid, kind, **params):
    response = client.get(f"/api/packages/{pid}/options/{kind}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _build_on_the_last_seats(client):
    """A package whose flights then have exactly its own seats left, as when other travellers
    have booked the rest."""
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    catalog = client.app.state.catalog
    flights = [i for i in built["package"]["items"] if i["type"] == "flight"]
    client.app.state.catalog = catalog.with_holds(
        {i["catalog_id"]: catalog.flights[i["catalog_id"]].seats_left - i["quantity"] for i in flights}, {})
    return built


def _city(package):
    return next(i["city"] for i in package["items"] if i["type"] == "hotel")


@pytest.mark.parametrize("kind, params", [("hotels", None), ("flights", {"role": "arrival_flight"}),
                                          ("attractions", {})])
def test_a_booking_offers_the_same_options_as_before_it_was_confirmed(client, kind, params):
    built = _build_on_the_last_seats(client)
    pid = built["package_id"]
    query = {"city": _city(built["package"])} if params is None else params
    before = _options(client, pid, kind, **query)
    assert before, "the unbooked package has options to compare with"

    client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "c"})

    after = _options(client, pid, kind, **query)
    key = lambda o: (o.get("hotel_id"), o.get("room_id"), o.get("flight_id"), o.get("attraction_id"), o.get("date"))
    assert sorted(map(key, after)) == sorted(map(key, before))


def test_city_plans_of_a_booking_are_still_offered(client):
    built = _build_on_the_last_seats(client)
    pid = built["package_id"]
    before = client.get(f"/api/packages/{pid}/city-plans").json()
    client.post(f"/api/packages/{pid}/confirm", headers={"Idempotency-Key": "c"})
    assert client.get(f"/api/packages/{pid}/city-plans").json() == before
