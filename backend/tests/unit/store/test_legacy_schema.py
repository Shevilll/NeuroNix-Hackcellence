"""A database made by the interim MVP store must not break the app, and must not lose its data."""

import sqlite3

from app.store.store import Store

LEGACY = """
CREATE TABLE packages (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE reservations (number TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
CREATE TABLE idempotency (key TEXT NOT NULL, scope TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY (key, scope));
INSERT INTO packages VALUES ('old1', '{"x": 1}');
INSERT INTO reservations VALUES ('1234567890', 'old1', '{}');
"""


def test_legacy_tables_are_set_aside_not_deleted(tmp_path):
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript(LEGACY)
    conn.close()

    store = Store(path)  # must not raise
    package_id = store.save_package({"traveler": {}, "items": [], "total_inr": 0})
    assert store.get_package(package_id)["trip_id"] == package_id

    conn = sqlite3.connect(path)
    kept = conn.execute("SELECT id FROM packages_legacy").fetchall()
    conn.close()
    assert kept == [("old1",)]


def test_opening_a_current_database_twice_changes_nothing(tmp_path):
    path = tmp_path / "new.db"
    first = Store(path)
    package_id = first.save_package({"traveler": {}, "items": [], "total_inr": 0})
    second = Store(path)
    assert second.get_package(package_id) is not None
    conn = sqlite3.connect(path)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert not any(n.endswith("_legacy") for n in names)


def _legacy_plus_current_schema(path):
    """A database where the current tables were created *beside* the legacy ones, which is what
    happened when the modular store first opened an MVP database: ``packages`` kept its old shape
    and ``package_versions`` was created referencing it."""
    from app.store.db import SCHEMA

    conn = sqlite3.connect(path)
    conn.executescript(LEGACY)
    conn.executescript(SCHEMA)
    conn.close()


def test_current_tables_created_beside_legacy_ones_keep_working(tmp_path):
    path = tmp_path / "mixed.db"
    _legacy_plus_current_schema(path)

    store = Store(path)
    package_id = store.save_package({"traveler": {}, "items": [], "total_inr": 0})
    assert store.get_package(package_id)["trip_id"] == package_id

    conn = sqlite3.connect(path)
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='package_versions'").fetchone()[0]
    legacy_rows = conn.execute("SELECT count(*) FROM packages_legacy").fetchone()[0]
    conn.close()
    assert "packages_legacy" not in sql  # the history table points at the real packages table
    assert legacy_rows == 1


def test_a_database_damaged_by_a_plain_rename_is_repaired(tmp_path):
    """SQLite rewrites foreign keys when a parent table is renamed, so an earlier version of the
    migration left ``package_versions`` pointing at ``packages_legacy``. Opening such a file must
    set the broken table aside (not delete it) and work again."""
    path = tmp_path / "damaged.db"
    _legacy_plus_current_schema(path)
    conn = sqlite3.connect(path)
    for table in ("packages", "reservations", "idempotency"):
        conn.execute(f"ALTER TABLE {table} RENAME TO {table}_legacy")
    from app.store.db import SCHEMA

    conn.executescript(SCHEMA)
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='package_versions'").fetchone()[0]
    assert "packages_legacy" in sql  # the damage we are repairing
    conn.close()

    store = Store(path)  # must not raise
    package_id = store.save_package({"traveler": {}, "items": [], "total_inr": 0})
    assert store.get_package(package_id)["trip_id"] == package_id

    conn = sqlite3.connect(path)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='package_versions'").fetchone()[0]
    conn.close()
    assert "packages_legacy" not in sql
    assert "package_versions_legacy" in names  # set aside, not dropped

    Store(path)  # opening it again changes nothing and does not raise
