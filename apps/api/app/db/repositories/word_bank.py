"""The word bank: words a reader asked about or looked up, with where they met them (`word_bank`).

Every time a reader looks a word up, its row is created or counted again, and a `word_rescued`
event is appended to the progress log (`reading_events`). The context sentence is the one line of
the page the word was in (CLAUDE.md section 5), kept short; no other book text is stored.
"""

import re
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Book, ReadingEvent, ReadingEventType, User, WordBankEntry

MAX_WORD_CHARS = 64
MAX_SENTENCE_CHARS = 300
Source = Literal["define", "ask"]

_EDGES = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)


def clean_word(raw: str) -> str | None:
    """The word as it is stored: trimmed of punctuation, lower case. None if it is not a word
    (a stray mark, a misread with digits in it, or something far too long)."""
    word = _EDGES.sub("", raw.strip()).lower()
    letters = sum(ch.isalpha() for ch in word)
    if letters < 2 or any(ch.isdigit() for ch in word) or len(word) > MAX_WORD_CHARS:
        return None
    return word


async def _entry(session: AsyncSession, user_id: int, word: str) -> WordBankEntry | None:
    result = await session.execute(
        select(WordBankEntry).where(WordBankEntry.user_id == user_id, WordBankEntry.word == word)
    )
    return result.scalar_one_or_none()


async def record_word(
    session: AsyncSession,
    user_id: int,
    raw_word: str,
    *,
    sentence: str | None = None,
    book_id: int | None = None,
    source: Source = "define",
) -> WordBankEntry | None:
    """Count a lookup of `raw_word` by this reader. None if it is not a word worth keeping.
    Commits. The reader must exist (the caller checks)."""
    word = clean_word(raw_word)
    if word is None:
        return None
    now = datetime.now(UTC)
    context = (sentence or "").strip()[:MAX_SENTENCE_CHARS] or None

    entry = await _entry(session, user_id, word)
    if entry is None:
        entry = WordBankEntry(
            user_id=user_id,
            word=word,
            book_id=book_id,
            context_sentence=context,
            times_rescued=1,
            last_seen=now,
        )
        session.add(entry)
    else:
        entry.times_rescued += 1
        entry.last_seen = now
        # The latest meeting is the one worth showing; keep the old one if this has none.
        entry.context_sentence = context or entry.context_sentence
        entry.book_id = book_id or entry.book_id

    user = await session.get(User, user_id)
    session.add(
        ReadingEvent(
            user_id=user_id,
            book_id=book_id,
            event_type=ReadingEventType.WORD_RESCUED.value,
            mode=user.support_level if user else None,
            payload={"word": word, "source": source},
        )
    )
    try:
        await session.commit()
    except IntegrityError:
        # The same new word arrived twice at once: count it on the row the other one made.
        await session.rollback()
        existing = await _entry(session, user_id, word)
        if existing is None:
            raise
        existing.times_rescued += 1
        existing.last_seen = now
        await session.commit()
        return existing
    await session.refresh(entry)
    return entry


async def list_words(
    session: AsyncSession, user_id: int, limit: int = 200
) -> list[tuple[WordBankEntry, Book | None]]:
    """The reader's words, the ones they looked up most recently first, with their book."""
    result = await session.execute(
        select(WordBankEntry, Book)
        .outerjoin(Book, Book.id == WordBankEntry.book_id)
        .where(WordBankEntry.user_id == user_id)
        .order_by(WordBankEntry.last_seen.desc(), WordBankEntry.id.desc())
        .limit(limit)
    )
    return [(entry, book) for entry, book in result.all()]
