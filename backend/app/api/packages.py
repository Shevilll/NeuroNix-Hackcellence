"""Package build, export, confirm and reservation lookup."""

import json

from fastapi import APIRouter, Header, HTTPException, Request, Response

from app.domain.request import RequestInvalid, parse_request
from app.planner.builder import build_package

router = APIRouter()


@router.post("/packages")
def build(payload: dict, request: Request, idempotency_key: str | None = Header(default=None)) -> dict:
    catalog, store = request.app.state.catalog, request.app.state.store
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
    body, replayed = request.app.state.store.confirm(pid, idempotency_key)
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
