"""M1: the holiday request and its validation.

``parse_request`` checks every field and reports all problems at once, so the form can show a
message next to each wrong field. The messages mirror the frontend's checks.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from app.catalog.loader import Catalog

MAX_CHILD_AGE = 17


class RequestInvalid(Exception):
    """One or more request fields are not valid. ``errors`` maps field name to message."""

    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors


@dataclass(frozen=True)
class TripRequest:
    origin: str  # departure airport code, e.g. "BLR"
    country: str  # country name as used in the catalog, e.g. "Japan"
    start_date: date
    nights: int
    adults: int
    children_ages: tuple[int, ...]
    budget: int | float

    @property
    def end_date(self) -> date:
        """The last day: the return flight leaves on this date, with no hotel night."""
        return self.start_date + timedelta(days=self.nights)

    @property
    def travelers(self) -> int:
        return self.adults + len(self.children_ages)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _long_date(day: date) -> str:
    return f"{day.day} {day.strftime('%B %Y')}"


def max_travelers(catalog: Catalog) -> int:
    """No flight has more free seats than this, so a bigger party can never fly."""
    return max((f.seats_left for f in catalog.flights.values()), default=0)


def parse_request(payload: dict[str, Any], catalog: Catalog) -> TripRequest:
    errors: dict[str, str] = {}
    rules = catalog.rules

    # origin
    origin = payload.get("origin")
    if origin is None or origin == "":
        errors["origin"] = "Choose a departure city."
    elif not isinstance(origin, str) or origin not in {c.airport for c in catalog.departure_cities}:
        errors["origin"] = "Choose a departure city from the list."

    # country: accept the code ("JP") or the name ("Japan")
    country_name: str | None = None
    country = payload.get("country")
    if country is None or country == "":
        errors["country"] = "Choose a destination country."
    else:
        for known in catalog.countries.values():
            if isinstance(country, str) and country in (known.code, known.name):
                country_name = known.name
        if country_name is None:
            errors["country"] = "Choose a destination country from the list."

    # nights
    nights = payload.get("nights")
    nights_ok = _is_int(nights) and rules.min_nights <= nights <= rules.max_nights
    if not nights_ok:
        errors["nights"] = f"Nights must be a whole number between {rules.min_nights} and {rules.max_nights}."

    # start date
    start: date | None = None
    raw_start = payload.get("start_date")
    if raw_start is None or raw_start == "":
        errors["start_date"] = "Choose the holiday start date."
    else:
        try:
            if not isinstance(raw_start, str):
                raise ValueError
            start = date.fromisoformat(raw_start)
            if len(raw_start) != 10:
                raise ValueError
        except ValueError:
            errors["start_date"] = "Enter a valid date (YYYY-MM-DD)."
    if start is not None:
        if start < rules.first_night:
            errors["start_date"] = f"The first night must be on or after {_long_date(rules.first_night)}."
        elif nights_ok and start + timedelta(days=nights) > rules.last_departure:
            errors["start_date"] = (
                f"The return flight must be on or before {_long_date(rules.last_departure)}. "
                "Start earlier or choose fewer nights."
            )

    # adults
    adults = payload.get("adults")
    adults_ok = _is_int(adults) and adults >= 1
    if not adults_ok:
        errors["adults"] = "At least 1 adult is required."

    # children
    ages = payload.get("children_ages", [])
    ages_ok = isinstance(ages, list) and all(_is_int(a) and 0 <= a <= MAX_CHILD_AGE for a in ages)
    if not ages_ok:
        errors["children_ages"] = f"Child ages must be whole numbers between 0 and {MAX_CHILD_AGE}."
    elif "children" in payload and payload["children"] != len(ages):
        errors["children_ages"] = "Give exactly one age for each child."

    if adults_ok and ages_ok and "adults" not in errors:
        limit = max_travelers(catalog)
        if adults + len(ages) > limit:
            errors["adults"] = f"No flight has seats for more than {limit} travelers."

    # budget
    budget = payload.get("budget")
    if (
        isinstance(budget, bool)
        or not isinstance(budget, (int, float))
        or not math.isfinite(budget)
        or budget <= 0
    ):
        errors["budget"] = "Enter a budget greater than 0 (in INR)."

    if errors:
        raise RequestInvalid(errors)

    return TripRequest(
        origin=origin,
        country=country_name,  # type: ignore[arg-type]
        start_date=start,  # type: ignore[arg-type]
        nights=nights,
        adults=adults,
        children_ages=tuple(ages),
        budget=budget,
    )
