from __future__ import annotations

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Award(Base):
    __tablename__ = "awards"
    __table_args__ = (UniqueConstraint("slug", name="uq_awards_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Grouping hint for filters (e.g. all_nba, all_defense, season, championship).
    category: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)

    player_awards: Mapped[list["PlayerAward"]] = relationship(
        "PlayerAward", back_populates="award", cascade="all, delete-orphan"
    )
