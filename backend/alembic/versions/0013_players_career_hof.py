"""add players.career_start_year and players.hall_of_fame

Revision ID: 0013_players_career_hof
Revises: 0012_teams_logo_url
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


# IMPORTANT: Alembic's alembic_version.version_num is VARCHAR(32) by default.
# Keep revision ids <= 32 characters.
revision = "0013_players_career_hof"
down_revision = "0012_teams_logo_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("players", sa.Column("career_start_year", sa.Integer(), nullable=True))
    op.create_index("ix_players_career_start_year", "players", ["career_start_year"])
    op.add_column("players", sa.Column("hall_of_fame", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_index("ix_players_hall_of_fame", "players", ["hall_of_fame"])


def downgrade() -> None:
    op.drop_index("ix_players_hall_of_fame", table_name="players")
    op.drop_column("players", "hall_of_fame")
    op.drop_index("ix_players_career_start_year", table_name="players")
    op.drop_column("players", "career_start_year")


