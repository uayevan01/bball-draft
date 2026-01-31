"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

import { useDraftSocket } from "@/hooks/useDraftSocket";
import { useTurnTabIndicator } from "@/hooks/useTurnTabIndicator";
import { backendGet, backendPost } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";
import type { DraftRules } from "@/lib/draftRules";
import { DraftLobbyHeader } from "@/components/draft-lobby/DraftLobbyHeader";
import { DraftSideColumn } from "@/components/draft-lobby/DraftSideColumn";
import { MainInfoCard } from "@/components/draft-lobby/MainInfoCard";
import { PickCard } from "@/components/draft-lobby/PickCard";
import { PlayerPickerPanel } from "@/components/draft-lobby/PlayerPickerPanel";
import type {
  ConstraintTeamSegment,
  DraftPickWs,
  EligibilityConstraint,
  PlayerDetail,
  SpinPreviewTeam,
  TeamLite,
} from "@/components/draft-lobby/types";

export function DraftLobbyClient({ draftRef }: { draftRef: string }) {
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const defaultLocal = searchParams.get("local") === "1";
  const isLocal = defaultLocal;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [role] = useState<"host" | "guest">("host");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rules, setRules] = useState<DraftRules | null>(null);
  const [staticTeams, setStaticTeams] = useState<TeamLite[]>([]);

  // Roll/constraint state comes from the websocket so both players see the same spinner + result.
  const [spinPreviewDecade, setSpinPreviewDecade] = useState<string | null>(null);
  const [spinPreviewTeam, setSpinPreviewTeam] = useState<SpinPreviewTeam | null>(null);
  const [spinPreviewLetter, setSpinPreviewLetter] = useState<string | null>(null);

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
  const rollConstraint = stateSocket.rollConstraint as EligibilityConstraint | null;
  const onlyEligible = stateSocket.onlyEligible;
  const draftName = stateSocket.draftName ?? draft?.name ?? null;
  const maxRerolls = (stateSocket as { maxRerolls?: number }).maxRerolls ?? 0;
  const rerollsRemaining =
    (stateSocket as { rerollsRemaining?: { host: number; guest: number } }).rerollsRemaining ?? ({ host: 0, guest: 0 } as const);
  const pendingSelection = stateSocket.pendingSelection as
    | { host: { id: number; name: string; image_url?: string | null } | null; guest: { id: number; name: string; image_url?: string | null } | null }
    | undefined;

  const [draftNameEditing, setDraftNameEditing] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState("");

  const isSpinning = rollStage === "spinning_decade" || rollStage === "spinning_team" || rollStage === "spinning_letter";
  const spinsYear = Boolean(rules?.spin_fields?.includes("year"));
  const spinsTeam = Boolean(rules?.spin_fields?.includes("team"));
  const spinsNameLetter = Boolean(rules?.spin_fields?.includes("name_letter"));
  const usesRoll = spinsYear || spinsTeam || spinsNameLetter;

  const staticTeamAbbrs = useMemo(() => {
    const tc = rules?.team_constraint;
    if (!tc || tc.type !== "specific") return null;
    const opts = tc.options ?? [];
    if (!opts.length) return null;
    return opts.map((x) => String(x).toUpperCase());
  }, [rules]);

  // Resolve a fixed team constraint (e.g. ["LAL"]) to a team row (id/name/logo) so we can filter eligibility.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setStaticTeams([]);
      if (!staticTeamAbbrs?.length) return;
      if (usesRoll) return;
      try {
        const token = await getToken().catch(() => null);
        const teams = await backendGet<Array<TeamLite & { abbreviation?: string | null }>>("/teams?limit=500", token);
        if (cancelled) return;
        const wanted = new Set(staticTeamAbbrs.map((x) => x.toUpperCase()));
        const hits = teams
          .filter((t) => (t.abbreviation ? wanted.has(t.abbreviation.toUpperCase()) : false))
          .sort((a, b) => String(a.abbreviation ?? "").localeCompare(String(b.abbreviation ?? "")));
        setStaticTeams(hits);
      } catch {
        if (!cancelled) setStaticTeams([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [staticTeamAbbrs, usesRoll, getToken]);

  const staticYear = useMemo(() => {
    const yc = rules?.year_constraint;
    if (!yc) return null;
    if (yc.type === "any") return { label: "Any year" as const, start: null as number | null, end: null as number | null };
    if (yc.type === "range") return { label: `${yc.options.startYear}-${yc.options.endYear}`, start: yc.options.startYear, end: yc.options.endYear };
    if (yc.type === "decade" && yc.options?.length === 1) {
      const label = yc.options[0];
      const m = /^(\d{4})-(\d{4})$/.exec(label);
      if (m) return { label, start: Number(m[1]), end: Number(m[2]) };
      return { label, start: null, end: null };
    }
    if (yc.type === "specific" && yc.options?.length === 1) {
      const y = yc.options[0];
      return { label: String(y), start: y, end: y };
    }
    // Multiple options without spin: treat as "any" for now (still eligible by team).
    return { label: "Any year" as const, start: null as number | null, end: null as number | null };
  }, [rules]);

  const staticNameLetter = useMemo(() => {
    const c = rules?.name_letter_constraint;
    if (!c || c.type !== "specific") return null;
    const opts = (c.options ?? []).map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]$/.test(x));
    if (opts.length !== 1) return null; // fixed single letter only
    return opts[0];
  }, [rules]);

  const staticNamePart = useMemo(() => {
    return (rules?.name_letter_part ?? "first") as "first" | "last" | "either";
  }, [rules]);

  const hasAnyConstraintRule = Boolean(
    usesRoll ||
      (rules?.team_constraint && rules.team_constraint.type !== "any") ||
      (rules?.year_constraint && rules.year_constraint.type !== "any") ||
      (rules?.name_letter_constraint && rules.name_letter_constraint.type !== "any"),
  );

  const eligibilityConstraint = useMemo<EligibilityConstraint | null>(() => {
    if (!started) return null;
    if (usesRoll) {
      if (!rollConstraint) return null;
      return rollConstraint;
    }
    if (staticTeams.length) {
      const segments: ConstraintTeamSegment[] = staticTeams.map((t) => ({ team: t }));
      return {
        teams: segments,
        yearLabel: staticYear?.label ?? "Any year",
        yearStart: staticYear?.start ?? null,
        yearEnd: staticYear?.end ?? null,
        nameLetter: staticNameLetter,
        namePart: staticNamePart,
      };
    }
    return null;
  }, [started, usesRoll, rollConstraint, staticTeams, staticYear, staticNameLetter, staticNamePart]);

  const constraintReady = !hasAnyConstraintRule || Boolean(eligibilityConstraint);
  // Searching should stay enabled even when it's not your turn; only selecting/confirming is gated by canPick.
  const canSearch = Boolean(started && !isSpinning && constraintReady);

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
    if (!usesRoll) return;
    if (!isSpinning) {
      setSpinPreviewDecade(null);
      setSpinPreviewTeam(null);
      setSpinPreviewLetter(null);
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

    // Letter animation: spin through the allowed letter pool.
    if (rollStage === "spinning_letter") {
      const poolRaw =
        rules?.name_letter_constraint?.type === "specific" && rules.name_letter_constraint.options?.length
          ? rules.name_letter_constraint.options
          : Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
      const pool = poolRaw.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]$/.test(x));
      scheduleSpin<string | null>(pool.map((x) => x ?? null), (v) => setSpinPreviewLetter(v), 900, 60, cancelledRef);
    }

    return () => {
      cancelled = true;
      cancelledRef.cancelled = true;
    };
    // We intentionally depend on rollStage + isSpinning; preview updates are internal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usesRoll, isSpinning, rollStage]);

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
  const picksPerPlayer = draft?.picks_per_player ?? 10;
  const wsStatus = (stateSocket as { draftStatus?: string | null }).draftStatus ?? null;
  const persistedStatus = wsStatus ?? draft?.status ?? null;
  const draftComplete =
    persistedStatus === "completed" ||
    // Back-compat safety-net: if a legacy draft is complete but status wasn't updated yet,
    // still show completion UI (server should auto-fix on load).
    (started && hostPicks.length >= picksPerPlayer && guestPicks.length >= picksPerPlayer);

  // Stop attention pings once the draft is complete.
  useTurnTabIndicator({
    enabled: !isLocal,
    isMyTurn: !draftComplete && Boolean(currentTurn && effectiveRole === currentTurn),
    label: "Your turn to pick",
  });

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
        currentTurnText={draftComplete ? "Draft complete" : `Turn: ${currentTurn ?? "—"}`}
        showInvite={!isLocal}
        copied={copied}
        draftId={String(draft?.public_id ?? draftRef)}
        onCopyDraftId={async () => {
          try {
            await navigator.clipboard.writeText(String(draft?.public_id ?? draftRef));
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
          draftComplete={draftComplete}
          showRollButton={usesRoll && !draftComplete}
          canRoll={canPick}
          rollButtonLabel={rollConstraint ? "Reroll" : "Roll"}
          rollDisabled={isSpinning}
          onRoll={() => pickSocket.roll()}
          rerollsDisplay={
            maxRerolls > 0
              ? {
                  // Rerolls should reflect the player whose turn it is (the only one allowed to click).
                  remaining: rerollsRemaining[(currentTurn ?? effectiveRole) as "host" | "guest"] ?? 0,
                  max: maxRerolls,
                }
              : null
          }
          showConstraint={hasAnyConstraintRule && !draftComplete}
          isSpinning={isSpinning}
          rollStage={rollStage}
          spinPreviewDecade={spinPreviewDecade}
          spinPreviewTeam={spinPreviewTeam}
          spinPreviewLetter={spinPreviewLetter}
          rollStageDecadeLabel={rollStageDecadeLabel}
          constraint={eligibilityConstraint}
        />
      ) : null}

      {!started ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-zinc-900/50">
          <div className="text-zinc-600 dark:text-zinc-300">
            You are: <span className="font-semibold text-zinc-950 dark:text-white">{effectiveRole}</span>
            {!isLocal ? <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">(auto)</span> : null}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            WS: host={host.status}, guest={guest.status}
          </div>
        </div>
      ) : null}

      <div className={`grid gap-4 ${draftComplete ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
        <DraftSideColumn
          label="Host"
          name={displayName("host")}
          avatarUrl={avatarUrl("host")}
          isYourTurn={!draftComplete && isYourTurnForSide("host")}
          picks={hostPicks as DraftPickWs[]}
          totalSlots={picksPerPlayer}
          renderPick={(p, slotNumber) => (
            <PickCard
              key={p.pick_number}
              slotNumber={slotNumber}
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

        {!draftComplete ? (
          <PlayerPickerPanel
            started={started}
            canPick={canPick}
            isSpinning={isSpinning}
            currentTurn={currentTurn}
            isLocal={isLocal}
            onlyEligible={onlyEligible}
            showOnlyEligibleToggle={hasAnyConstraintRule && (isLocal || effectiveRole === "host")}
            onOnlyEligibleChange={(v) => host.setOnlyEligiblePlayers(v)}
            constraint={eligibilityConstraint}
            pendingSelection={pendingSelection ?? { host: null, guest: null }}
            myRole={effectiveRole}
            onPreviewPlayer={(playerId) => pickSocket.selectPlayerPreview(playerId)}
            drafted={(pid) => draftedIds.has(pid)}
            canSearch={canSearch}
            searchError={null}
            onPickPlayer={(playerId) => {
              const teams = eligibilityConstraint?.teams ?? [];
              const teamLabel =
                teams.length === 0
                  ? null
                  : teams
                      .map((t) => t.team.abbreviation ?? t.team.name)
                      .filter(Boolean)
                      .join(",");
              pickSocket.makePick(playerId, {
                constraint_team: teamLabel,
                constraint_year: eligibilityConstraint?.yearLabel ?? null,
              });
            }}
          />
        ) : null}

        <DraftSideColumn
          label="Guest"
          name={displayName("guest")}
          avatarUrl={avatarUrl("guest")}
          isYourTurn={!draftComplete && isYourTurnForSide("guest")}
          picks={guestPicks as DraftPickWs[]}
          totalSlots={picksPerPlayer}
          renderPick={(p, slotNumber) => (
            <PickCard
              key={p.pick_number}
              slotNumber={slotNumber}
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


