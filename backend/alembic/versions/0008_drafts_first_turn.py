"""add drafts.first_turn

Revision ID: 0008_drafts_first_turn
Revises: 0007_players_image_scraped_at
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0008_drafts_first_turn"
down_revision = "0007_players_image_scraped_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drafts", sa.Column("first_turn", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("drafts", "first_turn")


