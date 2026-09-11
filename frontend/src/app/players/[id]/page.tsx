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

function careerYears(p: PlayerDetail): string {
  const start = p.career_start_year;
  const end = p.retirement_year;
  if (start == null && end == null) return "—";
  if (start != null && end == null) return `${start}–present`;
  if (start != null && end != null) return `${start}–${end}`;
  return String(end);
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

  const seasonRows = useMemo(() => {
    const rows = stats?.rows ?? [];
    return [...rows].sort((a, b) => {
      const ay = a.season?.start_year ?? 0;
      const by = b.season?.start_year ?? 0;
      if (ay !== by) return ay - by;
      return a.team_id - b.team_id;
    });
  }, [stats]);

  const awardsSorted = useMemo(() => {
    return [...awards].sort((a, b) => {
      const ay = a.season?.start_year ?? 0;
      const by = b.season?.start_year ?? 0;
      if (ay !== by) return by - ay;
      return (a.award?.name || "").localeCompare(b.award?.name || "");
    });
  }, [awards]);

  function teamAbbr(teamId: number | null | undefined): string {
    if (teamId == null) return "—";
    const t = teamsById[teamId];
    return t?.abbreviation || t?.name || String(teamId);
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
                  <span className="text-zinc-500">Years:</span> {careerYears(player)}
                </div>
                <div>
                  <span className="text-zinc-500">Draft:</span>{" "}
                  {player.draft_year
                    ? `${player.draft_year}${player.draft_round ? ` · R${player.draft_round}` : ""}${
                        player.draft_pick ? ` · Pick ${player.draft_pick}` : ""
                      }`
                    : "—"}
                </div>
              </div>
              {stats?.totals ? (
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
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
                      className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-zinc-900/40"
                    >
                      <div className="font-medium">
                        {s.team?.abbreviation || s.team?.name || teamAbbr(s.team_id)}
                      </div>
                      <div className="text-zinc-500">
                        {s.start_year}–{s.end_year ?? "present"}
                        {s.team?.name ? ` · ${s.team.name}` : ""}
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">No stints on file.</p>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight">Season totals</h2>
            <div className="mt-3 overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40">
              <table className="min-w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-black/10 text-[11px] uppercase tracking-wide text-zinc-500 dark:border-white/10">
                  <tr>
                    {[
                      "Season",
                      "Tm",
                      "G",
                      "GS",
                      "MP",
                      "FG",
                      "FGA",
                      "FG%",
                      "3P",
                      "3PA",
                      "FT",
                      "FTA",
                      "TRB",
                      "AST",
                      "STL",
                      "BLK",
                      "TOV",
                      "PF",
                      "PTS",
                      "PER",
                      "WS",
                      "BPM",
                      "VORP",
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 font-medium first:pl-4 last:pr-4">
                        {h}
                      </th>
                    ))}
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
                    seasonRows.map((row) => <SeasonRow key={row.id} row={row} teamLabel={teamAbbr(row.team_id)} />)
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold tracking-tight">Awards & resume</h2>
            {awardsSorted.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No awards on file.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {awardsSorted.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-zinc-900/40"
                  >
                    <div>
                      <span className="font-medium">{a.award?.name || a.award?.slug || "Award"}</span>
                      {a.team_id ? (
                        <span className="text-zinc-500"> · {teamAbbr(a.team_id)}</span>
                      ) : null}
                    </div>
                    <div className="text-zinc-500">{a.season?.label || a.season?.start_year || "—"}</div>
                  </li>
                ))}
              </ul>
            )}
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

function SeasonRow({ row, teamLabel }: { row: PlayerSeasonStat; teamLabel: string }) {
  return (
    <tr className="border-t border-black/5 dark:border-white/5">
      <td className="whitespace-nowrap px-2 py-2 first:pl-4">{row.season?.label || row.season?.start_year || "—"}</td>
      <td className="whitespace-nowrap px-2 py-2">{teamLabel}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.games)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.games_started)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.minutes)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.fg)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.fga)}</td>
      <td className="px-2 py-2 tabular-nums">{pct(row.fg_pct)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.fg3)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.fg3a)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ft)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.fta)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.trb)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ast)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.stl)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.blk)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.tov)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.pf)}</td>
      <td className="px-2 py-2 tabular-nums font-medium">{fmt(row.pts)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.per, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.ws, 1)}</td>
      <td className="px-2 py-2 tabular-nums">{fmt(row.bpm, 1)}</td>
      <td className="px-2 py-2 tabular-nums last:pr-4">{fmt(row.vorp, 1)}</td>
    </tr>
  );
}
