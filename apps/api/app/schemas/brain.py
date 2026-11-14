"""Inputs and outputs of the brain (Owner: Matthew).

These are what routers pass into, and get back from, `app.brain`:
- BookContext / ReaderProfile / CapturedPage: context the API loads from MariaDB.
- AskResult: POST /ask (reading-coach agent).
- ActionCard: POST /document (Everyday mode).
- PointedWord: the word the phone says the reader is pointing at (POST /ask).
- TraceEvent: one agent step, for WS /trace.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field

from app.schemas.page import Line


def _page_label(value: object) -> object:
    # Printed page labels are text ("12", "xiv"); accept ints from older callers and the model.
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return value.strip() if isinstance(value, str) else value


# Printed page label, matching `pages.page_number` (varchar, roman numerals allowed).
PageLabel = Annotated[str, BeforeValidator(_page_label)]


class BookContext(BaseModel):
    """Book record from the `books` table. Metadata only, never book text (SOP 5)."""

    id: int | None = None
    title: str
    author: str | None = None
    publication_year: int | None = None
    language: str | None = None
    genre: str | None = None
    setting_era: str | None = None
    description_spoiler_free: str | None = None


class ReaderProfile(BaseModel):
    """What the brain needs to tailor flagged words (SOP 11, technique 5)."""

    support_level: Literal["listen", "read_along", "solo"] = "read_along"
    # Words this reader has needed help with; flag them again until owned.
    struggled_words: list[str] = Field(default_factory=list)
    # Words the reader now reads solo; do not flag them.
    owned_words: list[str] = Field(default_factory=list)


class CapturedPage(BaseModel):
    """A page this reader has captured: the grounding source for answers (no spoilers)."""

    page_id: str
    page_number: PageLabel | None = None
    lines: list[Line]


class Citation(BaseModel):
    page_id: str
    line_id: str
    text: str


class AskResult(BaseModel):
    # Plain text for Gemini Live / TTS: citation markers removed.
    answer: str
    # Same answer with markers kept, e.g. "... gate [p12:L2].", for the phone and the trace.
    answer_with_citations: str
    citations: list[Citation] = Field(default_factory=list)
    image_url: str | None = None
    grounded: bool
    # Sentences the grounding check removed (uncited, unknown line or beyond current page).
    removed_sentences: list[str] = Field(default_factory=list)
    tool_steps: int = 0


class Money(BaseModel):
    value: float | None = None
    currency: str | None = None
    text: str


class ActionCard(BaseModel):
    """Everyday mode: "what to do, by when, how much" (SOP 7.7). Never stored."""

    doc_id: str
    document_type: str = Field(description="e.g. utility bill, bank letter, appointment letter")
    what_to_do: str
    by_when: str | None = Field(default=None, description="As written, e.g. '28 November 2026'")
    deadline_iso: str | None = Field(default=None, description="YYYY-MM-DD if known")
    how_much: Money | None = None
    # The three short lines read aloud, in order.
    summary: list[str]
    cites: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    needs_recapture: bool = False


class TraceEvent(BaseModel):
    """One brain step for the demo trace screen (feature 13). Contains no page images."""

    kind: Literal["llm_call", "tool_call", "tool_result", "grounding", "answer", "error"]
    name: str
    detail: dict[str, Any] = Field(default_factory=dict)
    ms: int | None = None


class PointedWord(BaseModel):
    """The word the reader is pointing at, as the phone worked it out (finger tracking and word
    picking run on the phone). Passed to agent.ask so "what does this mean?" is about it."""

    word: str
    line_id: str
    sentence: str | None = None
