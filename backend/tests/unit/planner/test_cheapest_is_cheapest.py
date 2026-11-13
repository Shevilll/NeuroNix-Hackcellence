"""G4 "cheapest" must be the lowest total price, not just a cheap package.

Each case is a request where a rule-valid package at the stated price is known to exist, so the
cheapest package must cost no more. The reference prices come from an independent solver that was
restricted to the conservative reading of the airport rules (the pickup is on the day of the
flight), and every reference package passes this app's own checker, so they are valid either way.

The cases cover every way a total can differ: attractions only (a free place beats a paid
"child-friendly" one), the hotel and the airport transfer chosen together (a pricier hotel can sit
where the transfer is much cheaper), and both at once.
"""

from datetime import date
from pathlib import Path

import pytest

from app.catalog.loader import load_catalog
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

DATA = Path(__file__).resolve().parents[4] / "data"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


# origin, start, nights, adults, children_ages, known achievable total, what the old answer cost
CASES = [
    ("BLR", date(2027, 4, 1), 5, 2, (6,), 240240),  # was 240,912: attractions
    ("BLR", date(2027, 4, 4), 10, 2, (6,), 316862),  # was 317,086: hotel
    ("BLR", date(2027, 4, 8), 8, 2, (6,), 265776),  # was 265,832: flight, hotel, transfer, attractions
    ("BOM", date(2027, 4, 1), 5, 1, (), 93491),  # was 100,435: hotel and airport transfer together
    ("BOM", date(2027, 4, 1), 5, 2, (6,), 253280),  # was 261,232
    ("MAA", date(2027, 4, 12), 8, 1, (), 101443),  # was 108,387
    ("BOM", date(2027, 4, 4), 10, 2, (6,), 304686),  # was 306,646: hotel and attractions
    ("DEL", date(2027, 4, 1), 10, 2, (6,), 299120),  # was 299,680
    ("MAA", date(2027, 4, 8), 8, 2, (6,), 276524),  # was 277,196
]


@pytest.mark.parametrize("origin,start,nights,adults,ages,known", CASES)
def test_cheapest_package_is_not_dearer_than_a_known_package(catalog, origin, start, nights, adults, ages, known):
    request = TripRequest(origin, "Japan", start, nights, adults, ages, 900000)
    result = build_package(request, catalog)
    assert result["status"] == "OK"
    cheapest = result["alternatives"]["cheapest"]
    assert validate_package(cheapest, catalog) == []
    assert cheapest["total_inr"] <= known, f"cheapest is {cheapest['total_inr']}, but {known} is achievable"


def test_a_budget_equal_to_a_known_package_is_not_reported_as_over_budget(catalog):
    # 93,491 is achievable; the old search only found 100,435 and wrongly said "over budget"
    request = TripRequest("BOM", "Japan", date(2027, 4, 1), 5, 1, (), 93491)
    result = build_package(request, catalog)
    assert result["status"] == "OK"
    assert result["package"]["total_inr"] <= 93491
    assert result["alternatives"]["cheapest"]["total_inr"] <= 93491


def test_over_budget_reports_the_true_cheapest_total(catalog):
    request = TripRequest("BOM", "Japan", date(2027, 4, 1), 5, 1, (), 50000)
    result = build_package(request, catalog)
    assert result["status"] == "OVER_BUDGET"
    assert result["cheapest_total"] <= 93491  # not 100,435
    assert result["short_by"] == result["cheapest_total"] - 50000
    assert validate_package(result["cheapest_package"], catalog) == []


def test_the_recommended_package_keeps_child_friendly_attractions(catalog):
    # the cheapest alternative picks purely on price; the recommended one still prefers places
    # that suit children when they cost the same or the plan still fits the budget
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    result = build_package(request, catalog)
    assert result["status"] == "OK"
    visits = [i for i in result["package"]["items"] if i["type"] == "attraction"]
    assert visits and all(catalog.attractions[i["catalog_id"]].child_friendly for i in visits)
