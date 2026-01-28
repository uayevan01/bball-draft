"""add drafts.public_id

Revision ID: 0010_drafts_public_id
Revises: 0009_users_full_name
Create Date: 2026-01-28

"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0010_drafts_public_id"
down_revision = "0009_users_full_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("drafts", sa.Column("public_id", postgresql.UUID(as_uuid=True), nullable=True))

    bind = op.get_bind()
    draft_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM drafts WHERE public_id IS NULL")).fetchall()]
    for did in draft_ids:
        bind.execute(
            sa.text("UPDATE drafts SET public_id = :pid WHERE id = :id"),
            {"pid": str(uuid.uuid4()), "id": did},
        )

    op.alter_column("drafts", "public_id", nullable=False)
    op.create_index("ix_drafts_public_id", "drafts", ["public_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_drafts_public_id", table_name="drafts")
    op.drop_column("drafts", "public_id")


