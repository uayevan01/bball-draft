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
  constraints,
  pendingSelection,
  myRole,
  onPreviewPlayer,
  drafted,
  canSearch,
  searchError,
  onPickPlayer,
  playerSpinEnabled,
}: {
  started: boolean;
  canPick: boolean;
  isSpinning: boolean;
  currentTurn: "host" | "guest" | null;
  isLocal: boolean;
  onlyEligible: boolean;
  showOnlyEligibleToggle: boolean;
  onOnlyEligibleChange: (v: boolean) => void;
  constraints: EligibilityConstraint[] | null;
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
}) {
  const { getToken } = useAuth();
  const constraint = constraints?.[0] ?? null;
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
        // Server-side filtering only supports a single constraint. With multiple options,
        // we fall back to client-side eligibility gating on confirm.
        if (constraints?.length === 1 && constraint && onlyEligible) {
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
  }, [q, canSearch, constraints, constraint, onlyEligible, getToken]);

  const placeholder = canSearch ? "Search player name…" : constraint ? "Search player name…" : "Waiting for constraint…";
  const errorToShow = searchErrorLocal || searchError;

  const otherRole = myRole === "host" ? "guest" : "host";
  const otherPending = pendingSelection?.[otherRole] ?? null;
  const rolledPlayers = useMemo(() => {
    if (!playerSpinEnabled) return [] as Array<{ id: number; name: string; image_url?: string | null }>;
    const out: Array<{ id: number; name: string; image_url?: string | null }> = [];
    for (const c of constraints ?? []) {
      const p = c?.player;
      if (p && typeof p.id === "number") out.push(p);
    }
    const seen = new Set<number>();
    return out.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [constraints, playerSpinEnabled]);

  const [selectedRolledId, setSelectedRolledId] = useState<number | null>(null);
  const selectedRolled = useMemo(() => {
    if (selectedRolledId == null) return null;
    return rolledPlayers.find((p) => p.id === selectedRolledId) ?? null;
  }, [rolledPlayers, selectedRolledId]);

  const canTakeRolled = Boolean(started && canPick && !isSpinning && selectedRolled && !drafted(selectedRolled.id));

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
      if (!constraints?.length) {
        setSelectedEligibility(true);
        return;
      }

      function eligibleForConstraint(detail: PlayerDetail, c: EligibilityConstraint): boolean {
        if (drafted(detail.id)) return false;
        const allowActive = c.allowActive !== false;
        const allowRetired = c.allowRetired !== false;
        if (!allowActive && !allowRetired) return false;
        const isRetired = detail.retirement_year != null;
        if (!allowRetired && isRetired) return false;
        if (!allowActive && !isRetired) return false;

        if (c.nameLetter) {
          const part = (c.namePart ?? "first") as "first" | "last" | "either";
          if (!matchesNameLetter(detail.name, c.nameLetter, part)) return false;
        }

        const needsStintCheck = Boolean((c.teams?.length ?? 0) || (c.yearStart != null && c.yearEnd != null));
        if (needsStintCheck) {
          const teamIds = new Set((c.teams ?? []).map((t) => t.team.id));
          const ok = (detail.team_stints ?? []).some(
            (s) =>
              (teamIds.size === 0 || teamIds.has(s.team_id)) &&
              (c.yearStart == null ||
                c.yearEnd == null ||
                (s.start_year <= c.yearEnd && (s.end_year ?? detail.retirement_year ?? 9999) >= c.yearStart)),
          );
          if (!ok) return false;
        }

        const ccount = detail.coalesced_team_stint_count;
        if ((c.minTeamStints != null || c.maxTeamStints != null) && typeof ccount !== "number") return false;
        if (c.minTeamStints != null && typeof ccount === "number" && ccount < c.minTeamStints) return false;
        if (c.maxTeamStints != null && typeof ccount === "number" && ccount > c.maxTeamStints) return false;
        return true;
      }

      const eligibleForAny = (detail: PlayerDetail) => (constraints ?? []).some((c) => eligibleForConstraint(detail, c));

      const cached = detailsCacheRef.current[selected.id];
      if (cached) {
        setSelectedRetired(cached.retirement_year != null);
        setSelectedEligibility(eligibleForAny(cached));
        return;
      }

      try {
        const token = await getToken().catch(() => null);
        const detail = await backendGet<PlayerDetail>(`/players/${selected.id}/details`, token);
        detailsCacheRef.current[selected.id] = detail;
        if (cancelled) return;
        setSelectedRetired(detail.retirement_year != null);
        setSelectedEligibility(eligibleForAny(detail));
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
  }, [selected, drafted, constraints, getToken]);

  const canConfirmPick = useMemo(() => {
    if (!started) return false;
    if (!selected) return false;
    if (!canPick) return false;
    if (isSpinning) return false;
    if (drafted(selected.id)) return false;
    if (constraints?.length) {
      return selectedEligibility === true;
    }
    return true;
  }, [started, selected, canPick, isSpinning, drafted, constraints, selectedEligibility]);

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
      {!started ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-300">Waiting for the draft to start. The host will start the draft.</div>
      ) : playerSpinEnabled ? (
        <>
          <div className="text-sm font-semibold">Your player</div>
          <div className="mt-3 grid gap-3">
            {!rolledPlayers.length ? (
              <div className="rounded-xl border border-black/10 bg-black/5 p-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-white/10 dark:text-zinc-200">
                Waiting for roll...
              </div>
            ) : (
              <div className="rounded-xl border border-black/10 bg-black/5 p-3 dark:border-white/10 dark:bg-white/10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Image
                      src={(selectedRolled?.image_url ?? null) ?? "/avatar-placeholder.svg"}
                      alt={selectedRolled?.name ?? "Player"}
                      width={40}
                      height={40}
                      className="h-10 w-10 flex-none rounded-lg object-contain"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{selectedRolled?.name ?? "Select a player below"}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      disabled={!canTakeRolled}
                      onClick={() => {
                        if (!selectedRolled) return;
                        onPickPlayer(selectedRolled.id);
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

                {selectedRolled && drafted(selectedRolled.id) ? (
                  <div className="mt-2 text-xs text-red-700 dark:text-red-300">This player was already drafted. Please reroll.</div>
                ) : null}
              </div>
            )}

            {rolledPlayers.length ? (
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Rolled players</div>
                <div className="grid gap-2">
                  {rolledPlayers.map((p) => {
                    const isDrafted = drafted(p.id);
                    const isSelected = selectedRolledId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!canPick || isSpinning}
                        onClick={() => {
                          setSelectedRolledId(p.id);
                          onPreviewPlayer(p.id);
                        }}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10 ${
                          isSelected ? "border-zinc-950 dark:border-white" : "border-black/10 dark:border-white/10"
                        }`}
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
                          {isDrafted ? "Drafted" : isSelected ? "Selected" : "Select"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

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


