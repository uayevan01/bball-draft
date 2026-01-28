from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    draft_type_id: Mapped[int] = mapped_column(ForeignKey("draft_types.id"), nullable=False, index=True)

    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    guest_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )

    picks_per_player: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    show_suggestions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="lobby", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    draft_type: Mapped["DraftType"] = relationship("DraftType", back_populates="drafts")
    host: Mapped["User"] = relationship("User", back_populates="hosted_drafts", foreign_keys=[host_id])
    guest: Mapped["User | None"] = relationship("User", back_populates="joined_drafts", foreign_keys=[guest_id])

    picks: Mapped[list["DraftPick"]] = relationship("DraftPick", back_populates="draft", cascade="all, delete-orphan")
    games: Mapped[list["Game"]] = relationship("Game", back_populates="draft", cascade="all, delete-orphan")


