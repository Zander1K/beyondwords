"""Initial tables: users, books, user_books, pages, lines, word_bank, reading_events.

Columns follow SOP section 5 ("Data model"), on PostgreSQL. See app/db/models.py for what each
column means and which ones go beyond the SOP table.

HACK: this revision was rewritten in place (2026-11-14) to match the SOP, because it had never
been applied to a shared database. If you ran the old version locally, reset with
`docker compose down -v && make dev && make migrate`. From here on, add new revisions instead
of editing this one.

Revision ID: 0001
Revises:
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Must match app.db.models.JSONType: JSONB on PostgreSQL, JSON elsewhere.
JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _now(name: str, *, nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        server_default=sa.func.current_timestamp(),
        nullable=nullable,
    )


def _fk(name: str, target: str, ondelete: str, *, nullable: bool) -> sa.Column:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("support_level", sa.String(16), server_default="read_along", nullable=False),
        sa.Column("voice", sa.String(64), nullable=True),
        sa.Column("glasses_type", sa.String(16), nullable=True),
        sa.Column("settings", JSON_TYPE, nullable=True),
        _now("created_at"),
    )

    op.create_table(
        "books",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("isbn", sa.String(17), nullable=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("author", sa.String(512), nullable=True),
        sa.Column("publication_year", sa.SmallInteger(), nullable=True),
        sa.Column("language", sa.String(16), nullable=True),
        sa.Column("genre", sa.String(128), nullable=True),
        sa.Column("setting_era", sa.String(255), nullable=True),
        sa.Column("description_spoiler_free", sa.Text(), nullable=True),
        sa.Column("metadata_source", sa.String(64), nullable=True),
        _now("created_at"),
        sa.UniqueConstraint("isbn", name="uq_books_isbn"),
    )

    op.create_table(
        "user_books",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        _fk("user_id", "users.id", "CASCADE", nullable=False),
        _fk("book_id", "books.id", "CASCADE", nullable=False),
        sa.Column("current_page", sa.String(32), nullable=True),
        sa.Column("current_line", sa.String(32), nullable=True),
        _now("started_at"),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "book_id", name="uq_user_books_user_book"),
    )
    op.create_index("ix_user_books_user_id", "user_books", ["user_id"])
    op.create_index("ix_user_books_book_id", "user_books", ["book_id"])

    op.create_table(
        "pages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        _fk("user_id", "users.id", "CASCADE", nullable=False),
        _fk("book_id", "books.id", "CASCADE", nullable=False),
        sa.Column("page_number", sa.String(32), nullable=True),
        sa.Column("image_hash", sa.String(64), nullable=False),
        sa.Column("analysis", JSON_TYPE, nullable=True),
        _now("captured_at"),
        sa.UniqueConstraint("user_id", "book_id", "image_hash", name="uq_pages_user_book_image"),
    )
    op.create_index("ix_pages_user_id", "pages", ["user_id"])
    op.create_index("ix_pages_book_id", "pages", ["book_id"])

    op.create_table(
        "lines",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        _fk("page_id", "pages.id", "CASCADE", nullable=False),
        sa.Column("line_id", sa.String(32), nullable=False),
        sa.Column("line_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("bbox", JSON_TYPE, nullable=True),
        sa.UniqueConstraint("page_id", "line_id", name="uq_lines_page_line"),
    )
    op.create_index("ix_lines_page_id", "lines", ["page_id"])

    op.create_table(
        "word_bank",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        _fk("user_id", "users.id", "CASCADE", nullable=False),
        sa.Column("word", sa.String(128), nullable=False),
        _fk("book_id", "books.id", "SET NULL", nullable=True),
        _fk("page_id", "pages.id", "SET NULL", nullable=True),
        sa.Column("times_rescued", sa.Integer(), server_default="1", nullable=False),
        sa.Column("solo_reads", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(16), server_default="learning", nullable=False),
        _now("last_seen"),
        sa.Column("context_sentence", sa.Text(), nullable=True),
        _now("created_at"),
        sa.UniqueConstraint("user_id", "word", name="uq_word_bank_user_word"),
    )
    op.create_index("ix_word_bank_user_id", "word_bank", ["user_id"])
    op.create_index("ix_word_bank_book_id", "word_bank", ["book_id"])
    op.create_index("ix_word_bank_page_id", "word_bank", ["page_id"])

    op.create_table(
        "reading_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        _fk("user_id", "users.id", "CASCADE", nullable=False),
        _fk("book_id", "books.id", "SET NULL", nullable=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("mode", sa.String(16), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("payload", JSON_TYPE, nullable=True),
        _now("created_at"),
    )
    op.create_index("ix_reading_events_user_id", "reading_events", ["user_id"])
    op.create_index("ix_reading_events_book_id", "reading_events", ["book_id"])
    op.create_index("ix_reading_events_event_type", "reading_events", ["event_type"])


def downgrade() -> None:
    for table in (
        "reading_events",
        "word_bank",
        "lines",
        "pages",
        "user_books",
        "books",
        "users",
    ):
        op.drop_table(table)
