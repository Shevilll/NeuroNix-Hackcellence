"""MVP builder: a validated package for Menon, over-budget and no-package answers."""

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


def menon(**over):
    base = dict(origin="BLR", country="Japan", start_date=date(2027, 4, 10), nights=6,
                adults=2, children_ages=(6,), budget=350000)
    base.update(over)
    return TripRequest(**base)


def test_menon_builds_a_valid_package_within_budget(catalog):
    result = build_package(menon(), catalog)
    assert result["status"] == "OK"
    package = result["package"]
    assert validate_package(package, catalog) == []
    assert package["total_inr"] <= 350000
    assert package["total_inr"] == sum(i["price_inr"] for i in package["items"])
    kinds = {i["type"] for i in package["items"]}
    assert kinds == {"flight", "hotel", "transfer", "attraction"}


def test_build_is_deterministic(catalog):
    assert build_package(menon(), catalog) == build_package(menon(), catalog)


def test_tiny_budget_reports_over_budget_with_cheapest_total(catalog):
    result = build_package(menon(budget=50000), catalog)
    assert result["status"] == "OVER_BUDGET"
    assert result["cheapest_total"] > 50000
    assert result["short_by"] == result["cheapest_total"] - 50000


def test_no_flights_on_that_date_reports_reason(catalog):
    result = build_package(menon(start_date=date(2027, 4, 19), nights=3), catalog)
    assert result["status"] == "NO_PACKAGE"
    assert result["reasons"]


@pytest.mark.parametrize("origin", ["BLR", "DEL", "BOM", "MAA"])
@pytest.mark.parametrize("country", ["Japan", "United Arab Emirates"])
@pytest.mark.parametrize("start", [date(2027, 4, 1), date(2027, 4, 8), date(2027, 4, 14)])
def test_any_result_is_valid_or_explained(catalog, origin, country, start):
    nights = min(5, (date(2027, 4, 20) - start).days)
    result = build_package(menon(origin=origin, country=country, start_date=start,
                                 nights=nights, adults=2, children_ages=(), budget=10**7), catalog)
    if result["status"] == "OK":
        assert validate_package(result["package"], catalog) == []
    else:
        assert result["status"] == "NO_PACKAGE" and result["reasons"]
