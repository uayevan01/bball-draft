from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class DraftPick(Base):
    __tablename__ = "draft_picks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), nullable=False, index=True)

    pick_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

    # Persist role so local drafts (single user controlling both sides) can rehydrate correctly.
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="host", index=True)

    # Keep these as plain strings so DraftTypes can implement decade/range/team rules flexibly.
    constraint_team: Mapped[str | None] = mapped_column(String(120), nullable=True)
    constraint_year: Mapped[str | None] = mapped_column(String(40), nullable=True)

    picked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    draft: Mapped["Draft"] = relationship("Draft", back_populates="picks")
    user: Mapped["User"] = relationship("User", back_populates="draft_picks")
    player: Mapped["Player"] = relationship("Player", back_populates="draft_picks")


