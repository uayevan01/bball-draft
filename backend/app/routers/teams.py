from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Team
from app.schemas.team import TeamOut

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
async def list_teams(
    q: str | None = Query(default=None, description="Search by team name/city/abbreviation"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[Team]:
    stmt = select(Team).order_by(Team.name).limit(limit).offset(offset)
    if q:
        like = f"%{q}%"
        stmt = select(Team).where(
            (Team.name.ilike(like)) | (Team.city.ilike(like)) | (Team.abbreviation.ilike(like))
        ).order_by(Team.name).limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


