"""A reader's library: scan a book (Nemotron reads the cover or barcode), add one by ISBN, list
their books and open one. The book the reader opened last is their current one, and its id is sent
with every lookup so definitions and answers fit the book.

POST /users/{id}/books/scan      photo (raw body) -> the book, stored and added to their library
POST /users/{id}/books           {isbn} -> the same, from a typed ISBN
GET  /users/{id}/books           their books, current first
PUT  /users/{id}/books/{b}/open  make this their current book

Photos are sent to the model to be read and never stored (CLAUDE.md section 10). The book record is
metadata only, never book text.
HACK: anyone who knows a reader's id can use these routes (see db/models.py:User).
"""

import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.books.enrich import enrich_book
from app.books.library import IdentifiedBook, Library, LibraryError, LibraryErrorReason
from app.brain.llm import LLMError
from app.brain.tools.read_cover import read_cover
from app.db.models import Book, User, UserBook
from app.db.repositories.user_books import link_book, list_user_books, touch_book
from app.db.session import get_session
from app.routers.books import get_library
from app.schemas.books import (
    AddBookRequest,
    BookResponse,
    CoverReadOut,
    ScanBookResponse,
    UserBookResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users/{user_id}/books", tags=["library"])

Session = Annotated[AsyncSession, Depends(get_session)]
LibraryDep = Annotated[Library, Depends(get_library)]

SCAN_PAUSED = "Book scanning is paused. You can type the ISBN instead."
# A phone photo is a few MB; this stops oversized uploads early.
MAX_PHOTO_BYTES = 8 * 1024 * 1024

_STATUS = {
    LibraryErrorReason.INVALID_ISBN: status.HTTP_422_UNPROCESSABLE_ENTITY,
    LibraryErrorReason.NOT_FOUND: status.HTTP_404_NOT_FOUND,
    LibraryErrorReason.UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
}


def _library_error(exc: LibraryError) -> HTTPException:
    return HTTPException(_STATUS[exc.reason], exc.detail or str(exc.reason))


async def _reader_exists(session: AsyncSession, user_id: int) -> None:
    try:
        user = await session.get(User, user_id)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The user database is unavailable."
        ) from exc
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reader not found")


def _entry(link: UserBook, book: Book) -> dict[str, object]:
    return {
        **BookResponse.model_validate(book).model_dump(),
        "last_read_at": link.last_read_at,
        "finished": link.finished_at is not None,
    }


async def _add(
    session: AsyncSession,
    user_id: int,
    identified: IdentifiedBook,
    background: BackgroundTasks,
) -> UserBook:
    try:
        link = await link_book(session, user_id, identified.book.id)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The user database is unavailable."
        ) from exc
    book = identified.book
    if not (book.setting_era and book.description_spoiler_free):
        background.add_task(enrich_book, book.id)  # after the answer: the model is slow
    return link


@router.get("", response_model=list[UserBookResponse])
async def my_books(user_id: int, session: Session) -> list[UserBookResponse]:
    await _reader_exists(session, user_id)
    try:
        rows = await list_user_books(session, user_id)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The user database is unavailable."
        ) from exc
    return [UserBookResponse(**_entry(link, book)) for link, book in rows]


@router.post("", response_model=UserBookResponse)
async def add_book(
    user_id: int,
    body: AddBookRequest,
    session: Session,
    library: LibraryDep,
    background: BackgroundTasks,
) -> UserBookResponse:
    await _reader_exists(session, user_id)
    try:
        identified = await library.identify_by_isbn(body.isbn)
    except LibraryError as exc:
        raise _library_error(exc) from exc
    link = await _add(session, user_id, identified, background)
    return UserBookResponse(**_entry(link, identified.book))


@router.post("/scan", response_model=ScanBookResponse)
async def scan_book(
    user_id: int,
    request: Request,
    session: Session,
    library: LibraryDep,
    background: BackgroundTasks,
) -> ScanBookResponse:
    await _reader_exists(session, user_id)
    photo = await request.body()
    if not photo:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No photo.")
    if len(photo) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "That photo is too large.")
    try:
        cover = await read_cover(photo)
    except LLMError as exc:
        logger.warning("Reading a cover failed", exc_info=True)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, SCAN_PAUSED) from exc
    if not cover.isbn and not cover.title:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "I couldn't read a book in that photo. Try the barcode or front cover, in good light.",
        )
    try:
        identified = await library.identify_from_cover(cover.isbn, cover.title, cover.author)
    except LibraryError as exc:
        raise _library_error(exc) from exc
    link = await _add(session, user_id, identified, background)
    return ScanBookResponse(
        **_entry(link, identified.book),
        cached=identified.cached,
        found_by=identified.found_by,  # type: ignore[arg-type]
        read=CoverReadOut(isbn=cover.isbn, title=cover.title, author=cover.author),
    )


@router.put("/{book_id}/open", response_model=UserBookResponse)
async def open_book(user_id: int, book_id: int, session: Session) -> UserBookResponse:
    """Make this their current book."""
    await _reader_exists(session, user_id)
    try:
        link = await touch_book(session, user_id, book_id)
        book = await session.get(Book, book_id) if link else None
    except SQLAlchemyError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The user database is unavailable."
        ) from exc
    if link is None or book is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That book is not in your library.")
    return UserBookResponse(**_entry(link, book))
