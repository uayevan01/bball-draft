from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DraftType, User
from app.schemas.draft_type import DraftTypeCreate, DraftTypeOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/draft-types", tags=["draft-types"])


@router.get("", response_model=list[DraftTypeOut])
async def list_draft_types(
    mine: bool = Query(default=False, description="If true, include only draft types created by me"),
    include_public: bool = Query(default=True, description="Include public draft types"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DraftType]:
    stmt = select(DraftType)

    clauses = []
    if mine:
        clauses.append(DraftType.created_by_id == user.id)
    if include_public:
        clauses.append(DraftType.is_public.is_(True))
    if clauses:
        stmt = stmt.where(or_(*clauses))
    else:
        # default: show mine + public
        stmt = stmt.where(or_(DraftType.created_by_id == user.id, DraftType.is_public.is_(True)))

    stmt = stmt.order_by(DraftType.created_at.desc())
    return (await db.execute(stmt)).scalars().all()


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


