from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas.user import UserOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
async def get_me(
    db: AsyncSession = Depends(get_db),  # kept for symmetry/future expansions
    user: User = Depends(get_current_user),
) -> User:
    return user


