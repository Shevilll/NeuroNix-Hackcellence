"""THE rule validator: every package rule from the problem statement (section 4).

Works on the exported trip JSON (the same shape the judges check), so the builder, every
change, and a loaded file are all checked by the same code. ``[]`` means the package is valid.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from app.catalog.loader import Catalog
from app.domain import pricing
from app.domain.timeutil import in_window, weekday_code

PRICE_TOLERANCE = 0.01


def _dt(text: str) -> datetime:
    return datetime.fromisoformat(text)


def _clock(moment: datetime) -> int:
    return moment.hour * 60 + moment.minute


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(1.0, PRICE_TOLERANCE * abs(b))


def fits(adults: int, children: int, room, k: int) -> bool:
    return (
        adults <= k * room.max_adults
        and adults + children <= k * (room.max_adults + room.max_children)
        and adults >= k
    )


def validate_package(
    package: dict[str, Any], catalog: Catalog, *, require_daily_attractions: bool = True
) -> list[dict[str, str]]:
    """Return every rule violation (``[]`` = valid).

    ``require_daily_attractions`` is the first-package rule "1-2 attractions on every full day".
    A traveler may later remove attractions (M6), so changes are checked with it off: a day may
    then have 0-2, but never more than 2.
    """
    out: list[dict[str, str]] = []

    def bad(code: str, message: str) -> None:
        out.append({"code": code, "message": message})

    traveler = package["traveler"]
    adults, children = traveler["adults"], traveler["children"]
    travelers = adults + children
    start, end = date.fromisoformat(package["start_date"]), date.fromisoformat(package["end_date"])
    nights = (end - start).days
    items = package["items"]
    rules = catalog.rules

    if not rules.min_nights <= nights <= rules.max_nights:
        bad("NIGHTS_RANGE", f"{nights} nights is outside {rules.min_nights}-{rules.max_nights}")
    if start < rules.first_night or end > rules.last_departure:
        bad("DATE_WINDOW", "trip is outside the data window")
    country = next((c for c in catalog.countries.values() if c.name == package.get("country")), None)
    if country is None:
        bad("COUNTRY", "unknown country")
        return out

    # ---- hotels: one per night, contiguous, >= 2 nights per city, each city once
    hotels = sorted((i for i in items if i["type"] == "hotel"), key=lambda i: i["start"])
    night_city: dict[date, str] = {}
    night_hotel: dict[date, Any] = {}
    seen_cities: list[str] = []
    for item in hotels:
        hotel, room = catalog.hotels.get(item["catalog_id"]), catalog.rooms.get(item["room_id"] or "")
        if hotel is None or room is None or room.hotel_id != hotel.hotel_id:
            bad("HOTEL_UNKNOWN", f"unknown hotel/room {item['catalog_id']}/{item['room_id']}")
            continue
        if hotel.city not in country.city_names:
            bad("CITY_COUNTRY", f"{hotel.city} is not in {country.name}")
        h_start, h_end = date.fromisoformat(item["start"]), date.fromisoformat(item["end"])
        city_nights = (h_end - h_start).days
        if city_nights < rules.min_nights_per_city:
            bad("CITY_MIN_NIGHTS", f"{hotel.city} has {city_nights} night(s)")
        if hotel.city in seen_cities:
            bad("CITY_REPEATED", f"{hotel.city} appears twice")
        seen_cities.append(hotel.city)
        k = item["quantity"]
        if not fits(adults, children, room, k):
            bad("ROOM_FIT", f"{k} x {room.room_id} does not fit {adults}+{children}")
        for n in range(city_nights):
            night = h_start + timedelta(days=n)
            if night in night_city:
                bad("HOTEL_OVERLAP", f"two hotels on {night}")
            night_city[night], night_hotel[night] = hotel.city, hotel
            if catalog.rooms_left(room.room_id, night) < k:
                bad("ROOMS_LEFT", f"{room.room_id} has fewer than {k} rooms on {night}")
        if not _close(item["price_inr"], pricing.hotel_cost(room.price_per_night, k, city_nights)):
            bad("PRICE_HOTEL", f"hotel price wrong for {hotel.hotel_id}")
    expected = {start + timedelta(days=n) for n in range(nights)}
    if set(night_city) != expected:
        bad("HOTEL_NIGHTS", "every night from start to the day before the return needs a hotel")
        return out
    order = [night_city[start + timedelta(days=n)] for n in range(nights)]
    first_city, last_city = order[0], order[-1]
    change_days = {
        start + timedelta(days=n): (order[n - 1], order[n]) for n in range(1, nights) if order[n] != order[n - 1]
    }

    # ---- flights
    flights = {r: [i for i in items if i["type"] == "flight" and i.get("role") == r]
               for r in ("arrival_flight", "return_flight")}
    arrival_flight = return_flight = None
    if len(flights["arrival_flight"]) != 1 or len(flights["return_flight"]) != 1:
        bad("FLIGHT_COUNT", "need exactly one arrival and one return flight")
    else:
        for role, item in ((r, flights[r][0]) for r in flights):
            f = catalog.flights.get(item["catalog_id"])
            if f is None:
                bad("FLIGHT_UNKNOWN", item["catalog_id"])
                continue
            if f.seats_left < travelers or item["quantity"] != travelers:
                bad("FLIGHT_SEATS", f"{f.flight_id}: {f.seats_left} seats for {travelers} travelers")
            if not _close(item["price_inr"], pricing.flight_cost(f.price_per_seat, travelers)):
                bad("PRICE_FLIGHT", f"flight price wrong for {f.flight_id}")
            if role == "arrival_flight":
                arrival_flight = f
                if f.origin != traveler["home_airport"]:
                    bad("FLIGHT_ORIGIN", "arrival flight must leave the home airport")
                if f.arrival_local.date() != start:
                    bad("ARRIVAL_DATE", "arrival flight must land on the start date")
                if first_city not in catalog.airports[f.destination].serves_cities:
                    bad("ARRIVAL_AIRPORT", f"{f.destination} does not serve {first_city}")
            else:
                return_flight = f
                if f.destination != traveler["home_airport"]:
                    bad("FLIGHT_DEST", "return flight must go to the home airport")
                if f.departure_local.date() != end:
                    bad("RETURN_DATE", "return flight must leave on the last day")
                if last_city not in catalog.airports[f.origin].serves_cities:
                    bad("RETURN_AIRPORT", f"{f.origin} does not serve {last_city}")

    # ---- transfers
    arrival_arrives: datetime | None = None
    intercity_arrives: dict[date, datetime] = {}
    found_in = found_out = False
    changes_seen: set[date] = set()
    for item in (i for i in items if i["type"] == "transfer"):
        t = catalog.transfers.get(item["catalog_id"])
        if t is None:
            bad("TRANSFER_UNKNOWN", item["catalog_id"])
            continue
        pickup = _dt(item["start"])
        if not in_window(_clock(pickup), t.service_from, t.service_until):
            bad("TRANSFER_WINDOW", f"{t.transfer_id} pickup {item['start']} outside service hours")
        want = (
            pricing.vehicles_needed(travelers, t.max_passengers) if t.pricing == "PER_VEHICLE" else travelers
        )
        if item["quantity"] != want or not _close(item["price_inr"], pricing.transfer_cost(t, adults, children)):
            bad("PRICE_TRANSFER", f"transfer price wrong for {t.transfer_id}")
        role = item.get("role")
        if role == "arrival_transfer" and arrival_flight:
            found_in = True
            hotel = night_hotel[start]
            if (t.airport != arrival_flight.destination or t.city != hotel.city or t.area not in (None, hotel.area)):
                bad("TRANSFER_SERVES", "arrival transfer does not serve the airport and first hotel")
            if pickup < arrival_flight.arrival_local + timedelta(minutes=60):
                bad("PICKUP_TOO_EARLY", "pickup must be at least 60 minutes after landing")
            arrival_arrives = pickup + timedelta(minutes=t.duration_minutes)
        elif role == "departure_transfer" and return_flight:
            found_out = True
            hotel = night_hotel[end - timedelta(days=1)]
            if (t.airport != return_flight.origin or t.city != hotel.city or t.area not in (None, hotel.area)):
                bad("TRANSFER_SERVES", "departure transfer does not serve the last hotel and airport")
            if pickup + timedelta(minutes=t.duration_minutes) > return_flight.departure_local - timedelta(minutes=180):
                bad("AIRPORT_TOO_LATE", "must reach the airport 180 minutes before departure")
        elif role == "intercity_transfer":
            day = pickup.date()
            pair = change_days.get(day)
            if pair is None or (t.from_city, t.to_city) != pair:
                bad("INTERCITY", f"{t.transfer_id} does not match a city change")
            else:
                changes_seen.add(day)
                intercity_arrives[day] = pickup + timedelta(minutes=t.duration_minutes)
        else:
            bad("TRANSFER_ROLE", f"unexpected transfer {t.transfer_id}")
    if not found_in or not found_out:
        bad("AIRPORT_TRANSFERS", "need an airport transfer at the start and at the end")
    if changes_seen != set(change_days):
        bad("INTERCITY_MISSING", "every city change needs one transfer")

    # ---- attractions
    per_day: dict[date, list[tuple[datetime, datetime]]] = {}
    used: set[str] = set()
    for item in (i for i in items if i["type"] == "attraction"):
        a = catalog.attractions.get(item["catalog_id"])
        if a is None:
            bad("ATTRACTION_UNKNOWN", item["catalog_id"])
            continue
        s, e = _dt(item["start"]), _dt(item["end"])
        day = s.date()
        if a.attraction_id in used:
            bad("ATTRACTION_TWICE", a.attraction_id)
        used.add(a.attraction_id)
        if day == end or day not in night_city:
            bad("ATTRACTION_DAY", f"{a.attraction_id} is on a day with no hotel night")
            continue
        if a.city != night_city[day]:
            bad("ATTRACTION_CITY", f"{a.attraction_id} is not in {night_city[day]}")
        if weekday_code(day) not in a.open_days or day in a.closed_dates:
            bad("ATTRACTION_CLOSED", f"{a.attraction_id} is closed on {day}")
        if _clock(s) < a.open_from or _clock(s) + a.visit_minutes > a.open_until or e - s != timedelta(minutes=a.visit_minutes):
            bad("ATTRACTION_HOURS", f"{a.attraction_id} does not fit its opening hours")
        if day == start and (arrival_arrives is None or s < arrival_arrives):
            bad("ATTRACTION_BEFORE_ARRIVAL", "visit starts before reaching the city")
        if day in intercity_arrives and s < intercity_arrives[day]:
            bad("ATTRACTION_BEFORE_ARRIVAL", "visit starts before reaching the new city")
        per_day.setdefault(day, []).append((s, e))
        if not _close(item["price_inr"], pricing.attraction_cost(a, adults, children)):
            bad("PRICE_ATTRACTION", f"attraction price wrong for {a.attraction_id}")
    for day, visits in per_day.items():
        visits.sort()
        for (_, e1), (s2, _) in zip(visits, visits[1:]):
            if s2 < e1:
                bad("ATTRACTION_OVERLAP", f"overlapping visits on {day}")
    for n in range(1, nights):
        day = start + timedelta(days=n)
        count = len(per_day.get(day, []))
        if day in change_days:
            continue
        if require_daily_attractions and not 1 <= count <= 2:
            bad("ATTRACTION_COUNT", f"{day} needs 1-2 attractions")
        elif count > 2:
            bad("ATTRACTION_COUNT", f"{day} can have at most 2 attractions")

    # ---- total
    if not _close(package["total_inr"], sum(i["price_inr"] for i in items)):
        bad("PRICE_TOTAL", "total is not the sum of the items")
    return out
