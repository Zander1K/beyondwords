"""Check answers against captured pages and book metadata (SOP 8.2, 8.5, 11 technique 3).

Answers mark every claim with a citation: "[p12:L2]" for a line the reader has captured, or
"[book]" for background from the book record (era, setting, genre). A sentence is kept only
if it has at least one citation that resolves. Everything about plot or characters must cite
captured lines, so nothing beyond what the reader has read can be cited: that is the
no-spoiler rule, enforced by construction.

A short question back to the reader ("Want a picture of it?") is allowed without a citation.
"""

import re

from pydantic import BaseModel, Field

from app.brain.text_utils import sentences
from app.schemas.brain import Citation

_CITE_BLOCK = re.compile(r"\s*\[([^\]]+)\]")
_CITE_ITEM = re.compile(r"^(?:(?P<page>[\w-]+):(?P<line>[\w-]+)|(?P<book>book))$", re.I)
MAX_UNCITED_QUESTION_WORDS = 12


class GroundingResult(BaseModel):
    answer: str
    answer_with_citations: str
    citations: list[Citation] = Field(default_factory=list)
    removed_sentences: list[str] = Field(default_factory=list)

    @property
    def grounded(self) -> bool:
        return bool(self.answer) and not self.removed_sentences


def strip_citations(text: str) -> str:
    text = _CITE_BLOCK.sub("", text)
    return re.sub(r"\s+([.,;:!?])", r"\1", re.sub(r"\s{2,}", " ", text)).strip()


def check_answer(
    text: str, known_lines: dict[str, str], *, book_known: bool = True
) -> GroundingResult:
    """`known_lines` maps "page_id:line_id" to line text, for captured pages only."""
    kept: list[str] = []
    removed: list[str] = []
    citations: dict[str, Citation] = {}

    for sentence in sentences(text):
        valid_any = False
        for block in _CITE_BLOCK.findall(sentence):
            for item in (part.strip() for part in block.split(",")):
                match = _CITE_ITEM.match(item)
                if not match:
                    continue
                if match.group("book"):
                    valid_any = valid_any or book_known
                    continue
                key = f"{match.group('page')}:{match.group('line')}"
                if key in known_lines:
                    valid_any = True
                    page_id, line_id = key.split(":", 1)
                    citations.setdefault(
                        key, Citation(page_id=page_id, line_id=line_id, text=known_lines[key])
                    )
        plain = strip_citations(sentence)
        is_short_question = plain.endswith("?") and len(plain.split()) <= MAX_UNCITED_QUESTION_WORDS
        if valid_any or (is_short_question and not _CITE_BLOCK.search(sentence)):
            kept.append(sentence)
        elif plain:
            removed.append(plain)

    with_cites = " ".join(kept)
    return GroundingResult(
        answer=strip_citations(with_cites),
        answer_with_citations=with_cites,
        citations=list(citations.values()),
        removed_sentences=removed,
    )
