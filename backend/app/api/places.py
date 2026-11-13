"""GET /api/places: where each attraction and hotel is, so the plan can show the travel time between
visits, and from the hotel to the first visit of a day and back after the last."""

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/places")
def places(request: Request) -> dict:
    catalog = request.app.state.catalog
    found = {a.attraction_id: {"lat": a.lat, "lng": a.lng} for a in catalog.attractions.values()}
    found.update({h.hotel_id: {"lat": h.lat, "lng": h.lng} for h in catalog.hotels.values()})
    return found
