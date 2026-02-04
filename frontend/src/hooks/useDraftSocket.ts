"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TeamLiteWs = {
  id: number;
  name: string;
  abbreviation?: string | null;
  logo_url?: string | null;
  previous_team_id?: number | null;
  founded_year?: number | null;
  dissolved_year?: number | null;
};

type ConstraintTeamSegmentWs = {
  team: TeamLiteWs;
  startYear?: number | null;
  endYear?: number | null;
};

type DraftWsMessage =
  | {
      type: "lobby_ready";
      draft_id: number;
      status?: string;
      connected: string[];
      started?: boolean;
      first_turn?: "host" | "guest" | null;
      current_turn?: "host" | "guest" | null;
      draft_name?: string | null;
      max_rerolls?: number | null;
      rerolls_remaining?: { host?: number; guest?: number } | null;
      picks?: Array<{
        pick_number: number;
        role: "host" | "guest";
        player_id: number;
        player_name: string;
        player_image_url?: string | null;
        constraint_team?: string | null;
        constraint_year?: string | null;
      }>;
      constraint?: {
        teams: ConstraintTeamSegmentWs[];
        yearLabel?: string | null;
        yearStart?: number | null;
        yearEnd?: number | null;
        nameLetter?: string | null;
        namePart?: "first" | "last" | "either" | null;
        player?: { id: number; name: string; image_url?: string | null } | null;
      } | null;
      pending_selection?: {
        host?: { id: number; name: string; image_url?: string | null } | null;
        guest?: { id: number; name: string; image_url?: string | null } | null;
      } | null;
      only_eligible?: boolean | null;
    }
  | { type: "lobby_update"; draft_id: number; connected: string[] }
  | { type: "draft_started"; draft_id: number; first_turn: string; status?: string }
  | {
      type: "pick_made";
      draft_id: number;
      draft_status?: string;
      pick_number: number;
      role: "host" | "guest";
      player_id: number;
      player_name: string;
      player_image_url?: string | null;
      constraint_team?: string | null;
      constraint_year?: string | null;
      next_turn: "host" | "guest";
    }
  | {
      type: "roll_started";
      draft_id: number;
      by_role: "host" | "guest";
      stage: "year" | "team" | "letter" | "player";
      year_label?: string;
    }
  | {
      type: "roll_stage_result";
      draft_id: number;
      by_role: "host" | "guest";
      stage: "year" | "team" | "letter" | "player";
      constraint: {
        teams: ConstraintTeamSegmentWs[];
        yearLabel?: string | null;
        yearStart?: number | null;
        yearEnd?: number | null;
        nameLetter?: string | null;
        namePart?: "first" | "last" | "either" | null;
        player?: { id: number; name: string; image_url?: string | null } | null;
      };
    }
  | {
      type: "roll_result";
      draft_id: number;
      by_role: "host" | "guest";
      constraint: {
        teams: ConstraintTeamSegmentWs[];
        yearLabel?: string | null;
        yearStart?: number | null;
        yearEnd?: number | null;
        nameLetter?: string | null;
        namePart?: "first" | "last" | "either" | null;
        player?: { id: number; name: string; image_url?: string | null } | null;
      };
    }
  | { type: "roll_error"; draft_id: number; message: string }
  | { type: "rerolls_updated"; draft_id: number; role: "host" | "guest"; remaining: number; max: number }
  | { type: "only_eligible_updated"; draft_id: number; value: boolean }
  | { type: "draft_name_updated"; draft_id: number; value: string }
  | {
      type: "pending_selection_updated";
      draft_id: number;
      role: "host" | "guest";
      player: { id: number; name: string; image_url?: string | null } | null;
    }
  | { type: "error"; message: string };

export function useDraftSocket(draftRef: string, role: "host" | "guest", enabled: boolean = true) {
  const [connectedRoles, setConnectedRoles] = useState<string[]>([]);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [firstTurn, setFirstTurn] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState<"host" | "guest" | null>(null);
  const [picks, setPicks] = useState<
    Array<{
      pick_number: number;
      role: "host" | "guest";
      player_id: number;
      player_name: string;
      player_image_url?: string | null;
      constraint_team?: string | null;
      constraint_year?: string | null;
    }>
  >([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rollStage, setRollStage] = useState<
    null | "idle" | "spinning_decade" | "spinning_team" | "spinning_letter" | "spinning_player"
  >(null);
  const [rollText, setRollText] = useState<string | null>(null);
  const [rollStageDecadeLabel, setRollStageDecadeLabel] = useState<string | null>(null);
  const [rollConstraint, setRollConstraint] = useState<{
    teams: ConstraintTeamSegmentWs[];
    yearLabel?: string | null;
    yearStart?: number | null;
    yearEnd?: number | null;
    nameLetter?: string | null;
    namePart?: "first" | "last" | "either" | null;
    player?: { id: number; name: string; image_url?: string | null } | null;
  } | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    host: { id: number; name: string; image_url?: string | null } | null;
    guest: { id: number; name: string; image_url?: string | null } | null;
  }>({ host: null, guest: null });
  const [onlyEligible, setOnlyEligible] = useState<boolean>(true);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [maxRerolls, setMaxRerolls] = useState<number>(0);
  const [rerollsRemaining, setRerollsRemaining] = useState<{ host: number; guest: number }>({ host: 0, guest: 0 });
  const [status, setStatus] = useState<"disabled" | "connecting" | "open" | "closed">(
    enabled ? "connecting" : "disabled",
  );
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef<boolean>(false);

  const wsUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";
    return `${base}/ws/draft/${encodeURIComponent(draftRef)}?role=${role}`;
  }, [draftRef, role]);

  useEffect(() => {
    if (!enabled) {
      shouldReconnectRef.current = false;
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      // Clear state so disabled sockets can't "win" over the active socket in the UI.
      /* eslint-disable react-hooks/set-state-in-effect */
      setConnectedRoles([]);
      setFirstTurn(null);
      setCurrentTurn(null);
      setPicks([]);
      setLastError(null);
      setRollStage(null);
      setRollText(null);
      setRollStageDecadeLabel(null);
      setRollConstraint(null);
      setPendingSelection({ host: null, guest: null });
      setOnlyEligible(true);
      setDraftName(null);
      setMaxRerolls(0);
      setRerollsRemaining({ host: 0, guest: 0 });
      /* eslint-enable react-hooks/set-state-in-effect */
      setStatus("disabled");
      return;
    }
    shouldReconnectRef.current = true;
    setLastError(null);
    setStatus("connecting");
    const connect = () => {
      if (!shouldReconnectRef.current) return;
      setStatus("connecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setLastError(null);
        setStatus("open");
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as DraftWsMessage;
          if (msg.type === "lobby_ready" || msg.type === "lobby_update") {
            setConnectedRoles(msg.connected);
            if (msg.type === "lobby_ready") {
              if (typeof msg.status === "string") {
                setDraftStatus(msg.status);
              }
              if (typeof msg.first_turn === "string") {
                setFirstTurn(msg.first_turn);
              }
              if (msg.current_turn === "host" || msg.current_turn === "guest") {
                setCurrentTurn(msg.current_turn);
              }
              if (msg.constraint) {
                setRollConstraint(msg.constraint);
              } else {
                setRollConstraint(null);
              }
              if (msg.pending_selection && typeof msg.pending_selection === "object") {
                setPendingSelection({
                  host: msg.pending_selection.host ?? null,
                  guest: msg.pending_selection.guest ?? null,
                });
              } else {
                setPendingSelection({ host: null, guest: null });
              }
              if (typeof msg.only_eligible === "boolean") {
                setOnlyEligible(msg.only_eligible);
              }
              if (typeof msg.draft_name === "string") {
                setDraftName(msg.draft_name);
              } else if (msg.draft_name === null) {
                setDraftName(null);
              }
              if (typeof msg.max_rerolls === "number") {
                setMaxRerolls(msg.max_rerolls);
              }
              if (msg.rerolls_remaining && typeof msg.rerolls_remaining === "object") {
                setRerollsRemaining({
                  host: typeof msg.rerolls_remaining.host === "number" ? msg.rerolls_remaining.host : 0,
                  guest: typeof msg.rerolls_remaining.guest === "number" ? msg.rerolls_remaining.guest : 0,
                });
              }
              if (Array.isArray(msg.picks)) {
                setPicks(
                  msg.picks
                    .map((p) => ({
                      pick_number: p.pick_number,
                      role: p.role,
                      player_id: p.player_id,
                      player_name: p.player_name,
                      player_image_url: p.player_image_url ?? null,
                      constraint_team: p.constraint_team ?? null,
                      constraint_year: p.constraint_year ?? null,
                    }))
                    .sort((a, b) => a.pick_number - b.pick_number),
                );
              }
            }
          } else if (msg.type === "draft_started") {
            setFirstTurn(msg.first_turn);
            setCurrentTurn(msg.first_turn as "host" | "guest");
            setDraftStatus(typeof msg.status === "string" ? msg.status : "drafting");
          } else if (msg.type === "error") {
            setLastError(msg.message);
          } else if (msg.type === "pick_made") {
            setPicks((prev) => [
              ...prev.filter((p) => p.pick_number !== msg.pick_number),
              {
                pick_number: msg.pick_number,
                role: msg.role,
                player_id: msg.player_id,
                player_name: msg.player_name,
                player_image_url: msg.player_image_url ?? null,
                constraint_team: msg.constraint_team ?? null,
                constraint_year: msg.constraint_year ?? null,
              },
            ].sort((a, b) => a.pick_number - b.pick_number));
            setCurrentTurn(msg.next_turn);
            if (typeof msg.draft_status === "string") {
              setDraftStatus(msg.draft_status);
            }
            // New turn => clear previous roll constraint.
            setRollConstraint(null);
            setRollStage(null);
            setRollText(null);
            setRollStageDecadeLabel(null);
            setPendingSelection((prev) => ({ ...prev, [msg.role]: null }));
          } else if (msg.type === "roll_started") {
            if (msg.stage === "year") {
              setRollStage("spinning_decade");
              setRollText("Spinning year…");
            } else if (msg.stage === "team") {
              setRollStage("spinning_team");
              setRollText(`Spinning team… (${msg.year_label ?? ""})`);
            } else if (msg.stage === "letter") {
              setRollStage("spinning_letter");
              setRollText("Spinning letter…");
            } else {
              setRollStage("spinning_player");
              setRollText("Spinning player…");
            }
          } else if (msg.type === "roll_stage_result") {
            // Persist partial constraint so previous stages "stick" in the UI.
            setRollConstraint(msg.constraint);
            if (typeof msg.constraint.yearLabel === "string") {
              setRollStageDecadeLabel(msg.constraint.yearLabel);
            }
          } else if (msg.type === "roll_result") {
            setRollStage("idle");
            setRollText(null);
            setRollStageDecadeLabel(null);
            setRollConstraint(msg.constraint);
          } else if (msg.type === "roll_error") {
            setRollStage("idle");
            setRollText(null);
            setRollStageDecadeLabel(null);
            setLastError(msg.message);
          } else if (msg.type === "rerolls_updated") {
            setMaxRerolls(msg.max);
            setRerollsRemaining((prev) => ({ ...prev, [msg.role]: msg.remaining }));
          } else if (msg.type === "only_eligible_updated") {
            setOnlyEligible(msg.value);
          } else if (msg.type === "draft_name_updated") {
            setDraftName(msg.value);
          } else if (msg.type === "pending_selection_updated") {
            setPendingSelection((prev) => ({ ...prev, [msg.role]: msg.player ?? null }));
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => setLastError("WebSocket error");
      ws.onclose = () => {
        setStatus("closed");
        if (!shouldReconnectRef.current) return;
        // auto-reconnect (helps in dev + during tab focus changes)
        retryTimerRef.current = window.setTimeout(connect, 500);
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [wsUrl, enabled]);

  function startDraft() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "start_draft" }));
  }

  function makePick(playerId: number, opts?: { constraint_team?: string | null; constraint_year?: string | null }) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(
      JSON.stringify({
        type: "make_pick",
        player_id: playerId,
        constraint_team: opts?.constraint_team ?? null,
        constraint_year: opts?.constraint_year ?? null,
      }),
    );
  }

  function roll() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "roll" }));
  }

  function forceReroll() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "force_reroll" }));
  }

  function undoPick() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "undo_pick" }));
  }

  function setOnlyEligiblePlayers(value: boolean) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "set_only_eligible", value }));
  }

  function setDraftNameValue(value: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "set_draft_name", value }));
  }

  function selectPlayerPreview(playerId: number | null) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({ type: "select_player", player_id: playerId }));
  }

  return {
    connectedRoles,
    draftStatus,
    firstTurn,
    currentTurn,
    picks,
    lastError,
    status,
    startDraft,
    makePick,
    roll,
    forceReroll,
    undoPick,
    rollStage,
    rollText,
    rollStageDecadeLabel,
    rollConstraint,
    pendingSelection,
    onlyEligible,
    setOnlyEligiblePlayers,
    draftName,
    setDraftNameValue,
    selectPlayerPreview,
    maxRerolls,
    rerollsRemaining,
  };
}


