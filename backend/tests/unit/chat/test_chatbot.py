"""The help chatbot answers only from our data: the catalog and the SQLite store.

No AI: questions are matched with plain rules. A question the data cannot answer gets an honest
"I have no idea" instead of a guess.
"""

import json

import pytest

from app.catalog.loader import load_catalog
from app.chat.bot import ChatBot, inr
from app.config import load_settings
from app.store.store import Store


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(load_settings().data_dir)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "chat.db")


@pytest.fixture
def bot(catalog, store):
    return ChatBot(catalog, store)


def test_indian_rupee_amounts_use_lakh_grouping():
    assert inr(231924) == "₹2,31,924"
    assert inr(6440) == "₹6,440"
    assert inr(950) == "₹950"
    assert inr(12345678) == "₹1,23,45,678"


@pytest.mark.parametrize("question", ["hi", "Hello!", "hey there"])
def test_greets_back_and_says_what_it_can_answer(bot, question):
    reply = bot.reply(question)
    assert reply["found"] is True
    assert reply["topic"] == "greeting"
    assert "hotels" in reply["answer"].lower()


def test_lists_hotels_in_a_city_best_rated_first_with_their_lowest_room_price(bot, catalog):
    reply = bot.reply("Which hotels are in Tokyo?")
    assert reply["found"] is True
    assert reply["topic"] == "hotels"
    tokyo = sorted(catalog.hotels_in("Tokyo"), key=lambda h: (-h.rating, h.name))
    best = tokyo[0]
    cheapest = min(r.price_per_night for r in catalog.rooms_of(best.hotel_id))
    assert best.name in reply["answer"]
    assert inr(cheapest) in reply["answer"]
    shown = [h for h in tokyo if h.name in reply["answer"]]
    assert shown == tokyo[: len(shown)]  # best rated first, in order


def test_city_names_match_in_any_case(bot):
    assert bot.reply("hotels in KYOTO")["topic"] == "hotels"
    assert bot.reply("where to stay in abu dhabi")["topic"] == "hotels"


def test_lists_things_to_do_in_a_city_with_prices(bot, catalog):
    reply = bot.reply("What can I see in Kyoto?")
    assert reply["found"] is True
    assert reply["topic"] == "attractions"
    kiyomizu = catalog.attractions["ATT-KYO-001"]
    assert kiyomizu.name in reply["answer"]
    assert inr(kiyomizu.price_per_person) in reply["answer"]


def test_tells_about_one_attraction_by_name_or_alias(bot):
    for question in ["Tell me about Kiyomizu-dera", "kiyomizu temple timings?"]:
        reply = bot.reply(question)
        assert reply["found"] is True
        assert reply["topic"] == "attraction"
        assert "Kyoto" in reply["answer"]
        assert "06:00" in reply["answer"] and "18:00" in reply["answer"]
        assert "₹280" in reply["answer"]


def test_tells_about_one_hotel_by_name(bot):
    reply = bot.reply("Is Ginza Pearl Hotel good?")
    assert reply["found"] is True
    assert reply["topic"] == "hotel"
    assert "Tokyo" in reply["answer"] and "8.6" in reply["answer"] and "4-star" in reply["answer"]
    assert "15:00" in reply["answer"]


def test_flights_between_a_departure_city_and_a_country_give_count_and_lowest_fare(bot, catalog):
    reply = bot.reply("flights from Delhi to Japan")
    assert reply["found"] is True
    assert reply["topic"] == "flights"
    japan = {a for c in catalog.countries["Japan"].cities for a in c.airports}
    outbound = [f for f in catalog.flights.values() if f.origin == "DEL" and f.destination in japan]
    assert outbound
    assert str(len(outbound)) in reply["answer"]
    assert inr(min(f.price_per_seat for f in outbound)) in reply["answer"]


def test_flights_accept_airport_codes(bot):
    reply = bot.reply("any flight BLR to Dubai?")
    assert reply["topic"] == "flights"
    assert reply["found"] is True


def test_flights_without_a_route_say_where_we_fly_from_and_to(bot):
    reply = bot.reply("Do you have flights?")
    assert reply["found"] is True
    assert reply["topic"] == "flights"
    for city in ["Bengaluru", "Delhi", "Mumbai", "Chennai"]:
        assert city in reply["answer"]


def test_lists_destinations(bot):
    reply = bot.reply("Which countries can I travel to?")
    assert reply["found"] is True
    assert reply["topic"] == "destinations"
    for name in ["Japan", "United Arab Emirates", "Tokyo", "Dubai"]:
        assert name in reply["answer"]


def test_trip_rules_come_from_the_catalog(bot):
    reply = bot.reply("What is the minimum number of nights?")
    assert reply["found"] is True
    assert reply["topic"] == "rules"
    assert "3" in reply["answer"] and "10" in reply["answer"]
    assert "1 April 2027" in reply["answer"]


def test_a_city_alone_gives_a_short_summary(bot):
    reply = bot.reply("Osaka")
    assert reply["found"] is True
    assert reply["topic"] == "city"
    assert "Japan" in reply["answer"]


def test_help_answers_come_from_the_database(bot, store):
    reply = bot.reply("How do I cancel my booking?")
    assert reply["found"] is True
    assert reply["topic"] == "faq"
    with store.db.transaction() as conn:
        stored = [row["answer"] for row in conn.execute("SELECT answer FROM help_answers")]
    assert reply["answer"] in stored


def test_help_table_is_seeded_once_however_often_the_bot_starts(catalog, store):
    ChatBot(catalog, store)
    ChatBot(catalog, store)
    with store.db.transaction() as conn:
        topics = [row["topic"] for row in conn.execute("SELECT topic FROM help_answers")]
    assert len(topics) == len(set(topics)) > 5


def test_looks_up_a_booking_by_its_ten_digit_number(bot, store, catalog):
    number = "1234567890"
    package = {
        "country": "Japan", "cities": ["Tokyo", "Kyoto"], "start_date": "2027-04-10",
        "end_date": "2027-04-16", "traveler": {"adults": 2, "child_ages": [6]}, "total_inr": 231924,
    }
    with store.db.transaction() as conn:
        conn.execute(
            "INSERT INTO packages VALUES ('P1', 1, 'CONFIRMED', '{}', '{}', 'now', 'now')")
        conn.execute("INSERT INTO reservations VALUES (?, 'P1', ?, 'now')",
                     (number, json.dumps({"package": package})))
    reply = bot.reply(f"status of booking {number}")
    assert reply["found"] is True
    assert reply["topic"] == "booking"
    for part in [number, "Japan", "Tokyo", "Kyoto", "10 April 2027", "16 April 2027", "2 adults", "1 child", "₹2,31,924"]:
        assert part in reply["answer"]


def test_an_unknown_booking_number_is_not_guessed(bot):
    reply = bot.reply("booking 9999999999")
    assert reply["found"] is False
    assert reply["topic"] == "booking"
    assert "9999999999" in reply["answer"]


@pytest.mark.parametrize("question", [
    "hotels in Paris",
    "What is the weather in Tokyo tomorrow?",
    "who won the cricket match",
    "asdfgh qwerty",
    "Can I bring my dog?",
])
def test_says_it_has_no_idea_instead_of_guessing(bot, question):
    reply = bot.reply(question)
    assert reply["found"] is False
    assert reply["topic"] == "unknown"
    assert "no idea" in reply["answer"].lower()


def test_every_reply_offers_follow_up_questions(bot):
    for question in ["hi", "hotels in Tokyo", "nonsense words here"]:
        suggestions = bot.reply(question)["suggestions"]
        assert 1 <= len(suggestions) <= 4
        assert all(isinstance(s, str) and s for s in suggestions)


def test_the_same_question_always_gets_the_same_answer(bot):
    assert bot.reply("things to do in Dubai") == bot.reply("things to do in Dubai")


def test_a_short_form_of_a_long_name_is_understood(bot):
    reply = bot.reply("Tell me about Burj Khalifa")
    assert reply["topic"] == "attraction"
    assert "Burj Khalifa At the Top" in reply["answer"]


def test_cheapest_hotels_are_listed_by_lowest_room_price(bot, catalog):
    reply = bot.reply("cheapest hotel in Osaka")
    assert reply["topic"] == "hotels"
    assert "lowest price first" in reply["answer"]
    prices = [int(p.replace(",", "")) for p in __import__("re").findall(r"from ₹([\d,]+) a night", reply["answer"])]
    assert prices == sorted(prices) and prices


def test_how_many_nights_is_a_rule_question_not_a_hotel_list(bot):
    assert bot.reply("How many nights can I stay?")["topic"] == "rules"


@pytest.mark.parametrize("question", [
    "what is the best time to visit Japan",
    "is it safe in Dubai",
    "visa for japan",
    "Do you have trains?",
    "hotels near me",
])
def test_broad_questions_with_something_we_lack_get_no_idea(bot, question):
    reply = bot.reply(question)
    assert reply["found"] is False, reply
    assert "no idea" in reply["answer"].lower()


def test_return_flights_go_the_other_way(bot):
    reply = bot.reply("flights from Tokyo to Delhi")
    assert reply["found"] is True
    assert "from Tokyo to Delhi" in reply["answer"]
