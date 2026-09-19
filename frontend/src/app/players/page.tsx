"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { backendGet } from "@/lib/backendClient";
import { unwrapPlayerList, type PlayerAwardCounts, type PlayerListItem, type PlayerListPage, type Team } from "@/lib/playerTypes";
import { formatCareerYears } from "@/lib/seasonYears";

const PAGE_SIZE = 50;

const POSITION_OPTIONS = ["G", "F", "C", "G-F", "F-C", "F-G", "C-F"] as const;

type StatKey = "pts" | "trb" | "ast" | "stl" | "blk";
type StatMode = "totals" | "per_game";
type StatBounds = Record<StatKey, { min: string; max: string }>;
type AccoladeCountKey = "all_nba" | "all_star" | "all_def" | "mvp" | "rings" | "fmvp";
type AccoladeBounds = Record<AccoladeCountKey, { min: string; max: string }>;
type SortDir = "asc" | "desc";
type SortKey = "name" | "position" | "team" | "years" | "games" | StatKey | "hof" | AccoladeCountKey;

const DEFAULT_SORT_KEY: SortKey = "name";
const DEFAULT_SORT_DIR: SortDir = "asc";

const STAT_FIELDS: Array<{
  key: StatKey;
  label: string;
  totalShort: string;
  perGameShort: string;
}> = [
  { key: "pts", label: "Points", totalShort: "PTS", perGameShort: "PPG" },
  { key: "trb", label: "Rebounds", totalShort: "TRB", perGameShort: "RPG" },
  { key: "ast", label: "Assists", totalShort: "AST", perGameShort: "APG" },
  { key: "stl", label: "Steals", totalShort: "STL", perGameShort: "SPG" },
  { key: "blk", label: "Blocks", totalShort: "BLK", perGameShort: "BPG" },
];

const EMPTY_STAT_BOUNDS: StatBounds = {
  pts: { min: "", max: "" },
  trb: { min: "", max: "" },
  ast: { min: "", max: "" },
  stl: { min: "", max: "" },
  blk: { min: "", max: "" },
};

const ACCOLADE_COUNT_FIELDS: Array<{
  key: AccoladeCountKey;
  label: string;
  short: string;
  minParam: string;
  maxParam: string;
}> = [
  { key: "all_nba", label: "All-NBA", short: "All-NBA", minParam: "min_all_nba", maxParam: "max_all_nba" },
  { key: "all_star", label: "All-Star", short: "AS", minParam: "min_all_star", maxParam: "max_all_star" },
  { key: "all_def", label: "All-Defensive", short: "All-Def", minParam: "min_all_defense", maxParam: "max_all_defense" },
  { key: "mvp", label: "MVP", short: "MVP", minParam: "min_mvp", maxParam: "max_mvp" },
  { key: "rings", label: "Championships", short: "Titles", minParam: "min_championship", maxParam: "max_championship" },
  { key: "fmvp", label: "Finals MVPs", short: "FMVP", minParam: "min_finals_mvp", maxParam: "max_finals_mvp" },
];

const EMPTY_ACCOLADE_BOUNDS: AccoladeBounds = {
  all_nba: { min: "", max: "" },
  all_star: { min: "", max: "" },
  all_def: { min: "", max: "" },
  mvp: { min: "", max: "" },
  rings: { min: "", max: "" },
  fmvp: { min: "", max: "" },
};

function parseOptionalInt(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function formatCareerStat(
  total: number | null | undefined,
  games: number | null | undefined,
  mode: StatMode,
): string {
  if (total == null) return "—";
  if (mode === "per_game") {
    if (games == null || games <= 0) return "—";
    return (total / games).toFixed(1);
  }
  return String(Math.round(total));
}

function formatCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return String(n);
}

function allNbaCount(counts: PlayerAwardCounts | null | undefined, teams: { first: boolean; second: boolean; third: boolean }): number {
  if (!counts) return 0;
  if (teams.first || teams.second || teams.third) {
    return (
      (teams.first ? counts.all_nba_1 ?? 0 : 0) +
      (teams.second ? counts.all_nba_2 ?? 0 : 0) +
      (teams.third ? counts.all_nba_3 ?? 0 : 0)
    );
  }
  return counts.all_nba ?? 0;
}

function allDefCount(counts: PlayerAwardCounts | null | undefined, teams: { first: boolean; second: boolean }): number {
  if (!counts) return 0;
  if (teams.first || teams.second) {
    return (teams.first ? counts.all_defense_1 ?? 0 : 0) + (teams.second ? counts.all_defense_2 ?? 0 : 0);
  }
  return counts.all_defense ?? 0;
}

function FilterDisclosure({
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge ? (
            <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-white dark:text-black">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="text-zinc-400" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </button>
      {open ? <div className="border-t border-black/10 px-4 py-4 dark:border-white/10">{children}</div> : null}
    </div>
  );
}

function CheckLabel({
  label,
  checked,
  onChange,
  indent,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  indent?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200 ${indent ? "ml-6" : ""}`}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-black/20 accent-zinc-950 dark:accent-white"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function AccoladeBoundRows({
  field,
  bounds,
  inputClass,
  onBoundChange,
  allNba,
  allDef,
  onAllNbaChange,
  onAllDefChange,
}: {
  field: (typeof ACCOLADE_COUNT_FIELDS)[number];
  bounds: { min: string; max: string };
  inputClass: string;
  onBoundChange: (side: "min" | "max", value: string) => void;
  allNba: { first: boolean; second: boolean; third: boolean };
  allDef: { first: boolean; second: boolean };
  onAllNbaChange: { first: (v: boolean) => void; second: (v: boolean) => void; third: (v: boolean) => void };
  onAllDefChange: { first: (v: boolean) => void; second: (v: boolean) => void };
}) {
  return (
    <>
      <tr>
        <td className="py-1.5 pr-3 font-medium text-zinc-700 dark:text-zinc-200">{field.label}</td>
        <td className="py-1.5 pr-3">
          <input
            className={inputClass}
            inputMode="numeric"
            value={bounds.min}
            onChange={(e) => onBoundChange("min", e.target.value)}
            placeholder="no min"
          />
        </td>
        <td className="py-1.5">
          <input
            className={inputClass}
            inputMode="numeric"
            value={bounds.max}
            onChange={(e) => onBoundChange("max", e.target.value)}
            placeholder="no max"
          />
        </td>
      </tr>
      {field.key === "all_nba" ? (
        <tr>
          <td colSpan={3} className="pb-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <CheckLabel label="First team" checked={allNba.first} onChange={onAllNbaChange.first} />
              <CheckLabel label="Second team" checked={allNba.second} onChange={onAllNbaChange.second} />
              <CheckLabel label="Third team" checked={allNba.third} onChange={onAllNbaChange.third} />
            </div>
          </td>
        </tr>
      ) : null}
      {field.key === "all_def" ? (
        <tr>
          <td colSpan={3} className="pb-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <CheckLabel label="First team" checked={allDef.first} onChange={onAllDefChange.first} />
              <CheckLabel label="Second team" checked={allDef.second} onChange={onAllDefChange.second} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th className="whitespace-nowrap px-2 py-2.5 font-medium sm:px-4 sm:py-3">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={[
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-zinc-950 dark:hover:text-white",
          active ? "text-zinc-950 dark:text-white" : "",
        ].join(" ")}
      >
        <span>{label}</span>
        <span className="tabular-nums text-[10px] opacity-70">{active ? (dir === "asc" ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
}

function defaultSortDir(key: SortKey): SortDir {
  if (key === "name" || key === "position" || key === "team" || key === "years") return "asc";
  return "desc";
}

export default function PlayersPage() {
  const { getToken } = useAuth();
  const [players, setPlayers] = useState<PlayerListItem[]>([]);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  const [nameQuery, setNameQuery] = useState("");
  const [position, setPosition] = useState("");
  const [teamId, setTeamId] = useState("");
  const [activeFrom, setActiveFrom] = useState("");
  const [activeTo, setActiveTo] = useState("");
  const [gamesMin, setGamesMin] = useState("");
  const [gamesMax, setGamesMax] = useState("");

  const [statMode, setStatMode] = useState<StatMode>("per_game");
  const [statBounds, setStatBounds] = useState<StatBounds>(EMPTY_STAT_BOUNDS);
  const [accoladeBounds, setAccoladeBounds] = useState<AccoladeBounds>(EMPTY_ACCOLADE_BOUNDS);

  const [hallOfFame, setHallOfFame] = useState(false);
  const [allNba1, setAllNba1] = useState(false);
  const [allNba2, setAllNba2] = useState(false);
  const [allNba3, setAllNba3] = useState(false);
  const [allDef1, setAllDef1] = useState(false);
  const [allDef2, setAllDef2] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [accoladesOpen, setAccoladesOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);

  const debouncedName = useDebouncedValue(nameQuery.trim());
  const debouncedActiveFrom = useDebouncedValue(activeFrom);
  const debouncedActiveTo = useDebouncedValue(activeTo);
  const debouncedGamesMin = useDebouncedValue(gamesMin);
  const debouncedGamesMax = useDebouncedValue(gamesMax);
  const debouncedStatBounds = useDebouncedValue(statBounds);
  const debouncedAccoladeBounds = useDebouncedValue(accoladeBounds);

  const activeStatKeys = useMemo(() => {
    return STAT_FIELDS.filter(({ key }) => {
      const b = debouncedStatBounds[key];
      return Boolean(b.min.trim() || b.max.trim());
    }).map((f) => f.key);
  }, [debouncedStatBounds]);

  const activeAccoladeKeys = useMemo(() => {
    return ACCOLADE_COUNT_FIELDS.filter(({ key }) => {
      const b = debouncedAccoladeBounds[key];
      return Boolean(b.min.trim() || b.max.trim());
    }).map((f) => f.key);
  }, [debouncedAccoladeBounds]);

  const advancedCount = activeStatKeys.length;
  const accoladeCount = (hallOfFame ? 1 : 0) + activeAccoladeKeys.length;

  useEffect(() => {
    if (advancedCount > 0) setAdvancedOpen(true);
  }, [advancedCount]);

  useEffect(() => {
    if (accoladeCount > 0) setAccoladesOpen(true);
  }, [accoladeCount]);

  useEffect(() => {
    setOffset(0);
  }, [
    debouncedName,
    position,
    teamId,
    debouncedActiveFrom,
    debouncedActiveTo,
    debouncedGamesMin,
    debouncedGamesMax,
    statMode,
    debouncedStatBounds,
    debouncedAccoladeBounds,
    hallOfFame,
    allNba1,
    allNba2,
    allNba3,
    allDef1,
    allDef2,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      try {
        const token = await getToken().catch(() => null);
        const rows = await backendGet<Team[]>("/teams?limit=500", token);
        if (!cancelled) setTeams(rows);
      } catch {
        // Team filter is optional; ignore load failure.
      }
    }
    void loadTeams();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (debouncedName) params.set("q", debouncedName);
    if (position) params.set("position", position);
    if (teamId) params.set("stint_team_id", teamId);
    const fromYear = parseOptionalInt(debouncedActiveFrom);
    const toYear = parseOptionalInt(debouncedActiveTo);
    if (fromYear !== undefined) params.set("active_from", String(fromYear));
    if (toYear !== undefined) params.set("active_to", String(toYear));
    const minGames = parseOptionalNumber(debouncedGamesMin);
    const maxGames = parseOptionalNumber(debouncedGamesMax);
    if (minGames !== undefined) params.set("min_games", String(Math.trunc(minGames)));
    if (maxGames !== undefined) params.set("max_games", String(Math.trunc(maxGames)));
    params.set("include_career_stats", "true");

    if (activeStatKeys.length > 0) {
      params.set("stat_mode", statMode);
      for (const key of activeStatKeys) {
        const minN = parseOptionalNumber(debouncedStatBounds[key].min);
        const maxN = parseOptionalNumber(debouncedStatBounds[key].max);
        if (minN !== undefined) params.set(`min_${key}`, String(minN));
        if (maxN !== undefined) params.set(`max_${key}`, String(maxN));
      }
    }

    if (hallOfFame) params.set("hall_of_fame", "true");
    const allNbaActive = activeAccoladeKeys.includes("all_nba");
    const allDefActive = activeAccoladeKeys.includes("all_def");
    for (const field of ACCOLADE_COUNT_FIELDS) {
      if (!activeAccoladeKeys.includes(field.key)) continue;
      const minN = parseOptionalNumber(debouncedAccoladeBounds[field.key].min);
      const maxN = parseOptionalNumber(debouncedAccoladeBounds[field.key].max);
      if (minN !== undefined) params.set(field.minParam, String(Math.trunc(minN)));
      if (maxN !== undefined) params.set(field.maxParam, String(Math.trunc(maxN)));
    }
    if (allNbaActive) {
      if (allNba1) params.set("all_nba_1", "true");
      if (allNba2) params.set("all_nba_2", "true");
      if (allNba3) params.set("all_nba_3", "true");
    }
    if (allDefActive) {
      if (allDef1) params.set("all_defense_1", "true");
      if (allDef2) params.set("all_defense_2", "true");
    }
    if (accoladeCount > 0) params.set("include_award_counts", "true");
    params.set("sort_by", sortBy);
    params.set("sort_dir", sortDir);

    return params.toString();
  }, [
    debouncedName,
    position,
    teamId,
    debouncedActiveFrom,
    debouncedActiveTo,
    debouncedGamesMin,
    debouncedGamesMax,
    statMode,
    debouncedStatBounds,
    activeStatKeys,
    debouncedAccoladeBounds,
    activeAccoladeKeys,
    hallOfFame,
    allNba1,
    allNba2,
    allNba3,
    allDef1,
    allDef2,
    accoladeCount,
    sortBy,
    sortDir,
    offset,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const page = unwrapPlayerList(
          await backendGet<PlayerListItem[] | PlayerListPage>(`/players?${queryString}`, token),
        );
        if (!cancelled) {
          setPlayers(page.items);
          setTotalResults(page.total);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load players.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [getToken, queryString]);

  const teamOptions = useMemo(() => {
    return [...teams].sort((a, b) => {
      const aa = (a.abbreviation || a.name).toUpperCase();
      const bb = (b.abbreviation || b.name).toUpperCase();
      return aa.localeCompare(bb);
    });
  }, [teams]);

  const teamsById = useMemo(() => {
    const m = new Map<number, Team>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);

  const extraColumns = useMemo(() => {
    const cols: Array<{ key: SortKey; label: string; render: (p: PlayerListItem) => string }> = [];
    for (const field of STAT_FIELDS) {
      if (!activeStatKeys.includes(field.key)) continue;
      cols.push({
        key: field.key,
        label: statMode === "per_game" ? field.perGameShort : field.totalShort,
        render: (p) => formatCareerStat(p.career_stats?.[field.key], p.career_stats?.games, statMode),
      });
    }
    if (hallOfFame) {
      cols.push({ key: "hof", label: "HOF", render: (p) => (p.hall_of_fame ? "Yes" : "—") });
    }
    if (activeAccoladeKeys.includes("all_nba")) {
      cols.push({
        key: "all_nba",
        label: "All-NBA",
        render: (p) => formatCount(allNbaCount(p.award_counts, { first: allNba1, second: allNba2, third: allNba3 })),
      });
    }
    if (activeAccoladeKeys.includes("all_star")) {
      cols.push({ key: "all_star", label: "AS", render: (p) => formatCount(p.award_counts?.all_star) });
    }
    if (activeAccoladeKeys.includes("all_def")) {
      cols.push({
        key: "all_def",
        label: "All-Def",
        render: (p) => formatCount(allDefCount(p.award_counts, { first: allDef1, second: allDef2 })),
      });
    }
    if (activeAccoladeKeys.includes("mvp")) {
      cols.push({ key: "mvp", label: "MVP", render: (p) => formatCount(p.award_counts?.mvp) });
    }
    if (activeAccoladeKeys.includes("rings")) {
      cols.push({ key: "rings", label: "Titles", render: (p) => formatCount(p.award_counts?.championship) });
    }
    if (activeAccoladeKeys.includes("fmvp")) {
      cols.push({ key: "fmvp", label: "FMVP", render: (p) => formatCount(p.award_counts?.finals_mvp) });
    }
    return cols;
  }, [activeStatKeys, statMode, hallOfFame, activeAccoladeKeys, allNba1, allNba2, allNba3, allDef1, allDef2]);

  useEffect(() => {
    const visible = new Set<SortKey>(["name", "position", "team", "years", "games", ...extraColumns.map((c) => c.key)]);
    if (!visible.has(sortBy)) {
      setSortBy(DEFAULT_SORT_KEY);
      setSortDir(DEFAULT_SORT_DIR);
    }
  }, [extraColumns, sortBy]);

  const colCount = 5 + extraColumns.length;

  const inputClass =
    "h-10 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-black dark:focus:border-zinc-500";

  function setStatBound(key: StatKey, side: "min" | "max", value: string) {
    setStatBounds((prev) => ({ ...prev, [key]: { ...prev[key], [side]: value } }));
  }

  function setAccoladeBound(key: AccoladeCountKey, side: "min" | "max", value: string) {
    setAccoladeBounds((prev) => ({ ...prev, [key]: { ...prev[key], [side]: value } }));
  }

  function onSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir(defaultSortDir(key));
  }

  function teamLabel(p: PlayerListItem): string {
    const id = p.latest_team_id ?? p.team_id;
    if (id == null) return "—";
    const t = teamsById.get(id);
    return t?.abbreviation || t?.name || "—";
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Player database</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Search by name, position, team, years active, or games played. Open advanced search for counting stats, or
            filter by accolades.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/40 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Name
          <input
            className={inputClass}
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="e.g. LeBron"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Position
          <select className={inputClass} value={position} onChange={(e) => setPosition(e.target.value)}>
            <option value="">Any position</option>
            {POSITION_OPTIONS.map((pos) => (
              <option key={pos} value={pos}>
                {pos}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Team played for
          <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Any team</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.abbreviation ? `${t.abbreviation} — ${t.name}` : t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Years from
            <input
              className={inputClass}
              inputMode="numeric"
              value={activeFrom}
              onChange={(e) => setActiveFrom(e.target.value)}
              placeholder="no min"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Years to
            <input
              className={inputClass}
              inputMode="numeric"
              value={activeTo}
              onChange={(e) => setActiveTo(e.target.value)}
              placeholder="no max"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Games from
            <input
              className={inputClass}
              inputMode="numeric"
              value={gamesMin}
              onChange={(e) => setGamesMin(e.target.value)}
              placeholder="no min"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Games to
            <input
              className={inputClass}
              inputMode="numeric"
              value={gamesMax}
              onChange={(e) => setGamesMax(e.target.value)}
              placeholder="no max"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        <FilterDisclosure
          title="Advanced search"
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
          badge={advancedCount || undefined}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="inline-flex w-full rounded-full border border-black/10 bg-white p-1 text-sm sm:w-auto dark:border-white/10 dark:bg-black">
              
              <button
                type="button"
                onClick={() => setStatMode("per_game")}
                className={[
                  "h-9 flex-1 rounded-full px-3 font-semibold sm:flex-none sm:px-4",
                  statMode === "per_game"
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
                ].join(" ")}
              >
                Per game
              </button>
              <button
                type="button"
                onClick={() => setStatMode("totals")}
                className={[
                  "h-9 flex-1 rounded-full px-3 font-semibold sm:flex-none sm:px-4",
                  statMode === "totals"
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
                ].join(" ")}
              >
                Totals
              </button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-0 text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Stat</th>
                  <th className="py-1 pr-3 font-medium">Min</th>
                  <th className="py-1 font-medium">Max</th>
                </tr>
              </thead>
              <tbody>
                {STAT_FIELDS.map((field) => (
                  <tr key={field.key}>
                    <td className="py-1.5 pr-3 font-medium text-zinc-700 dark:text-zinc-200">
                      {field.label}
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        {statMode === "per_game" ? field.perGameShort : field.totalShort}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        value={statBounds[field.key].min}
                        onChange={(e) => setStatBound(field.key, "min", e.target.value)}
                        placeholder="no min"
                      />
                    </td>
                    <td className="py-1.5">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        value={statBounds[field.key].max}
                        onChange={(e) => setStatBound(field.key, "max", e.target.value)}
                        placeholder="no max"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FilterDisclosure>

        <FilterDisclosure
          title="Accolades"
          open={accoladesOpen}
          onToggle={() => setAccoladesOpen((v) => !v)}
          badge={accoladeCount || undefined}
        >
          <div className="mt-3">
            <CheckLabel label="Hall of Fame" checked={hallOfFame} onChange={setHallOfFame} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-0 text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Accolade</th>
                  <th className="py-1 pr-3 font-medium">Min</th>
                  <th className="py-1 font-medium">Max</th>
                </tr>
              </thead>
              <tbody>
                {ACCOLADE_COUNT_FIELDS.map((field) => (
                  <AccoladeBoundRows
                    key={field.key}
                    field={field}
                    bounds={accoladeBounds[field.key]}
                    inputClass={inputClass}
                    onBoundChange={(side, value) => setAccoladeBound(field.key, side, value)}
                    allNba={{ first: allNba1, second: allNba2, third: allNba3 }}
                    allDef={{ first: allDef1, second: allDef2 }}
                    onAllNbaChange={{ first: setAllNba1, second: setAllNba2, third: setAllNba3 }}
                    onAllDefChange={{ first: setAllDef1, second: setAllDef2 }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </FilterDisclosure>
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2 md:hidden">
        <label className="shrink-0 text-xs font-medium text-zinc-500">Sort</label>
        <select
          className={inputClass}
          value={sortBy}
          onChange={(e) => {
            const next = e.target.value as SortKey;
            setSortBy(next);
            setSortDir(defaultSortDir(next));
          }}
        >
          <option value="name">Player</option>
          <option value="position">Pos</option>
          <option value="team">Team</option>
          <option value="years">Years</option>
          <option value="games">G</option>
          {extraColumns.map((col) => (
            <option key={col.key} value={col.key}>
              {col.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="h-10 shrink-0 rounded-xl border border-black/10 px-3 text-sm font-semibold dark:border-white/10"
          aria-label={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 md:hidden">
        {loading ? (
          <div className="rounded-xl border border-black/10 bg-white px-4 py-8 text-sm text-zinc-500 dark:border-white/10 dark:bg-zinc-900/40">
            Loading…
          </div>
        ) : players.length === 0 ? (
          <div className="rounded-xl border border-black/10 bg-white px-4 py-8 text-sm text-zinc-500 dark:border-white/10 dark:bg-zinc-900/40">
            No players matched these filters.
          </div>
        ) : (
          players.map((p) => (
            <Link
              key={p.id}
              href={`/players/${p.id}`}
              className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-3 dark:border-white/10 dark:bg-zinc-900/40"
            >
              {p.image_url ? (
                <Image
                  src={p.image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-full object-cover bg-zinc-200 dark:bg-zinc-800"
                  unoptimized
                />
              ) : (
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {p.name.slice(0, 1)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {[
                    p.position || null,
                    teamLabel(p) !== "—" ? teamLabel(p) : null,
                    formatCareerYears(p.career_start_year, p.retirement_year),
                    p.career_stats?.games != null ? `${p.career_stats.games} G` : null,
                  ]
                    .filter((v) => v && v !== "—")
                    .join(" · ")}
                </span>
                {extraColumns.length > 0 ? (
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {extraColumns.map((col) => (
                      <span key={col.key}>
                        {col.label} {col.render(p)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
            </Link>
          ))
        )}
      </div>

      <div className="mt-6 hidden min-w-0 overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40 md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            <tr>
              <SortableTh label="Player" sortKey="name" activeKey={sortBy} dir={sortDir} onSort={onSort} />
              <SortableTh label="Pos" sortKey="position" activeKey={sortBy} dir={sortDir} onSort={onSort} />
              <SortableTh label="Team" sortKey="team" activeKey={sortBy} dir={sortDir} onSort={onSort} />
              <SortableTh label="Years" sortKey="years" activeKey={sortBy} dir={sortDir} onSort={onSort} />
              <SortableTh label="G" sortKey="games" activeKey={sortBy} dir={sortDir} onSort={onSort} />
              {extraColumns.map((col) => (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  sortKey={col.key}
                  activeKey={sortBy}
                  dir={sortDir}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : players.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-zinc-500">
                  No players matched these filters.
                </td>
              </tr>
            ) : (
              players.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-black/5 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-zinc-900"
                >
                  <td className="px-2 py-3 sm:px-4">
                    <Link href={`/players/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                      {p.image_url ? (
                        <Image
                          src={p.image_url}
                          alt=""
                          width={36}
                          height={36}
                          className="h-9 w-9 rounded-full object-cover bg-zinc-200 dark:bg-zinc-800"
                          unoptimized
                        />
                      ) : (
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          {p.name.slice(0, 1)}
                        </span>
                      )}
                      <span>{p.name}</span>
                    </Link>
                  </td>
                  <td className="px-2 py-3 text-zinc-600 sm:px-4 dark:text-zinc-300">{p.position || "—"}</td>
                  <td className="px-2 py-3 text-zinc-600 sm:px-4 dark:text-zinc-300">{teamLabel(p)}</td>
                  <td className="px-2 py-3 text-zinc-600 sm:px-4 dark:text-zinc-300">
                    {formatCareerYears(p.career_start_year, p.retirement_year)}
                  </td>
                  <td className="px-2 py-3 tabular-nums text-zinc-600 sm:px-4 dark:text-zinc-300">
                    {formatCount(p.career_stats?.games)}
                  </td>
                  {extraColumns.map((col) => (
                    <td key={col.key} className="px-2 py-3 tabular-nums text-zinc-600 sm:px-4 dark:text-zinc-300">
                      {col.render(p)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={offset === 0 || loading}
          onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          className="h-10 rounded-full border border-black/10 px-3 text-sm font-semibold disabled:opacity-40 sm:px-4 dark:border-white/10"
        >
          Previous
        </button>
        <div className="text-center text-xs text-zinc-500 sm:text-sm">
          {totalResults != null ? `${totalResults.toLocaleString()} results · ` : ""}
          Showing {players.length ? offset + 1 : 0}–{offset + players.length}
        </div>
        <button
          type="button"
          disabled={(totalResults != null ? offset + players.length >= totalResults : players.length < PAGE_SIZE) || loading}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          className="h-10 rounded-full border border-black/10 px-3 text-sm font-semibold disabled:opacity-40 sm:px-4 dark:border-white/10"
        >
          Next
        </button>
      </div>
    </AppShell>
  );
}
