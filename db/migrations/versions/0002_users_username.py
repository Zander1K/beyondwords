"""Add users.username: readers are identified by a username, with no password or email.

Existing rows (if any) get "user_<id>" so the column can be NOT NULL.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("username", sa.String(32), nullable=True))
    op.execute("UPDATE users SET username = 'user_' || id WHERE username IS NULL")
    with op.batch_alter_table("users") as batch:
        batch.alter_column("username", existing_type=sa.String(32), nullable=False)
        batch.create_unique_constraint("uq_users_username", ["username"])


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_username", type_="unique")
        batch.drop_column("username")
