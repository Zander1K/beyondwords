"""Data access for the `word_bank` table: the brain's WordBankStore (brain/word_bank.py).

Storage only: the rules (rescue, solo reads, when a word is owned) live in brain/word_bank.py.
One row per reader per word (uq_word_bank_user_word); a concurrent first insert of the same
word is retried as an update.
"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.brain.word_bank import WordEntry
from app.db.models import WordBankEntry


def _to_entry(row: WordBankEntry) -> WordEntry:
    return WordEntry(
        word=row.word,
        status=row.status,
        times_rescued=row.times_rescued,
        solo_reads=row.solo_reads,
        last_seen=row.last_seen,
        context_sentence=row.context_sentence,
        book_id=row.book_id,
    )


class WordBankRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_words(self, user_id: int, words: list[str] | None = None) -> list[WordEntry]:
        query = select(WordBankEntry).where(WordBankEntry.user_id == user_id)
        if words is not None:
            if not words:
                return []
            query = query.where(WordBankEntry.word.in_(words))
        result = await self._session.execute(query.order_by(WordBankEntry.word))
        return [_to_entry(row) for row in result.scalars()]

    async def save_words(self, user_id: int, entries: list[WordEntry]) -> None:
        if not entries:
            return
        try:
            await self._upsert(user_id, entries)
        except IntegrityError:
            # Another request inserted one of these words first: retry, now as an update.
            await self._session.rollback()
            await self._upsert(user_id, entries)

    async def _upsert(self, user_id: int, entries: list[WordEntry]) -> None:
        result = await self._session.execute(
            select(WordBankEntry).where(
                WordBankEntry.user_id == user_id,
                WordBankEntry.word.in_([e.word for e in entries]),
            )
        )
        rows = {row.word: row for row in result.scalars()}
        for entry in entries:
            row = rows.get(entry.word)
            if row is None:
                row = rows[entry.word] = WordBankEntry(user_id=user_id, word=entry.word)
                self._session.add(row)
            row.status = entry.status
            row.times_rescued = entry.times_rescued
            row.solo_reads = entry.solo_reads
            row.last_seen = entry.last_seen or datetime.now(UTC)
            row.context_sentence = entry.context_sentence
            # 0 or None: no book in our library yet (the FK would reject 0).
            row.book_id = entry.book_id or None
            # TODO(Mick Ola): set page_id once POST /page stores pages; the brain's page ids
            # are not pages.id yet, so the FK would reject them.
        await self._session.commit()
