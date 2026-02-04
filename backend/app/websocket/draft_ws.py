from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket.draft_manager import Role, draft_manager
from app.database import SessionLocal
from app.models import Draft, DraftPick, DraftType, Player, Team
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import joinedload

router = APIRouter(tags=["ws"])
# Use uvicorn's logger so WS logs always show up in docker compose logs.
logger = logging.getLogger("uvicorn.error")
logger.setLevel(logging.INFO)

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


async def _load_rules_for_draft(draft_id: int) -> dict:
    async with SessionLocal() as db:
        draft = await db.get(Draft, draft_id)
        if not draft:
            raise RuntimeError("Draft not found")
        dt = await db.get(DraftType, draft.draft_type_id) if draft.draft_type_id else None
        return dt.rules if dt and isinstance(dt.rules, dict) else {}


async def _persist_current_constraint(*, draft_id: int, by_role: Role, constraint: dict | None) -> None:
    """
    Persist the current roll constraint so refresh/reconnect doesn't lose it.
    """
    async with SessionLocal() as db:
        draft = await db.get(Draft, draft_id, with_for_update=True)
        if not draft:
            return
        draft.current_constraint = constraint
        draft.current_constraint_role = by_role if constraint is not None else None
        await db.commit()


def _max_rerolls_from_rules(rules: dict) -> int:
    allow_reroll = bool(rules.get("allow_reroll", True))
    try:
        max_r = int(rules.get("max_rerolls", 0))
    except Exception:  # noqa: BLE001
        max_r = 0
    return max(0, max_r) if allow_reroll else 0


def _stage_order_from_rules(rules: dict) -> list[str]:
    spin_fields = rules.get("spin_fields") if isinstance(rules.get("spin_fields"), list) else []
    out: list[str] = []
    if "year" in spin_fields:
        out.append("year")
    if "team" in spin_fields:
        out.append("team")
    if "name_letter" in spin_fields:
        out.append("letter")
    if "player" in spin_fields:
        out.append("player")
    return out


def _roll_count_from_rules(rules: dict) -> int:
    """
    Number of parallel roll options to generate per turn.
    """
    try:
        n = int(rules.get("roll_count", 1))
    except Exception:  # noqa: BLE001
        n = 1
    return max(1, min(5, n))


async def _roll_year(rules: dict) -> tuple[str, int | None, int | None]:
    year_constraint = rules.get("year_constraint") if isinstance(rules.get("year_constraint"), dict) else {}
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
    return year_label, start_year, end_year


async def _roll_team(*, year_start: int | None, year_end: int | None, rules: dict) -> list[dict]:
    team_constraint = rules.get("team_constraint") if isinstance(rules.get("team_constraint"), dict) else {}
    tc_type = team_constraint.get("type")
    tc_options = team_constraint.get("options")
    async with SessionLocal() as db:
        if year_start is not None and year_end is not None:
            team_stmt = select(Team).where(
                and_(
                    or_(Team.founded_year.is_(None), Team.founded_year <= year_end),
                    or_(Team.dissolved_year.is_(None), Team.dissolved_year >= year_start),
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
            if year_start is None or year_end is None:
                return None
            start = max(year_start, t.founded_year or year_start)
            end = min(year_end, t.dissolved_year or year_end)
            if start > end:
                return None
            return start, end

        groups: dict[int, list[Team]] = {}
        for t in teams:
            groups.setdefault(root_id(t), []).append(t)
        franchise = random.choice(list(groups.values()))

        segments: list[dict] = []
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
        return segments


async def _roll_letter(
    *,
    rules: dict,
    year_start: int | None,
    year_end: int | None,
    team_segments: list[dict],
) -> tuple[str | None, str]:
    name_part = rules.get("name_letter_part") if isinstance(rules.get("name_letter_part"), str) else "first"
    if name_part not in ("first", "last", "either"):
        name_part = "first"

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

    team_ids: list[int] = []
    for s in team_segments:
        if isinstance(s, dict) and isinstance(s.get("team"), dict):
            tid = s["team"].get("id")
            if isinstance(tid, int):
                team_ids.append(tid)

    async with SessionLocal() as db:
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
            if team_ids:
                from app.models import PlayerTeamStint  # local import to avoid circular

                stint_exists = exists().where(
                    PlayerTeamStint.player_id == Player.id,
                    PlayerTeamStint.team_id.in_(team_ids),
                )
                if year_start is not None and year_end is not None:
                    stint_exists = stint_exists.where(
                        PlayerTeamStint.start_year <= year_end,
                        func.coalesce(PlayerTeamStint.end_year, year_end) >= year_start,
                    )
                stmt_count = stmt_count.where(stint_exists)
            cnt = (await db.execute(stmt_count)).scalar_one()
            if cnt >= min_players:
                viable.append(L)
        if not viable:
            viable = pool
        return random.choice(viable), name_part


def _team_franchise_root_id(team_id: int, prev_by_id: dict[int, int | None]) -> int:
    """
    Follow Team.previous_team_id links to get a stable franchise root id.
    Includes cycle protection.
    """
    cur = team_id
    seen: set[int] = set()
    while cur not in seen:
        seen.add(cur)
        prev = prev_by_id.get(cur)
        if not prev:
            break
        cur = prev
    return cur


def _coalesced_team_stint_count(*, stint_team_ids_in_order: list[int], prev_by_id: dict[int, int | None]) -> int:
    """
    Count stints after coalescing consecutive stints that belong to the same franchise.
    Example: SEA->OKC with no other team between counts as 1.
    """
    last_root: int | None = None
    count = 0
    for team_id in stint_team_ids_in_order:
        root = _team_franchise_root_id(team_id, prev_by_id)
        if last_root is None or root != last_root:
            count += 1
            last_root = root
    return count


def _parse_static_year_constraint(rules: dict) -> tuple[str, int | None, int | None]:
    """
    Resolve non-spun year constraints into a (label, start, end) tuple.
    Mirrors the frontend's "staticYear" behavior:
    - any => no constraint
    - range => fixed start/end
    - decade (single option) => fixed decade
    - specific (single option) => fixed year
    - otherwise => treat as no constraint
    """
    yc = rules.get("year_constraint") if isinstance(rules.get("year_constraint"), dict) else {}
    t = yc.get("type")
    opts = yc.get("options")
    if t == "any":
        return ("No constraint", None, None)
    if t == "range" and isinstance(opts, dict):
        start = opts.get("startYear")
        end = opts.get("endYear")
        if isinstance(start, int) and isinstance(end, int):
            return (f"{start}-{end}", start, end)
        return ("No constraint", None, None)
    if t == "decade" and isinstance(opts, list) and len(opts) == 1 and isinstance(opts[0], str):
        label = str(opts[0])
        parsed = _parse_decade_label(label)
        if parsed:
            start, end = parsed
            return (label, start, end)
        return (label, None, None)
    if t == "specific" and isinstance(opts, list) and len(opts) == 1:
        try:
            y = int(opts[0])
            return (str(y), y, y)
        except Exception:  # noqa: BLE001
            return ("No constraint", None, None)
    return ("No constraint", None, None)


def _parse_static_name_letter_constraint(rules: dict) -> tuple[str | None, str]:
    """
    Resolve non-spun name-letter constraints into (letter, part).
    Mirrors the frontend: only a single fixed letter is treated as a constraint.
    """
    name_part = rules.get("name_letter_part") if isinstance(rules.get("name_letter_part"), str) else "first"
    if name_part not in ("first", "last", "either"):
        name_part = "first"
    nc = rules.get("name_letter_constraint") if isinstance(rules.get("name_letter_constraint"), dict) else {}
    if nc.get("type") != "specific" or not isinstance(nc.get("options"), list):
        return (None, name_part)
    letters = [str(x).strip().upper() for x in nc.get("options") if isinstance(x, str)]
    letters = [x for x in letters if len(x) == 1 and x.isalpha()]
    if len(letters) != 1:
        return (None, name_part)
    return (letters[0], name_part)


async def _resolve_static_team_segments(*, rules: dict, year_start: int | None, year_end: int | None) -> list[dict]:
    """
    Resolve non-spun team constraints into a list of team segments (for eligibility filtering + UI display).
    """
    team_constraint = rules.get("team_constraint") if isinstance(rules.get("team_constraint"), dict) else {}
    tc_type = team_constraint.get("type")
    tc_options = team_constraint.get("options")
    async with SessionLocal() as db:
        stmt = select(Team)
        if year_start is not None and year_end is not None:
            stmt = stmt.where(
                and_(
                    or_(Team.founded_year.is_(None), Team.founded_year <= year_end),
                    or_(Team.dissolved_year.is_(None), Team.dissolved_year >= year_start),
                )
            )
        if tc_type == "conference" and isinstance(tc_options, list) and tc_options:
            stmt = stmt.where(Team.conference.in_([str(x) for x in tc_options]))
        elif tc_type == "division" and isinstance(tc_options, list) and tc_options:
            stmt = stmt.where(Team.division.in_([str(x) for x in tc_options]))
        elif tc_type == "specific" and isinstance(tc_options, list) and tc_options:
            stmt = stmt.where(Team.abbreviation.in_([str(x) for x in tc_options]))
        else:
            return []
        teams = (await db.execute(stmt)).scalars().all()
        teams.sort(key=lambda t: (t.name or "", t.id))
        return [
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
                "startYear": None,
                "endYear": None,
            }
            for t in teams
        ]


async def _drafted_player_ids(*, draft_id: int) -> set[int]:
    async with SessionLocal() as db:
        rows = (await db.execute(select(DraftPick.player_id).where(DraftPick.draft_id == draft_id))).all()
        return {int(r[0]) for r in rows if r and r[0] is not None}


def _apply_active_retired_filters(stmt, *, rules: dict):
    allow_active = rules.get("allow_active", True)
    allow_retired = rules.get("allow_retired", True)
    allow_active = bool(True if allow_active is None else allow_active)
    allow_retired = bool(True if allow_retired is None else allow_retired)
    if not allow_active and not allow_retired:
        # Caller should surface a useful error.
        return stmt.where(False)
    if not allow_active:
        stmt = stmt.where(Player.retirement_year.is_not(None))
    elif not allow_retired:
        stmt = stmt.where(Player.retirement_year.is_(None))
    return stmt


async def _count_viable_players_for_letter(
    *,
    drafted_player_ids: set[int],
    rules: dict,
    year_start: int | None,
    year_end: int | None,
    team_ids: list[int],
    name_clause,
    min_needed: int,
) -> int:
    """
    Count players that match all eligibility filters for a given name-letter clause,
    excluding already-drafted players. If min/max team stints are set, count is computed
    via batch stint scanning (stops early once min_needed is met).
    """
    from app.models import PlayerTeamStint  # local import to avoid circular

    min_team_stints = rules.get("min_team_stints")
    max_team_stints = rules.get("max_team_stints")
    try:
        min_team_stints = int(min_team_stints) if min_team_stints is not None else None
    except Exception:  # noqa: BLE001
        min_team_stints = None
    try:
        max_team_stints = int(max_team_stints) if max_team_stints is not None else None
    except Exception:  # noqa: BLE001
        max_team_stints = None

    use_stint_count = min_team_stints is not None or max_team_stints is not None

    current_year = datetime.now(timezone.utc).year
    async with SessionLocal() as db:
        base_ids = select(Player.id).where(name_clause)
        base_ids = _apply_active_retired_filters(base_ids, rules=rules)
        if drafted_player_ids:
            base_ids = base_ids.where(Player.id.not_in(drafted_player_ids))

        if team_ids or (year_start is not None and year_end is not None):
            stint_exists = exists().where(PlayerTeamStint.player_id == Player.id)
            if team_ids:
                stint_exists = stint_exists.where(PlayerTeamStint.team_id.in_(team_ids))
            if year_start is not None and year_end is not None:
                stint_exists = stint_exists.where(
                    PlayerTeamStint.start_year <= year_end,
                    func.coalesce(PlayerTeamStint.end_year, Player.retirement_year, current_year) >= year_start,
                )
            base_ids = base_ids.where(stint_exists)

        if not use_stint_count:
            cnt = (await db.execute(select(func.count()).select_from(base_ids.subquery()))).scalar_one()
            return int(cnt)

        if min_team_stints is not None and max_team_stints is not None and min_team_stints > max_team_stints:
            return 0

        # Load team->previous mapping once (teams table is small).
        team_rows = (await db.execute(select(Team.id, Team.previous_team_id))).all()
        prev_by_id: dict[int, int | None] = {int(tid): (int(prev) if prev is not None else None) for (tid, prev) in team_rows}

        # Scan eligible ids in batches; compute coalesced stint counts in batch.
        total = 0
        offset = 0
        batch_size = 500
        safety_iters = 0
        while total < min_needed and safety_iters < 40:
            safety_iters += 1
            batch_ids = (await db.execute(base_ids.order_by(Player.id.asc()).limit(batch_size).offset(offset))).scalars().all()
            if not batch_ids:
                break
            offset += len(batch_ids)

            stint_rows = (
                await db.execute(
                    select(PlayerTeamStint.player_id, PlayerTeamStint.team_id)
                    .where(PlayerTeamStint.player_id.in_(batch_ids))
                    .order_by(PlayerTeamStint.player_id.asc(), PlayerTeamStint.start_year.asc())
                )
            ).all()

            counts: dict[int, int] = {int(pid): 0 for pid in batch_ids}
            cur_pid: int | None = None
            last_root: int | None = None
            for pid_raw, team_id_raw in stint_rows:
                pid = int(pid_raw)
                team_id = int(team_id_raw)
                if cur_pid != pid:
                    cur_pid = pid
                    last_root = None
                root = _team_franchise_root_id(team_id, prev_by_id)
                if last_root is None or root != last_root:
                    counts[pid] = counts.get(pid, 0) + 1
                    last_root = root

            for pid in batch_ids:
                c = counts.get(int(pid), 0)
                if min_team_stints is not None and c < min_team_stints:
                    continue
                if max_team_stints is not None and c > max_team_stints:
                    continue
                total += 1
                if total >= min_needed:
                    break
        return total


async def _roll_player(
    *,
    draft_id: int,  # noqa: ARG001
    drafted_player_ids: set[int],
    exclude_ids: set[int] | None = None,
    rules: dict,
    year_start: int | None,
    year_end: int | None,
    team_segments: list[dict],
    name_letter: str | None,
    name_part: str,
) -> dict:
    """
    Select a random eligible, undrafted player matching the current constraint.
    """
    from app.models import PlayerTeamStint  # local import to avoid circular

    current_year = datetime.now(timezone.utc).year

    # Extract team ids
    team_ids: list[int] = []
    for s in team_segments:
        if isinstance(s, dict) and isinstance(s.get("team"), dict):
            tid = s["team"].get("id")
            if isinstance(tid, int):
                team_ids.append(tid)
    team_ids = sorted(set(team_ids))

    min_team_stints = rules.get("min_team_stints")
    max_team_stints = rules.get("max_team_stints")
    try:
        min_team_stints = int(min_team_stints) if min_team_stints is not None else None
    except Exception:  # noqa: BLE001
        min_team_stints = None
    try:
        max_team_stints = int(max_team_stints) if max_team_stints is not None else None
    except Exception:  # noqa: BLE001
        max_team_stints = None

    if min_team_stints is not None and max_team_stints is not None and min_team_stints > max_team_stints:
        raise RuntimeError("Invalid player stint-count constraint (min > max)")

    use_stint_count = min_team_stints is not None or max_team_stints is not None

    # Name letter clause (optional)
    name_clause = True
    if name_letter and isinstance(name_letter, str):
        L = name_letter.strip().upper()
        if len(L) == 1 and L.isalpha():
            first_letter_expr = func.upper(func.substr(Player.name, 1, 1))
            last_letter_expr = func.upper(func.substr(func.split_part(Player.name, " ", 2), 1, 1))
            if name_part == "last":
                name_clause = last_letter_expr == L
            elif name_part == "either":
                name_clause = or_(first_letter_expr == L, last_letter_expr == L)
            else:
                name_clause = first_letter_expr == L

    async with SessionLocal() as db:
        ids_stmt = select(Player.id).where(name_clause)
        ids_stmt = _apply_active_retired_filters(ids_stmt, rules=rules)
        if drafted_player_ids:
            ids_stmt = ids_stmt.where(Player.id.not_in(drafted_player_ids))
        if exclude_ids:
            ids_stmt = ids_stmt.where(Player.id.not_in(exclude_ids))

        if team_ids or (year_start is not None and year_end is not None):
            stint_exists = exists().where(PlayerTeamStint.player_id == Player.id)
            if team_ids:
                stint_exists = stint_exists.where(PlayerTeamStint.team_id.in_(team_ids))
            if year_start is not None and year_end is not None:
                stint_exists = stint_exists.where(
                    PlayerTeamStint.start_year <= year_end,
                    func.coalesce(PlayerTeamStint.end_year, Player.retirement_year, current_year) >= year_start,
                )
            ids_stmt = ids_stmt.where(stint_exists)

        # Fast path when stint-count filter isn't used.
        if not use_stint_count:
            cnt = int((await db.execute(select(func.count()).select_from(ids_stmt.subquery()))).scalar_one())
            if cnt <= 0:
                raise RuntimeError("No eligible players available for that constraint")
            off = random.randrange(cnt)
            pid = (await db.execute(ids_stmt.order_by(Player.id.asc()).limit(1).offset(off))).scalar_one_or_none()
            if pid is None:
                raise RuntimeError("No eligible players available for that constraint")
            player = await db.get(Player, int(pid))
            if not player:
                raise RuntimeError("No eligible players available for that constraint")
            return {"id": player.id, "name": player.name, "image_url": player.image_url}

        # Stint-count path: scan ids in batches and pick randomly among the first N matches.
        team_rows = (await db.execute(select(Team.id, Team.previous_team_id))).all()
        prev_by_id: dict[int, int | None] = {int(tid): (int(prev) if prev is not None else None) for (tid, prev) in team_rows}

        matching: list[int] = []
        offset = 0
        batch_size = 500
        safety_iters = 0
        while len(matching) < 80 and safety_iters < 60:
            safety_iters += 1
            batch_ids = (await db.execute(ids_stmt.order_by(Player.id.asc()).limit(batch_size).offset(offset))).scalars().all()
            if not batch_ids:
                break
            offset += len(batch_ids)

            stint_rows = (
                await db.execute(
                    select(PlayerTeamStint.player_id, PlayerTeamStint.team_id)
                    .where(PlayerTeamStint.player_id.in_(batch_ids))
                    .order_by(PlayerTeamStint.player_id.asc(), PlayerTeamStint.start_year.asc())
                )
            ).all()

            counts: dict[int, int] = {int(pid): 0 for pid in batch_ids}
            cur_pid: int | None = None
            last_root: int | None = None
            for pid_raw, team_id_raw in stint_rows:
                pid_i = int(pid_raw)
                team_id_i = int(team_id_raw)
                if cur_pid != pid_i:
                    cur_pid = pid_i
                    last_root = None
                root = _team_franchise_root_id(team_id_i, prev_by_id)
                if last_root is None or root != last_root:
                    counts[pid_i] = counts.get(pid_i, 0) + 1
                    last_root = root

            for pid in batch_ids:
                c = counts.get(int(pid), 0)
                if min_team_stints is not None and c < min_team_stints:
                    continue
                if max_team_stints is not None and c > max_team_stints:
                    continue
                matching.append(int(pid))
                if len(matching) >= 80:
                    break

        if not matching:
            raise RuntimeError("No eligible players available for that constraint")

        pid = random.choice(matching)
        player = await db.get(Player, pid)
        if not player:
            raise RuntimeError("No eligible players available for that constraint")
        return {"id": player.id, "name": player.name, "image_url": player.image_url}

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
        max_rerolls = _max_rerolls_from_rules(rules)

        # Initialize persisted rerolls if missing/zeroed for legacy drafts.
        if draft.host_rerolls is None or draft.guest_rerolls is None:
            draft.host_rerolls = max_rerolls
            draft.guest_rerolls = max_rerolls
            await db.commit()

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

        # Backwards compatibility: if draft is effectively complete but still marked "drafting",
        # normalize persisted status so clients can rely on it.
        if draft.status != "completed":
            host_count = sum(1 for r in pick_rows if r.get("role") == "host")
            guest_count = sum(1 for r in pick_rows if r.get("role") == "guest")
            if host_count >= draft.picks_per_player and guest_count >= draft.picks_per_player:
                draft.status = "completed"
                if draft.completed_at is None:
                    draft.completed_at = datetime.now(timezone.utc)
                await db.commit()

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
            # Restore persisted roll constraint (if any) so refresh doesn't lose the roll.
            persisted = getattr(draft, "current_constraint", None)
            persisted_role = getattr(draft, "current_constraint_role", None)
            if isinstance(persisted, dict):
                session.current_constraint = persisted
                # Back-compat: legacy single-player roll used to auto-fill pending selection.
                player_payload = persisted.get("player")
                if not isinstance(persisted.get("options"), list):
                    if (
                        isinstance(player_payload, dict)
                        and isinstance(player_payload.get("id"), int)
                        and persisted_role in ("host", "guest")
                    ):
                        session.pending_selection[persisted_role] = player_payload

    await draft_manager.broadcast(
        session,
        {
            "type": "lobby_ready",
            "draft_id": draft_id,
            "draft_public_id": str(draft.public_id),
            "status": draft.status,
            "connected": list(session.conns.keys()),
            "started": session.started,
            "first_turn": session.first_turn,
            "current_turn": session.current_turn,
            "picks": session.picks,
            "constraint": session.current_constraint,
            "pending_selection": session.pending_selection,
            "only_eligible": session.only_eligible,
            "draft_name": session.draft_name,
            "max_rerolls": max_rerolls,
            "rerolls_remaining": {"host": draft.host_rerolls, "guest": draft.guest_rerolls},
        },
    )

    async def _broadcast_snapshot(*, draft_id: int) -> None:
        """
        Broadcast a full lobby_ready snapshot (used after host admin actions like undo).
        Keeps client state consistent without introducing a new message type.
        """
        async with SessionLocal() as db:
            draft = (
                await db.get(Draft, draft_id)
                if kind == "id"
                else (await db.execute(select(Draft).where(Draft.public_id == value))).scalar_one_or_none()
            )
            if not draft:
                return
            draft_type = await db.get(DraftType, draft.draft_type_id) if draft.draft_type_id else None
            rules = draft_type.rules if draft_type and isinstance(draft_type.rules, dict) else {}
            max_rerolls = _max_rerolls_from_rules(rules)

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
                    "role": (
                        p.role
                        if getattr(p, "role", None) in ("host", "guest")
                        else ("host" if p.user_id == draft.host_id else "guest")
                    ),
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
        if started and not first_turn and pick_rows:
            inferred = pick_rows[0].get("role")
            if inferred in ("host", "guest"):
                first_turn = inferred
        await draft_manager.rehydrate_from_db(session, first_turn=first_turn, pick_rows=pick_rows, started=started)
        async with session.lock:
            session.current_constraint = None
            session.pending_selection["host"] = None
            session.pending_selection["guest"] = None

        await draft_manager.broadcast(
            session,
            {
                "type": "lobby_ready",
                "draft_id": draft_id,
                "draft_public_id": str(draft.public_id),
                "status": draft.status,
                "connected": list(session.conns.keys()),
                "started": session.started,
                "first_turn": session.first_turn,
                "current_turn": session.current_turn,
                "picks": session.picks,
                "constraint": session.current_constraint,
                "pending_selection": session.pending_selection,
                "only_eligible": session.only_eligible,
                "draft_name": session.draft_name,
                "max_rerolls": max_rerolls,
                "rerolls_remaining": {"host": draft.host_rerolls, "guest": draft.guest_rerolls},
            },
        )

    async def _run_roll(*, by_role: Role, consume_rerolls: bool) -> None:
        """
        Perform a server-side roll, broadcasting the same animation messages as normal roll.
        by_role controls which player the roll is "for" (who's turn it is).
        """
        # Must be a started draft and someone must be on the clock.
        async with session.lock:
            if not session.started or not session.current_turn:
                return

        rules = await _load_rules_for_draft(draft_id)
        max_rerolls = _max_rerolls_from_rules(rules)

        # Enforce reroll limit (persisted in DB): first roll of a turn is free;
        # subsequent rolls consume role-specific rerolls.
        is_reroll = False
        async with session.lock:
            is_reroll = session.current_constraint is not None
        if consume_rerolls and is_reroll:
            async with SessionLocal() as db:
                d = await db.get(Draft, draft_id, with_for_update=True)
                if not d:
                    return
                if by_role == "host":
                    if d.host_rerolls <= 0:
                        return
                    d.host_rerolls -= 1
                    remaining = d.host_rerolls
                else:
                    if d.guest_rerolls <= 0:
                        return
                    d.guest_rerolls -= 1
                    remaining = d.guest_rerolls
                await db.commit()
            await draft_manager.broadcast(
                session,
                {"type": "rerolls_updated", "draft_id": draft_id, "role": by_role, "remaining": remaining, "max": max_rerolls},
            )

        stages = _stage_order_from_rules(rules)
        logger.info("roll stages draft_id=%s by_role=%s stages=%s", draft_id, by_role, stages)
        if not stages:
            return

        drafted_ids = await _drafted_player_ids(draft_id=draft_id)
        roll_count = _roll_count_from_rules(rules)

        # Sequential stages: each stage rolls ONE field, but we generate roll_count parallel options.
        year_labels: list[str] = ["No constraint"] * roll_count
        year_starts: list[int | None] = [None] * roll_count
        year_ends: list[int | None] = [None] * roll_count
        team_segments_by_opt: list[list[dict]] = [[] for _ in range(roll_count)]
        name_letters: list[str | None] = [None] * roll_count
        name_part: str = rules.get("name_letter_part") if isinstance(rules.get("name_letter_part"), str) else "first"
        if name_part not in ("first", "last", "either"):
            name_part = "first"
        rolled_players: list[dict | None] = [None] * roll_count

        # Seed static constraints for fields that are NOT spun (applied to all options).
        if "year" not in stages:
            ylab, ys, ye = _parse_static_year_constraint(rules)
            year_labels = [ylab] * roll_count
            year_starts = [ys] * roll_count
            year_ends = [ye] * roll_count
        if "letter" not in stages:
            L, name_part = _parse_static_name_letter_constraint(rules)
            name_letters = [L] * roll_count
        if "team" not in stages:
            # If year isn't spun, static teams can be filtered by the (static) year window. Otherwise it's unbounded.
            segs = await _resolve_static_team_segments(rules=rules, year_start=year_starts[0], year_end=year_ends[0])
            team_segments_by_opt = [list(segs) for _ in range(roll_count)]

        def current_constraint() -> dict:
            return {
                "options": [
                    {
                        "yearLabel": year_labels[i],
                        "yearStart": year_starts[i],
                        "yearEnd": year_ends[i],
                        "teams": team_segments_by_opt[i],
                        "nameLetter": name_letters[i],
                        "namePart": name_part,
                        "player": rolled_players[i],
                    }
                    for i in range(roll_count)
                ]
            }

        for st in stages:
            await draft_manager.broadcast(session, {"type": "roll_started", "draft_id": draft_id, "by_role": by_role, "stage": st})
            await asyncio.sleep(0.8)
            try:
                if st == "year":
                    for i in range(roll_count):
                        ylab, ys, ye = await _roll_year(rules)
                        year_labels[i] = ylab
                        year_starts[i] = ys
                        year_ends[i] = ye
                        if "team" not in stages:
                            # Refresh static teams to respect each rolled year window.
                            segs = await _resolve_static_team_segments(rules=rules, year_start=ys, year_end=ye)
                            team_segments_by_opt[i] = segs
                elif st == "team":
                    for i in range(roll_count):
                        team_segments_by_opt[i] = await _roll_team(
                            year_start=year_starts[i],
                            year_end=year_ends[i],
                            rules=rules,
                        )
                elif st == "letter":
                    # Shared letter pool config
                    pool: list[str] = []
                    name_constraint = rules.get("name_letter_constraint") if isinstance(rules.get("name_letter_constraint"), dict) else {}
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

                    first_letter_expr = func.upper(func.substr(Player.name, 1, 1))
                    last_letter_expr = func.upper(func.substr(func.split_part(Player.name, " ", 2), 1, 1))

                    for i in range(roll_count):
                        team_ids: list[int] = []
                        for s in team_segments_by_opt[i]:
                            if isinstance(s, dict) and isinstance(s.get("team"), dict):
                                tid = s["team"].get("id")
                                if isinstance(tid, int):
                                    team_ids.append(tid)
                        team_ids = sorted(set(team_ids))

                        viable: list[str] = []
                        for L in pool:
                            if name_part == "last":
                                name_clause = last_letter_expr == L
                            elif name_part == "either":
                                name_clause = or_(first_letter_expr == L, last_letter_expr == L)
                            else:
                                name_clause = first_letter_expr == L
                            cnt = await _count_viable_players_for_letter(
                                drafted_player_ids=drafted_ids,
                                rules=rules,
                                year_start=year_starts[i],
                                year_end=year_ends[i],
                                team_ids=team_ids,
                                name_clause=name_clause,
                                min_needed=min_players,
                            )
                            if cnt >= min_players:
                                viable.append(L)
                        if not viable:
                            viable = pool
                        name_letters[i] = random.choice(viable)
                else:
                    exclude: set[int] = set()
                    for i in range(roll_count):
                        p = await _roll_player(
                            draft_id=draft_id,
                            drafted_player_ids=drafted_ids,
                            exclude_ids=exclude,
                            rules=rules,
                            year_start=year_starts[i],
                            year_end=year_ends[i],
                            team_segments=team_segments_by_opt[i],
                            name_letter=name_letters[i],
                            name_part=name_part,
                        )
                        rolled_players[i] = p
                        pid = p.get("id") if isinstance(p, dict) else None
                        if isinstance(pid, int):
                            exclude.add(pid)
            except RuntimeError as e:
                await draft_manager.broadcast(session, {"type": "roll_error", "draft_id": draft_id, "message": str(e)})
                break
            except Exception:  # noqa: BLE001
                logger.exception("roll stage failed draft_id=%s by_role=%s stage=%s", draft_id, by_role, st)
                await draft_manager.broadcast(session, {"type": "roll_error", "draft_id": draft_id, "message": "Roll failed (server error)"})
                break

            async with session.lock:
                session.current_constraint = current_constraint()
            await draft_manager.broadcast(
                session,
                {"type": "roll_stage_result", "draft_id": draft_id, "by_role": by_role, "stage": st, "constraint": session.current_constraint},
            )
            await asyncio.sleep(0.2)

        async with session.lock:
            final_constraint = session.current_constraint
        if final_constraint:
            # Persist the final constraint so refresh/reconnect doesn't lose it.
            await _persist_current_constraint(draft_id=draft_id, by_role=by_role, constraint=final_constraint)
            await draft_manager.broadcast(session, {"type": "roll_result", "draft_id": draft_id, "by_role": by_role, "constraint": final_constraint})
            # Multi-roll UI allows the client to choose; do not auto-set pending selection here.

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
                        "status": "drafting",
                    },
                )
            elif msg_type == "roll":
                # Only the current-turn player can roll.
                roll_err: str | None = None
                async with session.lock:
                    if not session.started or not session.current_turn:
                        roll_err = "Draft not started"
                    elif session.current_turn != role:
                        roll_err = "Not your turn"
                if roll_err:
                    continue
                # Normal roll consumes rerolls if this is a reroll.
                await _run_roll(by_role=role, consume_rerolls=True)
            elif msg_type == "force_reroll":
                # Host-only admin action: reroll the current constraint for whoever is on the clock.
                if role != "host":
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Only host can force reroll"})
                    continue
                async with session.lock:
                    target = session.current_turn
                    started_now = session.started
                    current_constraint = session.current_constraint
                if not started_now or target not in ("host", "guest"):
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not started"})
                    continue
                if current_constraint is None:
                    await draft_manager.send_to(session, role, {"type": "error", "message": "No constraint to reroll"})
                    continue
                # Force reroll should NOT consume reroll tokens.
                await _run_roll(by_role=target, consume_rerolls=False)
            elif msg_type == "undo_pick":
                # Host-only admin action: undo the most recent pick.
                if role != "host":
                    await draft_manager.send_to(session, role, {"type": "error", "message": "Only host can undo picks"})
                    continue
                async with SessionLocal() as db:
                    draft = await db.get(Draft, draft_id, with_for_update=True)
                    if not draft:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "Draft not found"})
                        continue
                    last_pick = (
                        await db.execute(
                            select(DraftPick).where(DraftPick.draft_id == draft_id).order_by(DraftPick.pick_number.desc()).limit(1)
                        )
                    ).scalar_one_or_none()
                    if not last_pick:
                        await draft_manager.send_to(session, role, {"type": "error", "message": "No picks to undo"})
                        continue
                    await db.delete(last_pick)
                    # If draft was completed, revert it to drafting.
                    if draft.status == "completed":
                        draft.status = "drafting"
                        draft.completed_at = None
                    await db.commit()
                await _broadcast_snapshot(draft_id=draft_id)
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
                draft_status = "drafting"
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

                    # If the draft is now complete, persist completion status (and expose it to clients).
                    draft_status = draft.status
                    if draft.status != "completed":
                        counts = (
                            await db.execute(
                                select(DraftPick.role, func.count(DraftPick.id))
                                .where(DraftPick.draft_id == draft_id)
                                .group_by(DraftPick.role)
                            )
                        ).all()
                        by_role = {r: int(c) for (r, c) in counts if r in ("host", "guest")}
                        if by_role.get("host", 0) >= draft.picks_per_player and by_role.get("guest", 0) >= draft.picks_per_player:
                            draft.status = "completed"
                            if draft.completed_at is None:
                                draft.completed_at = datetime.now(timezone.utc)
                            await db.commit()
                        draft_status = draft.status

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
                # Clear persisted constraint once a pick is made (new turn starts clean).
                await _persist_current_constraint(draft_id=draft_id, by_role=role, constraint=None)
                await draft_manager.broadcast(
                    session,
                    {
                        "type": "pick_made",
                        "draft_id": draft_id,
                        "draft_status": draft_status,
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

                select_err: str | None = None
                async with session.lock:
                    if not session.started or not session.current_turn:
                        select_err = "Draft not started"
                    elif session.current_turn != role:
                        select_err = "Not your turn"
                if select_err:
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
    except Exception:  # noqa: BLE001
        logger.exception("ws crashed draft_id=%s role=%s", draft_id, role)
        await draft_manager.disconnect(session, role, ws)


