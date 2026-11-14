"""Data access for the `books` table (shared library, metadata only)."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Book


class BookRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, book_id: int) -> Book | None:
        return await self._session.get(Book, book_id)

    async def get_by_isbn(self, isbn: str) -> Book | None:
        result = await self._session.execute(select(Book).where(Book.isbn == isbn))
        return result.scalar_one_or_none()

    async def add(self, book: Book) -> Book:
        """Insert a book. If another request inserted the same ISBN first, return that row."""
        self._session.add(book)
        try:
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self.get_by_isbn(book.isbn) if book.isbn else None
            if existing is None:
                raise
            return existing
        await self._session.refresh(book)
        return book
