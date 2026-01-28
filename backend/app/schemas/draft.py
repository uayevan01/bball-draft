from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.base import ORMBaseModel
from app.schemas.user import UserOut


class DraftCreate(ORMBaseModel):
    draft_type_id: int
    picks_per_player: int = Field(default=10, ge=1, le=30)
    show_suggestions: bool = True


class DraftPickOut(ORMBaseModel):
    id: int
    draft_id: int
    user_id: uuid.UUID
    player_id: int
    pick_number: int
    constraint_team: str | None = None
    constraint_year: str | None = None
    picked_at: datetime


class DraftOut(ORMBaseModel):
    id: int
    draft_type_id: int
    host_id: uuid.UUID
    guest_id: uuid.UUID | None = None
    picks_per_player: int
    show_suggestions: bool
    status: str
    created_at: datetime
    completed_at: datetime | None = None

    host: UserOut | None = None
    guest: UserOut | None = None
    picks: list[DraftPickOut] = Field(default_factory=list)


