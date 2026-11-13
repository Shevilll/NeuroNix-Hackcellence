"""POST /api/quick-request reads Indian-language requests and reports the language it detected."""

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(replace(load_settings(), db_path=tmp_path / "t.db")))


def test_hindi_request_fills_the_form_and_reports_hindi(client):
    body = client.post("/api/quick-request", json={
        "text": "मुझे 10 अप्रैल को बेंगलुरु से जापान जाना है, 6 रातों के लिए, 2 वयस्क और 6 साल का एक बच्चा, बजट 3.5 लाख"
    }).json()
    assert body["fields"] == {"origin": "BLR", "country": "Japan", "start_date": "2027-04-10", "nights": 6,
                              "adults": 2, "children_ages": [6], "budget": 350000}
    assert body["language"] == "hi" and body["supported"] is True


def test_tamil_request(client):
    body = client.post("/api/quick-request", json={
        "text": "நான் ஏப்ரல் 5 அன்று சென்னையிலிருந்து துபாய்க்கு செல்ல விரும்புகிறேன், 5 இரவுகள், 2 பெரியவர்கள், பட்ஜெட் 2 லட்சம்"
    }).json()
    assert body["language"] == "ta"
    assert body["fields"]["origin"] == "MAA" and body["fields"]["country"] == "United Arab Emirates"
    assert body["fields"]["nights"] == 5 and body["fields"]["budget"] == 200000


def test_english_reports_english(client):
    body = client.post("/api/quick-request", json={"text": "2 adults from Delhi to Dubai, 5 nights from 4 April, budget 2 lakh"}).json()
    assert body["language"] == "en" and body["supported"] is True and body["missing"] == []


def test_unreadable_script_says_so(client):
    body = client.post("/api/quick-request", json={"text": "Привет, хочу поехать в Токио"}).json()
    assert body["supported"] is False and body["fields"] == {}
