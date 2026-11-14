"""Response models for POST /ocr/page: the lines and words Google Cloud Vision found in a frame.

Same shape the web app's on-device reader produces (apps/web/src/vision/ocr.ts), so the reader
does not care which one read the page. All coordinates are normalised 0-1 of the image (top-left
origin).
"""

from pydantic import BaseModel, Field


class Box(BaseModel):
    x: float
    y: float
    w: float
    h: float


class Baseline(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float
    height: float = Field(
        description="Height of the text above the baseline (of the image height)."
    )
    bow: float = Field(
        description="How far the line sags below its chord at the middle (negative = bows up)."
    )


class WordOut(BaseModel):
    text: str
    box: Box
    start: int = Field(description="[start, end) character offsets of the word in the line text.")
    end: int


class LineOut(BaseModel):
    text: str
    box: Box
    baseline: Baseline
    words: list[WordOut]
    confidence: float = Field(description="0-100")
    block: int = Field(description="Which page of an open book (0 = left, 1 = right).")


class OcrPageResponse(BaseModel):
    lines: list[LineOut]
    width: int
    height: int
    blocks: int = Field(description="Pages found: 2 on an open book, 1 on a single page.")
    ms: int = Field(description="Time spent in Google Cloud Vision.")


class OcrStatus(BaseModel):
    available: bool = Field(description="True when a Google Vision key is configured.")
