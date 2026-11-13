"""Reservation numbers: exactly 10 digits, no leading zero, unique, collision-retried (BK-18)."""

import pytest

from app.store.reservations import (
    ReservationNumberError,
    generate_reservation_number,
    generate_unique_number,
)


def test_thousand_numbers_are_ten_digits_no_leading_zero_and_mostly_unique():
    numbers = [generate_reservation_number() for _ in range(1000)]
    assert all(len(n) == 10 and n.isdigit() and n[0] != "0" for n in numbers)
    assert len(set(numbers)) == 1000


def test_unique_number_retries_on_collision():
    taken = {"1000000001", "1000000002"}
    candidates = iter(["1000000001", "1000000002", "1000000003"])
    number = generate_unique_number(
        is_taken=lambda n: n in taken, generate=lambda: next(candidates)
    )
    assert number == "1000000003"


def test_unique_number_gives_up_after_five_attempts():
    calls = []

    def gen():
        calls.append(1)
        return "1234567890"

    with pytest.raises(ReservationNumberError):
        generate_unique_number(is_taken=lambda n: True, generate=gen)
    assert len(calls) == 5
