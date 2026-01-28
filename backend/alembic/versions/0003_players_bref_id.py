"""add bref_id to players

Revision ID: 0003_players_bref_id
Revises: 0002_teams_conference_division
Create Date: 2026-01-27

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0003_players_bref_id"
down_revision = "0002_teams_conference_division"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("players", sa.Column("bref_id", sa.String(length=20), nullable=True))
    op.create_index("ix_players_bref_id", "players", ["bref_id"])
    op.create_unique_constraint("uq_players_bref_id", "players", ["bref_id"])


def downgrade() -> None:
    op.drop_constraint("uq_players_bref_id", "players", type_="unique")
    op.drop_index("ix_players_bref_id", table_name="players")
    op.drop_column("players", "bref_id")


