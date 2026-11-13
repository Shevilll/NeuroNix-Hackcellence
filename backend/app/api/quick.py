"""S1: POST /api/quick-request turns a plain-words request into form fields (no AI)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.quick.parser import parse_quick_request

router = APIRouter()


class QuickRequest(BaseModel):
    text: str = Field(default="", max_length=2000)


@router.post("/quick-request")
def quick_request(body: QuickRequest, request: Request) -> dict:
    return parse_quick_request(body.text, request.app.state.catalog)
