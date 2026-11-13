"""Package build, export, confirm and reservation lookup."""

import json

from fastapi import APIRouter, Header, HTTPException, Request, Response

from app.changes.operations import ChangeRefused, apply_change, change_report, list_city_plans, list_options
from app.domain.request import RequestInvalid, parse_request
from app.rules.validate import validate_package
from app.store.store import ChangeBlocked, IdempotencyKeyReused, SoldOut, demand
from app.planner.builder import build_package

router = APIRouter()


def _catalog(request: Request, own: dict | None = None):
    """The catalog minus seats and rooms already used by confirmed reservations (S2).

    `own` is a booked package being looked at: its own seats and rooms count as free for it, or its
    own flight would look sold out and every alternative would be refused."""
    store = request.app.state.store
    seats, rooms = store.flight_holds(), store.room_holds()
    if own and any(i.get("status") == "BOOKED" for i in own.get("items", [])):
        own_seats, own_rooms = demand(own)
        seats = {f: n - own_seats.get(f, 0) for f, n in seats.items()}
        rooms = {k: n - own_rooms.get(k, 0) for k, n in rooms.items()}
    seats = {f: n for f, n in seats.items() if n > 0}
    rooms = {k: n for k, n in rooms.items() if n > 0}
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
        pid = _save(store, result["package"], idempotency_key, payload)
        result["package"] = store.get_package(pid)
        result["package_id"] = pid
        saved = {}
        for name, alt in result.pop("alternatives").items():
            alt_id = _save(store, alt, f"{idempotency_key}:{name}" if idempotency_key else None, {**payload, "package": name})
            saved[name] = {"package_id": alt_id, "package": store.get_package(alt_id)}
        result["alternatives"] = saved
    return result


def _save(store, package: dict, key: str | None, payload: dict) -> str:
    try:
        return store.save_package(package, key, payload)
    except IdempotencyKeyReused as error:
        raise HTTPException(422, detail={"code": "IDEMPOTENCY_KEY_REUSED",
                                         "message": "That Idempotency-Key was already used for a different request."}) from error


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
    except IdempotencyKeyReused as error:
        raise HTTPException(422, detail={"code": "IDEMPOTENCY_KEY_REUSED",
                                         "message": "That Idempotency-Key was already used for a different request."}) from error
    except SoldOut as gone:
        raise HTTPException(409, detail={"code": "SOLD_OUT", "message": f"Sorry, the last seats or rooms were just booked: {gone}"}) from gone
    if body is None:
        raise HTTPException(404, detail="not found")
    if replayed:
        response.headers["Idempotent-Replay"] = "true"
    return body


@router.get("/reservations")
def reservations(request: Request) -> list:
    """Every booking, newest first, with a short summary of its package."""
    return request.app.state.store.list_reservations()


@router.delete("/reservations")
def delete_all_reservations(request: Request) -> dict:
    """Delete every booking and give all seats and rooms back (resets the demo)."""
    return {"deleted": request.app.state.store.delete_all_reservations()}


@router.delete("/reservations/{number}", status_code=204)
def delete_reservation(number: str, request: Request) -> Response:
    """Delete one booking and give its seats and rooms back. Unknown or already deleted: 404."""
    if not request.app.state.store.delete_reservation(number):
        raise HTTPException(404, detail="not found")
    return Response(status_code=204)


@router.get("/reservations/{number}")
def reservation(number: str, request: Request) -> dict:
    body = request.app.state.store.get_reservation(number)
    if body is None:
        raise HTTPException(404, detail="not found")
    return body


@router.post("/reservations/{number}/changes")
def change_reservation(number: str, payload: dict, request: Request, response: Response,
                       idempotency_key: str | None = Header(default=None)) -> dict:
    """Edit a booking after it is confirmed: same changes as for a package, seats and rooms move with it."""
    from datetime import date
    base = request.app.state.catalog
    store = request.app.state.store

    def view(held_seats, held_rooms):
        return base.with_holds({k: n for k, n in held_seats.items() if n > 0},
                               {(r, date.fromisoformat(n)): k for (r, n), k in held_rooms.items() if k > 0})

    def check(package, held_seats, held_rooms):
        bad = [v for v in validate_package(package, view(held_seats, held_rooms)) if v["code"] in ("FLIGHT_SEATS", "ROOMS_LEFT")]
        return bad[0]["message"] if bad else None

    try:
        body, replayed = store.change_reservation(
            number, idempotency_key, payload,
            apply=lambda package, seats, rooms: apply_change(package, view(seats, rooms), payload),
            report=lambda before, after: change_report(before, after, payload),
            check=check)
    except ChangeRefused as refusal:
        raise HTTPException(422, detail={"message": refusal.reason, "violations": refusal.violations}) from refusal
    except IdempotencyKeyReused as error:
        raise HTTPException(422, detail={"code": "IDEMPOTENCY_KEY_REUSED",
                                         "message": "That Idempotency-Key was already used for a different request."}) from error
    except SoldOut as gone:
        raise HTTPException(409, detail={"code": "SOLD_OUT", "message": f"Sorry, the last seats or rooms were just booked: {gone}"}) from gone
    except ChangeBlocked as blocked:
        if blocked.kind == "missing":
            raise HTTPException(404, detail="not found") from blocked
        raise HTTPException(409, detail={"message": "The booking changed in another tab.",
                                         "package": blocked.package}) from blocked
    if replayed:
        response.headers["Idempotent-Replay"] = "true"
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
    return list_options(package, _catalog(request, own=package), kind, city=city, role=role)


@router.get("/packages/{pid}/city-plans")
def city_plans_route(pid: str, request: Request) -> list:
    package = _package(request, pid)
    return list_city_plans(package, _catalog(request, own=package))


@router.post("/packages/{pid}/changes")
def change(pid: str, payload: dict, request: Request, response: Response,
           idempotency_key: str | None = Header(default=None)) -> dict:
    catalog = _catalog(request)  # read before the change transaction opens
    try:
        body, replayed = request.app.state.store.change_package(
            pid, idempotency_key, payload,
            apply=lambda package: apply_change(package, catalog, payload),
            report=lambda before, after: change_report(before, after, payload))
    except ChangeRefused as refusal:
        raise HTTPException(422, detail={"message": refusal.reason, "violations": refusal.violations}) from refusal
    except IdempotencyKeyReused as error:
        raise HTTPException(422, detail={"code": "IDEMPOTENCY_KEY_REUSED",
                                         "message": "That Idempotency-Key was already used for a different request."}) from error
    except ChangeBlocked as blocked:
        if blocked.kind == "missing":
            raise HTTPException(404, detail="not found") from blocked
        if blocked.kind == "booked":
            raise HTTPException(409, detail={"message": "This package is already booked."}) from blocked
        raise HTTPException(409, detail={"message": "The package changed in another tab.",
                                         "package": blocked.package}) from blocked
    if replayed:
        response.headers["Idempotent-Replay"] = "true"
    return body
