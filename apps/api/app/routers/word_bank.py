"""A reader's word bank: the words they looked up or asked about, with the book and the sentence
where they met them. Recording a word also adds a `word_rescued` event to their progress log.

POST /users/{id}/words   a word was looked up or asked about -> saved (or counted again)
GET  /users/{id}/words   their words, most recently looked up first

HACK: anyone who knows a reader's id can use these routes (see db/models.py:User).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Book, User, WordBankEntry
from app.db.repositories.word_bank import list_words, record_word
from app.db.session import get_session
from app.schemas.words import RecordWordRequest, WordBankItem

router = APIRouter(prefix="/users/{user_id}/words", tags=["word bank"])

Session = Annotated[AsyncSession, Depends(get_session)]
UNAVAILABLE = "The user database is unavailable."


def _item(entry: WordBankEntry, book: Book | None) -> WordBankItem:
    return WordBankItem(
        id=entry.id,
        word=entry.word,
        times_rescued=entry.times_rescued,
        status=entry.status,
        last_seen=entry.last_seen,
        context_sentence=entry.context_sentence,
        book_id=entry.book_id,
        book_title=book.title if book else None,
        book_author=book.author if book else None,
    )


async def _check_reader(session: AsyncSession, user_id: int) -> None:
    try:
        user = await session.get(User, user_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE) from exc
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reader not found")


@router.post("", response_model=WordBankItem)
async def save_word(user_id: int, body: RecordWordRequest, session: Session) -> WordBankItem:
    await _check_reader(session, user_id)
    try:
        # A book id that is not in the library is ignored, not an error: the word still counts.
        book = await session.get(Book, body.book_id) if body.book_id else None
        entry = await record_word(
            session,
            user_id,
            body.word,
            sentence=body.sentence,
            book_id=book.id if book else None,
            source=body.source,
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE) from exc
    if entry is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That is not a word to keep.")
    return _item(entry, book)


@router.get("", response_model=list[WordBankItem])
async def my_words(user_id: int, session: Session) -> list[WordBankItem]:
    await _check_reader(session, user_id)
    try:
        rows = await list_words(session, user_id)
    except SQLAlchemyError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, UNAVAILABLE) from exc
    return [_item(entry, book) for entry, book in rows]
