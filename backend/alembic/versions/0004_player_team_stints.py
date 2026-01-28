"""add player_team_stints

Revision ID: 0004_player_team_stints
Revises: 0003_players_bref_id
Create Date: 2026-01-27

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0004_player_team_stints"
down_revision = "0003_players_bref_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "player_team_stints",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("players.id"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("start_year", sa.Integer(), nullable=False),
        sa.Column("end_year", sa.Integer(), nullable=True),
        sa.UniqueConstraint("player_id", "team_id", "start_year", name="uq_player_team_stints_player_team_start"),
    )
    op.create_index("ix_player_team_stints_player_id", "player_team_stints", ["player_id"])
    op.create_index("ix_player_team_stints_team_id", "player_team_stints", ["team_id"])
    op.create_index("ix_player_team_stints_start_year", "player_team_stints", ["start_year"])
    op.create_index("ix_player_team_stints_end_year", "player_team_stints", ["end_year"])


def downgrade() -> None:
    op.drop_table("player_team_stints")


