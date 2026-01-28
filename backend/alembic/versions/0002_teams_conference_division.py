"""add conference/division to teams

Revision ID: 0002_teams_conference_division
Revises: 0001_initial
Create Date: 2026-01-27

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0002_teams_conference_division"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("conference", sa.String(length=20), nullable=True))
    op.add_column("teams", sa.Column("division", sa.String(length=30), nullable=True))
    op.create_index("ix_teams_conference", "teams", ["conference"])
    op.create_index("ix_teams_division", "teams", ["division"])


def downgrade() -> None:
    op.drop_index("ix_teams_division", table_name="teams")
    op.drop_index("ix_teams_conference", table_name="teams")
    op.drop_column("teams", "division")
    op.drop_column("teams", "conference")


