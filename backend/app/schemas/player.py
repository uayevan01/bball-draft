from __future__ import annotations

from pydantic import Field

from app.schemas.base import ORMBaseModel
from app.schemas.player_team_stint import PlayerTeamStintWithTeamOut


class PlayerOut(ORMBaseModel):
    id: int
    name: str
    bref_id: str | None = None
    draft_year: int | None = None
    draft_round: int | None = None
    draft_pick: int | None = None
    team_id: int | None = None
    career_start_year: int | None = None
    retirement_year: int | None = None
    hall_of_fame: bool = False
    position: str | None = None
    image_url: str | None = None


class PlayerDetailOut(PlayerOut):
    team_stints: list[PlayerTeamStintWithTeamOut] = Field(default_factory=list)
    # Number of team stints after coalescing consecutive stints that belong to the same franchise
    # (e.g., SEA->OKC without another team in between counts as 1).
    coalesced_team_stint_count: int = 0


