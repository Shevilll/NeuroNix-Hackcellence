"""An added visit leaves the travel time (from latitude and longitude) after the visit before it
and before the visit after it."""

from datetime import date, datetime

import pytest

from app.catalog.loader import load_catalog
from app.changes.operations import apply_change, list_options
from app.config import load_settings
from app.domain.geo import travel_between
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

DAY = "2027-04-11"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


@pytest.fixture(scope="module")
def menon(catalog):
    """11 Apr is a full Tokyo day with Senso-ji (ATT-TYO-004) 09:00-10:00."""
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    return build_package(request, catalog)["package"]


def add(package, catalog, attraction_id, day=DAY):
    return apply_change(package, catalog, {"op": "add_attraction", "attraction_id": attraction_id, "date": day})


def day_visits(package, day=DAY):
    return sorted((i for i in package["items"] if i["type"] == "attraction" and i["start"][:10] == day),
                  key=lambda i: i["start"])


def gaps_ok(package, catalog, day=DAY):
    visits = day_visits(package, day)
    for before, after in zip(visits, visits[1:]):
        need = travel_between(catalog.attractions[before["catalog_id"]], catalog.attractions[after["catalog_id"]])
        gap = (datetime.fromisoformat(after["start"]) - datetime.fromisoformat(before["end"])).seconds // 60
        if gap < need:
            return False
    return True


def test_an_added_visit_starts_the_travel_time_after_the_visit_before(catalog, menon):
    updated = add(menon, catalog, "ATT-TYO-008")  # Ueno Park, 2.1 km from Senso-ji: 20 min
    assert [(i["start"][11:], i["end"][11:]) for i in day_visits(updated)] == [("09:00", "10:00"), ("10:20", "11:50")]


def test_several_added_visits_all_leave_the_travel_time_between_them(catalog, menon):
    day = menon
    for attraction_id in ("ATT-TYO-009", "ATT-TYO-007", "ATT-TYO-011", "ATT-TYO-012"):
        day = add(day, catalog, attraction_id)
    assert len(day_visits(day)) == 5
    assert gaps_ok(day, catalog)
    assert validate_package(day, catalog, require_daily_attractions=False) == []


def test_an_added_visit_goes_before_the_next_one_only_with_time_to_travel_there(catalog, menon):
    senso = next(i for i in day_visits(menon) if i["catalog_id"] == "ATT-TYO-004")
    empty = apply_change(menon, catalog, {"op": "remove_attraction", "item_id": senso["item_id"]})
    skytree = add(empty, catalog, "ATT-TYO-007")  # opens 10:00, so 10:00-11:30
    assert [(i["start"][11:], i["end"][11:]) for i in day_visits(skytree)] == [("10:00", "11:30")]
    # Shibuya Crossing 09:00-09:30 would end before 10:00, but the 13 km to Skytree take longer than 30 min.
    updated = add(skytree, catalog, "ATT-TYO-011")
    assert [i["catalog_id"] for i in day_visits(updated)] == ["ATT-TYO-007", "ATT-TYO-011"]
    assert gaps_ok(updated, catalog)


def test_options_only_offer_visits_that_fit_with_travel_time(catalog, menon):
    for option in list_options(menon, catalog, "attractions"):
        if option["date"] == DAY:
            assert gaps_ok(add(menon, catalog, option["attraction_id"]), catalog)
