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
from app.domain.geo import travel_between
from app.domain.request import TripRequest
from app.domain.timeutil import format_clock, weekday_code
from app.planner.builder import DAY_END, DAY_START, build_for_plan, city_plans, _arrival_transfer, _departure_transfer, hotel_options
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
    problems = validate_package(pkg, catalog, require_daily_attractions=False)
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
    hotel = catalog.hotels.get(change.get("hotel_id"))
    if item is None or hotel is None or hotel.city != item["city"]:
        raise ChangeRefused("That hotel is not available in this city.")
    first = date.fromisoformat(item["start"])
    nights = (date.fromisoformat(item["end"]) - first).days
    if change.get("room_id"):
        room = catalog.rooms.get(change["room_id"])
        if room is None or room.hotel_id != hotel.hotel_id:
            raise ChangeRefused(f"That room type does not belong to {hotel.name}.")
    else:  # no room named: the cheapest room type that fits the party on every night
        fitting = [o for o in hotel_options(catalog, request, hotel.city, first, nights) if o[1].hotel_id == hotel.hotel_id]
        if not fitting:
            raise ChangeRefused(f"{hotel.name} has no room type that fits your party and is free on every night.")
        room = fitting[0][2]
    k = next((k for k in range(1, request.adults + 1) if fits(request.adults, len(request.children_ages), room, k)), None)
    if k is None:
        raise ChangeRefused("That room type cannot fit your party.")
    item.update(name=hotel.name, catalog_id=hotel.hotel_id, room_id=room.room_id, quantity=k,
                price_inr=pricing.hotel_cost(room.price_per_night, k, nights))
    _refit_airport_transfers(pkg, catalog, request)


def _day(d: date) -> str:
    return f"{d.day} {d:%b}"


def _check_flight(pkg, catalog, request, role: str, f) -> None:
    """Say plainly why a flight does not fit, before any transfer is re-timed."""
    hotels = sorted((i for i in pkg["items"] if i["type"] == "hotel"), key=lambda i: i["start"])
    home = pkg["traveler"]["home_airport"]
    if role == "arrival_flight":
        city, want, airport, ends_at_home = hotels[0]["city"], request.start_date, f.destination, f.origin == home
        day, wrong_end = f.arrival_local.date(), f"{f.flight_id} leaves {f.origin}, not {home}."
        verb = "lands"
    else:
        city, want, airport, ends_at_home = hotels[-1]["city"], request.end_date, f.origin, f.destination == home
        day, wrong_end = f.departure_local.date(), f"{f.flight_id} goes to {f.destination}, not {home}."
        verb = "leaves"
    if not ends_at_home:
        raise ChangeRefused(wrong_end)
    if day != want:
        raise ChangeRefused(f"{f.flight_id} {verb} on {_day(day)}; this trip needs a flight that {verb} on {_day(want)}.")
    if city not in catalog.airports[airport].serves_cities:
        raise ChangeRefused(f"{airport} does not serve {city}, where your {'first' if role == 'arrival_flight' else 'last'} hotel is.")
    if f.seats_left < request.travelers:
        raise ChangeRefused(
            f"{f.flight_id} has only {f.seats_left} free seats; you need {request.travelers} (children need a seat too)."
        )


def _replace_flight(pkg, catalog, request, change):
    role = change.get("role")
    item = _find(pkg, type="flight", role=role)
    f = catalog.flights.get(change.get("flight_id"))
    if item is None or f is None:
        raise ChangeRefused("Unknown flight.")
    _check_flight(pkg, catalog, request, role, f)
    item.update(name=f"{f.airline} {f.flight_number} {f.origin} to {f.destination}", catalog_id=f.flight_id,
                start=_iso(f.departure_local), end=_iso(f.arrival_local),
                price_inr=pricing.flight_cost(f.price_per_seat, request.travelers))
    _refit_airport_transfers(pkg, catalog, request)


def _free_slot(pkg, catalog, a, day: date):
    """Earliest start on `day` that fits the opening hours, avoids other visits and arrivals, and
    ends by DAY_END (22:00). Any number of visits a day is allowed while they fit."""
    earliest = DAY_START
    for i in pkg["items"]:
        if i["type"] == "transfer" and i.get("end") and i["end"][:10] == day.isoformat() and i["role"] != "departure_transfer":
            e = datetime.fromisoformat(i["end"])
            earliest = max(earliest, e.hour * 60 + e.minute + 30)
    busy = sorted((datetime.fromisoformat(i["start"]), datetime.fromisoformat(i["end"]), catalog.attractions[i["catalog_id"]])
                  for i in pkg["items"] if i["type"] == "attraction" and i["start"][:10] == day.isoformat())
    start = max(earliest, a.open_from)
    # Leave the travel time (from latitude and longitude) after the visit before and before the next.
    for s, e, b in busy:
        if start + a.visit_minutes + travel_between(a, b) <= s.hour * 60 + s.minute:
            break
        start = max(start, e.hour * 60 + e.minute + travel_between(b, a))
    return start if start + a.visit_minutes <= min(a.open_until, DAY_END) else None


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
        raise ChangeRefused("It does not fit on that day: visits end by 22:00, inside opening hours, after other visits and arrival.")
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


def _visit_date(change) -> date:
    try:
        return date.fromisoformat(change.get("date", ""))
    except ValueError:
        raise ChangeRefused("Choose a date for the visit.") from None


def _day_start(pkg, day: date) -> int:
    """Minutes after midnight the first visit of `day` can start: DAY_START, or 30 minutes after an
    airport or between-city transfer reaches the hotel that day."""
    cursor = DAY_START
    for i in pkg["items"]:
        if i["type"] == "transfer" and i.get("end") and i["end"][:10] == day.isoformat() and i["role"] != "departure_transfer":
            e = datetime.fromisoformat(i["end"])
            cursor = max(cursor, e.hour * 60 + e.minute + 30)
    return cursor


def _plan_day(pkg, catalog, day: date, visits: list) -> str | None:
    """Time `visits` (attraction items, in this order) from the start of `day`, with the travel
    time between each pair of places. Sets their start and end; returns why it does not fit, or None."""
    cursor, before, times = _day_start(pkg, day), None, []
    for item in visits:
        a = catalog.attractions[item["catalog_id"]]
        if before is not None:
            cursor += travel_between(before, a)
        start = max(cursor, a.open_from)
        if start + a.visit_minutes > min(a.open_until, DAY_END):
            return f"{a.name} does not fit in that order: it would end after it closes."
        times.append(start)
        cursor, before = start + a.visit_minutes, a
    midnight = datetime(day.year, day.month, day.day)
    for item, start in zip(visits, times):
        minutes = catalog.attractions[item["catalog_id"]].visit_minutes
        item.update(start=_iso(midnight + timedelta(minutes=start)), end=_iso(midnight + timedelta(minutes=start + minutes)))
    return None


def _fitting_orders(pkg, catalog, day: date, visits: list) -> list[tuple[tuple[int, ...], int]]:
    """Every order of any of `visits` that fits the day with the travel time between them, as
    (indexes into `visits`, minute the last one ends). A depth-first search that stops a branch as
    soon as a visit would end after it closes, so a full day stays quick."""
    places = [catalog.attractions[v["catalog_id"]] for v in visits]
    found: list[tuple[tuple[int, ...], int]] = []

    def walk(order: list[int], cursor: int) -> None:
        found.append((tuple(order), cursor))
        for n, a in enumerate(places):
            if n in order:
                continue
            start = max(cursor + (travel_between(places[order[-1]], a) if order else 0), a.open_from)
            if start + a.visit_minutes <= min(a.open_until, DAY_END):
                order.append(n)
                walk(order, start + a.visit_minutes)
                order.pop()

    walk([], _day_start(pkg, day))
    return found


def _moves(order: tuple[int, ...]) -> int:
    """How many visits are out of their old place (indexes in the old order)."""
    return sum(a != b for a, b in zip(order, sorted(order)))


def _day_visits(pkg, day: date) -> list:
    return sorted((i for i in pkg["items"] if i["type"] == "attraction" and i["start"][:10] == day.isoformat()),
                  key=lambda i: i["start"])


MAX_VISITS_SEARCHED = 8  # a day rarely has more than five visits


def _reorder_attractions(pkg, catalog, request, change):
    """Put one day's visits in the order the traveller dragged them, re-timed from the start of the
    day with the travel time between each pair of places (from their latitude and longitude).

    When that exact order breaks an opening hour and `moved_id` names the visit that was dragged, the
    dragged visit keeps its new place and the fewest other visits shift so that every visit fits."""
    day = _visit_date(change)
    today = {i["item_id"]: i for i in _day_visits(pkg, day)}
    order = list(change.get("item_ids") or ())
    if len(order) != len(set(order)) or set(order) != set(today):
        raise ChangeRefused("Send every visit of that day once, in the new order.")
    wanted = [today[i] for i in order]
    reason = _plan_day(pkg, catalog, day, wanted)
    if reason is None:
        return
    moved = change.get("moved_id")
    if moved in order and len(order) <= MAX_VISITS_SEARCHED:
        at = order.index(moved)
        every = [(o, end) for o, end in _fitting_orders(pkg, catalog, day, wanted) if len(o) == len(order)]
        if not every:
            raise ChangeRefused(f"The visits on {_day(day)} do not all fit with time to travel between them. "
                                "Use Fix the timings, then drag again.")
        full = [(o, end) for o, end in every if o[at] == at]
        if full:
            best = min(full, key=lambda f: (_moves(f[0]), f[1], f[0]))[0]
            _plan_day(pkg, catalog, day, [wanted[n] for n in best])
            return
    raise ChangeRefused(reason)


def _space_visits(pkg, catalog, request, change):
    """Leave the travel time between one day's visits. Keeps their order when it fits, else uses the
    fitting order that moves the fewest visits (ties: the day ends earliest). A day too full for the
    travel time keeps the most visits that fit, dropping later ones first; ``change_report`` names them."""
    day = _visit_date(change)
    visits = _day_visits(pkg, day)
    if _plan_day(pkg, catalog, day, visits) is None:
        return
    fitting = _fitting_orders(pkg, catalog, day, visits) if len(visits) <= MAX_VISITS_SEARCHED else []
    best = min(fitting, key=lambda f: (-len(f[0]), _moves(f[0]), tuple(sorted(f[0])), f[1], f[0]), default=None)
    if best is None or not best[0]:
        raise ChangeRefused(f"The visits on {_day(day)} do not fit with time to travel between them. Remove one and try again.")
    kept = [visits[n] for n in best[0]]
    for item in visits:
        if item not in kept:
            pkg["items"].remove(item)
    _plan_day(pkg, catalog, day, kept)


def _change_cities(pkg, catalog, request, change):
    """G3: rebuild the whole package for another valid city plan, keeping the same request."""
    order, split = tuple(change.get("cities") or ()), tuple(change.get("nights_per_city") or ())
    if (order, split) not in set(city_plans(request, catalog)):
        raise ChangeRefused("That is not a valid city plan: each city needs at least 2 nights and a link to the next.")
    rebuilt = build_for_plan(request, catalog, order, split)
    if rebuilt is None:
        raise ChangeRefused("No flights, rooms or transfers fit that city plan for your dates.")
    keep = {k: pkg[k] for k in ("trip_id", "version") if k in pkg}
    pkg.clear()
    pkg.update(rebuilt)
    pkg.update(keep)


OPS = {"change_cities": _change_cities, "replace_hotel": _replace_hotel, "replace_flight": _replace_flight,
       "add_attraction": _add_attraction, "remove_attraction": _remove_attraction,
       "reorder_attractions": _reorder_attractions, "space_visits": _space_visits}


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
            out.append({"hotel_id": hotel.hotel_id, "room_id": room.room_id, "name": f"{hotel.name} · {room.name}", "hotel_name": hotel.name,
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


# ------------------------------------------------------------------ G1: what a change did


def change_report(before: dict[str, Any], after: dict[str, Any], change: dict[str, Any] | None = None) -> dict[str, Any]:
    """The price difference and the warnings a traveler should see after `change`."""
    warnings: list[dict[str, str]] = []

    over, was_over = after["total_inr"] - after["budget_inr"], before["total_inr"] - before["budget_inr"]
    if over > 0 and was_over <= 0:
        warnings.append({"code": "OVER_BUDGET", "message":
                         f"This change takes the trip ₹{int(over):,} over your budget of ₹{int(after['budget_inr']):,}."})

    def empty_days(pkg: dict[str, Any]) -> list[date]:
        city_of: dict[date, str] = {}
        for h in (i for i in pkg["items"] if i["type"] == "hotel"):
            first = date.fromisoformat(h["start"])
            for n in range((date.fromisoformat(h["end"]) - first).days):
                city_of[first + timedelta(days=n)] = h["city"]
        start = date.fromisoformat(pkg["start_date"])
        visited = {i["start"][:10] for i in pkg["items"] if i["type"] == "attraction"}
        return [d for d, city in sorted(city_of.items())
                if d != start and city_of.get(d - timedelta(days=1)) == city and d.isoformat() not in visited]

    already = set(empty_days(before))
    for day in empty_days(after):
        if day not in already:
            warnings.append({"code": "EMPTY_DAY", "message": f"{_day(day)} has no attractions planned."})

    # "Fix the timings" may take visits off a day too full for the travel time between them.
    if (change or {}).get("op") == "space_visits":
        kept = {i["catalog_id"] for i in after["items"] if i["type"] == "attraction"}  # item ids are renumbered
        for gone in (i for i in before["items"] if i["type"] == "attraction" and i["catalog_id"] not in kept):
            warnings.append({"code": "VISIT_DROPPED", "message":
                             f"{gone['name']} was taken off {_day(date.fromisoformat(gone['start'][:10]))}: "
                             "it did not fit with time to travel between visits."})

    return {"price_diff_inr": after["total_inr"] - before["total_inr"], "warnings": warnings}


def list_city_plans(package: dict[str, Any], catalog: Catalog) -> list[dict[str, Any]]:
    """G3: every city plan that builds for this request, with its total and whether it fits the budget."""
    request = _request(package)
    out = []
    for order, split in city_plans(request, catalog):
        built = build_for_plan(request, catalog, order, split)
        if built is None:
            continue
        out.append({"cities": list(order), "nights_per_city": list(split), "total_inr": built["total_inr"],
                    "within_budget": built["total_inr"] <= request.budget,
                    "current": list(order) == package["cities"] and list(split) == package["nights_per_city"]})
    return sorted(out, key=lambda p: (not p["within_budget"], -len(p["cities"]), p["total_inr"]))
