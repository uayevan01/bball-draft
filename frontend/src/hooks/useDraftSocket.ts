"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DraftWsMessage =
  | { type: "lobby_ready"; draft_id: number; connected: string[] }
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
      next_turn: "host" | "guest";
    }
  | { type: "error"; message: string };

export function useDraftSocket(draftId: number, role: "host" | "guest", enabled: boolean = true) {
  const [connectedRoles, setConnectedRoles] = useState<string[]>([]);
  const [firstTurn, setFirstTurn] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState<"host" | "guest" | null>(null);
  const [picks, setPicks] = useState<
    Array<{ pick_number: number; role: "host" | "guest"; player_id: number; player_name: string; player_image_url?: string | null }>
  >([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [status, setStatus] = useState<"disabled" | "connecting" | "open" | "closed">(
    enabled ? "connecting" : "disabled",
  );
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef<boolean>(false);

  const wsUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_WS_BASE_URL ?? "ws://localhost:8000";
    return `${base}/ws/draft/${draftId}?role=${role}`;
  }, [draftId, role]);

  useEffect(() => {
    if (!enabled) {
      shouldReconnectRef.current = false;
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConnectedRoles([]);
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
              },
            ].sort((a, b) => a.pick_number - b.pick_number));
            setCurrentTurn(msg.next_turn);
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

  function makePick(playerId: number) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setLastError("WebSocket closed");
      return;
    }
    ws.send(JSON.stringify({ type: "make_pick", player_id: playerId }));
  }

  return { connectedRoles, firstTurn, currentTurn, picks, lastError, status, startDraft, makePick };
}


