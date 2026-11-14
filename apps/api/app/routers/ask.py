"""POST /ask: the reader's spoken question (as text) -> a short spoken-style answer.

Thin layer over app.brain.qa: Nemotron's reading-coach agent answers every question (SOP 5,
8.2), grounded in the page with a citation for every claim. The phone does speech-to-text and
text-to-speech. Gemini draws a picture when the agent calls its illustrate tool. With a
`user_id`, words the reader asks about go into their word bank (brain/word_bank.py).
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.books.library import Library, LibraryError
from app.brain.qa import QuestionService, QuestionUnavailableError, get_question_service
from app.db.repositories.word_bank import WordBankRepository
from app.db.session import get_session
from app.gemini.context import BookContext as IllustrationBook
from app.gemini.illustrator import GeminiIllustrator
from app.gemini.images import IllustrationService, get_illustration_service
from app.routers.books import get_library
from app.schemas.ask import AskRequest, AskResponse
from app.schemas.brain import BookContext

logger = logging.getLogger(__name__)

router = APIRouter(tags=["conversation"])

Questions = Annotated[QuestionService, Depends(get_question_service)]
Illustrations = Annotated[IllustrationService, Depends(get_illustration_service)]

# SOP section 9: one short spoken line, and reading continues.
PAUSED_MESSAGE = "Explanations are paused. Reading continues."


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


@router.post("/ask", response_model=AskResponse)
async def ask(
    body: AskRequest,
    questions: Questions,
    illustrations: Illustrations,
    library: Annotated[Library, Depends(get_library)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AskResponse:
    book = await _book(library, body.book_id)
    illustration_book = (
        IllustrationBook(**book.model_dump(include=set(IllustrationBook.__dataclass_fields__)))
        if book
        else None
    )
    try:
        reply = await questions.ask(
            body.question,
            book=book,
            page_lines=[(line.id, line.text) for line in body.page_lines],
            current_line_id=body.current_line_id,
            pointed_word=body.pointed_word,
            session_id=body.session_id,
            illustrator=GeminiIllustrator(illustrations, illustration_book),
            user_id=body.user_id,
            words=WordBankRepository(session) if body.user_id is not None else None,
        )
    except QuestionUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PAUSED_MESSAGE) from exc
    return AskResponse(
        session_id=reply.session_id,
        answer=reply.answer,
        cited_lines=reply.cited_lines,
        image_url=reply.image_url,
        used_brain=True,
        tool_steps=reply.tool_steps,
    )


@router.delete("/ask/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(session_id: str, questions: Questions) -> Response:
    """Forget a conversation now (e.g. the reader closes the book)."""
    questions.end_session(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
