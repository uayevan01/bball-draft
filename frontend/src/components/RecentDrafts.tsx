"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";

import { backendGet } from "@/lib/backendClient";
import type { Draft } from "@/lib/types";

export function RecentDrafts({ limit = 5 }: { limit?: number }) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken().catch(() => null);
        const data = await backendGet<Draft[]>(`/drafts/history?limit=${limit}`, token);
        if (!cancelled) setItems(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load drafts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [getToken, limit]);

  return (
    <div className="mt-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-black">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Recent drafts</div>
        <Link href="/history" className="text-xs text-zinc-600 hover:underline dark:text-zinc-300">
          View all
        </Link>
      </div>

      {loading ? <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">Loading…</div> : null}
      {error ? (
        <div className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</div>
      ) : null}

      {!loading && !error ? (
        <div className="mt-3 grid gap-2">
          {items.length === 0 ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">No drafts yet.</div>
          ) : (
            items.map((d) => (
              <Link
                key={d.id}
                href={`/draft/${d.public_id}`}
                className="rounded-xl border border-black/10 bg-white p-3 text-sm hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900/50 dark:hover:bg-white/10"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{d.name || "Draft"}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{d.status}</div>
                </div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                  Picks/player: {d.picks_per_player}
                </div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}


