from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.database import get_db
from app.models import Player, PlayerTeamStint
from app.schemas.player import PlayerDetailOut, PlayerOut

router = APIRouter(prefix="/players", tags=["players"])


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
    stint_start_year: int | None = Query(default=None, description="Filter by stint overlap start year (inclusive)"),
    stint_end_year: int | None = Query(default=None, description="Filter by stint overlap end year (inclusive)"),
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
                func.coalesce(PlayerTeamStint.end_year, current_year) >= start,
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
    stmt = (
        stmt.order_by(desc(Player.hall_of_fame), desc(career_len), Player.name)
        .limit(limit)
        .offset(offset)
    )
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
    return player


