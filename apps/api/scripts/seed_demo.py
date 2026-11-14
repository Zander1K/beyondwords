"""Load dummy readers for testing from db/seed/demo_users.json into the configured database.

Writes users (every column), books (metadata only), user_books, word_bank and a few weeks of
reading_events per reader, back-dated so progress and fading-support views have data.
No pages or lines: those come from real captures.

Run from apps/api (uses DATABASE_URL from .env, so check which database that is first):
    uv run python -m scripts.seed_demo           # add demo data (skips if already there)
    uv run python -m scripts.seed_demo --reset   # remove demo data, then add it again
    uv run python -m scripts.seed_demo --delete  # remove demo data only

Demo readers are the usernames starting with "demo_"; demo books have
metadata_source "demo_seed". Deleting a user cascades to their rows in every other table.
"""

import argparse
import asyncio
import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Book,
    ReadingEvent,
    ReadingEventType,
    SupportLevel,
    User,
    UserBook,
    WordBankEntry,
)
from app.db.session import SessionLocal, engine

SEED_FILE = Path(__file__).resolve().parents[3] / "db" / "seed" / "demo_users.json"
DEMO_PREFIX = "demo_"
DEMO_SOURCE = "demo_seed"
# Readers who started one level lower and moved up, so the independence metric has a change.
_PREVIOUS_LEVEL = {
    SupportLevel.READ_ALONG.value: SupportLevel.LISTEN.value,
    SupportLevel.SOLO.value: SupportLevel.READ_ALONG.value,
}


def _ago(now: datetime, days: float, hour: int = 18) -> datetime:
    return (now - timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


async def delete_demo(session: AsyncSession) -> tuple[int, int]:
    users = await session.execute(
        delete(User).where(User.username.startswith(DEMO_PREFIX, autoescape=True))
    )
    # Only drop demo books nobody else is reading.
    in_use = select(UserBook.book_id)
    books = await session.execute(
        delete(Book).where(Book.metadata_source == DEMO_SOURCE, Book.id.not_in(in_use))
    )
    await session.commit()
    return users.rowcount or 0, books.rowcount or 0


async def _book_ids(session: AsyncSession, books: list[dict[str, Any]]) -> dict[str, int]:
    ids: dict[str, int] = {}
    for spec in books:
        fields = {k: v for k, v in spec.items() if k != "key"}
        existing = await session.scalar(
            select(Book.id).where(Book.title == fields["title"], Book.author == fields["author"])
        )
        if existing is None:
            book = Book(**fields, metadata_source=DEMO_SOURCE)
            session.add(book)
            await session.flush()
            existing = book.id
        ids[spec["key"]] = existing
    return ids


def _events(
    user: User, spec: dict[str, Any], book_ids: dict[str, int], now: datetime, rng: random.Random
) -> list[ReadingEvent]:
    events: list[ReadingEvent] = []
    level = spec["support_level"]
    previous = _PREVIOUS_LEVEL.get(level)
    sessions: int = spec["sessions"]
    joined: float = spec["joined_days_ago"]
    switch_at = sessions // 3 if previous else -1

    for i in range(sessions):
        day = joined - (joined * i / max(sessions - 1, 1))
        when = _ago(now, day, hour=rng.choice([7, 16, 17, 19, 20]))
        mode = previous if previous and i < switch_at else level
        if i == switch_at:
            events.append(
                ReadingEvent(
                    user_id=user.id,
                    event_type=ReadingEventType.MODE_CHANGED.value,
                    mode=level,
                    payload={"from": previous, "to": level},
                    created_at=when,
                )
            )
        # The book being read on that day: started before it, not finished before it.
        open_books = [
            b
            for b in spec["books"]
            if b["started_days_ago"] >= day and b.get("finished_days_ago", -1) <= day
        ] or spec["books"]
        book = rng.choice(open_books)
        book_id = book_ids[book["book"]]
        for page in range(rng.randint(1, 4)):
            events.append(
                ReadingEvent(
                    user_id=user.id,
                    book_id=book_id,
                    event_type=ReadingEventType.PAGE_READ.value,
                    mode=mode,
                    duration_seconds=rng.randint(90, 420),
                    payload={"page": str(rng.randint(1, 300))},
                    created_at=when + timedelta(minutes=5 * page),
                )
            )
        words = [w for w in spec["words"] if w["book"] == book["book"]]
        if words and rng.random() < 0.7:
            events.append(
                ReadingEvent(
                    user_id=user.id,
                    book_id=book_id,
                    event_type=ReadingEventType.WORD_RESCUED.value,
                    mode=mode,
                    payload={"word": rng.choice(words)["word"]},
                    created_at=when + timedelta(minutes=2),
                )
            )
        if rng.random() < 0.4:
            events.append(
                ReadingEvent(
                    user_id=user.id,
                    book_id=book_id,
                    event_type=ReadingEventType.QUESTION_ASKED.value,
                    mode=mode,
                    # Kind only: transcripts are never stored.
                    payload={"kind": rng.choice(["word_meaning", "why", "who", "recap"])},
                    created_at=when + timedelta(minutes=3),
                )
            )
    return events


async def seed(session: AsyncSession) -> int:
    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    now = datetime.now(UTC)
    rng = random.Random(2026)  # same data on every run
    book_ids = await _book_ids(session, data["books"])

    for spec in data["users"]:
        user = User(
            username=spec["username"],
            display_name=spec["display_name"],
            support_level=spec["support_level"],
            voice=spec["voice"],
            glasses_type=spec["glasses_type"],
            settings=spec["settings"],
            created_at=_ago(now, spec["joined_days_ago"], hour=12),
        )
        session.add(user)
        await session.flush()

        for b in spec["books"]:
            finished = b.get("finished_days_ago")
            session.add(
                UserBook(
                    user_id=user.id,
                    book_id=book_ids[b["book"]],
                    current_page=b["current_page"],
                    current_line=b["current_line"],
                    started_at=_ago(now, b["started_days_ago"]),
                    last_read_at=_ago(now, b["last_read_days_ago"], hour=20),
                    finished_at=None if finished is None else _ago(now, finished, hour=21),
                )
            )
        for w in spec["words"]:
            first_seen = next(b for b in spec["books"] if b["book"] == w["book"])
            session.add(
                WordBankEntry(
                    user_id=user.id,
                    word=w["word"],
                    book_id=book_ids[w["book"]],
                    page_id=None,  # no captured pages in the seed
                    times_rescued=w["times_rescued"],
                    solo_reads=w["solo_reads"],
                    status=w["status"],
                    last_seen=_ago(now, first_seen["last_read_days_ago"], hour=20),
                    context_sentence=w["context_sentence"],
                    created_at=_ago(now, first_seen["started_days_ago"], hour=19),
                )
            )
        session.add_all(_events(user, spec, book_ids, now, rng))

    await session.commit()
    return len(data["users"])


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--reset", action="store_true", help="remove demo data, then add it again")
    group.add_argument("--delete", action="store_true", help="remove demo data only")
    args = parser.parse_args()

    async with SessionLocal() as session:
        if args.reset or args.delete:
            users, books = await delete_demo(session)
            print(f"Removed {users} demo users and {books} demo books.")
            if args.delete:
                return
        existing = await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.username.startswith(DEMO_PREFIX, autoescape=True))
        )
        if existing:
            print(f"{existing} demo users already exist; use --reset to rebuild them.")
            return
        count = await seed(session)
        print(f"Added {count} demo users.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
