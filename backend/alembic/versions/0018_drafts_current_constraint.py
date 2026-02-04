"""Persist current roll constraint on drafts.

Revision ID: 0018_drafts_current_constraint
Revises: 0017_drafts_rerolls
Create Date: 2026-02-04
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_drafts_current_constraint"
down_revision = "0017_drafts_rerolls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drafts", sa.Column("current_constraint", sa.JSON(), nullable=True))
    op.add_column("drafts", sa.Column("current_constraint_role", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("drafts", "current_constraint_role")
    op.drop_column("drafts", "current_constraint")


