"""The help chatbot: plain rules over our own data, no AI.

A question is matched, in this order, against:

1. a 10-digit reservation number (looked up in the SQLite store),
2. a greeting or a thank-you,
3. the name of a hotel or an attraction in the catalog,
4. the help answers kept in the database (table ``help_answers``),
5. flights, hotels in a city, things to do in a city, trip rules, destinations, a city on its own.

Anything else gets an honest "I have no idea" answer. The same question always gets the same answer.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from app.catalog.loader import Catalog
from app.catalog.models import Attraction, Flight, Hotel
from app.chat import help_answers
from app.store.store import Store

LIST_LIMIT = 6

NO_IDEA = ("I have no idea about that. I only answer from this site's own data: hotels, things to do, "
           "flights, destinations, trip rules and your bookings.")

DEFAULT_SUGGESTIONS = ["Hotels in Tokyo", "Things to do in Dubai", "Flights from Delhi to Japan",
                       "How do I cancel a booking?"]

GREETINGS = {"hi", "hello", "hey", "hii", "namaste", "good morning", "good afternoon", "good evening",
             "hi there", "hello there", "hey there"}
THANKS = {"thanks", "thank you", "thank you so much", "thanks a lot", "thx", "ty", "ok thanks", "great thanks"}

CITY_ALIASES = {"bangalore": "Bengaluru", "bombay": "Mumbai", "madras": "Chennai", "new delhi": "Delhi"}
COUNTRY_ALIASES = {"uae": "United Arab Emirates", "emirates": "United Arab Emirates"}

FLIGHT_WORDS = {"flight", "flights", "fly", "flying", "airline", "airlines", "fare", "fares", "airfare"}
HOTEL_WORDS = {"hotel", "hotels", "stay", "stays", "room", "rooms", "accommodation", "lodging", "resort"}
CHEAP_WORDS = {"cheap", "cheapest", "cheaper", "lowest", "affordable", "low", "budget", "inexpensive"}
SEE_WORDS = {"attraction", "attractions", "see", "visit", "sightseeing", "sights", "places", "activities",
             "activity", "tour", "tours", "museum", "museums", "temple", "temples"}
SEE_PHRASES = ("things to do", "what to do", "to do in")
RULE_WORDS = {"night", "nights", "minimum", "maximum", "min", "max", "rules", "rule", "dates", "date",
              "longest", "shortest"}
RULE_PHRASES = ("how long", "how many days", "when can")
PLACE_WORDS = {"country", "countries", "destination", "destinations", "cities"}
PLACE_PHRASES = ("where can i go", "where can i travel", "where do you fly", "which places")

# Words that add nothing to a question; left over after removing them, anything else means the
# question asks for something we did not match.
FILLER = {"a", "about", "an", "and", "any", "are", "can", "city", "do", "does", "for", "give", "i", "info",
          "information", "is", "it", "me", "please", "show", "tell", "the", "there", "what", "whats", "have",
          "all", "list", "good", "best", "top", "available", "options", "where", "by", "from", "with", "some",
          "which", "you", "your", "know", "details", "detail", "on", "of", "in", "to"}

_RESERVATION = re.compile(r"(?<!\d)(\d{10})(?!\d)")
_NUMBERISH = re.compile(r"(?<!\d)(\d{5,15})(?!\d)")
_BOOKING_WORDS = re.compile(r"\b(booking|reservation|booked|pnr)\b")
_UNKNOWN_PLACE = re.compile(r"\b(?:in|at|near)\s+([a-z][a-z]+)")
_NOT_A_PLACE = {"my", "the", "a", "an", "your", "this", "that", "budget", "total", "advance", "april"}


def inr(amount: int) -> str:
    """₹ with Indian digit grouping: 231924 -> ₹2,31,924."""
    digits = str(abs(int(amount)))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups + [tail])
    return ("-" if amount < 0 else "") + "₹" + digits


def _day(value: date | str) -> str:
    d = date.fromisoformat(value) if isinstance(value, str) else value
    return f"{d.day} {d:%B %Y}"


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _duration(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"{hours} h {mins} min"
    return f"{hours} h" if hours else f"{mins} min"


def _plural(n: int, word: str, many: str | None = None) -> str:
    return f"{n} {word if n == 1 else (many or word + 's')}"


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _normalize(text: str) -> str:
    return " " + re.sub(r"[^a-z0-9]+", " ", text.lower()).strip() + " "


def _has(norm: str, phrase: str) -> bool:
    return f" {_normalize(phrase).strip()} " in norm


# ----- reply blocks: the structure the chat panel shows (paragraphs, lists, facts, links)

Block = dict[str, Any]


def _text(text: str) -> Block:
    return {"type": "text", "text": text}


def _list(items: list[tuple[str, str]]) -> Block:
    """A list whose item names the panel shows in bold, each with a short detail."""
    return {"type": "list", "items": [{"name": name, "detail": detail} for name, detail in items]}


def _facts(rows: list[tuple[str, str]]) -> Block:
    """Label and value pairs, for example ("Check-in", "from 15:00")."""
    return {"type": "facts", "rows": [{"label": label, "value": value} for label, value in rows if value]}


def _link(text: str, href: str) -> Block:
    """A link to a page of this site (always a path starting with "/")."""
    return {"type": "link", "text": text, "href": href}


def _plain(blocks: list[Block]) -> str:
    """The same content as plain text, one line per paragraph, list item or fact."""
    lines: list[str] = []
    for block in blocks:
        if block["type"] == "list":
            lines += [f"- {i['name']}: {i['detail']}" if i["detail"] else f"- {i['name']}" for i in block["items"]]
        elif block["type"] == "facts":
            lines += [f"{r['label']}: {r['value']}" for r in block["rows"]]
        else:
            lines.append(block["text"])
    return "\n".join(lines)


def _reply(content: str | list[Block], topic: str, found: bool = True,
           suggestions: list[str] | None = None) -> dict[str, Any]:
    """A reply from plain text (each line becomes a paragraph) or from blocks."""
    if isinstance(content, str):
        answer, blocks = content, [_text(line) for line in content.split("\n") if line.strip()]
    else:
        blocks = [b for b in content if b["type"] not in ("list", "facts") or b.get("items") or b.get("rows")]
        answer = _plain(blocks)
    return {"answer": answer, "found": found, "topic": topic, "blocks": blocks,
            "suggestions": (suggestions or DEFAULT_SUGGESTIONS)[:4]}


class ChatBot:
    def __init__(self, catalog: Catalog, store: Store) -> None:
        self.catalog = catalog
        self.store = store
        help_answers.seed(store.db)

        self.cities = {city.name: country.name for country in catalog.countries.values() for city in country.cities}
        self.departures = {d.city: d.airport for d in catalog.departure_cities}
        self.countries = {country.name: country for country in catalog.countries.values()}

        # name -> canonical, longest first so "Abu Dhabi" wins over a shorter overlap
        places: dict[str, str] = {}
        for name in [*self.cities, *self.departures]:
            places[name.lower()] = name
        for alias, name in CITY_ALIASES.items():
            places[alias] = name
        self._places = sorted(places.items(), key=lambda kv: -len(kv[0]))
        countries = {name.lower(): name for name in self.countries} | COUNTRY_ALIASES
        self._countries = sorted(countries.items(), key=lambda kv: -len(kv[0]))

        named: list[tuple[str, str, Any]] = []
        for hotel in catalog.hotels.values():
            named.append((hotel.name, "hotel", hotel))
        for attraction in catalog.attractions.values():
            for name in (attraction.name, *attraction.aliases):
                named.append((name, "attraction", attraction))
        # A short form ("Burj Khalifa" for "Burj Khalifa At the Top") is used only when exactly one
        # record has it and it does not start with a city or country name.
        place_words = {w for key, _ in [*self._places, *self._countries] for w in key.split()}
        short: dict[str, list[tuple[str, Any]]] = {}
        for name, kind, rec in named:
            words = _normalize(name).split()
            if len(words) > 2 and words[0] not in place_words and words[1] not in FILLER:
                short.setdefault(" ".join(words[:2]), []).append((kind, rec))
        full = {_normalize(n).strip() for n, _, _ in named}
        for key, recs in short.items():
            if len({id(r) for _, r in recs}) == 1 and key not in full:
                named.append((key, *recs[0]))
        self._named = sorted(((_normalize(n).strip(), kind, rec) for n, kind, rec in named if n.strip()),
                             key=lambda item: (-len(item[0]), item[0]))

    # ----- entry point

    def reply(self, question: str) -> dict[str, Any]:
        norm = _normalize(question)
        words = set(norm.split())

        number = _RESERVATION.search(question)
        if number:
            return self._booking(number.group(1))
        other = _NUMBERISH.search(question)
        if other and _BOOKING_WORDS.search(norm):
            return _reply(f"{other.group(1)} is not a reservation number. Reservation numbers have exactly "
                          "10 digits.", "booking", found=False, suggestions=["How do I find my booking?"])

        stripped = norm.strip()
        if stripped in GREETINGS:
            return _reply("Hello! Ask me about hotels, things to do, flights, destinations or trip rules, "
                          "or type your 10-digit reservation number.", "greeting")
        if stripped in THANKS:
            return _reply("You are welcome. Ask me anything else about your trip.", "thanks")

        for name, kind, record in self._named:
            if f" {name} " in norm:
                return self._hotel(record) if kind == "hotel" else self._attraction(record)

        cities = self._find(norm, self._places)
        countries = self._find(norm, self._countries)
        codes = [w.upper() for w in norm.split() if w.upper() in self.catalog.airports]
        destination_cities = [c for c in cities if c in self.cities]
        wants_flights = bool(words & FLIGHT_WORDS)
        wants_hotels = bool(words & HOTEL_WORDS) or _has(norm, "where to stay")
        wants_sights = bool(words & SEE_WORDS) or any(_has(norm, p) for p in SEE_PHRASES)

        # Clear questions about a place in our data come first.
        if wants_flights and (cities or countries or codes):
            return self._flights(norm, cities, countries, codes)
        if (wants_hotels or wants_sights) and destination_cities:
            city = destination_cities[0]
            if wants_hotels:
                return self._hotels_in(city, cheapest=bool(words & CHEAP_WORDS))
            return self._sights_in(city)

        faq = self._faq(norm)
        if faq:
            return faq

        # Broad questions get an overview only when they ask nothing else.
        plain = self._only_filler(norm, cities + countries, FLIGHT_WORDS | HOTEL_WORDS | SEE_WORDS | CHEAP_WORDS)
        if wants_flights and plain:
            return self._destinations(topic="flights")
        if (wants_hotels or wants_sights) and plain and not self._names_unknown_place(norm):
            return self._by_country(countries[0] if countries else None, hotels=wants_hotels)

        if words & RULE_WORDS or any(_has(norm, p) for p in RULE_PHRASES):
            return self._rules()

        if words & PLACE_WORDS or any(_has(norm, p) for p in PLACE_PHRASES):
            return self._destinations()

        if destination_cities and self._only_filler(norm, cities + countries):
            return self._city(destination_cities[0])
        if countries and not destination_cities and self._only_filler(norm, countries):
            return self._country(countries[0])

        return self._no_idea()

    # ----- matching helpers

    @staticmethod
    def _find(norm: str, table: list[tuple[str, str]]) -> list[str]:
        found: list[str] = []
        rest = norm
        hits: list[tuple[int, str]] = []
        for key, name in table:
            token = f" {key} "
            pos = rest.find(token)
            if pos >= 0:
                hits.append((pos, name))
                rest = rest.replace(token, " " + "#" * len(key) + " ")
        for _, name in sorted(hits):
            if name not in found:
                found.append(name)
        return found

    def _only_filler(self, norm: str, names: list[str], also: set[str] | frozenset[str] = frozenset()) -> bool:
        rest = norm
        for key, name in [*self._places, *self._countries]:
            if name in names:
                rest = rest.replace(f" {key} ", " ")
        return all(w in FILLER or w in also for w in rest.split())

    def _names_unknown_place(self, norm: str) -> bool:
        m = _UNKNOWN_PLACE.search(norm)
        return bool(m) and m.group(1) not in _NOT_A_PLACE

    def _faq(self, norm: str) -> dict[str, Any] | None:
        best: tuple[int, str, str] | None = None
        for topic, keywords, answer in help_answers.load(self.store.db):
            score = sum(len(k.split()) for k in keywords if _has(norm, k))
            if score and (best is None or score > best[0]):
                best = (score, topic, answer)
        if best is None:
            return None
        follow = {"cancel": ["How do I find my booking?", "How do I book a trip?"],
                  "how-to-book": ["What is the minimum number of nights?", "Which countries can I travel to?"],
                  "change": ["Hotels in Kyoto", "How do I cancel a booking?"]}
        return _reply(best[2], "faq", suggestions=follow.get(best[1], DEFAULT_SUGGESTIONS))

    def _no_idea(self) -> dict[str, Any]:
        return _reply(NO_IDEA, "unknown", found=False)

    # ----- answers

    def _booking(self, number: str) -> dict[str, Any]:
        body = self.store.get_reservation(number)
        if body is None:
            return _reply([_text(f"I have no booking with number {number}. Please check the 10 digits."),
                           _link("Open the Bookings page", "/r")], "booking",
                          found=False, suggestions=["How do I find my booking?", "How do I book a trip?"])
        package = body.get("package") or {}
        traveler = package.get("traveler") or {}
        who = [_plural(int(traveler.get("adults") or 0), "adult")]
        children = len(traveler.get("child_ages") or [])
        if children:
            who.append(_plural(children, "child", "children"))
        trip = str(package.get("country") or "")
        cities = package.get("cities") or []
        if cities:
            trip = f"{trip} ({', '.join(cities)})".strip()
        dates = ""
        if package.get("start_date") and package.get("end_date"):
            dates = f"{_day(package['start_date'])} to {_day(package['end_date'])}"
        total = inr(int(package["total_inr"])) if package.get("total_inr") is not None else ""
        return _reply([_text(f"Booking {number}:"),
                       _facts([("Trip", trip), ("Dates", dates), ("Travelers", " and ".join(who)),
                               ("Total", total)]),
                       _link(f"Open booking {number}", f"/r/{number}")], "booking",
                      suggestions=["How do I change my trip?", "How do I cancel a booking?"])

    def _cheapest_room(self, hotel: Hotel):
        rooms = self.catalog.rooms_of(hotel.hotel_id)
        return min(rooms, key=lambda r: (r.price_per_night, r.room_id)) if rooms else None

    def _hotel_item(self, hotel: Hotel) -> tuple[str, str]:
        room = self._cheapest_room(hotel)
        price = f", rooms from {inr(room.price_per_night)} a night" if room else ""
        return hotel.name, f"{hotel.area}, {hotel.stars}-star, rated {hotel.rating}{price}"

    def _hotels_in(self, city: str, cheapest: bool = False) -> dict[str, Any]:
        hotels = self.catalog.hotels_in(city)
        if not hotels:
            return _reply(f"I have no hotels in {city} in my data.", "hotels", found=False)
        if cheapest:
            def price(h: Hotel) -> int:
                room = self._cheapest_room(h)
                return room.price_per_night if room else 10**12
            hotels = sorted(hotels, key=lambda h: (price(h), h.name))
            order = "lowest price first"
        else:
            hotels = sorted(hotels, key=lambda h: (-h.rating, h.name))
            order = "best rated first"
        blocks = [_text(f"Hotels in {city}, {order}:"), _list([self._hotel_item(h) for h in hotels[:LIST_LIMIT]])]
        if len(hotels) > LIST_LIMIT:
            blocks.append(_text(f"And {len(hotels) - LIST_LIMIT} more."))
        return _reply(blocks, "hotels",
                      suggestions=[f"Things to do in {city}", f"Tell me about {hotels[0].name}", "Flights from Delhi to Japan"
                                   if self.cities[city] == "Japan" else "Flights from Mumbai to Dubai"])

    def _attraction_price(self, a: Attraction) -> str:
        return "free" if a.price_per_person == 0 else f"{inr(a.price_per_person)} per adult"

    def _sights_in(self, city: str) -> dict[str, Any]:
        sights = self.catalog.attractions_in(city)
        if not sights:
            return _reply(f"I have no things to do in {city} in my data.", "attractions", found=False)
        items = [(a.name, f"{a.category.replace('_', ' ').lower()}, {self._attraction_price(a)}, "
                          f"about {_duration(a.visit_minutes)}") for a in sights[:LIST_LIMIT]]
        blocks = [_text(f"Things to do in {city}:"), _list(items)]
        if len(sights) > LIST_LIMIT:
            blocks.append(_text(f"And {len(sights) - LIST_LIMIT} more."))
        return _reply(blocks, "attractions",
                      suggestions=[f"Tell me about {sights[0].name}", f"Hotels in {city}", "What is the minimum number of nights?"])

    def _attraction(self, a: Attraction) -> dict[str, Any]:
        days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        open_days = "Every day" if set(days) <= a.open_days else _join(
            [d.title() for d in days if d in a.open_days])
        ticket = self._attraction_price(a).capitalize() if a.price_per_person == 0 else self._attraction_price(a)
        if a.child_price is not None:
            ticket += ", " + ("free for children" if a.child_price == 0 else f"{inr(a.child_price)} per child")
        blocks = [
            _text(f"{a.name} is a {a.category.replace('_', ' ').lower()} in {a.city}."),
            _facts([
                ("Open", f"{open_days}, {_clock(a.open_from)} to {_clock(a.open_until)}"),
                ("Visit", f"about {_duration(a.visit_minutes)}"),
                ("Ticket", ticket),
                ("Children", "Good for children" if a.child_friendly else "Not marked as good for children"),
                ("Access", "Step-free access" if a.accessible else "No step-free access"),
                ("Closed", _join([_day(d) for d in sorted(a.closed_dates)]) if a.closed_dates else ""),
            ]),
        ]
        return _reply(blocks, "attraction", suggestions=[f"Things to do in {a.city}", f"Hotels in {a.city}"])

    def _hotel(self, h: Hotel) -> dict[str, Any]:
        room = self._cheapest_room(h)
        blocks = [
            _text(f"{h.name} is a {h.stars}-star hotel in {h.area}, {h.city}, rated {h.rating}."),
            _facts([
                ("Check-in", f"from {_clock(h.check_in_from)}"),
                ("Check-out", f"until {_clock(h.check_out_until)}"),
                ("Families", "Family friendly" if h.family_friendly else "Not marked as family friendly"),
                ("Rooms", f"from {inr(room.price_per_night)} a night ({room.name})" if room else ""),
            ]),
        ]
        return _reply(blocks, "hotel", suggestions=[f"Hotels in {h.city}", f"Things to do in {h.city}"])

    def _airports_of(self, place: str) -> set[str]:
        if place in self.departures:
            return {self.departures[place]}
        if place in self.countries:
            return {a for c in self.countries[place].cities for a in c.airports}
        return set(self.catalog.airports_serving(place)) or {
            a for c in self.countries[self.cities[place]].cities if c.name == place for a in c.airports}

    def _flights(self, norm: str, cities: list[str], countries: list[str], codes: list[str]) -> dict[str, Any]:
        home = [c for c in cities if c in self.departures]
        home += [self.catalog.airports[c].city for c in codes if self.catalog.airports[c].city in self.departures
                 and self.catalog.airports[c].city not in home]
        away = [c for c in cities if c in self.cities] + countries
        away += [self.catalog.airports[c].city for c in codes if self.catalog.airports[c].city in self.cities
                 and self.catalog.airports[c].city not in away]

        if not home and not away:
            return _reply("I have no flights for that place in my data.", "flights", found=False)

        def pick(origin_codes: set[str], dest_codes: set[str]) -> list[Flight]:
            return sorted((f for f in self.catalog.flights.values()
                           if f.origin in origin_codes and f.destination in dest_codes),
                          key=lambda f: (f.price_per_seat, f.departure_local, f.flight_id))

        if home and away:
            src, dst = home[0], away[0]
            # "from Tokyo to Delhi": the trip home
            back = _has(norm, f"from {dst}") or _has(norm, f"to {src}")
            a, b = (dst, src) if back else (src, dst)
            flights = pick(self._airports_of(a), self._airports_of(b))
            if not flights:
                return _reply(f"I have no flights from {a} to {b} in my data.", "flights", found=False)
            best = flights[0]
            first = min(f.departure_local for f in flights).date()
            last = max(f.departure_local for f in flights).date()
            nonstop = sum(1 for f in flights if f.stops == 0)
            airlines = sorted({f.airline for f in flights})
            blocks = [
                _text(f"{_plural(len(flights), 'flight')} from {a} to {b}, leaving between {_day(first)} "
                      f"and {_day(last)} ({nonstop} nonstop)."),
                _facts([
                    ("Lowest fare", f"{inr(best.price_per_seat)} per seat, {best.airline} {best.flight_number} "
                                    f"on {_day(best.departure_local.date())}"),
                    ("Airlines", _join(airlines)),
                ]),
            ]
            return _reply(blocks, "flights",
                          suggestions=[f"Flights from {b} to {a}", "What is the minimum number of nights?",
                                       "How do I book a trip?"])

        items: list[tuple[str, str]] = []
        if home:
            src = home[0]
            heading = f"Flights from {src}, by country:"
            for country in self.countries:
                flights = pick({self.departures[src]}, self._airports_of(country))
                if flights:
                    items.append((country, f"{_plural(len(flights), 'flight')}, from {inr(flights[0].price_per_seat)} per seat"))
        else:
            dst = away[0]
            heading = f"Flights to {dst}, by departure city:"
            for city, code in self.departures.items():
                flights = pick({code}, self._airports_of(dst))
                if flights:
                    items.append((city, f"{_plural(len(flights), 'flight')}, from {inr(flights[0].price_per_seat)} per seat"))
        if not items:
            return _reply("I have no such flights in my data.", "flights", found=False)
        return _reply([_text(heading), _list(items)], "flights",
                      suggestions=["Flights from Delhi to Japan", "Hotels in Tokyo"])

    def _by_country(self, country: str | None, *, hotels: bool) -> dict[str, Any]:
        names = [country] if country else list(self.countries)
        what = "Hotels" if hotels else "Things to do"
        items: list[tuple[str, str]] = []
        for name in names:
            for city in self.countries[name].cities:
                n = len(self.catalog.hotels_in(city.name) if hotels else self.catalog.attractions_in(city.name))
                unit = _plural(n, "hotel") if hotels else _plural(n, "thing", "things") + " to do"
                items.append((f"{city.name}, {name}", unit))
        first = self.countries[names[0]].cities[0].name
        return _reply([_text(f"{what} I know about:"), _list(items), _text("Ask about one city for the list.")],
                      "hotels" if hotels else "attractions",
                      suggestions=[f"{what} in {first}", f"{what} in {self.countries[names[-1]].cities[-1].name}"])

    def _rules(self) -> dict[str, Any]:
        r = self.catalog.rules
        blocks = [
            _text("Every trip follows these rules:"),
            _facts([
                ("Trip length", f"{r.min_nights} to {r.max_nights} nights"),
                ("Each city", f"at least {_plural(r.min_nights_per_city, 'night')}"),
                ("First hotel night", f"{_day(r.first_night)} or later"),
                ("Return flight", f"leaves by {_day(r.last_departure)}"),
            ]),
        ]
        return _reply(blocks, "rules", suggestions=["Which countries can I travel to?", "How do I book a trip?"])

    def _destinations(self, topic: str = "destinations") -> dict[str, Any]:
        items = [(name, _join(list(country.city_names))) for name, country in self.countries.items()]
        return _reply([_text(f"You can fly from {_join(list(self.departures))} to:"), _list(items)], topic,
                      suggestions=["Flights from Delhi to Japan", "Hotels in Dubai",
                                   "What is the minimum number of nights?"])

    def _city(self, city: str) -> dict[str, Any]:
        airports = sorted(self._airports_of(city))
        blocks = [
            _text(f"{city} is in {self.cities[city]}."),
            _facts([
                ("Hotels", str(len(self.catalog.hotels_in(city)))),
                ("Things to do", str(len(self.catalog.attractions_in(city)))),
                ("Airports", _join([f"{c} ({self.catalog.airports[c].name})" for c in airports
                                    if c in self.catalog.airports]) if airports else ""),
            ]),
        ]
        return _reply(blocks, "city", suggestions=[f"Hotels in {city}", f"Things to do in {city}"])

    def _country(self, country: str) -> dict[str, Any]:
        cities = list(self.countries[country].city_names)
        return _reply(f"{country}: you can visit {_join(cities)}.", "city",
                      suggestions=[f"Hotels in {cities[0]}", f"Flights from Delhi to {country}"])
