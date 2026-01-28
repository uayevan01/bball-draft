"""add image_url to players

Revision ID: 0006_players_image_url
Revises: 0005_players_stints_scraped_at
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0006_players_image_url"
down_revision = "0005_players_stints_scraped_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("players", sa.Column("image_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("players", "image_url")


