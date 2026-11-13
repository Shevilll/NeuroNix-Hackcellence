"""Typed, read-only catalog records.

Conventions (DATA_DICTIONARY §5):
- Prices are whole rupees, stored as ``int`` (the INR currency is checked by the loader).
- Clock times ("HH:MM") are stored as minutes after midnight; "24:00" is 1440.
  A window whose end is smaller than its start runs past midnight (e.g. 06:00-00:30 -> 360, 30).
- Timestamps are naive ``datetime`` values in the local time of the place.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True, slots=True)
class DepartureCity:
    airport: str
    city: str


@dataclass(frozen=True, slots=True)
class City:
    name: str
    airports: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Link:
    from_city: str
    to_city: str
    transfer_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Country:
    code: str
    name: str
    timezone: str
    cities: tuple[City, ...]
    links: tuple[Link, ...]

    @property
    def city_names(self) -> tuple[str, ...]:
        return tuple(city.name for city in self.cities)


@dataclass(frozen=True, slots=True)
class Rules:
    min_nights: int
    max_nights: int
    min_nights_per_city: int
    first_night: date
    last_departure: date


@dataclass(frozen=True, slots=True)
class Airport:
    code: str
    name: str
    city: str
    country: str
    timezone: str
    lat: float
    lng: float
    serves_cities: frozenset[str]


@dataclass(frozen=True, slots=True)
class Flight:
    flight_id: str
    airline: str
    flight_number: str
    origin: str
    destination: str
    departure_local: datetime
    arrival_local: datetime
    stops: int
    duration_minutes: int
    price_per_seat: int
    seats_left: int
    cabin: str


@dataclass(frozen=True, slots=True)
class Hotel:
    hotel_id: str
    name: str
    city: str
    area: str
    lat: float
    lng: float
    rating: float
    stars: int
    check_in_from: int
    check_out_until: int
    family_friendly: bool
    image: str | None


@dataclass(frozen=True, slots=True)
class Room:
    room_id: str
    hotel_id: str
    room_type: str
    name: str
    max_adults: int
    max_children: int
    price_per_night: int
    refundable: bool


@dataclass(frozen=True, slots=True)
class Transfer:
    transfer_id: str
    type: str
    name: str
    airport: str | None
    city: str | None
    area: str | None
    from_city: str | None
    to_city: str | None
    from_point: str | None
    to_point: str | None
    max_passengers: int
    service_from: int
    service_until: int
    frequency_minutes: int | None
    duration_minutes: int
    pricing: str  # "PER_PERSON" or "PER_VEHICLE"
    price: int
    child_price: int | None  # None = no child price (children pay `price`); 0 = free
    door_to_door: bool | None

    @property
    def is_airport_transfer(self) -> bool:
        return self.type.startswith("AIRPORT_")

    @property
    def is_intercity(self) -> bool:
        return self.from_city is not None and self.to_city is not None


@dataclass(frozen=True, slots=True)
class Attraction:
    attraction_id: str
    name: str
    name_ja: str | None
    city: str
    category: str
    lat: float
    lng: float
    open_days: frozenset[str]  # "MON" ... "SUN"
    open_from: int
    open_until: int
    closed_dates: frozenset[date]
    visit_minutes: int
    child_friendly: bool
    accessible: bool
    price_per_person: int
    child_price: int | None  # None = no child price (children pay adult price); 0 = free
    aliases: tuple[str, ...]
    image: str | None
