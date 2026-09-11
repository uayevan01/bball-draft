"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { backendGet } from "@/lib/backendClient";
import type {
  PlayerAward,
  PlayerDetail,
  PlayerSeasonStat,
  PlayerSeasonStatsResponse,
  Team,
} from "@/lib/playerTypes";
import {
  awardYearFromSeason,
  formatCareerYears,
  formatDraftYear,
  formatStintYears,
} from "@/lib/seasonYears";

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (digits === 0) return String(Math.round(n));
  return n.toFixed(digits);
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  // BRef stores .417 style fractions
  if (n <= 1) return n.toFixed(3).replace(/^0/, "");
  return n.toFixed(3);
}

function perGame(total: number | null | undefined, games: number | null | undefined, digits = 1): string {
  if (total == null || games == null || games <= 0) return "—";
  return (total / games).toFixed(digits);
}

type StatsView = "per_game" | "totals";

type SeasonSortKey =
  | "season"
  | "team"
  | "games"
  | "games_started"
  | "minutes"
  | "fg"
  | "fga"
  | "fg_pct"
  | "fg3"
  | "fg3a"
  | "ft"
  | "fta"
  | "trb"
  | "ast"
  | "stl"
  | "blk"
  | "tov"
  | "pf"
  | "pts"
  | "per"
  | "ws"
  | "bpm"
  | "vorp";

const SEASON_STAT_COLUMNS: Array<{ key: SeasonSortKey; label: string }> = [
  { key: "season", label: "Season" },
  { key: "team", label: "Tm" },
  { key: "games", label: "G" },
  { key: "games_started", label: "GS" },
  { key: "minutes", label: "MP" },
  { key: "fg", label: "FG" },
  { key: "fga", label: "FGA" },
  { key: "fg_pct", label: "FG%" },
  { key: "fg3", label: "3P" },
  { key: "fg3a", label: "3PA" },
  { key: "ft", label: "FT" },
  { key: "fta", label: "FTA" },
  { key: "trb", label: "TRB" },
  { key: "ast", label: "AST" },
  { key: "stl", label: "STL" },
  { key: "blk", label: "BLK" },
  { key: "tov", label: "TOV" },
  { key: "pf", label: "PF" },
  { key: "pts", label: "PTS" },
  { key: "per", label: "PER" },
  { key: "ws", label: "WS" },
  { key: "bpm", label: "BPM" },
  { key: "vorp", label: "VORP" },
];

const PER_GAME_SORT_KEYS = new Set<SeasonSortKey>([
  "minutes",
  "fg",
  "fga",
  "fg3",
  "fg3a",
  "ft",
  "fta",
  "trb",
  "ast",
  "stl",
  "blk",
  "tov",
  "pf",
  "pts",
]);

function seasonSortValue(
  row: PlayerSeasonStat,
  key: SeasonSortKey,
  view: StatsView,
  teamLabel: string,
): number | string | null {
  if (key === "season") return row.season?.start_year ?? null;
  if (key === "team") return teamLabel;
  if (key === "games") return row.games ?? null;
  if (key === "games_started") return row.games_started ?? null;
  if (key === "fg_pct") return row.fg_pct ?? null;
  if (key === "per") return row.per ?? null;
  if (key === "ws") return row.ws ?? null;
  if (key === "bpm") return row.bpm ?? null;
  if (key === "vorp") return row.vorp ?? null;

  const raw = (row[key as keyof PlayerSeasonStat] as number | null | undefined) ?? null;
  if (raw == null) return null;
  if (view === "per_game" && PER_GAME_SORT_KEYS.has(key)) {
    const g = row.games;
    if (g == null || g <= 0) return null;
    return raw / g;
  }
  return raw;
}

type AwardEntry = {
  id: number;
  teamLabel: string;
  /** End year of the season (award citation year). */
  year: number;
};

type AwardGroup = {
  key: string;
  slug: string;
  name: string;
  count: number;
  entries: AwardEntry[];
};

const AWARD_SHORT_LABELS: Record<string, string> = {
  championship: "NBA Champion",
  finals_mvp: "Finals MVP",
  mvp: "MVP",
  dpoy: "DPOY",
  all_star: "All-Star",
  all_nba_1: "All-NBA 1st",
  all_nba_2: "All-NBA 2nd",
  all_nba_3: "All-NBA 3rd",
  all_defense_1: "All-Defense 1st",
  all_defense_2: "All-Defense 2nd",
  roy: "ROY",
  all_rookie_1: "All-Rookie 1st",
  all_rookie_2: "All-Rookie 2nd",
  mip: "MIP",
  sixth_man: "6MOY",
};

/** Display order for award chips on the player page. */
const AWARD_DISPLAY_ORDER: string[] = [
  "championship",
  "finals_mvp",
  "mvp",
  "dpoy",
  "all_star",
  "all_nba_1",
  "all_nba_2",
  "all_nba_3",
  "all_defense_1",
  "all_defense_2",
  "roy",
  "all_rookie_1",
  "all_rookie_2",
  "mip",
  "sixth_man",
];

function awardSortKey(slug: string): number {
  const idx = AWARD_DISPLAY_ORDER.indexOf(slug);
  return idx === -1 ? AWARD_DISPLAY_ORDER.length + 1 : idx;
}

function groupAwards(
  awards: PlayerAward[],
  teamAbbr: (teamId: number | null | undefined) => string,
): AwardGroup[] {
  const bySlug = new Map<string, PlayerAward[]>();
  for (const a of awards) {
    const slug = a.award?.slug || `award-${a.award_id}`;
    const list = bySlug.get(slug) ?? [];
    list.push(a);
    bySlug.set(slug, list);
  }

  const groups: AwardGroup[] = [];
  for (const [slug, rows] of bySlug) {
    const sorted = [...rows].sort((a, b) => {
      const ay = a.season?.start_year ?? 0;
      const by = b.season?.start_year ?? 0;
      if (ay !== by) return ay - by;
      return (a.team_id ?? 0) - (b.team_id ?? 0);
    });

    const entries: AwardEntry[] = [];
    for (const row of sorted) {
      const startYear = row.season?.start_year;
      if (startYear == null) continue;
      const year = awardYearFromSeason(startYear, row.season?.end_year);
      const teamLabel = row.team_id != null ? teamAbbr(row.team_id) : "—";
      entries.push({ id: row.id, teamLabel, year });
    }

    const name = AWARD_SHORT_LABELS[slug] || sorted[0]?.award?.name || slug;
    groups.push({
      key: slug,
      slug,
      name,
      count: sorted.length,
      entries,
    });
  }

  groups.sort((a, b) => awardSortKey(a.slug) - awardSortKey(b.slug) || a.name.localeCompare(b.name));
  return groups;
}

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const playerId = Number(params.id);
  const { getToken } = useAuth();

  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [stats, setStats] = useState<PlayerSeasonStatsResponse | null>(null);
  const [awards, setAwards] = useState<PlayerAward[]>([]);
  const [teamsById, setTeamsById] = useState<Record<number, Team>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsView, setStatsView] = useState<StatsView>("per_game");
  const [sortKey, setSortKey] = useState<SeasonSortKey>("season");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (!Number.isFinite(playerId)) {
      setError("Invalid player id.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const [detail, seasonStats, awardRows, teams] = await Promise.all([
          backendGet<PlayerDetail>(`/players/${playerId}/details`, token),
          backendGet<PlayerSeasonStatsResponse>(`/players/${playerId}/stats?aggregate=true`, token),
          backendGet<PlayerAward[]>(`/players/${playerId}/awards`, token),
          backendGet<Team[]>("/teams?limit=500", token).catch(() => [] as Team[]),
        ]);
        if (cancelled) return;
        setPlayer(detail);
        setStats(seasonStats);
        setAwards(awardRows);
        const map: Record<number, Team> = {};
        for (const t of teams) map[t.id] = t;
        setTeamsById(map);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load player.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [getToken, playerId]);

  function teamAbbr(teamId: number | null | undefined): string {
    if (teamId == null) return "—";
    const t = teamsById[teamId];
    return t?.abbreviation || t?.name || String(teamId);
  }

  const seasonRows = useMemo(() => {
    const rows = [...(stats?.rows ?? [])];
    const dir = sortDir === "asc" ? 1 : -1;
    const labelFor = (teamId: number) => {
      const t = teamsById[teamId];
      return t?.abbreviation || t?.name || String(teamId);
    };
    rows.sort((a, b) => {
      const av = seasonSortValue(a, sortKey, statsView, labelFor(a.team_id));
      const bv = seasonSortValue(b, sortKey, statsView, labelFor(b.team_id));
      if (av == null && bv == null) return a.id - b.id;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        const cmp = av.localeCompare(bv);
        return cmp !== 0 ? cmp * dir : a.id - b.id;
      }
      const an = Number(av);
      const bn = Number(bv);
      if (an !== bn) return (an - bn) * dir;
      const ay = a.season?.start_year ?? 0;
      const by = b.season?.start_year ?? 0;
      if (ay !== by) return ay - by;
      return a.team_id - b.team_id;
    });
    return rows;
  }, [stats, sortKey, sortDir, statsView, teamsById]);

  const awardGroups = useMemo(() => {
    const abbr = (teamId: number | null | undefined) => {
      if (teamId == null) return "—";
      const t = teamsById[teamId];
      return t?.abbreviation || t?.name || String(teamId);
    };
    return groupAwards(awards, abbr);
  }, [awards, teamsById]);

  function toggleSort(key: SeasonSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // First click: season/team asc; stats desc (highest first).
    setSortDir(key === "season" || key === "team" ? "asc" : "desc");
  }

  return (
    <AppShell wide>
      <div className="mb-4">
        <Link href="/players" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          ← Player database
        </Link>
      </div>

      {loading ? <div className="text-sm text-zinc-500">Loading…</div> : null}
      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {player ? (
        <div className="grid gap-8">
          <section className="flex flex-wrap items-start gap-5 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-900/40">
            {player.image_url ? (
              <Image
                src={player.image_url}
                alt=""
                width={120}
                height={120}
                className="h-28 w-28 rounded-xl object-cover bg-zinc-200 dark:bg-zinc-800"
                unoptimized
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-zinc-200 text-2xl font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {player.name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight">{player.name}</h1>
                {player.hall_of_fame ? (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Hall of Fame
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid gap-1 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <span className="text-zinc-500">Position:</span> {player.position || "—"}
                </div>
                <div>
                  <span className="text-zinc-500">Years:</span>{" "}
                  {formatCareerYears(player.career_start_year, player.retirement_year)}
                </div>
                <div>
                  <span className="text-zinc-500">Draft:</span>{" "}
                  {formatDraftYear(player.draft_year, player.draft_round, player.draft_pick)}
                </div>
              </div>
              {stats?.totals ? (
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <StatChip label="GP" value={fmt(stats.totals.games)} />
                  <StatChip label="PTS" value={fmt(stats.totals.pts)} />
                  <StatChip label="TRB" value={fmt(stats.totals.trb)} />
                  <StatChip label="AST" value={fmt(stats.totals.ast)} />
                  <StatChip label="STL" value={fmt(stats.totals.stl)} />
                  <StatChip label="BLK" value={fmt(stats.totals.blk)} />
                  <StatChip label="PER" value={fmt(stats.totals.per, 1)} />
                  <StatChip label="WS" value={fmt(stats.totals.ws, 1)} />
                  <StatChip label="VORP" value={fmt(stats.totals.vorp, 1)} />
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No season stats scraped for this player yet.</p>
              )}
              {awardGroups.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {awardGroups.map((g) => (
                    <AwardChip key={g.key} group={g} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight">Team stints</h2>
            {player.team_stints && player.team_stints.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...player.team_stints]
                  .sort((a, b) => a.start_year - b.start_year)
                  .map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-zinc-900/40"
                    >
                      {s.team?.logo_url ? (
                        <Image
                          src={s.team.logo_url}
                          alt=""
                          width={36}
                          height={36}
                          className="h-9 w-9 object-contain"
                          unoptimized
                        />
                      ) : (
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {(s.team?.abbreviation || "?").slice(0, 3)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">
                          {s.team?.abbreviation || s.team?.name || teamAbbr(s.team_id)}
                        </div>
                        <div className="text-zinc-500">
                          {formatStintYears(s.start_year, s.end_year)}
                          {s.team?.name ? ` · ${s.team.name}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">No stints on file.</p>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">Season stats</h2>
              <div className="inline-flex rounded-full border border-black/10 bg-white p-1 text-sm dark:border-white/10 dark:bg-black">
                <button
                  type="button"
                  onClick={() => setStatsView("per_game")}
                  className={[
                    "h-9 rounded-full px-4 font-semibold",
                    statsView === "per_game"
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
                  ].join(" ")}
                >
                  Per game
                </button>
                <button
                  type="button"
                  onClick={() => setStatsView("totals")}
                  className={[
                    "h-9 rounded-full px-4 font-semibold",
                    statsView === "totals"
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
                  ].join(" ")}
                >
                  Totals
                </button>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-black/10 text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10">
                  <tr>
                    {SEASON_STAT_COLUMNS.map((col) => {
                      const active = sortKey === col.key;
                      return (
                        <th
                          key={col.key}
                          className="whitespace-nowrap px-2 py-2 font-medium first:pl-4 last:pr-4"
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={[
                              "inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-white",
                              active ? "text-zinc-950 dark:text-white" : "",
                            ].join(" ")}
                          >
                            <span>{col.label}</span>
                            <span className="tabular-nums text-[10px] opacity-70">
                              {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {seasonRows.length === 0 ? (
                    <tr>
                      <td colSpan={23} className="px-4 py-6 text-zinc-500">
                        No season rows.
                      </td>
                    </tr>
                  ) : (
                    seasonRows.map((row) => (
                      <SeasonRow key={row.id} row={row} teamLabel={teamAbbr(row.team_id)} view={statsView} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-full border border-black/10 px-3 py-1 dark:border-white/10">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function AwardChip({ group }: { group: AwardGroup }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex cursor-default items-baseline gap-1 rounded-full border border-black/10 px-3 py-1 dark:border-white/10">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">{group.name}</span>
        <span className="font-semibold tabular-nums">{group.count}×</span>
      </span>
      {open && group.entries.length > 0 ? (
        // pt-1 keeps a hover bridge across the gap so the menu stays open while moving onto it.
        <span className="absolute left-0 top-full z-20 pt-1">
          <span className="block max-h-64 min-w-40 overflow-y-auto overscroll-contain rounded-xl border border-black/10 bg-white px-3 py-2 text-xs text-zinc-700 shadow-lg dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200">
            <ul className="grid gap-1">
              {group.entries.map((e) => (
                <li key={e.id} className="whitespace-nowrap tabular-nums">
                  {e.teamLabel} {e.year}
                </li>
              ))}
            </ul>
          </span>
        </span>
      ) : null}
    </span>
  );
}

function SeasonRow({
  row,
  teamLabel,
  view,
}: {
  row: PlayerSeasonStat;
  teamLabel: string;
  view: StatsView;
}) {
  const g = row.games;
  const counting = (n: number | null | undefined, digits = 1) =>
    view === "per_game" ? perGame(n, g, digits) : fmt(n);

  return (
    <tr className="border-t border-black/5 dark:border-white/5">
      <td className="whitespace-nowrap px-2 py-2 first:pl-4">{row.season?.label || row.season?.start_year || "—"}</td>
      <td className="whitespace-nowrap px-2 py-2">{teamLabel}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.games)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.games_started)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.minutes, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.fg, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.fga, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{pct(row.fg_pct)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.fg3, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.fg3a, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.ft, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.fta, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.trb, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.ast, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.stl, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.blk, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.tov, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{counting(row.pf, 1)}</td>
      <td className="px-2 py-2 tabular-nums font-medium">{counting(row.pts, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.per, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ws, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.bpm, 1)}</td>
      <td className="px-2 py-2 tabular-nums last:pr-4">{fmt(row.vorp, 1)}</td>
    </tr>
  );
}
