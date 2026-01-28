"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { useDraftSocket } from "@/hooks/useDraftSocket";
import { backendGet, backendPost } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";

export function DraftLobbyClient({ draftRef }: { draftRef: string }) {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const defaultLocal = searchParams.get("local") === "1";
  const [isLocal, setIsLocal] = useState<boolean>(defaultLocal);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [role] = useState<"host" | "guest">("host");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: number; name: string; image_url?: string | null }>>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: number; name: string; image_url?: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string>("");

  // Load backend user + draft so we can auto-assign roles for non-local lobbies.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const token = await getToken().catch(() => null);
        const me = await backendGet<{ id: string }>("/me", token);
        const d = await backendGet<Draft>(`/drafts/${encodeURIComponent(draftRef)}`, token);
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
  }, [draftRef, getToken]);

  const desiredRole = useMemo<"host" | "guest">(() => {
    if (isLocal) return "host";
    if (!draft || !myId) return "host";
    if (draft.host_id === myId) return "host";
    if (draft.guest_id === myId) return "guest";
    // if no guest yet, a non-host should become guest
    return "guest";
  }, [draft, isLocal, myId]);

  const effectiveRole = isLocal ? role : desiredRole;

  const host = useDraftSocket(draftRef, "host", isLocal || effectiveRole === "host");
  const guest = useDraftSocket(draftRef, "guest", isLocal || effectiveRole === "guest");

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
        const updated = await backendPost<Draft>(`/drafts/${encodeURIComponent(draftRef)}/join`, {}, token);
        setDraft(updated);
      } catch (e) {
        if (!cancelled) setJoinError(e instanceof Error ? e.message : "Failed to join draft");
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [draftRef, effectiveRole, getToken, isLocal]);

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
        const data = await backendGet<Array<{ id: number; name: string; image_url?: string | null }>>(
          `/players?q=${encodeURIComponent(term)}&limit=10`,
        );
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

  const canConfirmPick = Boolean(started && selected && canPick);

  function displayName(side: "host" | "guest"): string {
    const u = side === "host" ? draft?.host : draft?.guest;
    if (!u) return side === "host" ? "Host" : "Guest";
    return u.username || u.email || u.clerk_id || u.id;
  }

  const hostPicks = picks.filter((p) => p.role === "host");
  const guestPicks = picks.filter((p) => p.role === "guest");

  type PlayerDetail = {
    id: number;
    name: string;
    image_url?: string | null;
    position?: string | null;
    team_stints?: Array<{
      id: number;
      team_id: number;
      start_year: number;
      end_year?: number | null;
      team?: { id: number; name: string; abbreviation?: string | null } | null;
    }>;
  };

  const [expandedPick, setExpandedPick] = useState<number | null>(null);
  const [detailsByPlayerId, setDetailsByPlayerId] = useState<Record<number, PlayerDetail | undefined>>({});
  const [detailsLoadingByPlayerId, setDetailsLoadingByPlayerId] = useState<Record<number, boolean | undefined>>({});

  const pickedPlayerIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of picks) ids.add(p.player_id);
    return Array.from(ids.values());
  }, [picks]);

  async function ensurePlayerDetails(playerId: number) {
    if (detailsByPlayerId[playerId]) return;
    if (detailsLoadingByPlayerId[playerId]) return;
    setDetailsLoadingByPlayerId((prev) => ({ ...prev, [playerId]: true }));
    try {
      const token = await getToken().catch(() => null);
      const d = await backendGet<PlayerDetail>(`/players/${playerId}/details`, token);
      setDetailsByPlayerId((prev) => ({ ...prev, [playerId]: d }));
    } catch {
      // ignore (expanded UI will show "no details")
    } finally {
      setDetailsLoadingByPlayerId((prev) => ({ ...prev, [playerId]: false }));
    }
  }

  // Prefetch details for drafted players so "Years active" populates without needing to expand.
  useEffect(() => {
    for (const pid of pickedPlayerIds) {
      void ensurePlayerDetails(pid);
    }
    // ensurePlayerDetails is stable enough here; we intentionally avoid adding it to deps to prevent ref churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedPlayerIds]);

  function yearsActiveLabel(detail?: PlayerDetail): string {
    const stints = detail?.team_stints ?? [];
    const years = stints.sort((a, b) => a.start_year - b.start_year);
    if (!years.length) return "—";
    const minY = years[0];
    const maxY = years[years.length - 1];
    return `${minY.start_year}-${maxY.end_year || "Present"}`;
  }

  function PickCard({ p }: { p: (typeof picks)[number] }) {
    const isExpanded = expandedPick === p.pick_number;
    const detail = detailsByPlayerId[p.player_id];
    const loading = Boolean(detailsLoadingByPlayerId[p.player_id]);

    return (
      <button
        type="button"
        onClick={() => {
          const next = isExpanded ? null : p.pick_number;
          setExpandedPick(next);
          if (!isExpanded) void ensurePlayerDetails(p.player_id);
        }}
        className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-left text-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/80"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src={p.player_image_url ?? "/avatar-placeholder.svg"}
              alt={p.player_name}
              width={36}
              height={36}
              className="h-14 w-12 flex-none rounded-full object-cover"
            />
            <div className="min-w-0">
              <div className="truncate font-semibold">
                <span className="mr-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">#{p.pick_number}</span>
                {p.player_name}
                {detail?.position ? <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">{detail.position}</span> : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                <span>Years active: {yearsActiveLabel(detail)}</span>
                <span>Constraints: —</span>
              </div>
            </div>
          </div>
          <div className="flex-none text-xs text-zinc-500 dark:text-zinc-400">{isExpanded ? "Hide" : "Details"}</div>
        </div>

        {isExpanded ? (
          <div className="mt-3 rounded-lg border border-black/10 bg-black/5 p-3 text-xs dark:border-white/10 dark:bg-white/10">
            {loading ? (
              <div className="text-zinc-600 dark:text-zinc-300">Loading player history…</div>
            ) : detail?.team_stints?.length ? (
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Team history</div>
                <div className="grid gap-1">
                  {detail.team_stints
                    .slice()
                    .sort((a, b) => a.start_year - b.start_year)
                    .map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate">
                          <span className="mr-2 inline-flex items-center rounded-full border border-black/10 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-white">
                            {s.team?.abbreviation ?? "—"}
                          </span>
                          <span className="text-zinc-700 dark:text-zinc-200">{s.team?.name ?? "Unknown team"}</span>
                        </div>
                        <div className="flex-none tabular-nums text-zinc-600 dark:text-zinc-300">
                          {s.start_year}–{s.end_year ?? "Present"}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="text-zinc-600 dark:text-zinc-300">
                No team history found yet. (This will populate as stints finish scraping.)
              </div>
            )}
          </div>
        ) : null}
      </button>
    );
  }

  function isYourTurnForSide(side: "host" | "guest"): boolean {
    if (!currentTurn) return false;
    if (currentTurn !== side) return false;
    return isLocal || effectiveRole === side;
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-900/50">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{`/draft/${draft?.public_id ?? draftRef}`}</div>
          <div className="text-zinc-600 dark:text-zinc-300">
            Connected: {connectedRoles.length ? connectedRoles.join(", ") : "(none)"}
          </div>
          <div className="text-zinc-600 dark:text-zinc-300">
            Turn: <span className="font-semibold text-zinc-950 dark:text-white">{currentTurn ?? "—"}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!isLocal ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  const url = `${window.location.origin}/draft/${draft?.public_id ?? draftRef}`;
                  setInviteUrl(url);
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  } catch {
                    // If clipboard is blocked, at least show the URL.
                    setCopied(false);
                  }
                }}
                className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
              >
                {copied ? "Copied!" : "Copy invite link"}
              </button>
              {inviteUrl ? (
                <input
                  readOnly
                  value={inviteUrl}
                  className="hidden h-10 w-[360px] rounded-full border border-black/10 bg-white px-4 text-xs text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200 md:block"
                />
              ) : null}
            </>
          ) : null}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-zinc-900/50">
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
        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>{displayName("host")}</span>
              {isYourTurnForSide("host") ? (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                  YOUR TURN
                </span>
              ) : null}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Host</div>
          </div>
          <div className="mt-3 grid gap-2">
            {hostPicks.length ? (
              hostPicks.map((p) => (
                <PickCard key={p.pick_number} p={p} />
              ))
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">No picks yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
          {!started ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Waiting for the draft to start. The host will start the draft.
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold">Pick a player</div>
              <div className="mt-3 grid gap-3">
                {selected ? (
                  <div className="rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/10">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Image
                          src={selected.image_url ?? "/avatar-placeholder.svg"}
                          alt={selected.name}
                          width={40}
                          height={40}
                          className="h-10 w-10 flex-none rounded-full object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{selected.name}</div>
                        </div>
                      </div>
                      <div className="flex flex-none items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(null)}
                          className="h-10 rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          disabled={!canConfirmPick}
                          onClick={() => {
                            if (!selected) return;
                            pickSocket.makePick(selected.id);
                            setSelected(null);
                          }}
                          className="h-10 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                        >
                          Confirm pick
                        </button>
                      </div>
                    </div>
                    {!canPick && currentTurn ? (
                      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                        It’s {currentTurn}’s turn. {isLocal ? "Pick will route automatically." : "Wait for your turn."}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <input
                  className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-900/60"
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
                      onClick={() => setSelected(p)}
                      className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Image
                          src={p.image_url ?? "/avatar-placeholder.svg"}
                          alt={p.name}
                          width={32}
                          height={32}
                          className="h-8 w-8 flex-none rounded-full object-cover"
                        />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Select</span>
                    </button>
                  ))}
                  {results.length === 0 && q.trim() ? (
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">No results.</div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>{displayName("guest")}</span>
              {isYourTurnForSide("guest") ? (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                  YOUR TURN
                </span>
              ) : null}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Guest</div>
          </div>
          <div className="mt-3 grid gap-2">
            {guestPicks.length ? (
              guestPicks.map((p) => (
                <PickCard key={p.pick_number} p={p} />
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


