"""add teams.logo_url

Revision ID: 0012_teams_logo_url
Revises: 0011_draft_picks_role
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0012_teams_logo_url"
down_revision = "0011_draft_picks_role"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("logo_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("teams", "logo_url")


