"""Request/response models for illustrations (docs/gemini.md, "Illustrations").

The text is what the reader points at or asks about: a word, a short phrase, or one sentence.
The service does the real validation (one sentence, max 30 words / 200 characters after
whitespace is collapsed); the limits here only stop oversized bodies early.

OPEN QUESTION: the SOP's /ask response promises an image URL; this returns a URL to
GET /illustrations/{id}. Confirm with Alex before the mobile client depends on it.
"""

from typing import Literal

from pydantic import BaseModel, Field


class IllustrateRequest(BaseModel):
    text: str = Field(
        min_length=1,
        max_length=400,
        description="A word, a short phrase, or one sentence (max 30 words, 200 characters).",
        examples=["portcullis", "horse-drawn carriage", "The portcullis groaned upward."],
    )
    setting_era: str | None = Field(
        default=None,
        max_length=255,
        description="Book setting/era from the books table, so the picture fits the book.",
        examples=["medieval England"],
    )


class IllustrateResponse(BaseModel):
    id: str
    text: str = Field(description="The text as illustrated, after whitespace clean-up.")
    kind: Literal["word", "phrase", "sentence"]
    mime_type: str
    url: str = Field(description="Relative URL that serves the image bytes.")
