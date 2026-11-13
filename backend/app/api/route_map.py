"""GET /api/map-points: where every airport, hotel and attraction is, and which airports each flight joins.

The package page uses it to draw the whole route on a map.
"""

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/map-points")
def map_points(request: Request) -> dict:
    catalog = request.app.state.catalog
    return {
        "airports": {a.code: {"lat": a.lat, "lng": a.lng, "name": a.name} for a in catalog.airports.values()},
        "hotels": {h.hotel_id: {"lat": h.lat, "lng": h.lng, "name": h.name} for h in catalog.hotels.values()},
        "attractions": {
            a.attraction_id: {"lat": a.lat, "lng": a.lng, "name": a.name} for a in catalog.attractions.values()
        },
        "flights": {f.flight_id: {"from": f.origin, "to": f.destination} for f in catalog.flights.values()},
    }
