"""POST /words/define: a word's meaning in context plus a syllable breakdown.

Thin layer over app.brain.tools.define. If the brain is down the route still answers, with only
the rule-based syllable split and `degraded: true`, so reading keeps working (BRAIN.md table).
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends

from app.books.library import Library, LibraryError
from app.brain.llm import LLMError
from app.brain.text_utils import syllabify
from app.brain.tools.define import define_word
from app.routers.books import get_library
from app.schemas.brain import BookContext
from app.schemas.words import DefineWordRequest, DefineWordResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/words", tags=["words"])


async def _book(library: Library, book_id: int | None) -> BookContext | None:
    """Book details for a request. A missing or unreachable book never blocks the answer."""
    if book_id is None:
        return None
    try:
        book = await library.get(book_id)
    except LibraryError:
        logger.warning("Book %s unavailable for context; continuing without it", book_id)
        return None
    return BookContext.model_validate(book, from_attributes=True) if book else None


@router.post("/define", response_model=DefineWordResponse)
async def define(
    body: DefineWordRequest, library: Annotated[Library, Depends(get_library)]
) -> DefineWordResponse:
    book = await _book(library, body.book_id)
    try:
        result = await define_word(body.word, body.sentence, book)
    except LLMError:
        logger.warning("define_word failed; returning the syllable split only", exc_info=True)
        return DefineWordResponse(
            word=body.word,
            syllables=syllabify(body.word),
            say_as="",
            meaning="",
            degraded=True,
        )
    return DefineWordResponse(**result.model_dump())
