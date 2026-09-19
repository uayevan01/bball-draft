from __future__ import annotations

from pydantic import Field

from app.schemas.base import ORMBaseModel
from app.schemas.player_team_stint import PlayerTeamStintWithTeamOut


class PlayerCareerStatsOut(ORMBaseModel):
    """Regular-season career counting totals. Per-game values are derived by the client."""

    pts: int | None = None
    trb: int | None = None
    ast: int | None = None
    stl: int | None = None
    blk: int | None = None
    games: int | None = None


class PlayerAwardCountsOut(ORMBaseModel):
    all_star: int = 0
    all_nba: int = 0
    all_nba_1: int = 0
    all_nba_2: int = 0
    all_nba_3: int = 0
    all_defense: int = 0
    all_defense_1: int = 0
    all_defense_2: int = 0
    mvp: int = 0
    championship: int = 0
    finals_mvp: int = 0


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
    latest_team_id: int | None = None
    career_stats: PlayerCareerStatsOut | None = None
    award_counts: PlayerAwardCountsOut | None = None


class PlayerDetailOut(PlayerOut):
    team_stints: list[PlayerTeamStintWithTeamOut] = Field(default_factory=list)
    # Number of team stints after coalescing consecutive stints that belong to the same franchise
    # (e.g., SEA->OKC without another team in between counts as 1).
    coalesced_team_stint_count: int = 0
    playoff_stats: PlayerCareerStatsOut | None = None


class PlayerListPageOut(ORMBaseModel):
    items: list[PlayerOut]
    total: int


