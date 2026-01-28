"""add users.full_name

Revision ID: 0009_users_full_name
Revises: 0008_drafts_first_turn
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0009_users_full_name"
down_revision = "0008_drafts_first_turn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(length=140), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "full_name")


