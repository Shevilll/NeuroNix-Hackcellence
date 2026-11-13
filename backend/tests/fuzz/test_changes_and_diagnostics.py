"""Fuzz the parts judges poke at after the first package: changes, explanations, bad input.

Invariants
  * A change either returns a package with zero rule violations and a correct total, or is refused
    with a reason. It never crashes, never returns an invalid package, never mutates its input.
  * Every suggestion and "nearby" option in an explanation was really solved and is as stated.
  * No request payload, however broken, produces a server error (500).
"""

import copy
import itertools
import json
import math
import random
import tempfile
from functools import lru_cache
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings, strategies as st

from app.catalog.loader import load_catalog
from app.changes.operations import ChangeRefused, apply_change, change_report, list_options
from app.config import load_settings
from app.domain.request import RequestInvalid, TripRequest, parse_request
from app.main import create_app
from app.planner.builder import build_package
from app.rules.validate import validate_package

catalog = load_catalog(load_settings().data_dir)
ORIGINS = [c.airport for c in catalog.departure_cities]
COUNTRIES = [c.name for c in catalog.countries.values()]
FIRST, LAST = catalog.rules.first_night, catalog.rules.last_departure


def built_packages():
    """A spread of real packages: every origin and country, two dates, two lengths, two parties."""
    found = []
    for origin, country in itertools.product(ORIGINS, COUNTRIES):
        for start, nights, party in itertools.product((date(2027, 4, 2), date(2027, 4, 8)), (4, 7), ((2, (6,)), (1, ()))):
            request = TripRequest(origin, country, start, nights, party[0], party[1], 10**7)
            result = build_package(request, catalog)
            if result["status"] == "OK":
                found.append(result["package"])
    return found


PACKAGES = built_packages()


def assert_good_change(before, snapshot, after):
    assert before == snapshot, "apply_change mutated its input"
    assert validate_package(after, catalog, require_daily_attractions=False) == []
    assert after["total_inr"] == sum(i["price_inr"] for i in after["items"])
    ids = [i["item_id"] for i in after["items"]]
    assert len(ids) == len(set(ids))
    report = change_report(before, after)
    assert report["price_diff_inr"] == after["total_inr"] - before["total_inr"]
    assert all(w["code"] and w["message"] for w in report["warnings"])


def try_change(package, change):
    """Apply one change. Returns the new package, or None if it was refused with a reason."""
    snapshot = copy.deepcopy(package)
    try:
        after = apply_change(package, catalog, change)
    except ChangeRefused as refusal:
        assert refusal.reason, change
        assert package == snapshot
        return None
    assert_good_change(package, snapshot, after)
    return after


def test_there_are_packages_to_fuzz():
    assert len(PACKAGES) >= 20


# ------------------------------------------------------------------ every change, one at a time


def test_every_flight_hotel_and_room_change_is_valid_or_refused():
    refused = ok = 0
    for package in PACKAGES:
        cities = [i["city"] for i in package["items"] if i["type"] == "hotel"]
        for role, flight in itertools.product(("arrival_flight", "return_flight"), catalog.flights.values()):
            outcome = try_change(package, {"op": "replace_flight", "role": role, "flight_id": flight.flight_id})
            ok, refused = ok + (outcome is not None), refused + (outcome is None)
        for city in cities:
            for hotel in catalog.hotels_in(city):
                outcome = try_change(package, {"op": "replace_hotel", "city": city, "hotel_id": hotel.hotel_id})
                ok, refused = ok + (outcome is not None), refused + (outcome is None)
                for room in catalog.rooms_of(hotel.hotel_id):
                    change = {"op": "replace_hotel", "city": city, "hotel_id": hotel.hotel_id, "room_id": room.room_id}
                    outcome = try_change(package, change)
                    ok, refused = ok + (outcome is not None), refused + (outcome is None)
    assert ok > 0 and refused > 0  # both paths were exercised


def test_every_attraction_on_every_day_is_valid_or_refused():
    ok = refused = 0
    for package in PACKAGES[:12]:
        start, end = date.fromisoformat(package["start_date"]), date.fromisoformat(package["end_date"])
        days = [start + timedelta(days=n) for n in range((end - start).days + 1)]
        for attraction in catalog.attractions.values():
            for day in days:
                outcome = try_change(package, {"op": "add_attraction", "attraction_id": attraction.attraction_id, "date": day.isoformat()})
                ok, refused = ok + (outcome is not None), refused + (outcome is None)
        for item in (i for i in package["items"] if i["type"] == "attraction"):
            assert try_change(package, {"op": "remove_attraction", "item_id": item["item_id"]}) is not None
    assert ok > 0 and refused > 0


def test_every_listed_option_can_really_be_applied_with_the_price_it_shows():
    for package in PACKAGES[:16]:
        shown = []
        for city in [i["city"] for i in package["items"] if i["type"] == "hotel"]:
            shown += [(o, {"op": "replace_hotel", "city": city, "hotel_id": o["hotel_id"], "room_id": o["room_id"]})
                      for o in list_options(package, catalog, "hotels", city=city)]
        for role in ("arrival_flight", "return_flight"):
            shown += [(o, {"op": "replace_flight", "role": role, "flight_id": o["flight_id"]})
                      for o in list_options(package, catalog, "flights", role=role)]
        shown += [(o, {"op": "add_attraction", "attraction_id": o["attraction_id"], "date": o["date"]})
                  for o in list_options(package, catalog, "attractions")]
        for option, change in shown:
            after = try_change(package, change)
            assert after is not None, ("listed option was refused", change)
            assert after["total_inr"] - package["total_inr"] == option["price_diff"]


# ------------------------------------------------------------------ random sequences of changes


@pytest.mark.parametrize("seed", range(6))
def test_random_change_sequences_keep_the_package_valid(seed):
    rng = random.Random(seed)
    for package in rng.sample(PACKAGES, 8):
        current = package
        cities = [i["city"] for i in package["items"] if i["type"] == "hotel"]
        start, end = date.fromisoformat(package["start_date"]), date.fromisoformat(package["end_date"])
        for _ in range(8):
            kind = rng.choice(("hotel", "flight", "add", "remove"))
            if kind == "hotel":
                city = rng.choice(cities)
                hotel = rng.choice(catalog.hotels_in(city))
                change = {"op": "replace_hotel", "city": city, "hotel_id": hotel.hotel_id}
            elif kind == "flight":
                change = {"op": "replace_flight", "role": rng.choice(("arrival_flight", "return_flight")),
                          "flight_id": rng.choice(sorted(catalog.flights))}
            elif kind == "add":
                day = start + timedelta(days=rng.randrange((end - start).days + 1))
                change = {"op": "add_attraction", "attraction_id": rng.choice(sorted(catalog.attractions)),
                          "date": day.isoformat()}
            else:
                visits = [i for i in current["items"] if i["type"] == "attraction"]
                if not visits:
                    continue
                change = {"op": "remove_attraction", "item_id": rng.choice(visits)["item_id"]}
            after = try_change(current, change)
            if after is not None:
                current = after


# ------------------------------------------------------------------ explanations tell the truth


def explanation_grid():
    parties = ((2, (6,)), (1, ()), (7, (3, 4)))
    for origin, country in itertools.product(ORIGINS, COUNTRIES):
        for offset, nights, (adults, kids), budget in itertools.product((0, 4, 8, 12), (3, 6), parties, (60_000, 200_000)):
            start = FIRST + timedelta(days=offset)
            if start + timedelta(days=nights) <= LAST:
                yield TripRequest(origin, country, start, nights, adults, kids, budget)


@lru_cache(maxsize=None)
def solve(request):
    """The grid is shared by two tests, so each request is solved once."""
    return build_package(request, catalog)


def variant_of(request, entry):
    return replace(request, start_date=date.fromisoformat(entry["start_date"]), nights=entry["nights"])


def test_no_package_explanations_are_honest():
    seen = 0
    for request in explanation_grid():
        result = solve(request)
        if result["status"] != "NO_PACKAGE":
            continue
        seen += 1
        codes = [r["code"] for r in result["reasons"]]
        assert codes and len(codes) == len(set(codes)), request
        assert all(r["message"] for r in result["reasons"])
        assert len(result["nearby"]) <= 5
        for option in result["nearby"]:
            variant = variant_of(request, option)
            assert FIRST <= variant.start_date and variant.end_date <= LAST
            assert catalog.rules.min_nights <= variant.nights <= catalog.rules.max_nights
            solved = build_package(variant, catalog, explain=False)
            assert solved["status"] in ("OK", "OVER_BUDGET"), (request, option)
            assert option["within_budget"] == (solved["status"] == "OK")
            assert option["end_date"] == variant.end_date.isoformat()
    assert seen > 20


def test_over_budget_suggestions_are_honest():
    seen = 0
    for request in explanation_grid():
        result = solve(request)
        if result["status"] != "OVER_BUDGET":
            continue
        seen += 1
        details = result["suggestion_details"]
        assert result["suggestions"] == [d["message"] for d in details]
        assert details[-1] == {"kind": "raise_budget", "amount_inr": result["short_by"], "message": details[-1]["message"]}
        assert result["short_by"] == result["cheapest_total"] - request.budget > 0
        for d in details[:-1]:
            solved = build_package(variant_of(request, d), catalog, explain=False)
            assert solved["status"] == "OK" and solved["package"]["total_inr"] == d["total_inr"] <= request.budget, (request, d)
    assert seen > 20


# ------------------------------------------------------------------ broken input never causes a 500

junk = st.recursive(
    st.one_of(st.none(), st.booleans(), st.integers(-10**12, 10**12), st.floats(allow_nan=True, allow_infinity=True),
              st.text(max_size=12), st.dates().map(str)),
    lambda inner: st.one_of(st.lists(inner, max_size=3), st.dictionaries(st.text(max_size=5), inner, max_size=2)),
    max_leaves=4,
)
FIELDS = ("origin", "country", "start_date", "nights", "adults", "children_ages", "budget", "children")
GOOD = {"origin": "BLR", "country": "JP", "start_date": "2027-04-10", "nights": 6, "adults": 2,
        "children_ages": [6], "budget": 350000}
payloads = st.dictionaries(st.sampled_from(FIELDS), junk, max_size=len(FIELDS)).map(lambda d: {**GOOD, **d}) | \
    st.dictionaries(st.sampled_from(FIELDS), junk, max_size=len(FIELDS))


@settings(max_examples=400, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(payload=payloads)
def test_parse_request_only_ever_raises_request_invalid(payload):
    try:
        request = parse_request(payload, catalog)
    except RequestInvalid as error:
        assert error.errors and all(isinstance(m, str) and m for m in error.errors.values())
    else:
        assert request.nights == int(request.nights) and math.isfinite(request.budget) and request.budget > 0
        assert request.travelers >= 1


@pytest.fixture(scope="module")
def client():
    with tempfile.TemporaryDirectory() as folder:
        app = create_app(replace(load_settings(), db_path=Path(folder) / "fuzz.db"))
        yield TestClient(app, raise_server_exceptions=False)


@settings(max_examples=120, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
@given(payload=payloads)
def test_packages_endpoint_never_returns_a_server_error(client, payload):
    # raw text, so NaN and Infinity reach the server the way a hostile client could send them
    response = client.post("/api/packages", content=json.dumps(payload), headers={"Content-Type": "application/json"})
    assert response.status_code in (200, 422), (payload, response.status_code, response.text[:200])
    if response.status_code == 200:
        assert response.json()["status"] in ("OK", "OVER_BUDGET", "NO_PACKAGE")
    else:
        assert response.json()["detail"]
