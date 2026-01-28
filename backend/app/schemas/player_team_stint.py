from __future__ import annotations

from app.schemas.base import ORMBaseModel
from app.schemas.team import TeamOut


class PlayerTeamStintOut(ORMBaseModel):
    id: int
    player_id: int
    team_id: int
    start_year: int
    end_year: int | None = None


class PlayerTeamStintWithTeamOut(ORMBaseModel):
    id: int
    player_id: int
    team_id: int
    start_year: int
    end_year: int | None = None
    team: TeamOut | None = None


