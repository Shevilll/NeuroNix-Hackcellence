from fastapi.testclient import TestClient

from app.main import create_app


def test_options_feed_the_request_form():
    response = TestClient(create_app()).get("/api/options")

    assert response.status_code == 200
    body = response.json()
    assert body["departure_cities"] == [
        {"airport": "BLR", "city": "Bengaluru"},
        {"airport": "DEL", "city": "Delhi"},
        {"airport": "BOM", "city": "Mumbai"},
        {"airport": "MAA", "city": "Chennai"},
    ]
    assert body["countries"] == [
        {"code": "JP", "name": "Japan"},
        {"code": "AE", "name": "United Arab Emirates"},
    ]
    assert body["rules"] == {
        "min_nights": 3,
        "max_nights": 10,
        "min_nights_per_city": 2,
        "max_travelers": 9,
        "data_window": {"first_night": "2027-04-01", "last_departure": "2027-04-20"},
    }
