"""S3: POST /api/check validates any trip JSON against every rule."""

from typing import Any

from fastapi import APIRouter, Body, Request

from app.rules.check import check_trip

router = APIRouter()


@router.post("/check")
def check(request: Request, payload: Any = Body(...)) -> dict:
    return check_trip(payload, request.app.state.catalog)
