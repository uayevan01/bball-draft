from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.database import get_db
from app.models import Player, PlayerTeamStint, Team
from app.schemas.player import PlayerDetailOut, PlayerOut

router = APIRouter(prefix="/players", tags=["players"])


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


