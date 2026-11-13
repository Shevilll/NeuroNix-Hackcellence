"""POST /api/chat: the help chatbot. Answers come only from our data (catalog and SQLite); no AI."""

from typing import Annotated, Literal, Union

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StringConstraints

router = APIRouter()


class ChatQuestion(BaseModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500, strict=True)]


class TextBlock(BaseModel):
    type: Literal["text"]
    text: str


class ListItem(BaseModel):
    name: str
    detail: str


class ListBlock(BaseModel):
    type: Literal["list"]
    items: list[ListItem]


class FactRow(BaseModel):
    label: str
    value: str


class FactsBlock(BaseModel):
    type: Literal["facts"]
    rows: list[FactRow]


class LinkBlock(BaseModel):
    type: Literal["link"]
    text: str
    href: str


Block = Annotated[Union[TextBlock, ListBlock, FactsBlock, LinkBlock], Field(discriminator="type")]


class ChatReply(BaseModel):
    answer: str  # the whole reply as plain text
    found: bool
    topic: str
    blocks: list[Block]  # the same reply split into paragraphs, lists, facts and links for the chat panel
    suggestions: list[str]


@router.post("/chat", response_model=ChatReply)
def chat(body: ChatQuestion, request: Request) -> dict:
    return request.app.state.chatbot.reply(body.question)
