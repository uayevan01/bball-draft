"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { AppShell } from "@/components/AppShell";
import { backendGet } from "@/lib/backendClient";
import type {
  PlayerAward,
  PlayerDetail,
  PlayerSeasonStat,
  PlayerSeasonStatsResponse,
  SeasonScope,
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

type CountingSortKey =
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
  | "pts";

type AdvancedSortKey =
  | "season"
  | "team"
  | "games"
  | "per"
  | "ts_pct"
  | "usg_pct"
  | "orb_pct"
  | "drb_pct"
  | "trb_pct"
  | "ast_pct"
  | "stl_pct"
  | "blk_pct"
  | "tov_pct"
  | "ows"
  | "dws"
  | "ws"
  | "ws_per_48"
  | "obpm"
  | "dbpm"
  | "bpm"
  | "vorp";

type SeasonSortKey = CountingSortKey | AdvancedSortKey;

const COUNTING_COLUMNS: Array<{ key: CountingSortKey; label: string }> = [
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
];

const ADVANCED_COLUMNS: Array<{ key: AdvancedSortKey; label: string }> = [
  { key: "season", label: "Season" },
  { key: "team", label: "Tm" },
  { key: "games", label: "G" },
  { key: "per", label: "PER" },
  { key: "ts_pct", label: "TS%" },
  { key: "usg_pct", label: "USG%" },
  { key: "orb_pct", label: "ORB%" },
  { key: "drb_pct", label: "DRB%" },
  { key: "trb_pct", label: "TRB%" },
  { key: "ast_pct", label: "AST%" },
  { key: "stl_pct", label: "STL%" },
  { key: "blk_pct", label: "BLK%" },
  { key: "tov_pct", label: "TOV%" },
  { key: "ows", label: "OWS" },
  { key: "dws", label: "DWS" },
  { key: "ws", label: "WS" },
  { key: "ws_per_48", label: "WS/48" },
  { key: "obpm", label: "OBPM" },
  { key: "dbpm", label: "DBPM" },
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

  const raw = (row[key as keyof PlayerSeasonStat] as number | null | undefined) ?? null;
  if (raw == null) return null;
  if (view === "per_game" && PER_GAME_SORT_KEYS.has(key)) {
    const g = row.games;
    if (g == null || g <= 0) return null;
    return raw / g;
  }
  return raw;
}

function sortSeasonRows(
  rows: PlayerSeasonStat[],
  sortKey: SeasonSortKey,
  sortDir: "asc" | "desc",
  view: StatsView,
  teamsById: Record<number, Team>,
): PlayerSeasonStat[] {
  const sorted = [...rows];
  const dir = sortDir === "asc" ? 1 : -1;
  const labelFor = (teamId: number) => {
    const t = teamsById[teamId];
    return t?.abbreviation || t?.name || String(teamId);
  };
  sorted.sort((a, b) => {
    const av = seasonSortValue(a, sortKey, view, labelFor(a.team_id));
    const bv = seasonSortValue(b, sortKey, view, labelFor(b.team_id));
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
  return sorted;
}

function defaultSortDir(key: SeasonSortKey): "asc" | "desc" {
  return key === "season" || key === "team" ? "asc" : "desc";
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
  all_nba_1: "All-NBA 1st Team",
  all_nba_2: "All-NBA 2nd Team",
  all_nba_3: "All-NBA 3rd Team",
  all_defense_1: "All-Defensive 1st Team",
  all_defense_2: "All-Defensive 2nd Team",
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

/** Labels drive the hover card; slugs drive the inline badges. */
type SeasonAwards = { labels: string[]; slugs: Set<string> };

/**
 * Season id -> accolades, ordered like the summary chips.
 * Keyed by season alone, so a mid-season trade shows the accolade on both team rows.
 */
function awardsBySeasonId(awards: PlayerAward[]): Map<number, SeasonAwards> {
  const sorted = [...awards].sort(
    (a, b) => awardSortKey(a.award?.slug || "") - awardSortKey(b.award?.slug || ""),
  );

  const map = new Map<number, SeasonAwards>();
  for (const row of sorted) {
    const slug = row.award?.slug || `award-${row.award_id}`;
    const label = AWARD_SHORT_LABELS[slug] || row.award?.name || slug;
    const entry = map.get(row.season_id) ?? { labels: [], slugs: new Set<string>() };
    if (!entry.labels.includes(label)) entry.labels.push(label);
    entry.slugs.add(slug);
    map.set(row.season_id, entry);
  }
  return map;
}

type SeasonHover = {
  title: string;
  accolades: string[];
  /** Season <td>; card re-measures this on scroll so fixed coords stay under the year. */
  anchor: HTMLElement;
};

const HOVER_WIDTH_PX = 240;
const HOVER_GAP_PX = 4;

function positionBelowAnchor(anchor: HTMLElement): { left: number; top: number } {
  const rect = anchor.getBoundingClientRect();
  return {
    left: Math.min(Math.max(8, rect.left), window.innerWidth - HOVER_WIDTH_PX - 8),
    top: rect.bottom + HOVER_GAP_PX,
  };
}

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const playerId = Number(params.id);
  const { getToken } = useAuth();

  const [player, setPlayer] = useState<PlayerDetail | null>(null);
  const [regularStats, setRegularStats] = useState<PlayerSeasonStatsResponse | null>(null);
  const [postseasonStats, setPostseasonStats] = useState<PlayerSeasonStatsResponse | null>(null);
  const [awards, setAwards] = useState<PlayerAward[]>([]);
  const [teamsById, setTeamsById] = useState<Record<number, Team>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsView, setStatsView] = useState<StatsView>("per_game");
  const [seasonScope, setSeasonScope] = useState<SeasonScope>("regular");
  const [countingSortKey, setCountingSortKey] = useState<CountingSortKey>("season");
  const [countingSortDir, setCountingSortDir] = useState<"asc" | "desc">("asc");
  const [advancedSortKey, setAdvancedSortKey] = useState<AdvancedSortKey>("season");
  const [advancedSortDir, setAdvancedSortDir] = useState<"asc" | "desc">("asc");
  const [seasonHover, setSeasonHover] = useState<SeasonHover | null>(null);

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
        const [detail, seasonStats, playoffStats, awardRows, teams] = await Promise.all([
          backendGet<PlayerDetail>(`/players/${playerId}/details`, token),
          backendGet<PlayerSeasonStatsResponse>(
            `/players/${playerId}/stats?aggregate=true&season_type=regular`,
            token,
          ),
          // Separate request so each scope gets the server's minutes-weighted advanced totals.
          backendGet<PlayerSeasonStatsResponse>(
            `/players/${playerId}/stats?aggregate=true&season_type=postseason`,
            token,
          ),
          backendGet<PlayerAward[]>(`/players/${playerId}/awards`, token),
          backendGet<Team[]>("/teams?limit=500", token).catch(() => [] as Team[]),
        ]);
        if (cancelled) return;
        setPlayer(detail);
        setRegularStats(seasonStats);
        setPostseasonStats(playoffStats);
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

  const stats = seasonScope === "regular" ? regularStats : postseasonStats;
  const hasPostseason = (postseasonStats?.rows.length ?? 0) > 0;
  const scopeLabel = seasonScope === "regular" ? "Regular season" : "Playoff";

  const countingRows = useMemo(
    () => sortSeasonRows(stats?.rows ?? [], countingSortKey, countingSortDir, statsView, teamsById),
    [stats, countingSortKey, countingSortDir, statsView, teamsById],
  );

  const advancedRows = useMemo(
    // Advanced rates don't depend on per-game vs totals.
    () => sortSeasonRows(stats?.rows ?? [], advancedSortKey, advancedSortDir, "totals", teamsById),
    [stats, advancedSortKey, advancedSortDir, teamsById],
  );

  const awardGroups = useMemo(() => {
    const abbr = (teamId: number | null | undefined) => {
      if (teamId == null) return "—";
      const t = teamsById[teamId];
      return t?.abbreviation || t?.name || String(teamId);
    };
    return groupAwards(awards, abbr);
  }, [awards, teamsById]);

  const awardsBySeason = useMemo(() => awardsBySeasonId(awards), [awards]);

  function showSeasonHover(
    e: ReactMouseEvent<HTMLTableRowElement>,
    row: PlayerSeasonStat,
    accolades: string[],
  ) {
    const seasonLabel = row.season?.label || row.season?.start_year || "—";
    const seasonCell = e.currentTarget.cells[0] as HTMLElement | undefined;
    if (!seasonCell) return;
    setSeasonHover({
      title: `${seasonLabel} · ${teamAbbr(row.team_id)}`,
      accolades,
      anchor: seasonCell,
    });
  }

  const hideSeasonHover = () => setSeasonHover(null);

  function toggleCountingSort(key: CountingSortKey) {
    if (countingSortKey === key) {
      setCountingSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setCountingSortKey(key);
    setCountingSortDir(defaultSortDir(key));
  }

  function toggleAdvancedSort(key: AdvancedSortKey) {
    if (advancedSortKey === key) {
      setAdvancedSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setAdvancedSortKey(key);
    setAdvancedSortDir(defaultSortDir(key));
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
              {awardGroups.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
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
              <h2 className="text-lg font-semibold tracking-tight">{scopeLabel} stats</h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-full border border-black/10 bg-white p-1 text-sm dark:border-white/10 dark:bg-black">
                  <ScopeButton
                    label="Regular season"
                    active={seasonScope === "regular"}
                    onClick={() => setSeasonScope("regular")}
                  />
                  <ScopeButton
                    label="Playoffs"
                    active={seasonScope === "postseason"}
                    disabled={!hasPostseason}
                    title={hasPostseason ? undefined : "No playoff seasons on file"}
                    onClick={() => setSeasonScope("postseason")}
                  />
                </div>
                <div className="inline-flex rounded-full border border-black/10 bg-white p-1 text-sm dark:border-white/10 dark:bg-black">
                  <ScopeButton
                    label="Per game"
                    active={statsView === "per_game"}
                    onClick={() => setStatsView("per_game")}
                  />
                  <ScopeButton
                    label="Totals"
                    active={statsView === "totals"}
                    onClick={() => setStatsView("totals")}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-black/10 text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10">
                  <tr>
                    {COUNTING_COLUMNS.map((col) => (
                      <SortableTh
                        key={col.key}
                        label={col.label}
                        active={countingSortKey === col.key}
                        dir={countingSortDir}
                        onClick={() => toggleCountingSort(col.key)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {countingRows.length === 0 ? (
                    <tr>
                      <td colSpan={COUNTING_COLUMNS.length} className="px-4 py-6 text-zinc-500">
                        No season rows.
                      </td>
                    </tr>
                  ) : (
                    countingRows.map((row) => (
                      <CountingSeasonRow
                        key={row.id}
                        row={row}
                        teamLabel={teamAbbr(row.team_id)}
                        view={statsView}
                        seasonAwards={awardsBySeason.get(row.season_id)}
                        scope={seasonScope}
                        onHover={showSeasonHover}
                        onLeave={hideSeasonHover}
                      />
                    ))
                  )}
                </tbody>
                {stats?.totals && countingRows.length > 0 ? (
                  <tfoot>
                    <CountingCareerRow totals={stats.totals} view={statsView} />
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight">{scopeLabel} advanced</h2>
            <div className="mt-3 overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-black/10 text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10">
                  <tr>
                    {ADVANCED_COLUMNS.map((col) => (
                      <SortableTh
                        key={col.key}
                        label={col.label}
                        active={advancedSortKey === col.key}
                        dir={advancedSortDir}
                        onClick={() => toggleAdvancedSort(col.key)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {advancedRows.length === 0 ? (
                    <tr>
                      <td colSpan={ADVANCED_COLUMNS.length} className="px-4 py-6 text-zinc-500">
                        No season rows.
                      </td>
                    </tr>
                  ) : (
                    advancedRows.map((row) => (
                      <AdvancedSeasonRow
                        key={row.id}
                        row={row}
                        teamLabel={teamAbbr(row.team_id)}
                        seasonAwards={awardsBySeason.get(row.season_id)}
                        scope={seasonScope}
                        onHover={showSeasonHover}
                        onLeave={hideSeasonHover}
                      />
                    ))
                  )}
                </tbody>
                {stats?.totals && advancedRows.length > 0 ? (
                  <tfoot>
                    <AdvancedCareerRow totals={stats.totals} />
                  </tfoot>
                ) : null}
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {seasonHover ? <SeasonAccoladesCard hover={seasonHover} /> : null}
    </AppShell>
  );
}

function SeasonAccoladesCard({ hover }: { hover: SeasonHover }) {
  const [pos, setPos] = useState(() => positionBelowAnchor(hover.anchor));

  useEffect(() => {
    const update = () => setPos(positionBelowAnchor(hover.anchor));
    update();
    // capture:true catches scroll on overflow-x-auto ancestors, not just the window.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hover.anchor]);

  return (
    // Fixed so the card escapes the table's horizontal scroll container instead of being clipped.
    <div
      className="pointer-events-none fixed z-50 rounded-xl border border-black/10 bg-white px-3 py-2 shadow-lg dark:border-white/10 dark:bg-zinc-900"
      style={{ left: pos.left, top: pos.top, width: HOVER_WIDTH_PX }}
    >
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{hover.title}</div>
      <ul className="mt-1 grid gap-1 text-xs text-zinc-700 dark:text-zinc-200">
        {hover.accolades.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}

type SeasonHoverHandler = (
  e: ReactMouseEvent<HTMLTableRowElement>,
  row: PlayerSeasonStat,
  accolades: string[],
) => void;

function seasonRowClass(hasAccolades: boolean): string {
  const base = "border-t border-black/5 dark:border-white/5";
  return hasAccolades ? `${base} hover:bg-amber-500/10 dark:hover:bg-amber-500/10` : base;
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
      aria-hidden
    >
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10" />
      <path d="M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10" />
      <path d="M12 14v3.5" />
      <path d="M8.5 20h7" />
    </svg>
  );
}

function AwardBadge({ label, title }: { label: string; title: string }) {
  return (
    <span
      title={title}
      className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-bold leading-tight tracking-wide text-amber-700 dark:text-amber-300"
    >
      {label}
    </span>
  );
}

function SeasonCellLabel({
  row,
  slugs,
  scope,
}: {
  row: PlayerSeasonStat;
  slugs: Set<string> | undefined;
  scope: SeasonScope;
}) {
  const showChampion = scope === "postseason" && slugs?.has("championship");
  const showFinalsMvp = scope === "postseason" && slugs?.has("finals_mvp");
  const showMvp = scope === "regular" && slugs?.has("mvp");

  return (
    <span className="inline-flex items-center gap-1">
      {row.season?.label || row.season?.start_year || "—"}
      {showChampion ? (
        <span title="NBA Champion" className="inline-flex">
          <TrophyIcon />
        </span>
      ) : null}
      {showFinalsMvp ? <AwardBadge label="FMVP" title="Finals MVP" /> : null}
      {showMvp ? <AwardBadge label="MVP" title="Most Valuable Player" /> : null}
    </span>
  );
}

function ScopeButton({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "h-9 rounded-full px-4 font-semibold",
        active
          ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
          : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
        disabled ? "cursor-not-allowed opacity-40 hover:text-zinc-700 dark:hover:text-zinc-300" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="whitespace-nowrap px-2 py-2 font-medium first:pl-4 last:pr-4">
      <button
        type="button"
        onClick={onClick}
        className={[
          "inline-flex items-center gap-1 hover:text-zinc-950 dark:hover:text-white",
          active ? "text-zinc-950 dark:text-white" : "",
        ].join(" ")}
      >
        <span>{label}</span>
        <span className="tabular-nums text-[10px] opacity-70">
          {active ? (dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
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

function CountingSeasonRow({
  row,
  teamLabel,
  view,
  seasonAwards,
  scope,
  onHover,
  onLeave,
}: {
  row: PlayerSeasonStat;
  teamLabel: string;
  view: StatsView;
  seasonAwards: SeasonAwards | undefined;
  scope: SeasonScope;
  onHover: SeasonHoverHandler;
  onLeave: () => void;
}) {
  const g = row.games;
  const counting = (n: number | null | undefined, digits = 1) =>
    view === "per_game" ? perGame(n, g, digits) : fmt(n);
  const accolades = seasonAwards?.labels ?? [];

  return (
    <tr
      className={seasonRowClass(accolades.length > 0)}
      onMouseEnter={accolades.length > 0 ? (e) => onHover(e, row, accolades) : undefined}
      onMouseLeave={accolades.length > 0 ? onLeave : undefined}
    >
      <td className="whitespace-nowrap px-2 py-2 first:pl-4">
        <SeasonCellLabel row={row} slugs={seasonAwards?.slugs} scope={scope} />
      </td>
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
      <td className="px-2 py-2 tabular-nums font-medium last:pr-4">{counting(row.pts, 1)}</td>
    </tr>
  );
}

function CountingCareerRow({
  totals,
  view,
}: {
  totals: NonNullable<PlayerSeasonStatsResponse["totals"]>;
  view: StatsView;
}) {
  const g = totals.games;
  const counting = (n: number | null | undefined, digits = 1) =>
    view === "per_game" ? perGame(n, g, digits) : fmt(n);

  return (
    <tr className="border-t-2 border-black/15 bg-zinc-50 font-semibold dark:border-white/15 dark:bg-zinc-900/80">
      <td className="whitespace-nowrap px-2 py-2.5 first:pl-4">Career</td>
      <td className="whitespace-nowrap px-2 py-2.5">—</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.games)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.games_started)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.minutes, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.fg, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.fga, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{pct(totals.fg_pct)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.fg3, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.fg3a, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.ft, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.fta, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.trb, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.ast, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.stl, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.blk, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.tov, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{counting(totals.pf, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums last:pr-4">{counting(totals.pts, 1)}</td>
    </tr>
  );
}

function AdvancedSeasonRow({
  row,
  teamLabel,
  seasonAwards,
  scope,
  onHover,
  onLeave,
}: {
  row: PlayerSeasonStat;
  teamLabel: string;
  seasonAwards: SeasonAwards | undefined;
  scope: SeasonScope;
  onHover: SeasonHoverHandler;
  onLeave: () => void;
}) {
  const accolades = seasonAwards?.labels ?? [];

  return (
    <tr
      className={seasonRowClass(accolades.length > 0)}
      onMouseEnter={accolades.length > 0 ? (e) => onHover(e, row, accolades) : undefined}
      onMouseLeave={accolades.length > 0 ? onLeave : undefined}
    >
      <td className="whitespace-nowrap px-2 py-2 first:pl-4">
        <SeasonCellLabel row={row} slugs={seasonAwards?.slugs} scope={scope} />
      </td>
      <td className="whitespace-nowrap px-2 py-2">{teamLabel}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.games)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.per, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{pct(row.ts_pct)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.usg_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.orb_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.drb_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.trb_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ast_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.stl_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.blk_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.tov_pct, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ows, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.dws, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ws, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ws_per_48, 3)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.obpm, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.dbpm, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.bpm, 1)}</td>
      <td className="px-2 py-2 tabular-nums last:pr-4">{fmt(row.vorp, 1)}</td>
    </tr>
  );
}

function AdvancedCareerRow({
  totals,
}: {
  totals: NonNullable<PlayerSeasonStatsResponse["totals"]>;
}) {
  return (
    <tr className="border-t-2 border-black/15 bg-zinc-50 font-semibold dark:border-white/15 dark:bg-zinc-900/80">
      <td className="whitespace-nowrap px-2 py-2.5 first:pl-4">Career</td>
      <td className="whitespace-nowrap px-2 py-2.5">—</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.games)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.per, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{pct(totals.ts_pct)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.usg_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.orb_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.drb_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.trb_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.ast_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.stl_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.blk_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.tov_pct, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.ows, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.dws, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.ws, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.ws_per_48, 3)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.obpm, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.dbpm, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums">{fmt(totals.bpm, 1)}</td>
      <td className="px-2 py-2.5 tabular-nums last:pr-4">{fmt(totals.vorp, 1)}</td>
    </tr>
  );
}
