from __future__ import annotations

from app.schemas.base import ORMBaseModel


class PlayerOut(ORMBaseModel):
    id: int
    name: str
    bref_id: str | None = None
    draft_year: int | None = None
    draft_round: int | None = None
    draft_pick: int | None = None
    team_id: int | None = None
    retirement_year: int | None = None
    position: str | None = None


