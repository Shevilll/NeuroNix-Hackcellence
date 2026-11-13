"""Exhaustive grid + random fuzz. Invariant: never an invalid package.

Every request the data allows ends in a package with zero rule violations, OVER_BUDGET with the
cheapest valid package, or NO_PACKAGE with a reason. This is the proxy for judge requests we have
not seen.
"""

import itertools
import random
from datetime import date, timedelta
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

from app.catalog.loader import load_catalog
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

DATA = Path(__file__).resolve().parents[3] / "data"
catalog = load_catalog(DATA)
ORIGINS = [c.airport for c in catalog.departure_cities]
COUNTRIES = [c.name for c in catalog.countries.values()]
FIRST, LAST = catalog.rules.first_night, catalog.rules.last_departure


def check(request: TripRequest):
    result = build_package(request, catalog)
    status = result["status"]
    if status == "OK":
        packages = [result["package"], *result["alternatives"].values()]
        for pkg in packages:
            assert validate_package(pkg, catalog) == [], (request, pkg["cities"])
            assert pkg["total_inr"] <= request.budget
    elif status == "OVER_BUDGET":
        assert validate_package(result["cheapest_package"], catalog) == [], request
        assert result["cheapest_total"] > request.budget
        assert result["short_by"] == result["cheapest_total"] - request.budget
    else:
        assert status == "NO_PACKAGE" and result["reasons"], request
    return status


def test_grid_origins_countries_dates_nights_parties():
    random.seed(7)
    statuses = set()
    parties = [(1, ()), (2, ()), (2, (6,)), (2, (3, 9)), (3, (0,)), (4, (5, 8, 12)), (6, (1,))]
    for origin, country in itertools.product(ORIGINS, COUNTRIES):
        for start_offset in range(0, (LAST - FIRST).days - 2, 3):
            start = FIRST + timedelta(days=start_offset)
            for nights in (3, 4, 7, 10):
                if start + timedelta(days=nights) > LAST:
                    continue
                adults, kids = random.choice(parties)
                statuses.add(check(TripRequest(origin, country, start, nights, adults, kids, 10**7)))
    assert "OK" in statuses


@pytest.mark.parametrize("budget", [1, 20_000, 80_000, 150_000, 250_000])
def test_budgets_never_yield_invalid_packages(budget):
    for origin, country in itertools.product(ORIGINS, COUNTRIES):
        check(TripRequest(origin, country, date(2027, 4, 6), 5, 2, (7,), budget))


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    origin=st.sampled_from(ORIGINS),
    country=st.sampled_from(COUNTRIES),
    start=st.dates(FIRST, LAST - timedelta(days=3)),
    nights=st.integers(3, 10),
    adults=st.integers(1, 5),
    kids=st.lists(st.integers(0, 17), max_size=4),
    budget=st.integers(10_000, 600_000),
)
def test_random_requests(origin, country, start, nights, adults, kids, budget):
    if start + timedelta(days=nights) > LAST or adults + len(kids) > 9:
        return
    check(TripRequest(origin, country, start, nights, adults, tuple(kids), budget))
