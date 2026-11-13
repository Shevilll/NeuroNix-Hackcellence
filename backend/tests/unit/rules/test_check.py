"""S3 checker: validate any trip JSON, grouped like the rule list; never crash on bad input."""

from copy import deepcopy
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.catalog.loader import load_catalog
from app.config import load_settings
from app.domain.request import TripRequest
from app.main import create_app
from app.planner.builder import build_package
from app.rules.check import GROUPS, check_trip

DATA = Path(__file__).resolve().parents[4] / "data"


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(DATA)


@pytest.fixture(scope="module")
def menon(catalog):
    return build_package(TripRequest("BLR", "Japan", date(2027, 4, 10), 6, 2, (6,), 350000), catalog)["package"]


def groups(report):
    return {g["group"]: g["ok"] for g in report["checklist"]}


def test_valid_package_passes_every_group(catalog, menon):
    report = check_trip(menon, catalog)
    assert report["valid"] and report["violations"] == []
    assert list(groups(report)) == list(GROUPS) and all(groups(report).values())


def test_each_tamper_fails_its_group(catalog, menon):
    def tamper(fn):
        pkg = deepcopy(menon)
        fn(pkg)
        return groups(check_trip(pkg, catalog))

    assert not tamper(lambda p: next(i for i in p["items"] if i["role"] == "arrival_flight").update(quantity=1))["Flights"]
    assert not tamper(lambda p: next(i for i in p["items"] if i["type"] == "attraction").update(price_inr=999999))["Prices"]
    assert not tamper(lambda p: p["items"].remove(next(i for i in p["items"] if i["type"] == "attraction")))["Attractions"]
    assert not tamper(lambda p: next(i for i in p["items"] if i["role"] == "arrival_transfer").update(
        start=next(i for i in p["items"] if i["role"] == "arrival_flight")["end"]))["Airport transfers"]
    assert not tamper(lambda p: next(i for i in p["items"] if i["type"] == "hotel").update(quantity=9))["Hotels"]


def test_files_without_our_extra_fields_are_still_checked(catalog, menon):
    pkg = deepcopy(menon)
    for item in pkg["items"]:
        item.pop("role", None)
    pkg.pop("cities", None)
    report = check_trip(pkg, catalog)
    assert report["valid"], report["violations"]


@pytest.mark.parametrize("bad", [{}, [], None, "x", {"items": "no"}, {"traveler": {}, "items": []},
                                 {"traveler": {"adults": "two"}, "start_date": "nope", "end_date": "2027-04-16", "items": []}])
def test_malformed_input_is_reported_not_raised(catalog, bad):
    report = check_trip(bad, catalog)
    assert report["valid"] is False and report["violations"]


def test_check_endpoint(tmp_path, menon):
    from dataclasses import replace
    client = TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))
    ok = client.post("/api/check", json=menon)
    assert ok.status_code == 200 and ok.json()["valid"] is True
    broken = deepcopy(menon)
    broken["total_inr"] += 5000
    bad = client.post("/api/check", json=broken).json()
    assert bad["valid"] is False and not groups(bad)["Prices"]


# ------------------------------------------------ the 1-2 a day rule is for the first package only


def with_two_more_visits(catalog, menon):
    """The Menon package after the traveller added two visits to 11 Apr (three that day)."""
    from app.changes.operations import apply_change

    out = menon
    for attraction_id in ("ATT-TYO-011", "ATT-TYO-015"):
        out = apply_change(out, catalog, {"op": "add_attraction", "attraction_id": attraction_id, "date": "2027-04-11"})
    return out


def test_a_package_the_traveller_changed_may_have_more_than_two_visits_a_day(catalog, menon):
    changed = {**with_two_more_visits(catalog, menon), "version": 3}
    report = check_trip(changed, catalog)
    assert report["valid"], report["violations"]
    assert all(groups(report).values())


@pytest.mark.parametrize("version", [1, None, "3", True, 2.5, [2]])
def test_a_first_package_with_more_than_two_visits_a_day_still_fails(catalog, menon, version):
    first = {**with_two_more_visits(catalog, menon), "version": version}
    report = check_trip(first, catalog)
    assert [v["code"] for v in report["violations"]] == ["ATTRACTION_COUNT"]
    assert groups(report)["Attractions"] is False


def test_a_file_without_a_version_is_checked_as_a_first_package(catalog, menon):
    bare = {k: v for k, v in with_two_more_visits(catalog, menon).items() if k != "version"}
    assert [v["code"] for v in check_trip(bare, catalog)["violations"]] == ["ATTRACTION_COUNT"]
