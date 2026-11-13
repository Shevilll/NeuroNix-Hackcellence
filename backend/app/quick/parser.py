"""S1 quick request: read a short plain-words request with rules and fill the form fields.

No AI: regular expressions and word lists only. The parser never guesses. A field it cannot
find is reported in ``missing`` so the traveler fills it in; the form still validates everything.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from app.catalog.loader import Catalog

NUMBER_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                "eight": 8, "nine": 9, "ten": 10}
_NUM = r"(\d{1,3}|" + "|".join(k for k in NUMBER_WORDS if k not in ("a", "an")) + r")"
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
ORIGIN_ALIASES = {"bangalore": "BLR", "bengaluru": "BLR", "bombay": "BOM", "madras": "MAA", "new delhi": "DEL"}
COUNTRY_ALIASES = {"uae": "United Arab Emirates", "emirates": "United Arab Emirates",
                   "united arab emirates": "United Arab Emirates"}
CHILD_WORDS = r"(?:children|child|kids?|sons?|daughters?|babies|baby|toddlers?|infants?)"

REQUIRED = ("origin", "country", "start_date", "nights", "adults", "budget")


def _num(text: str) -> int:
    return int(text) if text.isdigit() else NUMBER_WORDS[text]


def _cut(text: str, span: tuple[int, int]) -> str:
    return text[: span[0]] + " " * (span[1] - span[0]) + text[span[1]:]


def _budget(text: str) -> tuple[int | None, str]:
    cue = r"(?:budget|under|within|upto|up to|max(?:imum)?|around|about)?\s*(?:of|is|:)?\s*"
    pattern = re.compile(
        cue + r"(₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|l|k)?\b", re.I)
    for m in pattern.finditer(text):
        word = text[m.start():m.end()].lower()
        symbol, raw, unit = m.group(1), m.group(2), (m.group(3) or "").lower()
        has_cue = any(w in word for w in ("budget", "under", "within", "upto", "up to", "max", "around", "about"))
        if not (symbol or unit or has_cue):
            continue
        value = float(raw.replace(",", ""))
        if unit in ("lakh", "lakhs", "lac", "lacs", "l"):
            value *= 100_000
        elif unit in ("crore", "crores", "cr"):
            value *= 10_000_000
        elif unit == "k":
            value *= 1_000
        elif not (symbol or has_cue):
            continue
        if value < 1_000:  # a bare "6" after "budget" is almost surely not rupees
            continue
        return int(round(value)), _cut(text, m.span())
    return None, text


def _date(text: str, year: int) -> tuple[str | None, str]:
    tries = [
        (r"\b(\d{4})-(\d{2})-(\d{2})\b", lambda g: (int(g[0]), int(g[1]), int(g[2]))),
        (r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", lambda g: (int(g[2]), int(g[1]), int(g[0]))),
        (r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MONTH + r"\b(?:,?\s+(\d{4}))?",
         lambda g: (int(g[2]) if g[2] else year, MONTHS[g[1][:3].lower()], int(g[0]))),
        (r"\b" + _MONTH + r"\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?",
         lambda g: (int(g[2]) if g[2] else year, MONTHS[g[0][:3].lower()], int(g[1]))),
    ]
    for pattern, build in tries:
        for m in re.finditer(pattern, text, re.I):
            try:
                y, mo, d = build(m.groups())
                return date(y, mo, d).isoformat(), _cut(text, m.span())
            except (ValueError, KeyError):
                continue
    return None, text


def _nights(text: str) -> tuple[int | None, str]:
    m = re.search(r"\b" + _NUM + r"\s*-?\s*(?:nights?|days?)\b", text, re.I)
    if m:
        return _num(m.group(1).lower()), _cut(text, m.span())
    m = re.search(r"\b(a|one|two)\s+weeks?\b", text, re.I)
    if m:
        return 7 * NUMBER_WORDS[m.group(1).lower()], _cut(text, m.span())
    m = re.search(r"\bweekend\b", text, re.I)
    if m:
        return 3, _cut(text, m.span())
    return None, text


def _origin(text: str, catalog: Catalog) -> str | None:
    aliases = {c.city.lower(): c.airport for c in catalog.departure_cities} | ORIGIN_ALIASES
    found: list[tuple[int, str]] = []
    for alias, code in aliases.items():
        for m in re.finditer(r"\b" + re.escape(alias) + r"\b", text, re.I):
            found.append((m.start(), code))
    for c in catalog.departure_cities:
        for m in re.finditer(r"\b" + c.airport + r"\b", text):
            found.append((m.start(), c.airport))
    if not found:
        return None
    for pos, code in sorted(found):
        before = text[max(0, pos - 20):pos].lower()
        if re.search(r"(from|leaving|departing|depart|ex[- ]?|starting)\s*$", before):
            return code
    return sorted(found)[0][1]


def _country(text: str, catalog: Catalog) -> str | None:
    names = {c.name.lower(): c.name for c in catalog.countries.values()} | COUNTRY_ALIASES
    for country in catalog.countries.values():
        for city in country.city_names:
            names[city.lower()] = country.name
    hits = [(m.start(), name) for alias, name in names.items()
            for m in re.finditer(r"\b" + re.escape(alias) + r"\b", text, re.I)]
    return sorted(hits)[0][1] if hits else None


def _children(text: str) -> tuple[list[int] | None, bool, str]:
    """Returns (ages, mentioned, text). ages is None when children are mentioned without ages."""
    if not re.search(r"\b" + CHILD_WORDS + r"\b", text, re.I):
        return None, False, text
    ages: list[int] = []
    for m in re.finditer(r"\b" + CHILD_WORDS + r"\b[\s,]*(?:aged?|of|who are|is|are)?[\s:,]*"
                         r"(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)\b(?!\s*(?:nights?|days?|adults?|lakhs?|k\b|l\b))",
                         text, re.I):
        ages += [int(n) for n in re.findall(r"\d+", m.group(1))]
        text = _cut(text, m.span(1))
    return (ages or None), True, text


def _adults(text: str) -> int | None:
    m = re.search(r"\b" + _NUM + r"\s+adults?\b", text, re.I)
    if m:
        return _num(m.group(1).lower())
    if re.search(r"\b(couple|me and my (?:wife|husband|partner|spouse))\b", text, re.I):
        return 2
    if re.search(r"\b(solo|alone|just me|myself)\b", text, re.I):
        return 1
    return None


def parse_quick_request(text: str, catalog: Catalog) -> dict[str, Any]:
    text = (text or "")[:1000]
    fields: dict[str, Any] = {}
    year = catalog.rules.first_night.year

    if (origin := _origin(text, catalog)):
        fields["origin"] = origin
    if (country := _country(text, catalog)):
        fields["country"] = country
    budget, rest = _budget(text)
    if budget is not None:
        fields["budget"] = budget
    start, rest = _date(rest, year)
    if start:
        fields["start_date"] = start
    nights, rest = _nights(rest)
    if nights is not None:
        fields["nights"] = nights

    ages, kids_mentioned, rest = _children(rest)
    adults = _adults(rest)
    if adults is None:
        family = re.search(r"\bfamily of " + _NUM, rest, re.I)
        if family and ages:
            adults = max(1, _num(family.group(1).lower()) - len(ages))
    if adults is not None:
        fields["adults"] = adults
    unclear: list[str] = []
    if ages:
        fields["children_ages"] = ages
    elif kids_mentioned:
        unclear.append("children_ages")
    elif adults is not None:
        fields["children_ages"] = []

    missing = [k for k in REQUIRED if k not in fields]
    return {"fields": fields, "missing": missing + unclear[:0], "unclear": unclear}
