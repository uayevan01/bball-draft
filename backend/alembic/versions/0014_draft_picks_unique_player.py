"""Add unique constraint to prevent drafting same player twice per draft.

Revision ID: 0014_draft_picks_unique_player
Revises: 0013_players_career_hof
Create Date: 2026-01-29
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "0014_draft_picks_unique_player"
down_revision = "0013_players_career_hof"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_draft_picks_draft_player",
        "draft_picks",
        ["draft_id", "player_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_draft_picks_draft_player",
        "draft_picks",
        type_="unique",
    )


