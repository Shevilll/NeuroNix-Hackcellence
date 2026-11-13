"""Rough travel time between two places from their latitude and longitude.

Good enough to space visits and show the traveller how long the trip takes; not a route planner.
The frontend has the same formula in ``frontend/src/lib/travel.ts``.
"""

from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0
ROAD_FACTOR = 1.3  # streets are longer than the straight line
CITY_SPEED_KMH = 25.0  # train, bus or taxi in a city, waits included
START_MINUTES = 10  # walk to the station, buy a ticket
STEP = 5


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle (haversine) distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def travel_minutes(km: float) -> int:
    """Minutes to get from one place to the next, rounded up to 5, never under 10."""
    raw = START_MINUTES + km * ROAD_FACTOR / CITY_SPEED_KMH * 60
    return max(START_MINUTES, math.ceil(raw / STEP - 1e-9) * STEP)


def travel_between(a, b) -> int:
    """Travel minutes between two catalog places that have ``lat`` and ``lng``."""
    return travel_minutes(distance_km(a.lat, a.lng, b.lat, b.lng))
