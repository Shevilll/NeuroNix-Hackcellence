"""Build the planner page backdrop: a photo collage of catalog attractions.

The photos are the credited ones in images/ATTRIBUTIONS.md (shown on the Photo credits page).
Run from the repo root:  python3 scripts/make_backdrop.py   (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "images" / "attractions"
OUT = ROOT / "frontend" / "public" / "backdrop-collage.jpg"

# Landmarks across every destination in the catalog, ordered so cities mix on the grid.
TILES = [
    "ATT-DXB-001", "ATT-KYO-002", "ATT-AUH-001", "ATT-TYO-011", "ATT-OSA-003",
    "ATT-KYO-003", "ATT-TYO-012", "ATT-DXB-004", "ATT-NAR-002", "ATT-KYO-004",
    "ATT-AUH-002", "ATT-OSA-001", "ATT-TYO-004", "ATT-DXB-007", "ATT-KYO-001",
]
COLS, ROWS = 5, 3
TILE_W, TILE_H = 480, 400
GAP = 0
WHITE = (255, 255, 255)


def main() -> None:
    width = COLS * TILE_W + (COLS + 1) * GAP
    height = ROWS * TILE_H + (ROWS + 1) * GAP
    canvas = Image.new("RGB", (width, height), WHITE)
    for i, name in enumerate(TILES):
        col, row = i % COLS, i // COLS
        with Image.open(SRC / f"{name}.jpg") as photo:
            tile = ImageOps.fit(photo.convert("RGB"), (TILE_W, TILE_H), Image.Resampling.LANCZOS)
        canvas.paste(tile, (GAP + col * (TILE_W + GAP), GAP + row * (TILE_H + GAP)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "JPEG", quality=72, optimize=True, progressive=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({width}x{height}, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
