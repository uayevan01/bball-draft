from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PlayerTeamStint(Base):
    __tablename__ = "player_team_stints"
    __table_args__ = (
        UniqueConstraint("player_id", "team_id", "start_year", name="uq_player_team_stints_player_team_start"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False, index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), nullable=False, index=True)

    # Years are NBA season start years (e.g. 2003 means 2003-04 season).
    start_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # end_year is exclusive-ish in your examples (2010 means left after 2009-10 season). We'll store last season end year.
    end_year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    player: Mapped["Player"] = relationship("Player", back_populates="team_stints")
    team: Mapped["Team"] = relationship("Team")


