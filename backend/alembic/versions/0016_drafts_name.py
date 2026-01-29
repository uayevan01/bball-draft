"""Add name to drafts.

Revision ID: 0016_drafts_name
Revises: 0015_users_avatar_url
Create Date: 2026-01-29
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_drafts_name"
down_revision = "0015_users_avatar_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drafts", sa.Column("name", sa.String(length=120), nullable=True))


def downgrade() -> None:
    op.drop_column("drafts", "name")


