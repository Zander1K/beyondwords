"""describe_book(metadata): a little background for a book the library has just stored (Nemotron).

Fills `setting_era` and `description_spoiler_free`, which the definition, question and
illustration routes pass to the model as context. Metadata only: never book text, never spoilers.
The model is told to answer null when it does not know the book, because a missing answer is far
better than a wrong one that then steers every explanation.
"""

import json

from pydantic import BaseModel, Field

from app.brain.llm import LLMClient, Message, get_llm
from app.brain.prompts import load_prompt
from app.brain.settings import get_brain_settings
from app.brain.structured import chat_json

MAX_DESCRIPTION_WORDS = 40


class BookBackground(BaseModel):
    setting_era: str | None = Field(default=None, max_length=255)
    description_spoiler_free: str | None = None


def _tidy(value: str | None) -> str | None:
    value = " ".join((value or "").split())
    return value or None


async def describe_book(
    *,
    title: str,
    author: str | None,
    year: int | None,
    genre: str | None,
    llm: LLMClient | None = None,
) -> BookBackground:
    payload = {"title": title, "author": author, "year": year, "genre": genre}
    draft = await chat_json(
        llm or get_llm(),
        [
            Message(role="system", content=load_prompt("describe_book.v1")),
            Message(role="user", content=json.dumps(payload, ensure_ascii=False)),
        ],
        BookBackground,
        max_tokens=250,
        reasoning=False,
        timeout_s=get_brain_settings().cover_timeout_s,
    )
    description = _tidy(draft.description_spoiler_free)
    if description and len(description.split()) > MAX_DESCRIPTION_WORDS:
        description = None  # not the short, spoiler-free line asked for: better none
    return BookBackground(
        setting_era=_tidy(draft.setting_era), description_spoiler_free=description
    )
