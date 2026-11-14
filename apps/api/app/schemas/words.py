"""Request/response models for POST /words/define (proposed in docs/BRAIN.md, not in the SOP)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DefineWordRequest(BaseModel):
    word: str = Field(min_length=1, max_length=64, examples=["portcullis"])
    sentence: str = Field(
        default="",
        max_length=1000,
        description="The sentence the word is in, so the meaning fits the context.",
    )
    book_id: int | None = Field(
        default=None, description="From POST /books/identify, so the meaning fits the book."
    )


class DefineWordResponse(BaseModel):
    word: str
    syllables: list[str]
    say_as: str = Field(description="Pronunciation respelling, stressed syllable in caps")
    meaning: str = Field(description="Plain meaning in context. Empty when `degraded` is true.")
    example: str | None = None
    illustratable: bool = False
    degraded: bool = Field(
        default=False,
        description="The brain was unavailable: only the syllable split is real (SOP 9).",
    )


class RecordWordRequest(BaseModel):
    """A reader looked a word up or asked about it."""

    word: str = Field(min_length=1, max_length=64, examples=["portcullis"])
    sentence: str | None = Field(
        default=None, max_length=1000, description="The page line the word was in (kept short)."
    )
    book_id: int | None = Field(default=None, description="The book they were reading.")
    source: Literal["define", "ask"] = Field(
        default="define", description="'define' = tapped for its meaning; 'ask' = asked by voice."
    )


class WordBankItem(BaseModel):
    id: int
    word: str
    times_rescued: int = Field(description="How many times they looked it up.")
    status: str = Field(description="'learning' or 'owned'.")
    last_seen: datetime
    context_sentence: str | None
    book_id: int | None
    book_title: str | None
    book_author: str | None
