from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)

    # Name from identity provider (e.g., Google via Clerk). Used for display, not as a unique handle.
    full_name: Mapped[str | None] = mapped_column(String(140), nullable=True)

    username: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    created_draft_types: Mapped[list["DraftType"]] = relationship("DraftType", back_populates="created_by")
    hosted_drafts: Mapped[list["Draft"]] = relationship("Draft", back_populates="host", foreign_keys="Draft.host_id")
    joined_drafts: Mapped[list["Draft"]] = relationship("Draft", back_populates="guest", foreign_keys="Draft.guest_id")
    draft_picks: Mapped[list["DraftPick"]] = relationship("DraftPick", back_populates="user")



