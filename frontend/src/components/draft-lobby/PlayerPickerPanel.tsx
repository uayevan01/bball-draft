"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useAuth } from "@clerk/nextjs";

import { backendGet } from "@/lib/backendClient";

import type { EligibilityConstraint, PlayerDetail, PlayerSearchResult } from "./types";

export function PlayerPickerPanel({
  started,
  canPick,
  isSpinning,
  currentTurn,
  isLocal,
  onlyEligible,
  showOnlyEligibleToggle,
  onOnlyEligibleChange,
  constraint,
  pendingSelection,
  myRole,
  onPreviewPlayer,
  drafted,
  canSearch,
  searchError,
  onPickPlayer,
  playerSpinEnabled,
  onReroll,
  rerollsRemaining,
}: {
  started: boolean;
  canPick: boolean;
  isSpinning: boolean;
  currentTurn: "host" | "guest" | null;
  isLocal: boolean;
  onlyEligible: boolean;
  showOnlyEligibleToggle: boolean;
  onOnlyEligibleChange: (v: boolean) => void;
  constraint: EligibilityConstraint | null;
  pendingSelection: {
    host: { id: number; name: string; image_url?: string | null } | null;
    guest: { id: number; name: string; image_url?: string | null } | null;
  };
  myRole: "host" | "guest";
  onPreviewPlayer: (playerId: number | null) => void;
  drafted: (playerId: number) => boolean;
  canSearch: boolean;
  searchError: string | null;
  onPickPlayer: (playerId: number) => void;
  playerSpinEnabled: boolean;
  onReroll: () => void;
  rerollsRemaining: number;
}) {
  const { getToken } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searchErrorLocal, setSearchErrorLocal] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerSearchResult | null>(null);
  const [selectedEligibility, setSelectedEligibility] = useState<boolean | null>(null);
  const [selectedRetired, setSelectedRetired] = useState<boolean | null>(null);
  const detailsCacheRef = useRef<Record<number, PlayerDetail | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setSearchErrorLocal(null);
      const term = q.trim();
      if (!term || !canSearch) {
        setResults([]);
        return;
      }
      try {
        const params = new URLSearchParams();
        params.set("q", term);
        params.set("limit", "10");
        if (constraint && onlyEligible) {
          const ids = (constraint.teams ?? []).map((t) => t.team.id).filter((x) => Number.isFinite(x));
          if (ids.length === 1) params.set("stint_team_id", String(ids[0]));
          if (ids.length > 1) params.set("stint_team_ids", ids.join(","));
          if (constraint.yearStart != null && constraint.yearEnd != null) {
            params.set("stint_start_year", String(constraint.yearStart));
            params.set("stint_end_year", String(constraint.yearEnd));
          }
          if (constraint.nameLetter) {
            params.set("name_letters", String(constraint.nameLetter));
            params.set("name_part", String(constraint.namePart ?? "first"));
          }
          if (constraint.allowActive === false) params.set("include_active", "false");
          if (constraint.allowRetired === false) params.set("include_retired", "false");
          if (constraint.minTeamStints != null) params.set("min_team_stints", String(constraint.minTeamStints));
          if (constraint.maxTeamStints != null) params.set("max_team_stints", String(constraint.maxTeamStints));
        }
        const token = await getToken().catch(() => null);
        const data = await backendGet<PlayerSearchResult[]>(`/players?${params.toString()}`, token);
        if (!cancelled) setResults(data);
      } catch (e) {
        if (!cancelled) setSearchErrorLocal(e instanceof Error ? e.message : "Search failed");
      }
    }
    const t = window.setTimeout(run, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, canSearch, constraint, onlyEligible, getToken]);

  const placeholder = canSearch ? "Search player name…" : constraint ? "Search player name…" : "Waiting for constraint…";
  const errorToShow = searchErrorLocal || searchError;

  const otherRole = myRole === "host" ? "guest" : "host";
  const otherPending = pendingSelection?.[otherRole] ?? null;
  const myPending = pendingSelection?.[myRole] ?? null;

  const canTakeRolled = Boolean(started && canPick && !isSpinning && myPending && !drafted(myPending.id));
  const canRerollRolled = Boolean(started && canPick && !isSpinning && rerollsRemaining > 0);

  function matchesNameLetter(name: string, letter: string, part: "first" | "last" | "either") {
    const L = letter.trim().toUpperCase();
    if (!/^[A-Z]$/.test(L)) return true;
    const words = name.trim().split(/\s+/);
    const first = (words[0] ?? "").slice(0, 1).toUpperCase();
    const last = (words[1] ?? "").slice(0, 1).toUpperCase();
    if (part === "last") return last === L;
    if (part === "either") return first === L || last === L;
    return first === L;
  }

  // Eligibility check for "only eligible" OFF (we allow searching all players but gate confirm).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setSelectedEligibility(null);
      setSelectedRetired(null);
      if (!selected) return;
      if (drafted(selected.id)) {
        setSelectedEligibility(false);
        return;
      }
      if (!constraint) {
        setSelectedEligibility(true);
        return;
      }

      const allowActive = constraint.allowActive !== false;
      const allowRetired = constraint.allowRetired !== false;
      const needsRetiredCheck = !(allowActive && allowRetired);
      const needsStintCheck =
        !onlyEligible && Boolean(constraint) && (constraint.teams?.length || (constraint.yearStart != null && constraint.yearEnd != null));
      const needsStintCountCheck =
        !onlyEligible && Boolean(constraint) && (constraint.minTeamStints != null || constraint.maxTeamStints != null);

      // If we don't need any detail-based checks, we're done.
      if (!needsRetiredCheck && !needsStintCheck && !needsStintCountCheck) {
        setSelectedEligibility(true);
        return;
      }

      const cached = detailsCacheRef.current[selected.id];
      if (cached) {
        setSelectedRetired(cached.retirement_year != null);
        if (!onlyEligible) {
          let ok = true;
          if (needsStintCheck) {
            const teamIds = new Set((constraint.teams ?? []).map((t) => t.team.id));
            ok =
              ok &&
              (cached.team_stints ?? []).some(
                (s) =>
                  (teamIds.size === 0 || teamIds.has(s.team_id)) &&
                  (constraint.yearStart == null ||
                    constraint.yearEnd == null ||
                    (s.start_year <= constraint.yearEnd &&
                      (s.end_year ?? cached.retirement_year ?? 9999) >= constraint.yearStart)),
              );
          }
          if (needsStintCountCheck) {
            const c = cached.coalesced_team_stint_count;
            if (typeof c !== "number") {
              ok = false;
            } else {
              if (ok && constraint.minTeamStints != null) ok = c >= constraint.minTeamStints;
              if (ok && constraint.maxTeamStints != null) ok = c <= constraint.maxTeamStints;
            }
          }
          setSelectedEligibility(ok);
        } else {
          setSelectedEligibility(true);
        }
        return;
      }

      try {
        const token = await getToken().catch(() => null);
        const detail = await backendGet<PlayerDetail>(`/players/${selected.id}/details`, token);
        detailsCacheRef.current[selected.id] = detail;
        if (cancelled) return;
        setSelectedRetired(detail.retirement_year != null);
        if (!onlyEligible) {
          let ok = true;
          if (needsStintCheck) {
            const teamIds = new Set((constraint.teams ?? []).map((t) => t.team.id));
            ok =
              ok &&
              (detail.team_stints ?? []).some(
                (s) =>
                  (teamIds.size === 0 || teamIds.has(s.team_id)) &&
                  (constraint.yearStart == null ||
                    constraint.yearEnd == null ||
                    (s.start_year <= constraint.yearEnd &&
                      (s.end_year ?? detail.retirement_year ?? 9999) >= constraint.yearStart)),
              );
          }
          if (needsStintCountCheck) {
            const c = detail.coalesced_team_stint_count;
            if (typeof c !== "number") {
              ok = false;
            } else {
              if (ok && constraint.minTeamStints != null) ok = c >= constraint.minTeamStints;
              if (ok && constraint.maxTeamStints != null) ok = c <= constraint.maxTeamStints;
            }
          }
          setSelectedEligibility(ok);
        } else {
          setSelectedEligibility(true);
        }
      } catch {
        if (!cancelled) {
          setSelectedRetired(null);
          setSelectedEligibility(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [selected, drafted, constraint, onlyEligible, getToken]);

  const canConfirmPick = useMemo(() => {
    if (!started) return false;
    if (!selected) return false;
    if (!canPick) return false;
    if (isSpinning) return false;
    if (drafted(selected.id)) return false;
    // Constraint can be null when the draft type has no eligibility restrictions (no roll + any team/year/letter).
    // In that case, allow the pick.
    if (constraint) {
      const allowActive = constraint.allowActive !== false;
      const allowRetired = constraint.allowRetired !== false;
      if (!allowActive && !allowRetired) return false;
      if (!allowActive || !allowRetired) {
        // If pool is restricted and we don't know yet, block confirm until details arrive.
        if (selectedRetired == null) return false;
        if (!allowRetired && selectedRetired) return false;
        if (!allowActive && !selectedRetired) return false;
      }
    }
    if (constraint?.nameLetter) {
      const part = (constraint.namePart ?? "first") as "first" | "last" | "either";
      if (!matchesNameLetter(selected.name, constraint.nameLetter, part)) return false;
    }
    if (!onlyEligible && constraint) {
      return selectedEligibility === true;
    }
    return true;
  }, [started, selected, canPick, isSpinning, drafted, constraint, onlyEligible, selectedEligibility, selectedRetired]);

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
      {!started ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-300">Waiting for the draft to start. The host will start the draft.</div>
      ) : playerSpinEnabled ? (
        <>
          <div className="text-sm font-semibold">Your player</div>
          <div className="mt-3 grid gap-3">
            {!myPending ? (
              <div className="rounded-xl border border-black/10 bg-black/5 p-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
                Player Roll
              </div>
            ) : (
              <div className="rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Image
                      src={myPending.image_url ?? "/avatar-placeholder.svg"}
                      alt={myPending.name}
                      width={40}
                      height={40}
                      className="h-10 w-10 flex-none rounded-lg object-contain"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{myPending.name}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onReroll()}
                      disabled={!canRerollRolled}
                      className="h-10 whitespace-nowrap rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
                    >
                      Reroll
                    </button>
                    <button
                      type="button"
                      disabled={!canTakeRolled}
                      onClick={() => {
                        if (!myPending) return;
                        onPickPlayer(myPending.id);
                      }}
                      className="h-10 whitespace-nowrap rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                    >
                      Take
                    </button>
                  </div>
                </div>

                {!canPick && currentTurn ? (
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                    It’s {currentTurn}’s turn. {isLocal ? "Take will route automatically." : "Wait for your turn."}
                  </div>
                ) : null}

                {myPending && drafted(myPending.id) ? (
                  <div className="mt-2 text-xs text-red-700 dark:text-red-300">This player was already drafted. Please reroll.</div>
                ) : null}

                {rerollsRemaining <= 0 ? (
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">No rerolls remaining.</div>
                ) : null}
              </div>
            )}

            {otherPending ? (
              <div className="rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/10">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {otherRole === "host" ? "Host" : "Guest"} rolled…
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-3">
                  <Image
                    src={otherPending.image_url ?? "/avatar-placeholder.svg"}
                    alt={otherPending.name}
                    width={40}
                    height={40}
                    className="h-10 w-10 flex-none rounded-lg object-contain"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{otherPending.name}</div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Not confirmed yet</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
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
                      className="h-10 w-10 flex-none rounded-lg object-contain"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{selected.name}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        onPreviewPlayer(null);
                      }}
                      className="h-10 whitespace-nowrap rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      disabled={!canConfirmPick}
                      onClick={() => {
                        if (!selected) return;
                        onPickPlayer(selected.id);
                        onPreviewPlayer(null);
                        setSelected(null);
                        setQ("");
                        setResults([]);
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

                {!onlyEligible && constraint && selected ? (
                  <div className="mt-2 text-xs">
                    {selectedEligibility === null ? (
                      <span className="text-zinc-600 dark:text-zinc-300">Checking eligibility…</span>
                    ) : selectedEligibility ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        Eligible for{" "}
                        {(constraint.teams ?? []).map((t) => t.team.name).join(" / ") || "—"} • {constraint.yearLabel ?? "No constraint"}
                      </span>
                    ) : (
                      <span className="text-red-700 dark:text-red-300">
                        {drafted(selected.id)
                          ? "Can’t select this player — already drafted."
                          : `Can’t select this player — no stint found for ${
                              (constraint.teams ?? []).map((t) => t.team.name).join(" / ") || "those teams"
                            }${constraint.yearLabel ? ` during ${constraint.yearLabel}` : ""}.`}
                      </span>
                    )}
                  </div>
                ) : null}

                {constraint?.nameLetter && selected ? (
                  <div className="mt-2 text-xs">
                    {matchesNameLetter(
                      selected.name,
                      constraint.nameLetter,
                      (constraint.namePart ?? "first") as "first" | "last" | "either",
                    ) ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        Name matches: {(constraint.namePart ?? "first")} name starts with {constraint.nameLetter.toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-red-700 dark:text-red-300">
                        Name must match: {(constraint.namePart ?? "first")} name starts with {constraint.nameLetter.toUpperCase()}
                      </span>
                    )}
                  </div>
                ) : null}

                {constraint && selected && (constraint.allowActive === false || constraint.allowRetired === false) ? (
                  <div className="mt-2 text-xs">
                    {selectedRetired == null ? (
                      <span className="text-zinc-600 dark:text-zinc-300">Checking retired status…</span>
                    ) : (constraint.allowRetired === false && selectedRetired) || (constraint.allowActive === false && !selectedRetired) ? (
                      <span className="text-red-700 dark:text-red-300">
                        {constraint.allowRetired === false && selectedRetired
                          ? "Retired players are disabled for this draft type."
                          : "Active (unretired) players are disabled for this draft type."}
                      </span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {selectedRetired ? "Retired player allowed." : "Active player allowed."}
                      </span>
                    )}
                  </div>
                ) : null}

                {onlyEligible && selected && drafted(selected.id) ? (
                  <div className="mt-2 text-xs text-red-700 dark:text-red-300">Can’t select this player — already drafted.</div>
                ) : null}
              </div>
            ) : null}

            {!selected && otherPending ? (
              <div className="rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/10">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {otherRole === "host" ? "Host" : "Guest"} is selecting…
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-3">
                  <Image
                    src={otherPending.image_url ?? "/avatar-placeholder.svg"}
                    alt={otherPending.name}
                    width={40}
                    height={40}
                    className="h-10 w-10 flex-none rounded-lg object-contain"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{otherPending.name}</div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Preview only (not confirmed)</div>
                  </div>
                </div>
              </div>
            ) : null}

            {showOnlyEligibleToggle ? (
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={onlyEligible}
                  onChange={(e) => onOnlyEligibleChange(e.target.checked)}
                  className="h-4 w-4"
                />
                Only show eligible players
              </label>
            ) : null}

            <input
              className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-900/60"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              disabled={!canSearch}
            />
            {errorToShow ? <div className="text-sm text-red-700 dark:text-red-300">{errorToShow}</div> : null}

            <div className="grid gap-2">
              {results.slice(0, 8).map((p) => {
                const isDrafted = drafted(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canSearch || isDrafted || !canPick}
                    onClick={() => {
                      if (!canPick) return;
                      setSelected(p);
                      onPreviewPlayer(p.id);
                      // Clear search after selecting so the user can immediately confirm (or re-search cleanly).
                      setQ("");
                      setResults([]);
                    }}
                    className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-60 dark:border-white/10 dark:hover:bg-white/10"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Image
                        src={p.image_url ?? "/avatar-placeholder.svg"}
                        alt={p.name}
                        width={32}
                        height={32}
                        className="h-8 w-8 flex-none rounded-lg object-contain"
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {isDrafted ? "Drafted" : canPick ? "Select" : "Wait"}
                    </span>
                  </button>
                );
              })}
              {results.length === 0 && q.trim() ? <div className="text-sm text-zinc-600 dark:text-zinc-300">No results.</div> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


