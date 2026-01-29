from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Team
from app.schemas.team import TeamOut

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
async def list_teams(
    q: str | None = Query(default=None, description="Search by team name/city/abbreviation"),
    active_start_year: int | None = Query(default=None, description="Filter teams active in this start year (inclusive)"),
    active_end_year: int | None = Query(default=None, description="Filter teams active in this end year (inclusive)"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[Team]:
    stmt = select(Team).order_by(Team.name).limit(limit).offset(offset)
    if active_start_year is not None or active_end_year is not None:
        start = active_start_year if active_start_year is not None else active_end_year
        end = active_end_year if active_end_year is not None else active_start_year
        assert start is not None and end is not None
        # Teams are considered "active" in a range if they overlap the range.
        # Allow NULL founded_year as "unknown" (include), and NULL dissolved_year as "still active" (include).
        stmt = stmt.where(
            and_(
                or_(Team.founded_year.is_(None), Team.founded_year <= end),
                or_(Team.dissolved_year.is_(None), Team.dissolved_year >= start),
            )
        )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Team.name.ilike(like)) | (Team.city.ilike(like)) | (Team.abbreviation.ilike(like))
        )
    return (await db.execute(stmt)).scalars().all()


