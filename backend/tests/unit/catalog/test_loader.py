"""Catalog loader: reads data/catalog once, validates it, and indexes it for the planner.

Covers sheet cases DQ-01 (references), DQ-02 (duplicate IDs), DQ-03 (airports + times parse),
and the lookups the planner and rule checker rely on.
"""

import dataclasses
import json
import shutil
from datetime import date, datetime
from pathlib import Path

import pytest

from app.catalog.loader import Catalog, CatalogError, load_catalog
from app.config import load_settings

DATA_DIR = load_settings().data_dir


@pytest.fixture(scope="module")
def catalog() -> Catalog:
    return load_catalog(DATA_DIR)


# --------------------------------------------------------------------------- helpers


def broken_copy(tmp_path: Path, filename: str, mutate) -> Path:
    """Copy data/ into tmp_path, apply `mutate` to one catalog file, return the new data dir."""
    target = tmp_path / "data"
    shutil.copytree(DATA_DIR, target)
    path = target / "catalog" / filename
    records = json.loads(path.read_text())
    mutate(records)
    path.write_text(json.dumps(records))
    return target


def find(records: list[dict], key: str, value: str) -> dict:
    return next(r for r in records if r[key] == value)


# --------------------------------------------------------------------------- loading


def test_loads_every_record(catalog: Catalog):
    assert len(catalog.airports) == 10
    assert len(catalog.flights) == 469
    assert len(catalog.hotels) == 49
    assert len(catalog.rooms) == 125
    assert len(catalog.transfers) == 66
    assert len(catalog.attractions) == 56


def test_departure_cities_come_from_destinations(catalog: Catalog):
    assert [(c.airport, c.city) for c in catalog.departure_cities] == [
        ("BLR", "Bengaluru"),
        ("DEL", "Delhi"),
        ("BOM", "Mumbai"),
        ("MAA", "Chennai"),
    ]


def test_countries_and_their_cities(catalog: Catalog):
    assert list(catalog.countries) == ["Japan", "United Arab Emirates"]

    japan = catalog.countries["Japan"]
    assert japan.code == "JP"
    assert japan.timezone == "Asia/Tokyo"
    assert japan.city_names == ("Tokyo", "Kyoto", "Osaka")

    uae = catalog.countries["United Arab Emirates"]
    assert uae.code == "AE"
    assert uae.city_names == ("Dubai", "Abu Dhabi")


def test_rules_are_read_from_destinations(catalog: Catalog):
    rules = catalog.rules
    assert rules.min_nights == 3
    assert rules.max_nights == 10
    assert rules.min_nights_per_city == 2
    assert rules.first_night == date(2027, 4, 1)
    assert rules.last_departure == date(2027, 4, 20)


def test_missing_data_dir_raises(tmp_path: Path):
    with pytest.raises(CatalogError, match="destinations.json"):
        load_catalog(tmp_path / "nope")


# --------------------------------------------------------------------------- typed records


def test_flight_fields_are_parsed(catalog: Catalog):
    flight = catalog.flights["FL-401"]

    assert flight.origin == "BLR"
    assert flight.destination == "NRT"
    assert flight.departure_local == datetime(2027, 4, 9, 23, 50)
    assert flight.arrival_local == datetime(2027, 4, 10, 10, 30)
    assert flight.duration_minutes == 430
    assert flight.price_per_seat == 25200
    assert flight.seats_left == 9
    assert flight.flight_number == "AV 520"


def test_clock_times_are_minutes_of_day_and_handle_24_00_and_wrap(catalog: Catalog):
    hnd_taxi = catalog.transfers["TR-HND-ASA-TAXI"]
    assert (hnd_taxi.service_from, hnd_taxi.service_until) == (5 * 60, 24 * 60)

    # 06:00-00:30 runs past midnight; stored as-is, the time helpers handle the wrap.
    kix_shuttle = catalog.transfers["TR-KIX-NMB-SHUTTLE"]
    assert (kix_shuttle.service_from, kix_shuttle.service_until) == (6 * 60, 30)

    always_open = catalog.attractions["ATT-TYO-011"]
    assert (always_open.open_from, always_open.open_until) == (0, 24 * 60)


def test_child_price_zero_is_kept_apart_from_missing(catalog: Catalog):
    assert catalog.attractions["ATT-OSA-003"].child_price == 0  # children free
    assert catalog.attractions["ATT-DXB-004"].child_price is None  # pay adult price
    assert catalog.transfers["TR-NRT-ASA-BUS"].child_price == 896
    assert catalog.transfers["TR-NRT-ASA-TAXI"].child_price is None


def test_attraction_days_and_closed_dates(catalog: Catalog):
    ueno_zoo = catalog.attractions["ATT-TYO-005"]
    assert "MON" not in ueno_zoo.open_days
    assert ueno_zoo.closed_dates == frozenset()

    disney = catalog.attractions["ATT-TYO-002"]
    assert disney.closed_dates == frozenset({date(2027, 4, 12)})
    assert disney.visit_minutes == 480


def test_room_fields_are_parsed(catalog: Catalog):
    room = catalog.rooms["RM-TYO-001-A"]
    assert room.hotel_id == "HTL-TYO-001"
    assert (room.max_adults, room.max_children) == (2, 0)
    assert room.price_per_night == 6440


def test_records_are_read_only(catalog: Catalog):
    with pytest.raises(dataclasses.FrozenInstanceError):
        catalog.flights["FL-401"].seats_left = 0  # type: ignore[misc]


# --------------------------------------------------------------------------- lookups


def test_airports_serving_a_city_use_serves_cities(catalog: Catalog):
    assert catalog.airports_serving("Tokyo") == {"NRT", "HND"}
    assert catalog.airports_serving("Kyoto") == {"KIX"}  # Kyoto has no airport of its own
    assert catalog.airports_serving("Osaka") == {"KIX"}  # ITM serves nothing
    assert catalog.airports_serving("Abu Dhabi") == {"AUH", "DXB"}
    assert catalog.airports_serving("Nara") == set()


def test_indian_airports_and_itm_serve_no_destination_city(catalog: Catalog):
    for code in ("BLR", "DEL", "BOM", "MAA", "ITM"):
        assert catalog.airports[code].serves_cities == frozenset()


def test_arrival_flights_land_on_the_given_local_date(catalog: Catalog):
    flights = catalog.arrival_flights("BLR", {"NRT", "HND", "KIX"}, date(2027, 4, 10))

    assert {f.flight_id for f in flights} == {"FL-403", "FL-740", "FL-401", "FL-405"}
    assert all(f.arrival_local.date() == date(2027, 4, 10) for f in flights)


def test_return_flights_leave_on_the_given_local_date(catalog: Catalog):
    flights = catalog.return_flights({"HND", "KIX"}, "BLR", date(2027, 4, 16))

    assert {f.flight_id for f in flights} == {"FL-412", "FL-411"}


def test_flight_lookups_are_sorted_and_empty_outside_the_window(catalog: Catalog):
    flights = catalog.arrival_flights("BLR", {"NRT", "HND", "KIX"}, date(2027, 4, 10))
    assert flights == sorted(flights, key=lambda f: (f.arrival_local, f.flight_id))

    assert catalog.arrival_flights("BLR", {"NRT"}, date(2027, 4, 25)) == []


def test_hotels_and_rooms_by_city(catalog: Catalog):
    assert len(catalog.hotels_in("Tokyo")) == 13
    assert len(catalog.hotels_in("Kyoto")) == 12
    assert catalog.hotels_in("Nara") == []

    rooms = catalog.rooms_of("HTL-TYO-001")
    assert rooms and all(r.hotel_id == "HTL-TYO-001" for r in rooms)


def test_rooms_left_per_night(catalog: Catalog):
    raw = json.loads((DATA_DIR / "catalog" / "availability.json").read_text())
    row = find(raw, "room_id", "RM-TYO-001-A")

    assert catalog.rooms_left("RM-TYO-001-A", date.fromisoformat(row["date"])) == row["rooms_left"]
    # No record means no room: outside the data window nothing can be booked.
    assert catalog.rooms_left("RM-TYO-001-A", date(2027, 4, 21)) == 0
    assert catalog.rooms_left("RM-DOES-NOT-EXIST", date(2027, 4, 10)) == 0


def test_airport_transfers_match_area_or_all_areas(catalog: Catalog):
    ginza = catalog.airport_transfers("NRT", "Tokyo", "Ginza")
    assert {t.transfer_id for t in ginza} == {"TR-NRT-GNZ-TAXI", "TR-NRT-GNZ-BUS"}

    kyoto = catalog.airport_transfers("KIX", "Kyoto", "Gion")  # area null serves all areas
    assert {t.transfer_id for t in kyoto} == {"TR-KIX-KYO-TAXI", "TR-KIX-KYO-BUS"}

    yas = catalog.airport_transfers("AUH", "Abu Dhabi", "Yas Island")
    assert {t.transfer_id for t in yas} == {"TR-AUH-YAS-TAXI", "TR-AUH-ALL-BUS"}

    dxb_to_abu_dhabi = catalog.airport_transfers("DXB", "Abu Dhabi", "Corniche")
    assert {t.transfer_id for t in dxb_to_abu_dhabi} == {"TR-DXB-ABU-TAXI", "TR-DXB-ABU-BUS"}


def test_airport_transfers_never_include_city_or_intercity_services(catalog: Catalog):
    for transfer in catalog.airport_transfers("HND", "Tokyo", "Shinjuku"):
        assert transfer.type.startswith("AIRPORT_")


def test_no_airport_transfer_means_empty_list(catalog: Catalog):
    # DQ-05: never guess a transfer.
    assert catalog.airport_transfers("NRT", "Kyoto", "Gion") == []
    assert catalog.airport_transfers("HND", "Tokyo", "Nowhere") == []


def test_intercity_transfers_come_from_links(catalog: Catalog):
    assert [t.transfer_id for t in catalog.intercity_transfers("Tokyo", "Kyoto")] == [
        "TR-TYO-KYO-01"
    ]
    assert {t.transfer_id for t in catalog.intercity_transfers("Dubai", "Abu Dhabi")} == {
        "TR-DXB-AUH-BUS",
        "TR-DXB-AUH-TAXI",
    }
    assert catalog.intercity_transfers("Tokyo", "Dubai") == []
    assert catalog.intercity_transfers("Kyoto", "Kyoto") == []


def test_has_link(catalog: Catalog):
    assert catalog.has_link("Osaka", "Tokyo")
    assert not catalog.has_link("Tokyo", "Abu Dhabi")


def test_attractions_by_city(catalog: Catalog):
    assert len(catalog.attractions_in("Tokyo")) == 15
    assert len(catalog.attractions_in("Nara")) == 2  # present, but Nara has no hotels
    assert catalog.attractions_in("Paris") == []


def test_country_of_city(catalog: Catalog):
    assert catalog.country_of_city("Kyoto") == "Japan"
    assert catalog.country_of_city("Abu Dhabi") == "United Arab Emirates"
    assert catalog.country_of_city("Nara") is None


# --------------------------------------------------------------------------- validation (DQ-01..03)


def test_real_catalog_passes_validation(catalog: Catalog):
    # Loading would have raised otherwise; also check a few cross-references directly.
    assert all(r.hotel_id in catalog.hotels for r in catalog.rooms.values())
    assert all(
        f.origin in catalog.airports and f.destination in catalog.airports
        for f in catalog.flights.values()
    )


def test_duplicate_id_is_rejected(tmp_path: Path):
    data = broken_copy(tmp_path, "hotels.json", lambda rs: rs.append(dict(rs[0])))

    with pytest.raises(CatalogError, match=r"duplicate .*HTL-TYO-001"):
        load_catalog(data)


def test_room_pointing_to_unknown_hotel_is_rejected(tmp_path: Path):
    def mutate(rooms):
        rooms[0]["hotel_id"] = "HTL-GHOST"

    with pytest.raises(CatalogError, match="HTL-GHOST"):
        load_catalog(broken_copy(tmp_path, "rooms.json", mutate))


def test_availability_for_unknown_room_is_rejected(tmp_path: Path):
    def mutate(rows):
        rows[0]["room_id"] = "RM-GHOST"

    with pytest.raises(CatalogError, match="RM-GHOST"):
        load_catalog(broken_copy(tmp_path, "availability.json", mutate))


def test_flight_to_unknown_airport_is_rejected(tmp_path: Path):
    def mutate(flights):
        flights[0]["to"] = "XXX"

    with pytest.raises(CatalogError, match="XXX"):
        load_catalog(broken_copy(tmp_path, "flights.json", mutate))


def test_unparseable_time_is_rejected(tmp_path: Path):
    def mutate(transfers):
        transfers[0]["service_until"] = "25:00"

    with pytest.raises(CatalogError, match="25:00"):
        load_catalog(broken_copy(tmp_path, "transfers.json", mutate))


def test_unparseable_timestamp_is_rejected(tmp_path: Path):
    def mutate(flights):
        flights[0]["arrival_local"] = "tomorrow"

    with pytest.raises(CatalogError, match="tomorrow"):
        load_catalog(broken_copy(tmp_path, "flights.json", mutate))


def test_link_to_unknown_transfer_is_rejected(tmp_path: Path):
    def mutate(destinations):
        destinations["countries"][0]["links"][0]["transfer_ids"] = ["TR-GHOST"]

    with pytest.raises(CatalogError, match="TR-GHOST"):
        load_catalog(broken_copy(tmp_path, "destinations.json", mutate))


def test_non_inr_price_is_rejected(tmp_path: Path):
    def mutate(rooms):
        rooms[0]["price_per_night"]["currency"] = "JPY"

    with pytest.raises(CatalogError, match="JPY"):
        load_catalog(broken_copy(tmp_path, "rooms.json", mutate))
