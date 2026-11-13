from fastapi.testclient import TestClient

from app.main import create_app


def _points() -> dict:
    response = TestClient(create_app()).get("/api/map-points")
    assert response.status_code == 200
    return response.json()


def test_map_points_place_every_airport_hotel_and_attraction():
    body = _points()

    assert body["airports"]["BLR"] == {"lat": 13.1986, "lng": 77.7066, "name": "Kempegowda International Airport"}
    assert body["hotels"]["HTL-TYO-001"] == {"lat": 35.6717, "lng": 139.765, "name": "Ginza Pearl Hotel"}
    assert body["attractions"]["ATT-KYO-001"] == {"lat": 34.9949, "lng": 135.785, "name": "Kiyomizu-dera"}
    assert len(body["airports"]) == 10
    assert len(body["hotels"]) == 49
    assert len(body["attractions"]) == 56


def test_map_points_give_the_two_airports_of_every_flight():
    body = _points()

    assert body["flights"]["FL-1001"] == {"from": "DEL", "to": "HND"}
    assert len(body["flights"]) == 469
    assert all(f["from"] in body["airports"] and f["to"] in body["airports"] for f in body["flights"].values())
