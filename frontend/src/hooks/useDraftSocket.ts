"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DraftWsMessage =
  | {
      type: "lobby_ready";
      draft_id: number;
      connected: string[];
      started?: boolean;
      first_turn?: "host" | "guest" | null;
      current_turn?: "host" | "guest" | null;
      draft_name?: string | null;
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
        decadeLabel: string;
        decadeStart: number;
        decadeEnd: number;
        team: { id: number; name: string; abbreviation?: string | null; logo_url?: string | null };
      } | null;
      only_eligible?: boolean | null;
    }
  | { type: "lobby_update"; draft_id: number; connected: string[] }
  | { type: "draft_started"; draft_id: number; first_turn: string }
  | {
      type: "pick_made";
      draft_id: number;
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
      stage: "decade" | "team";
      decade_label?: string;
    }
  | {
      type: "roll_result";
      draft_id: number;
      by_role: "host" | "guest";
      decade_label: string;
      decade_start: number;
      decade_end: number;
      team: { id: number; name: string; abbreviation?: string | null; logo_url?: string | null };
    }
  | { type: "roll_error"; draft_id: number; message: string }
  | { type: "only_eligible_updated"; draft_id: number; value: boolean }
  | { type: "draft_name_updated"; draft_id: number; value: string }
  | { type: "error"; message: string };

export function useDraftSocket(draftRef: string, role: "host" | "guest", enabled: boolean = true) {
  const [connectedRoles, setConnectedRoles] = useState<string[]>([]);
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
  const [rollStage, setRollStage] = useState<null | "idle" | "spinning_decade" | "spinning_team">(null);
  const [rollText, setRollText] = useState<string | null>(null);
  const [rollStageDecadeLabel, setRollStageDecadeLabel] = useState<string | null>(null);
  const [rollConstraint, setRollConstraint] = useState<{
    decadeLabel: string;
    decadeStart: number;
    decadeEnd: number;
    team: { id: number; name: string; abbreviation?: string | null; logo_url?: string | null };
  } | null>(null);
  const [onlyEligible, setOnlyEligible] = useState<boolean>(true);
  const [draftName, setDraftName] = useState<string | null>(null);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnectedRoles([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFirstTurn(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentTurn(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPicks([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastError(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRollStage(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRollText(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRollStageDecadeLabel(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRollConstraint(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOnlyEligible(true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftName(null);
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
              if (typeof msg.only_eligible === "boolean") {
                setOnlyEligible(msg.only_eligible);
              }
              if (typeof msg.draft_name === "string") {
                setDraftName(msg.draft_name);
              } else if (msg.draft_name === null) {
                setDraftName(null);
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
            // New turn => clear previous roll constraint.
            setRollConstraint(null);
            setRollStage(null);
            setRollText(null);
            setRollStageDecadeLabel(null);
          } else if (msg.type === "roll_started") {
            if (msg.stage === "decade") {
              setRollStage("spinning_decade");
              setRollText("Spinning decade…");
              setRollStageDecadeLabel(null);
            } else {
              setRollStage("spinning_team");
              setRollText(`Spinning team… (${msg.decade_label ?? ""})`);
              setRollStageDecadeLabel(msg.decade_label ?? null);
            }
          } else if (msg.type === "roll_result") {
            setRollStage("idle");
            setRollText(null);
            setRollStageDecadeLabel(null);
            setRollConstraint({
              decadeLabel: msg.decade_label,
              decadeStart: msg.decade_start,
              decadeEnd: msg.decade_end,
              team: msg.team,
            });
          } else if (msg.type === "roll_error") {
            setRollStage("idle");
            setRollText(null);
            setRollStageDecadeLabel(null);
            setLastError(msg.message);
          } else if (msg.type === "only_eligible_updated") {
            setOnlyEligible(msg.value);
          } else if (msg.type === "draft_name_updated") {
            setDraftName(msg.value);
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

  return {
    connectedRoles,
    firstTurn,
    currentTurn,
    picks,
    lastError,
    status,
    startDraft,
    makePick,
    roll,
    rollStage,
    rollText,
    rollStageDecadeLabel,
    rollConstraint,
    onlyEligible,
    setOnlyEligiblePlayers,
    draftName,
    setDraftNameValue,
  };
}


