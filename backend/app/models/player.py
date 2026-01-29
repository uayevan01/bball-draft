from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy import Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (
        UniqueConstraint("name", "draft_year", "draft_pick", name="uq_players_name_year_pick"),
        UniqueConstraint("bref_id", name="uq_players_bref_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(140), nullable=False, index=True)
    bref_id: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)

    draft_year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    draft_round: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    draft_pick: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    # First season year from BRef A–Z index "From" column.
    career_start_year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    retirement_year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    hall_of_fame: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    position: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    stints_scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    drafted_team: Mapped["Team | None"] = relationship("Team", back_populates="drafted_players")
    draft_picks: Mapped[list["DraftPick"]] = relationship("DraftPick", back_populates="player")
    team_stints: Mapped[list["PlayerTeamStint"]] = relationship(
        "PlayerTeamStint", back_populates="player", cascade="all, delete-orphan"
    )



