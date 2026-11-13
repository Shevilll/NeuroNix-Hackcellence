"""Versioned packages with optimistic concurrency (plan §6, M6, M7 persistence)."""

import pytest

from app.store.db import Database
from app.store.packages import PackageRepo, VersionConflict


@pytest.fixture
def repo(tmp_path):
    db = Database(tmp_path / "holiday.db")
    db.migrate()
    return PackageRepo(db)


REQUEST = {"origin": "BLR", "country": "Japan"}


def test_create_then_get(repo):
    stored = repo.create(REQUEST, {"total_inr": 1000})
    assert stored.version == 1
    assert stored.status == "DRAFT"
    assert len(stored.package_id) >= 8

    again = repo.get(stored.package_id)
    assert again == stored
    assert again.request == REQUEST
    assert again.package == {"total_inr": 1000}


def test_get_unknown_returns_none(repo):
    assert repo.get("nope") is None


def test_ids_are_unique(repo):
    ids = {repo.create(REQUEST, {}).package_id for _ in range(50)}
    assert len(ids) == 50


def test_update_bumps_version_and_keeps_history(repo):
    stored = repo.create(REQUEST, {"total_inr": 1000})
    updated = repo.update(stored.package_id, expected_version=1, package={"total_inr": 1200})
    assert updated.version == 2
    assert repo.get(stored.package_id).package == {"total_inr": 1200}
    assert [v.version for v in repo.history(stored.package_id)] == [1, 2]
    assert repo.history(stored.package_id)[0].package == {"total_inr": 1000}


def test_stale_version_is_a_conflict_that_carries_the_current_package(repo):
    stored = repo.create(REQUEST, {"total_inr": 1000})
    repo.update(stored.package_id, expected_version=1, package={"total_inr": 1200})
    with pytest.raises(VersionConflict) as info:
        repo.update(stored.package_id, expected_version=1, package={"total_inr": 999})
    assert info.value.current.version == 2
    assert repo.get(stored.package_id).package == {"total_inr": 1200}


def test_update_unknown_package_raises_keyerror(repo):
    with pytest.raises(KeyError):
        repo.update("nope", expected_version=1, package={})


def test_status_can_be_set(repo):
    stored = repo.create(REQUEST, {})
    repo.set_status(stored.package_id, "BOOKED")
    assert repo.get(stored.package_id).status == "BOOKED"
