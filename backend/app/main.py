"""FastAPI application factory."""

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import options, packages
from app.catalog.loader import load_catalog
from app.config import Settings, load_settings
from app.store.mvp_store import Store


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    app = FastAPI(title="Build My Holiday — NeuroNix", version="0.1.0")
    app.state.settings = settings
    app.state.catalog = load_catalog(settings.data_dir)
    app.state.store = Store(settings.db_path)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Idempotent-Replay"],
    )

    api = APIRouter(prefix="/api")

    @api.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    api.include_router(options.router)
    api.include_router(packages.router)
    app.include_router(api)
    return app


app = create_app()
