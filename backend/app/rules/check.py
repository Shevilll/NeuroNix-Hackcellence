"""S3: check any trip JSON (ours or another export) and report it grouped like the rule list.

Our exports carry a ``role`` on flights and transfers; other files may not, so roles are inferred
from the catalog first. Bad input is reported as a violation, never raised.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import date
from typing import Any

from app.catalog.loader import Catalog
from app.rules.validate import validate_package

GROUPS = ("Dates and cities", "Flights", "Airport transfers", "Transfers between cities", "Hotels",
          "Attractions", "Prices")

_PREFIXES = (
    ("Prices", ("PRICE_",)),
    ("Flights", ("FLIGHT_", "ARRIVAL_", "RETURN_")),
    ("Airport transfers", ("TRANSFER_", "PICKUP_", "AIRPORT_")),
    ("Transfers between cities", ("INTERCITY",)),
    ("Hotels", ("HOTEL_", "ROOM")),
    ("Attractions", ("ATTRACTION_",)),
    ("Dates and cities", ("NIGHTS_", "DATE_", "COUNTRY", "CITY_")),
)


def group_of(code: str) -> str:
    for group, prefixes in _PREFIXES:
        if code.startswith(prefixes):
            return group
    return "Dates and cities"


def _infer_roles(pkg: dict[str, Any], catalog: Catalog) -> None:
    home = pkg["traveler"]["home_airport"]
    arrival = ret = None
    for item in pkg["items"]:
        if item.get("type") == "flight" and not item.get("role"):
            flight = catalog.flights.get(item.get("catalog_id"))
            if flight is not None:
                item["role"] = "arrival_flight" if flight.origin == home else "return_flight"
        if item.get("role") == "arrival_flight":
            arrival = catalog.flights.get(item["catalog_id"])
        elif item.get("role") == "return_flight":
            ret = catalog.flights.get(item["catalog_id"])
    for item in pkg["items"]:
        if item.get("type") != "transfer" or item.get("role"):
            continue
        transfer = catalog.transfers.get(item.get("catalog_id"))
        if transfer is None:
            continue
        if transfer.is_intercity:
            item["role"] = "intercity_transfer"
        elif arrival is not None and transfer.airport == arrival.destination and item["start"][:10] == pkg["start_date"]:
            item["role"] = "arrival_transfer"
        elif ret is not None and transfer.airport == ret.origin:
            item["role"] = "departure_transfer"
    if not pkg.get("country"):
        for item in pkg["items"]:
            if item.get("type") == "hotel" and (name := catalog.country_of_city(item.get("city", ""))):
                pkg["country"] = name
                break


def _shape_problem(pkg: Any) -> str | None:
    if not isinstance(pkg, dict):
        return "The file must be a JSON object."
    traveler = pkg.get("traveler")
    if not isinstance(traveler, dict) or not all(isinstance(traveler.get(k), int) for k in ("adults", "children")):
        return "traveler needs whole-number adults and children."
    if not isinstance(traveler.get("home_airport"), str):
        return "traveler.home_airport is missing."
    for key in ("start_date", "end_date"):
        try:
            date.fromisoformat(pkg[key])
        except (KeyError, TypeError, ValueError):
            return f"{key} must be a date like 2027-04-10."
    if not isinstance(pkg.get("items"), list) or not all(isinstance(i, dict) for i in pkg["items"]):
        return "items must be a list of trip items."
    if not isinstance(pkg.get("total_inr"), (int, float)):
        return "total_inr must be a number."
    for i in pkg["items"]:
        for key in ("type", "catalog_id", "start", "price_inr", "quantity"):
            if key not in i:
                return f"every item needs {key}."
    return None


def _is_first_package(package: dict[str, Any]) -> bool:
    """"1-2 attractions on every full day" is the rule for the first package only. Our export carries
    ``version``, which is above 1 once the traveller has changed the package. A file without it (or
    with anything that is not a whole number above 1) is checked as a first package."""
    version = package.get("version")
    return not (isinstance(version, int) and not isinstance(version, bool) and version > 1)


def check_trip(package: Any, catalog: Catalog) -> dict[str, Any]:
    problem = _shape_problem(package)
    if problem is None:
        try:
            pkg = deepcopy(package)
            for item in pkg["items"]:
                item.setdefault("end", None)
                item.setdefault("room_id", None)
            _infer_roles(pkg, catalog)
            violations = validate_package(pkg, catalog, require_daily_attractions=_is_first_package(pkg))
        except Exception as error:  # noqa: BLE001 - a bad file must never crash the checker
            violations = [{"code": "MALFORMED", "message": f"Could not read the trip: {error!r}"}]
    else:
        violations = [{"code": "MALFORMED", "message": problem}]
    failing = {group_of(v["code"]) for v in violations}
    if any(v["code"] == "MALFORMED" for v in violations):
        failing = set(GROUPS)
    return {
        "valid": not violations,
        "violations": [{**v, "group": group_of(v["code"])} for v in violations],
        "checklist": [{"group": g, "ok": g not in failing} for g in GROUPS],
    }
