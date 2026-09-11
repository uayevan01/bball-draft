from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, desc, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.database import get_db
from app.models import Player, PlayerAward, PlayerSeasonStat, PlayerTeamStint, Season, Team
from app.schemas.player import PlayerDetailOut, PlayerOut
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


@router.get("", response_model=list[PlayerOut])
async def list_players(
    q: str | None = Query(default=None, description="Search by player name"),
    draft_year: int | None = Query(default=None),
    team_id: int | None = Query(default=None),
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
    # Career totals (SUM across player_season_stats rows)
    min_pts: int | None = Query(default=None, ge=0, description="Minimum career total points"),
    max_pts: int | None = Query(default=None, ge=0, description="Maximum career total points"),
    min_trb: int | None = Query(default=None, ge=0, description="Minimum career total rebounds"),
    max_trb: int | None = Query(default=None, ge=0, description="Maximum career total rebounds"),
    min_ast: int | None = Query(default=None, ge=0, description="Minimum career total assists"),
    max_ast: int | None = Query(default=None, ge=0, description="Maximum career total assists"),
    min_stl: int | None = Query(default=None, ge=0, description="Minimum career total steals"),
    max_stl: int | None = Query(default=None, ge=0, description="Maximum career total steals"),
    min_blk: int | None = Query(default=None, ge=0, description="Minimum career total blocks"),
    max_blk: int | None = Query(default=None, ge=0, description="Maximum career total blocks"),
    min_games: int | None = Query(default=None, ge=0, description="Minimum career games played"),
    max_games: int | None = Query(default=None, ge=0, description="Maximum career games played"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[Player]:
    current_year = datetime.now(timezone.utc).year
    career_len = (
        func.coalesce(Player.retirement_year, current_year) - func.coalesce(Player.career_start_year, current_year)
    )
    stmt = select(Player)
    if q:
        stmt = stmt.where(Player.name.ilike(f"%{q}%"))
    if draft_year is not None:
        stmt = stmt.where(Player.draft_year == draft_year)
    if team_id is not None:
        stmt = stmt.where(Player.team_id == team_id)

    # Retired/active filtering (optional)
    if include_active is False and include_retired is False:
        return []
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

    career_stat_bounds: list[tuple[str, int | None, int | None, object]] = [
        ("pts", min_pts, max_pts, PlayerSeasonStat.pts),
        ("trb", min_trb, max_trb, PlayerSeasonStat.trb),
        ("ast", min_ast, max_ast, PlayerSeasonStat.ast),
        ("stl", min_stl, max_stl, PlayerSeasonStat.stl),
        ("blk", min_blk, max_blk, PlayerSeasonStat.blk),
        ("games", min_games, max_games, PlayerSeasonStat.games),
    ]
    having_clauses = []
    for label, min_v, max_v, col in career_stat_bounds:
        if min_v is not None and max_v is not None and min_v > max_v:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"min_{label} cannot exceed max_{label}",
            )
        if min_v is not None:
            having_clauses.append(func.coalesce(func.sum(col), 0) >= min_v)
        if max_v is not None:
            having_clauses.append(func.coalesce(func.sum(col), 0) <= max_v)
    if having_clauses:
        career_subq = (
            select(PlayerSeasonStat.player_id)
            .group_by(PlayerSeasonStat.player_id)
            .having(and_(*having_clauses))
        )
        stmt = stmt.where(Player.id.in_(career_subq))

    # Default ordering: Hall of Fame first, then longest career.
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

        want = offset + limit
        matched_ids: list[int] = []
        batch_size = 500
        base_offset = 0
        safety_iters = 0

        while len(matched_ids) < want and safety_iters < 20:
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
        if not selected:
            return []
        players = (await db.execute(select(Player).where(Player.id.in_(selected)))).scalars().all()
        by_id = {p.id: p for p in players}
        return [by_id[i] for i in selected if i in by_id]

    stmt = stmt.limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


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

    stmt = (
        select(PlayerSeasonStat)
        .join(Season, Season.id == PlayerSeasonStat.season_id)
        .where(PlayerSeasonStat.player_id == player_id)
        .options(selectinload(PlayerSeasonStat.season))
        .order_by(Season.start_year.asc(), PlayerSeasonStat.team_id.asc())
    )
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


