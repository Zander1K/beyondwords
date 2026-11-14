"""Identify a book from its barcode: our library first, then public metadata, then cache it.

SOP 8.5 steps 1-2: "Look up: match in the books table; if missing, fetch metadata from a public
book metadata source and cache it." The cover-photo path (Nemotron reads the title or ISBN off
the cover) is TODO(Matthew/Mick Ola); it will end in the same `identify_by_isbn` call.
"""

import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from sqlalchemy.exc import SQLAlchemyError

from app.books.isbn import InvalidISBNError, normalise_isbn
from app.books.providers import BookMetadata, ProviderError
from app.db.models import Book

logger = logging.getLogger(__name__)


class BookStore(Protocol):
    async def get(self, book_id: int) -> Book | None: ...
    async def get_by_isbn(self, isbn: str) -> Book | None: ...
    async def add(self, book: Book) -> Book: ...


class MetadataSource(Protocol):
    async def lookup(self, isbn13: str) -> BookMetadata | None: ...


class LibraryErrorReason(StrEnum):
    INVALID_ISBN = "invalid_isbn"  # not a book barcode, or a typo
    NOT_FOUND = "not_found"  # valid ISBN, but no source knows it
    UNAVAILABLE = "unavailable"  # database or both metadata sources down


class LibraryError(Exception):
    def __init__(self, reason: LibraryErrorReason, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else str(reason))
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class IdentifiedBook:
    book: Book
    cached: bool  # True when it was already in our library (no external call made)


class Library:
    def __init__(self, store: BookStore, metadata: MetadataSource) -> None:
        self._store = store
        self._metadata = metadata

    async def identify_by_isbn(self, raw: str) -> IdentifiedBook:
        try:
            isbn = normalise_isbn(raw)
        except InvalidISBNError as exc:
            raise LibraryError(LibraryErrorReason.INVALID_ISBN, str(exc)) from exc

        try:
            existing = await self._store.get_by_isbn(isbn)
        except SQLAlchemyError as exc:
            logger.warning("Library lookup failed: database error", exc_info=True)
            raise LibraryError(LibraryErrorReason.UNAVAILABLE, "database unavailable") from exc
        if existing is not None:
            return IdentifiedBook(existing, cached=True)

        try:
            found = await self._metadata.lookup(isbn)
        except ProviderError as exc:
            raise LibraryError(
                LibraryErrorReason.UNAVAILABLE, "book metadata services unavailable"
            ) from exc
        if found is None:
            # Scholia tracks this as "barcodeUnmatched": the barcode path failing at its one job.
            logger.info("No metadata found for ISBN %s", isbn)
            raise LibraryError(LibraryErrorReason.NOT_FOUND, f"no book found for ISBN {isbn}")

        book = Book(
            isbn=found.isbn,
            title=found.title,
            author=found.author,
            publication_year=found.publication_year,
            language=found.language,
            genre=found.genre,
            # Filled later (Nemotron or manual seed); publisher blurbs often contain spoilers.
            setting_era=None,
            description_spoiler_free=None,
            metadata_source=found.source,
        )
        try:
            saved = await self._store.add(book)
        except SQLAlchemyError as exc:
            logger.warning("Library insert failed: database error", exc_info=True)
            raise LibraryError(LibraryErrorReason.UNAVAILABLE, "database unavailable") from exc
        return IdentifiedBook(saved, cached=False)

    async def get(self, book_id: int) -> Book | None:
        try:
            return await self._store.get(book_id)
        except SQLAlchemyError as exc:
            raise LibraryError(LibraryErrorReason.UNAVAILABLE, "database unavailable") from exc
