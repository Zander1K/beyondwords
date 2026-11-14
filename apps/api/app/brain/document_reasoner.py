"""Everyday mode: bill or letter -> "what to do, by when, how much" (SOP 7.7). POST /document.

    card = await read_document(ocr_lines=lines, image=jpeg_bytes)
    card.summary   # three short lines to read aloud

Privacy (SOP 10): nothing is stored, not even in memory: the lines and card are returned and
forgotten. Callers must not write the request, lines or card to MariaDB or logs; this module
only logs counts.

Follow-ups: the phone keeps the document's OCR lines and sends them back with the question;
the router passes `document_page(lines)` to `agent.ask(current_page=...)`, so answers cite
"doc:L3" without the server holding the document.

Checks after the model (SOP 11): cited lines must exist; the deadline and amount must
appear in the printed text, otherwise they are dropped and the reader is asked to re-capture
rather than told a wrong date or sum.
"""

import json
import logging
import uuid
from datetime import date

from pydantic import BaseModel, Field

from app.brain.llm import LLMClient, Message, get_llm, image_part, text_part
from app.brain.prompts import load_prompt
from app.brain.settings import get_brain_settings
from app.brain.structured import chat_json
from app.brain.text_utils import normalise
from app.schemas.brain import ActionCard, CapturedPage, Money
from app.schemas.page import Line, OcrLine

logger = logging.getLogger(__name__)

PROMPT_VERSION = "document_reasoner.v1"
RECAPTURE_BELOW = 0.5


class _Draft(BaseModel):
    document_type: str
    what_to_do: str
    by_when: str | None = None
    deadline_iso: str | None = None
    how_much: Money | None = None
    cites: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


def document_page(ocr_lines: list[OcrLine]) -> CapturedPage:
    """The document as a page the agent can cite ("doc:L1"), for follow-up questions."""
    return CapturedPage(
        page_id="doc", lines=[Line(id=ln.id, text=ln.text, bbox=ln.bbox) for ln in ocr_lines]
    )


def _appears(fragment: str | None, full_text: str) -> bool:
    return bool(fragment) and normalise(fragment) in full_text


def _valid_iso(value: str | None) -> str | None:
    try:
        return date.fromisoformat(value).isoformat() if value else None
    except ValueError:
        return None


def check_card(doc_id: str, draft: _Draft, ocr_lines: list[OcrLine]) -> ActionCard:
    """Deterministic checks on the model's draft. Pure function: tested and used by eval."""
    full_text = normalise(" ".join(line.text for line in ocr_lines))
    known = {line.id for line in ocr_lines}
    confidence = draft.confidence
    needs_recapture = False

    by_when, deadline_iso = draft.by_when, _valid_iso(draft.deadline_iso)
    if ocr_lines and by_when and not _appears(by_when, full_text):
        by_when, deadline_iso, needs_recapture = None, None, True

    how_much = draft.how_much
    if ocr_lines and how_much and not _appears(how_much.text, full_text):
        how_much, needs_recapture = None, True

    if needs_recapture:
        confidence = min(confidence, 0.4)
    needs_recapture = needs_recapture or confidence < RECAPTURE_BELOW

    summary = [draft.what_to_do.rstrip(".") + "."]
    summary.append(f"By {by_when}." if by_when else "No deadline found.")
    summary.append(f"Amount: {how_much.text}." if how_much else "No amount to pay.")

    return ActionCard(
        doc_id=doc_id,
        document_type=draft.document_type,
        what_to_do=draft.what_to_do,
        by_when=by_when,
        deadline_iso=deadline_iso,
        how_much=how_much,
        summary=summary,
        cites=[c for c in draft.cites if c in known],
        confidence=round(confidence, 2),
        needs_recapture=needs_recapture,
    )


async def read_document(
    *,
    ocr_lines: list[OcrLine],
    image: bytes | None = None,
    llm: LLMClient | None = None,
) -> ActionCard:
    """Raises LLMError if Nemotron is unreachable; the API should say Everyday mode is paused."""
    settings = get_brain_settings()
    doc_id = uuid.uuid4().hex
    payload = {"ocr_lines": [{"id": ln.id, "text": ln.text} for ln in ocr_lines]}
    content: list = [text_part(json.dumps(payload, ensure_ascii=False))]
    if image:
        content.append(image_part(image))
    draft = await chat_json(
        llm or get_llm(),
        [
            Message(role="system", content=load_prompt(PROMPT_VERSION)),
            Message(role="user", content=content),
        ],
        _Draft,
        max_tokens=800,
        reasoning=settings.document_reasoning,
        timeout_s=settings.document_timeout_s,
    )
    card = check_card(doc_id, draft, ocr_lines)
    logger.info(
        "Document read lines=%d confidence=%.2f recapture=%s",
        len(ocr_lines),
        card.confidence,
        card.needs_recapture,
    )
    return card
