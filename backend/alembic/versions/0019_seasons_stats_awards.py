"""Add seasons, player season stats, awards, and player awards.

Revision ID: 0019_seasons_stats_awards
Revises: 0018_drafts_current_constraint
Create Date: 2026-09-11
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0019_seasons_stats_awards"
down_revision = "0018_drafts_current_constraint"
branch_labels = None
depends_on = None

AWARD_ROWS = [
    {"slug": "mvp", "name": "Most Valuable Player", "category": "season"},
    {"slug": "dpoy", "name": "Defensive Player of the Year", "category": "season"},
    {"slug": "roy", "name": "Rookie of the Year", "category": "season"},
    {"slug": "mip", "name": "Most Improved Player", "category": "season"},
    {"slug": "sixth_man", "name": "Sixth Man of the Year", "category": "season"},
    {"slug": "finals_mvp", "name": "Finals MVP", "category": "playoffs"},
    {"slug": "championship", "name": "NBA Championship", "category": "championship"},
    {"slug": "all_star", "name": "All-Star", "category": "all_star"},
    {"slug": "all_nba_1", "name": "All-NBA First Team", "category": "all_nba"},
    {"slug": "all_nba_2", "name": "All-NBA Second Team", "category": "all_nba"},
    {"slug": "all_nba_3", "name": "All-NBA Third Team", "category": "all_nba"},
    {"slug": "all_defense_1", "name": "All-Defensive First Team", "category": "all_defense"},
    {"slug": "all_defense_2", "name": "All-Defensive Second Team", "category": "all_defense"},
    {"slug": "all_rookie_1", "name": "All-Rookie First Team", "category": "all_rookie"},
    {"slug": "all_rookie_2", "name": "All-Rookie Second Team", "category": "all_rookie"},
]

# BAA/NBA first season is 1946-47. Prefill through a near-future season so scrape order
# does not determine season ids (id 1 = 1946-47).
NBA_FIRST_START_YEAR = 1946
SEASONS_THROUGH_START_YEAR = 2026


def _season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


SEASON_ROWS = [
    {
        "start_year": y,
        "end_year": y + 1,
        "label": _season_label(y),
    }
    for y in range(NBA_FIRST_START_YEAR, SEASONS_THROUGH_START_YEAR + 1)
]


def upgrade() -> None:
    op.create_table(
        "seasons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("start_year", sa.Integer(), nullable=False),
        sa.Column("end_year", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=16), nullable=True),
        sa.UniqueConstraint("start_year", name="uq_seasons_start_year"),
    )
    op.create_index("ix_seasons_start_year", "seasons", ["start_year"])
    op.create_index("ix_seasons_end_year", "seasons", ["end_year"])

    seasons_table = sa.table(
        "seasons",
        sa.column("start_year", sa.Integer),
        sa.column("end_year", sa.Integer),
        sa.column("label", sa.String),
    )
    op.bulk_insert(seasons_table, SEASON_ROWS)

    op.create_table(
        "awards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=True),
        sa.UniqueConstraint("slug", name="uq_awards_slug"),
    )
    op.create_index("ix_awards_slug", "awards", ["slug"])
    op.create_index("ix_awards_category", "awards", ["category"])

    awards_table = sa.table(
        "awards",
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
    )
    op.bulk_insert(awards_table, AWARD_ROWS)

    op.create_table(
        "player_season_stats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("players.id"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("seasons.id"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=False),
        sa.Column("games", sa.Integer(), nullable=True),
        sa.Column("games_started", sa.Integer(), nullable=True),
        sa.Column("minutes", sa.Integer(), nullable=True),
        sa.Column("fg", sa.Integer(), nullable=True),
        sa.Column("fga", sa.Integer(), nullable=True),
        sa.Column("fg3", sa.Integer(), nullable=True),
        sa.Column("fg3a", sa.Integer(), nullable=True),
        sa.Column("fg2", sa.Integer(), nullable=True),
        sa.Column("fg2a", sa.Integer(), nullable=True),
        sa.Column("ft", sa.Integer(), nullable=True),
        sa.Column("fta", sa.Integer(), nullable=True),
        sa.Column("orb", sa.Integer(), nullable=True),
        sa.Column("drb", sa.Integer(), nullable=True),
        sa.Column("trb", sa.Integer(), nullable=True),
        sa.Column("ast", sa.Integer(), nullable=True),
        sa.Column("stl", sa.Integer(), nullable=True),
        sa.Column("blk", sa.Integer(), nullable=True),
        sa.Column("tov", sa.Integer(), nullable=True),
        sa.Column("pf", sa.Integer(), nullable=True),
        sa.Column("pts", sa.Integer(), nullable=True),
        sa.Column("fg_pct", sa.Float(), nullable=True),
        sa.Column("fg3_pct", sa.Float(), nullable=True),
        sa.Column("fg2_pct", sa.Float(), nullable=True),
        sa.Column("efg_pct", sa.Float(), nullable=True),
        sa.Column("ft_pct", sa.Float(), nullable=True),
        sa.Column("ts_pct", sa.Float(), nullable=True),
        sa.Column("per", sa.Float(), nullable=True),
        sa.Column("orb_pct", sa.Float(), nullable=True),
        sa.Column("drb_pct", sa.Float(), nullable=True),
        sa.Column("trb_pct", sa.Float(), nullable=True),
        sa.Column("ast_pct", sa.Float(), nullable=True),
        sa.Column("stl_pct", sa.Float(), nullable=True),
        sa.Column("blk_pct", sa.Float(), nullable=True),
        sa.Column("tov_pct", sa.Float(), nullable=True),
        sa.Column("usg_pct", sa.Float(), nullable=True),
        sa.Column("ows", sa.Float(), nullable=True),
        sa.Column("dws", sa.Float(), nullable=True),
        sa.Column("ws", sa.Float(), nullable=True),
        sa.Column("ws_per_48", sa.Float(), nullable=True),
        sa.Column("obpm", sa.Float(), nullable=True),
        sa.Column("dbpm", sa.Float(), nullable=True),
        sa.Column("bpm", sa.Float(), nullable=True),
        sa.Column("vorp", sa.Float(), nullable=True),
        sa.Column("scraped_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "player_id", "season_id", "team_id", name="uq_player_season_stats_player_season_team"
        ),
    )
    op.create_index("ix_player_season_stats_player_id", "player_season_stats", ["player_id"])
    op.create_index("ix_player_season_stats_season_id", "player_season_stats", ["season_id"])
    op.create_index("ix_player_season_stats_team_id", "player_season_stats", ["team_id"])

    op.create_table(
        "player_awards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), sa.ForeignKey("players.id"), nullable=False),
        sa.Column("award_id", sa.Integer(), sa.ForeignKey("awards.id"), nullable=False),
        sa.Column("season_id", sa.Integer(), sa.ForeignKey("seasons.id"), nullable=False),
        sa.Column("team_id", sa.Integer(), sa.ForeignKey("teams.id"), nullable=True),
        sa.UniqueConstraint(
            "player_id", "award_id", "season_id", name="uq_player_awards_player_award_season"
        ),
    )
    op.create_index("ix_player_awards_player_id", "player_awards", ["player_id"])
    op.create_index("ix_player_awards_award_id", "player_awards", ["award_id"])
    op.create_index("ix_player_awards_season_id", "player_awards", ["season_id"])
    op.create_index("ix_player_awards_team_id", "player_awards", ["team_id"])

    op.add_column("players", sa.Column("stats_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("players", sa.Column("awards_scraped_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_players_stats_scraped_at", "players", ["stats_scraped_at"])
    op.create_index("ix_players_awards_scraped_at", "players", ["awards_scraped_at"])


def downgrade() -> None:
    op.drop_index("ix_players_awards_scraped_at", table_name="players")
    op.drop_index("ix_players_stats_scraped_at", table_name="players")
    op.drop_column("players", "awards_scraped_at")
    op.drop_column("players", "stats_scraped_at")
    op.drop_table("player_awards")
    op.drop_table("player_season_stats")
    op.drop_table("awards")
    op.drop_table("seasons")
