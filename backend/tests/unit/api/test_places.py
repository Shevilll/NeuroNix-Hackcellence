from fastapi.testclient import TestClient

from app.main import create_app


def test_places_give_the_latitude_and_longitude_of_every_attraction():
    response = TestClient(create_app()).get("/api/places")

    assert response.status_code == 200
    body = response.json()
    assert body["ATT-TYO-008"] == {"lat": 35.7146, "lng": 139.7732}
    assert body["ATT-KYO-001"] == {"lat": 34.9949, "lng": 135.785}
    assert all(set(p) == {"lat", "lng"} for p in body.values())
