"""The catalog must stay byte-identical to the organiser files (judges use the originals)."""

import hashlib
import json
from pathlib import Path

import pytest

from app.config import load_settings

# SHA-256 of the files in hackathon-problem-1-holiday-package.zip, as handed out.
ORIGINAL_SHA256 = {
    "catalog/airports.json": "9ea953a1b55d09c24811cf7bef24b61338c696b4d08e5a7aadea766feffda44f",
    "catalog/attractions.json": "f2f63184bd722c917050d0920c4c5161525e60df851a41b00c70ea7d7a822b2b",
    "catalog/availability.json": "b1253a75ea79407a12074337ed899c9639cd01bc21cf9db08428ef15185e131d",
    "catalog/destinations.json": "bdfb653f574f5019e9337353a06c384732400d727d21b65dfaed3e87a9aac2c1",
    "catalog/flights.json": "2d3cb6582b59da9a34770ac7caaa097bbab0742c2e45663ebcf3274051979907",
    "catalog/hotels.json": "4d5523990334d67f48544185b625c8d7b9557384763bf173e33768cbe709ebef",
    "catalog/rooms.json": "9645d705cb560b4b255888d402c92261b2c9662930c3c6abb99021d58b1fe705",
    "catalog/transfers.json": "232a5046b19e72c98d3324e65659ea4544c801871a8d5fe3559b66aac1c78f2e",
    "trip_format_example.json": "acc775e58cccabcf32bf166eb6d0e6a1e2f0e747f6c1fe2a2fee191667c597a6",
}

DATA_DIR = load_settings().data_dir
IMAGES_DIR = load_settings().images_dir


@pytest.mark.parametrize("relative_path", sorted(ORIGINAL_SHA256))
def test_data_file_is_unchanged(relative_path: str):
    path = DATA_DIR / relative_path
    assert path.is_file(), f"missing data file: {path}"

    digest = hashlib.sha256(path.read_bytes()).hexdigest()

    assert digest == ORIGINAL_SHA256[relative_path], f"{relative_path} was modified"


def test_catalog_has_no_unexpected_files():
    present = {p.name for p in (DATA_DIR / "catalog").glob("*.json")}
    expected = {Path(p).name for p in ORIGINAL_SHA256 if p.startswith("catalog/")}

    assert present == expected


def test_every_image_referenced_by_the_catalog_exists():
    catalog = DATA_DIR / "catalog"
    records = json.loads((catalog / "hotels.json").read_text()) + json.loads(
        (catalog / "attractions.json").read_text()
    )
    referenced = {r["image"] for r in records if r.get("image")}

    missing = [ref for ref in referenced if not (IMAGES_DIR.parent / ref).is_file()]

    assert referenced, "catalog references no images"
    assert missing == []


def test_image_credits_are_present():
    assert (IMAGES_DIR / "ATTRIBUTIONS.md").is_file()
