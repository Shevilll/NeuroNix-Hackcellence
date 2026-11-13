"""Photos for hotels and attractions, and their credits (images/ATTRIBUTIONS.md must be shown)."""

import re
from pathlib import Path

from fastapi import APIRouter, Request

router = APIRouter()

_LINK = re.compile(r"\[([^\]]*)\]\(([^)]*)\)")


def parse_credits(markdown: str) -> list[dict[str, str]]:
    rows = []
    for line in markdown.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 5 or not cells[0].startswith("`images/"):
            continue
        source, license_ = _LINK.search(cells[2]), _LINK.search(cells[4])
        rows.append({
            "file": cells[0].strip("`"),
            "used_for": cells[1],
            "source_title": source.group(1) if source else cells[2],
            "source_url": source.group(2) if source else "",
            "author": cells[3],
            "license": license_.group(1) if license_ else cells[4],
            "license_url": license_.group(2) if license_ else "",
        })
    return rows


@router.get("/images")
def images(request: Request) -> dict[str, str]:
    catalog = request.app.state.catalog
    out = {}
    for record in (*catalog.hotels.values(), *catalog.attractions.values()):
        if record.image:
            out[getattr(record, "hotel_id", None) or record.attraction_id] = "/" + record.image
    return out


@router.get("/credits")
def credits(request: Request) -> list[dict[str, str]]:
    path = Path(request.app.state.settings.images_dir) / "ATTRIBUTIONS.md"
    return parse_credits(path.read_text(encoding="utf-8")) if path.exists() else []
