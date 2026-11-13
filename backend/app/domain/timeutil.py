"""Clock-time helpers (DATA_DICTIONARY §5).

Clock times are minutes after midnight. "24:00" is 1440. A window whose end is smaller than its
start runs past midnight (06:00-00:30). Both ends of a window are included.
Values above 1440 mean "on a later day" (1440 + 75 = 01:15 the next day).
"""

from __future__ import annotations

import re
from datetime import date

DAY_MINUTES = 1440
_CLOCK = re.compile(r"^(\d{2}):(\d{2})$")
_WEEKDAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def parse_clock(text: str) -> int:
    match = _CLOCK.match(text)
    if not match:
        raise ValueError(f"bad clock time: {text!r}")
    hours, minutes = int(match.group(1)), int(match.group(2))
    if minutes > 59 or hours > 24 or (hours == 24 and minutes != 0):
        raise ValueError(f"bad clock time: {text!r}")
    return hours * 60 + minutes


def format_clock(minutes: int) -> str:
    if minutes == DAY_MINUTES:
        return "24:00"
    minutes %= DAY_MINUTES
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def in_window(minute: int, start: int, end: int) -> bool:
    """Is a clock time (0..1440) inside the window, ends included, wrap-aware?"""
    if start <= end:
        return start <= minute <= end
    return minute >= start or minute <= end


def earliest_in_window(minute: int, start: int, end: int) -> int:
    """Earliest time >= `minute` inside the window. May exceed 1440 (next day)."""
    base, clock = (minute // DAY_MINUTES) * DAY_MINUTES, minute % DAY_MINUTES
    if in_window(clock, start, end):
        return minute
    if clock <= start:
        return base + start
    return base + DAY_MINUTES + start


def weekday_code(day: date) -> str:
    return _WEEKDAYS[day.weekday()]
