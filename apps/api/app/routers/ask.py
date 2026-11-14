"""POST /ask: the reader's spoken question (as text) -> a short spoken-style answer.

Thin layer over app.gemini.conversation. SOP section 5 lists POST /ask as the Nemotron agent loop;
in this design Gemini runs the conversation and calls Nemotron through ask_brain(), so the
phone has one endpoint for questions. OPEN QUESTION (Mick Ola + Matthew): agree this split.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.books.library import Library, LibraryError
from app.gemini.context import BookContext, PageLine, ReadingContext
from app.gemini.conversation import (
    ConversationError,
    ConversationService,
    get_conversation_service,
)
from app.routers.books import get_library
from app.schemas.ask import AskRequest, AskResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["conversation"])

Conversation = Annotated[ConversationService, Depends(get_conversation_service)]

# SOP section 9: one short spoken line, and reading continues.
PAUSED_MESSAGE = "Explanations are paused. Reading continues."


async def _book_context(library: Library, book_id: int | None) -> BookContext | None:
    """Book details for the answer. A missing or unreachable book never blocks the question."""
    if book_id is None:
        return None
    try:
        book = await library.get(book_id)
    except LibraryError:
        logger.warning("Book %s unavailable for /ask context; answering without it", book_id)
        return None
    if book is None:
        return None
    return BookContext(
        title=book.title,
        author=book.author,
        publication_year=book.publication_year,
        genre=book.genre,
        setting_era=book.setting_era,
    )


@router.post("/ask", response_model=AskResponse)
async def ask(
    body: AskRequest,
    conversation: Conversation,
    library: Annotated[Library, Depends(get_library)],
) -> AskResponse:
    context = ReadingContext(
        book=await _book_context(library, body.book_id),
        page_lines=[PageLine(id=line.id, text=line.text) for line in body.page_lines],
        current_line_id=body.current_line_id,
    )
    try:
        reply = await conversation.ask(body.question, context, body.session_id)
    except ConversationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, PAUSED_MESSAGE) from exc
    return AskResponse(
        session_id=reply.session_id,
        answer=reply.answer,
        cited_lines=reply.cited_lines,
        image_url=reply.image_url,
        used_brain=reply.used_brain,
        tool_steps=reply.tool_steps,
    )


@router.delete("/ask/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def end_session(session_id: str, conversation: Conversation) -> Response:
    """Forget a conversation now (e.g. the reader closes the book)."""
    conversation.end_session(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
