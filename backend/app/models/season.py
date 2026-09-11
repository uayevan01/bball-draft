from __future__ import annotations

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Season(Base):
    __tablename__ = "seasons"
    __table_args__ = (UniqueConstraint("start_year", name="uq_seasons_start_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Season start year (e.g. 2025 = 2025-26), matching PlayerTeamStint convention.
    start_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # Normally start_year + 1; override for lockouts / irregular seasons.
    end_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(16), nullable=True)

    player_season_stats: Mapped[list["PlayerSeasonStat"]] = relationship(
        "PlayerSeasonStat", back_populates="season", cascade="all, delete-orphan"
    )
    player_awards: Mapped[list["PlayerAward"]] = relationship(
        "PlayerAward", back_populates="season", cascade="all, delete-orphan"
    )
