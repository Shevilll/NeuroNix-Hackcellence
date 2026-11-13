"""MVP builder: enumerate city plans, pick the cheapest valid parts for each, gate with the validator.

Preference (PLAN §3): the package visiting the most cities that fits the budget, then the lowest
total. When nothing fits the budget the cheapest valid package is reported (M8).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from functools import lru_cache
from itertools import permutations, product
from typing import Any

from app.catalog.loader import Catalog
from app.domain import pricing
from app.domain.request import TripRequest
from app.domain.timeutil import earliest_in_window, in_window, weekday_code
from app.rules.validate import fits, validate_package

DAY_START = 9 * 60
# Latest end of a visit the traveller adds (22:00 by default); it must also fit the attraction's own hours.
DAY_END = 22 * 60


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


@lru_cache(maxsize=1024)
def _city_cheapest(catalog, city: str, days: tuple, adults: int, children: int):
    """Cheapest one-attraction-per-day assignment for one city (exact; cached because it depends
    only on the city, the days and the party, never on hotels or flights).

    Returns ((attraction, day, cost), ...) in day order, or None when a day cannot be filled.
    """
    pool = sorted(catalog.attractions_in(city), key=lambda a: a.attraction_id)
    costs = [pricing.attraction_cost(a, adults, children) for a in pool]
    unsuitable = [int(children > 0 and not a.child_friendly) for a in pool]
    layer: dict[int, tuple[int, int, tuple[int, ...]]] = {0: (0, 0, ())}  # used set -> (cost, unsuitable, picks)
    for day in days:
        allowed = []
        for i, a in enumerate(pool):
            start = max(a.open_from, DAY_START)
            if (weekday_code(day) in a.open_days and day not in a.closed_dates
                    and start + a.visit_minutes <= a.open_until and start + a.visit_minutes <= 1440):
                allowed.append(i)
        following: dict[int, tuple[int, int, tuple[int, ...]]] = {}
        for used, (cost, bad, picks) in layer.items():
            for i in allowed:
                if used >> i & 1:
                    continue
                state = (cost + costs[i], bad + unsuitable[i], picks + (i,))
                key = used | 1 << i
                if key not in following or state < following[key]:
                    following[key] = state
        if not following:
            return None
        layer = following
    _, _, picks = min(layer.values())
    return tuple((pool[i], day, costs[i]) for day, i in zip(days, picks))


def _cheapest_visits(catalog, request, stays):
    """One attraction on every full day at the lowest total cost, each used once.

    An exact search per city: taking the cheapest open attraction day by day can use up an
    attraction that is the only cheap choice for a later day. Ties prefer child-friendly places
    when there are children, then the earlier attraction id.
    """
    days_by_city: dict[str, list[date]] = {}
    for index, (city, first_night, nights, _opt) in enumerate(stays):
        for n in range(nights):
            day = first_night + timedelta(days=n)
            if day == request.start_date or (n == 0 and index > 0):
                continue
            days_by_city.setdefault(city, []).append(day)

    chosen = []
    for city, days in days_by_city.items():
        picks = _city_cheapest(catalog, city, tuple(days), request.adults, len(request.children_ages))
        if picks is None:
            return None
        for a, day, cost in picks:
            start = max(a.open_from, DAY_START)
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


def _best_rated(catalog, request, order, stays, arrivals, returns, changes, finish, consider):
    """Most hotel star-nights that fit the budget, then the lowest total.

    For every city keep only the cheapest option at each star level (a dearer hotel of the same
    stars can never help), bundling the arrival flight + transfer into the first city and the
    return flight + transfer into the last. Those bundles are few, so every combination is tried
    exactly. The intercity transfers and the attractions are the cheapest ones, which leaves the
    most budget for hotels.
    """
    last = len(order) - 1

    def bundle(i, option):
        parts = []
        if i == 0:
            a = _best_arrival(catalog, request, arrivals, option[1], "best_rated")
            if not a:
                return None
            parts.append(a)
        if i == last:
            r = _best_return(catalog, request, returns, option[1], "best_rated")
            if not r:
                return None
            parts.append(r)
        return tuple(parts)

    pools = []
    for i, (_city, _day, nights, options) in enumerate(stays):
        tier: dict[int, tuple] = {}
        for option in options:
            parts = bundle(i, option)
            if parts is None:
                continue
            cost = option[0] + sum(p[0] for p in parts)
            current = tier.get(option[1].stars)
            if current is None or cost < current[0]:
                tier[option[1].stars] = (cost, option, parts, nights * option[1].stars)
        if not tier:
            return
        pools.append(list(tier.values()))

    base = [(c, d, n, o[0]) for (c, d, n, o) in stays]  # attraction cost does not depend on the hotel
    visits = _cheapest_visits(catalog, request, base)
    if visits is None:
        return
    fixed = sum(c[1][0] for c in changes) + sum(v[3] for v in visits)

    combos = []
    for combo in product(*pools):
        total = sum(t[0] for t in combo) + fixed
        combos.append((total > request.budget, -sum(t[3] for t in combo), total, combo))
    combos.sort(key=lambda c: c[:3])
    for _over, _stars, _total, combo in combos[:8]:
        pkg = finish(combo[0][2][0], combo[-1][2][-1], [t[1] for t in combo])
        if pkg:
            consider(pkg)
            return


def _build_plan(request, catalog, order, split, objective="cheapest"):
    stays, day = [], request.start_date
    for city, nights in zip(order, split):
        options = hotel_options(catalog, request, city, day, nights)
        if not options:
            return None
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
        visits = (_cheapest_visits if objective in ("cheapest", "best_rated") else _attractions)(catalog, request, chosen)
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

    if objective == "best_rated":
        _best_rated(catalog, request, order, stays, arrivals, returns, changes, finish, consider)
        return best

    middle = [s[3][0] for s in stays]
    # The cheapest and recommended builds pick the hotel, flight and airport transfer *together*:
    # a hotel that costs a little more can sit where the airport transfer is much cheaper.
    cheap_like = objective in ("cheapest", "recommended")
    if len(order) == 1:
        if cheap_like:
            scored = []
            for opt in stays[0][3]:
                a = _best_arrival(catalog, request, arrivals, opt[1], objective)
                r = _best_return(catalog, request, returns, opt[1], objective)
                if a and r:
                    scored.append((opt[0] + a[0] + r[0], opt[1].hotel_id, opt[2].room_id, opt, a, r))
            for *_key, opt, a, r in sorted(scored, key=lambda t: t[:3])[:4]:
                pkg = finish(a, r, [opt])
                if pkg:
                    consider(pkg)
                    break
        else:
            for opt in stays[0][3][:12]:
                a, r = _best_arrival(catalog, request, arrivals, opt[1], objective), _best_return(catalog, request, returns, opt[1], objective)
                if a and r:
                    consider(finish(a, r, [opt]))
    elif cheap_like:
        firsts = sorted(
            ((o[0] + a[0], o[1].hotel_id, o[2].room_id, o, a)
             for o in stays[0][3] if (a := _best_arrival(catalog, request, arrivals, o[1], objective))),
            key=lambda t: t[:3])[:3]
        lasts = sorted(
            ((o[0] + r[0], o[1].hotel_id, o[2].room_id, o, r)
             for o in stays[-1][3] if (r := _best_return(catalog, request, returns, o[1], objective))),
            key=lambda t: t[:3])[:3]
        pairs = sorted(((f[0] + l[0], f, l) for f in firsts for l in lasts), key=lambda t: (t[0], t[1][1:3], t[2][1:3]))
        for _total, f, l in pairs:
            pkg = finish(f[4], l[4], [f[3], *middle[1:-1], l[3]])
            if pkg:
                consider(pkg)
                break
    else:
        first = next(((o, a) for o in stays[0][3] if (a := _best_arrival(catalog, request, arrivals, o[1], objective))), None)
        last = next(((o, r) for o in stays[-1][3] if (r := _best_return(catalog, request, returns, o[1], objective))), None)
        if first and last:
            picked = [first[0], *middle[1:-1], last[0]]
            consider(finish(first[1], last[1], picked))
    return best


# ------------------------------------------------------------------ public


def build_for_plan(request: TripRequest, catalog: Catalog, order, split, objective: str = "recommended"):
    """The package for one chosen city plan (G3), or None when that plan cannot be built."""
    return _build_plan(request, catalog, tuple(order), tuple(split), objective)


def build_package(request: TripRequest, catalog: Catalog, explain: bool = True) -> dict[str, Any]:
    """Build the recommended package and the cheapest / fastest / best-rated alternatives.

    ``explain=False`` is the quick mode used to test variants of a request (diagnostics): only the
    cheapest objective is solved and no reasons, suggestions or alternatives are added.
    """
    from app.planner import diagnostics  # imported here: diagnostics itself calls build_package

    plans = list(city_plans(request, catalog))
    by_objective: dict[str, list[dict[str, Any]]] = {}
    for objective in (("cheapest", "recommended", "fastest", "best_rated") if explain else ("cheapest",)):
        found = (_build_plan(request, catalog, order, split, objective) for order, split in plans)
        by_objective[objective] = [p for p in found if p]
    candidates = by_objective["cheapest"]
    if not candidates:
        result: dict[str, Any] = {"status": "NO_PACKAGE"}
        if explain:
            result["reasons"] = diagnostics.explain_no_package(request, catalog)
            result["nearby"] = diagnostics.nearby_options(request, catalog)
        return result
    within = [p for p in candidates if p["total_inr"] <= request.budget]
    if not within:
        cheapest = min(candidates, key=lambda p: p["total_inr"])
        short = cheapest["total_inr"] - request.budget
        result = {"status": "OVER_BUDGET", "cheapest_total": cheapest["total_inr"], "budget": request.budget,
                  "short_by": short, "cheapest_package": cheapest}
        if explain:
            details = diagnostics.suggest_for_over_budget(request, catalog, cheapest["total_inr"])
            result["suggestions"] = [d["message"] for d in details]
            result["suggestion_details"] = details
        return result
    # The plan comes from the truly cheapest builds (most cities, then lowest price). The package
    # shown is the same plan built in the recommended style (child-friendly attractions first)
    # when that still fits the budget.
    best = min(within, key=lambda p: (-len(p["cities"]), p["total_inr"]))
    if not explain:
        return {"status": "OK", "package": best}
    same_plan = [p for p in by_objective["recommended"]
                 if p["cities"] == best["cities"] and p["nights_per_city"] == best["nights_per_city"]
                 and p["total_inr"] <= request.budget]
    best = same_plan[0] if same_plan else best
    alternatives = {}
    for objective, found in by_objective.items():
        if objective == "recommended":
            continue
        ok = [p for p in found if p["total_inr"] <= request.budget]
        alternatives[objective] = dict(min(ok, key=lambda p: _score(p, objective)) if ok else min(within, key=lambda p: _score(p, objective)))
        alternatives[objective]["objective"] = objective
    return {"status": "OK", "package": best, "alternatives": alternatives}
