from __future__ import annotations

from app.schemas.base import ORMBaseModel


class SeasonOut(ORMBaseModel):
    id: int
    start_year: int
    end_year: int
    label: str | None = None


class PlayerSeasonStatOut(ORMBaseModel):
    id: int
    player_id: int
    season_id: int
    team_id: int
    is_postseason: bool = False
    season: SeasonOut | None = None

    games: int | None = None
    games_started: int | None = None
    minutes: int | None = None
    fg: int | None = None
    fga: int | None = None
    fg3: int | None = None
    fg3a: int | None = None
    fg2: int | None = None
    fg2a: int | None = None
    ft: int | None = None
    fta: int | None = None
    orb: int | None = None
    drb: int | None = None
    trb: int | None = None
    ast: int | None = None
    stl: int | None = None
    blk: int | None = None
    tov: int | None = None
    pf: int | None = None
    pts: int | None = None

    fg_pct: float | None = None
    fg3_pct: float | None = None
    fg2_pct: float | None = None
    efg_pct: float | None = None
    ft_pct: float | None = None
    ts_pct: float | None = None

    per: float | None = None
    orb_pct: float | None = None
    drb_pct: float | None = None
    trb_pct: float | None = None
    ast_pct: float | None = None
    stl_pct: float | None = None
    blk_pct: float | None = None
    tov_pct: float | None = None
    usg_pct: float | None = None
    ows: float | None = None
    dws: float | None = None
    ws: float | None = None
    ws_per_48: float | None = None
    obpm: float | None = None
    dbpm: float | None = None
    bpm: float | None = None
    vorp: float | None = None


class PlayerSeasonStatsAggregateOut(ORMBaseModel):
    player_id: int
    season_start: int | None = None
    season_end: int | None = None
    team_ids: list[int] = []
    seasons: int = 0
    rows: int = 0

    games: int | None = None
    games_started: int | None = None
    minutes: int | None = None
    fg: int | None = None
    fga: int | None = None
    fg3: int | None = None
    fg3a: int | None = None
    fg2: int | None = None
    fg2a: int | None = None
    ft: int | None = None
    fta: int | None = None
    orb: int | None = None
    drb: int | None = None
    trb: int | None = None
    ast: int | None = None
    stl: int | None = None
    blk: int | None = None
    tov: int | None = None
    pf: int | None = None
    pts: int | None = None

    # Recomputed from totals where possible
    fg_pct: float | None = None
    fg3_pct: float | None = None
    fg2_pct: float | None = None
    efg_pct: float | None = None
    ft_pct: float | None = None
    ts_pct: float | None = None

    # Summed advanced counting metrics; rates left null when multi-row
    ows: float | None = None
    dws: float | None = None
    ws: float | None = None
    vorp: float | None = None
    per: float | None = None
    bpm: float | None = None
    obpm: float | None = None
    dbpm: float | None = None
    usg_pct: float | None = None
    ws_per_48: float | None = None
    orb_pct: float | None = None
    drb_pct: float | None = None
    trb_pct: float | None = None
    ast_pct: float | None = None
    stl_pct: float | None = None
    blk_pct: float | None = None
    tov_pct: float | None = None


class PlayerSeasonStatsResponse(ORMBaseModel):
    player_id: int
    aggregate: bool
    season_type: str = "regular"
    rows: list[PlayerSeasonStatOut] = []
    totals: PlayerSeasonStatsAggregateOut | None = None
