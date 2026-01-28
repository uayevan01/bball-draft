from __future__ import annotations

import uuid
from datetime import datetime

from app.schemas.base import ORMBaseModel


class UserOut(ORMBaseModel):
    id: uuid.UUID
    clerk_id: str
    username: str | None = None
    email: str | None = None
    created_at: datetime


