"""M1: request validation. Each test breaks exactly one thing in the Menon request."""

from datetime import date

import pytest

from app.catalog.loader import load_catalog
from app.config import load_settings
from app.domain.request import RequestInvalid, parse_request


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


MENON = {
    "origin": "BLR",
    "country": "JP",
    "start_date": "2027-04-10",
    "nights": 6,
    "adults": 2,
    "children_ages": [6],
    "budget": 350000,
}


def errors_for(catalog, **patch) -> dict[str, str]:
    payload = {**MENON, **patch}
    with pytest.raises(RequestInvalid) as info:
        parse_request(payload, catalog)
    return info.value.errors


def test_menon_request_is_valid(catalog):
    request = parse_request(MENON, catalog)

    assert request.origin == "BLR"
    assert request.country == "Japan"
    assert request.start_date == date(2027, 4, 10)
    assert request.end_date == date(2027, 4, 16)
    assert request.nights == 6
    assert request.adults == 2
    assert request.children_ages == (6,)
    assert request.travelers == 3
    assert request.budget == 350000


def test_country_can_be_given_by_name(catalog):
    assert parse_request({**MENON, "country": "Japan"}, catalog).country == "Japan"


def test_children_ages_default_to_none(catalog):
    payload = {k: v for k, v in MENON.items() if k != "children_ages"}
    assert parse_request(payload, catalog).children_ages == ()


def test_every_missing_field_is_reported_at_once(catalog):
    with pytest.raises(RequestInvalid) as info:
        parse_request({}, catalog)
    assert set(info.value.errors) == {"origin", "country", "start_date", "nights", "adults", "budget"}


def test_unknown_origin(catalog):
    assert "departure city" in errors_for(catalog, origin="XXX")["origin"].lower()


def test_unknown_country(catalog):
    assert "country" in errors_for(catalog, country="France")["country"].lower()


@pytest.mark.parametrize("value", ["not-a-date", "2027-02-30", "10/04/2027", 20270410])
def test_invalid_date(catalog, value):
    assert "valid date" in errors_for(catalog, start_date=value)["start_date"].lower()


def test_start_before_first_night(catalog):
    assert "1 April 2027" in errors_for(catalog, start_date="2027-03-31")["start_date"]


def test_return_after_last_departure(catalog):
    assert "20 April 2027" in errors_for(catalog, start_date="2027-04-15")["start_date"]


def test_return_on_last_departure_day_is_fine(catalog):
    assert parse_request({**MENON, "start_date": "2027-04-14"}, catalog).end_date == date(2027, 4, 20)


@pytest.mark.parametrize("nights", [2, 11, 0, -1, 3.5, "6", None, True])
def test_nights_out_of_range_or_not_whole(catalog, nights):
    assert "between 3 and 10" in errors_for(catalog, nights=nights)["nights"]


@pytest.mark.parametrize("nights", [3, 10])
def test_boundary_nights_are_fine(catalog, nights):
    assert parse_request({**MENON, "start_date": "2027-04-05", "nights": nights}, catalog).nights == nights


@pytest.mark.parametrize("adults", [0, -1, 1.5, "2", None, True])
def test_adults_must_be_at_least_one(catalog, adults):
    assert "at least 1 adult" in errors_for(catalog, adults=adults)["adults"].lower()


@pytest.mark.parametrize("ages", [[18], [-1], [2.5], ["6"], [None], "6"])
def test_bad_child_age(catalog, ages):
    assert "children_ages" in errors_for(catalog, children_ages=ages)


def test_child_ages_0_and_17_are_fine(catalog):
    assert parse_request({**MENON, "children_ages": [0, 17]}, catalog).children_ages == (0, 17)


def test_children_count_must_match_ages(catalog):
    errors = errors_for(catalog, children=2, children_ages=[6])
    assert "children_ages" in errors


def test_more_travelers_than_any_flight_has_seats(catalog):
    max_seats = max(f.seats_left for f in catalog.flights.values())
    errors = errors_for(catalog, adults=max_seats, children_ages=[5])
    assert str(max_seats) in errors["adults"]


@pytest.mark.parametrize("budget", [0, -5, "350000", None, float("inf"), float("nan"), True])
def test_budget_must_be_a_positive_number(catalog, budget):
    assert "budget" in errors_for(catalog, budget=budget)["budget"].lower()


@pytest.mark.parametrize("value", [[], {}, ["BLR"], {"a": 1}, 7, 1.5, True])
def test_origin_and_country_that_are_not_text_are_a_validation_error_not_a_crash(catalog, value):
    assert "origin" in errors_for(catalog, origin=value)
    assert "country" in errors_for(catalog, country=value)
