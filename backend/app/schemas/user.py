from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.base import ORMBaseModel


class UserOut(ORMBaseModel):
    id: uuid.UUID
    clerk_id: str
    full_name: str | None = None
    username: str | None = None
    email: str | None = None
    created_at: datetime


class UserUpdate(ORMBaseModel):
    full_name: str | None = Field(default=None, max_length=140)
    username: str | None = Field(default=None, min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_]+$")


