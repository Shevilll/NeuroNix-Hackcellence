"""Idempotency keys: replay, key reuse with a different body, atomic with the action (plan §6)."""

import threading

import pytest

from app.store.db import Database
from app.store.idempotency import IdempotencyKeyReused, execute_once


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "holiday.db")
    database.migrate()
    return database


def test_first_call_runs_the_action(db):
    calls = []

    def action(conn):
        calls.append(1)
        return 201, {"package_id": "p1"}

    result = execute_once(db, scope="build", key="k1", body={"a": 1}, action=action)

    assert (result.status_code, result.body, result.replayed) == (201, {"package_id": "p1"}, False)
    assert calls == [1]


def test_same_key_and_body_replays_without_running_again(db):
    calls = []

    def action(conn):
        calls.append(1)
        return 201, {"package_id": f"p{len(calls)}"}

    first = execute_once(db, scope="build", key="k1", body={"a": 1}, action=action)
    second = execute_once(db, scope="build", key="k1", body={"a": 1}, action=action)

    assert calls == [1]
    assert second.replayed is True
    assert second.status_code == first.status_code
    assert second.body == first.body


def test_body_key_order_does_not_matter(db):
    execute_once(db, scope="build", key="k1", body={"a": 1, "b": 2}, action=lambda c: (200, {}))
    again = execute_once(db, scope="build", key="k1", body={"b": 2, "a": 1}, action=lambda c: (200, {}))
    assert again.replayed is True


def test_same_key_with_a_different_body_is_rejected(db):
    execute_once(db, scope="build", key="k1", body={"a": 1}, action=lambda c: (200, {}))
    with pytest.raises(IdempotencyKeyReused):
        execute_once(db, scope="build", key="k1", body={"a": 2}, action=lambda c: (200, {}))


def test_same_key_in_another_scope_is_independent(db):
    calls = []

    def action(conn):
        calls.append(1)
        return 200, {}

    execute_once(db, scope="confirm:p1", key="k", body={}, action=action)
    execute_once(db, scope="confirm:p2", key="k", body={}, action=action)
    assert len(calls) == 2


def test_failed_action_stores_nothing_so_a_retry_can_succeed(db):
    def boom(conn):
        raise RuntimeError("builder crashed")

    with pytest.raises(RuntimeError):
        execute_once(db, scope="build", key="k1", body={}, action=boom)

    result = execute_once(db, scope="build", key="k1", body={}, action=lambda c: (200, {"ok": True}))
    assert result.replayed is False


def test_action_side_effects_roll_back_with_a_failure(db):
    def half_done(conn):
        conn.execute("INSERT INTO packages(package_id, version, status, request_json, package_json, created_at,"
                     " updated_at) VALUES ('p',1,'DRAFT','{}','{}','t','t')")
        raise RuntimeError("fail after insert")

    with pytest.raises(RuntimeError):
        execute_once(db, scope="build", key="k1", body={}, action=half_done)
    with db.transaction() as conn:
        assert conn.execute("SELECT COUNT(*) FROM packages").fetchone()[0] == 0


def test_concurrent_requests_with_one_key_run_the_action_once(db):
    calls = []
    results = []

    def action(conn):
        calls.append(1)
        return 201, {"n": len(calls)}

    def worker():
        results.append(execute_once(db, scope="confirm:p1", key="same", body={}, action=action))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(calls) == 1
    assert len(results) == 8
    assert {r.body["n"] for r in results} == {1}
    assert sum(1 for r in results if not r.replayed) == 1
