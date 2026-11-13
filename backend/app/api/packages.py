"""Package build, export, confirm and reservation lookup."""

import json

from fastapi import APIRouter, Header, HTTPException, Request, Response

from app.changes.operations import ChangeRefused, apply_change, change_report, list_city_plans, list_options
from app.domain.request import RequestInvalid, parse_request
from app.rules.validate import validate_package
from app.store.mvp_store import SoldOut
from app.planner.builder import build_package

router = APIRouter()


def _catalog(request: Request):
    """The catalog minus seats and rooms already used by confirmed reservations (S2)."""
    store = request.app.state.store
    seats, rooms = store.flight_holds(), store.room_holds()
    base = request.app.state.catalog
    if not seats and not rooms:
        return base
    from datetime import date
    return base.with_holds(seats, {(r, date.fromisoformat(n)): k for (r, n), k in rooms.items()})


@router.post("/packages")
def build(payload: dict, request: Request, idempotency_key: str | None = Header(default=None)) -> dict:
    catalog, store = _catalog(request), request.app.state.store
    try:
        trip = parse_request(payload, catalog)
    except RequestInvalid as error:
        raise HTTPException(
            422, detail=[{"loc": ["body", f], "msg": m} for f, m in error.errors.items()]
        ) from error
    result = build_package(trip, catalog)
    if result["status"] == "OK":
        pid = store.save_package(result["package"], idempotency_key)
        result["package"] = store.get_package(pid)
        result["package_id"] = pid
        saved = {}
        for name, alt in result.pop("alternatives").items():
            alt_id = store.save_package(alt, f"{idempotency_key}:{name}" if idempotency_key else None)
            saved[name] = {"package_id": alt_id, "package": store.get_package(alt_id)}
        result["alternatives"] = saved
    return result


def _package(request: Request, pid: str) -> dict:
    package = request.app.state.store.get_package(pid)
    if package is None:
        raise HTTPException(404, detail="not found")
    return package


@router.get("/packages/{pid}")
def get_package(pid: str, request: Request) -> dict:
    return _package(request, pid)


@router.get("/packages/{pid}/export")
def export(pid: str, request: Request) -> Response:
    package = _package(request, pid)
    return Response(
        json.dumps(package, indent=2), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="trip-{pid}.json"'},
    )


@router.post("/packages/{pid}/confirm")
def confirm(pid: str, request: Request, response: Response,
            idempotency_key: str | None = Header(default=None)) -> dict:
    if not idempotency_key:
        raise HTTPException(400, detail="Idempotency-Key header is required")
    from datetime import date
    base = request.app.state.catalog

    def check(package, held_seats, held_rooms):
        view = base.with_holds(held_seats, {(r, date.fromisoformat(n)): k for (r, n), k in held_rooms.items()})
        bad = [v for v in validate_package(package, view) if v["code"] in ("FLIGHT_SEATS", "ROOMS_LEFT")]
        return bad[0]["message"] if bad else None

    try:
        body, replayed = request.app.state.store.confirm(pid, idempotency_key, check)
    except SoldOut as gone:
        raise HTTPException(409, detail={"code": "SOLD_OUT", "message": f"Sorry, the last seats or rooms were just booked: {gone}"}) from gone
    if body is None:
        raise HTTPException(404, detail="not found")
    if replayed:
        response.headers["Idempotent-Replay"] = "true"
    return body


@router.get("/reservations/{number}")
def reservation(number: str, request: Request) -> dict:
    body = request.app.state.store.get_reservation(number)
    if body is None:
        raise HTTPException(404, detail="not found")
    return body


@router.get("/packages/{pid}/options/{kind}")
def options(pid: str, kind: str, request: Request, city: str | None = None, role: str | None = None) -> list:
    package = _package(request, pid)
    if kind not in ("hotels", "flights", "attractions"):
        raise HTTPException(404, detail="not found")
    if kind == "hotels" and city is None:
        raise HTTPException(422, detail="city is required")
    if kind == "flights" and role not in ("arrival_flight", "return_flight"):
        raise HTTPException(422, detail="role must be arrival_flight or return_flight")
    return list_options(package, _catalog(request), kind, city=city, role=role)


@router.get("/packages/{pid}/city-plans")
def city_plans_route(pid: str, request: Request) -> list:
    return list_city_plans(_package(request, pid), _catalog(request))


@router.post("/packages/{pid}/changes")
def change(pid: str, payload: dict, request: Request) -> dict:
    package = _package(request, pid)
    store = request.app.state.store
    expected = payload.get("expected_version", package.get("version", 1))
    if expected != package.get("version", 1):
        raise HTTPException(409, detail={"message": "The package changed in another tab.", "package": package})
    try:
        updated = apply_change(package, _catalog(request), payload)
    except ChangeRefused as refusal:
        raise HTTPException(422, detail={"message": refusal.reason, "violations": refusal.violations}) from refusal
    outcome = store.update_package(pid, updated, expected)
    if outcome == "booked":
        raise HTTPException(409, detail={"message": "This package is already booked."})
    if outcome == "conflict":
        raise HTTPException(409, detail={"message": "The package changed in another tab.", "package": store.get_package(pid)})
    return {"package_id": pid, "package": store.get_package(pid), **change_report(package, updated)}
