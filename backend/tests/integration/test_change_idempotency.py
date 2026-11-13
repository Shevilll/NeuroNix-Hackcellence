"""A retried POST /changes with the same Idempotency-Key replays the first answer (plan §6)."""

from dataclasses import replace

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}


def _client(tmp_path):
    return TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))


def _built(client):
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    return built["package_id"], built["package"]


def _remove_first_attraction(package):
    target = next(i for i in package["items"] if i["type"] == "attraction")
    return {"op": "remove_attraction", "item_id": target["item_id"], "expected_version": package["version"]}


def test_retry_with_the_same_key_replays_the_first_answer(tmp_path):
    client = _client(tmp_path)
    pid, package = _built(client)
    change = _remove_first_attraction(package)

    first = client.post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c1"})
    retry = client.post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c1"})

    assert first.status_code == 200, first.text
    assert "Idempotent-Replay" not in first.headers
    assert retry.status_code == 200, retry.text
    assert retry.headers["Idempotent-Replay"] == "true"
    assert retry.json() == first.json()
    # the change was applied exactly once
    assert client.get(f"/api/packages/{pid}").json()["version"] == package["version"] + 1


def test_replay_survives_a_backend_restart(tmp_path):
    client = _client(tmp_path)
    pid, package = _built(client)
    change = _remove_first_attraction(package)
    first = client.post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c1"})

    retry = _client(tmp_path).post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c1"})

    assert retry.status_code == 200, retry.text
    assert retry.json() == first.json()


def test_same_key_with_a_different_change_is_rejected(tmp_path):
    client = _client(tmp_path)
    pid, package = _built(client)
    change = _remove_first_attraction(package)
    client.post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c1"})
    other = {**change, "item_id": "something-else"}

    response = client.post(f"/api/packages/{pid}/changes", json=other, headers={"Idempotency-Key": "c1"})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_same_key_on_another_package_is_a_separate_change(tmp_path):
    client = _client(tmp_path)
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b"}).json()
    pid, package = built["package_id"], built["package"]
    other_pid = built["alternatives"]["cheapest"]["package_id"]
    other = built["alternatives"]["cheapest"]["package"]

    client.post(f"/api/packages/{pid}/changes", json=_remove_first_attraction(package),
                headers={"Idempotency-Key": "c1"})
    response = client.post(f"/api/packages/{other_pid}/changes", json=_remove_first_attraction(other),
                           headers={"Idempotency-Key": "c1"})

    assert response.status_code == 200, response.text
    assert "Idempotent-Replay" not in response.headers
    assert response.json()["package_id"] == other_pid


def test_a_stale_version_with_a_new_key_is_still_a_conflict(tmp_path):
    client = _client(tmp_path)
    pid, package = _built(client)
    change = _remove_first_attraction(package)
    client.post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c1"})

    response = client.post(f"/api/packages/{pid}/changes", json=change, headers={"Idempotency-Key": "c2"})

    assert response.status_code == 409
    assert response.json()["detail"]["package"]["version"] == package["version"] + 1


def test_a_refused_change_stores_nothing_so_the_key_can_be_used_again(tmp_path):
    client = _client(tmp_path)
    pid, package = _built(client)
    bad = {"op": "remove_attraction", "item_id": "no-such-item", "expected_version": package["version"]}

    first = client.post(f"/api/packages/{pid}/changes", json=bad, headers={"Idempotency-Key": "c1"})
    again = client.post(f"/api/packages/{pid}/changes", json=bad, headers={"Idempotency-Key": "c1"})

    assert first.status_code == 422
    assert again.status_code == 422
    assert "Idempotent-Replay" not in again.headers
    assert client.get(f"/api/packages/{pid}").json()["version"] == package["version"]


def test_changes_without_a_key_still_work(tmp_path):
    client = _client(tmp_path)
    pid, package = _built(client)

    response = client.post(f"/api/packages/{pid}/changes", json=_remove_first_attraction(package))

    assert response.status_code == 200, response.text
    assert response.json()["package"]["version"] == package["version"] + 1
