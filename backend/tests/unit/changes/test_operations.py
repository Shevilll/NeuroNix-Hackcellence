"""M6/G1/G2/G3: change a hotel, flight, attraction or the city plan; always re-validated."""

from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest

from app.catalog.loader import load_catalog
from app.changes.operations import ChangeRefused, apply_change, list_city_plans, list_options
from app.domain.request import TripRequest
from app.planner.builder import build_package
from app.rules.validate import validate_package

DATA = Path(__file__).resolve().parents[4] / "data"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


@pytest.fixture(scope="module")
def menon(catalog):
    req = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    return build_package(req, catalog)["package"]


def test_every_hotel_option_applies_to_a_valid_package(catalog, menon):
    city = menon["cities"][1]
    options = list_options(menon, catalog, "hotels", city=city)
    assert options
    for opt in options[:5]:
        new = apply_change(menon, catalog, {"op": "replace_hotel", "city": city,
                                            "hotel_id": opt["hotel_id"], "room_id": opt["room_id"]})
        assert validate_package(new, catalog) == []
        assert new["total_inr"] - menon["total_inr"] == opt["price_diff"]


def test_replace_flight_keeps_package_valid(catalog, menon):
    options = list_options(menon, catalog, "flights", role="arrival_flight")
    assert options
    for opt in options:
        try:
            new = apply_change(menon, catalog, {"op": "replace_flight", "role": "arrival_flight",
                                                "flight_id": opt["flight_id"]})
        except ChangeRefused:
            continue
        assert validate_package(new, catalog) == []


def test_add_and_remove_attraction(catalog, menon):
    opt = list_options(menon, catalog, "attractions")[0]
    added = apply_change(menon, catalog, {"op": "add_attraction", "attraction_id": opt["attraction_id"],
                                          "date": opt["date"]})
    assert validate_package(added, catalog) == []
    assert added["total_inr"] - menon["total_inr"] == opt["price_diff"]
    new_item = next(i for i in added["items"] if i["catalog_id"] == opt["attraction_id"])
    removed = apply_change(added, catalog, {"op": "remove_attraction", "item_id": new_item["item_id"]})
    assert removed["total_inr"] == menon["total_inr"]


def test_unknown_hotel_is_refused(catalog, menon):
    with pytest.raises(ChangeRefused):
        apply_change(menon, catalog, {"op": "replace_hotel", "city": menon["cities"][0],
                                      "hotel_id": "HTL-NOPE", "room_id": "RM-NOPE"})


def test_input_package_is_not_mutated(catalog, menon):
    before = deepcopy(menon)
    opt = list_options(menon, catalog, "hotels", city=menon["cities"][0])[0]
    apply_change(menon, catalog, {"op": "replace_hotel", "city": menon["cities"][0],
                                  "hotel_id": opt["hotel_id"], "room_id": opt["room_id"]})
    assert menon == before


def test_city_plans_listed_and_applied(catalog, menon):
    from app.changes.operations import list_city_plans

    plans = list_city_plans(menon, catalog)
    assert len(plans) >= 2
    assert all(p["total_inr"] > 0 and "within_budget" in p for p in plans)
    other = next(p for p in plans if p["cities"] != menon["cities"] or p["nights_per_city"] != menon["nights_per_city"])
    new = apply_change(menon, catalog, {"op": "change_cities", "cities": other["cities"],
                                        "nights_per_city": other["nights_per_city"]})
    assert validate_package(new, catalog) == []
    assert new["cities"] == other["cities"] and new["total_inr"] == other["total_inr"]


def test_invalid_city_plan_is_refused(catalog, menon):
    with pytest.raises(ChangeRefused):
        apply_change(menon, catalog, {"op": "change_cities", "cities": ["Tokyo", "Kyoto"], "nights_per_city": [1, 5]})
    with pytest.raises(ChangeRefused):
        apply_change(menon, catalog, {"op": "change_cities", "cities": ["Dubai"], "nights_per_city": [6]})
