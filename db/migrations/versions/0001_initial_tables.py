"""Initial tables: users, books, user_books, pages, lines, word_bank, reading_events.

Revision ID: 0001
Revises:
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MYSQL_OPTS = {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"}


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=True),
        _created_at(),
        **MYSQL_OPTS,
    )
    op.create_table(
        "books",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("author", sa.String(512), nullable=True),
        sa.Column("isbn", sa.String(17), nullable=True),
        sa.Column("edition", sa.String(128), nullable=True),
        sa.Column("language", sa.String(16), nullable=True),
        sa.Column("level", sa.String(64), nullable=True),
        _created_at(),
        **MYSQL_OPTS,
    )
    op.create_index("ix_books_isbn", "books", ["isbn"])

    op.create_table(
        "user_books",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "book_id",
            sa.BigInteger(),
            sa.ForeignKey("books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("last_opened_at", sa.DateTime(), nullable=True),
        _created_at(),
        sa.UniqueConstraint("user_id", "book_id", name="uq_user_books_user_book"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_user_books_user_id", "user_books", ["user_id"])
    op.create_index("ix_user_books_book_id", "user_books", ["book_id"])

    op.create_table(
        "pages",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_book_id",
            sa.BigInteger(),
            sa.ForeignKey("user_books.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_label", sa.String(32), nullable=True),
        sa.Column("image_hash", sa.String(64), nullable=False),
        sa.Column("analysis", sa.JSON(), nullable=True),
        _created_at(),
        sa.UniqueConstraint("user_book_id", "image_hash", name="uq_pages_user_book_image_hash"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_pages_user_book_id", "pages", ["user_book_id"])

    op.create_table(
        "lines",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "page_id",
            sa.BigInteger(),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("line_index", sa.Integer(), nullable=False),
        sa.Column("bbox_x", sa.Float(), nullable=False),
        sa.Column("bbox_y", sa.Float(), nullable=False),
        sa.Column("bbox_w", sa.Float(), nullable=False),
        sa.Column("bbox_h", sa.Float(), nullable=False),
        sa.Column("phrases", sa.JSON(), nullable=True),
        sa.Column("hard_words", sa.JSON(), nullable=True),
        sa.UniqueConstraint("page_id", "line_index", name="uq_lines_page_index"),
        **MYSQL_OPTS,
    )
    op.create_index("ix_lines_page_id", "lines", ["page_id"])

    op.create_table(
        "word_bank",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "book_id",
            sa.BigInteger(),
            sa.ForeignKey("books.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("word", sa.String(128), nullable=False),
        sa.Column("context_sentence", sa.Text(), nullable=True),
        sa.Column("lookup_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column("review_state", sa.String(32), server_default="new", nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(), nullable=True),
        _created_at(),
        **MYSQL_OPTS,
    )
    op.create_index("ix_word_bank_user_id", "word_bank", ["user_id"])
    op.create_index("ix_word_bank_book_id", "word_bank", ["book_id"])
    op.create_index("ix_word_bank_word", "word_bank", ["word"])

    op.create_table(
        "reading_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_book_id",
            sa.BigInteger(),
            sa.ForeignKey("user_books.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        _created_at(),
        **MYSQL_OPTS,
    )
    op.create_index("ix_reading_events_user_id", "reading_events", ["user_id"])
    op.create_index("ix_reading_events_user_book_id", "reading_events", ["user_book_id"])
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
