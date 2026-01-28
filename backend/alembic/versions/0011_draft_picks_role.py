"""add draft_picks.role

Revision ID: 0011_draft_picks_role
Revises: 0010_drafts_public_id
Create Date: 2026-01-28

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0011_draft_picks_role"
down_revision = "0010_drafts_public_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add nullable first so we can backfill safely.
    op.add_column("draft_picks", sa.Column("role", sa.String(length=10), nullable=True))
    op.create_index("ix_draft_picks_role", "draft_picks", ["role"])

    # Backfill: prefer determining from pick_number alternating host/guest, starting with host.
    # This fixes most historical data; for started drafts with drafts.first_turn, we can refine later if needed.
    op.execute(
        sa.text(
            """
            UPDATE draft_picks
            SET role = CASE WHEN (pick_number % 2) = 1 THEN 'host' ELSE 'guest' END
            WHERE role IS NULL
            """
        )
    )

    op.alter_column("draft_picks", "role", nullable=False)


def downgrade() -> None:
    op.drop_index("ix_draft_picks_role", table_name="draft_picks")
    op.drop_column("draft_picks", "role")


