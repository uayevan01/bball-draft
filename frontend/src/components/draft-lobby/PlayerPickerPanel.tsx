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
  drafted,
  canSearch,
  searchError,
  onPickPlayer,
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
  drafted: (playerId: number) => boolean;
  canSearch: boolean;
  searchError: string | null;
  onPickPlayer: (playerId: number) => void;
}) {
  const { getToken } = useAuth();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searchErrorLocal, setSearchErrorLocal] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerSearchResult | null>(null);
  const [selectedEligibility, setSelectedEligibility] = useState<boolean | null>(null);
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

  // Eligibility check for "only eligible" OFF (we allow searching all players but gate confirm).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      setSelectedEligibility(null);
      if (!selected) return;
      if (drafted(selected.id)) {
        setSelectedEligibility(false);
        return;
      }
      if (!constraint) {
        setSelectedEligibility(true);
        return;
      }
      if (onlyEligible) {
        setSelectedEligibility(true);
        return;
      }

      const teamIds = new Set((constraint.teams ?? []).map((t) => t.team.id));
      const cached = detailsCacheRef.current[selected.id];
      if (cached) {
        const ok = (cached.team_stints ?? []).some(
          (s) =>
            teamIds.has(s.team_id) &&
            (constraint.yearStart == null ||
              constraint.yearEnd == null ||
              (s.start_year <= constraint.yearEnd && (s.end_year ?? 9999) >= constraint.yearStart)),
        );
        setSelectedEligibility(ok);
        return;
      }

      try {
        const token = await getToken().catch(() => null);
        const detail = await backendGet<PlayerDetail>(`/players/${selected.id}/details`, token);
        detailsCacheRef.current[selected.id] = detail;
        if (cancelled) return;
        const ok = (detail.team_stints ?? []).some(
          (s) =>
            teamIds.has(s.team_id) &&
            (constraint.yearStart == null ||
              constraint.yearEnd == null ||
              (s.start_year <= constraint.yearEnd && (s.end_year ?? 9999) >= constraint.yearStart)),
        );
        setSelectedEligibility(ok);
      } catch {
        if (!cancelled) setSelectedEligibility(false);
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
    if (!constraint) return false;
    if (!onlyEligible && constraint) {
      return selectedEligibility === true;
    }
    return true;
  }, [started, selected, canPick, isSpinning, drafted, constraint, onlyEligible, selectedEligibility]);

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/50">
      {!started ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-300">Waiting for the draft to start. The host will start the draft.</div>
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
                        onPickPlayer(selected.id);
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

                {!onlyEligible && constraint && selected ? (
                  <div className="mt-2 text-xs">
                    {selectedEligibility === null ? (
                      <span className="text-zinc-600 dark:text-zinc-300">Checking eligibility…</span>
                    ) : selectedEligibility ? (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        Eligible for{" "}
                        {(constraint.teams ?? []).map((t) => t.team.name).join(" / ") || "—"} • {constraint.yearLabel ?? "Any year"}
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

                {onlyEligible && selected && drafted(selected.id) ? (
                  <div className="mt-2 text-xs text-red-700 dark:text-red-300">Can’t select this player — already drafted.</div>
                ) : null}
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
              {results.map((p) => {
                const isDrafted = drafted(p.id);
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
                        className="h-8 w-8 flex-none rounded-lg object-contain"
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{isDrafted ? "Drafted" : "Select"}</span>
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


