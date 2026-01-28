"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { useDraftSocket } from "@/hooks/useDraftSocket";
import { backendGet, backendPost } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";

export function DraftLobbyClient({ draftId }: { draftId: number }) {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const defaultLocal = searchParams.get("local") === "1";
  const [isLocal, setIsLocal] = useState<boolean>(defaultLocal);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [role] = useState<"host" | "guest">("host");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: number; name: string }>>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Load backend user + draft so we can auto-assign roles for non-local lobbies.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const token = await getToken().catch(() => null);
        const me = await backendGet<{ id: string }>("/me", token);
        const d = await backendGet<Draft>(`/drafts/${draftId}`, token);
        if (!cancelled) {
          setMyId(me.id);
          setDraft(d);
        }
      } catch (e) {
        if (!cancelled) setJoinError(e instanceof Error ? e.message : "Failed to load draft/me");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [draftId, getToken]);

  const desiredRole = useMemo<"host" | "guest">(() => {
    if (isLocal) return "host";
    if (!draft || !myId) return "host";
    if (draft.host_id === myId) return "host";
    if (draft.guest_id === myId) return "guest";
    // if no guest yet, a non-host should become guest
    return "guest";
  }, [draft, isLocal, myId]);

  const effectiveRole = isLocal ? role : desiredRole;

  const host = useDraftSocket(draftId, "host", isLocal || effectiveRole === "host");
  const guest = useDraftSocket(draftId, "guest", isLocal || effectiveRole === "guest");

  const connectedRoles = Array.from(new Set([...(host.connectedRoles ?? []), ...(guest.connectedRoles ?? [])]));
  const firstTurn = host.firstTurn ?? guest.firstTurn;
  const currentTurn = host.currentTurn ?? guest.currentTurn;
  const picks = host.picks.length ? host.picks : guest.picks;
  const lastError = host.lastError ?? guest.lastError;

  const started = Boolean(firstTurn);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setJoinError(null);
      if (isLocal || effectiveRole !== "guest") return;
      try {
        const token = await getToken().catch(() => null);
        const updated = await backendPost<Draft>(`/drafts/${draftId}/join`, {}, token);
        setDraft(updated);
      } catch (e) {
        if (!cancelled) setJoinError(e instanceof Error ? e.message : "Failed to join draft");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [draftId, effectiveRole, getToken, isLocal]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setSearchError(null);
      const term = q.trim();
      if (!term) {
        setResults([]);
        return;
      }
      try {
        const data = await backendGet<Array<{ id: number; name: string }>>(`/players?q=${encodeURIComponent(term)}&limit=10`);
        if (!cancelled) setResults(data);
      } catch (e) {
        if (!cancelled) setSearchError(e instanceof Error ? e.message : "Search failed");
      }
    }
    const t = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const canPick = isLocal || effectiveRole === currentTurn;
  const pickSocket = isLocal ? (currentTurn === "guest" ? guest : host) : effectiveRole === "guest" ? guest : host;

  function displayName(side: "host" | "guest"): string {
    const u = side === "host" ? draft?.host : draft?.guest;
    if (!u) return side === "host" ? "Host" : "Guest";
    return u.username || u.email || u.clerk_id || u.id;
  }

  const hostPicks = picks.filter((p) => p.role === "host");
  const guestPicks = picks.filter((p) => p.role === "guest");

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-black">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{`/draft/${draftId}`}</div>
          <div className="text-zinc-600 dark:text-zinc-300">
            Connected: {connectedRoles.length ? connectedRoles.join(", ") : "(none)"}
          </div>
          <div className="text-zinc-600 dark:text-zinc-300">
            Turn: <span className="font-semibold text-zinc-950 dark:text-white">{currentTurn ?? "—"}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!started && (isLocal || effectiveRole === "host") ? (
            <button
              type="button"
              onClick={() => host.startDraft()}
              disabled={host.status !== "open"}
              className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              Start draft
            </button>
          ) : null}
        </div>
      </div>

      {lastError || joinError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {lastError || joinError}
        </div>
      ) : null}

      {!started ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isLocal} onChange={(e) => setIsLocal(e.target.checked)} />
            Local 2-player mode (host + guest on this device)
          </label>
          <div className="text-zinc-600 dark:text-zinc-300">
            You are: <span className="font-semibold text-zinc-950 dark:text-white">{effectiveRole}</span>
            {!isLocal ? <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">(auto)</span> : null}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            WS: host={host.status}, guest={guest.status}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold">{displayName("host")}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Host</div>
          </div>
          <div className="mt-3 grid gap-2">
            {hostPicks.length ? (
              hostPicks.map((p) => (
                <div
                  key={p.pick_number}
                  className="rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10"
                >
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">#{p.pick_number}</span> {p.player_name}
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">No picks yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
          {!started ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Waiting for the draft to start. The host will start the draft.
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold">Pick a player</div>
              <div className="mt-3 grid gap-2">
                <input
                  className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-black"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search player name…"
                />
                {searchError ? <div className="text-sm text-red-700 dark:text-red-300">{searchError}</div> : null}
                <div className="grid gap-2">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!canPick}
                      onClick={() => pickSocket.makePick(p.id)}
                      className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                    >
                      <span>{p.name}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">#{p.id}</span>
                    </button>
                  ))}
                  {results.length === 0 && q.trim() ? (
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">No results.</div>
                  ) : null}
                </div>
                {!canPick && currentTurn ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    It’s {currentTurn}’s turn.
                    {isLocal ? " Pick will route automatically." : " Wait for your turn."}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold">{displayName("guest")}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Guest</div>
          </div>
          <div className="mt-3 grid gap-2">
            {guestPicks.length ? (
              guestPicks.map((p) => (
                <div
                  key={p.pick_number}
                  className="rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10"
                >
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">#{p.pick_number}</span> {p.player_name}
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">No picks yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


