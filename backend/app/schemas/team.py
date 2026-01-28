from __future__ import annotations

from app.schemas.base import ORMBaseModel


class TeamOut(ORMBaseModel):
    id: int
    name: str
    city: str | None = None
    abbreviation: str | None = None
    previous_team_id: int | None = None
    founded_year: int | None = None
    dissolved_year: int | None = None
    conference: str | None = None
    division: str | None = None


