"""add image_scraped_at to players

Revision ID: 0007_players_image_scraped_at
Revises: 0006_players_image_url
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0007_players_image_scraped_at"
down_revision = "0006_players_image_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("players", sa.Column("image_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_players_image_scraped_at", "players", ["image_scraped_at"])


def downgrade() -> None:
    op.drop_index("ix_players_image_scraped_at", table_name="players")
    op.drop_column("players", "image_scraped_at")


