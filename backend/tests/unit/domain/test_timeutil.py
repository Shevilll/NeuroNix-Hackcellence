"""Time helpers: HH:MM parsing, 24:00, wrap-past-midnight windows, inclusive ends, weekdays.

Covers sheet cases TL-01..05, TL-08..12, TL-14..16 at the helper level.
"""

from datetime import date

import pytest

from app.domain.timeutil import (
    earliest_in_window,
    format_clock,
    in_window,
    parse_clock,
    weekday_code,
)


@pytest.mark.parametrize(
    ("text", "minutes"),
    [("00:00", 0), ("00:30", 30), ("06:00", 360), ("23:59", 1439), ("24:00", 1440)],
)
def test_parse_clock(text, minutes):
    assert parse_clock(text) == minutes


@pytest.mark.parametrize("text", ["", "6:00", "25:00", "24:01", "12:60", "ab:cd", "12-30"])
def test_parse_clock_rejects_bad_text(text):
    with pytest.raises(ValueError):
        parse_clock(text)


def test_format_clock_round_trip():
    for text in ("00:00", "09:05", "23:59", "24:00"):
        assert format_clock(parse_clock(text)) == text


def test_format_clock_wraps_next_day():
    assert format_clock(1440 + 75) == "01:15"


def test_plain_window_includes_both_ends():
    start, end = parse_clock("06:00"), parse_clock("23:00")
    assert in_window(parse_clock("06:00"), start, end)
    assert in_window(parse_clock("23:00"), start, end)
    assert not in_window(parse_clock("05:59"), start, end)
    assert not in_window(parse_clock("23:01"), start, end)


def test_all_day_window_with_24_00():
    start, end = parse_clock("00:00"), parse_clock("24:00")
    for t in (0, 1, 720, 1439, 1440):
        assert in_window(t, start, end)


def test_wrap_window_runs_past_midnight():
    start, end = parse_clock("06:00"), parse_clock("00:30")
    assert in_window(parse_clock("06:00"), start, end)
    assert in_window(parse_clock("23:59"), start, end)
    assert in_window(parse_clock("00:00"), start, end)
    assert in_window(parse_clock("00:30"), start, end)
    assert not in_window(parse_clock("00:31"), start, end)
    assert not in_window(parse_clock("05:59"), start, end)


def test_earliest_in_window_already_inside():
    assert earliest_in_window(600, 360, 1380) == 600


def test_earliest_in_window_waits_for_opening_same_day():
    assert earliest_in_window(240, 360, 1380) == 360  # 04:00 -> 06:00


def test_earliest_in_window_after_close_rolls_to_next_day():
    assert earliest_in_window(1400, 360, 1380) == 1440 + 360  # 23:20 -> 06:00 next day


def test_earliest_in_window_wrap_window_gap():
    # 06:00-00:30 window, 02:00 is in the gap -> 06:00
    assert earliest_in_window(120, 360, 30) == 360


def test_earliest_in_window_wrap_window_after_midnight_is_open():
    assert earliest_in_window(15, 360, 30) == 15


def test_earliest_in_window_on_next_day_offset():
    assert earliest_in_window(1440 + 240, 360, 1380) == 1440 + 360


@pytest.mark.parametrize(
    ("day", "code"),
    [
        (date(2027, 4, 10), "SAT"),  # known anchor: 10 Apr 2027 is a Saturday
        (date(2027, 4, 11), "SUN"),
        (date(2027, 4, 12), "MON"),
        (date(2027, 4, 13), "TUE"),
        (date(2027, 4, 14), "WED"),
        (date(2027, 4, 15), "THU"),
        (date(2027, 4, 16), "FRI"),
    ],
)
def test_weekday_code(day, code):
    assert weekday_code(day) == code
