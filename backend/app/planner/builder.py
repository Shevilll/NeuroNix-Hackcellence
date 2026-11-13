"""MVP builder: enumerate city plans, pick the cheapest valid parts for each, gate with the validator.

Preference (PLAN §3): the package visiting the most cities that fits the budget, then the lowest
total. When nothing fits the budget the cheapest valid package is reported (M8).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from itertools import permutations
from typing import Any

from app.catalog.loader import Catalog
from app.domain import pricing
from app.domain.request import TripRequest
from app.domain.timeutil import earliest_in_window, in_window, weekday_code
from app.rules.validate import fits, validate_package

DAY_START = 9 * 60


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="minutes")


def _at(day: date, minutes: int) -> datetime:
    return datetime(day.year, day.month, day.day) + timedelta(minutes=minutes)


# ------------------------------------------------------------------ city plans


def city_plans(request: TripRequest, catalog: Catalog):
    country = next(c for c in catalog.countries.values() if c.name == request.country)
    names = country.city_names
    minimum = catalog.rules.min_nights_per_city

    def splits(total: int, parts: int):
        if parts == 1:
            if total >= minimum:
                yield (total,)
            return
        for first in range(minimum, total - minimum * (parts - 1) + 1):
            for rest in splits(total - first, parts - 1):
                yield (first, *rest)

    for size in range(len(names), 0, -1):
        for order in permutations(names, size):
            if all(catalog.has_link(a, b) for a, b in zip(order, order[1:])):
                for split in splits(request.nights, size):
                    yield order, split


# ------------------------------------------------------------------ parts


def hotel_options(catalog: Catalog, request: TripRequest, city: str, first_night: date, nights: int):
    adults, children = request.adults, len(request.children_ages)
    found = []
    for hotel in catalog.hotels_in(city):
        for room in catalog.rooms_of(hotel.hotel_id):
            k = next((k for k in range(1, adults + 1) if fits(adults, children, room, k)), None)
            if k is None:
                continue
            if any(catalog.rooms_left(room.room_id, first_night + timedelta(days=n)) < k for n in range(nights)):
                continue
            found.append((pricing.hotel_cost(room.price_per_night, k, nights), hotel, room, k))
    return sorted(found, key=lambda o: (o[0], o[1].hotel_id, o[2].room_id))


def _arrival_transfer(catalog, request, flight, hotel):
    best = None
    for t in catalog.airport_transfers(flight.destination, hotel.city, hotel.area):
        pick = earliest_in_window(
            flight.arrival_local.hour * 60 + flight.arrival_local.minute + 60, t.service_from, t.service_until
        )
        if pick >= 1440:
            continue
        cost = pricing.transfer_cost(t, request.adults, len(request.children_ages))
        if best is None or (cost, t.transfer_id) < (best[0], best[1].transfer_id):
            best = (cost, t, _at(flight.arrival_local.date(), pick))
    return best


def _departure_transfer(catalog, request, flight, hotel):
    best = None
    dep = flight.departure_local.hour * 60 + flight.departure_local.minute
    for t in catalog.airport_transfers(flight.origin, hotel.city, hotel.area):
        latest = dep - 180 - t.duration_minutes
        pick = next((m for m in range(latest, -1, -1) if in_window(m, t.service_from, t.service_until)), None)
        if pick is None:
            continue
        cost = pricing.transfer_cost(t, request.adults, len(request.children_ages))
        if best is None or (cost, t.transfer_id) < (best[0], best[1].transfer_id):
            best = (cost, t, _at(flight.departure_local.date(), pick))
    return best


def _flight_rank(f, cost, objective):
    return (f.duration_minutes, cost, f.flight_id) if objective == "fastest" else (cost, f.flight_id)


def _best_arrival(catalog, request, flights, hotel, objective="cheapest"):
    best = None
    for f in flights:
        tr = _arrival_transfer(catalog, request, f, hotel)
        if tr:
            cost = pricing.flight_cost(f.price_per_seat, request.travelers) + tr[0]
            rank = _flight_rank(f, cost, objective)
            if best is None or rank < best[3]:
                best = (cost, f, tr, rank)
    return best[:3] if best else None


def _best_return(catalog, request, flights, hotel, objective="cheapest"):
    best = None
    for f in flights:
        tr = _departure_transfer(catalog, request, f, hotel)
        if tr:
            cost = pricing.flight_cost(f.price_per_seat, request.travelers) + tr[0]
            rank = _flight_rank(f, cost, objective)
            if best is None or rank < best[3]:
                best = (cost, f, tr, rank)
    return best[:3] if best else None


def _intercity(catalog, request, a: str, b: str, day: date, objective: str = "cheapest"):
    best = None
    for t in catalog.intercity_transfers(a, b):
        pick = 600
        if t.frequency_minutes and t.service_from <= t.service_until:
            steps = -(-(pick - t.service_from) // t.frequency_minutes) if pick > t.service_from else 0
            pick = t.service_from + steps * t.frequency_minutes
        if not in_window(pick, t.service_from, t.service_until):
            pick = earliest_in_window(pick, t.service_from, t.service_until)
        if pick >= 1440:
            continue
        cost = pricing.transfer_cost(t, request.adults, len(request.children_ages))
        rank = (t.duration_minutes, cost, t.transfer_id) if objective == "fastest" else (cost, t.transfer_id)
        if best is None or rank < best[3]:
            best = (cost, t, _at(day, pick), rank)
    return best[:3] if best else None


def _attractions(catalog, request, stays):
    """1 attraction on every full day (not arrival, change or last day)."""
    used: set[str] = set()
    chosen = []
    children = len(request.children_ages)
    for index, (city, first_night, nights, _opt) in enumerate(stays):
        for n in range(nights):
            day = first_night + timedelta(days=n)
            if day == request.start_date or (n == 0 and index > 0):
                continue
            options = []
            for a in catalog.attractions_in(city):
                start = max(a.open_from, DAY_START)
                if (a.attraction_id in used or weekday_code(day) not in a.open_days
                        or day in a.closed_dates or start + a.visit_minutes > a.open_until
                        or start + a.visit_minutes > 1440):
                    continue
                cost = pricing.attraction_cost(a, request.adults, children)
                options.append(((children > 0 and not a.child_friendly), cost, a.attraction_id, a, start, cost))
            if not options:
                return None
            _, _, _, a, start, cost = min(options, key=lambda o: o[:3])
            used.add(a.attraction_id)
            chosen.append((a, _at(day, start), _at(day, start + a.visit_minutes), cost))
    return chosen


# ------------------------------------------------------------------ assembly


def _assemble(request, catalog, order, split, arrival, ret, stays, changes, visits):
    c = len(request.children_ages)
    items: list[dict[str, Any]] = []

    def add(kind, name, city, cid, start, end, qty, price, room=None, role=None):
        items.append({"item_id": f"i{len(items) + 1}", "type": kind, "name": name, "city": city,
                      "status": "PLANNED", "catalog_id": cid, "room_id": room, "start": start, "end": end,
                      "quantity": qty, "price_inr": price, "booking": None, "sources": [], "warnings": [],
                      "role": role})

    origin_city = next(d.city for d in catalog.departure_cities if d.airport == request.origin)
    for role, (_cost, f, tr), city in (("arrival_flight", arrival, order[0]), ("return_flight", ret, origin_city)):
        add("flight", f"{f.airline} {f.flight_number} {f.origin} to {f.destination}", city, f.flight_id,
            _iso(f.departure_local), _iso(f.arrival_local), request.travelers,
            pricing.flight_cost(f.price_per_seat, request.travelers), role=role)
    for role, (_cost, f, (tcost, t, pickup)), city, in (
        ("arrival_transfer", arrival, order[0]), ("departure_transfer", ret, order[-1])
    ):
        qty = pricing.vehicles_needed(request.travelers, t.max_passengers) if t.pricing == "PER_VEHICLE" else request.travelers
        add("transfer", t.name, city, t.transfer_id, _iso(pickup), _iso(pickup + timedelta(minutes=t.duration_minutes)),
            qty, tcost, role=role)
    for city, first_night, nights, (cost, hotel, room, k) in stays:
        add("hotel", hotel.name, city, hotel.hotel_id, first_night.isoformat(),
            (first_night + timedelta(days=nights)).isoformat(), k, cost, room=room.room_id)
    for (a_city, b_city), (tcost, t, pickup) in changes:
        qty = pricing.vehicles_needed(request.travelers, t.max_passengers) if t.pricing == "PER_VEHICLE" else request.travelers
        add("transfer", t.name, b_city, t.transfer_id, _iso(pickup), _iso(pickup + timedelta(minutes=t.duration_minutes)),
            qty, tcost, role="intercity_transfer")
    for a, s, e, cost in visits:
        add("attraction", a.name, a.city, a.attraction_id, _iso(s), _iso(e), request.travelers, cost)

    items.sort(key=lambda i: (i["start"], i["type"]))
    for n, item in enumerate(items, 1):
        item["item_id"] = f"i{n}"
    return {
        "trip_id": "", "traveler": {"name": "Traveler", "home_airport": request.origin,
                                    "adults": request.adults, "children": c,
                                    "child_ages": list(request.children_ages)},
        "country": request.country, "start_date": request.start_date.isoformat(),
        "end_date": request.end_date.isoformat(), "budget_inr": request.budget,
        "total_inr": sum(i["price_inr"] for i in items), "items": items,
        "cities": list(order), "nights_per_city": list(split),
    }


def _add_metrics(pkg, catalog):
    """travel_minutes (G4 fastest) and avg_stars per night (G4 best rated)."""
    minutes = 0
    for i in pkg["items"]:
        if i["type"] == "flight":
            minutes += catalog.flights[i["catalog_id"]].duration_minutes
        elif i.get("role") == "intercity_transfer":
            minutes += catalog.transfers[i["catalog_id"]].duration_minutes
    nights = stars = 0
    for i in pkg["items"]:
        if i["type"] == "hotel":
            n = (date.fromisoformat(i["end"]) - date.fromisoformat(i["start"])).days
            nights, stars = nights + n, stars + n * catalog.hotels[i["catalog_id"]].stars
    pkg["travel_minutes"], pkg["avg_stars"] = minutes, round(stars / nights, 2)


def _score(pkg, objective):
    if objective == "fastest":
        return (pkg["travel_minutes"], pkg["total_inr"])
    if objective == "best_rated":
        return (-pkg["avg_stars"], pkg["total_inr"])
    return (pkg["total_inr"],)


def _build_plan(request, catalog, order, split, objective="cheapest"):
    stays, day = [], request.start_date
    for city, nights in zip(order, split):
        options = hotel_options(catalog, request, city, day, nights)
        if not options:
            return None
        if objective == "best_rated":
            options = sorted(options, key=lambda o: (-o[1].stars, o[0], o[1].hotel_id, o[2].room_id))
        stays.append((city, day, nights, options))
        day += timedelta(days=nights)
    arr_airports = set().union(*(catalog.airports_serving(order[0]),))
    ret_airports = catalog.airports_serving(order[-1])
    seats = request.travelers
    arrivals = [f for f in catalog.arrival_flights(request.origin, arr_airports, request.start_date) if f.seats_left >= seats]
    returns = [f for f in catalog.return_flights(ret_airports, request.origin, request.end_date) if f.seats_left >= seats]
    if not arrivals or not returns:
        return None

    changes = []
    for i in range(1, len(order)):
        ch = _intercity(catalog, request, order[i - 1], order[i], stays[i][1], objective)
        if ch is None:
            return None
        changes.append(((order[i - 1], order[i]), ch))

    def finish(arrival, ret, picked):
        # picked: list of chosen hotel option per stay
        chosen = [(c, d, n, picked[i]) for i, (c, d, n, _o) in enumerate(stays)]
        visits = _attractions(catalog, request, chosen)
        if visits is None:
            return None
        pkg = _assemble(request, catalog, order, split, arrival, ret, chosen, changes, visits)
        return pkg if not validate_package(pkg, catalog) else None

    best = None

    def consider(pkg):
        nonlocal best
        if pkg:
            _add_metrics(pkg, catalog)
            if best is None or _score(pkg, objective) < _score(best, objective):
                best = pkg

    middle = [s[3][0] for s in stays]
    if len(order) == 1:
        for opt in stays[0][3][:12]:
            a, r = _best_arrival(catalog, request, arrivals, opt[1], objective), _best_return(catalog, request, returns, opt[1], objective)
            if a and r:
                consider(finish(a, r, [opt]))
    else:
        first = next(((o, a) for o in stays[0][3] if (a := _best_arrival(catalog, request, arrivals, o[1], objective))), None)
        last = next(((o, r) for o in stays[-1][3] if (r := _best_return(catalog, request, returns, o[1], objective))), None)
        if first and last:
            picked = [first[0], *middle[1:-1], last[0]]
            consider(finish(first[1], last[1], picked))
    return best


# ------------------------------------------------------------------ public


def _reasons(request, catalog) -> list[dict[str, str]]:
    names = next(c for c in catalog.countries.values() if c.name == request.country).city_names
    airports = set().union(*(catalog.airports_serving(c) for c in names))
    out = []
    arrivals = catalog.arrival_flights(request.origin, airports, request.start_date)
    returns = catalog.return_flights(airports, request.origin, request.end_date)
    if not arrivals:
        out.append({"code": "NO_ARRIVAL_FLIGHT", "message": f"No flight from {request.origin} lands in {request.country} on {request.start_date:%d %b %Y}."})
    elif all(f.seats_left < request.travelers for f in arrivals):
        out.append({"code": "NOT_ENOUGH_SEATS", "message": f"No arrival flight has {request.travelers} free seats on {request.start_date:%d %b %Y}."})
    if not returns:
        out.append({"code": "NO_RETURN_FLIGHT", "message": f"No flight from {request.country} to {request.origin} leaves on {request.end_date:%d %b %Y}."})
    elif all(f.seats_left < request.travelers for f in returns):
        out.append({"code": "NOT_ENOUGH_SEATS", "message": f"No return flight has {request.travelers} free seats on {request.end_date:%d %b %Y}."})
    if not out:
        out.append({"code": "NO_VALID_COMBINATION", "message": "Flights exist, but no combination of hotel rooms, airport transfer times and attractions fits these dates and travelers."})
    return out


def build_package(request: TripRequest, catalog: Catalog) -> dict[str, Any]:
    plans = list(city_plans(request, catalog))
    by_objective: dict[str, list[dict[str, Any]]] = {}
    for objective in ("cheapest", "fastest", "best_rated"):
        found = (_build_plan(request, catalog, order, split, objective) for order, split in plans)
        by_objective[objective] = [p for p in found if p]
    candidates = by_objective["cheapest"]
    if not candidates:
        return {"status": "NO_PACKAGE", "reasons": _reasons(request, catalog)}
    within = [p for p in candidates if p["total_inr"] <= request.budget]
    if not within:
        cheapest = min(candidates, key=lambda p: p["total_inr"])
        short = cheapest["total_inr"] - request.budget
        return {
            "status": "OVER_BUDGET", "cheapest_total": cheapest["total_inr"], "budget": request.budget,
            "short_by": short, "cheapest_package": cheapest,
            "suggestions": [f"Raise the budget by about ₹{short:,.0f}, or try fewer nights or other dates."],
        }
    best = min(within, key=lambda p: (-len(p["cities"]), p["total_inr"]))
    alternatives = {}
    for objective, found in by_objective.items():
        ok = [p for p in found if p["total_inr"] <= request.budget]
        alternatives[objective] = dict(min(ok, key=lambda p: _score(p, objective)) if ok else min(within, key=lambda p: _score(p, objective)))
        alternatives[objective]["objective"] = objective
    return {"status": "OK", "package": best, "alternatives": alternatives}
