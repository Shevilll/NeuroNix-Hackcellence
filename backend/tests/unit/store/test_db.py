"""SQLite connection: WAL, busy timeout, bounded retry on a locked database, restart safety."""

import sqlite3
import threading
import time

import pytest

from app.store.db import Database


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "var" / "holiday.db")
    database.migrate()
    return database


def test_creates_parent_folder_and_uses_wal(tmp_path):
    database = Database(tmp_path / "nested" / "x.db")
    database.migrate()
    with database.transaction() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] >= 1000


def test_migrate_is_repeatable(db):
    db.migrate()
    db.migrate()
    with db.transaction() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"packages", "package_versions", "idempotency_keys"} <= tables


def test_commit_and_rollback(db):
    with db.transaction() as conn:
        conn.execute("INSERT INTO idempotency_keys(scope, key, request_hash, status_code, response_json, created_at)"
                     " VALUES ('s','k1','h',200,'{}','t')")
    with pytest.raises(RuntimeError):
        with db.transaction() as conn:
            conn.execute("INSERT INTO idempotency_keys(scope, key, request_hash, status_code, response_json, created_at)"
                         " VALUES ('s','k2','h',200,'{}','t')")
            raise RuntimeError("boom")
    with db.transaction() as conn:
        keys = [r[0] for r in conn.execute("SELECT key FROM idempotency_keys")]
    assert keys == ["k1"]


def test_data_survives_a_new_database_object_on_the_same_file(tmp_path):
    path = tmp_path / "holiday.db"
    first = Database(path)
    first.migrate()
    with first.transaction() as conn:
        conn.execute("INSERT INTO idempotency_keys(scope, key, request_hash, status_code, response_json, created_at)"
                     " VALUES ('s','k','h',200,'{}','t')")
    second = Database(path)  # "restart"
    second.migrate()
    with second.transaction() as conn:
        assert conn.execute("SELECT COUNT(*) FROM idempotency_keys").fetchone()[0] == 1


def test_waits_for_a_locked_database_instead_of_failing(tmp_path):
    path = tmp_path / "holiday.db"
    db = Database(path, busy_timeout_ms=50, lock_retries=10)
    db.migrate()

    holder = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    holder.execute("BEGIN IMMEDIATE")

    def release():
        time.sleep(0.3)
        holder.execute("COMMIT")

    threading.Thread(target=release).start()
    with db.transaction() as conn:  # blocked at first, then succeeds
        conn.execute("INSERT INTO idempotency_keys(scope, key, request_hash, status_code, response_json, created_at)"
                     " VALUES ('s','k','h',200,'{}','t')")


def test_gives_up_after_the_retry_budget(tmp_path):
    path = tmp_path / "holiday.db"
    db = Database(path, busy_timeout_ms=10, lock_retries=2)
    db.migrate()
    holder = sqlite3.connect(path, isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(sqlite3.OperationalError):
            with db.transaction():
                pass
    finally:
        holder.execute("ROLLBACK")
