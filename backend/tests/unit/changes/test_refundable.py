"""Free cancellation (`rooms.refundable`, display only): every hotel item and hotel option carries it."""

from datetime import date
from pathlib import Path

import pytest

from app.catalog.loader import load_catalog
from app.changes.operations import apply_change, list_options
from app.domain.request import TripRequest
from app.planner.builder import build_package

DATA = Path(__file__).resolve().parents[4] / "data"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


@pytest.fixture(scope="module")
def menon(catalog):
    req = TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000)
    return build_package(req, catalog)["package"]


def _hotels(pkg):
    return [i for i in pkg["items"] if i["type"] == "hotel"]


def test_built_hotel_items_carry_refundable_from_their_room(catalog, menon):
    for item in _hotels(menon):
        assert item["refundable"] is catalog.rooms[item["room_id"]].refundable


def test_hotel_options_carry_refundable(catalog, menon):
    options = list_options(menon, catalog, "hotels", city=menon["cities"][0])
    assert options
    for opt in options:
        assert opt["refundable"] is catalog.rooms[opt["room_id"]].refundable


def test_replacing_the_hotel_updates_refundable(catalog, menon):
    city = menon["cities"][0]
    current = next(i for i in _hotels(menon) if i["city"] == city)
    options = list_options(menon, catalog, "hotels", city=city)
    other = next((o for o in options if o["refundable"] is not current["refundable"]), None)
    assert other is not None, "the catalog should offer both kinds of room in this city"
    new = apply_change(menon, catalog, {"op": "replace_hotel", "city": city,
                                        "hotel_id": other["hotel_id"], "room_id": other["room_id"]})
    item = next(i for i in _hotels(new) if i["city"] == city)
    assert item["refundable"] is other["refundable"]
