from __future__ import annotations

from app.schemas.base import ORMBaseModel
from app.schemas.player_season_stat import SeasonOut


class AwardOut(ORMBaseModel):
    id: int
    slug: str
    name: str
    category: str | None = None


class PlayerAwardOut(ORMBaseModel):
    id: int
    player_id: int
    award_id: int
    season_id: int
    team_id: int | None = None
    award: AwardOut | None = None
    season: SeasonOut | None = None
