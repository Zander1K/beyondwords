"""Page photo + phone OCR lines -> page JSON (SOP 8.1). Backs POST /page.

    analysis = await analyze_page(page_id="p12", ocr_lines=lines, image=jpeg_bytes, book=book)

One Nemotron vision call per page (SOP 9: never per sentence). The model's draft is then
checked and repaired deterministically, so what reaches the phone is always valid:

- reading_order holds every OCR line id exactly once (missing ids appended top-to-bottom)
- line text and bbox come from phone OCR, which is what the phone highlights; lines where
  Nemotron read different words are reported in ocr_disagreements (SOP 9: re-capture)
- each line's chunks rejoin to its text; otherwise that line is re-chunked locally
- hard words must be on their line, above the confidence floor, not already owned by the
  reader; syllables that do not rejoin to the word are replaced by the dictionary split

No conversation plan: conversation is Gemini's job, not Nemotron's (differs from SOP 8.1).

If Nemotron is unavailable, `fallback_page()` gives reading order + phrase chunks with no
hard words, so reading never stops (SOP 9). The API decides when to use it.
"""

import hashlib
import json
import logging
from collections import OrderedDict

from pydantic import BaseModel, Field

from app.brain.geometry import visual_order
from app.brain.llm import LLMClient, Message, get_llm, image_part, text_part
from app.brain.prompts import load_prompt
from app.brain.settings import get_brain_settings
from app.brain.structured import chat_json
from app.brain.text_utils import (
    letters,
    normalise,
    similarity,
    split_phrases,
    syllabify,
    syllables_match_word,
    word_differences,
    word_in_text,
)
from app.schemas.brain import BookContext, ReaderProfile
from app.schemas.page import (
    Chunk,
    HardWord,
    Line,
    OcrDisagreement,
    OcrLine,
    PageAnalysis,
)

logger = logging.getLogger(__name__)

PROMPT_VERSION = "page_analyzer.v2"
# A line is flagged when OCR and Nemotron read any word differently (text_utils.word_differences).
# A whole-line similarity threshold missed single-word errors: "busted" for "rusted" in a
# 47-character line is still 98% similar.


class _DraftLine(BaseModel):
    id: str
    text: str


class PageDraft(BaseModel):
    """What the model returns. bbox is not asked for: OCR boxes are more precise."""

    reading_order: list[str]
    lines: list[_DraftLine] = Field(default_factory=list)
    chunks: list[Chunk] = Field(default_factory=list)
    hard_words: list[HardWord] = Field(default_factory=list)


_cache: OrderedDict[str, PageAnalysis] = OrderedDict()


def _cache_key(
    page_id: str,
    ocr_lines: list[OcrLine],
    image: bytes | None,
    book: BookContext | None,
    profile: ReaderProfile | None,
) -> str:
    h = hashlib.sha256()
    h.update(PROMPT_VERSION.encode())
    h.update(image or b"")
    for part in (
        page_id,
        json.dumps([line.model_dump() for line in ocr_lines], sort_keys=True),
        book.model_dump_json() if book else "",
        profile.model_dump_json() if profile else "",
    ):
        h.update(part.encode())
    return h.hexdigest()


def image_hash(image: bytes) -> str:
    """sha256 of the photo, for `pages.image_hash`. The photo itself is never stored."""
    return hashlib.sha256(image).hexdigest()


def _visual_order(ocr_lines: list[OcrLine]) -> list[str]:
    # Tilt- and column-aware (geometry.visual_order), not raw image y.
    return visual_order(ocr_lines)


def fallback_page(page_id: str, ocr_lines: list[OcrLine]) -> PageAnalysis:
    """Phone-OCR-only analysis: top-to-bottom order and local phrase chunks. No model call."""
    order = _visual_order(ocr_lines)
    by_id = {line.id: line for line in ocr_lines}
    return PageAnalysis(
        page_id=page_id,
        reading_order=order,
        lines=[Line(id=line.id, text=line.text, bbox=line.bbox) for line in ocr_lines],
        chunks=[
            Chunk(line=line_id, text=piece)
            for line_id in order
            for piece in split_phrases(by_id[line_id].text)
        ],
        hard_words=[],
    )


def _build_messages(
    ocr_lines: list[OcrLine],
    image: bytes | None,
    book: BookContext | None,
    profile: ReaderProfile | None,
) -> list[Message]:
    payload = {
        "book": book.model_dump(exclude_none=True) if book else None,
        "reader": (profile or ReaderProfile()).model_dump(),
        "ocr_lines": [{"id": line.id, "text": line.text, "bbox": line.bbox} for line in ocr_lines],
    }
    content: list = [text_part(json.dumps(payload, ensure_ascii=False))]
    if image:
        content.append(image_part(image))
    else:
        content.append(text_part("No photo available: work from the OCR lines only."))
    return [
        Message(role="system", content=load_prompt(PROMPT_VERSION)),
        Message(role="user", content=content),
    ]


def repair(
    page_id: str,
    draft: PageDraft,
    ocr_lines: list[OcrLine],
    *,
    profile: ReaderProfile | None = None,
    compare_text: bool = True,
    lang: str = "en_GB",
) -> PageAnalysis:
    """Turn a model draft into a valid PageAnalysis. Pure function: easy to test and eval."""
    settings = get_brain_settings()
    by_id = {line.id: line for line in ocr_lines}

    # Reading order: known ids, no duplicates, anything missing appended in visual order.
    order: list[str] = []
    for line_id in draft.reading_order:
        if line_id in by_id and line_id not in order:
            order.append(line_id)
    order += [line_id for line_id in _visual_order(ocr_lines) if line_id not in order]

    # Lines from OCR; record disagreements with what Nemotron read in the photo.
    disagreements: list[OcrDisagreement] = []
    if compare_text:
        for draft_line in draft.lines:
            ocr = by_id.get(draft_line.id)
            if not ocr or not draft_line.text.strip():
                continue
            if word_differences(ocr.text, draft_line.text):
                score = similarity(ocr.text, draft_line.text)
                disagreements.append(
                    OcrDisagreement(
                        line=ocr.id,
                        ocr_text=ocr.text,
                        model_text=draft_line.text,
                        similarity=round(score, 3),
                    )
                )

    # Chunks: keep the model's split for a line only if it rejoins to that line's text.
    model_chunks: dict[str, list[str]] = {}
    for chunk in draft.chunks:
        if chunk.line in by_id and chunk.text.strip():
            model_chunks.setdefault(chunk.line, []).append(chunk.text.strip())
    chunks: list[Chunk] = []
    for line_id in order:
        pieces = model_chunks.get(line_id, [])
        if not pieces or normalise(" ".join(pieces)) != normalise(by_id[line_id].text):
            pieces = split_phrases(by_id[line_id].text)
        chunks.extend(Chunk(line=line_id, text=piece) for piece in pieces)

    # Hard words.
    owned = {letters(w) for w in (profile.owned_words if profile else [])}
    seen: set[str] = set()
    hard_words: list[HardWord] = []
    for hw in draft.hard_words:
        key = letters(hw.word)
        line = by_id.get(hw.line)
        if (
            not key
            or key in seen
            or key in owned
            or hw.confidence < settings.min_hard_word_confidence
            or line is None
            or not word_in_text(hw.word, line.text)
        ):
            continue
        if not syllables_match_word(hw.syllables, hw.word):
            hw = hw.model_copy(update={"syllables": syllabify(hw.word, lang)})
        seen.add(key)
        hard_words.append(hw)

    return PageAnalysis(
        page_id=page_id,
        reading_order=order,
        lines=[Line(id=line.id, text=line.text, bbox=line.bbox) for line in ocr_lines],
        chunks=chunks,
        hard_words=hard_words,
        ocr_disagreements=disagreements,
    )


async def analyze_page(
    *,
    page_id: str,
    ocr_lines: list[OcrLine],
    image: bytes | None = None,
    book: BookContext | None = None,
    profile: ReaderProfile | None = None,
    llm: LLMClient | None = None,
) -> PageAnalysis:
    """Analyse one page. Raises LLMError if Nemotron is unreachable (use `fallback_page`)."""
    if not ocr_lines:
        return fallback_page(page_id, ocr_lines)

    settings = get_brain_settings()
    key = _cache_key(page_id, ocr_lines, image, book, profile)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]

    draft = await chat_json(
        llm or get_llm(),
        _build_messages(ocr_lines, image, book, profile),
        PageDraft,
        max_tokens=6000,
        reasoning=settings.page_reasoning,
        timeout_s=settings.page_timeout_s,
    )
    lang = (book.language or "en-GB").replace("-", "_") if book else "en_GB"
    analysis = repair(
        page_id, draft, ocr_lines, profile=profile, compare_text=image is not None, lang=lang
    )

    _cache[key] = analysis
    while len(_cache) > settings.page_cache_size:
        _cache.popitem(last=False)
    logger.info(
        "Page analysed page_id=%s lines=%d chunks=%d hard_words=%d disagreements=%d",
        page_id,
        len(analysis.lines),
        len(analysis.chunks),
        len(analysis.hard_words),
        len(analysis.ocr_disagreements),
    )
    return analysis
