"""M6/G1 gaps: removing the only attraction of a day, budget and empty-day warnings with the price
difference, honest refusal reasons for flights, and a default room when none is named."""

import copy
from datetime import date

import pytest

from app.catalog.loader import load_catalog
from app.changes.operations import ChangeRefused, apply_change, change_report, list_options
from app.config import load_settings
from app.domain.request import TripRequest
from app.planner.builder import build_package, hotel_options
from app.rules.validate import validate_package


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


@pytest.fixture(scope="module")
def menon(catalog):
    """Tokyo, Kyoto, Osaka; one attraction per full day (11 Apr ATT-TYO-004 is item i4)."""
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    return build_package(request, catalog)["package"]


def attraction_item(package, attraction_id):
    return next(i for i in package["items"] if i["catalog_id"] == attraction_id)


def refusal(package, catalog, change) -> ChangeRefused:
    with pytest.raises(ChangeRefused) as info:
        apply_change(package, catalog, change)
    return info.value


# ------------------------------------------------ 1. removing an attraction


def test_the_only_attraction_of_a_day_can_be_removed(catalog, menon):
    target = attraction_item(menon, "ATT-TYO-004")
    updated = apply_change(menon, catalog, {"op": "remove_attraction", "item_id": target["item_id"]})
    assert all(i["catalog_id"] != "ATT-TYO-004" for i in updated["items"])
    assert updated["total_inr"] == sum(i["price_inr"] for i in updated["items"])
    assert validate_package(updated, catalog, require_daily_attractions=False) == []


def test_a_freshly_built_package_still_needs_an_attraction_every_day(catalog, menon):
    updated = apply_change(menon, catalog, {"op": "remove_attraction", "item_id": attraction_item(menon, "ATT-TYO-004")["item_id"]})
    codes = {v["code"] for v in validate_package(updated, catalog)}  # default: the strict first-package rule
    assert codes == {"ATTRACTION_COUNT"}


def add(package, catalog, attraction_id, day="2027-04-11"):
    return apply_change(package, catalog, {"op": "add_attraction", "attraction_id": attraction_id, "date": day})


def visits_on(package, day="2027-04-11"):
    return sorted((i["start"][11:16], i["end"][11:16], i["catalog_id"])
                  for i in package["items"] if i["type"] == "attraction" and i["start"][:10] == day)


def test_the_traveller_can_add_a_third_and_fourth_attraction_to_a_day(catalog, menon):
    # The problem statement limits only the first package to 1-2 a day; the traveller may add more.
    updated = add(add(add(menon, catalog, "ATT-TYO-011"), catalog, "ATT-TYO-015"), catalog, "ATT-TYO-012")
    assert len(visits_on(updated)) == 4
    assert validate_package(updated, catalog, require_daily_attractions=False) == []


def test_the_first_package_rule_still_flags_more_than_two_on_a_full_day(catalog, menon):
    updated = add(add(menon, catalog, "ATT-TYO-011"), catalog, "ATT-TYO-015")
    assert {v["code"] for v in validate_package(updated, catalog)} == {"ATTRACTION_COUNT"}


@pytest.fixture(scope="module")
def evening(catalog, menon):
    """11 Apr filled to 20:25, with travel time between visits: Senso-ji 09:00-10:00, Odaiba
    Seaside Park 10:45-11:45, Tokyo Disneyland 12:25-20:25."""
    day = menon
    for attraction_id in ("ATT-TYO-015", "ATT-TYO-002"):
        day = add(day, catalog, attraction_id)
    assert visits_on(day)[-1] == ("12:25", "20:25", "ATT-TYO-002")
    return day


def test_an_added_visit_must_end_by_22_00_even_when_the_attraction_is_open_later(catalog, evening):
    # ATT-TYO-012 is open until 23:00, but after 50 min of travel a 60-minute visit would end at 22:15.
    reason = refusal(evening, catalog, {"op": "add_attraction", "attraction_id": "ATT-TYO-012", "date": "2027-04-11"})
    assert "22:00" in reason.reason


def test_an_added_visit_may_end_exactly_at_22_00(catalog, evening):
    updated = add(evening, catalog, "ATT-TYO-011")  # 30 minutes, open all day, 65 min from Disneyland
    assert visits_on(updated)[-1] == ("21:30", "22:00", "ATT-TYO-011")
    assert validate_package(updated, catalog, require_daily_attractions=False) == []


def test_an_added_visit_must_still_fit_the_attractions_own_hours(catalog, evening):
    # ATT-TYO-009 closes at 20:00, so it cannot start at 21:20 although 22:00 has not come.
    refusal(evening, catalog, {"op": "add_attraction", "attraction_id": "ATT-TYO-009", "date": "2027-04-11"})


def test_options_offer_more_attractions_on_a_day_that_already_has_two(catalog, menon):
    two = add(menon, catalog, "ATT-TYO-011")
    offered = {o["attraction_id"] for o in list_options(two, catalog, "attractions") if o["date"] == "2027-04-11"}
    assert "ATT-TYO-015" in offered


def test_options_never_offer_a_visit_that_would_end_after_22_00(catalog, evening):
    offered = {o["attraction_id"] for o in list_options(evening, catalog, "attractions") if o["date"] == "2027-04-11"}
    assert "ATT-TYO-011" in offered
    assert "ATT-TYO-012" not in offered


# ------------------------------------------------ 2. report: price difference and warnings


def test_report_has_the_price_difference(catalog, menon):
    target = attraction_item(menon, "ATT-TYO-004")
    updated = apply_change(menon, catalog, {"op": "remove_attraction", "item_id": target["item_id"]})
    report = change_report(menon, updated)
    assert report["price_diff_inr"] == updated["total_inr"] - menon["total_inr"]


def test_report_warns_about_a_day_left_without_attractions(catalog, menon):
    target = attraction_item(menon, "ATT-TYO-004")
    updated = apply_change(menon, catalog, {"op": "remove_attraction", "item_id": target["item_id"]})
    warnings = change_report(menon, updated)["warnings"]
    empty = [w for w in warnings if w["code"] == "EMPTY_DAY"]
    assert len(empty) == 1
    assert "11 Apr" in empty[0]["message"]


def test_report_has_no_warnings_for_a_clean_change(catalog, menon):
    updated = apply_change(menon, catalog, {"op": "add_attraction", "attraction_id": "ATT-TYO-011", "date": "2027-04-11"})
    assert change_report(menon, updated)["warnings"] == []


def test_report_warns_when_the_change_pushes_the_total_over_budget(catalog, menon):
    tight = copy.deepcopy(menon)
    tight["budget_inr"] = tight["total_inr"]
    updated = apply_change(tight, catalog, {"op": "add_attraction", "attraction_id": "ATT-TYO-001", "date": "2027-04-11"})
    over = [w for w in change_report(tight, updated)["warnings"] if w["code"] == "OVER_BUDGET"]
    assert len(over) == 1
    assert f"{updated['total_inr'] - tight['budget_inr']:,}" in over[0]["message"]


def test_report_does_not_repeat_the_budget_warning_for_a_package_already_over(catalog, menon):
    over = copy.deepcopy(menon)
    over["budget_inr"] = over["total_inr"] - 1
    updated = apply_change(over, catalog, {"op": "add_attraction", "attraction_id": "ATT-TYO-011", "date": "2027-04-11"})
    assert [w for w in change_report(over, updated)["warnings"] if w["code"] == "OVER_BUDGET"] == []


# ------------------------------------------------ 3. honest flight refusals


def test_flight_into_an_airport_that_does_not_serve_the_city_says_so(catalog, menon):
    reason = refusal(menon, catalog, {"op": "replace_flight", "role": "arrival_flight", "flight_id": "FL-740"}).reason
    assert "KIX" in reason and "Tokyo" in reason and "serve" in reason


def test_flight_on_the_wrong_day_says_so(catalog, menon):
    other = next(f for f in catalog.flights.values() if f.origin == "BLR" and f.arrival_local.date() != date(2027, 4, 10))
    reason = refusal(menon, catalog, {"op": "replace_flight", "role": "arrival_flight", "flight_id": other.flight_id}).reason
    assert "10 Apr" in reason


def test_flight_from_the_wrong_origin_says_so(catalog, menon):
    other = next(f for f in catalog.flights.values()
                 if f.origin not in ("BLR",) and f.arrival_local.date() == date(2027, 4, 10) and f.origin in {d.airport for d in catalog.departure_cities})
    reason = refusal(menon, catalog, {"op": "replace_flight", "role": "arrival_flight", "flight_id": other.flight_id}).reason
    assert "BLR" in reason


def test_flight_without_seats_for_every_traveler_says_so(catalog, menon):
    reason = refusal(menon, catalog, {"op": "replace_flight", "role": "arrival_flight", "flight_id": "FL-403"}).reason
    assert "FL-403" in reason and "3" in reason


# ------------------------------------------------ 4. hotel without a named room


def test_replace_hotel_without_a_room_picks_the_cheapest_room_that_fits(catalog, menon):
    request = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    options = [o for o in hotel_options(catalog, request, "Kyoto", date(2027, 4, 12), 2) if o[1].hotel_id == "HTL-KYO-001"]
    assert options, "HTL-KYO-001 should have a room for this party"
    cheapest_room = options[0][2].room_id
    updated = apply_change(menon, catalog, {"op": "replace_hotel", "city": "Kyoto", "hotel_id": "HTL-KYO-001"})
    stay = next(i for i in updated["items"] if i["type"] == "hotel" and i["city"] == "Kyoto")
    assert stay["catalog_id"] == "HTL-KYO-001" and stay["room_id"] == cheapest_room


def test_replace_hotel_with_a_room_of_another_hotel_is_refused(catalog, menon):
    other_room = catalog.rooms_of("HTL-KYO-002")[0].room_id
    reason = refusal(menon, catalog, {"op": "replace_hotel", "city": "Kyoto", "hotel_id": "HTL-KYO-001", "room_id": other_room}).reason
    assert "room" in reason.lower()
