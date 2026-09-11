"""Rebuild seasons catalog from NBA inaugural season and remap FKs.

Revision ID: 0020_seed_seasons_catalog
Revises: 0019_seasons_stats_awards
Create Date: 2026-09-11
"""

from __future__ import annotations

from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op


revision = "0020_seed_seasons_catalog"
down_revision = "0019_seasons_stats_awards"
branch_labels = None
depends_on = None

# BAA/NBA first season is 1946-47.
NBA_FIRST_START_YEAR = 1946


def _season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def _season_rows(*, through_start_year: int) -> list[dict]:
    return [
        {
            "start_year": y,
            "end_year": y + 1,
            "label": _season_label(y),
        }
        for y in range(NBA_FIRST_START_YEAR, through_start_year + 1)
    ]


def upgrade() -> None:
    conn = op.get_bind()

    # Keep enough runway for the current / next season.
    through = max(datetime.now(timezone.utc).year + 1, 2026)
    existing_max = conn.execute(sa.text("SELECT COALESCE(MAX(start_year), 0) FROM seasons")).scalar()
    if existing_max:
        through = max(through, int(existing_max))

    # Preserve start_year mapping so existing stats/awards keep pointing at the right season.
    op.execute("CREATE TABLE _seasons_remap AS SELECT id AS old_id, start_year FROM seasons")

    op.drop_constraint("player_season_stats_season_id_fkey", "player_season_stats", type_="foreignkey")
    op.drop_constraint("player_awards_season_id_fkey", "player_awards", type_="foreignkey")

    op.execute("TRUNCATE seasons RESTART IDENTITY")

    seasons_table = sa.table(
        "seasons",
        sa.column("start_year", sa.Integer),
        sa.column("end_year", sa.Integer),
        sa.column("label", sa.String),
    )
    op.bulk_insert(seasons_table, _season_rows(through_start_year=through))

    op.execute(
        """
        UPDATE player_season_stats AS pss
        SET season_id = s.id
        FROM _seasons_remap AS so
        JOIN seasons AS s ON s.start_year = so.start_year
        WHERE pss.season_id = so.old_id
        """
    )
    op.execute(
        """
        UPDATE player_awards AS pa
        SET season_id = s.id
        FROM _seasons_remap AS so
        JOIN seasons AS s ON s.start_year = so.start_year
        WHERE pa.season_id = so.old_id
        """
    )

    op.create_foreign_key(
        "player_season_stats_season_id_fkey",
        "player_season_stats",
        "seasons",
        ["season_id"],
        ["id"],
    )
    op.create_foreign_key(
        "player_awards_season_id_fkey",
        "player_awards",
        "seasons",
        ["season_id"],
        ["id"],
    )
    op.execute("DROP TABLE _seasons_remap")


def downgrade() -> None:
    # Catalog rebuild is not cleanly reversible without losing prefilled early seasons.
    pass
