from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class PlayerAward(Base):
    __tablename__ = "player_awards"
    __table_args__ = (
        UniqueConstraint("player_id", "award_id", "season_id", name="uq_player_awards_player_award_season"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False, index=True)
    award_id: Mapped[int] = mapped_column(ForeignKey("awards.id"), nullable=False, index=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"), nullable=False, index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True, index=True)

    player: Mapped["Player"] = relationship("Player", back_populates="player_awards")
    award: Mapped["Award"] = relationship("Award", back_populates="player_awards")
    season: Mapped["Season"] = relationship("Season", back_populates="player_awards")
    team: Mapped["Team | None"] = relationship("Team")
