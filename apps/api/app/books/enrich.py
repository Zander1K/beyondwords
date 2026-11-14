"""Give a newly stored book its background (setting/era and a spoiler-free blurb), after the
request that added it has already answered. Best effort: any failure is logged and ignored, since
a book without that background is still perfectly usable."""

import logging
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.brain.tools.describe_book import BookBackground, describe_book
from app.db.repositories.books import BookRepository
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

Describe = Callable[..., Awaitable[BookBackground]]


async def enrich_book(
    book_id: int,
    *,
    sessions: async_sessionmaker[AsyncSession] = SessionLocal,
    describe: Describe = describe_book,
) -> None:
    try:
        async with sessions() as session:
            books = BookRepository(session)
            book = await books.get(book_id)
            if book is None or (book.setting_era and book.description_spoiler_free):
                return
            background = await describe(
                title=book.title,
                author=book.author,
                year=book.publication_year,
                genre=book.genre,
            )
            await books.set_context(
                book_id, background.setting_era, background.description_spoiler_free
            )
    except Exception:
        logger.warning("Could not add background to book %s", book_id, exc_info=True)
