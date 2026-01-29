"use client";

import Image from "next/image";

import type { PlayerSearchResult, RollConstraint } from "./types";

export function PlayerPickerPanel({
  started,
  selected,
  onClearSelected,
  onSelectResult,
  canConfirmPick,
  onConfirmPick,
  canPick,
  currentTurn,
  isLocal,
  onlyEligible,
  showOnlyEligibleToggle,
  onOnlyEligibleChange,
  needsConstraint,
  rollConstraint,
  selectedEligibility,
  drafted,
  q,
  onChangeQ,
  placeholder,
  canSearch,
  searchError,
  results,
}: {
  started: boolean;
  selected: PlayerSearchResult | null;
  onClearSelected: () => void;
  onSelectResult: (p: PlayerSearchResult) => void;
  canConfirmPick: boolean;
  onConfirmPick: () => void;
  canPick: boolean;
  currentTurn: "host" | "guest" | null;
  isLocal: boolean;
  onlyEligible: boolean;
  showOnlyEligibleToggle: boolean;
  onOnlyEligibleChange: (v: boolean) => void;
  needsConstraint: boolean;
  rollConstraint: RollConstraint | null;
  selectedEligibility: boolean | null;
  drafted: (playerId: number) => boolean;
  q: string;
  onChangeQ: (v: string) => void;
  placeholder: string;
  canSearch: boolean;
  searchError: string | null;
  results: PlayerSearchResult[];
}) {
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
                      className="h-10 w-10 flex-none rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{selected.name}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={onClearSelected}
                      className="h-10 whitespace-nowrap rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      disabled={!canConfirmPick}
                      onClick={onConfirmPick}
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
                        {drafted(selected.id)
                          ? "Can’t select this player — already drafted."
                          : `Can’t select this player — no stint found for ${rollConstraint.team.name} during ${rollConstraint.decadeLabel}.`}
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
              onChange={(e) => onChangeQ(e.target.value)}
              placeholder={placeholder}
              disabled={!canSearch}
            />
            {searchError ? <div className="text-sm text-red-700 dark:text-red-300">{searchError}</div> : null}

            <div className="grid gap-2">
              {results.map((p) => {
                const isDrafted = drafted(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canSearch || isDrafted}
                    onClick={() => onSelectResult(p)}
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
              })}
              {results.length === 0 && q.trim() ? <div className="text-sm text-zinc-600 dark:text-zinc-300">No results.</div> : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}


