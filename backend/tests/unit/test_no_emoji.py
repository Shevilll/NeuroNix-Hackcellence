"""House rule: no emoji or pictogram characters. Text the backend sends to the UI (messages, reasons,
suggestions) must be plain words; the frontend draws icons as SVG."""

import re
from pathlib import Path

import pytest

FORBIDDEN = re.compile(
    "[\U0001F000-\U0001FAFF←-⇿⌀-⏿■-◿☀-➿⤀-⥿⬀-⯿️‍]"
)
APP = Path(__file__).resolve().parents[2] / "app"
FILES = sorted(APP.rglob("*.py"))


def test_there_are_files_to_scan():
    assert len(FILES) > 10


@pytest.mark.parametrize("path", FILES, ids=lambda p: str(p.relative_to(APP)))
def test_no_emoji_in_backend_text(path):
    bad = [f"line {n}: {line.strip()}" for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
           if FORBIDDEN.search(line)]
    assert bad == []
