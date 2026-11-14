"""A reader's books: which books they have added and which they last opened (`user_books`)."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Book, UserBook


async def _get(session: AsyncSession, user_id: int, book_id: int) -> UserBook | None:
    result = await session.execute(
        select(UserBook).where(UserBook.user_id == user_id, UserBook.book_id == book_id)
    )
    return result.scalar_one_or_none()


async def link_book(session: AsyncSession, user_id: int, book_id: int) -> UserBook:
    """Add the book to the reader's library (or, if it is there, mark it just opened). Commits."""
    now = datetime.now(UTC)
    link = await _get(session, user_id, book_id)
    if link is not None:
        link.last_read_at = now
        link.finished_at = None  # picking a book up again reopens it
        await session.commit()
        return link
    link = UserBook(user_id=user_id, book_id=book_id, last_read_at=now)
    session.add(link)
    try:
        await session.commit()
    except IntegrityError:
        # Two requests added the same book at once; the other one won.
        await session.rollback()
        existing = await _get(session, user_id, book_id)
        if existing is None:
            raise
        return existing
    await session.refresh(link)
    return link


async def touch_book(session: AsyncSession, user_id: int, book_id: int) -> UserBook | None:
    """The reader opened this book (it becomes their current one). None if it is not theirs."""
    link = await _get(session, user_id, book_id)
    if link is None:
        return None
    link.last_read_at = datetime.now(UTC)
    await session.commit()
    return link


async def list_user_books(session: AsyncSession, user_id: int) -> list[tuple[UserBook, Book]]:
    """The reader's books, the one they opened last first."""
    result = await session.execute(
        select(UserBook, Book)
        .join(Book, Book.id == UserBook.book_id)
        .where(UserBook.user_id == user_id)
        .order_by(UserBook.last_read_at.desc().nulls_last(), UserBook.id.desc())
    )
    return [(link, book) for link, book in result.all()]
