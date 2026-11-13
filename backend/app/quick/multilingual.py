"""S1 in many languages, by rules only (no AI, no translation service).

A request typed in an Indian language is first rewritten into the plain English words the S1 parser
already reads: digits become 0-9, place names, months, number words and words like "nights",
"adults" and "lakh" become their English forms, and "<city> से" becomes "from <city>". The parser
then fills the form exactly as it does for English. The detected language is returned so the app
can answer in the same language. English text is passed through untouched.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.catalog.loader import Catalog
from app.quick import lexicon as lx
from app.quick.parser import REQUIRED, parse_quick_request

# Language code -> its own name. English plus 13 Indian languages (the home languages of the four
# departure cities' states and the other major regions).
SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English", "hi": "हिन्दी", "bn": "বাংলা", "te": "తెలుగు", "mr": "मराठी", "ta": "தமிழ்", "gu": "ગુજરાતી",
    "ur": "اردو", "kn": "ಕನ್ನಡ", "ml": "മലയാളം", "or": "ଓଡ଼ିଆ", "pa": "ਪੰਜਾਬੀ", "as": "অসমীয়া",
}

# Unicode script name -> the language we assume when it is the only clue.
_SCRIPT_LANGUAGE = {
    "DEVANAGARI": "hi", "BENGALI": "bn", "GURMUKHI": "pa", "GUJARATI": "gu", "ORIYA": "or", "TAMIL": "ta",
    "TELUGU": "te", "KANNADA": "kn", "MALAYALAM": "ml", "ARABIC": "ur",
}

# A "word" character: letters and digits plus the combining marks that Indian scripts hang on letters.
_W = r"[\wऀ-ॣ॥-෿ً-ٟ]"
_ASSAMESE_LETTERS = "ৰৱ"
_URDU_LETTERS = "ٹڈڑںےھہۓ"


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def _script_of(ch: str) -> str:
    try:
        return unicodedata.name(ch).split()[0]
    except ValueError:
        return ""


def _words(text: str) -> set[str]:
    return set(re.findall(r"[\wऀ-ॣ॥-෿]+", _nfc(text).lower()))


def detect_language(text: str) -> dict[str, Any]:
    """Which language the request is written in: ``{"language", "script", "supported"}``.

    The script settles most languages. Marathi vs Hindi (both Devanagari), Assamese vs Bengali, and
    Hindi typed in English letters are told apart by a few telltale words and letters.
    """
    text = _nfc(text or "")
    counts: dict[str, int] = {}
    for ch in text:
        if ch.isalpha():
            script = _script_of(ch)
            counts[script] = counts.get(script, 0) + 1
    total = sum(counts.values())
    if not total:
        return {"language": "en", "script": "latin", "supported": True}

    indic = {s: n for s, n in counts.items() if s in _SCRIPT_LANGUAGE}
    other = {s: n for s, n in counts.items() if s not in _SCRIPT_LANGUAGE and s != "LATIN"}
    if indic and max(indic.values()) >= max(3, total * 0.2):
        script = max(indic, key=lambda s: indic[s])
        language = _SCRIPT_LANGUAGE[script]
        words = _words(text)
        if script == "DEVANAGARI":
            language = "mr" if len(words & lx.MARATHI_MARKERS) > len(words & lx.HINDI_MARKERS) else "hi"
        elif script == "BENGALI" and (any(c in text for c in _ASSAMESE_LETTERS) or words & lx.ASSAMESE_MARKERS):
            language = "as"
        elif script == "ARABIC" and not any(c in text for c in _URDU_LETTERS):
            return {"language": "und", "script": script.lower(), "supported": False}
        return {"language": language, "script": script.lower(), "supported": True}
    if other and sum(other.values()) > counts.get("LATIN", 0):
        return {"language": "und", "script": max(other, key=lambda s: other[s]).lower(), "supported": False}
    if len(_words(text) & lx.ROMANIZED_HINDI_MARKERS) >= 3:
        return {"language": "hi", "script": "latin", "supported": True}
    return {"language": "en", "script": "latin", "supported": True}


# ---- building the rewriting rules once -------------------------------------------------------

def _alternatives(spellings: list[str]) -> str:
    return "|".join(re.escape(s) for s in sorted({_nfc(s) for s in spellings}, key=len, reverse=True))


def _entries(table: dict[Any, list[str]], *, strict_short: bool = False, always_strict: bool = False):
    """(spelling, replacement, strict) for every spelling. A strict spelling only matches a whole word."""
    for replacement, spellings in table.items():
        for s in spellings:
            s = _nfc(s)
            strict = always_strict or s.isascii() or (strict_short and len(s) <= 2)
            yield s.lower(), replacement, strict


def _compile(entries: list[tuple[str, Any, bool]], *, latin: bool) -> tuple[re.Pattern[str], dict[str, Any]]:
    entries = [e for e in entries if e[0].isascii() == latin]
    entries.sort(key=lambda e: len(e[0]), reverse=True)
    lookup = {spelling: replacement for spelling, replacement, _ in entries}
    parts = [re.escape(s) + (f"(?!{_W})" if strict else "") for s, _, strict in entries]
    return re.compile(f"(?<!{_W})(?:" + "|".join(parts) + ")", re.I), lookup


_PLACES = {**lx.ORIGINS, **lx.DESTINATIONS}
_ALL_ENTRIES = (
    list(_entries(_PLACES))
    + list(_entries(lx.MONTHS, strict_short=True))
    + list(_entries({str(n): words for n, words in lx.NUMBERS.items()}, always_strict=True))
    + list(_entries(lx.WORDS))
    + list(_entries(lx.JOINERS, always_strict=True))
    + [("জন", "", True)]  # Bengali and Assamese counting word: "২ জন প্রাপ্তবয়স্ক" is "2 adults"
)
_NATIVE, _NATIVE_LOOKUP = _compile(_ALL_ENTRIES, latin=False)
_ROMAN, _ROMAN_LOOKUP = _compile(_ALL_ENTRIES, latin=True)

_ORIGIN_SPELLINGS = {_nfc(s).lower(): city for city, names in lx.ORIGINS.items() for s in names}
_ORIGIN_SPELLINGS |= {"bengaluru": "Bengaluru", "bangalore": "Bengaluru", "delhi": "Delhi", "mumbai": "Mumbai",
                      "bombay": "Mumbai", "chennai": "Chennai", "madras": "Chennai"}
_FROM = _alternatives(lx.FROM_WORDS)
_ORIGIN_NATIVE = re.compile(
    f"(?<!{_W})({_alternatives([s for s in _ORIGIN_SPELLINGS if not s.isascii()])})\\S{{0,4}}?\\s*(?:{_FROM})(?!{_W})")
_ORIGIN_ROMAN = re.compile(
    f"(?<!{_W})({_alternatives([s for s in _ORIGIN_SPELLINGS if s.isascii()])})\\s+se(?!{_W})", re.I)

_HALF = re.compile(f"(?:{_alternatives(lx.HALF_BEFORE)})\\s*(\\d+)")
_ONE_HALF = re.compile(f"(?<!{_W})(?:{_alternatives(lx.ONE_AND_HALF)})(?!{_W})")
_TWO_HALF = re.compile(f"(?<!{_W})(?:{_alternatives(lx.TWO_AND_HALF)})(?!{_W})")
_ROMAN_TWO = re.compile(r"(?<!\w)do(?=\s+(?:adults?|vayask|bade|bachch\w*|bacche|baccha|raat\w*|din|hafte?)\b)", re.I)

# "4 and 9 years old" is two children, one age each: the parser reads "<number> years old" one at a time.
_AGE_LIST = re.compile(r"(?<![\d.])(\d{1,2})((?:\s*(?:,|and|&)\s*\d{1,2})+)\s+years old")

_PUNCTUATION = str.maketrans({"।": ".", "॥": ".", "،": ",", "؟": "?", "۔": ".", "؛": ";"})


def _ascii_digits(text: str) -> str:
    return "".join(str(unicodedata.decimal(ch)) if ch.isdecimal() and not ch.isascii() else ch for ch in text)


def normalize(text: str, *, romanized: bool = False) -> str:
    """Rewrite a native-language request into the English words the S1 parser reads."""
    text = _ascii_digits(_nfc(text)).translate(_PUNCTUATION)
    # "10న", "10 अप्रैल": keep a number apart from the word or suffix stuck to it.
    text = re.sub(r"(?<=\d)(?=[؀-ۿऀ-෿])", " ", text)
    if romanized:
        text = _ORIGIN_ROMAN.sub(lambda m: f" from {_ORIGIN_SPELLINGS[m.group(1).lower()]} ", text)
        text = _ROMAN_TWO.sub(" 2 ", text)
        pattern, lookup = _ROMAN, _ROMAN_LOOKUP
    else:
        text = _ORIGIN_NATIVE.sub(lambda m: f" from {_ORIGIN_SPELLINGS[m.group(1).lower()]} ", text)
        pattern, lookup = _NATIVE, _NATIVE_LOOKUP
    text = pattern.sub(lambda m: f" {lookup[m.group(0).lower()]} ", text)
    text = _HALF.sub(lambda m: f"{m.group(1)}.5", text)
    text = _ONE_HALF.sub("1.5", text)
    text = _TWO_HALF.sub("2.5", text)
    text = _AGE_LIST.sub(lambda m: " and ".join(f"{n} years old" for n in [m.group(1), *re.findall(r"\d+", m.group(2))]), text)
    return re.sub(r"[ \t]+", " ", text).strip()


def parse_multilingual(text: str, catalog: Catalog) -> dict[str, Any]:
    """Fill the form from a request in any supported language. Adds ``language``, ``script`` and
    ``supported`` to the parser's result (``supported`` is False for a script we cannot read)."""
    info = detect_language(text)
    if not info["supported"]:
        return {"fields": {}, "missing": list(REQUIRED), "unclear": [], **info}
    if info["language"] == "en":
        result = parse_quick_request(text, catalog)
    else:
        result = parse_quick_request(normalize(text, romanized=info["script"] == "latin"), catalog)
    return {**result, **info}
