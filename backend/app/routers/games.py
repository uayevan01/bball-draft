from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Draft, Game, User
from app.schemas.game import GameCreate, GameOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/games", tags=["games"])


@router.post("", response_model=GameOut)
async def create_game(
    payload: GameCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Game:
    draft = (await db.execute(select(Draft).where(Draft.id == payload.draft_id))).scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")

    # Only participants can attach games
    if user.id not in {draft.host_id, draft.guest_id}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    if not draft.guest_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Draft has no guest yet")

    opponent_id = draft.guest_id if user.id == draft.host_id else draft.host_id
    game = Game(
        draft_id=payload.draft_id,
        user1_id=user.id,
        user2_id=opponent_id,
        user1_score=payload.user1_score,
        user2_score=payload.user2_score,
        game_mode=payload.game_mode,
        notes=payload.notes,
        played_at=payload.played_at or datetime.utcnow(),
    )
    db.add(game)
    await db.commit()
    await db.refresh(game)
    return game


@router.get("", response_model=list[GameOut])
async def list_games(
    draft_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[Game]:
    stmt = select(Game).order_by(Game.played_at.desc()).limit(limit).offset(offset)

    if draft_id is not None:
        stmt = stmt.where(Game.draft_id == draft_id)
    else:
        # Only show games for drafts the user participated in
        my_drafts = select(Draft.id).where(or_(Draft.host_id == user.id, Draft.guest_id == user.id))
        stmt = stmt.where(Game.draft_id.in_(my_drafts))

    return (await db.execute(stmt)).scalars().all()


