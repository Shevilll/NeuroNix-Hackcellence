"""Rough travel time between two places from their latitude and longitude."""

import pytest

from app.domain.geo import distance_km, travel_minutes

UENO_PARK = (35.7146, 139.7732)
AMEYOKO = (35.7101, 139.7745)
SENSO_JI = (35.7148, 139.7967)
DISNEYLAND = (35.6329, 139.8804)


def test_distance_between_the_same_point_is_zero():
    assert distance_km(*UENO_PARK, *UENO_PARK) == 0


def test_distance_is_close_to_the_straight_line_on_the_map():
    assert distance_km(*SENSO_JI, *DISNEYLAND) == pytest.approx(11.8, abs=0.3)
    assert distance_km(*UENO_PARK, *AMEYOKO) == pytest.approx(0.5, abs=0.1)


def test_distance_is_the_same_both_ways():
    assert distance_km(*SENSO_JI, *DISNEYLAND) == distance_km(*DISNEYLAND, *SENSO_JI)


def test_travel_time_is_never_below_ten_minutes():
    assert travel_minutes(0) == 10
    assert travel_minutes(distance_km(*UENO_PARK, *AMEYOKO)) == 15


def test_travel_time_grows_with_distance_and_is_rounded_to_five_minutes():
    near, far = travel_minutes(2), travel_minutes(12)
    assert near < far
    assert near % 5 == 0 and far % 5 == 0
    assert far == 50  # 12 km * 1.3 road factor at 25 km/h is 37.4 min, plus 10 min to get going
