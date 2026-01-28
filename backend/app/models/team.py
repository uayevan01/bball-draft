from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("abbreviation", name="uq_teams_abbreviation"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    city: Mapped[str | None] = mapped_column(String(80), nullable=True)
    abbreviation: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)

    previous_team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)
    founded_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dissolved_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    conference: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    division: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)

    previous_team: Mapped["Team | None"] = relationship(
        "Team",
        remote_side="Team.id",
        back_populates="next_teams",
    )
    next_teams: Mapped[list["Team"]] = relationship(
        "Team",
        back_populates="previous_team",
        cascade="all, delete-orphan",
    )

    drafted_players: Mapped[list["Player"]] = relationship(
        "Player",
        back_populates="drafted_team",
        cascade="all, delete-orphan",
    )


