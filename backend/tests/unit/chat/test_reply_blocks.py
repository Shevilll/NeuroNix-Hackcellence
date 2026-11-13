"""Chat replies come with structured blocks so the chat panel can show clean text.

Besides the plain ``answer`` every reply carries ``blocks``: paragraphs, lists whose item names can
be shown in bold, label and value facts, and links to pages of this site. The blocks are built with
plain code from our own data. The plain answer is the same content as text.
"""

import json

import pytest

from app.catalog.loader import load_catalog
from app.chat.bot import ChatBot, inr
from app.config import load_settings
from app.store.store import Store

BLOCK_KEYS = {
    "text": {"type", "text"},
    "list": {"type", "items"},
    "facts": {"type", "rows"},
    "link": {"type", "text", "href"},
}


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "chat.db")


@pytest.fixture
def bot(catalog, store):
    return ChatBot(catalog, store)


def kinds(reply):
    return [b["type"] for b in reply["blocks"]]


def only(reply, kind):
    found = [b for b in reply["blocks"] if b["type"] == kind]
    assert len(found) == 1, reply["blocks"]
    return found[0]


@pytest.mark.parametrize("question", [
    "hi", "thanks", "hotels in Tokyo", "cheapest hotel in Osaka", "things to do in Kyoto",
    "Tell me about Kiyomizu-dera", "Is Ginza Pearl Hotel good?", "flights from Delhi to Japan",
    "flights from Delhi", "flights to Japan", "Do you have flights?", "hotels in Japan",
    "Which countries can I travel to?", "What is the minimum number of nights?", "Osaka", "Japan",
    "How do I cancel my booking?", "booking 9999999999", "booking 12345", "who won the cricket match",
])
def test_every_reply_has_well_formed_blocks(bot, question):
    reply = bot.reply(question)
    assert reply["blocks"], question
    for block in reply["blocks"]:
        assert set(block) == BLOCK_KEYS[block["type"]], block
        if block["type"] == "list":
            assert block["items"]
            assert all(set(i) == {"name", "detail"} and i["name"] for i in block["items"])
        if block["type"] == "facts":
            assert block["rows"]
            assert all(set(r) == {"label", "value"} and r["label"] and r["value"] for r in block["rows"])
        if block["type"] == "link":
            assert block["href"].startswith("/") and not block["href"].startswith("//")
        if block["type"] == "text":
            assert block["text"] and "\n" not in block["text"]


def test_hotels_in_a_city_are_a_list_with_hotel_names_as_item_names(bot, catalog):
    reply = bot.reply("hotels in Tokyo")
    assert kinds(reply)[0] == "text"
    assert reply["blocks"][0]["text"].startswith("Hotels in Tokyo")
    items = only(reply, "list")["items"]
    tokyo = sorted(catalog.hotels_in("Tokyo"), key=lambda h: (-h.rating, h.name))
    assert [i["name"] for i in items] == [h.name for h in tokyo[: len(items)]]
    best_room = min(r.price_per_night for r in catalog.rooms_of(tokyo[0].hotel_id))
    assert tokyo[0].area in items[0]["detail"]
    assert f"from {inr(best_room)} a night" in items[0]["detail"]
    assert not items[0]["detail"].startswith(("-", ",", ":"))


def test_things_to_do_are_a_list_with_attraction_names(bot, catalog):
    reply = bot.reply("things to do in Kyoto")
    names = [i["name"] for i in only(reply, "list")["items"]]
    assert catalog.attractions["ATT-KYO-001"].name in names


def test_one_attraction_is_an_intro_and_facts(bot):
    reply = bot.reply("Tell me about Kiyomizu-dera")
    assert kinds(reply)[0] == "text" and "Kyoto" in reply["blocks"][0]["text"]
    rows = {r["label"]: r["value"] for r in only(reply, "facts")["rows"]}
    assert "06:00" in rows["Open"] and "18:00" in rows["Open"]
    assert rows["Ticket"].startswith("₹280 per adult")


def test_one_hotel_is_an_intro_and_facts(bot):
    reply = bot.reply("Is Ginza Pearl Hotel good?")
    assert "4-star" in reply["blocks"][0]["text"] and "8.6" in reply["blocks"][0]["text"]
    rows = {r["label"]: r["value"] for r in only(reply, "facts")["rows"]}
    assert rows["Check-in"] == "from 15:00"
    assert rows["Rooms"].startswith("from ₹")


def test_a_booking_is_facts_with_a_link_that_opens_it(bot, store):
    number = "1234567890"
    package = {
        "country": "Japan", "cities": ["Tokyo", "Kyoto"], "start_date": "2027-04-10",
        "end_date": "2027-04-16", "traveler": {"adults": 2, "child_ages": [6]}, "total_inr": 231924,
    }
    with store.db.transaction() as conn:
        conn.execute("INSERT INTO packages VALUES ('P1', 1, 'CONFIRMED', '{}', '{}', 'now', 'now')")
        conn.execute("INSERT INTO reservations VALUES (?, 'P1', ?, 'now')",
                     (number, json.dumps({"package": package})))
    reply = bot.reply(f"status of booking {number}")
    rows = {r["label"]: r["value"] for r in only(reply, "facts")["rows"]}
    assert rows == {
        "Trip": "Japan (Tokyo, Kyoto)",
        "Dates": "10 April 2027 to 16 April 2027",
        "Travelers": "2 adults and 1 child",
        "Total": "₹2,31,924",
    }
    link = only(reply, "link")
    assert link["href"] == f"/r/{number}"
    assert number in link["text"]


def test_an_unknown_booking_links_to_the_bookings_page(bot):
    reply = bot.reply("booking 9999999999")
    assert only(reply, "link")["href"] == "/r"


def test_flights_on_a_route_give_the_lowest_fare_as_a_fact(bot):
    reply = bot.reply("flights from Delhi to Japan")
    rows = {r["label"]: r["value"] for r in only(reply, "facts")["rows"]}
    assert rows["Lowest fare"].startswith("₹")
    assert "Airlines" in rows


def test_trip_rules_are_facts(bot):
    rows = {r["label"]: r["value"] for r in only(bot.reply("What is the minimum number of nights?"), "facts")["rows"]}
    assert rows["Trip length"] == "3 to 10 nights"
    assert "1 April 2027" in rows["First hotel night"]


def test_destinations_list_each_country_with_its_cities(bot):
    items = only(bot.reply("Which countries can I travel to?"), "list")["items"]
    japan = next(i for i in items if i["name"] == "Japan")
    assert "Tokyo" in japan["detail"]


def test_plain_answers_stay_a_single_paragraph(bot):
    reply = bot.reply("who won the cricket match")
    assert reply["blocks"] == [{"type": "text", "text": reply["answer"]}]


def test_the_plain_answer_carries_the_same_content_as_the_blocks(bot):
    reply = bot.reply("hotels in Tokyo")
    for item in only(reply, "list")["items"]:
        assert item["name"] in reply["answer"] and item["detail"] in reply["answer"]
    reply = bot.reply("Tell me about Kiyomizu-dera")
    for row in only(reply, "facts")["rows"]:
        assert f"{row['label']}: {row['value']}" in reply["answer"]
