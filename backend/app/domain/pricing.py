"""Every price formula from the problem statement. All amounts are whole rupees.

A missing child price (None) means children pay the adult price; 0 means free.
Always test `is None`, never truthiness.
"""

from __future__ import annotations

from typing import Protocol


class _TransferPricing(Protocol):
    pricing: str
    price: int
    child_price: int | None
    max_passengers: int


class _AttractionPricing(Protocol):
    price_per_person: int
    child_price: int | None


def flight_cost(price_per_seat: int, travelers: int) -> int:
    return price_per_seat * travelers


def hotel_cost(price_per_night: int, rooms: int, nights: int) -> int:
    return price_per_night * rooms * nights


def per_person_cost(adults: int, children: int, price: int, child_price: int | None) -> int:
    child = price if child_price is None else child_price
    return adults * price + children * child


def vehicles_needed(travelers: int, max_passengers: int) -> int:
    return -(-travelers // max_passengers)  # ceiling division


def transfer_cost(transfer: _TransferPricing, adults: int, children: int) -> int:
    if transfer.pricing == "PER_PERSON":
        return per_person_cost(adults, children, transfer.price, transfer.child_price)
    if transfer.pricing == "PER_VEHICLE":
        return transfer.price * vehicles_needed(adults + children, transfer.max_passengers)
    raise ValueError(f"unknown transfer pricing: {transfer.pricing!r}")


def attraction_cost(attraction: _AttractionPricing, adults: int, children: int) -> int:
    return per_person_cost(adults, children, attraction.price_per_person, attraction.child_price)
