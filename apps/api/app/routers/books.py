"""/books endpoints (SOP section 5). Thin layer over app.books.library.

POST /books/identify: barcode (ISBN) -> book record, from our library or Google Books / Open
Library. GET /books/{id}: book metadata for context.
TODO(Matthew/Mick Ola): cover-photo identification via Nemotron (SOP 8.5 step 1).
"""

from functools import lru_cache
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.books.library import Library, LibraryError, LibraryErrorReason
from app.books.providers import BookMetadataClient
from app.config import get_settings
from app.db.repositories.books import BookRepository
from app.db.session import get_session
from app.schemas.books import BookResponse, IdentifyBookRequest, IdentifyBookResponse

router = APIRouter(prefix="/books", tags=["books"])

_STATUS = {
    LibraryErrorReason.INVALID_ISBN: 422,
    LibraryErrorReason.NOT_FOUND: status.HTTP_404_NOT_FOUND,
    LibraryErrorReason.UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
}


@lru_cache
def get_metadata_client() -> BookMetadataClient:
    settings = get_settings()
    return BookMetadataClient(
        http=httpx.AsyncClient(headers={"User-Agent": f"{settings.app_name} (book lookup)"}),
        google_api_key=settings.google_books_api_key,
        timeout_seconds=settings.book_lookup_timeout_seconds,
    )


def get_library(
    session: Annotated[AsyncSession, Depends(get_session)],
    metadata: Annotated[BookMetadataClient, Depends(get_metadata_client)],
) -> Library:
    return Library(BookRepository(session), metadata)


LibraryDep = Annotated[Library, Depends(get_library)]


def _http_error(exc: LibraryError) -> HTTPException:
    return HTTPException(_STATUS[exc.reason], exc.detail or str(exc.reason))


@router.post("/identify", response_model=IdentifyBookResponse)
async def identify_book(body: IdentifyBookRequest, library: LibraryDep) -> IdentifyBookResponse:
    try:
        result = await library.identify_by_isbn(body.isbn)
    except LibraryError as exc:
        raise _http_error(exc) from exc
    return IdentifyBookResponse(
        **BookResponse.model_validate(result.book).model_dump(), cached=result.cached
    )


@router.get("/{book_id}", response_model=BookResponse)
async def get_book(book_id: int, library: LibraryDep) -> BookResponse:
    try:
        book = await library.get(book_id)
    except LibraryError as exc:
        raise _http_error(exc) from exc
    if book is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Book not found")
    return BookResponse.model_validate(book)
