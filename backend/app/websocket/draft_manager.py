from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field
from typing import Literal

from fastapi import WebSocket


Role = Literal["host", "guest"]


@dataclass
class DraftSession:
    draft_id: int
    conns: dict[Role, WebSocket] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # draft state (minimal for now; persisted picks come later)
    started: bool = False
    current_turn: Role | None = None
    pick_number: int = 0
    first_turn: Role | None = None
    # persisted picks (rehydrated from DB on connect)
    picks: list[dict] = field(default_factory=list)
    # current rolled constraint (not yet persisted; used so both clients see the roll even if one reconnects)
    current_constraint: dict | None = None

    def other(self, role: Role) -> Role:
        return "guest" if role == "host" else "host"


class DraftManager:
    def __init__(self) -> None:
        self._sessions: dict[int, DraftSession] = {}
        self._global_lock = asyncio.Lock()

    async def get_or_create(self, draft_id: int) -> DraftSession:
        async with self._global_lock:
            if draft_id not in self._sessions:
                self._sessions[draft_id] = DraftSession(draft_id=draft_id)
            return self._sessions[draft_id]

    async def connect(self, draft_id: int, role: Role, ws: WebSocket) -> DraftSession:
        session = await self.get_or_create(draft_id)
        async with session.lock:
            session.conns[role] = ws
        return session

    async def rehydrate_from_db(
        self,
        session: DraftSession,
        *,
        first_turn: Role | None,
        pick_rows: list[dict],
        started: bool,
    ) -> None:
        """
        Restore in-memory session state from persisted DB state.
        """
        async with session.lock:
            session.started = started
            session.first_turn = first_turn
            session.picks = pick_rows
            session.pick_number = len(pick_rows)
            if started and first_turn:
                next_pick_number = session.pick_number + 1
                session.current_turn = self._expected_role_for_pick(first=first_turn, pick_number=next_pick_number)
            else:
                session.current_turn = None

    async def disconnect(self, session: DraftSession, role: Role) -> None:
        async with session.lock:
            if role in session.conns:
                del session.conns[role]
            if not session.conns:
                async with self._global_lock:
                    self._sessions.pop(session.draft_id, None)

    async def broadcast(self, session: DraftSession, message: dict) -> None:
        async with session.lock:
            conns = list(session.conns.items())  # [(role, ws), ...]
        dead_roles: list[Role] = []
        for role, ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                dead_roles.append(role)
        if dead_roles:
            async with session.lock:
                for r in dead_roles:
                    session.conns.pop(r, None)

    async def send_to(self, session: DraftSession, role: Role, message: dict) -> None:
        async with session.lock:
            ws = session.conns.get(role)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                async with session.lock:
                    session.conns.pop(role, None)

    async def start(self, session: DraftSession) -> Role:
        async with session.lock:
            if session.started:
                return session.current_turn or "host"
            session.started = True
            session.pick_number = 0
            session.first_turn = random.choice(["host", "guest"])
            session.current_turn = session.first_turn
            return session.current_turn

    def _expected_role_for_pick(self, *, first: Role, pick_number: int) -> Role:
        """
        2-player snake draft order with a randomized first pick.

        pick_number is 1-based.
        Round 1: first, other
        Round 2: other, first
        Round 3: first, other
        ...
        """
        other = "guest" if first == "host" else "host"
        round_idx = (pick_number - 1) // 2  # 0-based
        within = (pick_number - 1) % 2
        if round_idx % 2 == 0:
            return first if within == 0 else other
        return other if within == 0 else first

    async def next_pick(self, session: DraftSession, role: Role) -> tuple[int, Role]:
        async with session.lock:
            if not session.started:
                raise RuntimeError("Draft not started")
            if not session.first_turn:
                raise RuntimeError("Draft not started")
            if session.current_turn != role:
                raise RuntimeError("Not your turn")
            session.pick_number += 1

            # Snake order: determine next turn from pick_number + 1
            next_pick_number = session.pick_number + 1
            session.current_turn = self._expected_role_for_pick(first=session.first_turn, pick_number=next_pick_number)
            return session.pick_number, session.current_turn


draft_manager = DraftManager()


