"""GET /api/options: what the request form needs (M1)."""

from fastapi import APIRouter, Request

from app.domain.request import max_travelers

router = APIRouter()


@router.get("/options")
def get_options(request: Request) -> dict:
    catalog = request.app.state.catalog
    rules = catalog.rules
    return {
        "departure_cities": [{"airport": c.airport, "city": c.city} for c in catalog.departure_cities],
        "countries": [{"code": c.code, "name": c.name} for c in catalog.countries.values()],
        "rules": {
            "min_nights": rules.min_nights,
            "max_nights": rules.max_nights,
            "min_nights_per_city": rules.min_nights_per_city,
            "max_travelers": max_travelers(catalog),
            "data_window": {
                "first_night": rules.first_night.isoformat(),
                "last_departure": rules.last_departure.isoformat(),
            },
        },
    }
