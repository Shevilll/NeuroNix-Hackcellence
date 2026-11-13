"""Reservation number generation: exactly 10 digits, never a leading zero."""

import secrets
from collections.abc import Callable

MAX_ATTEMPTS = 5


class ReservationNumberError(RuntimeError):
    """Raised when a unique number could not be found within the retry budget."""


def generate_reservation_number() -> str:
    return str(secrets.randbelow(9 * 10**9) + 10**9)


def generate_unique_number(
    is_taken: Callable[[str], bool],
    generate: Callable[[], str] = generate_reservation_number,
) -> str:
    for _ in range(MAX_ATTEMPTS):
        number = generate()
        if not is_taken(number):
            return number
    raise ReservationNumberError("could not allocate a unique reservation number")
