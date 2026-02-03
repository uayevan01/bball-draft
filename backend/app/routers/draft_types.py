from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Draft, DraftType, User
from app.schemas.draft_type import DraftTypeCreate, DraftTypeOut, DraftTypeUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/draft-types", tags=["draft-types"])


@router.get("", response_model=list[DraftTypeOut])
async def list_draft_types(
    mine: bool = Query(default=False, description="If true, include only draft types created by me"),
    include_public: bool = Query(default=True, description="Include public draft types"),
    public_only: bool = Query(default=False, description="If true, include only public draft types (from all users)"),
    q: str | None = Query(default=None, description="Search draft types by name"),
    sort: str = Query(default="usage", description="Sort by: usage | created_at"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DraftType]:
    usage_subq = (
        select(
            Draft.draft_type_id.label("draft_type_id"),
            func.count(Draft.id).label("usage_count"),
        )
        .group_by(Draft.draft_type_id)
        .subquery()
    )

    usage_count = func.coalesce(usage_subq.c.usage_count, 0)

    stmt = (
        select(
            DraftType,
            usage_count.label("usage_count"),
            User.username.label("created_by_username"),
        )
        .outerjoin(usage_subq, usage_subq.c.draft_type_id == DraftType.id)
        .outerjoin(User, User.id == DraftType.created_by_id)
    )

    if public_only:
        stmt = stmt.where(DraftType.is_public.is_(True))
    elif mine:
        # Only my draft types (public or private).
        stmt = stmt.where(DraftType.created_by_id == user.id)
    else:
        # Default: mine + public (so private draft types I created show up).
        if include_public:
            stmt = stmt.where(or_(DraftType.created_by_id == user.id, DraftType.is_public.is_(True)))
        else:
            stmt = stmt.where(DraftType.created_by_id == user.id)

    if q:
        q_norm = q.strip()
        if q_norm:
            stmt = stmt.where(DraftType.name.ilike(f"%{q_norm}%"))

    if sort == "created_at":
        stmt = stmt.order_by(DraftType.created_at.desc())
    else:
        # Default: most-used first (for easier selection when there are many).
        stmt = stmt.order_by(usage_count.desc(), DraftType.created_at.desc())

    rows = (await db.execute(stmt)).all()
    out: list[DraftType] = []
    for dt, usage, created_by_username in rows:
        # Attach computed fields for Pydantic serialization (from_attributes=True).
        setattr(dt, "usage_count", int(usage or 0))
        setattr(dt, "created_by_username", created_by_username)
        out.append(dt)
    return out


@router.post("", response_model=DraftTypeOut)
async def create_draft_type(
    payload: DraftTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DraftType:
    dt = DraftType(
        name=payload.name,
        description=payload.description,
        rules=payload.rules,
        is_public=payload.is_public,
        created_by_id=user.id,
    )
    db.add(dt)
    await db.commit()
    await db.refresh(dt)
    return dt


@router.get("/{draft_type_id}", response_model=DraftTypeOut)
async def get_draft_type(
    draft_type_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DraftType:
    dt = (await db.execute(select(DraftType).where(DraftType.id == draft_type_id))).scalar_one_or_none()
    if not dt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft type not found")
    # Access control: allow if public or created by user.
    if not dt.is_public and dt.created_by_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return dt


@router.patch("/{draft_type_id}", response_model=DraftTypeOut)
async def update_draft_type(
    draft_type_id: int,
    payload: DraftTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DraftType:
    dt = (await db.execute(select(DraftType).where(DraftType.id == draft_type_id))).scalar_one_or_none()
    if not dt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft type not found")
    if dt.created_by_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the creator can edit this draft type")

    if payload.name is not None:
        dt.name = payload.name.strip()
    if payload.description is not None:
        dt.description = payload.description.strip() or None
    if payload.rules is not None:
        dt.rules = payload.rules
    if payload.is_public is not None:
        dt.is_public = payload.is_public

    await db.commit()
    await db.refresh(dt)
    return dt


