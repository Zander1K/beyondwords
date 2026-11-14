"""Shared test fixtures."""

from collections.abc import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.models import Base


@pytest.fixture
async def db() -> AsyncIterator[AsyncSession]:
    """A real SQLAlchemy session on an empty in-memory SQLite database with every table.

    For testing repositories (upserts, joins) without touching the shared PostgreSQL database.
    """
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()
