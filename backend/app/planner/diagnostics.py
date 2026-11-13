"""M2 and M8: explain a failed request and say what would work.

Nothing here guesses. Every suggestion was solved with the real builder: for an over-budget
request a suggestion is only shown if that variant fits the budget, for a request with no package
every "nearby" option is a variant that produces a package.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from typing import Any

from app.catalog.loader import Catalog
from app.domain.request import TripRequest
from app.planner import builder

MAX_SUGGESTIONS = 4
MAX_NEARBY = 5


def inr(amount: float) -> str:
    """Rupees with Indian digit grouping: 350000 -> ₹3,50,000."""
    digits = str(abs(int(round(amount))))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    return ("-" if amount < 0 else "") + "₹" + digits


def _long(day: date) -> str:
    return f"{day.day} {day:%b %Y}"


def _short(day: date) -> str:
    return f"{day.day} {day:%b}"


def _country(request: TripRequest, catalog: Catalog):
    return next(c for c in catalog.countries.values() if c.name == request.country)


# ------------------------------------------------------------------ M2: why there is no package


def explain_no_package(request: TripRequest, catalog: Catalog) -> list[dict[str, str]]:
    country = _country(request, catalog)
    cities = set(country.city_names)
    airports = set().union(*(catalog.airports_serving(c) for c in cities))
    origin_city = next((d.city for d in catalog.departure_cities if d.airport == request.origin), request.origin)
    need = request.travelers
    arrivals = catalog.arrival_flights(request.origin, airports, request.start_date)
    returns = catalog.return_flights(airports, request.origin, request.end_date)
    out: list[dict[str, str]] = []

    def check(flights, none_code, none_message, short_code, day):
        if not flights:
            out.append({"code": none_code, "message": none_message})
        elif all(f.seats_left < need for f in flights):
            most = max(f.seats_left for f in flights)
            out.append({"code": short_code, "message": (
                f"No flight on {_long(day)} has {need} free seats (the most any has is {most}). "
                "Every traveler, including each child, needs a seat.")})

    check(arrivals, "NO_ARRIVAL_FLIGHT",
          f"No flight from {origin_city} ({request.origin}) lands in {request.country} on {_long(request.start_date)}.",
          "NOT_ENOUGH_SEATS", request.start_date)
    check(returns, "NO_RETURN_FLIGHT",
          f"No flight from {request.country} to {origin_city} ({request.origin}) leaves on {_long(request.end_date)}.",
          "NOT_ENOUGH_SEATS_RETURN", request.end_date)
    if out:
        return out

    # Flights exist. Do the ones with enough seats connect through one valid city plan?
    first = {c for f in arrivals if f.seats_left >= need for c in catalog.airports[f.destination].serves_cities} & cities
    last = {c for f in returns if f.seats_left >= need for c in catalog.airports[f.origin].serves_cities} & cities
    plans = [(order, split) for order, split in builder.city_plans(request, catalog)
             if order[0] in first and order[-1] in last]
    if not plans:
        minimum = catalog.rules.min_nights_per_city
        return [{"code": "FLIGHTS_DONT_CONNECT", "message": (
            f"Flights with {need} free seats arrive in {', '.join(sorted(first))} but the return flights with "
            f"enough seats leave from {', '.join(sorted(last))}. Each city needs at least {minimum} nights, "
            f"so no route between them fits {request.nights} nights.")}]

    # A plan exists on paper: is a hotel room free for the party on every night?
    missing: list[str] = []
    for order, split in plans:
        day = request.start_date
        gap = None
        for city, nights in zip(order, split):
            if not builder.hotel_options(catalog, request, city, day, nights):
                gap = f"{city} for {nights} nights from {_short(day)}"
                break
            day += timedelta(days=nights)
        if gap is None:
            missing = []
            break
        missing.append(gap)
    if missing:
        return [{"code": "NO_ROOMS", "message": (
            f"No hotel has a room that fits {need} travelers on every night: {missing[0]}.")}]

    return [{"code": "NO_VALID_COMBINATION", "message": (
        "Flights and rooms exist, but no combination of airport transfer times and attractions "
        "fits these dates and travelers.")}]


# ------------------------------------------------------------------ variants of a request


def _valid(variant: TripRequest, catalog: Catalog) -> bool:
    rules = catalog.rules
    return (rules.min_nights <= variant.nights <= rules.max_nights
            and variant.start_date >= rules.first_night and variant.end_date <= rules.last_departure)


def _solve(variant: TripRequest, catalog: Catalog) -> dict[str, Any] | None:
    """Solve a variant without any explanations (no recursion). None if it is outside the rules."""
    if not _valid(variant, catalog):
        return None
    return builder.build_package(variant, catalog, explain=False)


def _total(solved: dict[str, Any]) -> int:
    return solved["package"]["total_inr"] if solved["status"] == "OK" else solved["cheapest_total"]


def _variant_dict(kind: str, base: TripRequest, variant: TripRequest, total: int, message: str) -> dict[str, Any]:
    return {"kind": kind, "start_date": variant.start_date.isoformat(), "end_date": variant.end_date.isoformat(),
            "nights": variant.nights, "total_inr": total, "message": message}


# ------------------------------------------------------------------ M8: over budget


def suggest_for_over_budget(request: TripRequest, catalog: Catalog, cheapest_total: int) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []

    def fits(variant: TripRequest) -> int | None:
        solved = _solve(variant, catalog)
        return _total(solved) if solved and solved["status"] == "OK" else None

    for fewer in (1, 2):
        variant = replace(request, nights=request.nights - fewer)
        total = fits(variant)
        if total is not None:
            details.append(_variant_dict(
                "fewer_nights", request, variant, total,
                f"Stay {variant.nights} nights instead of {request.nights}: {inr(total)}, within your budget."))
    for shift in (-1, 1, -2, 2, -3, 3):
        variant = replace(request, start_date=request.start_date + timedelta(days=shift))
        total = fits(variant)
        if total is not None:
            details.append(_variant_dict(
                "other_dates", request, variant, total,
                f"Start on {_short(variant.start_date)} instead of {_short(request.start_date)} "
                f"(back on {_short(variant.end_date)}): {inr(total)}, within your budget."))
    details = details[:MAX_SUGGESTIONS]

    short = cheapest_total - request.budget
    details.append({"kind": "raise_budget", "amount_inr": short, "message": (
        f"Raise your budget by {inr(short)} to afford the cheapest package ({inr(cheapest_total)}).")})
    return details


# ------------------------------------------------------------------ M2: nearby dates that work


def nearby_options(request: TripRequest, catalog: Catalog) -> list[dict[str, Any]]:
    found: list[tuple[int, int, dict[str, Any]]] = []
    tries = [(shift, 0) for shift in (-1, 1, -2, 2, -3, 3, -4, 4, -5, 5)] + \
            [(0, dn) for dn in (-1, 1, -2, 2)]
    for order, (shift, dn) in enumerate(tries):
        variant = replace(request, start_date=request.start_date + timedelta(days=shift), nights=request.nights + dn)
        solved = _solve(variant, catalog)
        if solved is None or solved["status"] == "NO_PACKAGE":
            continue
        total, ok = _total(solved), solved["status"] == "OK"
        what = (f"Start on {_short(variant.start_date)}" if shift else f"Stay {variant.nights} nights")
        message = (f"{what} ({variant.nights} nights, back on {_short(variant.end_date)}): {inr(total)}"
                   f"{', within your budget' if ok else f', which is {inr(total - request.budget)} over your budget'}.")
        option = _variant_dict("other_dates" if shift else "other_nights", request, variant, total, message)
        option["within_budget"] = ok
        found.append((abs(shift) + abs(dn), order, option))
    found.sort(key=lambda f: (f[0], f[1]))
    return [option for _, _, option in found[:MAX_NEARBY]]
