"""G4 "best rated": the highest average hotel stars per night that still fits the budget.

The old search took the 5-star hotel whatever it cost, so when every 5-star combination was over
budget it returned a worse package (4.0 stars) although a mix of 4-star hotels (4.75) fit.
The reference star levels come from an independent solver; each is achievable within the budget.
"""

from datetime import date
from pathlib import Path

import pytest

from app.catalog.loader import load_catalog
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

DATA = Path(__file__).resolve().parents[4] / "data"
UAE = "United Arab Emirates"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


# origin, country, start, nights, adults, children, budget, stars known to be achievable
CASES = [
    ("BLR", "Japan", date(2027, 4, 1), 8, 2, (6,), 400000, 4.75),  # old answer: 4.0
    ("BLR", "Japan", date(2027, 4, 1), 10, 2, (6,), 400000, 4.8),  # old answer: 4.0
    ("BLR", "Japan", date(2027, 4, 4), 8, 2, (6,), 400000, 4.75),  # old answer: 4.5
    ("BLR", "Japan", date(2027, 4, 12), 3, 3, (1, 9), 400000, 4.0),  # old answer: 3.0
    ("BLR", "Japan", date(2027, 4, 12), 5, 3, (1, 9), 400000, 4.0),  # old answer: 3.0
    ("BLR", UAE, date(2027, 4, 1), 5, 3, (1, 9), 400000, 4.6),  # old answer: 4.0
    ("BLR", UAE, date(2027, 4, 1), 10, 2, (6,), 400000, 4.7),  # old answer: 4.6
    ("MAA", UAE, date(2027, 4, 1), 8, 2, (6,), 400000, 4.75),  # old answer: 4.5
]


@pytest.mark.parametrize("origin,country,start,nights,adults,ages,budget,stars", CASES)
def test_best_rated_reaches_the_known_star_level(catalog, origin, country, start, nights, adults, ages, budget, stars):
    request = TripRequest(origin, country, start, nights, adults, ages, budget)
    result = build_package(request, catalog)
    assert result["status"] == "OK"
    best = result["alternatives"]["best_rated"]
    assert validate_package(best, catalog) == []
    assert best["total_inr"] <= budget
    assert best["avg_stars"] >= stars, f"best rated has {best['avg_stars']} stars but {stars} fits the budget"


def test_best_rated_is_never_below_any_other_offered_package(catalog):
    request = TripRequest("BLR", "Japan", date(2027, 4, 1), 8, 2, (6,), 400000)
    result = build_package(request, catalog)
    offered = [result["package"], *result["alternatives"].values()]
    assert result["alternatives"]["best_rated"]["avg_stars"] == max(p["avg_stars"] for p in offered)


def test_with_a_generous_budget_best_rated_is_five_star_throughout(catalog):
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 900000)
    best = build_package(request, catalog)["alternatives"]["best_rated"]
    assert best["avg_stars"] == 5.0


def test_among_equal_stars_best_rated_is_the_cheaper(catalog):
    # a dearer package with the same stars can never be the best rated
    request = TripRequest("BLR", "Japan", date(2027, 4, 1), 8, 2, (6,), 400000)
    result = build_package(request, catalog)
    same = [p for p in (result["package"], *result["alternatives"].values()) if p["avg_stars"] == result["alternatives"]["best_rated"]["avg_stars"]]
    assert result["alternatives"]["best_rated"]["total_inr"] == min(p["total_inr"] for p in same)
