"""S1: POST /api/quick-request turns a plain-words request, in English or an Indian language, into form
fields and says which language it read (no AI)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.quick.multilingual import parse_multilingual

router = APIRouter()


class QuickRequest(BaseModel):
    text: str = Field(default="", max_length=2000)


@router.post("/quick-request")
def quick_request(body: QuickRequest, request: Request) -> dict:
    return parse_multilingual(body.text, request.app.state.catalog)
