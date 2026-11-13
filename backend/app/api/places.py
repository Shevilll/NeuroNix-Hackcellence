"""GET /api/places: where each attraction is, so the plan can show the travel time between visits."""

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/places")
def places(request: Request) -> dict:
    return {a.attraction_id: {"lat": a.lat, "lng": a.lng} for a in request.app.state.catalog.attractions.values()}
