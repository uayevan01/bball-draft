from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.base import ORMBaseModel


class GameCreate(ORMBaseModel):
    draft_id: int
    user1_score: int | None = Field(default=None, ge=0)
    user2_score: int | None = Field(default=None, ge=0)
    game_mode: str | None = Field(default=None, max_length=80)
    notes: str | None = None
    played_at: datetime | None = None


class GameOut(ORMBaseModel):
    id: int
    draft_id: int
    user1_id: uuid.UUID
    user2_id: uuid.UUID
    user1_score: int | None = None
    user2_score: int | None = None
    game_mode: str | None = None
    notes: str | None = None
    played_at: datetime


