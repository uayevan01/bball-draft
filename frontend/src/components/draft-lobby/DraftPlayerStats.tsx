"use client";

import Link from "next/link";

import type { PlayerAward, PlayerAwardCounts, PlayerCareerStats, PlayerSeasonStatsResponse } from "@/lib/playerTypes";

const CAREER_STAT_FIELDS: Array<{ key: keyof PlayerCareerStats; label: string }> = [
  { key: "pts", label: "PTS" },
  { key: "trb", label: "REB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
];

export function countingTotalsFromAggregate(
  totals: PlayerSeasonStatsResponse["totals"] | null | undefined,
): PlayerCareerStats | null {
  if (!totals?.games) return null;
  return {
    pts: totals.pts ?? null,
    trb: totals.trb ?? null,
    ast: totals.ast ?? null,
    stl: totals.stl ?? null,
    blk: totals.blk ?? null,
    games: totals.games ?? null,
  };
}

function formatPerGame(total: number | null | undefined, games: number | null | undefined): string {
  if (total == null || games == null || games <= 0) return "—";
  return (total / games).toFixed(1);
}

export function awardCountsFromRows(rows: PlayerAward[]): PlayerAwardCounts {
  let allStar = 0;
  let allNba1 = 0;
  let allNba2 = 0;
  let allNba3 = 0;
  let mvp = 0;
  let championship = 0;
  let finalsMvp = 0;
  for (const row of rows) {
    switch (row.award?.slug) {
      case "all_star":
        allStar += 1;
        break;
      case "all_nba_1":
        allNba1 += 1;
        break;
      case "all_nba_2":
        allNba2 += 1;
        break;
      case "all_nba_3":
        allNba3 += 1;
        break;
      case "mvp":
        mvp += 1;
        break;
      case "championship":
        championship += 1;
        break;
      case "finals_mvp":
        finalsMvp += 1;
        break;
      default:
        break;
    }
  }
  return {
    all_star: allStar,
    all_nba: allNba1 + allNba2 + allNba3,
    all_nba_1: allNba1,
    all_nba_2: allNba2,
    all_nba_3: allNba3,
    mvp,
    championship,
    finals_mvp: finalsMvp,
  };
}

export function CareerStatLine({ stats }: { stats?: PlayerCareerStats | null }) {
  const games = stats?.games;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
      {CAREER_STAT_FIELDS.map((field) => (
        <span key={field.key}>
          <span className="font-semibold">{formatPerGame(stats?.[field.key], games)}</span>{" "}
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{field.label}</span>
        </span>
      ))}
    </span>
  );
}

export function AccoladeChips({
  counts,
  hallOfFame,
}: {
  counts?: PlayerAwardCounts | null;
  hallOfFame?: boolean;
}) {
  const chips: string[] = [];
  if (hallOfFame) chips.push("Hall of Fame");
  if (counts?.championship) chips.push(`${counts.championship}× Title${counts.championship === 1 ? "" : "s"}`);
  if (counts?.mvp) chips.push(`${counts.mvp}× MVP`);
  if (counts?.finals_mvp) chips.push(`${counts.finals_mvp}× Finals MVP`);
  if (counts?.all_nba) chips.push(`${counts.all_nba}× All-NBA`);
  if (counts?.all_star) chips.push(`${counts.all_star}× All-Star`);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

export function PlayerStatsPageLink({ playerId }: { playerId: number }) {
  return (
    <Link
      href={`/players/${playerId}`}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      onClick={(e) => e.stopPropagation()}
      title="Open player stats"
      aria-label="Open player stats in a new tab"
      className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-zinc-500 hover:bg-black/5 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
        <path
          fillRule="evenodd"
          d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5Z"
          clipRule="evenodd"
        />
        <path
          fillRule="evenodd"
          d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.56v2.69a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </Link>
  );
}

export function SelectedPlayerStats({
  careerStats,
  playoffStats,
  awardCounts,
  hallOfFame,
  loading,
  playoffLoading,
  showCareer = true,
  className,
}: {
  careerStats?: PlayerCareerStats | null;
  playoffStats?: PlayerCareerStats | null;
  awardCounts?: PlayerAwardCounts | null;
  hallOfFame?: boolean;
  loading?: boolean;
  playoffLoading?: boolean;
  showCareer?: boolean;
  className?: string;
}) {
  const playoffReady = Boolean(playoffStats?.games);
  return (
    <div className={className ?? "mt-3 grid gap-2"}>
      <div className="grid gap-1.5 text-xs text-zinc-700 dark:text-zinc-200">
        {showCareer ? (
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="w-16 flex-none font-semibold text-zinc-600 dark:text-zinc-300">Career</span>
            {careerStats ? (
              <CareerStatLine stats={careerStats} />
            ) : (
              <span className="text-zinc-500 dark:text-zinc-400">{loading ? "Loading…" : "—"}</span>
            )}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="w-16 flex-none font-semibold text-zinc-600 dark:text-zinc-300">Playoffs</span>
          {playoffReady ? (
            <CareerStatLine stats={playoffStats} />
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400">{playoffLoading ? "Loading…" : "—"}</span>
          )}
        </div>
      </div>
      <AccoladeChips counts={awardCounts} hallOfFame={hallOfFame} />
    </div>
  );
}
