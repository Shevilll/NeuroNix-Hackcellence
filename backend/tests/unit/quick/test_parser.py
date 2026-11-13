"""S1: plain-words request -> form fields, by rules only (no AI)."""

from pathlib import Path

import pytest

from app.catalog.loader import load_catalog
from app.quick.parser import parse_quick_request

DATA = Path(__file__).resolve().parents[4] / "data"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


def test_menon_sentence(catalog):
    r = parse_quick_request(
        "Family of 3 from Bengaluru to Japan on 10 April 2027 for 6 nights, 2 adults and 1 child aged 6, "
        "budget ₹3,50,000", catalog)
    assert r["fields"] == {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
                           "adults": 2, "children_ages": [6], "budget": 350000}
    assert r["missing"] == []


@pytest.mark.parametrize(("text", "budget"), [
    ("budget 3.5 lakh", 350000), ("under 4 lakhs", 400000), ("₹2,00,000", 200000),
    ("budget of 250000", 250000), ("budget 3L", 300000), ("budget 80k", 80000), ("1.2 lakh INR", 120000),
])
def test_budget_formats(catalog, text, budget):
    assert parse_quick_request(text, catalog)["fields"]["budget"] == budget


@pytest.mark.parametrize(("text", "origin"), [
    ("from Delhi", "DEL"), ("leaving mumbai", "BOM"), ("from Chennai", "MAA"), ("departing BLR", "BLR"),
    ("from Bangalore", "BLR"), ("ex-Bombay", "BOM"),
])
def test_origin(catalog, text, origin):
    assert parse_quick_request(text, catalog)["fields"]["origin"] == origin


@pytest.mark.parametrize(("text", "country"), [
    ("trip to Japan", "Japan"), ("to Tokyo", "Japan"), ("visit Kyoto", "Japan"),
    ("holiday in UAE", "United Arab Emirates"), ("to Dubai", "United Arab Emirates"),
    ("Abu Dhabi trip", "United Arab Emirates"),
])
def test_country_from_name_or_city(catalog, text, country):
    assert parse_quick_request(text, catalog)["fields"]["country"] == country


@pytest.mark.parametrize(("text", "iso"), [
    ("starting 5 April", "2027-04-05"), ("on April 12th", "2027-04-12"), ("from 3rd Apr 2027", "2027-04-03"),
    ("on 2027-04-08", "2027-04-08"), ("leave on 14/04/2027", "2027-04-14"),
])
def test_dates(catalog, text, iso):
    assert parse_quick_request(text, catalog)["fields"]["start_date"] == iso


@pytest.mark.parametrize(("text", "nights"), [
    ("6 nights", 6), ("for 5 night", 5), ("a week", 7), ("one week", 7), ("a weekend", 3), ("8-night trip", 8),
    ("for 6 days", 6),
])
def test_nights(catalog, text, nights):
    assert parse_quick_request(text, catalog)["fields"]["nights"] == nights


@pytest.mark.parametrize(("text", "adults", "ages"), [
    ("2 adults and 1 child aged 6", 2, [6]),
    ("2 adults, 2 kids aged 4 and 9", 2, [4, 9]),
    ("couple", 2, []),
    ("solo trip", 1, []),
    ("3 adults", 3, []),
    ("me and my wife and our daughter, 7", 2, [7]),
    ("2 adults with children aged 3, 5 and 11", 2, [3, 5, 11]),
    ("family of 4 with 2 kids 8 and 10", 2, [8, 10]),
])
def test_travellers(catalog, text, adults, ages):
    fields = parse_quick_request(text, catalog)["fields"]
    assert fields["adults"] == adults
    assert fields.get("children_ages", []) == ages


def test_reports_what_is_missing_and_never_guesses(catalog):
    r = parse_quick_request("somewhere warm please", catalog)
    assert r["fields"] == {}
    assert set(r["missing"]) == {"origin", "country", "start_date", "nights", "adults", "budget"}


def test_child_without_age_is_flagged(catalog):
    r = parse_quick_request("2 adults and 1 child to Japan", catalog)
    assert "children_ages" in r["missing"] or "children_ages" in r["unclear"]


@pytest.mark.parametrize("text,count", [
    ("departure from delhi and destination is uae, start date is 11 april 2027, for 5 nights, "
     "1 adult and 2 children, and the budget is 5 lakh", 2),
    ("2 adults and two kids from Mumbai to Japan", 2),
    ("2 adults and a child to Japan", 1),
    ("2 adults with 3 kids", 3),
])
def test_children_count_is_kept_when_ages_are_missing(catalog, text, count):
    r = parse_quick_request(text, catalog)
    assert r["fields"]["children_count"] == count
    assert "children_ages" not in r["fields"]
    assert "children_ages" in r["unclear"]


def test_no_children_count_when_ages_are_given(catalog):
    r = parse_quick_request("2 adults and 2 kids aged 4 and 9", catalog)
    assert r["fields"]["children_ages"] == [4, 9]
    assert "children_count" not in r["fields"]


def test_garbage_input_is_safe(catalog):
    assert parse_quick_request("", catalog)["fields"] == {}
    assert parse_quick_request("🎉" * 50 + " 99999999999 nights", catalog)["fields"].get("nights") is None


@pytest.mark.parametrize(("text", "adults", "ages"), [
    ("2 adults and a 6 year old", 2, [6]),
    ("2 adults and a 6-year-old", 2, [6]),
    ("2 adults with a 4 yr old and a 9 year old", 2, [4, 9]),
    ("2 adults, kids 7 yrs and 10 yrs", 2, [7, 10]),
])
def test_year_old_phrases(catalog, text, adults, ages):
    fields = parse_quick_request(text, catalog)["fields"]
    assert fields["adults"] == adults and fields["children_ages"] == ages


def test_menon_in_natural_words(catalog):
    r = parse_quick_request("2 adults and a 6 year old from Bengaluru to Japan 10 April, 6 nights, budget 3.5 lakh", catalog)
    assert r["fields"]["children_ages"] == [6] and r["fields"]["nights"] == 6 and r["missing"] == []


# ----- Sentences as a browser's speech-to-text writes them (voice input feeds this same parser)


@pytest.mark.parametrize(("text", "budget"), [
    ("budget 3 lakh 50 thousand", 350000), ("budget 3 lakh 50,000", 350000), ("budget 3 lakh and 50 thousand", 350000),
    ("budget three and a half lakh", 350000), ("budget two lakh", 200000), ("budget 350 thousand", 350000),
    ("budget 2 lakh rupees", 200000),
])
def test_spoken_budgets(catalog, text, budget):
    assert parse_quick_request(text, catalog)["fields"]["budget"] == budget


@pytest.mark.parametrize(("text", "ages"), [
    ("2 adults and one child aged six", [6]), ("2 adults, children aged six and nine", [6, 9]),
    ("2 adults and one kid of age 7", [7]), ("2 adults and a six year old", [6]),
    ("two adults and two kids aged 4 and 12", [4, 12]),
])
def test_spoken_child_ages(catalog, text, ages):
    r = parse_quick_request(text, catalog)
    assert r["fields"]["children_ages"] == ages
    assert r["fields"]["adults"] == 2
    assert r["unclear"] == []


def test_spoken_menon_sentence(catalog):
    r = parse_quick_request(
        "two adults and one child aged six from Bangalore to Japan on the tenth of April for six nights "
        "with a budget of three and a half lakh", catalog)
    assert r["fields"] == {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
                           "adults": 2, "children_ages": [6], "budget": 350000}


def test_spoken_numbers_keep_weeks_and_families(catalog):
    assert parse_quick_request("one week", catalog)["fields"]["nights"] == 7
    assert parse_quick_request("two weeks", catalog)["fields"]["nights"] == 14
    r = parse_quick_request("a family of four with two kids aged 5 and 8", catalog)
    assert r["fields"]["adults"] == 2
    assert r["fields"]["children_ages"] == [5, 8]
