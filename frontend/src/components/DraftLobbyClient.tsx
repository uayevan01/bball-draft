"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { useDraftSocket } from "@/hooks/useDraftSocket";
import { backendGet, backendPost } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";
import type { DraftRules } from "@/lib/draftRules";

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
  const [rules, setRules] = useState<DraftRules | null>(null);

  // Roll/constraint state comes from the websocket so both players see the same spinner + result.
  const [spinPreviewDecade, setSpinPreviewDecade] = useState<string | null>(null);
  const [spinPreviewTeam, setSpinPreviewTeam] = useState<{
    name: string;
    abbreviation?: string | null;
    logo_url?: string | null;
  } | null>(null);

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

  // Load draft rules (draft type) once draft is loaded.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!draft) return;
      try {
        const rulesFromDraft = (draft.draft_type?.rules ?? null) as DraftRules | null;
        if (!cancelled) setRules(rulesFromDraft);
      } catch {
        if (!cancelled) setRules(null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [draft]);

  const desiredRole = useMemo<"host" | "guest">(() => {
    if (isLocal) return "host";
    if (!draft || !myId) return "host";
    if (draft.host_id === myId) return "host";
    if (draft.guest_id === myId) return "guest";
    // if no guest yet, a non-host should become guest
    return "guest";
  }, [draft, isLocal, myId]);

  const effectiveRole = isLocal ? role : desiredRole;

  // Don't open a "host" socket while we still don't know who the current user is.
  // Otherwise a guest refresh can briefly connect as host and confuse the server + UI state.
  const multiplayerReady = Boolean(draft && myId);
  const host = useDraftSocket(draftRef, "host", isLocal || (multiplayerReady && effectiveRole === "host"));
  const guest = useDraftSocket(draftRef, "guest", isLocal || (multiplayerReady && effectiveRole === "guest"));

  // IMPORTANT: in multiplayer, only ONE socket should drive UI state (the active role).
  // If we merge state from both hooks, we can accidentally "win" with stale state from a disabled socket.
  const multiplayerSocket = effectiveRole === "host" ? host : guest;
  const stateSocket = isLocal
    ? host.firstTurn || host.currentTurn || host.picks.length
      ? host
      : guest
    : multiplayerSocket;

  const connectedRoles = isLocal
    ? Array.from(new Set([...(host.connectedRoles ?? []), ...(guest.connectedRoles ?? [])]))
    : stateSocket.connectedRoles ?? [];
  const firstTurn = stateSocket.firstTurn;
  const currentTurn = stateSocket.currentTurn;
  const picks = stateSocket.picks;
  const lastError = stateSocket.lastError;

  const started = Boolean(firstTurn);

  const canPick = isLocal || effectiveRole === currentTurn;
  const pickSocket = isLocal ? (currentTurn === "guest" ? guest : host) : effectiveRole === "guest" ? guest : host;

  const rollStage = stateSocket.rollStage;
  const rollStageDecadeLabel = stateSocket.rollStageDecadeLabel;
  const rollConstraint = stateSocket.rollConstraint;
  const onlyEligible = stateSocket.onlyEligible;

  const isSpinning = rollStage === "spinning_decade" || rollStage === "spinning_team";
  const needsConstraint = Boolean(rules?.spin_fields?.includes("year") || rules?.spin_fields?.includes("team"));
  const canSearch = Boolean(started && canPick && !isSpinning && (!needsConstraint || rollConstraint));

  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setJoinError(null);
      // Only try to claim the guest slot if it's actually empty.
      if (isLocal || effectiveRole !== "guest") return;
      if (!draft) return;
      if (draft.guest_id) return;
      if (myId && draft.host_id === myId) return;
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
  }, [draft, draftRef, effectiveRole, getToken, isLocal, myId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setSearchError(null);
      const term = q.trim();
      if (!term || !canSearch) {
        setResults([]);
        return;
      }
      try {
        const params = new URLSearchParams();
        params.set("q", term);
        params.set("limit", "10");
        if (rollConstraint && onlyEligible) {
          params.set("stint_team_id", String(rollConstraint.team.id));
          params.set("stint_start_year", String(rollConstraint.decadeStart));
          params.set("stint_end_year", String(rollConstraint.decadeEnd));
        }
        const data = await backendGet<Array<{ id: number; name: string; image_url?: string | null }>>(`/players?${params.toString()}`);
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
  }, [q, canSearch, rollConstraint, onlyEligible]);

  // Roll is handled by websocket so both players see the same spinner + result.
  useEffect(() => {
    if (!needsConstraint) return;
    if (!isSpinning) {
      setSpinPreviewDecade(null);
      setSpinPreviewTeam(null);
      return;
    }

    // Exponential slowdown (mirrors nba_draft.py ease_in_expo scheduling)
    function easeInExpo(t: number): number {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return 2 ** (10 * (t - 1));
    }
    function scheduleSpin<T>(
      opts: T[],
      setValue: (v: T) => void,
      totalMs: number,
      steps: number,
      cancelledRef: { cancelled: boolean },
    ) {
      const start = performance.now();
      const pickRandom = () => opts[Math.floor(Math.random() * opts.length)];
      const step = (i: number) => {
        if (cancelledRef.cancelled) return;
        if (i >= steps) return;
        const t = steps <= 1 ? 1 : i / (steps - 1);
        const progress = easeInExpo(t);
        const target = start + progress * totalMs;
        const delay = Math.max(0, target - performance.now());
        window.setTimeout(() => {
          if (cancelledRef.cancelled) return;
          setValue(pickRandom());
          step(i + 1);
        }, delay);
      };
      if (opts.length) step(0);
    }

    const cancelledRef = { cancelled: false };

    // Decade animation with exponential slowdown
    if (rollStage === "spinning_decade") {
      const decadeOptions =
        (rules?.year_constraint?.type === "decade" && rules?.year_constraint?.options?.length
          ? rules.year_constraint.options
          : ["1950-1959", "1960-1969", "1970-1979", "1980-1989", "1990-1999", "2000-2009", "2010-2019", "2020-2029"]) ?? [];
      scheduleSpin<string | null>(
        decadeOptions.map((x) => x ?? null),
        (v) => setSpinPreviewDecade(v),
        900,
        55,
        cancelledRef,
      );
    }

    // Team animation: fetch a pool for the decade and cycle quickly through it.
    let cancelled = false;
    async function startTeamSpin() {
      if (rollStage !== "spinning_team") return;
      const label = rollStageDecadeLabel ?? null;
      const m = label ? /^(\d{4})-(\d{4})$/.exec(label) : null;
      if (!m) return;
      const start = Number(m[1]);
      const end = Number(m[2]);
      try {
        const teams = await backendGet<
          Array<{
            id: number;
            name: string;
            abbreviation?: string | null;
            logo_url?: string | null;
            conference?: string | null;
            division?: string | null;
          }>
        >(`/teams?active_start_year=${start}&active_end_year=${end}&limit=500`);
        if (cancelled) return;

        let pool = teams;
        const tc = rules?.team_constraint;
        if (tc?.type === "conference" && tc.options?.length) {
          const allowed = new Set(tc.options.map((x) => String(x)));
          pool = pool.filter((t) => (t.conference ? allowed.has(t.conference) : false));
        } else if (tc?.type === "division" && tc.options?.length) {
          const allowed = new Set(tc.options.map((x) => String(x)));
          pool = pool.filter((t) => (t.division ? allowed.has(t.division) : false));
        } else if (tc?.type === "specific" && tc.options?.length) {
          const set = new Set(tc.options.map((x) => String(x).toUpperCase()));
          pool = pool.filter((t) => (t.abbreviation ? set.has(t.abbreviation.toUpperCase()) : false));
        }
        if (!pool.length) pool = teams;
        if (!pool.length) return;
        scheduleSpin(
          pool.map((pick) => ({
            name: pick.name,
            abbreviation: pick.abbreviation,
            logo_url: pick.logo_url,
          })),
          (v) => setSpinPreviewTeam(v),
          1500,
          60,
          cancelledRef,
        );
      } catch {
        // ignore animation fetch errors; final result still comes from server
      }
    }
    void startTeamSpin();

    return () => {
      cancelled = true;
      cancelledRef.cancelled = true;
    };
    // We intentionally depend on rollStage + isSpinning; preview updates are internal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsConstraint, isSpinning, rollStage]);

  // Show a short-lived "X has selected Y" message when a new pick is made.
  useEffect(() => {
    if (!picks.length) return;
    const last = [...picks].sort((a, b) => b.pick_number - a.pick_number)[0];
    if (!last) return;
    const picker = displayName(last.role);
    const msg = `${picker} has selected ${last.player_name}`;
    setInfoMessage(msg);
    const t = window.setTimeout(() => setInfoMessage(null), 4000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks.length]);

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
      team?: { id: number; name: string; abbreviation?: string | null; logo_url?: string | null } | null;
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
  const draftedIds = useMemo(() => new Set<number>(pickedPlayerIds), [pickedPlayerIds]);

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

  // When "only eligible" is OFF, we need details for the selected player to validate eligibility.
  useEffect(() => {
    if (!selected) return;
    if (!needsConstraint || !rollConstraint) return;
    if (onlyEligible) return;
    void ensurePlayerDetails(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, needsConstraint, rollConstraint?.team?.id, rollConstraint?.decadeLabel, onlyEligible]);

  const selectedEligibility = useMemo<null | boolean>(() => {
    if (!selected) return null;
    if (draftedIds.has(selected.id)) return false;
    if (!needsConstraint || !rollConstraint) return true;
    if (onlyEligible) return true;
    const detail = detailsByPlayerId[selected.id];
    if (!detail) return null;
    const stints = detail.team_stints ?? [];
    const teamId = rollConstraint.team.id;
    const start = rollConstraint.decadeStart;
    const end = rollConstraint.decadeEnd;
    return stints.some((s) => s.team_id === teamId && s.start_year <= end && (s.end_year ?? 9999) >= start);
  }, [selected, needsConstraint, rollConstraint, onlyEligible, detailsByPlayerId, draftedIds]);

  const canConfirmPick = Boolean(
    started &&
      selected &&
      !draftedIds.has(selected.id) &&
      canPick &&
      !isSpinning &&
      (!needsConstraint || rollConstraint) &&
      (onlyEligible || selectedEligibility === true),
  );

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
                <span>
                  Constraints:{" "}
                  {p.constraint_year || p.constraint_team ? (
                    <span className="text-zinc-950 dark:text-white">
                      {[p.constraint_year, p.constraint_team].filter(Boolean).join(" • ")}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
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
                          <span className="mr-2 inline-flex items-center gap-2 align-middle">
                            {s.team?.logo_url ? (
                              <Image
                                src={s.team.logo_url}
                                alt={s.team?.abbreviation ?? "Team logo"}
                                width={18}
                                height={18}
                                className="h-[18px] w-[18px] rounded-sm object-contain"
                              />
                            ) : null}
                            <span className="inline-flex items-center rounded-full border border-black/10 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-900 dark:border-white/10 dark:bg-zinc-900 dark:text-white">
                              {s.team?.abbreviation ?? "—"}
                            </span>
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

      {/* Main info box (roll + status). */}
      {started ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0 text-center md:text-left">
              <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Current turn</div>
              <div className="mt-1 text-sm font-semibold text-zinc-950 dark:text-white">
                {currentTurn ? displayName(currentTurn) : "—"}
                {isLocal ? <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">(local)</span> : null}
              </div>
              {infoMessage ? (
                <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">{infoMessage}</div>
              ) : null}
            </div>

            <div className="flex flex-none items-center justify-center gap-2 md:justify-end">
              {needsConstraint && canPick ? (
                <button
                  type="button"
                  onClick={() => pickSocket.roll()}
                  disabled={isSpinning}
                  className="h-10 rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  {rollConstraint ? "Reroll" : "Roll"}
                </button>
              ) : null}
              {!needsConstraint && canPick ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">No roll required for this draft type.</div>
              ) : null}
            </div>
          </div>

          {needsConstraint ? (
            <div className="mt-4 flex justify-center">
              <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-black/5 px-5 py-4 text-center dark:border-white/10 dark:bg-white/10">
                {isSpinning ? (
                  <div className="grid justify-items-center gap-2">
                    {rollStage === "spinning_team" && spinPreviewTeam?.logo_url ? (
                      <Image
                        src={spinPreviewTeam.logo_url}
                        alt={spinPreviewTeam.name}
                        width={64}
                        height={64}
                        className="h-16 w-16 rounded-xl object-contain"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-xl border border-black/10 bg-white/60 dark:border-white/10 dark:bg-zinc-900/60" />
                    )}
                    <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">
                      {rollStage === "spinning_decade" ? "SPINNING DECADE" : "SPINNING TEAM"}
                    </div>
                    <div className="text-lg font-semibold text-zinc-950 dark:text-white">
                      {rollStage === "spinning_decade"
                        ? spinPreviewDecade ?? "—"
                        : spinPreviewTeam?.name ?? "—"}
                    </div>
                    <div className="text-sm text-zinc-700 dark:text-zinc-200">
                      {rollStage === "spinning_team"
                        ? `(${rollStageDecadeLabel ?? "—"})`
                        : " "}
                    </div>
                  </div>
                ) : rollConstraint ? (
                  <div className="grid justify-items-center gap-2">
                    {rollConstraint.team.logo_url ? (
                      <Image
                        src={rollConstraint.team.logo_url}
                        alt={rollConstraint.team.name}
                        width={72}
                        height={72}
                        className="h-[72px] w-[72px] rounded-2xl object-contain"
                      />
                    ) : (
                      <div className="h-[72px] w-[72px] rounded-2xl border border-black/10 bg-white/60 dark:border-white/10 dark:bg-zinc-900/60" />
                    )}
                    <div className="text-xs font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">CONSTRAINT</div>
                    <div className="text-xl font-bold text-zinc-950 dark:text-white">{rollConstraint.team.name}</div>
                    <div className="text-base font-semibold text-zinc-700 dark:text-zinc-200">{rollConstraint.decadeLabel}</div>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-600 dark:text-zinc-300">Constraint: click Roll to spin decade + team.</div>
                )}
              </div>
            </div>
          ) : null}
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(null)}
                          className="h-10 whitespace-nowrap rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          disabled={!canConfirmPick}
                          onClick={() => {
                            if (!selected) return;
                            pickSocket.makePick(selected.id, {
                              constraint_team: rollConstraint?.team.abbreviation ?? rollConstraint?.team.name ?? null,
                              constraint_year: rollConstraint?.decadeLabel ?? null,
                            });
                            setSelected(null);
                          }}
                          className="h-10 whitespace-nowrap rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
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
                    {!onlyEligible && needsConstraint && rollConstraint && selected ? (
                      <div className="mt-2 text-xs">
                        {selectedEligibility === null ? (
                          <span className="text-zinc-600 dark:text-zinc-300">Checking eligibility…</span>
                        ) : selectedEligibility ? (
                          <span className="text-emerald-700 dark:text-emerald-300">
                            Eligible for {rollConstraint.decadeLabel} • {rollConstraint.team.name}
                          </span>
                        ) : (
                          <span className="text-red-700 dark:text-red-300">
                            {draftedIds.has(selected.id)
                              ? "Can’t select this player — already drafted."
                              : `Can’t select this player — no stint found for ${rollConstraint.team.name} during ${rollConstraint.decadeLabel}.`}
                          </span>
                        )}
                      </div>
                    ) : null}
                    {onlyEligible && selected && draftedIds.has(selected.id) ? (
                      <div className="mt-2 text-xs text-red-700 dark:text-red-300">Can’t select this player — already drafted.</div>
                    ) : null}
                  </div>
                ) : null}

                {needsConstraint && (isLocal || effectiveRole === "host") ? (
                  <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={onlyEligible}
                      onChange={(e) => host.setOnlyEligiblePlayers(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Only show eligible players
                  </label>
                ) : null}

                <input
                  className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-900/60"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={canSearch ? "Search player name…" : needsConstraint ? "Spin constraint to search…" : "Search player name…"}
                  disabled={!canSearch}
                />
                {searchError ? <div className="text-sm text-red-700 dark:text-red-300">{searchError}</div> : null}

                <div className="grid gap-2">
                  {results.map((p) => (
                    (() => {
                      const isDrafted = draftedIds.has(p.id);
                      return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!canSearch || isDrafted}
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
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{isDrafted ? "Drafted" : "Select"}</span>
                    </button>
                      );
                    })()
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


