"""M2 / M8: say why there is no package, and what to change. Suggestions are never guesses: each one
was solved for real and either fits the budget (M8) or produces a package (M2)."""

from dataclasses import replace
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.catalog.loader import load_catalog
from app.config import load_settings
from app.domain.request import TripRequest
from app.main import create_app
from app.planner.builder import build_package
from app.planner.diagnostics import inr


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


def req(origin="BLR", country="Japan", start=date(2027, 4, 10), nights=6, adults=2, children=(6,), budget=350000):
    return TripRequest(origin, country, start, nights, adults, tuple(children), budget)


def codes(result):
    return [r["code"] for r in result["reasons"]]


# ------------------------------------------------------------ inr formatting


@pytest.mark.parametrize("amount,text", [(0, "₹0"), (999, "₹999"), (1000, "₹1,000"), (100000, "₹1,00,000"),
                                          (350000, "₹3,50,000"), (12345678, "₹1,23,45,678")])
def test_rupees_use_indian_grouping(amount, text):
    assert inr(amount) == text


# ------------------------------------------------------------ M2: reasons


def test_no_arrival_flight_names_the_city_and_the_day(catalog):
    result = build_package(req(origin="DEL", start=date(2027, 4, 4), nights=3, children=()), catalog)
    assert result["status"] == "NO_PACKAGE"
    reason = next(r for r in result["reasons"] if r["code"] == "NO_ARRIVAL_FLIGHT")
    assert "Delhi" in reason["message"] and "4 Apr 2027" in reason["message"] and "Japan" in reason["message"]


def test_no_return_flight_names_the_return_day(catalog):
    result = build_package(req(origin="DEL", start=date(2027, 4, 10), nights=3, children=()), catalog)
    reason = next(r for r in result["reasons"] if r["code"] == "NO_RETURN_FLIGHT")
    assert "13 Apr 2027" in reason["message"]


def test_seat_shortage_is_reported_for_arrival_and_return_separately(catalog):
    result = build_package(req(start=date(2027, 4, 4), nights=3, adults=7, children=(3, 4)), catalog)
    assert result["status"] == "NO_PACKAGE"
    assert {"NOT_ENOUGH_SEATS", "NOT_ENOUGH_SEATS_RETURN"} <= set(codes(result))
    arrival = next(r for r in result["reasons"] if r["code"] == "NOT_ENOUGH_SEATS")
    assert "9" in arrival["message"]


def test_reason_codes_are_unique_so_the_ui_can_key_on_them(catalog):
    for start in (date(2027, 4, 4), date(2027, 4, 10)):
        result = build_package(req(origin="DEL", start=start, nights=3, adults=7, children=(3, 4)), catalog)
        if result["status"] == "NO_PACKAGE":
            assert len(codes(result)) == len(set(codes(result)))


def test_flights_that_do_not_connect_are_explained_not_called_a_mystery(catalog):
    """9 travelers: only Tokyo has a 9-seat arrival, only Osaka/Kyoto has a 9-seat return, 3 nights is too short."""
    result = build_package(req(nights=3, adults=7, children=(3, 4)), catalog)
    assert result["status"] == "NO_PACKAGE"
    assert codes(result) == ["FLIGHTS_DONT_CONNECT"]
    message = result["reasons"][0]["message"]
    assert "Tokyo" in message and ("Osaka" in message or "Kyoto" in message) and "2 nights" in message


def test_every_unexplained_failure_is_rare(catalog):
    """NO_VALID_COMBINATION is the last resort; across a grid it must not be the common answer."""
    seen = {}
    for origin in ("BLR", "DEL", "BOM", "MAA"):
        for country in ("Japan", "United Arab Emirates"):
            for start in (date(2027, 4, 1), date(2027, 4, 5), date(2027, 4, 10), date(2027, 4, 14)):
                for adults, kids in ((2, ()), (2, (6,)), (4, (5, 8)), (7, (3, 4))):
                    result = build_package(req(origin, country, start, 4, adults, kids, 10**7), catalog)
                    if result["status"] == "NO_PACKAGE":
                        for c in codes(result):
                            seen[c] = seen.get(c, 0) + 1
                        assert all(r["message"] for r in result["reasons"])
    assert seen.get("NO_VALID_COMBINATION", 0) <= 0.1 * sum(seen.values())


# ------------------------------------------------------------ M2: nearby options


def test_no_package_offers_nearby_dates_that_really_work(catalog):
    request = req(origin="DEL", start=date(2027, 4, 4), nights=3, children=())
    result = build_package(request, catalog)
    nearby = result["nearby"]
    assert 1 <= len(nearby) <= 5
    for option in nearby:
        assert set(option) >= {"kind", "start_date", "end_date", "nights", "total_inr", "within_budget", "message"}
        variant = replace(request, start_date=date.fromisoformat(option["start_date"]), nights=option["nights"])
        solved = build_package(variant, catalog, explain=False)
        assert solved["status"] in ("OK", "OVER_BUDGET")
        assert option["within_budget"] == (solved["status"] == "OK")
        assert option["end_date"] == variant.end_date.isoformat()
        assert inr(option["total_inr"]) in option["message"]


def test_nearby_options_are_sorted_nearest_first_and_inside_the_data_window(catalog):
    request = req(origin="DEL", start=date(2027, 4, 4), nights=3, children=())
    nearby = build_package(request, catalog)["nearby"]
    distance = [abs((date.fromisoformat(o["start_date"]) - request.start_date).days) + abs(o["nights"] - request.nights)
                for o in nearby]
    assert distance == sorted(distance)
    for o in nearby:
        assert date(2027, 4, 1) <= date.fromisoformat(o["start_date"])
        assert date.fromisoformat(o["end_date"]) <= date(2027, 4, 20)
        assert 3 <= o["nights"] <= 10


def test_explain_false_skips_all_explanations(catalog):
    request = req(origin="DEL", start=date(2027, 4, 4), nights=3, children=())
    solved = build_package(request, catalog, explain=False)
    assert solved["status"] == "NO_PACKAGE"
    assert "nearby" not in solved and "reasons" not in solved


# ------------------------------------------------------------ M8: over budget


def cheapest_total(catalog, request):
    solved = build_package(replace(request, budget=10**8), catalog)
    return solved["alternatives"]["cheapest"]["total_inr"] if solved["status"] == "OK" else None


def test_over_budget_always_ends_with_how_much_to_raise_the_budget(catalog):
    result = build_package(req(budget=50000), catalog)
    assert result["status"] == "OVER_BUDGET"
    assert result["suggestions"][-1].startswith("Raise your budget by " + inr(result["short_by"]))
    last = result["suggestion_details"][-1]
    assert last["kind"] == "raise_budget" and last["amount_inr"] == result["short_by"]
    assert result["suggestions"] == [d["message"] for d in result["suggestion_details"]]


SIX_APR = date(2027, 4, 6)  # from Bengaluru, 6 nights is cheaper than 7 (flight prices differ by date)


def test_fewer_nights_is_suggested_only_when_it_fits_the_budget(catalog):
    base = req(start=SIX_APR, nights=7)
    t6, t7 = cheapest_total(catalog, replace(base, nights=6)), cheapest_total(catalog, base)
    assert t6 is not None and t7 is not None and t6 < t7
    result = build_package(replace(base, budget=t6), catalog)  # 6 nights fits exactly, 7 does not
    assert result["status"] == "OVER_BUDGET"
    fewer = [d for d in result["suggestion_details"] if d["kind"] == "fewer_nights"]
    assert fewer and fewer[0]["nights"] == 6 and fewer[0]["total_inr"] <= t6
    assert "6 nights instead of 7" in fewer[0]["message"] and inr(fewer[0]["total_inr"]) in fewer[0]["message"]


def test_a_cheaper_looking_option_that_does_not_fit_is_not_suggested(catalog):
    """5 nights costs more than 6 from this date, so with a budget that 6 nights just meets it is not offered."""
    base = req(start=SIX_APR, nights=7)
    t6 = cheapest_total(catalog, replace(base, nights=6))
    result = build_package(replace(base, budget=t6), catalog)
    assert 5 not in [d["nights"] for d in result["suggestion_details"] if d["kind"] == "fewer_nights"]


def test_every_suggestion_was_really_solved_and_fits(catalog):
    base = req(start=SIX_APR, nights=8)
    request = replace(base, budget=cheapest_total(catalog, replace(base, nights=6)) + 1000)
    result = build_package(request, catalog)
    assert result["status"] == "OVER_BUDGET"
    real = [d for d in result["suggestion_details"] if d["kind"] != "raise_budget"]
    assert real
    for d in real:
        variant = replace(request, start_date=date.fromisoformat(d["start_date"]), nights=d["nights"])
        solved = build_package(variant, catalog, explain=False)
        assert solved["status"] == "OK"
        assert solved["package"]["total_inr"] == d["total_inr"] <= request.budget


def test_suggestions_stay_inside_the_data_window(catalog):
    # 14 Apr + 6 nights ends exactly on 20 Apr: shifting later would leave the window
    request = req(start=date(2027, 4, 14), nights=6, budget=60000)
    for d in build_package(request, catalog)["suggestion_details"]:
        if d["kind"] != "raise_budget":
            assert d["end_date"] <= "2027-04-20" and d["start_date"] >= "2027-04-01" and d["nights"] >= 3


def test_no_cheaper_option_means_only_the_budget_suggestion(catalog):
    result = build_package(req(budget=1000), catalog)
    assert result["status"] == "OVER_BUDGET"
    assert [d["kind"] for d in result["suggestion_details"]] == ["raise_budget"]


# ------------------------------------------------------------ API


def test_api_returns_the_explanations(tmp_path):
    client = TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))
    base = {"origin": "DEL", "country": "Japan", "start_date": "2027-04-04", "nights": 3,
            "adults": 2, "children_ages": [], "budget": 350000}
    none = client.post("/api/packages", json=base).json()
    assert none["status"] == "NO_PACKAGE" and none["nearby"] and none["reasons"]

    over = client.post("/api/packages", json={**base, "origin": "BLR", "start_date": "2027-04-10",
                                              "nights": 6, "budget": 50000}).json()
    assert over["status"] == "OVER_BUDGET" and over["suggestion_details"][-1]["kind"] == "raise_budget"
