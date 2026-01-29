"""Add avatar_url to users.

Revision ID: 0015_users_avatar_url
Revises: 0014_draft_picks_unique_player
Create Date: 2026-01-29
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_users_avatar_url"
down_revision = "0014_draft_picks_unique_player"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")


