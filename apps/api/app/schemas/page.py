"""Page JSON schema (SOP section 8.1): output of POST /page, produced by brain/page_analyzer.py.

Shared contract: the phone (Alex) renders from it and the API (Mick Ola) returns and stores
it. Field names follow SOP 8.1, except `conversation_plan`, which is left out: conversation is
Gemini's job, not Nemotron's (team decision 2026-11-14, differs from the SOP). Changes need a
note to both owners.

Decisions recorded here (see docs/BRAIN.md):
- bbox is [x, y, width, height] normalised to 0-1 of the page photo (top-left origin), so
  it is independent of camera resolution. Resolves OPEN QUESTION 3 (proposal, confirm with Alex).
- Line ids are per page ("L1", "L2", ..., "caption_1").
"""

from pydantic import BaseModel, Field

BBox = list[float]  # [x, y, w, h], each 0-1


class OcrLine(BaseModel):
    """One line from on-device OCR, sent by the phone with the page photo."""

    id: str = Field(description='Line id assigned by the phone, e.g. "L1"')
    text: str
    bbox: BBox = Field(min_length=4, max_length=4)
    confidence: float | None = Field(default=None, ge=0, le=1)


class Line(BaseModel):
    id: str
    text: str
    bbox: BBox = Field(min_length=4, max_length=4)


class Chunk(BaseModel):
    """A phrase for the synced read-along highlight (phrase level, never single words)."""

    line: str
    text: str


class HardWord(BaseModel):
    word: str
    line: str
    syllables: list[str]
    say_as: str = Field(description="Pronunciation respelling, stressed syllable in caps")
    meaning: str = Field(description="Plain meaning in the context of this book")
    illustratable: bool
    confidence: float = Field(ge=0, le=1)


class OcrDisagreement(BaseModel):
    """A line where phone OCR and Nemotron read different words (SOP 9: ask to re-capture)."""

    line: str
    ocr_text: str
    model_text: str
    similarity: float = Field(ge=0, le=1)


class PageAnalysis(BaseModel):
    page_id: str
    reading_order: list[str]
    lines: list[Line]
    chunks: list[Chunk]
    hard_words: list[HardWord]
    ocr_disagreements: list[OcrDisagreement] = Field(default_factory=list)
