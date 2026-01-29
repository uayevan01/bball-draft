from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, exists, func, select
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
    if stint_team_id is not None:
        # Use EXISTS instead of JOIN+DISTINCT to avoid Postgres DISTINCT/ORDER BY edge-cases
        # and keep search ordering stable.
        stint_exists = select(PlayerTeamStint.id).where(
            PlayerTeamStint.player_id == Player.id,
            PlayerTeamStint.team_id == stint_team_id,
        )
        if stint_start_year is not None or stint_end_year is not None:
            start = stint_start_year if stint_start_year is not None else stint_end_year
            end = stint_end_year if stint_end_year is not None else stint_start_year
            assert start is not None and end is not None
            stint_exists = stint_exists.where(
                PlayerTeamStint.start_year <= end,
                func.coalesce(PlayerTeamStint.end_year, current_year) >= start,
            )
        stmt = stmt.where(exists(stint_exists))
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


