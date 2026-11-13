"""POST /changes answers with the new package, the price difference and any warnings."""

from dataclasses import replace

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}


def test_change_response_carries_price_difference_and_warnings(tmp_path):
    client = TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    pid, package = built["package_id"], built["package"]
    target = next(i for i in package["items"] if i["catalog_id"] == "ATT-TYO-004")

    response = client.post(f"/api/packages/{pid}/changes", json={"op": "remove_attraction", "item_id": target["item_id"]})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["price_diff_inr"] == body["package"]["total_inr"] - package["total_inr"]
    assert [w["code"] for w in body["warnings"]] == ["EMPTY_DAY"]
