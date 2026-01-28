"""add stints_scraped_at to players

Revision ID: 0005_players_stints_scraped_at
Revises: 0004_player_team_stints
Create Date: 2026-01-27

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0005_players_stints_scraped_at"
down_revision = "0004_player_team_stints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("players", sa.Column("stints_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_players_stints_scraped_at", "players", ["stints_scraped_at"])


def downgrade() -> None:
    op.drop_index("ix_players_stints_scraped_at", table_name="players")
    op.drop_column("players", "stints_scraped_at")


