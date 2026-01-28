from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket.draft_manager import Role, draft_manager
from app.database import SessionLocal
from app.models import Draft, DraftPick, Player
from sqlalchemy import select
from sqlalchemy.orm import joinedload

router = APIRouter(tags=["ws"])
logger = logging.getLogger("nba_draft_app.ws")

def _parse_draft_ref(draft_ref: str) -> tuple[str, object]:
    try:
        return ("id", int(draft_ref))
    except ValueError:
        try:
            return ("public_id", uuid.UUID(draft_ref))
        except ValueError:
            return ("invalid", draft_ref)


@router.websocket("/ws/draft/{draft_ref}")
async def draft_ws(ws: WebSocket, draft_ref: str, role: Role = "guest"):
    """
    Minimal websocket implementation:
    - connect => lobby_ready (broadcast)
    - receive {"type":"start_draft"} from host => choose who picks first, broadcast
    - keep connection alive
    """
    await ws.accept()
    logger.info("ws connect draft_ref=%s role=%s", draft_ref, role)

    # Resolve public_id -> internal numeric id so sessions are keyed consistently.
    kind, value = _parse_draft_ref(draft_ref)
    if kind == "invalid":
        await ws.send_json({"type": "error", "message": "Invalid draft id"})
        await ws.close()
        return

    async with SessionLocal() as db:
        draft = (
            await db.get(Draft, value)
            if kind == "id"
            else (await db.execute(select(Draft).where(Draft.public_id == value))).scalar_one_or_none()
        )
        if not draft:
            await ws.send_json({"type": "error", "message": "Draft not found"})
            await ws.close()
            return
        draft_id = draft.id

    session = await draft_manager.connect(draft_id, role, ws)

    # Rehydrate persisted state (draft status, first_turn, existing picks) so refresh doesn't reset the draft.
    async with SessionLocal() as db:
        draft = await db.get(Draft, draft_id)
        if not draft:
            await ws.send_json({"type": "error", "message": "Draft not found"})
            await ws.close()
            return

        picks_stmt = (
            select(DraftPick)
            .where(DraftPick.draft_id == draft_id)
            .options(joinedload(DraftPick.player))
            .order_by(DraftPick.pick_number.asc())
        )
        picks = (await db.execute(picks_stmt)).scalars().all()
        pick_rows = [
            {
                "pick_number": p.pick_number,
                "role": (p.role if getattr(p, "role", None) in ("host", "guest") else ("host" if p.user_id == draft.host_id else "guest")),
                "player_id": p.player_id,
                "player_name": p.player.name if p.player else "",
                "player_image_url": p.player.image_url if p.player else None,
                "constraint_team": p.constraint_team,
                "constraint_year": p.constraint_year,
            }
            for p in picks
        ]
        started = draft.status != "lobby"
        first_turn = draft.first_turn if draft.first_turn in ("host", "guest") else None
        # Backfill for already-started drafts that were created before first_turn was persisted:
        # infer from the first persisted pick.
        if started and not first_turn and pick_rows:
            inferred = pick_rows[0].get("role")
            if inferred in ("host", "guest"):
                first_turn = inferred
        await draft_manager.rehydrate_from_db(session, first_turn=first_turn, pick_rows=pick_rows, started=started)

    await draft_manager.broadcast(
        session,
        {
            "type": "lobby_ready",
            "draft_id": draft_id,
            "draft_public_id": str(draft.public_id),
            "connected": list(session.conns.keys()),
            "started": session.started,
            "first_turn": session.first_turn,
            "current_turn": session.current_turn,
            "picks": session.picks,
        },
    )

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")
            logger.info("ws message draft_id=%s role=%s type=%s", draft_id, role, msg_type)

            if msg_type == "start_draft" and role == "host":
                # Persist first_turn + status so refresh/reconnect restores draft state.
                async with SessionLocal() as db:
                    draft = await db.get(Draft, draft_id)
                    if not draft:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not found"})
                        continue
                    if draft.status != "lobby" and draft.first_turn in ("host", "guest"):
                        first = draft.first_turn
                    else:
                        first = await draft_manager.start(session)
                        draft.first_turn = first
                        draft.status = "drafting"
                        await db.commit()
                await draft_manager.broadcast(
                    session,
                    {
                        "type": "draft_started",
                        "draft_id": draft_id,
                        "first_turn": first,
                    },
                )
            elif msg_type == "make_pick":
                player_id = data.get("player_id")
                if not isinstance(player_id, int):
                    await draft_manager.send_to(session, role, {"type": "error", "message": "player_id required"})
                    continue
                try:
                    pick_number, next_turn = await draft_manager.next_pick(session, role)
                except RuntimeError as e:
                    await draft_manager.send_to(session, role, {"type": "error", "message": str(e)})
                    continue

                # Persist the pick (minimal validation: player exists).
                async with SessionLocal() as db:
                    draft = await db.get(Draft, draft_id)
                    if not draft:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not found"})
                        continue
                    # Ensure in-memory session has correct persisted first_turn if reconnect happened mid-draft.
                    if draft.first_turn in ("host", "guest") and session.first_turn != draft.first_turn:
                        session.first_turn = draft.first_turn
                    player = await db.get(Player, player_id)
                    if not player:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Player not found"})
                        continue
                    # Map websocket role -> draft participant.
                    user_id = draft.host_id if role == "host" else (draft.guest_id or draft.host_id)
                    db.add(
                        DraftPick(
                            draft_id=draft_id,
                            user_id=user_id,
                            player_id=player_id,
                            pick_number=pick_number,
                            role=role,
                        )
                    )
                    await db.commit()

                # Update in-memory pick list too (for newly-connected clients that rely on lobby_ready state).
                async with session.lock:
                    session.picks.append(
                        {
                            "pick_number": pick_number,
                            "role": role,
                            "player_id": player_id,
                            "player_name": player.name,
                            "player_image_url": player.image_url,
                            "constraint_team": None,
                            "constraint_year": None,
                        }
                    )
                await draft_manager.broadcast(
                    session,
                    {
                        "type": "pick_made",
                        "draft_id": draft_id,
                        "pick_number": pick_number,
                        "role": role,
                        "player_id": player_id,
                        "player_name": player.name,
                        "player_image_url": player.image_url,
                        "next_turn": next_turn,
                    },
                )
            else:
                await draft_manager.send_to(
                    session,
                    role,
                    {"type": "error", "message": "Unsupported message or not allowed"},
                )

    except WebSocketDisconnect:
        await draft_manager.disconnect(session, role)
        logger.info("ws disconnect draft_id=%s role=%s", draft_id, role)
        await draft_manager.broadcast(
            session,
            {"type": "lobby_update", "draft_id": draft_id, "connected": list(session.conns.keys())},
        )


