"""ORM models for the PostgreSQL tables in SOP section 5 ("Data model").

OPEN QUESTION: the SOP names MariaDB; the team switched to PostgreSQL (2026-11-14). Update the
SOP so it stays the source of truth.

The SOP is the source of truth for column names. Columns the SOP does not list are kept only
where CLAUDE.md asks for them, and are commented as such. Remaining gaps are marked
OPEN QUESTION and tracked in docs/OPEN_QUESTIONS.md.

Data rules (SOP sections 5 and 10):
- `books` is a shared library of metadata only. Never store book text in it.
- `pages` / `lines` hold the reader's captured line text, used only to ground that reader's
  answers. Delete them when the book is finished or on request. Never store page images.
- `reading_events` is append-only.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# JSONB on PostgreSQL (binary, indexable); plain JSON elsewhere (the SQLite structure test).
JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


def _now_column(*, nullable: bool = False) -> Any:
    return mapped_column(
        DateTime(timezone=True), server_default=func.current_timestamp(), nullable=nullable
    )


# Enum-like values are stored as plain strings so adding a value never needs a migration.
# Validate them in the Pydantic schemas, not in the database.


class SupportLevel(StrEnum):
    """Starting support level picked at setup (SOP 7.1). Default for a new reader is Read-along."""

    LISTEN = "listen"
    READ_ALONG = "read_along"
    SOLO = "solo"


class GlassesType(StrEnum):
    """SOP section 6: Ray-Ban Display (full) or Ray-Ban Meta Gen 2 (audio-first)."""

    DISPLAY = "display"
    GEN2 = "gen2"


class WordStatus(StrEnum):
    """SOP: word_bank tracks struggled words and when they become "owned"."""

    LEARNING = "learning"
    OWNED = "owned"


class ReadingEventType(StrEnum):
    """SOP section 5: progression from pages read, words rescued, questions asked, mode changes."""

    PAGE_READ = "page_read"
    WORD_RESCUED = "word_rescued"
    QUESTION_ASKED = "question_asked"
    MODE_CHANGED = "mode_changed"


class User(Base):
    """Reader account and preferences. No contact details required (SOP section 10).

    Identified by username only: no password, no email (team decision 2026-11-14).
    HACK: anyone who types a username sees that reader's progress. Fine for the demo; add a
    device token or PIN before real users.
    """

    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("username", name="uq_users_username"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # Not in the SOP table. Stored lowercased (app.schemas.users.normalize_username), so the
    # unique constraint makes "Mick" and "mick" the same reader. Every other table links to `id`.
    username: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    support_level: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=SupportLevel.READ_ALONG.value
    )
    # Reading voice picked at setup. OPEN QUESTION: value is a TTS voice id; format depends on
    # the phone TTS engine (Alex).
    voice: Mapped[str | None] = mapped_column(String(64))
    glasses_type: Mapped[str | None] = mapped_column(String(16))
    # Not in the SOP table. Kept for adjustable letter/word/line spacing (CLAUDE.md section 8).
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    created_at: Mapped[datetime] = _now_column()


class Book(Base):
    """Shared book library: metadata only, never book text."""

    __tablename__ = "books"
    # Unique so /books/identify can find a cached record by ISBN. NULL may repeat.
    __table_args__ = (UniqueConstraint("isbn", name="uq_books_isbn"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    isbn: Mapped[str | None] = mapped_column(String(17))
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    author: Mapped[str | None] = mapped_column(String(512))
    publication_year: Mapped[int | None] = mapped_column(SmallInteger)
    language: Mapped[str | None] = mapped_column(String(16))  # BCP 47 tag, e.g. "en-GB"
    genre: Mapped[str | None] = mapped_column(String(128))
    setting_era: Mapped[str | None] = mapped_column(String(255))  # e.g. "19th-century England"
    # Short background blurb for context. Must not contain plot spoilers or book text.
    description_spoiler_free: Mapped[str | None] = mapped_column(Text)
    # Where the metadata came from. OPEN QUESTION: which public source (e.g. Open Library).
    metadata_source: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _now_column()


class UserBook(Base):
    """Where each reader is in each book."""

    __tablename__ = "user_books"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_user_books_user_book"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Printed page label (string: books use roman numerals) and line id from the page JSON.
    current_page: Mapped[str | None] = mapped_column(String(32))
    current_line: Mapped[str | None] = mapped_column(String(32))
    started_at: Mapped[datetime] = _now_column()
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Setting this triggers deletion of the reader's captured pages/lines for the book.
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Page(Base):
    """A page a reader has captured. Derived data only: the photo itself is never stored."""

    __tablename__ = "pages"
    __table_args__ = (
        UniqueConstraint("user_id", "book_id", "image_hash", name="uq_pages_user_book_image"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    page_number: Mapped[str | None] = mapped_column(String(32))  # printed label, may be unknown
    # Not in the SOP table. SHA-256 hex of the captured frame, to cache analyses
    # (CLAUDE.md section 9). The hash cannot be turned back into the image.
    image_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Not in the SOP table. The validated page JSON from SOP 8.1, so a repeat capture is served
    # from cache without another Nemotron call.
    analysis: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    captured_at: Mapped[datetime] = _now_column()


class Line(Base):
    """Captured line text, used only to ground this reader's answers (SOP section 5)."""

    __tablename__ = "lines"
    __table_args__ = (UniqueConstraint("page_id", "line_id", name="uq_lines_page_line"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    page_id: Mapped[int] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_id: Mapped[str] = mapped_column(String(32), nullable=False)  # e.g. "L2", "caption_1"
    # Not in the SOP table. Position in the page's reading_order, so grounding can return lines
    # in order without re-reading the page JSON.
    line_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # As in the page JSON: a list of 4 numbers. OPEN QUESTION: [x, y, w, h] or [x1, y1, x2, y2],
    # and pixels or normalised 0..1.
    bbox: Mapped[list[float] | None] = mapped_column(JSONType)


class WordBankEntry(Base):
    """Words a reader struggled with, and whether they now "own" them."""

    __tablename__ = "word_bank"
    # One row per reader per word, so a repeat rescue increments times_rescued.
    __table_args__ = (UniqueConstraint("user_id", "word", name="uq_word_bank_user_word"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    word: Mapped[str] = mapped_column(String(128), nullable=False)
    # Book and page where the word was last met. SET NULL so deleting captured pages when a
    # book is finished keeps the word bank.
    book_id: Mapped[int | None] = mapped_column(
        ForeignKey("books.id", ondelete="SET NULL"), index=True
    )
    page_id: Mapped[int | None] = mapped_column(
        ForeignKey("pages.id", ondelete="SET NULL"), index=True
    )
    times_rescued: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    solo_reads: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # OPEN QUESTION: rule for moving from learning to owned (e.g. N solo reads in a row).
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=WordStatus.LEARNING.value
    )
    last_seen: Mapped[datetime] = _now_column()
    # Not in the SOP table. The sentence where the reader met the word (CLAUDE.md section 5).
    context_sentence: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now_column()


class ReadingEvent(Base):
    """Append-only progression log. Never update or delete rows (except account deletion)."""

    __tablename__ = "reading_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    book_id: Mapped[int | None] = mapped_column(
        ForeignKey("books.id", ondelete="SET NULL"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Support level at the time (SupportLevel). "Independence" = share of reading in solo.
    mode: Mapped[str | None] = mapped_column(String(16))
    # Time spent, for "minutes read per week". Mostly set on page_read events.
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    # Not in the SOP table. Small event details (e.g. the word rescued, old/new mode).
    # Never put page images, audio or Everyday-mode document content here.
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    created_at: Mapped[datetime] = _now_column()
