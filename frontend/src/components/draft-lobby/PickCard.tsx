"use client";

import Image from "next/image";

import type { DraftPickWs, PlayerDetail } from "./types";

export function PickCard({
  slotNumber,
  pick,
  isExpanded,
  detail,
  loading,
  onToggle,
  onEnsureDetails,
  yearsActiveLabel,
}: {
  slotNumber: number;
  pick: DraftPickWs;
  isExpanded: boolean;
  detail: PlayerDetail | undefined;
  loading: boolean;
  onToggle: () => void;
  onEnsureDetails: (playerId: number) => void;
  yearsActiveLabel: (detail?: PlayerDetail) => string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onToggle();
        if (!isExpanded) onEnsureDetails(pick.player_id);
      }}
      className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-left text-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/80"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src={pick.player_image_url ?? "/avatar-placeholder.svg"}
            alt={pick.player_name}
            width={56}
            height={56}
            className="h-14 w-14 flex-none rounded-lg object-contain"
          />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              <span className="mr-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">#{slotNumber}</span>
              {pick.player_name}
              {detail?.position ? (
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">{detail.position}</span>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
              <span>
                (picked #{pick.pick_number} overall)
              </span>
              <span>Years active: {yearsActiveLabel(detail)}</span>
              <span>
                Constraints:{" "}
                {pick.constraint_year || pick.constraint_team ? (
                  <span className="text-zinc-950 dark:text-white">
                    {[pick.constraint_year, pick.constraint_team].filter(Boolean).join(" • ")}
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


