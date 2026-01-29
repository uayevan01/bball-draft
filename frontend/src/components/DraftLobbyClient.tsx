"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { useDraftSocket } from "@/hooks/useDraftSocket";
import { backendGet, backendPost } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";
import type { DraftRules } from "@/lib/draftRules";
import { DraftLobbyHeader } from "@/components/draft-lobby/DraftLobbyHeader";
import { DraftSideColumn } from "@/components/draft-lobby/DraftSideColumn";
import { MainInfoCard } from "@/components/draft-lobby/MainInfoCard";
import { PickCard } from "@/components/draft-lobby/PickCard";
import { PlayerPickerPanel } from "@/components/draft-lobby/PlayerPickerPanel";
import type { DraftPickWs, PlayerDetail, RollConstraint, SpinPreviewTeam } from "@/components/draft-lobby/types";

export function DraftLobbyClient({ draftRef }: { draftRef: string }) {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const defaultLocal = searchParams.get("local") === "1";
  const [isLocal, setIsLocal] = useState<boolean>(defaultLocal);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [role] = useState<"host" | "guest">("host");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string>("");
  const [rules, setRules] = useState<DraftRules | null>(null);

  // Roll/constraint state comes from the websocket so both players see the same spinner + result.
  const [spinPreviewDecade, setSpinPreviewDecade] = useState<string | null>(null);
  const [spinPreviewTeam, setSpinPreviewTeam] = useState<SpinPreviewTeam | null>(null);

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
  const rollConstraint = stateSocket.rollConstraint as RollConstraint | null;
  const onlyEligible = stateSocket.onlyEligible;
  const draftName = stateSocket.draftName ?? draft?.name ?? null;

  const [draftNameEditing, setDraftNameEditing] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState("");

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

  function avatarUrl(side: "host" | "guest"): string | null {
    const u = side === "host" ? draft?.host : draft?.guest;
    return (u?.avatar_url ?? null) || null;
  }

  const hostPicks = picks.filter((p) => p.role === "host");
  const guestPicks = picks.filter((p) => p.role === "guest");

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

  function yearsActiveLabel(detail?: PlayerDetail): string {
    const stints = detail?.team_stints ?? [];
    const years = stints.sort((a, b) => a.start_year - b.start_year);
    if (!years.length) return "—";
    const minY = years[0];
    const maxY = years[years.length - 1];
    return `${minY.start_year}-${maxY.end_year || "Present"}`;
  }

  function isYourTurnForSide(side: "host" | "guest"): boolean {
    if (!currentTurn) return false;
    if (currentTurn !== side) return false;
    return isLocal || effectiveRole === side;
  }

  return (
    <div className="mt-6 grid gap-4">
      <DraftLobbyHeader
        draftName={draftName}
        canRename={isLocal || effectiveRole === "host"}
        isEditing={draftNameEditing}
        draftNameInput={draftNameInput}
        onChangeDraftNameInput={setDraftNameInput}
        onStartEdit={() => {
          setDraftNameInput(draftName || "");
          setDraftNameEditing(true);
        }}
        onCancelEdit={() => setDraftNameEditing(false)}
        onSaveDraftName={() => {
          const next = draftNameInput.trim();
          if (!next) return;
          host.setDraftNameValue(next);
          setDraftNameEditing(false);
        }}
        draftPathText={`/draft/${draft?.public_id ?? draftRef}`}
        connectedText={`Connected: ${connectedRoles.length ? connectedRoles.join(", ") : "(none)"}`}
        currentTurnText={`Turn: ${currentTurn ?? "—"}`}
        showInvite={!isLocal}
        copied={copied}
        inviteUrl={inviteUrl}
        onCopyInvite={async () => {
          const url = `${window.location.origin}/draft/${draft?.public_id ?? draftRef}`;
          setInviteUrl(url);
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        showStartDraft={!started && (isLocal || effectiveRole === "host")}
        startDraftDisabled={host.status !== "open"}
        onStartDraft={() => host.startDraft()}
      />

      {lastError || joinError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {lastError || joinError}
        </div>
      ) : null}

      {started ? (
        <MainInfoCard
          currentTurnName={currentTurn ? displayName(currentTurn) : "—"}
          isLocal={isLocal}
          infoMessage={infoMessage}
          needsConstraint={needsConstraint}
          canRoll={canPick}
          rollButtonLabel={rollConstraint ? "Reroll" : "Roll"}
          rollDisabled={isSpinning}
          onRoll={() => pickSocket.roll()}
          isSpinning={isSpinning}
          rollStage={rollStage}
          spinPreviewDecade={spinPreviewDecade}
          spinPreviewTeam={spinPreviewTeam}
          rollStageDecadeLabel={rollStageDecadeLabel}
          rollConstraint={rollConstraint}
        />
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
        <DraftSideColumn
          label="Host"
          name={displayName("host")}
          avatarUrl={avatarUrl("host")}
          isYourTurn={isYourTurnForSide("host")}
          picks={hostPicks as DraftPickWs[]}
          emptyText="No picks yet."
          renderPick={(p) => (
            <PickCard
              key={p.pick_number}
              pick={p}
              isExpanded={expandedPick === p.pick_number}
              detail={detailsByPlayerId[p.player_id]}
              loading={Boolean(detailsLoadingByPlayerId[p.player_id])}
              onToggle={() => setExpandedPick((prev) => (prev === p.pick_number ? null : p.pick_number))}
              onEnsureDetails={(pid) => void ensurePlayerDetails(pid)}
              yearsActiveLabel={yearsActiveLabel}
            />
          )}
        />

        <PlayerPickerPanel
          started={started}
          canPick={canPick}
          isSpinning={isSpinning}
          currentTurn={currentTurn}
          isLocal={isLocal}
          onlyEligible={onlyEligible}
          showOnlyEligibleToggle={needsConstraint && (isLocal || effectiveRole === "host")}
          onOnlyEligibleChange={(v) => host.setOnlyEligiblePlayers(v)}
          needsConstraint={needsConstraint}
          rollConstraint={rollConstraint}
          drafted={(pid) => draftedIds.has(pid)}
          canSearch={canSearch}
          searchError={null}
          onPickPlayer={(playerId) => {
            pickSocket.makePick(playerId, {
              constraint_team: rollConstraint?.team.abbreviation ?? rollConstraint?.team.name ?? null,
              constraint_year: rollConstraint?.decadeLabel ?? null,
            });
          }}
        />

        <DraftSideColumn
          label="Guest"
          name={displayName("guest")}
          avatarUrl={avatarUrl("guest")}
          isYourTurn={isYourTurnForSide("guest")}
          picks={guestPicks as DraftPickWs[]}
          emptyText="No picks yet."
          renderPick={(p) => (
            <PickCard
              key={p.pick_number}
              pick={p}
              isExpanded={expandedPick === p.pick_number}
              detail={detailsByPlayerId[p.player_id]}
              loading={Boolean(detailsLoadingByPlayerId[p.player_id])}
              onToggle={() => setExpandedPick((prev) => (prev === p.pick_number ? null : p.pick_number))}
              onEnsureDetails={(pid) => void ensurePlayerDetails(pid)}
              yearsActiveLabel={yearsActiveLabel}
            />
          )}
        />
      </div>
    </div>
  );
}


