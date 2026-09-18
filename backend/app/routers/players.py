from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Float, and_, desc, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.database import get_db
from app.models import Award, Player, PlayerAward, PlayerSeasonStat, PlayerTeamStint, Season, Team
from app.schemas.player import PlayerAwardCountsOut, PlayerCareerStatsOut, PlayerDetailOut, PlayerListPageOut, PlayerOut
from app.schemas.player_award import PlayerAwardOut
from app.schemas.player_season_stat import (
    PlayerSeasonStatOut,
    PlayerSeasonStatsAggregateOut,
    PlayerSeasonStatsResponse,
)

router = APIRouter(prefix="/players", tags=["players"])

_COUNTING_FIELDS = (
    "games",
    "games_started",
    "minutes",
    "fg",
    "fga",
    "fg3",
    "fg3a",
    "fg2",
    "fg2a",
    "ft",
    "fta",
    "orb",
    "drb",
    "trb",
    "ast",
    "stl",
    "blk",
    "tov",
    "pf",
    "pts",
)

_SEASON_TYPES = ("regular", "postseason", "all")
_STAT_MODES = ("totals", "per_game")
_SORT_DIRS = ("asc", "desc")
_SORT_KEYS = (
    "name",
    "position",
    "team",
    "years",
    "pts",
    "trb",
    "ast",
    "stl",
    "blk",
    "hof",
    "all_nba",
    "all_star",
    "all_def",
    "mvp",
    "rings",
    "fmvp",
)
_STAT_SORT_COLS = {
    "pts": PlayerSeasonStat.pts,
    "trb": PlayerSeasonStat.trb,
    "ast": PlayerSeasonStat.ast,
    "stl": PlayerSeasonStat.stl,
    "blk": PlayerSeasonStat.blk,
}
_AWARD_COUNT_SLUGS = (
    "all_star",
    "all_nba_1",
    "all_nba_2",
    "all_nba_3",
    "all_defense_1",
    "all_defense_2",
    "mvp",
    "championship",
    "finals_mvp",
)


def _safe_div(num: float | None, den: float | None) -> float | None:
    if num is None or den is None or den == 0:
        return None
    return float(num) / float(den)


def _aggregate_season_stats(
    *,
    player_id: int,
    rows: list[PlayerSeasonStat],
    season_start: int | None,
    season_end: int | None,
    team_ids: list[int],
) -> PlayerSeasonStatsAggregateOut:
    sums: dict[str, float] = {f: 0.0 for f in _COUNTING_FIELDS}
    for f in ("ows", "dws", "ws", "vorp"):
        sums[f] = 0.0
    present = {f: False for f in sums}

    season_ids: set[int] = set()
    for row in rows:
        season_ids.add(int(row.season_id))
        for f in _COUNTING_FIELDS:
            val = getattr(row, f, None)
            if val is not None:
                sums[f] += float(val)
                present[f] = True
        for f in ("ows", "dws", "ws", "vorp"):
            val = getattr(row, f, None)
            if val is not None:
                sums[f] += float(val)
                present[f] = True

    fg = sums["fg"] if present["fg"] else None
    fga = sums["fga"] if present["fga"] else None
    fg3 = sums["fg3"] if present["fg3"] else None
    fg3a = sums["fg3a"] if present["fg3a"] else None
    fg2 = sums["fg2"] if present["fg2"] else None
    fg2a = sums["fg2a"] if present["fg2a"] else None
    ft = sums["ft"] if present["ft"] else None
    fta = sums["fta"] if present["fta"] else None
    pts = sums["pts"] if present["pts"] else None

    # Effective FG%: (FG + 0.5 * 3P) / FGA
    efg_pct = None
    if fg is not None and fga is not None and fga > 0:
        efg_pct = (fg + 0.5 * (fg3 or 0.0)) / fga

    # True shooting: PTS / (2 * (FGA + 0.44 * FTA))
    ts_pct = None
    if pts is not None and fga is not None:
        denom = 2.0 * (fga + 0.44 * (fta or 0.0))
        if denom > 0:
            ts_pct = pts / denom

    def _sum_or_none(field: str) -> float | None:
        return sums[field] if present[field] else None

    # Minutes-weighted averages for single-value advanced rates when possible.
    total_mp = _sum_or_none("minutes")
    weighted: dict[str, float | None] = {
        "per": None,
        "bpm": None,
        "obpm": None,
        "dbpm": None,
        "usg_pct": None,
        "ws_per_48": None,
        "orb_pct": None,
        "drb_pct": None,
        "trb_pct": None,
        "ast_pct": None,
        "stl_pct": None,
        "blk_pct": None,
        "tov_pct": None,
    }
    if total_mp and total_mp > 0:
        for field in weighted:
            acc = 0.0
            used = False
            for row in rows:
                mp = row.minutes
                val = getattr(row, field, None)
                if mp is None or val is None:
                    continue
                acc += float(val) * float(mp)
                used = True
            if used:
                weighted[field] = acc / total_mp

    return PlayerSeasonStatsAggregateOut(
        player_id=player_id,
        season_start=season_start,
        season_end=season_end,
        team_ids=team_ids,
        seasons=len(season_ids),
        rows=len(rows),
        games=int(sums["games"]) if present["games"] else None,
        games_started=int(sums["games_started"]) if present["games_started"] else None,
        minutes=int(sums["minutes"]) if present["minutes"] else None,
        fg=int(sums["fg"]) if present["fg"] else None,
        fga=int(sums["fga"]) if present["fga"] else None,
        fg3=int(sums["fg3"]) if present["fg3"] else None,
        fg3a=int(sums["fg3a"]) if present["fg3a"] else None,
        fg2=int(sums["fg2"]) if present["fg2"] else None,
        fg2a=int(sums["fg2a"]) if present["fg2a"] else None,
        ft=int(sums["ft"]) if present["ft"] else None,
        fta=int(sums["fta"]) if present["fta"] else None,
        orb=int(sums["orb"]) if present["orb"] else None,
        drb=int(sums["drb"]) if present["drb"] else None,
        trb=int(sums["trb"]) if present["trb"] else None,
        ast=int(sums["ast"]) if present["ast"] else None,
        stl=int(sums["stl"]) if present["stl"] else None,
        blk=int(sums["blk"]) if present["blk"] else None,
        tov=int(sums["tov"]) if present["tov"] else None,
        pf=int(sums["pf"]) if present["pf"] else None,
        pts=int(sums["pts"]) if present["pts"] else None,
        fg_pct=_safe_div(fg, fga),
        fg3_pct=_safe_div(fg3, fg3a),
        fg2_pct=_safe_div(fg2, fg2a),
        efg_pct=efg_pct,
        ft_pct=_safe_div(ft, fta),
        ts_pct=ts_pct,
        ows=_sum_or_none("ows"),
        dws=_sum_or_none("dws"),
        ws=_sum_or_none("ws"),
        vorp=_sum_or_none("vorp"),
        per=weighted["per"],
        bpm=weighted["bpm"],
        obpm=weighted["obpm"],
        dbpm=weighted["dbpm"],
        usg_pct=weighted["usg_pct"],
        ws_per_48=weighted["ws_per_48"],
        orb_pct=weighted["orb_pct"],
        drb_pct=weighted["drb_pct"],
        trb_pct=weighted["trb_pct"],
        ast_pct=weighted["ast_pct"],
        stl_pct=weighted["stl_pct"],
        blk_pct=weighted["blk_pct"],
        tov_pct=weighted["tov_pct"],
    )


def _team_franchise_root_id(team_id: int, prev_by_id: dict[int, int | None]) -> int:
    """
    Follow Team.previous_team_id links to get a stable franchise root id.
    Includes cycle protection.
    """
    cur = team_id
    seen: set[int] = set()
    while cur not in seen:
        seen.add(cur)
        prev = prev_by_id.get(cur)
        if not prev:
            break
        cur = prev
    return cur


def _int_or_none(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _has_awards(*slugs: str):
    return exists(
        select(1)
        .select_from(PlayerAward)
        .join(Award, Award.id == PlayerAward.award_id)
        .where(PlayerAward.player_id == Player.id, Award.slug.in_(list(slugs)))
    )


def _career_stat_expr(col: object, *, per_game: bool):
    total = func.coalesce(func.sum(col), 0)
    if not per_game:
        return total
    games = func.nullif(func.coalesce(func.sum(PlayerSeasonStat.games), 0), 0)
    # Cast so Postgres does float division (integer / integer would truncate PPG).
    return func.cast(total, Float) / games


def _career_stat_sort_expr(col: object, *, per_game: bool):
    return (
        select(_career_stat_expr(col, per_game=per_game))
        .where(
            PlayerSeasonStat.player_id == Player.id,
            PlayerSeasonStat.is_postseason.is_(False),
        )
        .scalar_subquery()
    )


def _award_count_sort_expr(*slugs: str):
    return (
        select(func.count())
        .select_from(PlayerAward)
        .join(Award, Award.id == PlayerAward.award_id)
        .where(PlayerAward.player_id == Player.id, Award.slug.in_(list(slugs)))
        .scalar_subquery()
    )


def _latest_team_sort_expr():
    return (
        select(func.coalesce(Team.abbreviation, Team.name))
        .select_from(PlayerTeamStint)
        .join(Team, Team.id == PlayerTeamStint.team_id)
        .where(PlayerTeamStint.player_id == Player.id)
        .order_by(PlayerTeamStint.start_year.desc(), PlayerTeamStint.id.desc())
        .limit(1)
        .scalar_subquery()
    )


def _directed(expr, sort_dir: str):
    ordered = expr.desc() if sort_dir == "desc" else expr.asc()
    return ordered.nulls_last()


def _selected_award_slugs(
    flags_and_slugs: tuple[tuple[bool | None, str], ...],
    default: tuple[str, ...],
) -> list[str]:
    selected = [slug for flag, slug in flags_and_slugs if flag]
    return selected or list(default)


def _apply_award_count_bounds(stmt, *, slugs: list[str], min_v: int | None, max_v: int | None, label: str, legacy: bool | None):
    if min_v is not None and max_v is not None and min_v > max_v:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"min_{label} cannot exceed max_{label}",
        )
    if min_v is None and max_v is None:
        if legacy:
            return stmt.where(_has_awards(*slugs))
        return stmt
    expr = _award_count_sort_expr(*slugs)
    if min_v is not None:
        stmt = stmt.where(expr >= min_v)
    if max_v is not None:
        stmt = stmt.where(expr <= max_v)
    return stmt


def _player_list_order_by(
    *,
    sort_by: str,
    sort_dir: str,
    stat_mode: str,
    all_nba_slugs: list[str],
    all_def_slugs: list[str],
):
    per_game = stat_mode == "per_game"
    if sort_by in _STAT_SORT_COLS:
        primary = _directed(_career_stat_sort_expr(_STAT_SORT_COLS[sort_by], per_game=per_game), sort_dir)
    elif sort_by == "name":
        primary = _directed(Player.name, sort_dir)
    elif sort_by == "position":
        primary = _directed(Player.position, sort_dir)
    elif sort_by == "team":
        primary = _directed(_latest_team_sort_expr(), sort_dir)
    elif sort_by == "years":
        primary = _directed(Player.career_start_year, sort_dir)
    elif sort_by == "hof":
        primary = _directed(Player.hall_of_fame, sort_dir)
    elif sort_by == "all_nba":
        slugs = all_nba_slugs or ["all_nba_1", "all_nba_2", "all_nba_3"]
        primary = _directed(_award_count_sort_expr(*slugs), sort_dir)
    elif sort_by == "all_star":
        primary = _directed(_award_count_sort_expr("all_star"), sort_dir)
    elif sort_by == "all_def":
        slugs = all_def_slugs or ["all_defense_1", "all_defense_2"]
        primary = _directed(_award_count_sort_expr(*slugs), sort_dir)
    elif sort_by == "mvp":
        primary = _directed(_award_count_sort_expr("mvp"), sort_dir)
    elif sort_by == "rings":
        primary = _directed(_award_count_sort_expr("championship"), sort_dir)
    elif sort_by == "fmvp":
        primary = _directed(_award_count_sort_expr("finals_mvp"), sort_dir)
    else:
        primary = _directed(Player.name, sort_dir)

    if sort_by == "name":
        return (primary, Player.id.asc())
    if sort_by == "years":
        return (primary, _directed(Player.retirement_year, sort_dir), Player.name.asc(), Player.id.asc())
    return (primary, Player.name.asc(), Player.id.asc())


async def _hydrate_player_list(
    db: AsyncSession,
    players: list[Player],
    *,
    include_career_stats: bool,
    include_award_counts: bool,
) -> list[PlayerOut]:
    outs = [PlayerOut.model_validate(p) for p in players]
    if not players:
        return outs
    ids = [p.id for p in players]

    latest_team_by_id: dict[int, int] = {}
    stint_rows = (
        await db.execute(
            select(PlayerTeamStint.player_id, PlayerTeamStint.team_id)
            .where(PlayerTeamStint.player_id.in_(ids))
            .order_by(
                PlayerTeamStint.player_id.asc(),
                PlayerTeamStint.start_year.desc(),
                PlayerTeamStint.id.desc(),
            )
        )
    ).all()
    for pid_raw, team_id_raw in stint_rows:
        pid = int(pid_raw)
        if pid not in latest_team_by_id:
            latest_team_by_id[pid] = int(team_id_raw)

    stats_by_id: dict[int, PlayerCareerStatsOut] = {}
    if include_career_stats:
        rows = (
            await db.execute(
                select(
                    PlayerSeasonStat.player_id,
                    func.sum(PlayerSeasonStat.pts),
                    func.sum(PlayerSeasonStat.trb),
                    func.sum(PlayerSeasonStat.ast),
                    func.sum(PlayerSeasonStat.stl),
                    func.sum(PlayerSeasonStat.blk),
                    func.sum(PlayerSeasonStat.games),
                )
                .where(
                    PlayerSeasonStat.player_id.in_(ids),
                    PlayerSeasonStat.is_postseason.is_(False),
                )
                .group_by(PlayerSeasonStat.player_id)
            )
        ).all()
        for pid, pts, trb, ast, stl, blk, games in rows:
            stats_by_id[int(pid)] = PlayerCareerStatsOut(
                pts=_int_or_none(pts),
                trb=_int_or_none(trb),
                ast=_int_or_none(ast),
                stl=_int_or_none(stl),
                blk=_int_or_none(blk),
                games=_int_or_none(games),
            )

    awards_by_id: dict[int, PlayerAwardCountsOut] = {}
    if include_award_counts:
        raw: dict[int, dict[str, int]] = {pid: {} for pid in ids}
        rows = (
            await db.execute(
                select(PlayerAward.player_id, Award.slug, func.count())
                .join(Award, Award.id == PlayerAward.award_id)
                .where(
                    PlayerAward.player_id.in_(ids),
                    Award.slug.in_(_AWARD_COUNT_SLUGS),
                )
                .group_by(PlayerAward.player_id, Award.slug)
            )
        ).all()
        for pid, slug, n in rows:
            raw[int(pid)][str(slug)] = int(n)
        for pid, counts in raw.items():
            a1 = counts.get("all_nba_1", 0)
            a2 = counts.get("all_nba_2", 0)
            a3 = counts.get("all_nba_3", 0)
            d1 = counts.get("all_defense_1", 0)
            d2 = counts.get("all_defense_2", 0)
            awards_by_id[pid] = PlayerAwardCountsOut(
                all_star=counts.get("all_star", 0),
                all_nba=a1 + a2 + a3,
                all_nba_1=a1,
                all_nba_2=a2,
                all_nba_3=a3,
                all_defense=d1 + d2,
                all_defense_1=d1,
                all_defense_2=d2,
                mvp=counts.get("mvp", 0),
                championship=counts.get("championship", 0),
                finals_mvp=counts.get("finals_mvp", 0),
            )

    return [
        o.model_copy(
            update={
                "latest_team_id": latest_team_by_id.get(o.id),
                "career_stats": stats_by_id.get(o.id) if include_career_stats else None,
                "award_counts": awards_by_id.get(o.id) if include_award_counts else None,
            }
        )
        for o in outs
    ]


def _coalesced_team_stint_count(*, stint_team_ids_in_order: list[int], prev_by_id: dict[int, int | None]) -> int:
    """
    Count stints after coalescing consecutive stints that belong to the same franchise.
    Example: SEA->OKC with no other team between counts as 1.
    """
    last_root: int | None = None
    count = 0
    for team_id in stint_team_ids_in_order:
        root = _team_franchise_root_id(team_id, prev_by_id)
        if last_root is None or root != last_root:
            count += 1
            last_root = root
    return count


@router.get("", response_model=PlayerListPageOut)
async def list_players(
    q: str | None = Query(default=None, description="Search by player name"),
    draft_year: int | None = Query(default=None),
    team_id: int | None = Query(default=None),
    position: str | None = Query(default=None, description="Filter by position (substring match, e.g. G or F-C)"),
    active_from: int | None = Query(
        default=None,
        description="Career overlap start year (inclusive). Blank/omitted means no lower bound.",
    ),
    active_to: int | None = Query(
        default=None,
        description="Career overlap end year (inclusive). Blank/omitted means no upper bound.",
    ),
    stint_team_id: int | None = Query(default=None, description="Filter by PlayerTeamStint.team_id"),
    stint_team_ids: str | None = Query(
        default=None,
        description="Filter by PlayerTeamStint.team_id (comma-separated list). Example: 14,2,7",
    ),
    name_letters: str | None = Query(
        default=None,
        description="Filter by starting letter(s) of first/last name (comma-separated). Example: K,M",
    ),
    name_part: str | None = Query(
        default="first",
        description='Which name part to apply name_letters to: "first", "last", or "either".',
    ),
    include_active: bool | None = Query(default=None, description="Include active/unretired players"),
    include_retired: bool | None = Query(default=None, description="Include retired players"),
    stint_start_year: int | None = Query(default=None, description="Filter by stint overlap start year (inclusive)"),
    stint_end_year: int | None = Query(default=None, description="Filter by stint overlap end year (inclusive)"),
    min_team_stints: int | None = Query(default=None, ge=0, description="Minimum number of team stints (coalescing consecutive same-franchise stints)"),
    max_team_stints: int | None = Query(default=None, ge=0, description="Maximum number of team stints (coalescing consecutive same-franchise stints)"),
    stat_mode: str = Query(
        default="totals",
        description='How min_/max_ counting-stat bounds are applied: "totals" or "per_game".',
    ),
    # Career counting stats (regular season). Bounds are totals or per-game based on stat_mode.
    min_pts: float | None = Query(default=None, ge=0, description="Minimum career points (totals or per-game)"),
    max_pts: float | None = Query(default=None, ge=0, description="Maximum career points (totals or per-game)"),
    min_trb: float | None = Query(default=None, ge=0, description="Minimum career rebounds (totals or per-game)"),
    max_trb: float | None = Query(default=None, ge=0, description="Maximum career rebounds (totals or per-game)"),
    min_ast: float | None = Query(default=None, ge=0, description="Minimum career assists (totals or per-game)"),
    max_ast: float | None = Query(default=None, ge=0, description="Maximum career assists (totals or per-game)"),
    min_stl: float | None = Query(default=None, ge=0, description="Minimum career steals (totals or per-game)"),
    max_stl: float | None = Query(default=None, ge=0, description="Maximum career steals (totals or per-game)"),
    min_blk: float | None = Query(default=None, ge=0, description="Minimum career blocks (totals or per-game)"),
    max_blk: float | None = Query(default=None, ge=0, description="Maximum career blocks (totals or per-game)"),
    min_games: int | None = Query(default=None, ge=0, description="Minimum career games played"),
    max_games: int | None = Query(default=None, ge=0, description="Maximum career games played"),
    hall_of_fame: bool | None = Query(default=None, description="If true, only Hall of Fame players"),
    all_star: bool | None = Query(default=None, description="If true, require at least one All-Star (ignored when min_/max_all_star is set)"),
    all_nba: bool | None = Query(default=None, description="If true, require any All-NBA team (ignored when min_/max_all_nba is set)"),
    all_nba_1: bool | None = Query(default=None, description="If true, include All-NBA First Team in All-NBA counts"),
    all_nba_2: bool | None = Query(default=None, description="If true, include All-NBA Second Team in All-NBA counts"),
    all_nba_3: bool | None = Query(default=None, description="If true, include All-NBA Third Team in All-NBA counts"),
    all_defense: bool | None = Query(default=None, description="If true, require any All-Defensive team (ignored when min_/max_all_defense is set)"),
    all_defense_1: bool | None = Query(default=None, description="If true, include All-Defensive First Team in All-Defensive counts"),
    all_defense_2: bool | None = Query(default=None, description="If true, include All-Defensive Second Team in All-Defensive counts"),
    mvp: bool | None = Query(default=None, description="If true, require at least one MVP (ignored when min_/max_mvp is set)"),
    championship: bool | None = Query(default=None, description="If true, require at least one championship (ignored when min_/max_championship is set)"),
    finals_mvp: bool | None = Query(default=None, description="If true, require at least one Finals MVP (ignored when min_/max_finals_mvp is set)"),
    min_all_star: int | None = Query(default=None, ge=0, description="Minimum All-Star selections"),
    max_all_star: int | None = Query(default=None, ge=0, description="Maximum All-Star selections"),
    min_all_nba: int | None = Query(default=None, ge=0, description="Minimum All-NBA selections (selected teams, or all if none specified)"),
    max_all_nba: int | None = Query(default=None, ge=0, description="Maximum All-NBA selections (selected teams, or all if none specified)"),
    min_all_defense: int | None = Query(default=None, ge=0, description="Minimum All-Defensive selections (selected teams, or all if none specified)"),
    max_all_defense: int | None = Query(default=None, ge=0, description="Maximum All-Defensive selections (selected teams, or all if none specified)"),
    min_mvp: int | None = Query(default=None, ge=0, description="Minimum regular-season MVPs"),
    max_mvp: int | None = Query(default=None, ge=0, description="Maximum regular-season MVPs"),
    min_championship: int | None = Query(default=None, ge=0, description="Minimum championships"),
    max_championship: int | None = Query(default=None, ge=0, description="Maximum championships"),
    min_finals_mvp: int | None = Query(default=None, ge=0, description="Minimum Finals MVPs"),
    max_finals_mvp: int | None = Query(default=None, ge=0, description="Maximum Finals MVPs"),
    include_career_stats: bool = Query(default=False, description="Include regular-season career counting totals"),
    include_award_counts: bool = Query(default=False, description="Include career award counts"),
    sort_by: str | None = Query(
        default=None,
        description=(
            "Sort column for the player database. Omit to keep Hall of Fame / career-length ordering "
            f"(used by the draft pool). One of: {', '.join(_SORT_KEYS)}."
        ),
    ),
    sort_dir: str = Query(default="asc", description='Sort direction: "asc" or "desc"'),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> PlayerListPageOut:
    current_year = datetime.now(timezone.utc).year
    career_len = (
        func.coalesce(Player.retirement_year, current_year) - func.coalesce(Player.career_start_year, current_year)
    )
    if stat_mode not in _STAT_MODES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"stat_mode must be one of: {', '.join(_STAT_MODES)}",
        )
    if active_from is not None and active_to is not None and active_from > active_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="active_from cannot exceed active_to",
        )
    if sort_dir not in _SORT_DIRS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"sort_dir must be one of: {', '.join(_SORT_DIRS)}",
        )
    if sort_by is not None and sort_by not in _SORT_KEYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"sort_by must be one of: {', '.join(_SORT_KEYS)}",
        )

    stat_bounds_set = any(
        v is not None
        for v in (min_pts, max_pts, min_trb, max_trb, min_ast, max_ast, min_stl, max_stl, min_blk, max_blk, min_games, max_games)
    )
    all_nba_team_slugs = _selected_award_slugs(
        ((all_nba_1, "all_nba_1"), (all_nba_2, "all_nba_2"), (all_nba_3, "all_nba_3")),
        ("all_nba_1", "all_nba_2", "all_nba_3"),
    )
    all_def_team_slugs = _selected_award_slugs(
        ((all_defense_1, "all_defense_1"), (all_defense_2, "all_defense_2")),
        ("all_defense_1", "all_defense_2"),
    )
    award_count_bounds_set = any(
        v is not None
        for v in (
            min_all_star,
            max_all_star,
            min_all_nba,
            max_all_nba,
            min_all_defense,
            max_all_defense,
            min_mvp,
            max_mvp,
            min_championship,
            max_championship,
            min_finals_mvp,
            max_finals_mvp,
        )
    )
    award_filters_set = any(
        (
            hall_of_fame,
            all_star,
            all_nba,
            all_defense,
            mvp,
            championship,
            finals_mvp,
            bool(all_nba_1 or all_nba_2 or all_nba_3),
            bool(all_defense_1 or all_defense_2),
            award_count_bounds_set,
        )
    )
    want_career_stats = include_career_stats or stat_bounds_set
    want_award_counts = include_award_counts or award_filters_set

    stmt = select(Player)
    if q:
        stmt = stmt.where(Player.name.ilike(f"%{q}%"))
    if draft_year is not None:
        stmt = stmt.where(Player.draft_year == draft_year)
    if team_id is not None:
        stmt = stmt.where(Player.team_id == team_id)
    if position:
        pos = position.strip()[:30]
        if pos:
            stmt = stmt.where(Player.position.ilike(f"%{pos}%"))
    if active_from is not None or active_to is not None:
        career_end = func.coalesce(Player.retirement_year, current_year)
        career_start = func.coalesce(Player.career_start_year, current_year)
        if active_from is not None:
            stmt = stmt.where(career_end >= active_from)
        if active_to is not None:
            stmt = stmt.where(career_start <= active_to)
    if hall_of_fame:
        stmt = stmt.where(Player.hall_of_fame.is_(True))
    stmt = _apply_award_count_bounds(
        stmt,
        slugs=["all_star"],
        min_v=min_all_star,
        max_v=max_all_star,
        label="all_star",
        legacy=all_star,
    )
    stmt = _apply_award_count_bounds(
        stmt,
        slugs=all_nba_team_slugs,
        min_v=min_all_nba,
        max_v=max_all_nba,
        label="all_nba",
        legacy=all_nba or bool(all_nba_1 or all_nba_2 or all_nba_3),
    )
    stmt = _apply_award_count_bounds(
        stmt,
        slugs=all_def_team_slugs,
        min_v=min_all_defense,
        max_v=max_all_defense,
        label="all_defense",
        legacy=all_defense or bool(all_defense_1 or all_defense_2),
    )
    stmt = _apply_award_count_bounds(
        stmt,
        slugs=["mvp"],
        min_v=min_mvp,
        max_v=max_mvp,
        label="mvp",
        legacy=mvp,
    )
    stmt = _apply_award_count_bounds(
        stmt,
        slugs=["championship"],
        min_v=min_championship,
        max_v=max_championship,
        label="championship",
        legacy=championship,
    )
    stmt = _apply_award_count_bounds(
        stmt,
        slugs=["finals_mvp"],
        min_v=min_finals_mvp,
        max_v=max_finals_mvp,
        label="finals_mvp",
        legacy=finals_mvp,
    )

    # Retired/active filtering (optional)
    if include_active is False and include_retired is False:
        return PlayerListPageOut(items=[], total=0)
    if include_active is False:
        stmt = stmt.where(Player.retirement_year.is_not(None))
    elif include_retired is False:
        stmt = stmt.where(Player.retirement_year.is_(None))
    stint_team_id_list: list[int] = []
    if stint_team_id is not None:
        stint_team_id_list.append(stint_team_id)
    if stint_team_ids:
        try:
            for part in stint_team_ids.split(","):
                part = part.strip()
                if not part:
                    continue
                stint_team_id_list.append(int(part))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="stint_team_ids must be a comma-separated list of integers",
            ) from exc
    stint_team_id_list = sorted(set(stint_team_id_list))

    if stint_team_id_list or stint_start_year is not None or stint_end_year is not None:
        # Use EXISTS instead of JOIN+DISTINCT to avoid Postgres DISTINCT/ORDER BY edge-cases
        # and keep search ordering stable.
        #
        # NOTE: build the EXISTS predicate directly to ensure it's correlated to Player.
        stint_exists = exists().where(PlayerTeamStint.player_id == Player.id)
        if stint_team_id_list:
            stint_exists = stint_exists.where(PlayerTeamStint.team_id.in_(stint_team_id_list))
        if stint_start_year is not None or stint_end_year is not None:
            start = stint_start_year if stint_start_year is not None else stint_end_year
            end = stint_end_year if stint_end_year is not None else stint_start_year
            assert start is not None and end is not None
            stint_exists = stint_exists.where(
                PlayerTeamStint.start_year <= end,
                # If stint end_year is missing, treat it as the player's retirement_year (if any),
                # otherwise fall back to current_year for active players.
                func.coalesce(PlayerTeamStint.end_year, Player.retirement_year, current_year) >= start,
            )
        stmt = stmt.where(stint_exists)

    # Name-letter constraint (optional): treat first name as first word, last name as second word.
    if name_letters:
        letters = [p.strip().upper() for p in name_letters.split(",") if p.strip()]
        letters = [x for x in letters if len(x) == 1 and x.isalpha()]
        if letters:
            part = (name_part or "first").lower()
            first_letter = func.upper(func.substr(Player.name, 1, 1))
            # Postgres split_part(name, ' ', 2) => second word or '' if missing.
            last_letter = func.upper(func.substr(func.split_part(Player.name, " ", 2), 1, 1))
            if part == "last":
                stmt = stmt.where(last_letter.in_(letters))
            elif part == "either":
                stmt = stmt.where(or_(first_letter.in_(letters), last_letter.in_(letters)))
            else:
                stmt = stmt.where(first_letter.in_(letters))

    career_stat_bounds: list[tuple[str, float | int | None, float | int | None, object, bool]] = [
        ("pts", min_pts, max_pts, PlayerSeasonStat.pts, True),
        ("trb", min_trb, max_trb, PlayerSeasonStat.trb, True),
        ("ast", min_ast, max_ast, PlayerSeasonStat.ast, True),
        ("stl", min_stl, max_stl, PlayerSeasonStat.stl, True),
        ("blk", min_blk, max_blk, PlayerSeasonStat.blk, True),
        ("games", min_games, max_games, PlayerSeasonStat.games, False),
    ]
    having_clauses = []
    per_game = stat_mode == "per_game"
    for label, min_v, max_v, col, uses_stat_mode in career_stat_bounds:
        if min_v is not None and max_v is not None and min_v > max_v:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"min_{label} cannot exceed max_{label}",
            )
        expr = _career_stat_expr(col, per_game=per_game and uses_stat_mode)
        if min_v is not None:
            having_clauses.append(expr >= min_v)
        if max_v is not None:
            having_clauses.append(expr <= max_v)
    if having_clauses:
        career_subq = (
            select(PlayerSeasonStat.player_id)
            # "Career" means regular season; postseason rows live in the same table.
            .where(PlayerSeasonStat.is_postseason.is_(False))
            .group_by(PlayerSeasonStat.player_id)
            .having(and_(*having_clauses))
        )
        stmt = stmt.where(Player.id.in_(career_subq))

    # Players database sends sort_by explicitly (default name). Draft pool omits it to
    # keep Hall of Fame / longest-career ordering for the spin animation.
    if sort_by:
        stmt = stmt.order_by(
            *_player_list_order_by(
                sort_by=sort_by,
                sort_dir=sort_dir,
                stat_mode=stat_mode,
                all_nba_slugs=all_nba_team_slugs,
                all_def_slugs=all_def_team_slugs,
            )
        )
    else:
        stmt = stmt.order_by(desc(Player.hall_of_fame), desc(career_len), Player.name)

    # Optional stint-count filtering (requires coalescing by franchise root).
    # We implement this with an ordered over-fetch loop so pagination stays stable.
    if min_team_stints is not None or max_team_stints is not None:
        if min_team_stints is not None and max_team_stints is not None and min_team_stints > max_team_stints:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="min_team_stints cannot exceed max_team_stints")

        # Load team->previous mapping once (teams table is small).
        team_rows = (await db.execute(select(Team.id, Team.previous_team_id))).all()
        prev_by_id: dict[int, int | None] = {int(tid): (int(prev) if prev is not None else None) for (tid, prev) in team_rows}

        # Reuse the same filters + ordering, but only select Player.id (for cheap pagination + stint-count filtering).
        base_ids_stmt = stmt.with_only_columns(Player.id, maintain_column_froms=True)

        matched_ids: list[int] = []
        batch_size = 500
        base_offset = 0
        safety_iters = 0

        while safety_iters < 200:
            safety_iters += 1
            id_rows = (await db.execute(base_ids_stmt.limit(batch_size).offset(base_offset))).all()
            if not id_rows:
                break
            batch_ids = [int(r[0]) for r in id_rows]
            base_offset += len(batch_ids)

            # Pull stints for this batch, ordered by player then start_year.
            stint_rows = (
                await db.execute(
                    select(PlayerTeamStint.player_id, PlayerTeamStint.team_id)
                    .where(PlayerTeamStint.player_id.in_(batch_ids))
                    .order_by(PlayerTeamStint.player_id.asc(), PlayerTeamStint.start_year.asc())
                )
            ).all()

            # Compute coalesced counts in a single pass.
            counts: dict[int, int] = {pid: 0 for pid in batch_ids}
            cur_pid: int | None = None
            last_root: int | None = None
            for pid_raw, team_id_raw in stint_rows:
                pid = int(pid_raw)
                team_id = int(team_id_raw)
                if cur_pid != pid:
                    cur_pid = pid
                    last_root = None
                root = _team_franchise_root_id(team_id, prev_by_id)
                if last_root is None or root != last_root:
                    counts[pid] = counts.get(pid, 0) + 1
                    last_root = root

            for pid in batch_ids:
                c = counts.get(pid, 0)
                if min_team_stints is not None and c < min_team_stints:
                    continue
                if max_team_stints is not None and c > max_team_stints:
                    continue
                matched_ids.append(pid)

        selected = matched_ids[offset: offset + limit]
        total = len(matched_ids)
        if not selected:
            return PlayerListPageOut(items=[], total=total)
        players = (await db.execute(select(Player).where(Player.id.in_(selected)))).scalars().all()
        by_id = {p.id: p for p in players}
        ordered = [by_id[i] for i in selected if i in by_id]
        return PlayerListPageOut(
            items=await _hydrate_player_list(
                db,
                ordered,
                include_career_stats=want_career_stats,
                include_award_counts=want_award_counts,
            ),
            total=total,
        )

    count_stmt = select(func.count()).select_from(
        stmt.order_by(None).with_only_columns(Player.id, maintain_column_froms=True).subquery()
    )
    total = int((await db.execute(count_stmt)).scalar_one())
    stmt = stmt.limit(limit).offset(offset)
    players = list((await db.execute(stmt)).scalars().all())
    return PlayerListPageOut(
        items=await _hydrate_player_list(
            db,
            players,
            include_career_stats=want_career_stats,
            include_award_counts=want_award_counts,
        ),
        total=total,
    )


@router.get("/{player_id}", response_model=PlayerOut)
async def get_player(player_id: int, db: AsyncSession = Depends(get_db)) -> Player:
    player = (await db.execute(select(Player).where(Player.id == player_id))).scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    return player


@router.get("/{player_id}/details", response_model=PlayerDetailOut)
async def get_player_details(player_id: int, db: AsyncSession = Depends(get_db)) -> Player:
    stmt = (
        select(Player)
        .where(Player.id == player_id)
        .options(joinedload(Player.team_stints).joinedload(PlayerTeamStint.team))
    )
    player = (await db.execute(stmt)).unique().scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    # Compute coalesced team-stint count (coalesce consecutive same-franchise stints).
    team_rows = (await db.execute(select(Team.id, Team.previous_team_id))).all()
    prev_by_id: dict[int, int | None] = {int(tid): (int(prev) if prev is not None else None) for (tid, prev) in team_rows}
    stints_sorted = sorted(list(player.team_stints or []), key=lambda s: (s.start_year, s.id))
    stint_team_ids = [int(s.team_id) for s in stints_sorted]
    count = _coalesced_team_stint_count(stint_team_ids_in_order=stint_team_ids, prev_by_id=prev_by_id)

    out = PlayerDetailOut.model_validate(player)
    out.coalesced_team_stint_count = count
    return out


@router.get("/{player_id}/stats", response_model=PlayerSeasonStatsResponse)
async def get_player_stats(
    player_id: int,
    season_start: int | None = Query(default=None, description="Inclusive season start year filter"),
    season_end: int | None = Query(default=None, description="Inclusive season start year filter"),
    team_id: int | None = Query(default=None, description="Filter by a single team id"),
    team_ids: str | None = Query(
        default=None,
        description="Filter by team ids (comma-separated). Example: 14,2,7",
    ),
    aggregate: bool = Query(
        default=False,
        description="If true, also return summed counting stats (and recomputed rates) for the window",
    ),
    season_type: str = Query(
        default="regular",
        description='Which rows to return: "regular", "postseason", or "all"',
    ),
    db: AsyncSession = Depends(get_db),
) -> PlayerSeasonStatsResponse:
    player_exists = (
        await db.execute(select(Player.id).where(Player.id == player_id))
    ).scalar_one_or_none()
    if player_exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    team_id_list: list[int] = []
    if team_id is not None:
        team_id_list.append(team_id)
    if team_ids:
        try:
            for part in team_ids.split(","):
                part = part.strip()
                if not part:
                    continue
                team_id_list.append(int(part))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="team_ids must be a comma-separated list of integers",
            ) from exc
    team_id_list = sorted(set(team_id_list))

    if season_start is not None and season_end is not None and season_start > season_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="season_start cannot exceed season_end",
        )

    if season_type not in _SEASON_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"season_type must be one of: {', '.join(_SEASON_TYPES)}",
        )

    stmt = (
        select(PlayerSeasonStat)
        .join(Season, Season.id == PlayerSeasonStat.season_id)
        .where(PlayerSeasonStat.player_id == player_id)
        .options(selectinload(PlayerSeasonStat.season))
        .order_by(Season.start_year.asc(), PlayerSeasonStat.team_id.asc())
    )
    if season_type == "regular":
        stmt = stmt.where(PlayerSeasonStat.is_postseason.is_(False))
    elif season_type == "postseason":
        stmt = stmt.where(PlayerSeasonStat.is_postseason.is_(True))
    if team_id_list:
        stmt = stmt.where(PlayerSeasonStat.team_id.in_(team_id_list))
    if season_start is not None:
        stmt = stmt.where(Season.start_year >= season_start)
    if season_end is not None:
        stmt = stmt.where(Season.start_year <= season_end)

    rows = list((await db.execute(stmt)).scalars().all())
    out_rows = [PlayerSeasonStatOut.model_validate(r) for r in rows]
    totals = None
    if aggregate:
        totals = _aggregate_season_stats(
            player_id=player_id,
            rows=rows,
            season_start=season_start,
            season_end=season_end,
            team_ids=team_id_list,
        )
    return PlayerSeasonStatsResponse(
        player_id=player_id,
        aggregate=aggregate,
        season_type=season_type,
        rows=out_rows,
        totals=totals,
    )


@router.get("/{player_id}/awards", response_model=list[PlayerAwardOut])
async def get_player_awards(
    player_id: int,
    season_start: int | None = Query(default=None),
    season_end: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> list[PlayerAward]:
    player_exists = (
        await db.execute(select(Player.id).where(Player.id == player_id))
    ).scalar_one_or_none()
    if player_exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    if season_start is not None and season_end is not None and season_start > season_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="season_start cannot exceed season_end",
        )

    stmt = (
        select(PlayerAward)
        .join(Season, Season.id == PlayerAward.season_id)
        .where(PlayerAward.player_id == player_id)
        .options(selectinload(PlayerAward.award), selectinload(PlayerAward.season))
        .order_by(Season.start_year.asc(), PlayerAward.award_id.asc())
    )
    if season_start is not None:
        stmt = stmt.where(Season.start_year >= season_start)
    if season_end is not None:
        stmt = stmt.where(Season.start_year <= season_end)
    return list((await db.execute(stmt)).scalars().all())


