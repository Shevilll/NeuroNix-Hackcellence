"""Reordering the visits of one day: the traveller drags them into a new order, and the day is
re-timed with the travel time between each pair of places (from their latitude and longitude)."""

from datetime import date, datetime

import pytest

from app.catalog.loader import load_catalog
from app.changes.operations import ChangeRefused, apply_change
from app.config import load_settings
from app.domain.geo import distance_km, travel_minutes
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

DAY = "2027-04-11"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


@pytest.fixture(scope="module")
def menon(catalog):
    """Tokyo, Kyoto, Osaka; 11 Apr is a full Tokyo day with Senso-ji (ATT-TYO-004) 09:00-10:00."""
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    return build_package(request, catalog)["package"]


def add(package, catalog, attraction_id):
    return apply_change(package, catalog, {"op": "add_attraction", "attraction_id": attraction_id, "date": DAY})


@pytest.fixture(scope="module")
def three(catalog, menon):
    """Senso-ji, Ueno Park, Ameyoko Market on 11 Apr."""
    return add(add(menon, catalog, "ATT-TYO-008"), catalog, "ATT-TYO-009")


def visits(package):
    return sorted((i["start"][11:16], i["end"][11:16], i["catalog_id"])
                  for i in package["items"] if i["type"] == "attraction" and i["start"][:10] == DAY)


def ids_in(package, *catalog_ids):
    by_catalog = {i["catalog_id"]: i["item_id"] for i in package["items"] if i["type"] == "attraction"}
    return [by_catalog[c] for c in catalog_ids]


def reorder(package, catalog, *catalog_ids, moved=None):
    change = {"op": "reorder_attractions", "date": DAY, "item_ids": ids_in(package, *catalog_ids)}
    if moved:
        change["moved_id"] = ids_in(package, moved)[0]
    return apply_change(package, catalog, change)


def refusal(package, catalog, change) -> ChangeRefused:
    with pytest.raises(ChangeRefused) as info:
        apply_change(package, catalog, change)
    return info.value


def test_reordering_puts_the_visits_in_the_new_order_with_travel_time_between_them(catalog, three):
    updated = reorder(three, catalog, "ATT-TYO-009", "ATT-TYO-008", "ATT-TYO-004")
    # Ameyoko opens at 10:00; Ameyoko to Ueno Park is 0.5 km (15 min); Ueno Park to Senso-ji is 2.1 km (20 min).
    assert visits(updated) == [("10:00", "11:00", "ATT-TYO-009"), ("11:15", "12:45", "ATT-TYO-008"),
                               ("13:05", "14:05", "ATT-TYO-004")]
    assert validate_package(updated, catalog, require_daily_attractions=False) == []


def test_every_visit_starts_at_least_the_travel_time_after_the_one_before(catalog, three):
    updated = reorder(three, catalog, "ATT-TYO-004", "ATT-TYO-009", "ATT-TYO-008")
    day = sorted((i for i in updated["items"] if i["type"] == "attraction" and i["start"][:10] == DAY),
                 key=lambda i: i["start"])
    for before, after in zip(day, day[1:]):
        a, b = catalog.attractions[before["catalog_id"]], catalog.attractions[after["catalog_id"]]
        gap = (datetime.fromisoformat(after["start"]) - datetime.fromisoformat(before["end"])).seconds // 60
        assert gap >= travel_minutes(distance_km(a.lat, a.lng, b.lat, b.lng))


def test_reordering_keeps_the_prices_and_the_total(catalog, three):
    updated = reorder(three, catalog, "ATT-TYO-008", "ATT-TYO-004", "ATT-TYO-009")
    assert updated["total_inr"] == three["total_inr"]


def test_reordering_twice_into_the_same_order_gives_the_same_day(catalog, three):
    once = reorder(three, catalog, "ATT-TYO-009", "ATT-TYO-008", "ATT-TYO-004")
    twice = reorder(once, catalog, "ATT-TYO-009", "ATT-TYO-008", "ATT-TYO-004")
    assert visits(twice) == visits(once)


def test_reordering_leaves_other_days_alone(catalog, three):
    updated = reorder(three, catalog, "ATT-TYO-009", "ATT-TYO-008", "ATT-TYO-004")
    others = lambda p: sorted((i["catalog_id"], i["start"]) for i in p["items"] if i["start"][:10] != DAY)
    assert others(updated) == others(three)


def test_an_order_that_misses_a_visit_of_that_day_is_refused(catalog, three):
    change = {"op": "reorder_attractions", "date": DAY, "item_ids": ids_in(three, "ATT-TYO-009", "ATT-TYO-008")}
    assert "every visit" in refusal(three, catalog, change).reason


def test_an_order_that_repeats_a_visit_is_refused(catalog, three):
    change = {"op": "reorder_attractions", "date": DAY,
              "item_ids": ids_in(three, "ATT-TYO-009", "ATT-TYO-009", "ATT-TYO-004")}
    assert "every visit" in refusal(three, catalog, change).reason


def test_an_order_with_a_visit_from_another_day_is_refused(catalog, three):
    other = next(i["item_id"] for i in three["items"] if i["type"] == "attraction" and i["start"][:10] != DAY)
    change = {"op": "reorder_attractions", "date": DAY,
              "item_ids": [*ids_in(three, "ATT-TYO-009", "ATT-TYO-008", "ATT-TYO-004"), other]}
    refusal(three, catalog, change)


def test_an_order_that_breaks_opening_hours_is_refused_with_the_reason(catalog, menon):
    day = add(menon, catalog, "ATT-TYO-002")  # Tokyo Disneyland, 8 hours
    # Disneyland 09:00-17:00 first would bring Senso-ji (closes 17:00) too late.
    reason = refusal(day, catalog, {"op": "reorder_attractions", "date": DAY,
                                    "item_ids": ids_in(day, "ATT-TYO-002", "ATT-TYO-004")}).reason
    assert reason == "Senso-ji does not fit in that order: it would end after it closes."
    assert visits(reorder(day, catalog, "ATT-TYO-004", "ATT-TYO-002"))[0] == ("09:00", "10:00", "ATT-TYO-004")


def test_a_missing_date_is_refused(catalog, three):
    refusal(three, catalog, {"op": "reorder_attractions", "item_ids": []})


@pytest.fixture(scope="module")
def long_day(catalog, menon):
    """Senso-ji 09:00-10:00 (closes 17:00), Ueno Park 10:20-11:50, Tokyo Disneyland 12:45-20:45 (closes 21:00)."""
    return add(add(menon, catalog, "ATT-TYO-008"), catalog, "ATT-TYO-002")


def test_a_dragged_visit_keeps_its_new_place_and_the_others_shift_to_fit(catalog, long_day):
    # Ueno Park dragged to the top gives Ueno, Disneyland, Senso-ji: Senso-ji would end after 17:00.
    # Ueno stays first; Senso-ji goes before Disneyland so every visit fits with the travel time.
    updated = reorder(long_day, catalog, "ATT-TYO-008", "ATT-TYO-002", "ATT-TYO-004", moved="ATT-TYO-008")
    assert visits(updated) == [("09:00", "10:30", "ATT-TYO-008"), ("10:50", "11:50", "ATT-TYO-004"),
                               ("12:40", "20:40", "ATT-TYO-002")]
    assert updated["total_inr"] == long_day["total_inr"]
    assert validate_package(updated, catalog, require_daily_attractions=False) == []


def test_a_dragged_visit_that_cannot_stay_in_its_new_place_is_refused_with_the_reason(catalog, long_day):
    # Disneyland first takes 09:00-17:00, so Senso-ji (closes 17:00) can never come after it.
    reason = refusal(long_day, catalog, {"op": "reorder_attractions", "date": DAY, "moved_id": ids_in(long_day, "ATT-TYO-002")[0],
                                         "item_ids": ids_in(long_day, "ATT-TYO-002", "ATT-TYO-004", "ATT-TYO-008")}).reason
    assert reason == "Senso-ji does not fit in that order: it would end after it closes."
