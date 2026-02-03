from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.base import ORMBaseModel


class DraftTypeCreate(ORMBaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    rules: dict = Field(default_factory=dict)
    is_public: bool = False


class DraftTypeUpdate(ORMBaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    rules: dict | None = None
    is_public: bool | None = None


class DraftTypeOut(ORMBaseModel):
    id: int
    name: str
    description: str | None = None
    rules: dict
    created_by_id: uuid.UUID | None = None
    created_by_username: str | None = None
    is_public: bool
    created_at: datetime
    usage_count: int = 0


