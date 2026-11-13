from fastapi.testclient import TestClient

from app.main import create_app


def test_places_give_the_latitude_and_longitude_of_every_attraction():
    response = TestClient(create_app()).get("/api/places")

    assert response.status_code == 200
    body = response.json()
    assert body["ATT-TYO-008"] == {"lat": 35.7146, "lng": 139.7732}
    assert body["ATT-KYO-001"] == {"lat": 34.9949, "lng": 135.785}
    assert all(set(p) == {"lat", "lng"} for p in body.values())


def test_places_also_give_every_hotel_so_the_plan_can_show_leaving_and_reaching_it():
    body = TestClient(create_app()).get("/api/places").json()

    assert body["HTL-TYO-001"] == {"lat": 35.6717, "lng": 139.765}
    assert body["HTL-KYO-004"] == {"lat": 34.9986, "lng": 135.78}
