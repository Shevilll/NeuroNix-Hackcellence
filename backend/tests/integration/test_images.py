"""Photos: served from the organiser's images folder, mapped by catalog id, with credits."""

from dataclasses import replace

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


def client(tmp_path):
    return TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))


def test_image_map_points_at_files_that_are_served(tmp_path):
    c = client(tmp_path)
    images = c.get("/api/images").json()
    assert images["ATT-KYO-001"] == "/images/attractions/ATT-KYO-001.jpg"
    assert images["HTL-TYO-001"].startswith("/images/hotels/")
    for url in (images["ATT-KYO-001"], images["HTL-TYO-001"]):
        res = c.get(url)
        assert res.status_code == 200 and res.headers["content-type"].startswith("image/")


def test_credits_list_every_photo_with_author_and_license(tmp_path):
    credits = client(tmp_path).get("/api/credits").json()
    row = next(r for r in credits if r["file"] == "images/attractions/ATT-KYO-001.jpg")
    assert row["used_for"] == "Kiyomizu-dera"
    assert row["author"] == "Martin Falbisoner" and row["license"] == "CC BY-SA 4.0"
    assert row["source_url"].startswith("https://commons.wikimedia.org/")
    assert len(credits) >= 56
    assert all(r["author"] and r["license"] and r["source_url"] for r in credits)
