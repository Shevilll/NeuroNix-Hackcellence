"""Help answers for the chatbot, kept in the SQLite database (table ``help_answers``).

Each row has a topic, the words that point to it, and the answer. The rows below are written to the
database when the app starts; running that again updates them in place, so it is safe to repeat.
Every answer describes what this site really does. Nothing here is generated.
"""

from __future__ import annotations

from app.store.db import Database

TABLE = """
CREATE TABLE IF NOT EXISTS help_answers (
    topic    TEXT PRIMARY KEY,
    keywords TEXT NOT NULL,
    answer   TEXT NOT NULL
);
"""

# (topic, keywords separated by "|" (a keyword may be several words), answer)
SEED: tuple[tuple[str, str, str], ...] = (
    ("how-to-book",
     "book|reserve|how to plan|plan a trip|make a booking",
     "Fill in the trip form on the Plan a trip page (departure city, country, start date, nights, "
     "travelers and budget) and press Build. Pick one of the packages and press Confirm. You get a "
     "10-digit reservation number that opens your booking again at any time."),
    ("cancel",
     "cancel|cancellation|delete|remove my booking",
     "Open the Bookings page, find your booking and press Delete. Deleting a booking gives its flight "
     "seats and hotel rooms back so other travelers can book them."),
    ("find-booking",
     "find my booking|reservation number|look up|lookup|retrieve|where is my booking|my booking",
     "Type your 10-digit reservation number here and I will look it up, or open the Bookings page "
     "and enter the number there."),
    ("change",
     "change|modify|edit|swap|switch|replace",
     "Open your package and use Change hotel, Change flight, add or remove attractions, or Change "
     "cities. Every change is checked against all trip rules again and re-priced. A change that "
     "would break a rule is refused with the reason."),
    ("budget",
     "budget|afford|too expensive|over budget",
     "Enter your total budget in rupees in the trip form. The package total covers flights, hotels, "
     "transfers and attractions. If nothing fits, the site shows the cheapest total, how much more is "
     "needed, and changes that do fit, such as fewer nights or other start dates."),
    ("children",
     "child|children|kid|kids|infant|baby|family",
     "Add the age of each child in the trip form. Children pay the child price where an attraction or "
     "transfer has one, and rooms are picked so every traveler fits."),
    ("payment",
     "pay|payment|card|upi|refund|refunds|net banking",
     "This site does not take payments. Confirming a package gives you a reservation number and holds "
     "the flight seats and hotel rooms for you."),
    ("currency",
     "currency|inr|rupee|rupees|dollar|dollars|usd",
     "All prices on this site are in Indian rupees (INR)."),
    ("language",
     "language|languages|hindi|tamil|telugu|bengali|marathi|translate",
     "Use the language menu in the header to switch the site between English and 12 Indian languages."),
    ("quick-request",
     "quick request|voice|speak|microphone|mic|plain words",
     "Describe your trip in plain words in the quick request box at the top of the Plan a trip page, "
     "or press the voice button and say it. Then press Fill the form."),
    ("calendar",
     "calendar|ics|reminder",
     "Open your package and press Add to calendar. It downloads an .ics file with every flight, "
     "transfer, hotel stay and visit of your trip."),
    ("check-file",
     "trip file|json|validate|export",
     "Export a package as a trip file (JSON). The Check a trip file page checks any such file against "
     "every trip rule and lists what passes and what does not."),
    ("sold-out",
     "sold out|seats left|no seats|no rooms|hold|holds",
     "Each confirmed booking holds its flight seats and hotel rooms. When the last seats or rooms are "
     "taken, a new booking that needs them is refused, and the planner looks for other options."),
    ("about-chat",
     "ai|llm|chatgpt|robot|who are you|what are you|are you human",
     "I am the help chat of Build My Holiday. I do not use AI. I only answer from this site's own "
     "data: hotels, things to do, flights, destinations, trip rules and your bookings. If the data "
     "has no answer, I say so."),
)


def seed(db: Database) -> None:
    """Create the table and write the rows. Safe to call on every start."""
    with db.transaction() as conn:
        conn.execute(TABLE)
        conn.executemany(
            "INSERT INTO help_answers (topic, keywords, answer) VALUES (?, ?, ?) "
            "ON CONFLICT(topic) DO UPDATE SET keywords=excluded.keywords, answer=excluded.answer",
            SEED,
        )


def load(db: Database) -> list[tuple[str, list[str], str]]:
    """Every help answer from the database, in a fixed order."""
    with db.transaction() as conn:
        rows = conn.execute("SELECT topic, keywords, answer FROM help_answers ORDER BY rowid").fetchall()
    return [(row["topic"], [k.strip() for k in row["keywords"].split("|") if k.strip()], row["answer"])
            for row in rows]
