from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PlayerSeasonStat(Base):
    """
    One row per player / season / team (no BRef TOT rows).
    Counting stats are season totals; rate/advanced columns are denormalized for filtering.
    """

    __tablename__ = "player_season_stats"
    __table_args__ = (
        UniqueConstraint("player_id", "season_id", "team_id", name="uq_player_season_stats_player_season_team"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False, index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False, index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)

    # Counting (totals)
    games: Mapped[int | None] = mapped_column(Integer, nullable=True)
    games_started: Mapped[int | None] = mapped_column(Integer, nullable=True)
    minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fga: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg3: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg3a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg2: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fg2a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    orb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    drb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ast: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stl: Mapped[int | None] = mapped_column(Integer, nullable=True)
    blk: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tov: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pf: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pts: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Rates (denormalized)
    fg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    fg3_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    fg2_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    efg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    ft_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    ts_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Advanced
    per: Mapped[float | None] = mapped_column(Float, nullable=True)
    orb_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    drb_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    trb_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    ast_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    stl_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    blk_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    tov_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    usg_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    ows: Mapped[float | None] = mapped_column(Float, nullable=True)
    dws: Mapped[float | None] = mapped_column(Float, nullable=True)
    ws: Mapped[float | None] = mapped_column(Float, nullable=True)
    ws_per_48: Mapped[float | None] = mapped_column(Float, nullable=True)
    obpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    dbpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    vorp: Mapped[float | None] = mapped_column(Float, nullable=True)

    scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    player: Mapped["Player"] = relationship("Player", back_populates="season_stats")
    season: Mapped["Season"] = relationship("Season", back_populates="player_season_stats")
    team: Mapped["Team"] = relationship("Team")
