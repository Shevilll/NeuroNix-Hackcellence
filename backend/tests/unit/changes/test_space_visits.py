"""Fixing a day saved before visits had travel time between them: re-time it with the travel time
(from latitude and longitude), keeping the order when it fits, else the order that fits."""

import copy
from datetime import date

import pytest

from app.catalog.loader import load_catalog
from app.changes.operations import ChangeRefused, apply_change, change_report
from app.config import load_settings
from app.domain import pricing
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

ARRIVAL = "2027-04-10"  # the airport bus reaches the hotel at 13:10, so visits start from 13:40


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


@pytest.fixture(scope="module")
def menon(catalog):
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    return build_package(request, catalog)["package"]


def back_to_back(package, catalog, *attraction_ids, day=ARRIVAL, start=13 * 60 + 40):
    """The package with these visits on `day`, one straight after the other, the way days were saved
    before travel time was left between visits."""
    pkg = copy.deepcopy(package)
    template = next(i for i in pkg["items"] if i["type"] == "attraction")
    t = start
    for attraction_id in attraction_ids:
        a = catalog.attractions[attraction_id]
        t = max(t, a.open_from)
        clock = lambda m: f"{day}T{m // 60:02d}:{m % 60:02d}"
        pkg["items"].append(dict(template, catalog_id=attraction_id, name=a.name, start=clock(t),
                                 end=clock(t + a.visit_minutes), price_inr=pricing.attraction_cost(a, 2, 1)))
        t += a.visit_minutes
    pkg["items"].sort(key=lambda i: (i["start"], i["type"]))
    for n, item in enumerate(pkg["items"], 1):
        item["item_id"] = f"i{n}"
    pkg["total_inr"] = sum(i["price_inr"] for i in pkg["items"])
    assert validate_package(pkg, catalog, require_daily_attractions=False) == []
    return pkg


def visits(package, day=ARRIVAL):
    return sorted((i["start"][11:], i["end"][11:], i["catalog_id"])
                  for i in package["items"] if i["type"] == "attraction" and i["start"][:10] == day)


def space(package, catalog, day=ARRIVAL):
    return apply_change(package, catalog, {"op": "space_visits", "date": day})


def test_a_day_keeps_its_order_and_gets_the_travel_time_when_that_fits(catalog, menon):
    old = back_to_back(menon, catalog, "ATT-TYO-003", "ATT-TYO-007")  # Toy Museum 13:40-15:10, Skytree 15:10-16:40
    fixed = space(old, catalog)
    assert [v[2] for v in visits(fixed)] == ["ATT-TYO-003", "ATT-TYO-007"]
    assert visits(fixed)[0] == ("13:40", "15:10", "ATT-TYO-003")
    assert visits(fixed)[1][0] > "15:10"
    assert validate_package(fixed, catalog, require_daily_attractions=False) == []


def test_a_day_whose_order_cannot_take_the_travel_time_is_put_in_an_order_that_can(catalog, menon):
    # Tokyo Tower 13:40-14:40 then the National Museum (closes 17:00) 14:40-16:40: the 35 min between
    # them would end the Museum at 17:15, so the Museum goes first.
    old = back_to_back(menon, catalog, "ATT-TYO-012", "ATT-TYO-005")
    fixed = space(old, catalog)
    assert visits(fixed) == [("13:40", "15:40", "ATT-TYO-005"), ("16:15", "17:15", "ATT-TYO-012")]
    assert fixed["total_inr"] == old["total_inr"]


def test_a_day_too_full_for_the_travel_time_drops_the_fewest_visits_and_keeps_the_earlier_ones(catalog, menon):
    old = back_to_back(menon, catalog, "ATT-TYO-005", "ATT-TYO-010")  # both close at 17:00
    fixed = space(old, catalog)
    assert visits(fixed) == [("13:40", "15:40", "ATT-TYO-005")]
    meiji = next(i for i in old["items"] if i["catalog_id"] == "ATT-TYO-010")
    assert fixed["total_inr"] == old["total_inr"] - meiji["price_inr"]
    assert validate_package(fixed, catalog, require_daily_attractions=False) == []


def test_the_traveller_is_told_which_visit_was_taken_off_to_make_room(catalog, menon):
    old = back_to_back(menon, catalog, "ATT-TYO-005", "ATT-TYO-010")
    report = change_report(old, space(old, catalog), {"op": "space_visits", "date": ARRIVAL})
    dropped = [w for w in report["warnings"] if w["code"] == "VISIT_DROPPED"]
    assert [w["message"] for w in dropped] == [
        "Meiji Jingu was taken off 10 Apr: it did not fit with time to travel between visits."]


def test_removing_a_visit_yourself_does_not_warn_that_it_was_taken_off(catalog, menon):
    old = back_to_back(menon, catalog, "ATT-TYO-003", "ATT-TYO-007")
    toy = next(i["item_id"] for i in old["items"] if i["catalog_id"] == "ATT-TYO-003")
    change = {"op": "remove_attraction", "item_id": toy}
    after = apply_change(old, catalog, change)
    assert not [w for w in change_report(old, after, change)["warnings"] if w["code"] == "VISIT_DROPPED"]


def test_a_day_that_already_has_the_travel_time_is_left_alone(catalog, menon):
    fixed = space(back_to_back(menon, catalog, "ATT-TYO-003", "ATT-TYO-007"), catalog)
    assert visits(space(fixed, catalog)) == visits(fixed)


def test_other_days_are_left_alone(catalog, menon):
    old = back_to_back(menon, catalog, "ATT-TYO-012", "ATT-TYO-005")
    others = lambda p: sorted((i["catalog_id"], i["start"]) for i in p["items"] if i["start"][:10] != ARRIVAL)
    assert others(space(old, catalog)) == others(old)


def test_dragging_on_a_day_too_full_for_the_travel_time_asks_to_fix_the_timings_first(catalog, menon):
    old = back_to_back(menon, catalog, "ATT-TYO-005", "ATT-TYO-010")
    ids = {i["catalog_id"]: i["item_id"] for i in old["items"] if i["type"] == "attraction"}
    change = {"op": "reorder_attractions", "date": ARRIVAL, "moved_id": ids["ATT-TYO-010"],
              "item_ids": [ids["ATT-TYO-010"], ids["ATT-TYO-005"]]}
    with pytest.raises(ChangeRefused) as info:
        apply_change(old, catalog, change)
    assert info.value.reason == ("The visits on 10 Apr do not all fit with time to travel between them. "
                                 "Use Fix the timings, then drag again.")
