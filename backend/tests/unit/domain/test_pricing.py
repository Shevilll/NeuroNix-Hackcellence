"""Price formulas (problem statement, Prices table). Covers PR-01..03, PR-06..08.

Key traps: child_price 0 (free) is not "missing"; vehicles round up; all prices are whole rupees.
"""

from types import SimpleNamespace

import pytest

from app.domain.pricing import (
    attraction_cost,
    flight_cost,
    hotel_cost,
    per_person_cost,
    transfer_cost,
    vehicles_needed,
)


def transfer(pricing, price, child_price=None, max_passengers=4):
    return SimpleNamespace(
        pricing=pricing, price=price, child_price=child_price, max_passengers=max_passengers
    )


def attraction(price, child_price=None):
    return SimpleNamespace(price_per_person=price, child_price=child_price)


def test_flight_counts_every_traveler_including_children():
    assert flight_cost(price_per_seat=40_000, travelers=3) == 120_000


def test_hotel_is_per_night_per_room():
    assert hotel_cost(price_per_night=9_000, rooms=2, nights=4) == 72_000


def test_per_person_uses_child_price():
    assert per_person_cost(adults=2, children=1, price=1_000, child_price=600) == 2_600


def test_per_person_falls_back_to_adult_price_when_child_price_missing():
    assert per_person_cost(adults=2, children=1, price=1_000, child_price=None) == 3_000


def test_per_person_child_price_zero_is_free_not_missing():
    assert per_person_cost(adults=2, children=1, price=1_000, child_price=0) == 2_000


def test_per_person_no_children():
    assert per_person_cost(adults=2, children=0, price=500, child_price=300) == 1_000


@pytest.mark.parametrize(
    ("travelers", "capacity", "vehicles"),
    [(1, 4, 1), (3, 4, 1), (4, 4, 1), (5, 4, 2), (8, 4, 2), (9, 4, 3), (5, 99, 1), (9, 8, 2)],
)
def test_vehicles_round_up(travelers, capacity, vehicles):
    assert vehicles_needed(travelers, capacity) == vehicles


def test_transfer_per_vehicle():
    t = transfer("PER_VEHICLE", price=13_440, max_passengers=4)
    assert transfer_cost(t, adults=2, children=1) == 13_440  # 3 travelers, 1 taxi
    assert transfer_cost(t, adults=4, children=1) == 26_880  # 5 travelers, 2 taxis


def test_transfer_per_vehicle_ignores_child_price():
    t = transfer("PER_VEHICLE", price=5_000, child_price=0, max_passengers=4)
    assert transfer_cost(t, adults=2, children=1) == 5_000


def test_transfer_per_person_with_child_price():
    t = transfer("PER_PERSON", price=1_200, child_price=600, max_passengers=99)
    assert transfer_cost(t, adults=2, children=1) == 3_000


def test_transfer_per_person_child_price_zero():
    t = transfer("PER_PERSON", price=1_200, child_price=0, max_passengers=99)
    assert transfer_cost(t, adults=2, children=1) == 2_400


def test_transfer_per_person_missing_child_price():
    t = transfer("PER_PERSON", price=1_200, max_passengers=99)
    assert transfer_cost(t, adults=2, children=1) == 3_600


def test_transfer_unknown_pricing_is_an_error():
    with pytest.raises(ValueError):
        transfer_cost(transfer("PER_PARCEL", price=1), adults=1, children=0)


def test_attraction_child_price_cases():
    assert attraction_cost(attraction(2_000, 1_000), adults=2, children=1) == 5_000
    assert attraction_cost(attraction(2_000, 0), adults=2, children=1) == 4_000
    assert attraction_cost(attraction(2_000, None), adults=2, children=1) == 6_000


def test_free_attraction_price_zero():
    assert attraction_cost(attraction(0, None), adults=2, children=3) == 0
