from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas.user import UserOut, UserUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
async def get_me(
    db: AsyncSession = Depends(get_db),  # kept for symmetry/future expansions
    user: User = Depends(get_current_user),
) -> User:
    return user


@router.patch("", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> User:
    # Update provider name (non-unique display field)
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip() or None

    # Update custom username (handle). Enforce uniqueness case-insensitively.
    if payload.username is not None:
        desired = payload.username.strip()
        if not desired:
            user.username = None
        else:
            exists = (
                await db.execute(
                    select(User.id).where(func.lower(User.username) == desired.lower(), User.id != user.id)
                )
            ).scalar_one_or_none()
            if exists:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
            user.username = desired

    # Optional: sync email + avatar_url from Clerk frontend (JWT often doesn't include these).
    if payload.email is not None:
        user.email = payload.email.strip() or None
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url.strip() or None

    await db.commit()
    await db.refresh(user)
    return user


