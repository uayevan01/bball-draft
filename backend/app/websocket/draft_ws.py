from __future__ import annotations

import asyncio
import logging
import random
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket.draft_manager import Role, draft_manager
from app.database import SessionLocal
from app.models import Draft, DraftPick, DraftType, Player, Team
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import joinedload

router = APIRouter(tags=["ws"])
logger = logging.getLogger("nba_draft_app.ws")

_DECADE_LABELS = [
    "1950-1959",
    "1960-1969",
    "1970-1979",
    "1980-1989",
    "1990-1999",
    "2000-2009",
    "2010-2019",
    "2020-2029",
]


def _parse_decade_label(label: str) -> tuple[int, int] | None:
    try:
        parts = label.strip().split("-", 1)
        if len(parts) != 2:
            return None
        start = int(parts[0])
        end = int(parts[1])
        if start < 1800 or end < start:
            return None
        return start, end
    except ValueError:
        return None


async def _compute_roll(draft_id: int) -> tuple[str, int, int, dict]:
    """
    Server-side roll so BOTH clients see the same result.
    Returns (decade_label, decade_start, decade_end, team_payload).
    """
    async with SessionLocal() as db:
        stmt = (
            select(Draft)
            .where(Draft.id == draft_id)
            .options(joinedload(Draft.draft_type))
        )
        draft = (await db.execute(stmt)).scalar_one_or_none()
        if not draft:
            raise RuntimeError("Draft not found")
        dt: DraftType | None = draft.draft_type
        rules = dt.rules if dt and isinstance(dt.rules, dict) else {}

        # Year constraint: support decades for now (fallback to all decades).
        year_constraint = rules.get("year_constraint") if isinstance(rules.get("year_constraint"), dict) else {}
        decade_options = []
        if year_constraint.get("type") == "decade" and isinstance(year_constraint.get("options"), list):
            decade_options = [str(x) for x in year_constraint.get("options") if isinstance(x, str)]
        if not decade_options:
            decade_options = list(_DECADE_LABELS)

        decade_label = random.choice(decade_options)
        parsed = _parse_decade_label(decade_label)
        if not parsed:
            raise RuntimeError("Invalid decade options in rules")
        start_year, end_year = parsed

        # Team constraint.
        team_constraint = rules.get("team_constraint") if isinstance(rules.get("team_constraint"), dict) else {}
        tc_type = team_constraint.get("type")
        tc_options = team_constraint.get("options")

        team_stmt = select(Team).where(
            and_(
                or_(Team.founded_year.is_(None), Team.founded_year <= end_year),
                or_(Team.dissolved_year.is_(None), Team.dissolved_year >= start_year),
            )
        )
        if tc_type == "conference" and isinstance(tc_options, list) and tc_options:
            team_stmt = team_stmt.where(Team.conference.in_([str(x) for x in tc_options]))
        elif tc_type == "division" and isinstance(tc_options, list) and tc_options:
            team_stmt = team_stmt.where(Team.division.in_([str(x) for x in tc_options]))
        elif tc_type == "specific" and isinstance(tc_options, list) and tc_options:
            team_stmt = team_stmt.where(Team.abbreviation.in_([str(x) for x in tc_options]))

        teams = (await db.execute(team_stmt)).scalars().all()
        if not teams:
            raise RuntimeError("No teams available for that decade")
        team = random.choice(teams)
        team_payload = {
            "id": team.id,
            "name": team.name,
            "abbreviation": team.abbreviation,
            "logo_url": team.logo_url,
        }
        return decade_label, start_year, end_year, team_payload

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
        # Load draft type rules for lobby settings defaults.
        draft_type = await db.get(DraftType, draft.draft_type_id) if draft.draft_type_id else None
        rules = draft_type.rules if draft_type and isinstance(draft_type.rules, dict) else {}

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
        # Initialize host-controlled lobby setting (default: True) from rules.suggest if present.
        suggest = rules.get("suggest")
        async with session.lock:
            if session.only_eligible is None:
                session.only_eligible = bool(True if suggest is None else suggest)

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
            "constraint": session.current_constraint,
            "only_eligible": session.only_eligible,
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
            elif msg_type == "roll":
                # Only the current-turn player can roll.
                async with session.lock:
                    if not session.started or not session.current_turn:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not started"})
                        continue
                    if session.current_turn != role:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Not your turn"})
                        continue

                await draft_manager.broadcast(
                    session,
                    {"type": "roll_started", "draft_id": draft_id, "stage": "decade", "by_role": role},
                )
                await asyncio.sleep(0.9)
                try:
                    decade_label, start_year, end_year, team_payload = await _compute_roll(draft_id)
                except RuntimeError as e:
                    await draft_manager.broadcast(
                        session, {"type": "roll_error", "draft_id": draft_id, "message": str(e)}
                    )
                    continue

                await draft_manager.broadcast(
                    session,
                    {
                        "type": "roll_started",
                        "draft_id": draft_id,
                        "stage": "team",
                        "by_role": role,
                        "decade_label": decade_label,
                    },
                )
                await asyncio.sleep(0.9)
                await draft_manager.broadcast(
                    session,
                    {
                        "type": "roll_result",
                        "draft_id": draft_id,
                        "by_role": role,
                        "decade_label": decade_label,
                        "decade_start": start_year,
                        "decade_end": end_year,
                        "team": team_payload,
                    },
                )
                async with session.lock:
                    session.current_constraint = {
                        "decadeLabel": decade_label,
                        "decadeStart": start_year,
                        "decadeEnd": end_year,
                        "team": team_payload,
                    }
            elif msg_type == "set_only_eligible":
                if role != "host":
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Only host can change this setting"})
                    continue
                value = data.get("value")
                if not isinstance(value, bool):
                    await draft_manager.send_to(session, role, {"type": "error", "message": "value must be boolean"})
                    continue
                async with session.lock:
                    session.only_eligible = value
                await draft_manager.broadcast(
                    session,
                    {"type": "only_eligible_updated", "draft_id": draft_id, "value": value},
                )
            elif msg_type == "make_pick":
                player_id = data.get("player_id")
                if not isinstance(player_id, int):
                    await draft_manager.send_to(session, role, {"type": "error", "message": "player_id required"})
                    continue
                constraint_team = data.get("constraint_team")
                constraint_year = data.get("constraint_year")
                if constraint_team is not None and not isinstance(constraint_team, str):
                    constraint_team = None
                if constraint_year is not None and not isinstance(constraint_year, str):
                    constraint_year = None
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
                            constraint_team=constraint_team,
                            constraint_year=constraint_year,
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
                            "constraint_team": constraint_team,
                            "constraint_year": constraint_year,
                        }
                    )
                    session.current_constraint = None
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
                        "constraint_team": constraint_team,
                        "constraint_year": constraint_year,
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
        await draft_manager.disconnect(session, role, ws)
        logger.info("ws disconnect draft_id=%s role=%s", draft_id, role)
        await draft_manager.broadcast(
            session,
            {"type": "lobby_update", "draft_id": draft_id, "connected": list(session.conns.keys())},
        )


