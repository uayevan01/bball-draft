from __future__ import annotations

from app.schemas.base import ORMBaseModel


class PlayerTeamStintOut(ORMBaseModel):
    id: int
    player_id: int
    team_id: int
    start_year: int
    end_year: int | None = None


