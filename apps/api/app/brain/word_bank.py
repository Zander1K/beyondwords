"""Word bank: which words a reader struggles with, and when they "own" them (SOP 5, feature 8).

Signals
- Rescue: the reader asked for help with a word (Word Breakdown pinch, or "what does X mean?"
  in POST /ask). The word becomes `learning` (new, or back from `owned`), `times_rescued` goes
  up, and `solo_reads` restarts at 0.
- Solo read: a `learning` word is on a page the reader finished without help with it: not
  rescued on that page, not on a line they asked to hear, and not in Listen mode (the app read
  it for them). At most one per word per day, so practice on different days counts, not
  re-reading one page. After `owned_after_solo_reads` (3) the word is `owned`.
- Neutral: hard words the app flagged but the reader never asked about. We cannot tell whether
  they read them, so they neither enter the bank nor count as solo reads.

Uses
- profile_for_page(): page analysis always flags `learning` words on the page and never flags
  `owned` ones, so support fades as the reader improves (CLAUDE.md section 8).
- PageReadResult.newly_owned: a positive "you now own *portcullis*" moment. There are no scores
  and no list of failures (SOP 2: no scoring).

Storage is deliberately simple: a WordBankStore loads and saves WordEntry rows (the `word_bank`
table). Every rule lives here, so it is tested in one place.
"""

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from typing import Protocol

from app.brain.settings import get_brain_settings
from app.schemas.brain import ReaderProfile

logger = logging.getLogger(__name__)

LEARNING = "learning"
OWNED = "owned"
# Support levels (SOP 7.1). In Listen mode the app reads every word aloud, so nothing the
# reader "read" there is evidence that they can decode it themselves.
NO_SOLO_CREDIT_MODES = {"listen"}
MAX_WORD_LENGTH = 128  # word_bank.word column

_TOKEN = re.compile(r"[\w'’-]+")


def word_key(word: str) -> str:
    """The form stored in the bank: lowercase, straight apostrophes, no surrounding punctuation.
    "Aloof," and "aloof" are the same word; "groaned" and "groan" are not (no stemming)."""
    key = word.replace("’", "'").replace("‘", "'").lower()
    return re.sub(r"^[\W_]+|[\W_]+$", "", key)[:MAX_WORD_LENGTH]


def page_words(lines: Iterable[str]) -> set[str]:
    return {k for text in lines for k in (word_key(t) for t in _TOKEN.findall(text)) if k}


@dataclass
class WordEntry:
    """One row of the reader's word bank."""

    word: str  # word_key() form
    status: str = LEARNING
    times_rescued: int = 0
    solo_reads: int = 0
    last_seen: datetime | None = None
    context_sentence: str | None = None
    book_id: int | None = None
    page_id: str | None = None


@dataclass
class PageReadResult:
    credited: list[str] = field(default_factory=list)  # learning words that got a solo read
    newly_owned: list[str] = field(default_factory=list)
    updated: list[WordEntry] = field(default_factory=list)


@dataclass(frozen=True)
class Rules:
    owned_after_solo_reads: int = 3
    one_solo_read_per_day: bool = True

    @classmethod
    def from_settings(cls) -> "Rules":
        s = get_brain_settings()
        return cls(s.owned_after_solo_reads, s.one_solo_read_per_day)


def _day(moment: datetime) -> date:
    return moment.astimezone(UTC).date() if moment.tzinfo else moment.date()


def _now() -> datetime:
    return datetime.now(UTC)


def rescue(
    entry: WordEntry | None,
    word: str,
    *,
    sentence: str | None = None,
    book_id: int | None = None,
    page_id: str | None = None,
    now: datetime | None = None,
) -> WordEntry:
    """The reader needed help with `word`: add it, or send it back to learning."""
    base = entry or WordEntry(word=word_key(word))
    return replace(
        base,
        status=LEARNING,
        times_rescued=base.times_rescued + 1,
        solo_reads=0,
        last_seen=now or _now(),
        context_sentence=sentence or base.context_sentence,
        book_id=book_id if book_id is not None else base.book_id,
        page_id=page_id if page_id is not None else base.page_id,
    )


def read_page(
    entries: dict[str, WordEntry],
    lines: list[tuple[str, str]],
    *,
    mode: str,
    rescued: Iterable[str] = (),
    helped_lines: Iterable[str] = (),
    now: datetime | None = None,
    rules: Rules | None = None,
) -> PageReadResult:
    """The reader finished a page (`lines` = (line id, text)). Credit solo reads.

    `rescued`: words the reader asked about on this page. `helped_lines`: lines they asked to
    hear read aloud. Neither earns a solo read.
    """
    rules = rules or Rules.from_settings()
    now = now or _now()
    result = PageReadResult()
    if mode in NO_SOLO_CREDIT_MODES:
        return result
    helped = set(helped_lines)
    no_credit = {word_key(w) for w in rescued} | page_words(
        text for line_id, text in lines if line_id in helped
    )
    on_page = page_words(text for _, text in lines)
    for key in sorted(on_page & entries.keys() - no_credit):
        entry = entries[key]
        if entry.status == OWNED:
            result.updated.append(replace(entry, last_seen=now))
            continue
        if (
            rules.one_solo_read_per_day
            and entry.last_seen is not None
            and _day(entry.last_seen) >= _day(now)
        ):
            continue  # already met today (rescued or read): one solo read a day at most
        solo = entry.solo_reads + 1
        owned = solo >= rules.owned_after_solo_reads
        result.updated.append(
            replace(entry, solo_reads=solo, last_seen=now, status=OWNED if owned else LEARNING)
        )
        result.credited.append(key)
        if owned:
            result.newly_owned.append(key)
    return result


def profile_for_page(
    entries: Iterable[WordEntry], lines: Iterable[str], support_level: str = "read_along"
) -> ReaderProfile:
    """What page analysis needs, limited to words on this page so the prompt stays small."""
    on_page = page_words(lines)
    entries = [e for e in entries if e.word in on_page]
    return ReaderProfile(
        support_level=support_level,  # type: ignore[arg-type]
        struggled_words=sorted(e.word for e in entries if e.status == LEARNING),
        owned_words=sorted(e.word for e in entries if e.status == OWNED),
    )


@dataclass
class WordBankSummary:
    learning: int
    owned: int
    owned_words: list[str]


def summary(entries: Iterable[WordEntry]) -> WordBankSummary:
    """Counts for GET /progress. Owned words are listed; struggled ones only counted."""
    entries = list(entries)
    owned = sorted(e.word for e in entries if e.status == OWNED)
    return WordBankSummary(
        learning=sum(e.status == LEARNING for e in entries), owned=len(owned), owned_words=owned
    )


# --- storage ---------------------------------------------------------------------------------


class WordBankStore(Protocol):
    """Loads and saves word bank rows (Mick: `app/db/repositories/word_bank.py`)."""

    async def get_words(self, user_id: int, words: list[str] | None = None) -> list[WordEntry]:
        """The reader's entries; only `words` (word_key form) when given."""
        ...

    async def save_words(self, user_id: int, entries: list[WordEntry]) -> None:
        """Insert or update these entries (one row per reader per word)."""
        ...


class InMemoryWordBank:
    """Dev/test stand-in for the `word_bank` table."""

    def __init__(self) -> None:
        self.rows: dict[tuple[int, str], WordEntry] = {}

    async def get_words(self, user_id: int, words: list[str] | None = None) -> list[WordEntry]:
        return [
            e for (uid, key), e in self.rows.items()
            if uid == user_id and (words is None or key in words)
        ]  # fmt: skip

    async def save_words(self, user_id: int, entries: list[WordEntry]) -> None:
        for entry in entries:
            self.rows[(user_id, entry.word)] = entry


async def record_rescue(
    store: WordBankStore,
    user_id: int,
    word: str,
    *,
    sentence: str | None = None,
    book_id: int | None = None,
    page_id: str | None = None,
    now: datetime | None = None,
) -> WordEntry:
    key = word_key(word)
    existing = await store.get_words(user_id, [key])
    entry = rescue(
        existing[0] if existing else None,
        word,
        sentence=sentence,
        book_id=book_id,
        page_id=page_id,
        now=now,
    )
    await store.save_words(user_id, [entry])
    return entry


async def record_page_read(
    store: WordBankStore,
    user_id: int,
    lines: list[tuple[str, str]],
    *,
    mode: str,
    rescued: Iterable[str] = (),
    helped_lines: Iterable[str] = (),
    now: datetime | None = None,
    rules: Rules | None = None,
) -> PageReadResult:
    present = sorted(page_words(text for _, text in lines))
    entries = {e.word: e for e in await store.get_words(user_id, present)} if present else {}
    result = read_page(
        entries, lines, mode=mode, rescued=rescued, helped_lines=helped_lines, now=now, rules=rules
    )
    if result.updated:
        await store.save_words(user_id, result.updated)
    return result


async def reader_profile(
    store: WordBankStore, user_id: int, lines: list[str], support_level: str = "read_along"
) -> ReaderProfile:
    present = sorted(page_words(lines))
    entries = await store.get_words(user_id, present) if present else []
    return profile_for_page(entries, lines, support_level)
