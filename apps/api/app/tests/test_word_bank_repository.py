"""WordBankRepository against a real PostgreSQL (migrated). Skipped unless TEST_DATABASE_URL is
set, e.g. TEST_DATABASE_URL=postgresql+asyncpg://reading:reading@127.0.0.1:5432/reading_companion
after `make db && make migrate`. Creates one throwaway reader and deletes it afterwards.
"""

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.brain.word_bank import OWNED, Rules, record_page_read, record_rescue
from app.db.models import User, WordBankEntry
from app.db.repositories.word_bank import WordBankRepository

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

PAGE = [("L1", "and a sentry waved him through.")]
DAY1 = datetime(2026, 11, 14, 10, 0, tzinfo=UTC)


@pytest.fixture
async def sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(URL or "")
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def reader(sessions: async_sessionmaker[AsyncSession]) -> AsyncIterator[int]:
    async with sessions() as s:
        user = User(username=f"wbtest-{uuid.uuid4().hex[:12]}")
        s.add(user)
        await s.commit()
        user_id = user.id
    yield user_id
    async with sessions() as s:  # word_bank rows go with the user (ON DELETE CASCADE)
        await s.execute(delete(User).where(User.id == user_id))
        await s.commit()


async def test_rescue_to_owned_is_stored(
    sessions: async_sessionmaker[AsyncSession], reader: int
) -> None:
    rules = Rules(owned_after_solo_reads=3, one_solo_read_per_day=True)
    async with sessions() as s:
        store = WordBankRepository(s)
        await record_rescue(store, reader, "Sentry", sentence=PAGE[0][1], book_id=0, now=DAY1)
        for day in (1, 2, 3):
            await record_page_read(
                store, reader, PAGE, mode="solo", now=DAY1 + timedelta(days=day), rules=rules
            )
    async with sessions() as s:
        rows = (await s.execute(select(WordBankEntry).where(WordBankEntry.user_id == reader))).all()
        (row,) = [r[0] for r in rows]
        assert (row.word, row.status, row.times_rescued, row.solo_reads, row.book_id) == (
            "sentry",
            OWNED,
            1,
            3,
            None,
        )
        assert row.context_sentence == PAGE[0][1]


async def test_two_first_rescues_at_once_make_one_row(
    sessions: async_sessionmaker[AsyncSession], reader: int
) -> None:
    async def rescue_once() -> None:
        async with sessions() as s:
            await record_rescue(WordBankRepository(s), reader, "portcullis")

    await asyncio.gather(rescue_once(), rescue_once())
    async with sessions() as s:
        words = await WordBankRepository(s).get_words(reader)
    assert [w.word for w in words] == ["portcullis"]
