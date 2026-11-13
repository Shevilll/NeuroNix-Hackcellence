"""M6 / G1 / G2: change a package, then re-check the whole thing with the one validator.

Every operation works on a copy, rebuilds the parts it affects (airport transfer timing, room
count, prices), recomputes the total and runs ``validate_package``. Any violation refuses the
change with the reason; the stored package is never touched.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from typing import Any

from app.catalog.loader import Catalog
from app.domain import pricing
from app.domain.request import TripRequest
from app.domain.timeutil import format_clock, weekday_code
from app.planner.builder import DAY_START, _arrival_transfer, _departure_transfer, hotel_options
from app.rules.validate import fits, validate_package


class ChangeRefused(Exception):
    def __init__(self, reason: str, violations: list[dict[str, str]] | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.violations = violations or []


def _request(pkg: dict[str, Any]) -> TripRequest:
    t = pkg["traveler"]
    return TripRequest(t["home_airport"], pkg["country"], date.fromisoformat(pkg["start_date"]),
                       (date.fromisoformat(pkg["end_date"]) - date.fromisoformat(pkg["start_date"])).days,
                       t["adults"], tuple(t["child_ages"]), pkg["budget_inr"])


def _iso(m: datetime) -> str:
    return m.isoformat(timespec="minutes")


def _find(pkg, **match):
    return next((i for i in pkg["items"] if all(i.get(k) == v for k, v in match.items())), None)


def _finish(pkg: dict[str, Any], catalog: Catalog) -> dict[str, Any]:
    pkg["items"].sort(key=lambda i: (i["start"], i["type"]))
    for n, item in enumerate(pkg["items"], 1):
        item["item_id"] = f"i{n}"
    pkg["total_inr"] = sum(i["price_inr"] for i in pkg["items"])
    problems = validate_package(pkg, catalog)
    if problems:
        raise ChangeRefused(problems[0]["message"], problems)
    return pkg


def _set_transfer(pkg, item, found, request):
    cost, t, pickup = found
    item.update(name=t.name, catalog_id=t.transfer_id, start=_iso(pickup),
                end=_iso(pickup + timedelta(minutes=t.duration_minutes)), price_inr=cost,
                quantity=pricing.vehicles_needed(request.travelers, t.max_passengers)
                if t.pricing == "PER_VEHICLE" else request.travelers)


def _refit_airport_transfers(pkg, catalog, request):
    """G1: after a hotel or flight change, re-time the airport transfers that depend on it."""
    hotels = sorted((i for i in pkg["items"] if i["type"] == "hotel"), key=lambda i: i["start"])
    for role, flight_role, hotel_item, finder in (
        ("arrival_transfer", "arrival_flight", hotels[0], _arrival_transfer),
        ("departure_transfer", "return_flight", hotels[-1], _departure_transfer),
    ):
        flight = catalog.flights[_find(pkg, role=flight_role)["catalog_id"]]
        hotel = catalog.hotels[hotel_item["catalog_id"]]
        found = finder(catalog, request, flight, hotel)
        if found is None:
            raise ChangeRefused(f"No airport transfer works for {flight.flight_id} and {hotel.name}.")
        _set_transfer(pkg, _find(pkg, role=role), found, request)
        if role == "arrival_transfer":  # G1: warn about an early arrival (check-in is display only)
            arrives = datetime.fromisoformat(_find(pkg, role=role)["end"])
            hotel_item["warnings"] = (
                [f"You reach the hotel at {arrives:%H:%M}; check-in opens at {format_clock(hotel.check_in_from)}."]
                if arrives.hour * 60 + arrives.minute < hotel.check_in_from else []
            )


def _replace_hotel(pkg, catalog, request, change):
    item = next((i for i in pkg["items"] if i["type"] == "hotel" and i["city"] == change.get("city")), None)
    hotel, room = catalog.hotels.get(change.get("hotel_id")), catalog.rooms.get(change.get("room_id"))
    if item is None or hotel is None or room is None or room.hotel_id != hotel.hotel_id or hotel.city != item["city"]:
        raise ChangeRefused("That hotel is not available in this city.")
    nights = (date.fromisoformat(item["end"]) - date.fromisoformat(item["start"])).days
    k = next((k for k in range(1, request.adults + 1) if fits(request.adults, len(request.children_ages), room, k)), None)
    if k is None:
        raise ChangeRefused("That room type cannot fit your party.")
    item.update(name=hotel.name, catalog_id=hotel.hotel_id, room_id=room.room_id, quantity=k,
                price_inr=pricing.hotel_cost(room.price_per_night, k, nights))
    _refit_airport_transfers(pkg, catalog, request)


def _replace_flight(pkg, catalog, request, change):
    role = change.get("role")
    item = _find(pkg, type="flight", role=role)
    f = catalog.flights.get(change.get("flight_id"))
    if item is None or f is None:
        raise ChangeRefused("Unknown flight.")
    item.update(name=f"{f.airline} {f.flight_number} {f.origin} to {f.destination}", catalog_id=f.flight_id,
                start=_iso(f.departure_local), end=_iso(f.arrival_local),
                price_inr=pricing.flight_cost(f.price_per_seat, request.travelers))
    _refit_airport_transfers(pkg, catalog, request)


def _free_slot(pkg, catalog, a, day: date):
    """Earliest start on `day` that fits the opening hours, avoids other visits and arrivals."""
    earliest = DAY_START
    for i in pkg["items"]:
        if i["type"] == "transfer" and i.get("end") and i["end"][:10] == day.isoformat() and i["role"] != "departure_transfer":
            e = datetime.fromisoformat(i["end"])
            earliest = max(earliest, e.hour * 60 + e.minute + 30)
    busy = sorted((datetime.fromisoformat(i["start"]), datetime.fromisoformat(i["end"]))
                  for i in pkg["items"] if i["type"] == "attraction" and i["start"][:10] == day.isoformat())
    start = max(earliest, a.open_from)
    for s, e in busy:
        if start + a.visit_minutes <= s.hour * 60 + s.minute:
            break
        start = max(start, e.hour * 60 + e.minute)
    return start if start + a.visit_minutes <= min(a.open_until, 1440) else None


def _add_attraction(pkg, catalog, request, change):
    a = catalog.attractions.get(change.get("attraction_id"))
    if a is None:
        raise ChangeRefused("Unknown attraction.")
    try:
        day = date.fromisoformat(change.get("date", ""))
    except ValueError:
        raise ChangeRefused("Choose a date for the visit.") from None
    if _find(pkg, type="attraction", catalog_id=a.attraction_id):
        raise ChangeRefused("That attraction is already in the package.")
    start = _free_slot(pkg, catalog, a, day)
    if start is None:
        raise ChangeRefused("It does not fit on that day: opening hours, other visits or arrival time.")
    s = datetime(day.year, day.month, day.day) + timedelta(minutes=start)
    cost = pricing.attraction_cost(a, request.adults, len(request.children_ages))
    pkg["items"].append({"item_id": "", "type": "attraction", "name": a.name, "city": a.city, "status": "PLANNED",
                         "catalog_id": a.attraction_id, "room_id": None, "start": _iso(s),
                         "end": _iso(s + timedelta(minutes=a.visit_minutes)), "quantity": request.travelers,
                         "price_inr": cost, "booking": None, "sources": [], "warnings": [], "role": None})


def _remove_attraction(pkg, catalog, request, change):
    item = next((i for i in pkg["items"] if i["item_id"] == change.get("item_id") and i["type"] == "attraction"), None)
    if item is None:
        raise ChangeRefused("That attraction is not in the package.")
    pkg["items"].remove(item)
    # the validator refuses if this leaves a full day with fewer than 1 attraction


OPS = {"replace_hotel": _replace_hotel, "replace_flight": _replace_flight,
       "add_attraction": _add_attraction, "remove_attraction": _remove_attraction}


def apply_change(package: dict[str, Any], catalog: Catalog, change: dict[str, Any]) -> dict[str, Any]:
    op = OPS.get(change.get("op"))
    if op is None:
        raise ChangeRefused("Unknown change.")
    pkg = deepcopy(package)
    op(pkg, catalog, _request(pkg), change)
    return _finish(pkg, catalog)


# ------------------------------------------------------------------ G2: options with price difference


def list_options(package: dict[str, Any], catalog: Catalog, kind: str, **filters: Any) -> list[dict[str, Any]]:
    """Valid alternatives for one part, each with its price difference against the current choice."""
    out: list[dict[str, Any]] = []
    if kind == "hotels":
        city = filters["city"]
        item = next(i for i in package["items"] if i["type"] == "hotel" and i["city"] == city)
        first = date.fromisoformat(item["start"])
        nights = (date.fromisoformat(item["end"]) - first).days
        for cost, hotel, room, k in hotel_options(catalog, _request(package), city, first, nights):
            change = {"op": "replace_hotel", "city": city, "hotel_id": hotel.hotel_id, "room_id": room.room_id}
            try:
                new = apply_change(package, catalog, change)
            except ChangeRefused:
                continue
            out.append({"hotel_id": hotel.hotel_id, "room_id": room.room_id, "name": hotel.name,
                        "stars": hotel.stars, "rating": hotel.rating, "area": hotel.area, "rooms": k,
                        "price": cost, "price_diff": new["total_inr"] - package["total_inr"]})
    elif kind == "flights":
        role = filters["role"]
        item = _find(package, type="flight", role=role)
        for f in catalog.flights.values():
            same_day = (f.arrival_local.date() if role == "arrival_flight" else f.departure_local.date())
            want = date.fromisoformat(package["start_date"] if role == "arrival_flight" else package["end_date"])
            ends = (f.origin, f.destination)
            if (same_day != want or f.flight_id == item["catalog_id"]
                    or (role == "arrival_flight" and ends[0] != package["traveler"]["home_airport"])
                    or (role == "return_flight" and ends[1] != package["traveler"]["home_airport"])):
                continue
            try:
                new = apply_change(package, catalog, {"op": "replace_flight", "role": role, "flight_id": f.flight_id})
            except ChangeRefused:
                continue
            out.append({"flight_id": f.flight_id, "name": new_name(new, f.flight_id), "depart": _iso(f.departure_local),
                        "arrive": _iso(f.arrival_local), "price_diff": new["total_inr"] - package["total_inr"]})
    elif kind == "attractions":
        order = {}
        for h in package["items"]:
            if h["type"] == "hotel":
                for n in range((date.fromisoformat(h["end"]) - date.fromisoformat(h["start"])).days):
                    order[date.fromisoformat(h["start"]) + timedelta(days=n)] = h["city"]
        for day, city in sorted(order.items()):
            for a in catalog.attractions_in(city):
                if weekday_code(day) not in a.open_days or day in a.closed_dates:
                    continue
                try:
                    new = apply_change(package, catalog, {"op": "add_attraction", "attraction_id": a.attraction_id,
                                                          "date": day.isoformat()})
                except ChangeRefused:
                    continue
                out.append({"attraction_id": a.attraction_id, "name": a.name, "city": city, "date": day.isoformat(),
                            "price_diff": new["total_inr"] - package["total_inr"]})
    return out


def new_name(pkg: dict[str, Any], flight_id: str) -> str:
    return next(i["name"] for i in pkg["items"] if i["catalog_id"] == flight_id)
