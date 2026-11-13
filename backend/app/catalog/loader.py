"""Load data/catalog once, validate it, and index it for fast lookups.

The loader collects every problem it finds and raises one ``CatalogError`` listing all of them,
so a broken file is reported completely instead of one error at a time.
"""

from __future__ import annotations

import dataclasses
import json
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import date, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any

from app.catalog.models import (
    Airport,
    Attraction,
    City,
    Country,
    DepartureCity,
    Flight,
    Hotel,
    Link,
    Room,
    Rules,
    Transfer,
)

CATALOG_FILES = (
    "destinations.json",
    "airports.json",
    "flights.json",
    "hotels.json",
    "rooms.json",
    "availability.json",
    "transfers.json",
    "attractions.json",
)

_CLOCK = re.compile(r"^(\d{2}):(\d{2})$")


class CatalogError(Exception):
    """The catalog is missing, unreadable, or internally inconsistent."""


# --------------------------------------------------------------------------- parsing helpers


class _Problems:
    """Collects validation problems; parsing continues so all of them are reported."""

    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, message: str) -> None:
        self.items.append(message)

    def clock(self, value: Any, where: str) -> int:
        match = _CLOCK.match(value) if isinstance(value, str) else None
        if match:
            hours, minutes = int(match[1]), int(match[2])
            if (hours < 24 and minutes < 60) or (hours == 24 and minutes == 0):
                return hours * 60 + minutes
        self.add(f"{where}: bad clock time {value!r}")
        return 0

    def timestamp(self, value: Any, where: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except (TypeError, ValueError):
            self.add(f"{where}: bad timestamp {value!r}")
            return datetime.min

    def day(self, value: Any, where: str) -> date:
        try:
            return date.fromisoformat(value)
        except (TypeError, ValueError):
            self.add(f"{where}: bad date {value!r}")
            return date.min

    def money(self, value: Any, where: str) -> int:
        if (
            isinstance(value, dict)
            and value.get("currency") == "INR"
            and isinstance(value.get("amount"), int)
            and value["amount"] >= 0
        ):
            return value["amount"]
        self.add(f"{where}: price must be a whole, non-negative INR amount, got {value!r}")
        return 0

    def optional_money(self, value: Any, where: str) -> int | None:
        return None if value is None else self.money(value, where)


def _read(data_dir: Path, filename: str) -> Any:
    path = data_dir / "catalog" / filename
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise CatalogError(f"missing catalog file: {path}") from None
    except json.JSONDecodeError as exc:
        raise CatalogError(f"{filename}: invalid JSON ({exc})") from None


def _index(records: Iterable[Any], key: str, filename: str, problems: _Problems) -> dict[str, Any]:
    index: dict[str, Any] = {}
    for record in records:
        record_id = getattr(record, key)
        if record_id in index:
            problems.add(f"{filename}: duplicate {key} {record_id}")
        index[record_id] = record
    return index


# --------------------------------------------------------------------------- record builders


def _destinations(raw: dict, p: _Problems) -> tuple[list[DepartureCity], dict[str, Country], Rules]:
    departure_cities = [DepartureCity(airport=d["airport"], city=d["city"]) for d in raw["departure_cities"]]

    countries: dict[str, Country] = {}
    for c in raw["countries"]:
        countries[c["name"]] = Country(
            code=c["code"],
            name=c["name"],
            timezone=c["timezone"],
            cities=tuple(City(name=x["name"], airports=tuple(x["airports"])) for x in c["cities"]),
            links=tuple(
                Link(
                    from_city=link["from_city"],
                    to_city=link["to_city"],
                    transfer_ids=tuple(link["transfer_ids"]),
                )
                for link in c["links"]
            ),
        )

    r = raw["rules"]
    rules = Rules(
        min_nights=r["min_nights"],
        max_nights=r["max_nights"],
        min_nights_per_city=r["min_nights_per_city"],
        first_night=p.day(r["data_window"]["first_night"], "destinations.json rules"),
        last_departure=p.day(r["data_window"]["last_departure"], "destinations.json rules"),
    )
    return departure_cities, countries, rules


def _airport(a: dict) -> Airport:
    return Airport(
        code=a["code"],
        name=a["name"],
        city=a["city"],
        country=a["country"],
        timezone=a["timezone"],
        lat=a["lat"],
        lng=a["lng"],
        serves_cities=frozenset(a.get("serves_cities") or ()),
    )


def _flight(f: dict, p: _Problems) -> Flight:
    where = f"flights.json {f.get('flight_id')}"
    return Flight(
        flight_id=f["flight_id"],
        airline=f["airline"],
        flight_number=f["flight_number"],
        origin=f["from"],
        destination=f["to"],
        departure_local=p.timestamp(f["departure_local"], where),
        arrival_local=p.timestamp(f["arrival_local"], where),
        stops=f["stops"],
        duration_minutes=f["duration_minutes"],
        price_per_seat=p.money(f["price_per_seat"], where),
        seats_left=f["seats_left"],
        cabin=f["cabin"],
    )


def _hotel(h: dict, p: _Problems) -> Hotel:
    where = f"hotels.json {h.get('hotel_id')}"
    return Hotel(
        hotel_id=h["hotel_id"],
        name=h["name"],
        city=h["city"],
        area=h["area"],
        lat=h["lat"],
        lng=h["lng"],
        rating=h["rating"],
        stars=h["stars"],
        check_in_from=p.clock(h["check_in_from"], where),
        check_out_until=p.clock(h["check_out_until"], where),
        family_friendly=h["family_friendly"],
        image=h.get("image"),
    )


def _room(r: dict, p: _Problems) -> Room:
    return Room(
        room_id=r["room_id"],
        hotel_id=r["hotel_id"],
        room_type=r["room_type"],
        name=r["name"],
        max_adults=r["max_adults"],
        max_children=r["max_children"],
        price_per_night=p.money(r["price_per_night"], f"rooms.json {r.get('room_id')}"),
        refundable=r["refundable"],
    )


def _transfer(t: dict, p: _Problems) -> Transfer:
    where = f"transfers.json {t.get('transfer_id')}"
    return Transfer(
        transfer_id=t["transfer_id"],
        type=t["type"],
        name=t["name"],
        airport=t.get("airport"),
        city=t.get("city"),
        area=t.get("area"),
        from_city=t.get("from_city"),
        to_city=t.get("to_city"),
        from_point=t.get("from_point"),
        to_point=t.get("to_point"),
        max_passengers=t["max_passengers"],
        service_from=p.clock(t["service_from"], where),
        service_until=p.clock(t["service_until"], where),
        frequency_minutes=t.get("frequency_minutes"),
        duration_minutes=t["duration_minutes"],
        pricing=t["pricing"],
        price=p.money(t["price"], where),
        child_price=p.optional_money(t.get("child_price"), where),
        door_to_door=t.get("door_to_door"),
    )


def _attraction(a: dict, p: _Problems) -> Attraction:
    where = f"attractions.json {a.get('attraction_id')}"
    return Attraction(
        attraction_id=a["attraction_id"],
        name=a["name"],
        name_ja=a.get("name_ja"),
        city=a["city"],
        category=a["category"],
        lat=a["lat"],
        lng=a["lng"],
        open_days=frozenset(a["open_days"]),
        open_from=p.clock(a["open_from"], where),
        open_until=p.clock(a["open_until"], where),
        closed_dates=frozenset(p.day(d, where) for d in a.get("closed_dates") or ()),
        visit_minutes=a["visit_minutes"],
        child_friendly=a["child_friendly"],
        accessible=a["accessible"],
        price_per_person=p.money(a["price_per_person"], where),
        child_price=p.optional_money(a.get("child_price"), where),
        aliases=tuple(a.get("aliases") or ()),
        image=a.get("image"),
    )


# --------------------------------------------------------------------------- catalog


class Catalog:
    """The whole read-only catalog plus the indexes the planner and rule checker need."""

    def __init__(
        self,
        *,
        departure_cities: list[DepartureCity],
        countries: dict[str, Country],
        rules: Rules,
        airports: dict[str, Airport],
        flights: dict[str, Flight],
        hotels: dict[str, Hotel],
        rooms: dict[str, Room],
        rooms_left: dict[tuple[str, date], int],
        transfers: dict[str, Transfer],
        attractions: dict[str, Attraction],
    ) -> None:
        self.departure_cities: tuple[DepartureCity, ...] = tuple(departure_cities)
        self.countries: Mapping[str, Country] = MappingProxyType(countries)
        self.rules = rules
        self.airports: Mapping[str, Airport] = MappingProxyType(airports)
        self.flights: Mapping[str, Flight] = MappingProxyType(flights)
        self.hotels: Mapping[str, Hotel] = MappingProxyType(hotels)
        self.rooms: Mapping[str, Room] = MappingProxyType(rooms)
        self.transfers: Mapping[str, Transfer] = MappingProxyType(transfers)
        self.attractions: Mapping[str, Attraction] = MappingProxyType(attractions)
        self._rooms_left = rooms_left

        self._city_country = {city.name: c.name for c in countries.values() for city in c.cities}
        self._links = {(l.from_city, l.to_city): l for c in countries.values() for l in c.links}

        self._serving: dict[str, set[str]] = defaultdict(set)
        for airport in airports.values():
            for city in airport.serves_cities:
                self._serving[city].add(airport.code)

        self._arrivals: dict[tuple[str, date], list[Flight]] = defaultdict(list)
        self._returns: dict[tuple[str, date], list[Flight]] = defaultdict(list)
        for flight in flights.values():
            self._arrivals[(flight.origin, flight.arrival_local.date())].append(flight)
            self._returns[(flight.destination, flight.departure_local.date())].append(flight)

        self._hotels_by_city: dict[str, list[Hotel]] = defaultdict(list)
        for hotel in sorted(hotels.values(), key=lambda h: h.hotel_id):
            self._hotels_by_city[hotel.city].append(hotel)

        self._rooms_by_hotel: dict[str, list[Room]] = defaultdict(list)
        for room in sorted(rooms.values(), key=lambda r: r.room_id):
            self._rooms_by_hotel[room.hotel_id].append(room)

        self._attractions_by_city: dict[str, list[Attraction]] = defaultdict(list)
        for attraction in sorted(attractions.values(), key=lambda a: a.attraction_id):
            self._attractions_by_city[attraction.city].append(attraction)

        self._airport_transfers = sorted(
            (t for t in transfers.values() if t.is_airport_transfer), key=lambda t: t.transfer_id
        )

    def with_holds(self, flight_seats: Mapping[str, int], room_nights: Mapping[tuple[str, date], int]) -> "Catalog":
        """A view of the catalog with confirmed bookings subtracted (S2). The original is unchanged."""
        flights = {
            fid: dataclasses.replace(f, seats_left=max(0, f.seats_left - flight_seats.get(fid, 0)))
            for fid, f in self.flights.items()
        }
        rooms_left = {key: max(0, n - room_nights.get(key, 0)) for key, n in self._rooms_left.items()}
        return Catalog(
            departure_cities=list(self.departure_cities), countries=dict(self.countries), rules=self.rules,
            airports=dict(self.airports), flights=flights, hotels=dict(self.hotels), rooms=dict(self.rooms),
            rooms_left=rooms_left, transfers=dict(self.transfers), attractions=dict(self.attractions),
        )

    # ----- places

    def country_of_city(self, city: str) -> str | None:
        return self._city_country.get(city)

    def airports_serving(self, city: str) -> set[str]:
        return set(self._serving.get(city, ()))

    # ----- flights

    def arrival_flights(self, origin: str, airports: Iterable[str], day: date) -> list[Flight]:
        """Flights from `origin` that land at one of `airports` on local date `day`."""
        wanted = set(airports)
        found = [f for f in self._arrivals.get((origin, day), ()) if f.destination in wanted]
        return sorted(found, key=lambda f: (f.arrival_local, f.flight_id))

    def return_flights(self, airports: Iterable[str], destination: str, day: date) -> list[Flight]:
        """Flights from one of `airports` to `destination` that leave on local date `day`."""
        wanted = set(airports)
        found = [f for f in self._returns.get((destination, day), ()) if f.origin in wanted]
        return sorted(found, key=lambda f: (f.departure_local, f.flight_id))

    # ----- hotels

    def hotels_in(self, city: str) -> list[Hotel]:
        return list(self._hotels_by_city.get(city, ()))

    def rooms_of(self, hotel_id: str) -> list[Room]:
        return list(self._rooms_by_hotel.get(hotel_id, ()))

    def rooms_left(self, room_id: str, night: date) -> int:
        """Free rooms of a type on a night. No record means nothing can be booked."""
        return self._rooms_left.get((room_id, night), 0)

    # ----- transfers

    def airport_transfers(self, airport: str, city: str, area: str) -> list[Transfer]:
        """Airport transfers between `airport` and hotels in `city`/`area` (area null = all areas)."""
        return [
            t
            for t in self._airport_transfers
            if t.airport == airport and t.city == city and t.area in (None, area)
        ]

    def has_link(self, from_city: str, to_city: str) -> bool:
        return (from_city, to_city) in self._links

    def intercity_transfers(self, from_city: str, to_city: str) -> list[Transfer]:
        link = self._links.get((from_city, to_city))
        return [self.transfers[i] for i in link.transfer_ids] if link else []

    # ----- attractions

    def attractions_in(self, city: str) -> list[Attraction]:
        return list(self._attractions_by_city.get(city, ()))


def load_catalog(data_dir: Path) -> Catalog:
    """Read and validate every catalog file under ``data_dir/catalog``."""
    raw = {name: _read(data_dir, name) for name in CATALOG_FILES}
    p = _Problems()

    try:
        departure_cities, countries, rules = _destinations(raw["destinations.json"], p)
        airports = _index((_airport(a) for a in raw["airports.json"]), "code", "airports.json", p)
        flights = _index((_flight(f, p) for f in raw["flights.json"]), "flight_id", "flights.json", p)
        hotels = _index((_hotel(h, p) for h in raw["hotels.json"]), "hotel_id", "hotels.json", p)
        rooms = _index((_room(r, p) for r in raw["rooms.json"]), "room_id", "rooms.json", p)
        transfers = _index(
            (_transfer(t, p) for t in raw["transfers.json"]), "transfer_id", "transfers.json", p
        )
        attractions = _index(
            (_attraction(a, p) for a in raw["attractions.json"]),
            "attraction_id",
            "attractions.json",
            p,
        )
    except (KeyError, TypeError) as exc:
        raise CatalogError(f"catalog record is missing a required field: {exc}") from None

    rooms_left: dict[tuple[str, date], int] = {}
    for row in raw["availability.json"]:
        key = (row["room_id"], p.day(row["date"], f"availability.json {row['room_id']}"))
        if key in rooms_left:
            p.add(f"availability.json: duplicate night {key[0]} {key[1]}")
        if row["room_id"] not in rooms:
            p.add(f"availability.json: unknown room_id {row['room_id']}")
        rooms_left[key] = row["rooms_left"]

    # Cross-references (DQ-01, DQ-03).
    for room in rooms.values():
        if room.hotel_id not in hotels:
            p.add(f"rooms.json {room.room_id}: unknown hotel_id {room.hotel_id}")
    for flight in flights.values():
        for code in (flight.origin, flight.destination):
            if code not in airports:
                p.add(f"flights.json {flight.flight_id}: unknown airport {code}")
    for transfer in transfers.values():
        if transfer.airport is not None and transfer.airport not in airports:
            p.add(f"transfers.json {transfer.transfer_id}: unknown airport {transfer.airport}")
    for country in countries.values():
        for city in country.cities:
            for code in city.airports:
                if code not in airports:
                    p.add(f"destinations.json {city.name}: unknown airport {code}")
        for link in country.links:
            for transfer_id in link.transfer_ids:
                if transfer_id not in transfers:
                    p.add(
                        f"destinations.json link {link.from_city}->{link.to_city}: "
                        f"unknown transfer {transfer_id}"
                    )
    for departure in departure_cities:
        if departure.airport not in airports:
            p.add(f"destinations.json departure city {departure.city}: unknown airport {departure.airport}")

    if p.items:
        raise CatalogError("invalid catalog:\n- " + "\n- ".join(p.items))

    return Catalog(
        departure_cities=departure_cities,
        countries=countries,
        rules=rules,
        airports=airports,
        flights=flights,
        hotels=hotels,
        rooms=rooms,
        rooms_left=rooms_left,
        transfers=transfers,
        attractions=attractions,
    )
