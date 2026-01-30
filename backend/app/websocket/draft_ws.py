from __future__ import annotations

import asyncio
import logging
import random
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket.draft_manager import Role, draft_manager
from app.database import SessionLocal
from app.models import Draft, DraftPick, DraftType, Player, Team
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_, func, or_, select
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


async def _compute_roll_constraint(draft_id: int) -> dict:
    """
    Server-side roll so BOTH clients see the same result.
    Returns a constraint payload matching the frontend EligibilityConstraint shape:
      {
        "yearLabel": str | None,
        "yearStart": int | None,
        "yearEnd": int | None,
        "teams": [{team: {...}, startYear?: int, endYear?: int}],
        "nameLetter": str | None,
        "namePart": "first"|"last"|"either"|None,
      }
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

        spin_fields = rules.get("spin_fields") if isinstance(rules.get("spin_fields"), list) else []
        spin_year = "year" in spin_fields
        spin_team = "team" in spin_fields
        spin_letter = "name_letter" in spin_fields

        # Year constraint: support decades for now. If not spinning year, treat as any.
        year_constraint = rules.get("year_constraint") if isinstance(rules.get("year_constraint"), dict) else {}
        year_label = "Any year"
        start_year: int | None = None
        end_year: int | None = None
        if spin_year:
            decade_options: list[str] = []
            if year_constraint.get("type") == "decade" and isinstance(year_constraint.get("options"), list):
                decade_options = [str(x) for x in year_constraint.get("options") if isinstance(x, str)]
            if not decade_options:
                decade_options = list(_DECADE_LABELS)
            year_label = random.choice(decade_options)
            parsed = _parse_decade_label(year_label)
            if not parsed:
                raise RuntimeError("Invalid decade options in rules")
            start_year, end_year = parsed

        segments: list[dict] = []

        # Team constraint (only if spinning team).
        team_constraint = rules.get("team_constraint") if isinstance(rules.get("team_constraint"), dict) else {}
        tc_type = team_constraint.get("type")
        tc_options = team_constraint.get("options")

        if spin_team:
            if start_year is not None and end_year is not None:
                team_stmt = select(Team).where(
                    and_(
                        or_(Team.founded_year.is_(None), Team.founded_year <= end_year),
                        or_(Team.dissolved_year.is_(None), Team.dissolved_year >= start_year),
                    )
                )
            else:
                team_stmt = select(Team)
            if tc_type == "conference" and isinstance(tc_options, list) and tc_options:
                team_stmt = team_stmt.where(Team.conference.in_([str(x) for x in tc_options]))
            elif tc_type == "division" and isinstance(tc_options, list) and tc_options:
                team_stmt = team_stmt.where(Team.division.in_([str(x) for x in tc_options]))
            elif tc_type == "specific" and isinstance(tc_options, list) and tc_options:
                team_stmt = team_stmt.where(Team.abbreviation.in_([str(x) for x in tc_options]))

            teams = (await db.execute(team_stmt)).scalars().all()
            if not teams:
                raise RuntimeError("No teams available for that year")

            by_id: dict[int, Team] = {t.id: t for t in teams}

            def root_id(t: Team) -> int:
                cur = t
                seen: set[int] = set()
                while cur.id not in seen:
                    seen.add(cur.id)
                    prev = cur.previous_team_id
                    if not prev:
                        break
                    nxt = by_id.get(prev)
                    if not nxt:
                        return prev
                    cur = nxt
                return cur.id

            def overlap_years(t: Team) -> tuple[int, int] | None:
                if start_year is None or end_year is None:
                    return None
                start = max(start_year, t.founded_year or start_year)
                end = min(end_year, t.dissolved_year or end_year)
                if start > end:
                    return None
                return start, end

            groups: dict[int, list[Team]] = {}
            for t in teams:
                groups.setdefault(root_id(t), []).append(t)
            franchise = random.choice(list(groups.values()))

            for t in franchise:
                seg = overlap_years(t)
                seg_start, seg_end = seg if seg else (None, None)
                segments.append(
                    {
                        "team": {
                            "id": t.id,
                            "name": t.name,
                            "abbreviation": t.abbreviation,
                            "logo_url": t.logo_url,
                            "previous_team_id": t.previous_team_id,
                            "founded_year": t.founded_year,
                            "dissolved_year": t.dissolved_year,
                        },
                        "startYear": seg_start,
                        "endYear": seg_end,
                    }
                )
            segments.sort(key=lambda s: (s.get("startYear") or 9999, (s.get("team") or {}).get("name") or ""))

        # Name-letter constraint (only if spinning name_letter).
        name_part = rules.get("name_letter_part") if isinstance(rules.get("name_letter_part"), str) else "first"
        if name_part not in ("first", "last", "either"):
            name_part = "first"
        name_letter = None
        if spin_letter:
            name_constraint = rules.get("name_letter_constraint") if isinstance(rules.get("name_letter_constraint"), dict) else {}
            pool: list[str] = []
            if name_constraint.get("type") == "specific" and isinstance(name_constraint.get("options"), list):
                pool = [str(x).strip().upper() for x in name_constraint.get("options") if isinstance(x, str)]
                pool = [x for x in pool if len(x) == 1 and x.isalpha()]
            if not pool:
                pool = [chr(c) for c in range(ord("A"), ord("Z") + 1)]

            min_players = rules.get("name_letter_min_options")
            try:
                min_players = int(min_players)
            except Exception:  # noqa: BLE001
                min_players = 1
            min_players = max(1, min_players)

            # Filter letters by actual player counts under current constraint context.
            viable: list[str] = []
            first_letter_expr = func.upper(func.substr(Player.name, 1, 1))
            last_letter_expr = func.upper(func.substr(func.split_part(Player.name, " ", 2), 1, 1))
            for L in pool:
                if name_part == "last":
                    name_clause = last_letter_expr == L
                elif name_part == "either":
                    name_clause = or_(first_letter_expr == L, last_letter_expr == L)
                else:
                    name_clause = first_letter_expr == L
                stmt_count = select(func.count(Player.id)).where(name_clause)
                # If team constraint exists, also require stint overlap with at least one team id.
                if segments:
                    team_ids = [int(s["team"]["id"]) for s in segments if isinstance(s.get("team"), dict) and s["team"].get("id")]
                    if team_ids:
                        from app.models import PlayerTeamStint  # local import to avoid circular
                        stint_exists = exists().where(
                            PlayerTeamStint.player_id == Player.id,
                            PlayerTeamStint.team_id.in_(team_ids),
                        )
                        if start_year is not None and end_year is not None:
                            stint_exists = stint_exists.where(
                                PlayerTeamStint.start_year <= end_year,
                                func.coalesce(PlayerTeamStint.end_year, end_year) >= start_year,
                            )
                        stmt_count = stmt_count.where(stint_exists)
                cnt = (await db.execute(stmt_count)).scalar_one()
                if cnt >= min_players:
                    viable.append(L)
            if not viable:
                viable = pool
            name_letter = random.choice(viable)

        return {
            "yearLabel": year_label,
            "yearStart": start_year,
            "yearEnd": end_year,
            "teams": segments,
            "nameLetter": name_letter,
            "namePart": name_part,
        }

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
            if session.draft_name is None:
                session.draft_name = draft.name

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
            "pending_selection": session.pending_selection,
            "only_eligible": session.only_eligible,
            "draft_name": session.draft_name,
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

                # Determine stage order from spin_fields.
                async with SessionLocal() as db:
                    draft = await db.get(Draft, draft_id)
                    draft_type = await db.get(DraftType, draft.draft_type_id) if draft and draft.draft_type_id else None
                    rules = draft_type.rules if draft_type and isinstance(draft_type.rules, dict) else {}
                    spin_fields = rules.get("spin_fields") if isinstance(rules.get("spin_fields"), list) else []
                    spin_year = "year" in spin_fields
                    spin_team = "team" in spin_fields
                    spin_letter = "name_letter" in spin_fields

                stages: list[str] = []
                if spin_year:
                    stages.append("year")
                if spin_team:
                    stages.append("team")
                if spin_letter:
                    stages.append("letter")

                if not stages:
                    await draft_manager.send_to(session, role, {"type": "error", "message": "No roll required for this draft type"})
                    continue

                # Animate each stage (even if a stage is "year" but constraint is Any year, UI will still show it).
                year_label_for_team: str | None = None
                for st in stages:
                    payload: dict = {"type": "roll_started", "draft_id": draft_id, "stage": st, "by_role": role}
                    if st == "team" and year_label_for_team:
                        payload["year_label"] = year_label_for_team
                    await draft_manager.broadcast(session, payload)
                    await asyncio.sleep(0.9)

                try:
                    constraint = await _compute_roll_constraint(draft_id)
                except RuntimeError as e:
                    await draft_manager.broadcast(session, {"type": "roll_error", "draft_id": draft_id, "message": str(e)})
                    continue

                # Provide year label for UI during team spin (freeze).
                year_label_for_team = constraint.get("yearLabel") if isinstance(constraint.get("yearLabel"), str) else None

                await draft_manager.broadcast(
                    session,
                    {"type": "roll_result", "draft_id": draft_id, "by_role": role, "constraint": constraint},
                )
                async with session.lock:
                    session.current_constraint = constraint
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
            elif msg_type == "set_draft_name":
                if role != "host":
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Only host can rename the draft"})
                    continue
                value = data.get("value")
                if not isinstance(value, str):
                    await draft_manager.send_to(session, role, {"type": "error", "message": "value must be a string"})
                    continue
                name = value.strip()
                if not name:
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Name cannot be blank"})
                    continue
                if len(name) > 120:
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Name too long (max 120)"})
                    continue
                async with SessionLocal() as db:
                    draft = await db.get(Draft, draft_id)
                    if not draft:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not found"})
                        continue
                    draft.name = name
                    await db.commit()
                async with session.lock:
                    session.draft_name = name
                await draft_manager.broadcast(
                    session,
                    {"type": "draft_name_updated", "draft_id": draft_id, "value": name},
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
                    # Prevent duplicate players in the same draft.
                    existing = (
                        await db.execute(
                            select(DraftPick.id)
                            .where(DraftPick.draft_id == draft_id, DraftPick.player_id == player_id)
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if existing is not None:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Player already drafted"})
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
                    try:
                        await db.commit()
                    except IntegrityError:
                        await db.rollback()
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Player already drafted"})
                        continue

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
                    session.pending_selection[role] = None
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
                await draft_manager.broadcast(
                    session,
                    {"type": "pending_selection_updated", "draft_id": draft_id, "role": role, "player": None},
                )
            elif msg_type == "select_player":
                # Ephemeral preview of a pick (shared to both clients).
                player_id = data.get("player_id")
                if player_id is not None and not isinstance(player_id, int):
                    await draft_manager.send_to(session, role, {"type": "error", "message": "player_id must be int or null"})
                    continue

                async with session.lock:
                    if not session.started or not session.current_turn:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not started"})
                        continue
                    if session.current_turn != role:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Not your turn"})
                        continue

                if player_id is None:
                    async with session.lock:
                        session.pending_selection[role] = None
                    await draft_manager.broadcast(
                        session,
                        {"type": "pending_selection_updated", "draft_id": draft_id, "role": role, "player": None},
                    )
                    continue

                async with SessionLocal() as db:
                    player = await db.get(Player, player_id)
                    if not player:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Player not found"})
                        continue
                    payload = {
                        "id": player.id,
                        "name": player.name,
                        "image_url": player.image_url,
                    }

                async with session.lock:
                    session.pending_selection[role] = payload
                await draft_manager.broadcast(
                    session,
                    {"type": "pending_selection_updated", "draft_id": draft_id, "role": role, "player": payload},
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


