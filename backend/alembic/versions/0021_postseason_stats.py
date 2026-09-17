"""Add postseason flag to player_season_stats and postseason scrape timestamp.

Revision ID: 0021_postseason_stats
Revises: 0020_seed_seasons_catalog
Create Date: 2026-09-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0021_postseason_stats"
down_revision = "0020_seed_seasons_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every existing row came from the regular-season tables, so false is the correct backfill.
    op.add_column(
        "player_season_stats",
        sa.Column("is_postseason", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_player_season_stats_is_postseason", "player_season_stats", ["is_postseason"])

    # A player has both a regular-season and a postseason row per season/team, so the
    # season type has to be part of the uniqueness key.
    op.drop_constraint("uq_player_season_stats_player_season_team", "player_season_stats", type_="unique")
    op.create_unique_constraint(
        "uq_player_season_stats_player_season_team_type",
        "player_season_stats",
        ["player_id", "season_id", "team_id", "is_postseason"],
    )

    op.add_column("players", sa.Column("postseason_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_players_postseason_scraped_at", "players", ["postseason_scraped_at"])


def downgrade() -> None:
    op.drop_index("ix_players_postseason_scraped_at", table_name="players")
    op.drop_column("players", "postseason_scraped_at")

    op.drop_constraint("uq_player_season_stats_player_season_team_type", "player_season_stats", type_="unique")
    # Postseason rows collide under the old constraint, so they cannot be kept.
    op.execute("DELETE FROM player_season_stats WHERE is_postseason")
    op.create_unique_constraint(
        "uq_player_season_stats_player_season_team",
        "player_season_stats",
        ["player_id", "season_id", "team_id"],
    )

    op.drop_index("ix_player_season_stats_is_postseason", table_name="player_season_stats")
    op.drop_column("player_season_stats", "is_postseason")
