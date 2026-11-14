"""Request/response models for POST /words/define (proposed in docs/BRAIN.md, not in the SOP)."""

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
