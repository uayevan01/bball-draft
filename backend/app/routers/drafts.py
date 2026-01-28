from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.config import settings
from app.database import get_db
from app.models import Draft, DraftPick, DraftType, User
from app.schemas.draft import DraftCreate, DraftOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/drafts", tags=["drafts"])

def _parse_draft_ref(draft_ref: str) -> tuple[str, object]:
    """
    Accept either numeric DB id ("123") or UUID public id.
    Returns ("id", int) or ("public_id", uuid.UUID).
    """
    try:
        return ("id", int(draft_ref))
    except ValueError:
        try:
            return ("public_id", uuid.UUID(draft_ref))
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid draft id") from e


@router.post("", response_model=DraftOut)
async def create_draft(
    payload: DraftCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Draft:
    # Validate draft type exists (and is accessible)
    dt = (await db.execute(select(DraftType).where(DraftType.id == payload.draft_type_id))).scalar_one_or_none()
    if not dt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft type not found")

    draft = Draft(
        draft_type_id=payload.draft_type_id,
        host_id=user.id,
        picks_per_player=payload.picks_per_player,
        show_suggestions=payload.show_suggestions,
        status="lobby",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    # Eager-load relationships used by the response model to avoid async lazy-load during serialization.
    stmt = (
        select(Draft)
        .where(Draft.id == draft.id)
        .options(
            joinedload(Draft.picks),
            joinedload(Draft.host),
            joinedload(Draft.guest),
        )
    )
    return (await db.execute(stmt)).unique().scalar_one()


@router.get("/history", response_model=list[DraftOut])
async def draft_history(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Draft]:
    stmt = (
        select(Draft)
        .where(or_(Draft.host_id == user.id, Draft.guest_id == user.id))
        .options(joinedload(Draft.host), joinedload(Draft.guest), joinedload(Draft.picks))
        .order_by(Draft.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return (await db.execute(stmt)).unique().scalars().all()


@router.get("/{draft_ref}", response_model=DraftOut)
async def get_draft(
    draft_ref: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Draft:
    kind, value = _parse_draft_ref(draft_ref)
    base = select(Draft).where(Draft.id == value) if kind == "id" else select(Draft).where(Draft.public_id == value)
    stmt = base.options(
        joinedload(Draft.picks).joinedload(DraftPick.player),
        joinedload(Draft.host),
        joinedload(Draft.guest),
    )
    draft = (await db.execute(stmt)).unique().scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    # Only participants can view (for now)
    if settings.app_env.lower() == "dev" and settings.auth_optional_in_dev:
        return draft
    if user.id not in {draft.host_id, draft.guest_id}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return draft


@router.post("/{draft_ref}/join", response_model=DraftOut)
async def join_draft(
    draft_ref: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Draft:
    kind, value = _parse_draft_ref(draft_ref)
    draft = (
        (await db.execute(select(Draft).where(Draft.id == value)))
        if kind == "id"
        else (await db.execute(select(Draft).where(Draft.public_id == value)))
    ).scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    # Host can never become guest.
    if user.id == draft.host_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Host cannot join as guest")

    # Enforce single guest.
    if draft.guest_id and draft.guest_id != user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Draft already has a guest")

    if not draft.guest_id:
        draft.guest_id = user.id
        await db.commit()

    stmt = (
        select(Draft)
        .where(Draft.id == draft.id)
        .options(joinedload(Draft.picks), joinedload(Draft.host), joinedload(Draft.guest))
    )
    return (await db.execute(stmt)).unique().scalar_one()

