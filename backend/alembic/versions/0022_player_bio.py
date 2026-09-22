"""Add player bio fields from Basketball Reference meta.

Revision ID: 0022_player_bio
Revises: 0021_postseason_stats
Create Date: 2026-09-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0022_player_bio"
down_revision = "0021_postseason_stats"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("players", sa.Column("height_inches", sa.Integer(), nullable=True))
    op.add_column("players", sa.Column("weight_lb", sa.Integer(), nullable=True))
    op.add_column("players", sa.Column("college", sa.String(length=255), nullable=True))
    op.add_column("players", sa.Column("high_school", sa.String(length=255), nullable=True))
    op.add_column("players", sa.Column("birth_date", sa.Date(), nullable=True))
    op.add_column("players", sa.Column("birth_place", sa.String(length=255), nullable=True))
    op.add_column("players", sa.Column("shoots", sa.String(length=16), nullable=True))
    op.add_column("players", sa.Column("bio_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_players_bio_scraped_at", "players", ["bio_scraped_at"])
    op.create_index("ix_players_height_inches", "players", ["height_inches"])
    op.create_index("ix_players_college", "players", ["college"])


def downgrade() -> None:
    op.drop_index("ix_players_college", table_name="players")
    op.drop_index("ix_players_height_inches", table_name="players")
    op.drop_index("ix_players_bio_scraped_at", table_name="players")
    op.drop_column("players", "bio_scraped_at")
    op.drop_column("players", "shoots")
    op.drop_column("players", "birth_place")
    op.drop_column("players", "birth_date")
    op.drop_column("players", "high_school")
    op.drop_column("players", "college")
    op.drop_column("players", "weight_lb")
    op.drop_column("players", "height_inches")
