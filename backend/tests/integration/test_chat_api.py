"""POST /api/chat: the help chatbot over HTTP. Answers come only from our data; no AI is called."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app

MENON = {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
         "adults": 2, "children_ages": [6], "budget": 350000}


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))


def test_answers_a_catalog_question(client):
    response = client.post("/api/chat", json={"question": "hotels in Dubai"})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"answer", "found", "topic", "suggestions", "blocks"}
    assert body["found"] is True and body["topic"] == "hotels"
    assert [b["type"] for b in body["blocks"]][:2] == ["text", "list"]
    assert all(set(i) == {"name", "detail"} for i in body["blocks"][1]["items"])


def test_finds_a_real_booking_made_through_the_api(client):
    built = client.post("/api/packages", json=MENON, headers={"Idempotency-Key": "b1"}).json()
    number = client.post(f"/api/packages/{built['package_id']}/confirm",
                         headers={"Idempotency-Key": "c1"}).json()["reservation_number"]
    body = client.post("/api/chat", json={"question": f"Where is my booking {number}?"}).json()
    assert body["found"] is True and body["topic"] == "booking"
    assert number in body["answer"] and "Japan" in body["answer"]


def test_unknown_questions_get_no_idea(client):
    body = client.post("/api/chat", json={"question": "what is the capital of France"}).json()
    assert body["found"] is False
    assert "no idea" in body["answer"].lower()


@pytest.mark.parametrize("payload", [{}, {"question": ""}, {"question": "   "}, {"question": "x" * 501}, {"question": 5}])
def test_rejects_empty_or_too_long_questions(client, payload):
    assert client.post("/api/chat", json=payload).status_code == 422
