"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { backendGet } from "@/lib/backendClient";
import type { PlayerListItem, Team } from "@/lib/playerTypes";
import { formatCareerYears } from "@/lib/seasonYears";

const PAGE_SIZE = 50;

function parseOptionalInt(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export default function PlayersPage() {
  const { getToken } = useAuth();
  const [players, setPlayers] = useState<PlayerListItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  const [nameQuery, setNameQuery] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [minPts, setMinPts] = useState("");
  const [maxPts, setMaxPts] = useState("");
  const [minAst, setMinAst] = useState("");
  const [maxAst, setMaxAst] = useState("");
  const [minTrb, setMinTrb] = useState("");
  const [maxTrb, setMaxTrb] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedName(nameQuery.trim()), 250);
    return () => window.clearTimeout(t);
  }, [nameQuery]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedName, teamId, minPts, maxPts, minAst, maxAst, minTrb, maxTrb]);

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
    if (teamId) params.set("stint_team_id", teamId);
    const bounds: Array<[string, string]> = [
      ["min_pts", minPts],
      ["max_pts", maxPts],
      ["min_ast", minAst],
      ["max_ast", maxAst],
      ["min_trb", minTrb],
      ["max_trb", maxTrb],
    ];
    for (const [key, raw] of bounds) {
      const n = parseOptionalInt(raw);
      if (n !== undefined) params.set(key, String(n));
    }
    return params.toString();
  }, [debouncedName, teamId, minPts, maxPts, minAst, maxAst, minTrb, maxTrb, offset]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const rows = await backendGet<PlayerListItem[]>(`/players?${queryString}`, token);
        if (!cancelled) setPlayers(rows);
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

  const inputClass =
    "h-10 rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-white/10 dark:bg-black dark:focus:border-zinc-500";

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Player database</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Search by name, team, or career totals. Season stats only appear for scraped players.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/40 md:grid-cols-2 xl:grid-cols-4">
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
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Career PTS ≥
          <input className={inputClass} inputMode="numeric" value={minPts} onChange={(e) => setMinPts(e.target.value)} placeholder="min" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Career PTS ≤
          <input className={inputClass} inputMode="numeric" value={maxPts} onChange={(e) => setMaxPts(e.target.value)} placeholder="max" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Career AST ≥
          <input className={inputClass} inputMode="numeric" value={minAst} onChange={(e) => setMinAst(e.target.value)} placeholder="min" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Career AST ≤
          <input className={inputClass} inputMode="numeric" value={maxAst} onChange={(e) => setMaxAst(e.target.value)} placeholder="max" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Career TRB ≥
          <input className={inputClass} inputMode="numeric" value={minTrb} onChange={(e) => setMinTrb(e.target.value)} placeholder="min" />
        </label>
        <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Career TRB ≤
          <input className={inputClass} inputMode="numeric" value={maxTrb} onChange={(e) => setMaxTrb(e.target.value)} placeholder="max" />
        </label>
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900/40">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Player</th>
              <th className="px-4 py-3 font-medium">Pos</th>
              <th className="px-4 py-3 font-medium">Draft</th>
              <th className="px-4 py-3 font-medium">Years</th>
              <th className="px-4 py-3 font-medium">HOF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : players.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-zinc-500">
                  No players matched these filters.
                </td>
              </tr>
            ) : (
              players.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-black/5 hover:bg-zinc-50 dark:border-white/5 dark:hover:bg-zinc-900"
                >
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{p.position || "—"}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{p.draft_year ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                    {formatCareerYears(p.career_start_year, p.retirement_year)}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{p.hall_of_fame ? "Yes" : "—"}</td>
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
          className="h-10 rounded-full border border-black/10 px-4 text-sm font-semibold disabled:opacity-40 dark:border-white/10"
        >
          Previous
        </button>
        <div className="text-sm text-zinc-500">
          Showing {players.length ? offset + 1 : 0}–{offset + players.length}
        </div>
        <button
          type="button"
          disabled={players.length < PAGE_SIZE || loading}
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          className="h-10 rounded-full border border-black/10 px-4 text-sm font-semibold disabled:opacity-40 dark:border-white/10"
        >
          Next
        </button>
      </div>
    </AppShell>
  );
}
