"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-01-26

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("city", sa.String(length=80), nullable=True),
        sa.Column("abbreviation", sa.String(length=10), nullable=True),
        sa.Column("previous_team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=True),
        sa.Column("founded_year", sa.Integer(), nullable=True),
        sa.Column("dissolved_year", sa.Integer(), nullable=True),
        sa.UniqueConstraint("abbreviation", name="uq_teams_abbreviation"),
    )
    op.create_index("ix_teams_name", "teams", ["name"])
    op.create_index("ix_teams_abbreviation", "teams", ["abbreviation"])
    op.create_index("ix_teams_previous_team_id", "teams", ["previous_team_id"])

    op.create_table(
        "players",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=140), nullable=False),
        sa.Column("draft_year", sa.Integer(), nullable=True),
        sa.Column("draft_round", sa.Integer(), nullable=True),
        sa.Column("draft_pick", sa.Integer(), nullable=True),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=True),
        sa.Column("retirement_year", sa.Integer(), nullable=True),
        sa.Column("position", sa.String(length=30), nullable=True),
        sa.UniqueConstraint("name", "draft_year", "draft_pick", name="uq_players_name_year_pick"),
    )
    op.create_index("ix_players_name", "players", ["name"])
    op.create_index("ix_players_draft_year", "players", ["draft_year"])
    op.create_index("ix_players_draft_round", "players", ["draft_round"])
    op.create_index("ix_players_draft_pick", "players", ["draft_pick"])
    op.create_index("ix_players_team_id", "players", ["team_id"])
    op.create_index("ix_players_retirement_year", "players", ["retirement_year"])
    op.create_index("ix_players_position", "players", ["position"])

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("clerk_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("username", sa.String(length=80), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_users_clerk_id", "users", ["clerk_id"])
    op.create_index("ix_users_username", "users", ["username"])
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "draft_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("rules", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_draft_types_name", "draft_types", ["name"])
    op.create_index("ix_draft_types_created_by_id", "draft_types", ["created_by_id"])
    op.create_index("ix_draft_types_is_public", "draft_types", ["is_public"])

    op.create_table(
        "drafts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_type_id", sa.Integer(), sa.ForeignKey("draft_types.id"), nullable=False),
        sa.Column("host_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("guest_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("picks_per_player", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("show_suggestions", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="lobby"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_drafts_draft_type_id", "drafts", ["draft_type_id"])
    op.create_index("ix_drafts_host_id", "drafts", ["host_id"])
    op.create_index("ix_drafts_guest_id", "drafts", ["guest_id"])
    op.create_index("ix_drafts_status", "drafts", ["status"])

    op.create_table(
        "draft_picks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("drafts.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("players.id"), nullable=False),
        sa.Column("pick_number", sa.Integer(), nullable=False),
        sa.Column("constraint_team", sa.String(length=120), nullable=True),
        sa.Column("constraint_year", sa.String(length=40), nullable=True),
        sa.Column("picked_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_draft_picks_draft_id", "draft_picks", ["draft_id"])
    op.create_index("ix_draft_picks_user_id", "draft_picks", ["user_id"])
    op.create_index("ix_draft_picks_player_id", "draft_picks", ["player_id"])
    op.create_index("ix_draft_picks_pick_number", "draft_picks", ["pick_number"])

    op.create_table(
        "games",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("draft_id", sa.Integer(), sa.ForeignKey("drafts.id"), nullable=False),
        sa.Column("user1_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("user2_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("user1_score", sa.Integer(), nullable=True),
        sa.Column("user2_score", sa.Integer(), nullable=True),
        sa.Column("game_mode", sa.String(length=80), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("played_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_games_draft_id", "games", ["draft_id"])
    op.create_index("ix_games_user1_id", "games", ["user1_id"])
    op.create_index("ix_games_user2_id", "games", ["user2_id"])
    op.create_index("ix_games_game_mode", "games", ["game_mode"])


def downgrade() -> None:
    op.drop_table("games")
    op.drop_table("draft_picks")
    op.drop_table("drafts")
    op.drop_table("draft_types")
    op.drop_table("users")
    op.drop_table("players")
    op.drop_table("teams")


