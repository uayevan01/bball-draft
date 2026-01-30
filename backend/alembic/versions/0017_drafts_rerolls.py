"""Add reroll counters to drafts.

Revision ID: 0017_drafts_rerolls
Revises: 0016_drafts_name
Create Date: 2026-01-30
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_drafts_rerolls"
down_revision = "0016_drafts_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use server_default to backfill existing rows, then drop defaults.
    op.add_column("drafts", sa.Column("host_rerolls", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("drafts", sa.Column("guest_rerolls", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("drafts", "host_rerolls", server_default=None)
    op.alter_column("drafts", "guest_rerolls", server_default=None)


def downgrade() -> None:
    op.drop_column("drafts", "guest_rerolls")
    op.drop_column("drafts", "host_rerolls")


