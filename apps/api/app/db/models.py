"""ORM models for the tables in CLAUDE.md section 5.

Columns are the minimum implied by CLAUDE.md; anything the SOP may define more precisely is
marked OPEN QUESTION. Never store book text: `books` holds metadata only.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # OPEN QUESTION: auth/identity model (device id, account, demo user only?) is unspecified.
    display_name: Mapped[str | None] = mapped_column(String(255))
    # OPEN QUESTION: where reading preferences (spacing, fade level) live; JSON for now.
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class Book(TimestampMixin, Base):
    """Book metadata only. Never store book text here."""

    __tablename__ = "books"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    author: Mapped[str | None] = mapped_column(String(512))
    isbn: Mapped[str | None] = mapped_column(String(17), index=True)
    edition: Mapped[str | None] = mapped_column(String(128))
    language: Mapped[str | None] = mapped_column(String(16))  # BCP 47 tag, e.g. "en-GB"
    # OPEN QUESTION: reading-level scale (age band, Lexile, free text?) is unspecified.
    level: Mapped[str | None] = mapped_column(String(64))


class UserBook(TimestampMixin, Base):
    __tablename__ = "user_books"
    __table_args__ = (UniqueConstraint("user_id", "book_id", name="uq_user_books_user_book"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    book_id: Mapped[int] = mapped_column(
        ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime)


class Page(TimestampMixin, Base):
    """Per-user captured page analysis (derived data only, no raw image)."""

    __tablename__ = "pages"
    __table_args__ = (
        UniqueConstraint("user_book_id", "image_hash", name="uq_pages_user_book_image_hash"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_book_id: Mapped[int] = mapped_column(
        ForeignKey("user_books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Printed page label; string because books use roman numerals etc. Nullable if unknown.
    page_label: Mapped[str | None] = mapped_column(String(32))
    # SHA-256 hex of the captured frame, used to cache analyses (CLAUDE.md section 9).
    image_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # OPEN QUESTION: page JSON shape is SOP section 8.1; stored as-is until step 2.
    analysis: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class Line(Base):
    __tablename__ = "lines"
    __table_args__ = (UniqueConstraint("page_id", "line_index", name="uq_lines_page_index"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    page_id: Mapped[int] = mapped_column(
        ForeignKey("pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_index: Mapped[int] = mapped_column(Integer, nullable=False)  # reading order
    # Bounding box in image coordinates. OPEN QUESTION: pixels or normalised 0..1 (SOP 8.1).
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_w: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_h: Mapped[float] = mapped_column(Float, nullable=False)
    # OPEN QUESTION: phrase splits and hard-word flags reference text. Storing the words
    # themselves may conflict with "never store book text"; shape and policy to confirm.
    phrases: Mapped[list[Any] | None] = mapped_column(JSON)
    hard_words: Mapped[list[Any] | None] = mapped_column(JSON)


class WordBankEntry(TimestampMixin, Base):
    __tablename__ = "word_bank"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    book_id: Mapped[int | None] = mapped_column(
        ForeignKey("books.id", ondelete="SET NULL"), index=True
    )
    word: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    # The sentence where the user met the word (explicitly allowed by CLAUDE.md section 5).
    context_sentence: Mapped[str | None] = mapped_column(Text)
    lookup_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # OPEN QUESTION: review model (states, spaced repetition?) unspecified; free string for now.
    review_state: Mapped[str] = mapped_column(String(32), nullable=False, server_default="new")
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)


class ReadingEventType(StrEnum):
    """Known event types. Stored as a string so new types need no migration."""

    LINE_COMPLETED = "line_completed"
    WORD_LOOKED_UP = "word_looked_up"
    QUESTION_ASKED = "question_asked"
    ASSIST_FADED = "assist_faded"


class ReadingEvent(TimestampMixin, Base):
    """Append-only event log. Never update or delete rows."""

    __tablename__ = "reading_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_book_id: Mapped[int | None] = mapped_column(
        ForeignKey("user_books.id", ondelete="SET NULL"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)
