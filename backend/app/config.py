"""Paths and settings, overridable with environment variables."""

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    images_dir: Path
    db_path: Path
    cors_origins: tuple[str, ...]


def load_settings() -> Settings:
    return Settings(
        data_dir=Path(os.environ.get("HOLIDAY_DATA_DIR", REPO_DIR / "data")),
        images_dir=Path(os.environ.get("HOLIDAY_IMAGES_DIR", REPO_DIR / "images")),
        db_path=Path(os.environ.get("HOLIDAY_DB_PATH", BACKEND_DIR / "var" / "holiday.db")),
        cors_origins=tuple(
            os.environ.get(
                "HOLIDAY_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
        ),
    )
